import * as Sentry from '@sentry/node';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { sentryPrivacyOptions } from '../src/observability/sentryConfig';
import { scrubEvent, scrubSpan } from '../src/observability/scrubEvent';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';
import { FakeWeatherProvider } from './helpers/fakeWeather';

/**
 * CP8: the full Express app + the REAL Sentry SDK (production privacy options) + a recording transport.
 * Every sensitive value below is FAKE and built at runtime (Sentry attaches source lines to stack frames, so a
 * literal in this file would echo the test, not runtime data). Asserts nothing sensitive is in ANY outgoing envelope.
 */
const KEY = ['AIzaSy', 'FAKE', 'KEY', '0000'].join('-');
const CITY = ['Fakeville', 'Springs'].join(' ');
const AUTH = ['Bearer', 'fake', 'token', '123'].join('-');
const COOKIE = ['session', 'fake', 'cookie'].join('=');
const PROMPT_TEXT = 'You plan a short outdoor walk';
const SENSITIVE = [KEY, CITY, AUTH, COOKIE, 'fakeville'];

const sent: string[] = [];
const isDefined = (x: unknown) => x !== undefined;

beforeAll(() => {
  Sentry.init({
    dsn: 'https://publickey@o0.ingest.sentry.io/0',
    tracesSampleRate: 1,
    transport: () => ({ send: async (e) => { sent.push(JSON.stringify(e)); return {}; }, flush: async () => true }),
    ...sentryPrivacyOptions(),
  });
});
afterAll(async () => { await Sentry.close(500); });
beforeEach(() => { sent.length = 0; });

const leakyError = () => new Error(`provider rejected key=${KEY} for ${CITY}`);

function appWith(fallbackThrows: boolean) {
  const fallback = fallbackThrows ? { kind: 'fallback' as const, plan: async () => { throw leakyError(); } } : new FallbackPlanner();
  return createApp({
    quiet: true,
    nodeEnv: 'production',
    planner: new GemmaPlanner({ client: FakeModelClient.failing('unavailable'), timeoutMs: 500 }),
    fallbackPlanner: fallback,
    contextBuilder: new ContextBuilder({ weather: FakeWeatherProvider.observing() }),
  });
}

const post = (app: ReturnType<typeof createApp>) =>
  request(app).post('/walks/plan').set('authorization', AUTH).set('cookie', COOKIE).send({ minutes: 20, location: { city: CITY } });

describe('unexpected Express exception', () => {
  it('1. the client gets a fixed generic message, never the exception text, stack or key', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await post(appWith(true));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toMatch(/at |\.ts|node_modules|AIza|Fakeville/);
    expect(spy.mock.calls.flat().join(' ')).not.toContain(KEY); // server log: class name only
    spy.mockRestore();
  });

  it('2. nothing sensitive reaches any outgoing Sentry event: no message, key, city, header, cookie, body or breadcrumb', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    console.log(`breadcrumb bait ${KEY} ${CITY}`); // Sentry's console integration would normally record this
    await post(appWith(true));
    await Sentry.flush(1000);
    const out = sent.join('\n');
    expect(out).toContain('unexpected error in http'); // the event WAS sent (not a vacuous pass)...
    expect(out).toContain('"type":"Error"'); // ...with its class kept, so errors stay classifiable
    for (const s of SENSITIVE) expect(out.toLowerCase(), `leaked "${s}"`).not.toContain(s.toLowerCase());
    expect(out).not.toContain(PROMPT_TEXT);
    vi.restoreAllMocks();
  });

  it('a raw captureException anywhere in the process is scrubbed by the global event scrubber (defence in depth)', async () => {
    Sentry.captureException(leakyError());
    Sentry.captureMessage('plain message', { extra: { note: 'fixed text' } });
    await Sentry.flush(1000);
    const out = sent.join('\n');
    expect(out).toContain('[redacted]');
    for (const s of SENSITIVE) expect(out.toLowerCase()).not.toContain(s.toLowerCase());
  });

  it('request data on an event is reduced to method + path (no headers, cookies, body, query)', async () => {
    const e = scrubEvent({
      request: { method: 'POST', url: `http://x.test/walks/plan?city=${CITY}`, headers: { authorization: AUTH, cookie: COOKIE }, cookies: { a: 'b' }, data: { location: { city: CITY } }, query_string: `city=${CITY}` },
      user: { ip_address: '203.0.113.9', email: 'a@b.test' },
      breadcrumbs: [{ message: KEY }],
      exception: { values: [{ type: 'Error', value: leakyError().message, stacktrace: { frames: [{ filename: 'a.ts', vars: { key: KEY } } as never] } }] },
    });
    expect(e.request).toEqual({ method: 'POST', url: '/walks/plan' });
    expect(e.user).toBeUndefined();
    expect(e.breadcrumbs).toEqual([]);
    expect(JSON.stringify(e)).not.toMatch(/AIza|Fakeville|fake-token|session=/);
  });

  it('a malformed-JSON 400 containing sensitive text is not reported to Sentry at all and returns a fixed message', async () => {
    const res = await request(appWith(false)).post('/walks/plan').set('content-type', 'application/json').send(`{"city":"${CITY}", "key": "${KEY}"`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad request' });
    await Sentry.flush(1000);
    expect(sent.join('\n')).not.toContain(KEY);
    expect(res.text).not.toContain(KEY);
  });
});

describe('span scrubber', () => {
  it('drops network/client/URL-detail attributes and keeps the closed-set ones', () => {
    const span = scrubSpan({ attributes: { 'client.address': '203.0.113.9', 'client.port': 1, 'network.peer.address': '203.0.113.9', 'network.local.address': '10.0.0.5', 'url.query': `city=${CITY}`, 'http.request.header.cookie': COOKIE, 'user.email': 'a@b.test', 'http.route': '/walks/plan', 'pocketwalk.fallback': true, 'http.response.status_code': 200 } });
    expect(Object.keys(span.attributes).sort()).toEqual(['http.response.status_code', 'http.route', 'pocketwalk.fallback']);
  });
});

describe('fallback-validation bug report carries codes only', () => {
  it('captureMessage extra holds stage + rule codes, never plan text', async () => {
    const marker = ['PLAN', 'TEXT', 'MARKER'].join('');
    const bad = { kind: 'fallback' as const, plan: async () => ({ plan: { title: 'T', steps: [{ minutes: 20, text: `Climb the ${marker} wall.` }], notice: 'n' } as never }) };
    const app = createApp({ quiet: true, nodeEnv: 'production', planner: null, fallbackPlanner: bad });
    const res = await request(app).post('/walks/plan').send({ minutes: 20 });
    expect(res.status).toBe(200);
    expect(res.body.meta.fallbackSource).toBe('emergency');
    expect(JSON.stringify(res.body.plan)).not.toContain(marker);
    await Sentry.flush(1000);
    const out = sent.join('\n');
    expect(out).toContain('failed validation');
    expect(out).not.toContain(marker);
  });
});

describe('model path still works end to end with the real SDK and privacy options', () => {
  it('a normal walk with a city sends only spans free of the city', async () => {
    const app = createApp({
      quiet: true, nodeEnv: 'production',
      planner: new GemmaPlanner({ client: FakeModelClient.replying(validPlanJson(20)), timeoutMs: 500 }),
      contextBuilder: new ContextBuilder({ weather: FakeWeatherProvider.observing() }),
    });
    const res = await post(app);
    expect(res.status).toBe(200);
    await Sentry.flush(1000);
    expect(sent.some(isDefined)).toBe(true);
    for (const s of SENSITIVE) expect(sent.join('\n').toLowerCase()).not.toContain(s.toLowerCase());
  });
});
