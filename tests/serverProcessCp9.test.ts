import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * CP9: the REAL server process (src/server.ts) as a deployment would run it: production mode, same-origin frontend, SIGTERM.
 * Everything external is local: a fixture frontend directory and, for the in-flight test, a fake model server that never answers.
 * All "secrets" are fake sentinels; none may appear in any output.
 */
const FAKE_KEY = ['FAKE', 'KEY', 'SENTINEL', '123'].join('-');
const FAKE_DSN = 'http://abcdef0123456789abcdef@127.0.0.1:9/1'; // unroutable port: delivery will fail, which must not matter

let feDir: string;
beforeAll(() => {
  feDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-proc-fe-'));
  fs.writeFileSync(path.join(feDir, 'index.html'), '<!doctype html><html><body><div id="root">PocketWalk fixture</div></body></html>');
});
afterAll(() => fs.rmSync(feDir, { recursive: true, force: true }));

const freePort = () => new Promise<number>((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });

interface Proc { child: ChildProcess; out: () => string; exited: Promise<number | null>; port: number; url: string }
async function start(env: Record<string, string>, { waitListening = true } = {}): Promise<Proc> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (d) => (out += d)); child.stderr!.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  if (waitListening) for (let i = 0; i < 300 && !out.includes('listening on') && child.exitCode === null; i++) await new Promise((r) => setTimeout(r, 50));
  return { child, out: () => out, exited, port, url: `http://127.0.0.1:${port}` };
}
const prod = (extra: Record<string, string> = {}) => ({ NODE_ENV: 'production', TRUST_PROXY: '0', GEMMA_PROVIDER: 'none', WEATHER_PROVIDER: 'none', SERVE_FRONTEND: 'true', FRONTEND_DIST_DIR: feDir, ...extra });
const stop = async (p: Proc) => { if (p.child.exitCode === null) { p.child.kill('SIGTERM'); await p.exited; } };

describe('production startup', () => {
  it('serves liveness, readiness, the frontend, and the API from ONE origin; logs hold no secret or DSN', { timeout: 30_000 }, async () => {
    const p = await start(prod({ GEMINI_API_KEY: FAKE_KEY, SENTRY_DSN: FAKE_DSN }));
    try {
      expect(p.out()).toContain('listening on 0.0.0.0'); // production binds all interfaces for a container host
      expect((await fetch(`${p.url}/health`)).status).toBe(200);
      expect((await fetch(`${p.url}/ready`)).status).toBe(200);
      const home = await fetch(`${p.url}/`);
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('PocketWalk fixture');
      expect(home.headers.get('content-security-policy')).toContain("default-src 'self'");
      const plan = await fetch(`${p.url}/walks/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes: 20 }) });
      expect(plan.status).toBe(200);
      expect(((await plan.json()) as { meta: { planner: string } }).meta.planner).toBe('fallback'); // no model configured here
      const miss = await fetch(`${p.url}/walks/plan`); // GET on the API path
      expect(miss.status).toBe(404);
      expect(miss.headers.get('content-type')).toMatch(/json/);
      await new Promise((r) => setTimeout(r, 300)); // let any (doomed) Sentry delivery attempt happen
      expect(p.out()).not.toContain(FAKE_KEY);
      expect(p.out()).not.toContain('abcdef0123456789abcdef');
      expect(p.out()).toContain('traces sample rate: 0.1'); // production default
      expect((await fetch(`${p.url}/health`)).status).toBe(200); // still fine with Sentry unreachable
    } finally { await stop(p); }
  });

  it('works with Sentry unconfigured (the optional case): says so and serves', { timeout: 30_000 }, async () => {
    const p = await start(prod());
    try {
      expect(p.out()).toContain('SENTRY_DSN is not set');
      expect((await fetch(`${p.url}/ready`)).status).toBe(200);
    } finally { await stop(p); }
  });

  it('refuses to start without TRUST_PROXY in production: exit 1, a clear message, no secret printed', { timeout: 30_000 }, async () => {
    const { TRUST_PROXY: _omit, ...env } = prod({ GEMINI_API_KEY: FAKE_KEY });
    const p = await start(env, { waitListening: false });
    expect(await p.exited).toBe(1);
    expect(p.out()).toMatch(/TRUST_PROXY: required in production/);
    expect(p.out()).not.toContain(FAKE_KEY);
    expect(p.out()).not.toContain('listening on');
  });

  it('refuses to start when the frontend build is missing but SERVE_FRONTEND is on', { timeout: 30_000 }, async () => {
    const p = await start(prod({ FRONTEND_DIST_DIR: path.join(feDir, 'nope') }), { waitListening: false });
    expect(await p.exited).toBe(1);
    expect(p.out()).toMatch(/Frontend build not found/);
  });

  it('a port that is already taken is a clear startup failure (exit 1) that prints the error code only', { timeout: 30_000 }, async () => {
    const taken = net.createServer().listen(0, '0.0.0.0');
    await new Promise((r) => taken.once('listening', r));
    const port = (taken.address() as net.AddressInfo).port;
    try {
      const p = await start(prod({ PORT: String(port) }), { waitListening: false });
      // start() sets PORT after the spread of env? make sure the taken port is the one used:
      expect(await p.exited).toBe(1);
      expect(p.out()).toMatch(/could not listen on port \d+: EADDRINUSE/);
    } finally { taken.close(); }
  });
});

describe('graceful shutdown (real process)', () => {
  it('SIGTERM on an idle server exits 0 promptly', { timeout: 30_000 }, async () => {
    const p = await start(prod());
    expect((await fetch(`${p.url}/health`)).status).toBe(200);
    const t = performance.now();
    p.child.kill('SIGTERM');
    expect(await p.exited).toBe(0);
    expect(performance.now() - t).toBeLessThan(5000);
    expect(p.out()).toContain('SIGTERM received');
    await expect(fetch(`${p.url}/health`)).rejects.toBeTruthy(); // no longer accepting connections
  });

  it('SIGTERM with a request in flight: it is cut off after the grace period, its provider call is cancelled, and the process exits 0', { timeout: 40_000 }, async () => {
    // A fake Ollama that accepts the request and never answers, recording when the connection is torn down.
    let providerSawRequest = false;
    let providerConnectionClosed: () => void = () => undefined;
    const closed = new Promise<void>((r) => (providerConnectionClosed = r));
    const provider = http.createServer((req) => { providerSawRequest = true; req.on('close', () => providerConnectionClosed()); });
    await new Promise<void>((r) => provider.listen(0, '127.0.0.1', r));
    const providerPort = (provider.address() as net.AddressInfo).port;

    const p = await start(prod({ GEMMA_PROVIDER: 'ollama', GEMMA_MODEL: 'fake', OLLAMA_BASE_URL: `http://127.0.0.1:${providerPort}`, GEMMA_TIMEOUT_MS: '20000', SHUTDOWN_GRACE_MS: '1000' }));
    try {
      const inFlight = fetch(`${p.url}/walks/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ minutes: 20 }) }).then(
        (r) => `status ${r.status}`,
        () => 'connection closed',
      );
      for (let i = 0; i < 200 && !providerSawRequest; i++) await new Promise((r) => setTimeout(r, 25));
      expect(providerSawRequest).toBe(true); // the request really is in flight inside the model call
      const t = performance.now();
      p.child.kill('SIGTERM');
      const code = await p.exited;
      const elapsed = performance.now() - t;
      expect(code).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(900); // it waited the grace period for in-flight work...
      expect(elapsed).toBeLessThan(8000); // ...but not the 20 s model timeout
      expect(await inFlight).toBe('connection closed');
      await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('provider connection was never cancelled')), 5000))]);
      expect(p.out()).toContain('grace period over');
    } finally { provider.close(); provider.closeAllConnections(); await stop(p); }
  });
});
