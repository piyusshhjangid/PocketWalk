import * as Sentry from '@sentry/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { sentryPrivacyOptions } from '../src/observability/sentryConfig';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';
import { FakeWeatherProvider } from './helpers/fakeWeather';

/**
 * CP8: Sentry itself is broken (transport rejects, then throws; beforeSend throws). A walk must still be served
 * and no unhandled rejection may escape. Vitest also fails the run on any unhandled error, so a silent one cannot hide.
 */
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => unhandled.push(e);
let sendCalls = 0;
let breakBeforeSend = false;

beforeAll(() => {
  process.on('unhandledRejection', onUnhandled);
  Sentry.init({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({
      send: async () => { sendCalls++; if (sendCalls % 2) throw new Error('transport exploded'); return Promise.reject(new Error('transport rejected')); },
      flush: async () => { throw new Error('flush exploded'); },
    }),
    ...sentryPrivacyOptions(),
    beforeSend: () => { if (breakBeforeSend) throw new Error('beforeSend exploded'); return null; },
  });
});
afterAll(async () => { process.off('unhandledRejection', onUnhandled); await Sentry.close(200).catch(() => undefined); });

const model = (client: FakeModelClient) => createApp({
  quiet: true, nodeEnv: 'production',
  planner: new GemmaPlanner({ client, timeoutMs: 300 }),
  contextBuilder: new ContextBuilder({ weather: FakeWeatherProvider.observing() }),
});

describe('10. a failing Sentry cannot break a request', () => {
  it('model path: 200 model plan while every transport call fails', async () => {
    const res = await request(model(FakeModelClient.replying(validPlanJson(20)))).post('/walks/plan').send({ minutes: 20, location: { city: 'Oslo' } });
    expect(res.status).toBe(200);
    expect(res.body.meta.planner).toBe('model');
  });

  it('fallback path: 200 fallback plan', async () => {
    const res = await request(model(FakeModelClient.failing('timeout'))).post('/walks/plan').send({ minutes: 10 });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout' });
  });

  it('unexpected error path: still the fixed 500 JSON when reporting fails', async () => {
    breakBeforeSend = true;
    const app = createApp({ quiet: true, nodeEnv: 'production', planner: null, fallbackPlanner: { kind: 'fallback', plan: async () => { throw new Error('boom'); } } });
    const res = await request(app).post('/walks/plan').send({ minutes: 20 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    await Sentry.flush(100).catch(() => undefined);
    breakBeforeSend = false;
  });

  it('no unhandled promise rejection escaped any of the above', async () => {
    await new Promise((r) => setTimeout(r, 50));
    expect(unhandled).toEqual([]);
  });
});
