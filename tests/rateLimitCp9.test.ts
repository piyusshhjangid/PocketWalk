import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { clientKey, createRateLimiter } from '../src/middleware/rateLimiter';

/** CP9: per-client limit on POST /walks/plan with an injected clock (no sleeping) and no model or weather. */
function appWith(opts: { max: number; windowMs?: number; maxClients?: number; trustProxy?: number }) {
  const clock = { t: 1_000_000 };
  const app = createApp({
    quiet: true, nodeEnv: 'production', planner: null,
    rateLimit: { max: opts.max, windowMs: opts.windowMs ?? 60_000, now: () => clock.t, ...(opts.maxClients ? { maxClients: opts.maxClients } : {}) },
    ...(opts.trustProxy !== undefined ? { trustProxy: opts.trustProxy } : {}),
  });
  return { app, clock };
}
const plan = (app: ReturnType<typeof createApp>, xff?: string) => {
  const r = request(app).post('/walks/plan').send({ minutes: 10 });
  return xff ? r.set('X-Forwarded-For', xff) : r;
};

describe('rate limiting POST /walks/plan', () => {
  it('requests up to the limit succeed; the next is 429 with the standard error shape and a Retry-After', async () => {
    const { app } = appWith({ max: 3 });
    for (let i = 0; i < 3; i++) expect((await plan(app)).status).toBe(200);
    const res = await plan(app);
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'Too many requests. Please try again in a moment.' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(res.text).not.toMatch(/limit|window|127|::1|ip/i); // no implementation detail, no address echoed
  });

  it('the limit resets when the window passes, and Retry-After reflects the time left', async () => {
    const { app, clock } = appWith({ max: 1, windowMs: 60_000 });
    expect((await plan(app)).status).toBe(200);
    clock.t += 20_000;
    const blocked = await plan(app);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBe(40);
    clock.t += 40_000; // window over
    expect((await plan(app)).status).toBe(200);
  });

  it('/health and /ready are never limited, even after the client is limited', async () => {
    const { app } = appWith({ max: 1 });
    await plan(app);
    expect((await plan(app)).status).toBe(429);
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/health')).status).toBe(200);
      expect((await request(app).get('/ready')).status).toBe(200);
    }
  });

  it('malformed and invalid requests count too (they are cheap, but a flood of them is still a flood)', async () => {
    const { app } = appWith({ max: 2 });
    expect((await request(app).post('/walks/plan').set('content-type', 'application/json').send('{bad')).status).toBe(400);
    expect((await request(app).post('/walks/plan').send({ minutes: 7 })).status).toBe(400);
    expect((await plan(app)).status).toBe(429);
  });

  it('max 0 disables the limiter', async () => {
    const { app } = appWith({ max: 0 });
    for (let i = 0; i < 30; i++) expect((await plan(app)).status).toBe(200);
  });

  it('without a configured limiter (tests, local) nothing is limited', async () => {
    const app = createApp({ quiet: true, planner: null });
    for (let i = 0; i < 30; i++) expect((await plan(app)).status).toBe(200);
  });
});

describe('forwarding headers cannot be used to dodge the limit', () => {
  it('trust proxy 0 (direct clients): X-Forwarded-For is ignored, so rotating it does not help', async () => {
    const { app } = appWith({ max: 2, trustProxy: 0 });
    expect((await plan(app, '1.1.1.1')).status).toBe(200);
    expect((await plan(app, '2.2.2.2')).status).toBe(200);
    expect((await plan(app, '3.3.3.3')).status).toBe(429);
  });

  it('trust proxy 1 (one real proxy): only the address the proxy appended counts; client-supplied left-hand entries are ignored', async () => {
    const { app } = appWith({ max: 2, trustProxy: 1 });
    // The proxy appended 10.0.0.9 as the real client; everything to its left is attacker-controlled.
    expect((await plan(app, 'spoof-1, 10.0.0.9')).status).toBe(200);
    expect((await plan(app, 'spoof-2, 10.0.0.9')).status).toBe(200);
    expect((await plan(app, '9.9.9.9, 8.8.8.8, 10.0.0.9')).status).toBe(429);
    // A genuinely different client (different proxy-appended address) has its own allowance.
    expect((await plan(app, 'spoof-1, 10.0.0.10')).status).toBe(200);
  });

  it('trust proxy 1: a request with NO forwarding header falls back to the socket address and is still limited', async () => {
    const { app } = appWith({ max: 1, trustProxy: 1 });
    expect((await plan(app)).status).toBe(200);
    expect((await plan(app)).status).toBe(429);
  });
});

describe('client keys and table bounds', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:1111:2222:3333:4444', '2001:db8:1:2::/64'], // same /64: one household, one bucket
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    [undefined, 'unknown'],
  ])('%s -> %s', (ip, key) => {
    expect(clientKey(ip)).toBe(key);
  });

  it('rotating the low 64 bits of an IPv6 address does not escape the limit', async () => {
    const mw = createRateLimiter({ max: 1, windowMs: 1000, now: () => 0 });
    const run = (ip: string) => { let status = 200; mw({ ip } as never, { setHeader: () => undefined, status: (s: number) => ({ json: () => { status = s; } }) } as never, () => undefined); return status; };
    expect(run('2001:db8:1:2::1')).toBe(200);
    expect(run('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(429);
  });

  it('the table is bounded: when full of live clients, new ones are limited (fail closed) and expired ones are swept', () => {
    const clock = { t: 0 };
    const mw = createRateLimiter({ max: 5, windowMs: 1000, maxClients: 2, now: () => clock.t });
    const run = (ip: string) => { let status = 200; mw({ ip } as never, { setHeader: () => undefined, status: (s: number) => ({ json: () => { status = s; } }) } as never, () => undefined); return status; };
    expect(run('1.1.1.1')).toBe(200);
    expect(run('2.2.2.2')).toBe(200);
    expect(run('3.3.3.3')).toBe(429); // full
    clock.t += 1001; // everything expired
    expect(run('3.3.3.3')).toBe(200);
  });
});
