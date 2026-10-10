import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import type { WalkPlanner } from '../src/ai/walkPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { sentryPrivacyOptions } from '../src/observability/sentryConfig';
import { WalkService } from '../src/services/walkService';
import { at, FakeWeatherProvider } from './helpers/fakeWeather';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';
import { planObj, planWithStep } from './helpers/plans';

/**
 * Real Sentry SDK, real tracing, the exact privacy options production uses, and a transport that
 * records what WOULD be sent. Nothing leaves the machine. Proves the trace answers:
 * did parsing / schema / business / safety pass, was fallback used, and why.
 */
type Ended = { op?: string; description?: string; data: Record<string, unknown>; status?: string; id?: string; parent?: string };
const ended: Ended[] = [];
const sent: string[] = [];
const captured: unknown[] = [];

beforeAll(() => {
  Sentry.init({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({ send: async (envelope) => { sent.push(JSON.stringify(envelope)); return {}; }, flush: async () => true }),
    ...sentryPrivacyOptions(),
    // CP8: the shared options now carry the scrubber as beforeSend; record what it outputs (= what would be sent).
    beforeSend: (event, hint) => { const out = sentryPrivacyOptions().beforeSend?.(event, hint) as typeof event; captured.push(out); return out; },
  });
  Sentry.getClient()?.on('spanEnd', (span) => {
    const j = Sentry.spanToJSON(span) as unknown as { name?: string; status?: string; span_id?: string; parent_span_id?: string; attributes?: Record<string, unknown> };
    ended.push({ op: j.attributes?.['sentry.op'] as string | undefined, description: j.name, data: j.attributes ?? {}, status: j.status, id: j.span_id, parent: j.parent_span_id });
  });
});
afterAll(async () => { await Sentry.close(500); });
beforeEach(() => { ended.length = 0; sent.length = 0; captured.length = 0; });

const service = (client: FakeModelClient, fallback: WalkPlanner = new FallbackPlanner(), weather = FakeWeatherProvider.observing()) =>
  new WalkService(new GemmaPlanner({ client, timeoutMs: 2000 }), fallback, new ContextBuilder({ weather, now: at('12:00'), weatherTimeoutMs: 500 }));
const request20 = { minutes: 20, energy: 'easy', location: { city: 'Jalandhar' } } as const;
const span = (op: string) => ended.find((s) => s.op === op);
const agent = () => span('gen_ai.invoke_agent')!;

describe('Sentry: validation stages are real spans under one validate span', () => {
  it('a passing model run: gen_ai.chat, then parse, schema, repair, business, safety under pocketwalk.validate', async () => {
    const result = await service(FakeModelClient.replying(validPlanJson(20))).planWalk(request20);
    expect(result.meta.planner).toBe('model');

    const validate = span('pocketwalk.validate')!;
    expect(validate.parent).toBe(agent().id);
    expect(validate.status).toBe('ok');
    expect(span('gen_ai.chat')?.parent).toBe(agent().id);
    for (const op of ['pocketwalk.parse', 'pocketwalk.schema', 'pocketwalk.repair', 'pocketwalk.business', 'pocketwalk.safety']) {
      expect(span(op)?.parent, op).toBe(validate.id);
    }
    for (const op of ['pocketwalk.parse', 'pocketwalk.schema', 'pocketwalk.business', 'pocketwalk.safety']) {
      expect(span(op)?.data['pocketwalk.stage.result'], op).toBe('passed');
    }
    expect(span('pocketwalk.fallback')).toBeUndefined(); // no fallback span when no fallback ran
    expect(agent().data).toMatchObject({
      'pocketwalk.fallback': false,
      'pocketwalk.validation.parse': 'passed',
      'pocketwalk.validation.schema': 'passed',
      'pocketwalk.validation.business': 'passed',
      'pocketwalk.validation.safety': 'passed',
      'pocketwalk.plan_repaired': false,
    });
    expect(typeof agent().data['pocketwalk.validation_ms']).toBe('number');
  });

  it('a safety rejection: the safety span says failed and names the rule; the agent span says why the fallback ran', async () => {
    const result = await service(FakeModelClient.replying(JSON.stringify(planWithStep('Climb the structure.')))).planWalk(request20);
    expect(result.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'safety_violation', fallbackSource: 'deterministic' });

    expect(span('pocketwalk.safety')?.data).toMatchObject({
      'pocketwalk.stage.result': 'failed',
      'pocketwalk.safety.violation_rules': 'climbing',
      'pocketwalk.safety.violation_categories': 'climbing',
    });
    expect(span('pocketwalk.validate')?.status).not.toBe('ok'); // the validate step as a whole rejected the plan
    expect(span('pocketwalk.safety')?.status).toBe('ok'); // a handled rejection is not a crash
    expect(span('pocketwalk.fallback')).toBeDefined();
    expect(span('pocketwalk.fallback_validate')?.data['pocketwalk.stage.result']).toBe('passed');
    expect(agent().data).toMatchObject({
      'pocketwalk.fallback': true,
      'pocketwalk.fallback_reason': 'safety_violation',
      'pocketwalk.failure_stage': 'safety',
      'pocketwalk.failure_codes': 'climbing',
      'pocketwalk.validation.parse': 'passed',
      'pocketwalk.validation.schema': 'passed',
      'pocketwalk.validation.business': 'passed',
      'pocketwalk.validation.safety': 'failed',
      'pocketwalk.fallback_source': 'deterministic',
    });
  });

  it('each earlier stage can be the one that stopped the run', async () => {
    const cases: [string, string, string, string][] = [
      ['not json', 'pocketwalk.parse', 'invalid_json', 'parse'],
      [JSON.stringify(planObj(20, { steps: 'walk around' })), 'pocketwalk.schema', 'schema_invalid', 'schema'],
      [JSON.stringify(planObj(20, { notice: 'word '.repeat(30) })), 'pocketwalk.business', 'word_limit_exceeded', 'business'],
    ];
    for (const [text, op, code, stage] of cases) {
      ended.length = 0;
      await service(FakeModelClient.replying(text)).planWalk(request20);
      expect(span(op)?.data['pocketwalk.stage.result'], op).toBe('failed');
      expect(String(span(op)?.data['pocketwalk.stage.failure_code']), op).toContain(code);
      expect(agent().data['pocketwalk.failure_stage'], op).toBe(stage);
      expect(agent().data['pocketwalk.fallback']).toBe(true);
    }
  });

  it('later stages do not get spans when an earlier stage stopped the run (no meaningless spans)', async () => {
    await service(FakeModelClient.replying('not json')).planWalk(request20);
    for (const op of ['pocketwalk.schema', 'pocketwalk.repair', 'pocketwalk.business', 'pocketwalk.safety']) expect(span(op), op).toBeUndefined();
  });

  it('a repaired plan is visible in the trace', async () => {
    await service(FakeModelClient.replying(JSON.stringify(planObj(20, { title: '**Quiet**   loop' })))).planWalk(request20);
    expect(span('pocketwalk.repair')?.data).toMatchObject({ 'pocketwalk.repair.applied': true });
    expect(agent().data['pocketwalk.plan_repaired']).toBe(true);
    expect(String(agent().data['pocketwalk.repair_codes'])).toContain('markdown_stripped');
  });

  it('the model never answered: no validation spans, and the failure stage is "model"', async () => {
    await service(FakeModelClient.failing('timeout')).planWalk(request20);
    expect(span('pocketwalk.validate')).toBeUndefined();
    expect(agent().data).toMatchObject({ 'pocketwalk.fallback_reason': 'timeout', 'pocketwalk.failure_stage': 'model', 'pocketwalk.validation.parse': 'not_run' });
  });

  it('the emergency plan is recorded, and the bug is reported to Sentry without plan text', async () => {
    // Built at runtime: Sentry attaches source lines to stack frames, so a literal here would echo this test file, not runtime data.
    const marker = ['LEAKY', 'TEXT'].join('');
    const broken: WalkPlanner = { kind: 'fallback', async plan() { return { plan: planWithStep(`Climb ${marker}.`) as never }; } };
    const result = await service(FakeModelClient.failing('timeout'), broken).planWalk(request20);
    expect(result.meta.fallbackSource).toBe('emergency');
    expect(span('pocketwalk.fallback_validate')?.data['pocketwalk.stage.result']).toBe('failed');
    expect(agent().data['pocketwalk.fallback_source']).toBe('emergency');
    await Sentry.flush(500);
    const msg = captured.find((e) => (e as { message?: string }).message?.includes('failed validation')) as { extra?: Record<string, unknown> } | undefined;
    expect(msg?.extra).toMatchObject({ stage: 'safety', codes: ['climbing'] });
    expect(JSON.stringify(captured)).not.toContain(marker);
  });
});

describe('Sentry: privacy of the new telemetry', () => {
  it('no plan text, prompt, model output, city or rule payload text appears in any span or envelope', async () => {
    const secret = ['ZEBRA', 'MARKER'].join(''); // runtime-built: see note in the emergency test
    const text = JSON.stringify(planWithStep(`Climb the ${secret} structure.`));
    await service(FakeModelClient.replying(text)).planWalk(request20);
    await service(FakeModelClient.replying(JSON.stringify(planObj(20, { title: `Quiet ${secret} loop` })))).planWalk(request20);
    await Sentry.flush(500);
    const everything = JSON.stringify(ended) + sent.join('');
    for (const forbidden of [secret, 'Quiet block loop', 'You plan a short outdoor walk', 'Jalandhar', 'Walk out slowly along']) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
  });
  it('span attributes only ever hold closed-set values or numbers/booleans', async () => {
    await service(FakeModelClient.replying(JSON.stringify(planWithStep('Walk onto the highway.')))).planWalk(request20);
    const pocketwalkAttrs = ended.flatMap((s) => Object.entries(s.data)).filter(([k]) => k.startsWith('pocketwalk.safety') || k.startsWith('pocketwalk.stage') || k.startsWith('pocketwalk.failure'));
    expect(pocketwalkAttrs.length).toBeGreaterThan(0);
    for (const [k, v] of pocketwalkAttrs) expect(String(v), k).toMatch(/^[a-z_,.]+$/);
  });
});
