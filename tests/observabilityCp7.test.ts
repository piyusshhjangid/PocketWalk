import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { contextErrorCategory, modelErrorCategory, type ErrorCategory } from '../src/observability/errorCategory';
import { WalkService } from '../src/services/walkService';
import { at, FakeWeatherProvider } from './helpers/fakeWeather';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';

type Ended = { op?: string; name?: string; data: Record<string, unknown>; status?: string; id?: string; parent?: string };
const ended: Ended[] = [];
const sent: string[] = [];
const SECRET_KEY = 'AIzaSy-SECRET-KEY-DO-NOT-LEAK';
const CITY = 'Privacytown';

beforeAll(() => {
  Sentry.init({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({ send: async (e) => { sent.push(JSON.stringify(e)); return {}; }, flush: async () => true }),
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false } },
  });
  Sentry.getClient()?.on('spanEnd', (span) => {
    const j = Sentry.spanToJSON(span) as unknown as { name?: string; status?: string; span_id?: string; parent_span_id?: string; attributes?: Record<string, unknown> };
    ended.push({ op: j.attributes?.['sentry.op'] as string | undefined, name: j.name, data: j.attributes ?? {}, status: j.status, id: j.span_id, parent: j.parent_span_id });
  });
});
afterAll(async () => { await Sentry.close(500); });

const svc = (client: FakeModelClient, weather = FakeWeatherProvider.observing(), timeoutMs = 2000) =>
  new WalkService(new GemmaPlanner({ client, timeoutMs }), new FallbackPlanner(), new ContextBuilder({ weather, now: at('12:00') }));
const req = { minutes: 20 as const, energy: 'easy' as const, location: { city: CITY } };
const span = (op: string) => ended.find((s) => s.op === op);
const agent = () => span('gen_ai.invoke_agent');

describe('CP7: successful request trace', () => {
  it('agent root has the request shape, and context -> model -> validate are its children in order', async () => {
    ended.length = 0;
    const r = await svc(FakeModelClient.replying(validPlanJson(20))).planWalk(req);
    expect(r.meta.planner).toBe('model');
    const a = agent();
    expect(a?.data).toMatchObject({
      'pocketwalk.walk_duration_minutes': 20,
      'pocketwalk.energy': 'easy',
      'pocketwalk.fallback': false,
      'pocketwalk.context.degraded': false,
    });
    expect(typeof a?.data['pocketwalk.duration_ms']).toBe('number');
    expect(typeof a?.data['pocketwalk.model_ms']).toBe('number');
    const chat = span('gen_ai.chat');
    expect(chat?.data).toMatchObject({ 'gen_ai.provider.name': 'fake', 'gen_ai.request.model': 'fake-gemma', 'pocketwalk.model.status': 'ok' });
    for (const op of ['gen_ai.execute_tool', 'gen_ai.chat', 'pocketwalk.validate']) expect(span(op)?.parent).toBe(a?.id);
    const order = ended.filter((s) => ['gen_ai.execute_tool', 'gen_ai.chat', 'pocketwalk.validate'].includes(s.op ?? '')).map((s) => s.op);
    expect(order).toEqual(['gen_ai.execute_tool', 'gen_ai.chat', 'pocketwalk.validate']);
    expect(ended.some((s) => s.op === 'pocketwalk.fallback')).toBe(false);
  });
});

describe('CP7: model failure', () => {
  it('records the model failure category on the model span and the fallback on the agent span; response stays safe', async () => {
    ended.length = 0;
    const r = await svc(FakeModelClient.failing('unavailable')).planWalk(req);
    expect(r.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'unavailable' });
    expect(r.plan.steps.length).toBeGreaterThan(0);
    expect(span('gen_ai.chat')?.data).toMatchObject({ 'pocketwalk.model.status': 'failed', 'pocketwalk.model.failure_reason': 'unavailable', 'pocketwalk.error_category': 'model_provider_error' });
    expect(span('gen_ai.chat')?.status).not.toBe('ok');
    expect(agent()?.data).toMatchObject({ 'pocketwalk.fallback': true, 'pocketwalk.fallback_reason': 'unavailable', 'pocketwalk.failure_stage': 'model', 'pocketwalk.error_category': 'model_provider_error' });
    expect(span('pocketwalk.validate')).toBeUndefined(); // the model never answered: nothing to validate
    expect(span('pocketwalk.fallback')).toBeDefined();
  });

  it('a timeout is categorised model_timeout', async () => {
    ended.length = 0;
    const r = await svc(FakeModelClient.hanging(), FakeWeatherProvider.observing(), 60).planWalk(req);
    expect(r.meta.fallbackReason).toBe('timeout');
    expect(agent()?.data['pocketwalk.error_category']).toBe('model_timeout');
    expect(span('gen_ai.chat')?.data['pocketwalk.model.failure_reason']).toBe('timeout');
  });
});

describe('CP7: validation failure', () => {
  it('invalid output: model span ok, validate span failed, fallback + category on the agent span', async () => {
    ended.length = 0;
    const r = await svc(FakeModelClient.replying('definitely not json')).planWalk(req);
    expect(r.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'invalid_json' });
    expect(span('gen_ai.chat')?.data['pocketwalk.model.status']).toBe('ok'); // the call worked; the content did not
    expect(span('pocketwalk.validate')?.status).not.toBe('ok');
    expect(agent()?.data).toMatchObject({ 'pocketwalk.fallback': true, 'pocketwalk.failure_stage': 'parse', 'pocketwalk.error_category': 'model_invalid_output' });
  });

  it('business-rule rejection is categorised validation_failure', async () => {
    ended.length = 0;
    const bad = JSON.stringify({ title: 'Wrong total', steps: [{ minutes: 1, text: 'Walk.' }, { minutes: 1, text: 'Pause.' }, { minutes: 1, text: 'Return.' }], notice: 'Notice.' });
    await svc(FakeModelClient.replying(bad)).planWalk(req);
    expect(agent()?.data).toMatchObject({ 'pocketwalk.failure_stage': 'business', 'pocketwalk.error_category': 'validation_failure' });
  });
});

describe('CP7: context failure', () => {
  it('weather timeout degrades context, is categorised, and the model path still runs', async () => {
    ended.length = 0;
    const cb = new ContextBuilder({ weather: FakeWeatherProvider.hanging(), weatherTimeoutMs: 60 });
    const r = await new WalkService(new GemmaPlanner({ client: FakeModelClient.replying(validPlanJson(20)), timeoutMs: 2000 }), new FallbackPlanner(), cb).planWalk(req);
    expect(r.meta).toMatchObject({ planner: 'model', context: { weather: 'unavailable', weatherFailure: 'timeout' } });
    expect(agent()?.data).toMatchObject({ 'pocketwalk.context.degraded': true, 'pocketwalk.context.error_category': 'context_timeout', 'pocketwalk.fallback': false });
  });

  it('context provider error + model failure: both causes remain distinguishable', async () => {
    ended.length = 0;
    await svc(FakeModelClient.failing('timeout'), FakeWeatherProvider.failing('unavailable')).planWalk(req);
    expect(agent()?.data).toMatchObject({ 'pocketwalk.context.error_category': 'context_provider_error', 'pocketwalk.error_category': 'model_timeout' });
  });

  it('no location is not a failure: no context error category', async () => {
    ended.length = 0;
    await svc(FakeModelClient.replying(validPlanJson(10))).planWalk({ minutes: 10, energy: 'normal' });
    expect(agent()?.data['pocketwalk.context.error_category']).toBeUndefined();
    expect(agent()?.data['pocketwalk.context.degraded']).toBe(false);
  });
});

describe('CP7: error category mapping is closed and total', () => {
  it('every reason maps to a category from the closed set', () => {
    const planner = ['not_configured', 'timeout', 'unavailable', 'rate_limited', 'misconfigured', 'empty_response', 'invalid_json', 'schema_invalid', 'business_rule', 'safety_violation', 'unknown'] as const;
    const weather = ['not_configured', 'location_not_found', 'timeout', 'unavailable', 'rate_limited', 'misconfigured', 'malformed', 'unknown'] as const;
    const allowed = new Set<ErrorCategory | undefined>(['context_timeout', 'context_provider_error', 'context_location_not_found', 'model_not_configured', 'model_timeout', 'model_provider_error', 'model_invalid_output', 'validation_failure', 'safety_rejection', 'unexpected_error', undefined]);
    for (const p of planner) expect(allowed.has(modelErrorCategory(p))).toBe(true);
    for (const w of weather) expect(allowed.has(contextErrorCategory(w))).toBe(true);
    expect(modelErrorCategory('safety_violation')).toBe('safety_rejection');
  });
});

describe('CP7: privacy of spans', () => {
  it('no city, key, prompt, plan text, or provider error text on any span or in any sent envelope', async () => {
    ended.length = 0; sent.length = 0;
    const leaky = new FakeModelClient(async () => { throw new Error(`provider said key=${SECRET_KEY} for ${CITY}`); });
    const crashing = new FakeWeatherProvider(async () => { throw new TypeError(['boom', ['', 'secret', 'path'].join('/')].join(' ')); }); // built at runtime: Sentry's source-context lines would otherwise quote this file
    await svc(leaky, crashing).planWalk(req); // unexpected errors on BOTH sides
    await svc(FakeModelClient.replying(validPlanJson(20))).planWalk(req);
    await Sentry.flush(1000);
    const everything = JSON.stringify(ended) + sent.join('\n');
    expect(everything).toContain('gen_ai.invoke_agent'); // not a vacuous pass
    for (const s of [SECRET_KEY, CITY, 'privacytown', 'You plan a short outdoor walk', 'Quiet block loop', 'Walk out slowly', 'boom /secret/path', 'authorization', 'cookie']) {
      expect(everything.toLowerCase(), `leaked "${s}"`).not.toContain(s.toLowerCase());
    }
  });

  it('every pocketwalk.* attribute value is a number, boolean, or a short token (no free text)', async () => {
    ended.length = 0;
    await svc(FakeModelClient.failing('rate_limited')).planWalk(req);
    await svc(FakeModelClient.replying(validPlanJson(20))).planWalk(req);
    for (const s of ended) {
      for (const [k, v] of Object.entries(s.data)) {
        if (!k.startsWith('pocketwalk.')) continue;
        if (typeof v === 'string') expect(v, `${k} looks like free text`).toMatch(/^[a-z0-9_.,:-]{0,80}$/i);
      }
    }
  });
});
