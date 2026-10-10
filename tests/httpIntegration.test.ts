import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { GoogleGemmaClient } from '../src/ai/googleGemmaClient';
import { OllamaGemmaClient } from '../src/ai/ollamaGemmaClient';
import { validPlanJson } from './helpers/fakeModel';

/**
 * Real HTTP, real fetch, real AbortSignal: the adapters talk to a local server that imitates the
 * provider wire format. No internet and no paid call. Proves the adapter works end to end over a
 * socket (the other tests inject a fake fetch). It does NOT prove the live Google/Ollama behaviour.
 */
let server: http.Server;
let baseUrl: string;
let mode: 'ok' | 'slow' | 'down500' = 'ok';
const received: { path: string; key?: string; body: any }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', key: req.headers['x-goog-api-key'] as string | undefined, body: JSON.parse(raw) });
      if (mode === 'down500') {
        res.writeHead(503).end('{"error":"overloaded"}');
        return;
      }
      const reply = () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url?.startsWith('/api/chat')) {
          res.end(JSON.stringify({ message: { content: validPlanJson(20) }, prompt_eval_count: 9, eval_count: 4 }));
        } else {
          res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: validPlanJson(20) }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } }));
        }
      };
      if (mode === 'slow') setTimeout(reply, 1500);
      else reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const google = (timeoutMs: number) =>
  new GemmaPlanner({ client: new GoogleGemmaClient({ apiKey: 'test-key', model: 'gemma-test', baseUrl, maxOutputTokens: 256, temperature: 0.2 }), timeoutMs });

describe('adapters over real HTTP', () => {
  it('Google adapter: full request -> validated model plan', async () => {
    mode = 'ok'; received.length = 0;
    const res = await request(createApp({ quiet: true, nodeEnv: 'test', planner: google(3000) })).post('/walks/plan').send({ minutes: 20, energy: 'easy' });
    expect(res.body.meta).toMatchObject({ planner: 'model', provider: 'google', model: 'gemma-test' });
    expect(received[0]?.path).toBe('/v1beta/models/gemma-test:generateContent');
    expect(received[0]?.key).toBe('test-key');
    expect(received[0]?.body.contents[0].parts[0].text).toContain('{"minutes":20,"energy":"easy"}');
  });

  it('Ollama adapter: full request -> validated model plan', async () => {
    mode = 'ok'; received.length = 0;
    const planner = new GemmaPlanner({ client: new OllamaGemmaClient({ model: 'gemma-local', baseUrl, maxOutputTokens: 256, temperature: 0.2 }), timeoutMs: 3000 });
    const res = await request(createApp({ quiet: true, nodeEnv: 'test', planner })).post('/walks/plan').send({ minutes: 20 });
    expect(res.body.meta).toMatchObject({ planner: 'model', provider: 'ollama', model: 'gemma-local' });
    expect(received[0]?.path).toBe('/api/chat');
  });

  it('a slow provider is cut off at the budget and the user still gets a walk', async () => {
    mode = 'slow';
    const started = performance.now();
    const res = await request(createApp({ quiet: true, nodeEnv: 'test', planner: google(200) })).post('/walks/plan').send({ minutes: 20 });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout' });
    expect(performance.now() - started).toBeLessThan(1200);
  });

  it('a provider 503 -> fallback(unavailable); an unreachable provider -> fallback(unavailable)', async () => {
    mode = 'down500';
    const a = await request(createApp({ quiet: true, nodeEnv: 'test', planner: google(2000) })).post('/walks/plan').send({ minutes: 10 });
    expect(a.body.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'unavailable' });

    const dead = new GemmaPlanner({ client: new GoogleGemmaClient({ apiKey: 'k', model: 'm', baseUrl: 'http://127.0.0.1:1', maxOutputTokens: 64, temperature: 0 }), timeoutMs: 2000 });
    const b = await request(createApp({ quiet: true, nodeEnv: 'test', planner: dead })).post('/walks/plan').send({ minutes: 10 });
    expect(b.body.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'unavailable' });
  });
});
