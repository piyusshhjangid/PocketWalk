import * as Sentry from '@sentry/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { WalkService } from '../src/services/walkService';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';

type Ended = { op?: string; description?: string; data?: Record<string, unknown>; status?: string; id?: string; parent?: string };
const ended: Ended[] = [];

beforeAll(() => {
  // Real Sentry SDK, real tracing, but a transport that sends nothing.
  Sentry.init({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({ send: async () => ({}), flush: async () => true }),
    dataCollection: { genAI: { inputs: false, outputs: false } },
  });
  Sentry.getClient()?.on('spanEnd', (span) => {
    // Sentry SDK v11 serialises spans in the streamed shape: name + attributes (op lives in sentry.op).
    const j = Sentry.spanToJSON(span) as unknown as {
      name?: string; status?: string; span_id?: string; parent_span_id?: string; attributes?: Record<string, unknown>;
    };
    ended.push({
      op: j.attributes?.['sentry.op'] as string | undefined,
      description: j.name,
      data: j.attributes,
      status: j.status,
      id: j.span_id,
      parent: j.parent_span_id,
    });
  });
});
afterAll(async () => {
  await Sentry.close(500);
});

describe('Sentry instrumentation (Test 7)', () => {
  it('does not change behaviour and emits the expected span tree for a model run', async () => {
    ended.length = 0;
    const model = new GemmaPlanner({ client: FakeModelClient.replying(validPlanJson(20)), timeoutMs: 2000 });
    const result = await new WalkService(model, new FallbackPlanner()).planWalk({ minutes: 20, energy: 'easy' });

    expect(result.meta.planner).toBe('model');
    expect(result.plan.steps).toHaveLength(3);

    const ops = ended.map((s) => s.op);
    expect(ops).toEqual(expect.arrayContaining(['gen_ai.execute_tool', 'gen_ai.chat', 'pocketwalk.validate', 'gen_ai.invoke_agent']));

    const chat = ended.find((s) => s.op === 'gen_ai.chat');
    expect(chat?.description).toBe('chat fake-gemma');
    expect(chat?.data).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'fake-gemma',
      'gen_ai.usage.input_tokens': 100,
      'gen_ai.usage.output_tokens': 50,
    });
    // privacy: neither prompt nor model output is attached to any span
    expect(JSON.stringify(ended)).not.toContain('Quiet block loop');
    expect(JSON.stringify(ended)).not.toContain('You plan a short outdoor walk');

    const agent = ended.find((s) => s.op === 'gen_ai.invoke_agent');
    expect(agent?.data?.['pocketwalk.fallback']).toBe(false);
    // the model call, validation and context steps are children of the one agent span
    for (const op of ['gen_ai.execute_tool', 'gen_ai.chat', 'pocketwalk.validate']) {
      expect(ended.find((s) => s.op === op)?.parent).toBe(agent?.id);
    }
  });

  it('marks fallbacks on the agent span and the failed model span, without throwing', async () => {
    ended.length = 0;
    const model = new GemmaPlanner({ client: FakeModelClient.replying('not json'), timeoutMs: 2000 });
    const result = await new WalkService(model, new FallbackPlanner()).planWalk({ minutes: 10, energy: 'normal' });

    expect(result.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'invalid_json' });
    const agent = ended.find((s) => s.op === 'gen_ai.invoke_agent');
    expect(agent?.data).toMatchObject({ 'pocketwalk.fallback': true, 'pocketwalk.fallback_reason': 'invalid_json' });
    expect(ended.some((s) => s.op === 'pocketwalk.fallback')).toBe(true);
    expect(ended.find((s) => s.op === 'pocketwalk.validate')?.status).not.toBe('ok');
  });
});
