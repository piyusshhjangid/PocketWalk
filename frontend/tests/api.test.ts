import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/apiError';
import { createWalkApi } from '../src/api/walkApi';
import type { WalkRequest } from '../src/types/walk';
import { fixture, responseFrom } from './fixtures';

const request: WalkRequest = { minutes: 20, energy: 'easy', location: { city: 'Jalandhar' } };
const make = (fetchImpl: typeof fetch, over: { baseUrl?: string; timeoutMs?: number } = {}) =>
  createWalkApi({ baseUrl: over.baseUrl ?? '', timeoutMs: over.timeoutMs ?? 5000, fetchImpl });
const failure = async (p: Promise<unknown>): Promise<ApiError> => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to fail');
};

describe('walkApi request construction', () => {
  it('POSTs JSON to /walks/plan on the configured base', async () => {
    const fetchImpl = vi.fn(async () => responseFrom(fixture('model-plan-weather')));
    await make(fetchImpl as unknown as typeof fetch).planWalk(request);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/walks/plan');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  it('joins an absolute base URL without a double slash', async () => {
    const fetchImpl = vi.fn(async () => responseFrom(fixture('model-plan-no-location')));
    await make(fetchImpl as unknown as typeof fetch, { baseUrl: 'https://api.example.test/' }).planWalk({ minutes: 10, energy: 'normal' });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe('https://api.example.test/walks/plan');
  });

  it('sends no location key when none was chosen', async () => {
    const fetchImpl = vi.fn(async () => responseFrom(fixture('model-plan-no-location')));
    await make(fetchImpl as unknown as typeof fetch).planWalk({ minutes: 10, energy: 'normal' });
    const body = JSON.parse(((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1]).body as string);
    expect(body).toEqual({ minutes: 10, energy: 'normal' });
  });
});

describe('walkApi responses (real backend shapes)', () => {
  it('parses a successful AI plan with weather context', async () => {
    const r = await make((async () => responseFrom(fixture('model-plan-weather'))) as typeof fetch).planWalk(request);
    expect(r.meta.planner).toBe('model');
    expect(r.plan.steps).toHaveLength(3);
    expect(r.meta.context.conditions).toMatchObject({ condition: 'rain', precipitation: 'light', temperatureC: 18 });
  });

  it.each(['fallback-not-configured', 'fallback-model-unavailable', 'fallback-safety-rejected'])('parses %s as a normal plan', async (name) => {
    const r = await make((async () => responseFrom(fixture(name))) as typeof fetch).planWalk(request);
    expect(r.meta.planner).toBe('fallback');
    expect(r.meta.fallbackSource).toBe('deterministic');
    expect(r.plan.title.length).toBeGreaterThan(0);
  });

  it('maps a backend 400 to invalid_request (not retryable) without keeping server text', async () => {
    const err = await failure(make((async () => responseFrom(fixture('error-400-invalid-request'))) as typeof fetch).planWalk(request));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ kind: 'invalid_request', status: 400, retryable: false });
    expect(err.message).not.toMatch(/minutes must be/);
  });

  it('maps a backend 500 to server (retryable) without keeping server text', async () => {
    const err = await failure(make((async () => responseFrom(fixture('error-500-internal'))) as typeof fetch).planWalk(request));
    expect(err).toMatchObject({ kind: 'server', status: 500, retryable: true });
    expect(err.message).not.toMatch(/Internal server error/);
  });

  it('maps a 404 to not_found', async () => {
    const err = await failure(make((async () => responseFrom(fixture('error-404'))) as typeof fetch).planWalk(request));
    expect(err).toMatchObject({ kind: 'not_found', status: 404 });
  });

  it('maps a rejected fetch to network (retryable)', async () => {
    const err = await failure(make((async () => { throw new TypeError('Failed to fetch https://secret.internal/x'); }) as typeof fetch).planWalk(request));
    expect(err).toMatchObject({ kind: 'network', retryable: true });
    expect(err.message).not.toMatch(/secret/);
  });

  it('maps a non-JSON 200 to malformed', async () => {
    const err = await failure(make((async () => new Response('<html>oops</html>', { status: 200 })) as typeof fetch).planWalk(request));
    expect(err).toMatchObject({ kind: 'malformed', retryable: true });
  });

  it.each([
    ['not an object', 'hello'],
    ['no plan', { meta: { planner: 'model' } }],
    ['no meta', { plan: { title: 't', steps: [{ minutes: 1, text: 'x' }], notice: 'n' } }],
    ['empty steps', { plan: { title: 't', steps: [], notice: 'n' }, meta: { planner: 'model' } }],
    ['step without text', { plan: { title: 't', steps: [{ minutes: 5 }], notice: 'n' }, meta: { planner: 'model' } }],
    ['blank title', { plan: { title: '  ', steps: [{ minutes: 5, text: 'x' }], notice: 'n' }, meta: { planner: 'model' } }],
    ['unknown planner', { plan: { title: 't', steps: [{ minutes: 5, text: 'x' }], notice: 'n' }, meta: { planner: 'magic' } }],
  ])('rejects a 200 body that is %s', async (_label, body) => {
    const err = await failure(make((async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch).planWalk(request));
    expect(err.kind).toBe('malformed');
  });

  it('tolerates missing or odd context by showing less, not failing', async () => {
    const body = { plan: { title: 't', steps: [{ minutes: 5, text: 'x' }], notice: 'n' }, meta: { planner: 'model', context: { weather: 'banana', conditions: { condition: 'lava', temperatureC: 5 } } } };
    const r = await make((async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch).planWalk(request);
    expect(r.meta.context.conditions).toBeUndefined();
    expect(r.meta.context.weather).toBe('not_requested');
  });
});

describe('walkApi timeout and cancellation', () => {
  const hanging = ((_u: string, init: RequestInit) =>
    new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;

  it('gives up after the timeout with kind timeout', async () => {
    const err = await failure(make(hanging, { timeoutMs: 30 }).planWalk(request));
    expect(err).toMatchObject({ kind: 'timeout', retryable: true });
  });

  it('reports aborted (not retryable) when the caller cancels', async () => {
    const ctrl = new AbortController();
    const p = make(hanging).planWalk(request, { signal: ctrl.signal });
    ctrl.abort();
    expect(await failure(p)).toMatchObject({ kind: 'aborted', retryable: false });
  });
});
