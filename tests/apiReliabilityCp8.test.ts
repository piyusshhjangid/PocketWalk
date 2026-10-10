import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

/** CP8: the HTTP boundary as a table. No model, no weather: every valid request is the real deterministic fallback. */
const app = createApp({ quiet: true, nodeEnv: 'production', planner: null });
const json = (body: unknown) => request(app).post('/walks/plan').set('content-type', 'application/json').send(body as object);
const raw = (text: string, type = 'application/json') => request(app).post('/walks/plan').set('content-type', type).send(text);

const sensible = (res: request.Response) => {
  expect(Object.keys(res.body)).toEqual(['error']); // stable shape: exactly one key
  expect(typeof res.body.error).toBe('string');
  expect(res.text).not.toMatch(/stack|node_modules|\.ts:|SyntaxError|Unexpected token|zod/i);
};

describe('POST /walks/plan: valid input contract', () => {
  it.each([10, 20, 40])('accepts %i minutes, energy defaults to normal', async (minutes) => {
    const res = await json({ minutes });
    expect(res.status).toBe(200);
    expect(res.body.plan.steps.reduce((n: number, s: { minutes: number }) => n + s.minutes, 0)).toBe(minutes);
  });
  it.each(['easy', 'normal'])('accepts energy %s', async (energy) => {
    expect((await json({ minutes: 20, energy })).status).toBe(200);
  });
  it.each(['São Paulo', "St. John's", 'Zürich', 'Ho Chi Minh City'])('accepts the city %s', async (city) => {
    expect((await json({ minutes: 10, location: { city } })).status).toBe(200);
  });
  it('unknown fields are ignored (the contract is not strict) and never echoed back', async () => {
    const res = await json({ minutes: 20, isAdmin: true, note: 'ECHO-ME', location: { city: 'Oslo', lat: 1, lon: 2 } });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('ECHO-ME');
    expect(res.text).not.toContain('isAdmin');
  });
  it('the response never contains the city', async () => {
    expect((await json({ minutes: 20, location: { city: 'Oslo' } })).text).not.toContain('Oslo');
  });
});

describe('POST /walks/plan: invalid input is a 400 with a fixed message', () => {
  it.each([
    ['minutes missing', {}],
    ['minutes 15', { minutes: 15 }],
    ['minutes 0', { minutes: 0 }],
    ['minutes negative', { minutes: -10 }],
    ['minutes fractional', { minutes: 20.5 }],
    ['minutes as string', { minutes: '20' }],
    ['minutes null', { minutes: null }],
    ['minutes huge', { minutes: 1e9 }],
    ['energy invalid', { minutes: 20, energy: 'hard' }],
    ['energy number', { minutes: 20, energy: 5 }],
    ['city empty', { minutes: 20, location: { city: '' } }],
    ['city one letter', { minutes: 20, location: { city: 'A' } }],
    ['city 81 chars', { minutes: 20, location: { city: 'a'.repeat(81) } }],
    ['city digits', { minutes: 20, location: { city: '12345' } }],
    ['city URL', { minutes: 20, location: { city: 'http://evil.test' } }],
    ['city markup', { minutes: 20, location: { city: '<script>alert(1)</script>' } }],
    ['city as object', { minutes: 20, location: { city: { a: 1 } } }],
    ['city missing', { minutes: 20, location: {} }],
    ['location as string', { minutes: 20, location: 'Oslo' }],
  ])('%s', async (_name, body) => {
    const res = await json(body);
    expect(res.status).toBe(400);
    sensible(res);
    expect(res.body.error).toMatch(/^Invalid request: minutes must be 10, 20 or 40/);
  });
});

describe('POST /walks/plan: malformed transport', () => {
  it('malformed JSON -> 400 Bad request, parser text not echoed', async () => {
    const res = await raw('{"minutes": 20,');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad request' });
  });
  it.each([['array', '[]'], ['null', 'null'], ['string', '"hi"'], ['number', '5']])('top-level %s -> 400', async (_n, text) => {
    const res = await raw(text);
    expect(res.status).toBe(400);
    sensible(res);
  });
  it('no body at all -> 400', async () => {
    const res = await request(app).post('/walks/plan');
    expect(res.status).toBe(400);
    sensible(res);
  });
  it('wrong content type (text/plain with a valid JSON string) -> 400, not parsed', async () => {
    const res = await raw('{"minutes":20}', 'text/plain');
    expect(res.status).toBe(400);
    sensible(res);
  });
  it('form-encoded body -> 400', async () => {
    const res = await raw('minutes=20', 'application/x-www-form-urlencoded');
    expect(res.status).toBe(400);
    sensible(res);
  });
  it('an unknown charset -> 4xx fixed message', async () => {
    const res = await raw('{"minutes":20}', 'application/json; charset=not-a-real-charset');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    sensible(res);
  });
  it('oversized body (over 10 kB) -> 413 Bad request, not processed', async () => {
    const res = await json({ minutes: 20, padding: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Bad request' });
  });
});

describe('routing', () => {
  it('unknown path and wrong method -> 404 with the standard shape', async () => {
    for (const res of [await request(app).get('/nope'), await request(app).get('/walks/plan'), await request(app).put('/walks/plan').send({ minutes: 20 })]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    }
  });
  it('/health works and exposes nothing but status, service and uptime', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'uptimeSeconds']);
  });
  it('the dev-only Sentry test route does not exist in production', async () => {
    expect((await request(app).get('/debug-sentry')).status).toBe(404);
  });
  it('no x-powered-by header', async () => {
    expect((await request(app).get('/health')).headers['x-powered-by']).toBeUndefined();
  });
});

describe('unexpected internal exceptions', () => {
  it('a throwing fallback planner -> 500 { error: "Internal server error" } with no detail, and the server keeps serving', async () => {
    const bad = createApp({ quiet: true, nodeEnv: 'production', planner: null, fallbackPlanner: { kind: 'fallback', plan: async () => { throw new Error('INTERNAL-DETAIL /srv/app/secret.ts'); } } });
    const res = await request(bad).post('/walks/plan').send({ minutes: 20 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(res.text).not.toContain('INTERNAL-DETAIL');
    expect((await request(bad).get('/health')).status).toBe(200); // not wedged
  });
  it('a synchronous throw inside a planner is also a controlled 500', async () => {
    const bad = createApp({ quiet: true, nodeEnv: 'production', planner: null, fallbackPlanner: { kind: 'fallback', plan: () => { throw new TypeError('sync'); } } });
    const res = await request(bad).post('/walks/plan').send({ minutes: 20 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});
