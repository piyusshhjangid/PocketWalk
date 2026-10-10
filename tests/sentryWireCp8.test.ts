import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * CP8: the REAL server process (src/server.ts: real instrument.ts, real Express/http instrumentation, real Sentry
 * transport over real HTTP) pointed at a LOCAL capture endpoint instead of sentry.io. Sensitive FAKE values are sent
 * in the query string, headers, cookies and body; every byte the server sends is inspected after a clean shutdown.
 * This verifies outgoing-event privacy on the wire. It does NOT verify ingestion by a real Sentry project.
 */
const Q = ['FAKE', 'QUERY', 'SECRET'].join('');
const AUTH = ['FAKE', 'AUTH', 'TOKEN'].join('');
const COOKIE = ['FAKE', 'COOKIE', 'VALUE'].join('');
const CITY = ['Fakeville', 'Springs'].join(' ');

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
});

async function call(port: number, method: string, path: string, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'content-type': 'application/json', authorization: `Bearer ${AUTH}`, cookie: `sid=${COOKIE}` } }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, text: t }));
    });
    req.on('error', reject); req.end(body);
  });
}

describe('real server process -> local capture endpoint', () => {
  it('no sensitive value appears in any envelope the server sends, and the error events are scrubbed', { timeout: 60_000 }, async () => {
    const envelopes: string[] = [];
    const capture = http.createServer((req, res) => {
      const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let b = Buffer.concat(chunks);
        if (req.headers['content-encoding'] === 'gzip') b = gunzipSync(b);
        envelopes.push(b.toString()); res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    await new Promise<void>((r) => capture.listen(0, '127.0.0.1', r));
    const capPort = (capture.address() as net.AddressInfo).port;
    const port = await freePort();

    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { ...process.env, PORT: String(port), NODE_ENV: 'development', GEMMA_PROVIDER: 'none', WEATHER_PROVIDER: 'none', SENTRY_DSN: `http://pubkey@127.0.0.1:${capPort}/1`, SENTRY_TRACES_SAMPLE_RATE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = ''; child.stdout.on('data', (d) => (log += d)); child.stderr.on('data', (d) => (log += d));
    for (let i = 0; i < 200 && !log.includes('listening on'); i++) await new Promise((r) => setTimeout(r, 100));
    expect(log).toContain('listening on');

    const ok = await call(port, 'POST', `/walks/plan?token=${Q}`, JSON.stringify({ minutes: 20, location: { city: CITY } }));
    expect(ok.status).toBe(200);
    const boom = await call(port, 'GET', `/debug-sentry?token=${Q}`);
    expect(boom).toEqual({ status: 500, text: '{"error":"Internal server error"}' });
    const bad = await call(port, 'POST', '/walks/plan', `{"city":"${CITY}"`);
    expect(bad.status).toBe(400);

    const exited = new Promise<void>((r) => child.on('exit', () => r()));
    child.kill('SIGTERM'); // the server flushes Sentry on shutdown
    await exited;
    await new Promise<void>((r) => capture.close(() => r()));

    const all = envelopes.join('\n');
    expect(all.length).toBeGreaterThan(1000); // something real was captured
    expect(all).toContain('"/walks/plan"'); // the http.server span arrived
    expect(all).toContain('unexpected error in http'); // our sanitised error event arrived
    for (const s of [Q, AUTH, COOKIE, CITY, 'Fakeville']) expect(all, `leaked "${s}"`).not.toContain(s);
    expect(all).not.toMatch(/"(client\.address|network\.(peer|local)\.address|url\.query)"/);
    expect(all).not.toContain('debug-sentry?'); // no query string on any URL
    expect(log).not.toContain(Q);
  });
});
