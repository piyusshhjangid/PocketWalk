import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { buildAppFromEnv } from '../src/appFromEnv';
import { loadEnv } from '../src/config/env';
import { Readiness } from '../src/lifecycle/readiness';
import { createShutdown } from '../src/lifecycle/shutdown';
import { scanDir } from '../scripts/scanBundle';
import { FakeModelClient } from './helpers/fakeModel';
import { FakeWeatherProvider } from './helpers/fakeWeather';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';

/** CP9: health vs readiness, same-origin frontend serving, production configuration, shutdown ordering, bundle scan. */

describe('liveness and readiness', () => {
  it('/health is liveness: 200 with a fixed shape in EVERY lifecycle state, including while draining', async () => {
    const readiness = new Readiness();
    const app = createApp({ quiet: true, readiness });
    for (const step of [() => undefined, () => readiness.markReady(), () => readiness.markShuttingDown()]) {
      step();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'uptimeSeconds']);
      expect(res.body).toMatchObject({ status: 'ok', service: 'pocketwalk' });
    }
  });

  it('/ready is 503 while starting, 200 once ready, 503 again when shutting down; the reason is a fixed word', async () => {
    const readiness = new Readiness();
    const app = createApp({ quiet: true, readiness });
    let res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', service: 'pocketwalk', reason: 'starting' });
    readiness.markReady();
    res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', service: 'pocketwalk' });
    readiness.markShuttingDown();
    res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable', service: 'pocketwalk', reason: 'shutting_down' });
  });

  it('readiness can only go forward: a draining server never becomes ready again', () => {
    const r = new Readiness();
    r.markShuttingDown(); r.markReady();
    expect(r.state).toBe('shutting_down');
  });

  it('neither endpoint calls a provider, and neither discloses configuration, environment or errors', async () => {
    const client = FakeModelClient.replying('{}');
    const weather = FakeWeatherProvider.observing();
    const app = createApp({ quiet: true, nodeEnv: 'production', planner: new GemmaPlanner({ client, timeoutMs: 1000 }), contextBuilder: new ContextBuilder({ weather }) });
    for (const p of ['/health', '/ready']) {
      const res = await request(app).get(p);
      expect(res.text).not.toMatch(/gemma|google|open-meteo|sentry|key|env|stack|node_modules|version|production/i);
    }
    expect(client.prompts).toHaveLength(0);
    expect(weather.cities).toHaveLength(0);
  });

  it('while draining, responses ask clients to close the connection (idle keep-alive sockets must not hold shutdown open)', async () => {
    const readiness = new Readiness(); readiness.markReady();
    const app = createApp({ quiet: true, readiness });
    const ping = () => request(app).get('/health').set('Connection', 'keep-alive'); // supertest defaults to close, which would hide the difference
    expect((await ping()).headers.connection).toBe('keep-alive');
    readiness.markShuttingDown();
    expect((await ping()).headers.connection).toBe('close');
  });
});

describe('same-origin frontend serving and API routing', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-fe-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>');
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=should-never-be-served');
    fs.writeFileSync(path.join(path.dirname(dir), 'pw-outside-secret.txt'), 'outside');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = () => createApp({ quiet: true, nodeEnv: 'production', planner: null, frontendDir: dir });

  it('GET / serves the app shell, never cached, with security headers', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['permissions-policy']).toContain('geolocation=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('hashed assets are served with a long immutable cache', async () => {
    const res = await request(app()).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('API routes return JSON, never the HTML shell: wrong method, unknown API path, health, ready', async () => {
    const a = app();
    for (const [method, url] of [['get', '/walks/plan'], ['get', '/walks/anything'], ['put', '/walks/plan'], ['post', '/'], ['get', '/nope'], ['get', '/health.html']] as const) {
      const res = await request(a)[method](url);
      expect(res.status, `${method} ${url}`).toBe(404);
      expect(res.headers['content-type'], `${method} ${url}`).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Not found' });
      expect(res.text).not.toContain('<html');
    }
    expect((await request(a).get('/health')).headers['content-type']).toMatch(/json/);
    expect((await request(a).get('/ready')).headers['content-type']).toMatch(/json/);
  });

  it('the API still works next to the frontend', async () => {
    const res = await request(app()).post('/walks/plan').send({ minutes: 10 });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('dotfiles and files outside the directory are not served', async () => {
    const a = app();
    expect((await request(a).get('/.env')).status).toBe(404);
    expect((await request(a).get('/%2e%2e/pw-outside-secret.txt')).status).not.toBe(200);
    expect((await request(a).get('/../pw-outside-secret.txt')).status).not.toBe(200);
    expect((await request(a).get('/assets/')).status).toBe(404); // no directory listing
  });

  it('HEAD works and a missing build fails startup clearly instead of serving 404s', async () => {
    expect((await request(app()).head('/')).status).toBe(200);
    expect(() => createApp({ quiet: true, frontendDir: path.join(dir, 'does-not-exist') })).toThrow(/Frontend build not found/);
  });
});

describe('production configuration', () => {
  const base = { NODE_ENV: 'production', TRUST_PROXY: '1' } as NodeJS.ProcessEnv;

  it('production REQUIRES an explicit TRUST_PROXY, and the error names it without printing any value', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', GEMINI_API_KEY: 'FAKE-KEY-SENTINEL-123' } as NodeJS.ProcessEnv)).toThrow(/TRUST_PROXY: required in production/);
    try { loadEnv({ NODE_ENV: 'production', GEMINI_API_KEY: 'FAKE-KEY-SENTINEL-123' } as NodeJS.ProcessEnv); } catch (e) { expect(String(e)).not.toContain('FAKE-KEY-SENTINEL-123'); }
  });
  it('TRUST_PROXY=0 is a valid explicit choice; development does not need it', () => {
    expect(loadEnv({ NODE_ENV: 'production', TRUST_PROXY: '0' } as NodeJS.ProcessEnv).TRUST_PROXY).toBe(0);
    expect(loadEnv({} as NodeJS.ProcessEnv).TRUST_PROXY).toBe(0);
  });
  it.each(['-1', '11', 'true', 'abc'])('TRUST_PROXY=%s is rejected (never "trust everything")', (v) => {
    expect(() => loadEnv({ ...base, TRUST_PROXY: v })).toThrow(/TRUST_PROXY/);
  });

  it('Sentry sampling: 1 in development, 0.1 in production, explicit values win, blank counts as unset', () => {
    expect(loadEnv({} as NodeJS.ProcessEnv).SENTRY_TRACES_SAMPLE_RATE).toBe(1);
    expect(loadEnv(base).SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
    expect(loadEnv({ ...base, SENTRY_TRACES_SAMPLE_RATE: '0.5' }).SENTRY_TRACES_SAMPLE_RATE).toBe(0.5);
    expect(loadEnv({ ...base, SENTRY_TRACES_SAMPLE_RATE: '' }).SENTRY_TRACES_SAMPLE_RATE).toBe(0.1);
    expect(() => loadEnv({ ...base, SENTRY_TRACES_SAMPLE_RATE: '2' })).toThrow();
  });

  it('Sentry is optional: no DSN is fine in every mode', () => {
    expect(loadEnv(base).SENTRY_DSN).toBeUndefined();
  });

  it('defaults: deadline 25 s (fits the browser 30 s), 20 plans/min, 8 concurrent, 8 s grace, frontend + 0.0.0.0 in production', () => {
    const e = loadEnv(base);
    expect(e).toMatchObject({ REQUEST_DEADLINE_MS: 25_000, RATE_LIMIT_MAX: 20, RATE_LIMIT_WINDOW_MS: 60_000, MAX_CONCURRENT_PLANS: 8, SHUTDOWN_GRACE_MS: 8_000, SERVE_FRONTEND: true, HOST: '0.0.0.0' });
    const dev = loadEnv({} as NodeJS.ProcessEnv);
    expect(dev).toMatchObject({ SERVE_FRONTEND: false, HOST: undefined });
  });

  it.each([['REQUEST_DEADLINE_MS', '29000'], ['REQUEST_DEADLINE_MS', '4999'], ['MAX_CONCURRENT_PLANS', '0'], ['RATE_LIMIT_MAX', '-1'], ['RATE_LIMIT_WINDOW_MS', '10'], ['SHUTDOWN_GRACE_MS', '100']])('%s=%s is rejected', (k, v) => {
    expect(() => loadEnv({ ...base, [k]: v })).toThrow(new RegExp(k));
  });

  it('PORT comes from the platform environment', () => {
    expect(loadEnv({ ...base, PORT: '10000' }).PORT).toBe(10000);
  });

  it('buildAppFromEnv maps the settings onto the app and reports honest, secret-free notes', async () => {
    const env = loadEnv({ ...base, GEMMA_PROVIDER: 'google', GEMINI_API_KEY: 'FAKE-KEY-SENTINEL-123', GEMMA_TIMEOUT_MS: '30000', RATE_LIMIT_MAX: '0', SERVE_FRONTEND: 'false' });
    const runtime = buildAppFromEnv(env);
    const text = runtime.notes.map((n) => n.text).join('\n');
    expect(text).not.toContain('FAKE-KEY-SENTINEL-123');
    expect(text).toMatch(/exceeds REQUEST_DEADLINE_MS/); // 30000 + 3000 + 1500 > 25000: the mismatch is stated, not hidden
    expect(text).toMatch(/rate limit DISABLED/);
    expect(runtime.notes.some((n) => n.level === 'warn' && /RATE_LIMIT_MAX=0 in production/.test(n.text))).toBe(true);
    expect(runtime.readiness.state).toBe('starting');
    expect((await request(runtime.app).get('/ready')).status).toBe(503);
    runtime.readiness.markReady();
    expect((await request(runtime.app).get('/ready')).status).toBe(200);
  });

  it('buildAppFromEnv wires the rate limit and the proxy setting from the environment', async () => {
    const env = loadEnv({ ...base, TRUST_PROXY: '1', RATE_LIMIT_MAX: '2', SERVE_FRONTEND: 'false' });
    const { app } = buildAppFromEnv(env);
    const go = (xff: string) => request(app).post('/walks/plan').set('X-Forwarded-For', xff).send({ minutes: 10 });
    expect((await go('spoof-a, 10.1.1.1')).status).toBe(200);
    expect((await go('spoof-b, 10.1.1.1')).status).toBe(200);
    expect((await go('spoof-c, 10.1.1.1')).status).toBe(429);
  });

  it('a deadline that is shorter than the configured provider timeouts is shortened per request (see deadlineCp9)', () => {
    const { notes } = buildAppFromEnv(loadEnv({ ...base, GEMMA_PROVIDER: 'google', GEMINI_API_KEY: 'x', SERVE_FRONTEND: 'false' }));
    // Defaults: 15000 + 3000 + 1500 = 19500 <= 25000, so no warning.
    expect(notes.some((n) => /exceeds REQUEST_DEADLINE_MS/.test(n.text))).toBe(false);
  });
});

describe('graceful shutdown ordering', () => {
  beforeEach(() => vi.useFakeTimers());
  function fakeServer() {
    const calls: string[] = [];
    let onClosed: (() => void) | undefined;
    return {
      calls,
      finishClose: () => onClosed?.(),
      server: {
        close: (cb?: () => void) => { calls.push('close'); onClosed = cb; return undefined as never; },
        closeIdleConnections: () => { calls.push('closeIdle'); },
        closeAllConnections: () => { calls.push('closeAll'); },
      },
    };
  }
  const make = (over: Partial<Parameters<typeof createShutdown>[0]> = {}) => {
    const f = fakeServer(); const readiness = new Readiness(); readiness.markReady();
    const exits: number[] = []; const logs: string[] = [];
    const shutdown = createShutdown({ server: f.server, readiness, graceMs: 2000, closeTelemetry: async () => { f.calls.push('telemetry'); }, exit: (c) => exits.push(c), log: (m) => logs.push(m), ...over });
    return { f, readiness, exits, logs, shutdown };
  };

  it('stops taking traffic first, lets in-flight work finish, flushes telemetry, then exits 0', async () => {
    const { f, readiness, exits, shutdown } = make();
    const p = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(readiness.state).toBe('shutting_down');
    expect(f.calls.slice(0, 2)).toEqual(['close', 'closeIdle']);
    expect(exits).toEqual([]); // still draining
    await vi.advanceTimersByTimeAsync(1500);
    expect(f.calls).not.toContain('closeAll'); // in-flight work finished within the grace: nothing was cut off
    f.finishClose();
    await p;
    expect(f.calls).toEqual(['close', 'closeIdle', 'telemetry']);
    expect(exits).toEqual([0]);
  });

  it('after the grace period the remaining connections are closed so shutdown cannot hang on a slow request', async () => {
    const { f, exits, shutdown } = make();
    const p = shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.calls).toContain('closeAll');
    f.finishClose(); // closing the sockets lets server.close() complete
    await p;
    expect(exits).toEqual([0]);
  });

  it('a second signal does nothing (shutdown runs once)', async () => {
    const { f, exits, shutdown } = make();
    const p = shutdown('SIGTERM'); void shutdown('SIGINT'); void shutdown('SIGTERM');
    f.finishClose(); await p;
    expect(f.calls.filter((c) => c === 'close')).toHaveLength(1);
    expect(exits).toEqual([0]);
  });

  it('a telemetry flush failure cannot stop the process from exiting cleanly', async () => {
    const { f, exits, shutdown } = make({ closeTelemetry: async () => { throw new Error('sentry down'); } });
    const p = shutdown('SIGTERM'); f.finishClose(); await p;
    expect(exits).toEqual([0]);
  });

  it('if the server never finishes closing, a hard stop exits non-zero (grace + 5 s)', async () => {
    const { exits, shutdown } = make();
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(2000 + 5000);
    expect(exits).toEqual([1]);
  });
  afterAll(() => vi.useRealTimers());
});

describe('production bundle scan', () => {
  const make = (files: Record<string, string>) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-bundle-'));
    for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, name)), { recursive: true }); fs.writeFileSync(path.join(d, name), text); }
    return d;
  };
  it('passes a clean bundle', () => {
    const d = make({ 'index.html': '<div></div>', 'assets/a.js': 'fetch("/walks/plan")' });
    expect(scanDir(d)).toMatchObject({ files: 2, findings: [] });
  });
  it.each([
    ['a Google key', ['AIza', 'SyFAKE0000000000000000000000'].join('')],
    ['a server variable name', 'process.env.GEMINI_API_KEY'],
    ['a Sentry DSN', 'https://0123456789abcdef0123@o1.ingest.sentry.io/1'],
    ['a development host', 'fetch("http://localhost:3000/walks/plan")'],
    ['a private key block', '-----BEGIN PRIVATE KEY-----'],
  ])('flags %s', (_n, text) => {
    expect(scanDir(make({ 'assets/a.js': text })).findings).toHaveLength(1);
  });
});
