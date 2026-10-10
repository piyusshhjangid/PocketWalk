import { describe, expect, it } from 'vitest';
import { PlannerError } from '../src/ai/errors';
import { GoogleGemmaClient } from '../src/ai/googleGemmaClient';
import { OllamaGemmaClient } from '../src/ai/ollamaGemmaClient';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const signal = () => new AbortController().signal;
const base = { maxOutputTokens: 300, temperature: 0.5 };

async function reasonOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PlannerError) return e.reason;
    throw e;
  }
  return 'resolved';
}

describe('GoogleGemmaClient', () => {
  it('calls generateContent with the key in a header, not the URL', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new GoogleGemmaClient({
      ...base, apiKey: 'KEY123', model: 'gemma-x',
      fetchImpl: async (url, init) => {
        seen = { url: String(url), init: init as RequestInit };
        return json({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } });
      },
    });
    const out = await client.generate('hello', { signal: signal() });
    expect(out).toEqual({ text: '{"a":1}', usage: { inputTokens: 7, outputTokens: 3 } });
    expect(seen?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemma-x:generateContent');
    expect(seen?.url).not.toContain('KEY123');
    expect((seen?.init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY123');
    const body = JSON.parse(String(seen?.init.body));
    expect(body.contents[0].parts[0].text).toBe('hello');
    expect(body.generationConfig).toEqual({ temperature: 0.5, maxOutputTokens: 300 });
  });

  it('ignores "thought" parts and joins the answer parts', async () => {
    const client = new GoogleGemmaClient({ ...base, apiKey: 'k', model: 'm', fetchImpl: async () =>
      json({ candidates: [{ content: { parts: [{ text: 'reasoning...', thought: true }, { text: '{"a"' }, { text: ':1}' }] } }] }) });
    expect((await client.generate('p', { signal: signal() })).text).toBe('{"a":1}');
  });

  it.each([
    [429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'],
    [400, 'misconfigured'], [401, 'misconfigured'], [403, 'misconfigured'], [404, 'misconfigured'],
  ])('maps HTTP %i -> %s without exposing the body', async (status, reason) => {
    const client = new GoogleGemmaClient({ ...base, apiKey: 'k', model: 'm', fetchImpl: async () => json({ error: { message: 'LEAKY DETAIL' } }, status) });
    const err = await client.generate('p', { signal: signal() }).catch((e) => e);
    expect(err).toBeInstanceOf(PlannerError);
    expect(err.reason).toBe(reason);
    expect(err.message).not.toContain('LEAKY');
  });

  it('maps a network failure to unavailable and an abort to timeout', async () => {
    const down = new GoogleGemmaClient({ ...base, apiKey: 'k', model: 'm', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(await reasonOf(down.generate('p', { signal: signal() }))).toBe('unavailable');

    const controller = new AbortController();
    controller.abort();
    const aborted = new GoogleGemmaClient({ ...base, apiKey: 'k', model: 'm', fetchImpl: async () => { throw new DOMException('x', 'AbortError'); } });
    expect(await reasonOf(aborted.generate('p', { signal: controller.signal }))).toBe('timeout');
  });

  it.each([
    ['no candidates', {}],
    ['blocked prompt', { promptFeedback: { blockReason: 'SAFETY' } }],
    ['only thought parts', { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] } }] }],
  ])('treats %s as empty_response', async (_n, body) => {
    const client = new GoogleGemmaClient({ ...base, apiKey: 'k', model: 'm', fetchImpl: async () => json(body) });
    expect(await reasonOf(client.generate('p', { signal: signal() }))).toBe('empty_response');
  });

  it('treats a non-JSON provider body as empty_response', async () => {
    const client = new GoogleGemmaClient({ ...base, apiKey: 'k', model: 'm', fetchImpl: async () => new Response('<html>', { status: 200 }) });
    expect(await reasonOf(client.generate('p', { signal: signal() }))).toBe('empty_response');
  });
});

describe('OllamaGemmaClient', () => {
  it('posts to /api/chat with JSON format and reads message.content', async () => {
    let seen: { url: string; body: any } | undefined;
    const client = new OllamaGemmaClient({
      ...base, model: 'tag:1', baseUrl: 'http://example.test:11434/',
      fetchImpl: async (url, init) => {
        seen = { url: String(url), body: JSON.parse(String((init as RequestInit).body)) };
        return json({ message: { content: '{"a":1}' }, prompt_eval_count: 11, eval_count: 5 });
      },
    });
    const out = await client.generate('hello', { signal: signal() });
    expect(out).toEqual({ text: '{"a":1}', usage: { inputTokens: 11, outputTokens: 5 } });
    expect(seen?.url).toBe('http://example.test:11434/api/chat');
    expect(seen?.body).toMatchObject({ model: 'tag:1', stream: false, format: 'json', options: { temperature: 0.5, num_predict: 300 } });
  });

  it('maps connection refused to unavailable, 5xx to unavailable, empty content to empty_response', async () => {
    const refused = new OllamaGemmaClient({ ...base, model: 'm', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(await reasonOf(refused.generate('p', { signal: signal() }))).toBe('unavailable');
    const err500 = new OllamaGemmaClient({ ...base, model: 'm', fetchImpl: async () => json({}, 500) });
    expect(await reasonOf(err500.generate('p', { signal: signal() }))).toBe('unavailable');
    const empty = new OllamaGemmaClient({ ...base, model: 'm', fetchImpl: async () => json({ message: { content: '' } }) });
    expect(await reasonOf(empty.generate('p', { signal: signal() }))).toBe('empty_response');
  });
});
