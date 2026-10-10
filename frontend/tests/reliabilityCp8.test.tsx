import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/apiError';
import { parseWalkResult } from '../src/api/parseWalkResult';
import { createWalkApi, type WalkApi } from '../src/api/walkApi';
import { App } from '../src/app/App';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { useWalkFlow } from '../src/hooks/useWalkFlow';
import type { WalkResult } from '../src/types/walk';
import { fixture, responseFrom } from './fixtures';

/**
 * CP8 frontend reliability. These drive the REAL API client (createWalkApi) with a scripted fetch, so they cover
 * the whole path from "the network misbehaved" to "what the person sees".
 */
const okBody = fixture('model-plan-weather').body;
const aiResult = parseWalkResult(okBody);
const otherResult: WalkResult = { ...aiResult, plan: { ...aiResult.plan, title: 'A different walk entirely' } };
const ok = () => responseFrom({ status: 200, body: okBody });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}
const toConfigure = (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByRole('button', { name: 'Start a walk' }));
const plan = (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByRole('button', { name: 'Plan my walk' }));
const NO_TECH = /HTTP|\b[45]\d\d\b|stack|zod|http:\/\/|localhost|ApiError|sentry|trace|latency|gemma|provider|fetch failed|TypeError/i;

describe('11/12. the real API client + App: failures recover', () => {
  it('11. network failure -> friendly error -> Try again -> a valid plan', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      if (++calls === 1) throw new TypeError('fetch failed: ECONNREFUSED 127.0.0.1:3000');
      return ok();
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<App api={createWalkApi({ baseUrl: '', timeoutMs: 5000, fetchImpl })} />);
    await toConfigure(user);
    await plan(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/can.t be reached/i);
    expect(document.body.textContent).not.toMatch(NO_TECH);
    expect(screen.queryByRole('heading', { name: aiResult.plan.title })).not.toBeInTheDocument(); // no fake plan
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: aiResult.plan.title });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('12. a request that never answers hits the client timeout -> friendly error -> Try again works; loading never sticks', async () => {
    let calls = 0;
    const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => {
      if (++calls > 1) return Promise.resolve(ok());
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<App api={createWalkApi({ baseUrl: '', timeoutMs: 60, fetchImpl })} />);
    await toConfigure(user);
    await plan(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/longer than expected/i);
    expect(screen.queryByText(/preparing|generating/i)).not.toBeInTheDocument(); // not stuck on the loading screen
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: aiResult.plan.title });
  });

  it('HTTP 429 -> "busy" copy, retryable, no status code or server text shown', async () => {
    let calls = 0;
    const fetchImpl = (async () => (++calls === 1 ? new Response('{"error":"RATE-LIMIT-DETAIL"}', { status: 429 }) : ok())) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<App api={createWalkApi({ baseUrl: '', timeoutMs: 5000, fetchImpl })} />);
    await toConfigure(user);
    await plan(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/busy right now/i);
    expect(document.body.textContent).not.toMatch(/429|RATE-LIMIT-DETAIL/);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: aiResult.plan.title });
  });

  it.each([
    ['HTTP 500 with a stack trace in the body', new Response('{"error":"Internal server error","stack":"at /srv/app.ts:1"}', { status: 500 })],
    ['200 with garbage', new Response('<<<not json>>>', { status: 200 })],
    ['200 with the wrong shape', new Response('{"hello":"world"}', { status: 200 })],
    ['200 with a plan but no steps', new Response(JSON.stringify({ plan: { title: 'T', steps: [], notice: 'n' }, meta: { planner: 'model' } }), { status: 200 })],
    ['200 null', new Response('null', { status: 200 })],
  ])('%s -> error screen, never a fake plan, no technical text', async (_n, response) => {
    const fetchImpl = (async () => response) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<App api={createWalkApi({ baseUrl: '', timeoutMs: 5000, fetchImpl })} />);
    await toConfigure(user);
    await plan(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t prepare your walk/i);
    expect(screen.queryByRole('button', { name: /i.m ready/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(NO_TECH);
  });

  it('the backend fallback response (a normal 200) is shown as a normal plan, with no failure language', async () => {
    const fetchImpl = (async () => responseFrom(fixture('fallback-model-unavailable'))) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<App api={createWalkApi({ baseUrl: '', timeoutMs: 5000, fetchImpl })} />);
    await toConfigure(user);
    await plan(user);
    await screen.findByRole('button', { name: /i.m ready/i });
    expect(document.body.textContent).not.toMatch(/fallback|unavailable|failed|error|AI planner|deterministic/i);
  });
});

describe('13/14. duplicate work and stale responses', () => {
  it('13. rapid repeated activation and a double-click make exactly one request', async () => {
    const d = deferred<WalkResult>();
    const api: WalkApi = { planWalk: vi.fn(() => d.promise) };
    const user = userEvent.setup();
    render(<App api={api} />);
    await toConfigure(user);
    const button = screen.getByRole('button', { name: 'Plan my walk' });
    await user.dblClick(button);
    await user.tripleClick(button).catch(() => undefined); // the button may already be gone: that is the point
    button.focus?.();
    await user.keyboard('{Enter}{Enter}').catch(() => undefined);
    expect(api.planWalk).toHaveBeenCalledTimes(1);
    d.resolve(aiResult);
    await screen.findByRole('button', { name: /i.m ready/i });
    expect(api.planWalk).toHaveBeenCalledTimes(1);
  });

  it('13b. two submits in the SAME tick (before React can re-render) still start exactly one request', async () => {
    const d = deferred<WalkResult>();
    const api: WalkApi = { planWalk: vi.fn(() => d.promise) };
    const { result } = renderHook(() => useWalkFlow(api));
    act(() => result.current.start());
    act(() => {
      result.current.submit({ minutes: 20, energy: 'normal' });
      result.current.submit({ minutes: 20, energy: 'normal' });
      result.current.submit({ minutes: 40, energy: 'easy' });
    });
    expect(api.planWalk).toHaveBeenCalledTimes(1);
    expect(api.planWalk).toHaveBeenCalledWith({ minutes: 20, energy: 'normal' }, expect.anything());
    await act(async () => { d.resolve(aiResult); });
    expect(result.current.state.name).toBe('PLAN_READY');
  });

  it('14. cancel -> submit again: the FIRST request answering late cannot overwrite the second request', { timeout: 15000 }, async () => {
    const first = deferred<WalkResult>();
    const second = deferred<WalkResult>();
    const queue = [first, second];
    const signals: (AbortSignal | undefined)[] = [];
    const api: WalkApi = { planWalk: vi.fn((_r, o) => { signals.push(o?.signal); return queue.shift()!.promise; }) };
    const user = userEvent.setup();
    render(<App api={api} />);
    await toConfigure(user);
    await plan(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 3000 }));
    expect(signals[0]?.aborted).toBe(true);
    await plan(user); // a newer submission
    expect(api.planWalk).toHaveBeenCalledTimes(2);
    first.resolve(aiResult); // stale answer from the abandoned request
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('heading', { name: aiResult.plan.title })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /i.m ready/i })).not.toBeInTheDocument(); // still waiting for the second
    second.resolve(otherResult);
    await screen.findByRole('heading', { level: 1, name: 'A different walk entirely' });
  });

  it('a stale FAILURE from an abandoned request does not replace the newer state either', { timeout: 15000 }, async () => {
    const first = deferred<WalkResult>();
    const second = deferred<WalkResult>();
    const queue = [first, second];
    const api: WalkApi = { planWalk: vi.fn(() => queue.shift()!.promise) };
    const user = userEvent.setup();
    render(<App api={api} />);
    await toConfigure(user);
    await plan(user);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 3000 }));
    await plan(user);
    first.reject(new ApiError('server', 500));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    second.resolve(aiResult);
    await screen.findByRole('heading', { level: 1, name: aiResult.plan.title });
  });

  it('leaving the app mid-request (unmount) aborts it, and a late answer causes no error', async () => {
    const d = deferred<WalkResult>();
    let signal: AbortSignal | undefined;
    const api: WalkApi = { planWalk: vi.fn((_r, o) => { signal = o?.signal; return d.promise; }) };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const { unmount } = render(<App api={api} />);
    await toConfigure(user);
    await plan(user);
    unmount();
    expect(signal?.aborted).toBe(true);
    d.resolve(aiResult);
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('unexpected React rendering error', () => {
  it('shows fixed copy with a Reload button, never the error text, instead of a blank page', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Bomb = () => { throw new Error('RENDER-SECRET city=Oslo key=AIza-FAKE'); };
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/RENDER-SECRET|Oslo|AIza/);
    errors.mockRestore();
  });
});

describe('response validation (malformed bodies never become a plan)', () => {
  const valid = JSON.parse(JSON.stringify(okBody)) as { plan: Record<string, unknown>; meta: Record<string, unknown> };
  const mutate = (fn: (b: typeof valid) => unknown) => { const c = JSON.parse(JSON.stringify(valid)); return fn(c) ?? c; };
  it.each([
    ['not an object', () => 'text'],
    ['array', () => []],
    ['no plan', (b: typeof valid) => { delete (b as Partial<typeof valid>).plan; }],
    ['no meta', (b: typeof valid) => { delete (b as Partial<typeof valid>).meta; }],
    ['title number', (b: typeof valid) => { b.plan.title = 5; }],
    ['empty title', (b: typeof valid) => { b.plan.title = '  '; }],
    ['notice missing', (b: typeof valid) => { delete b.plan.notice; }],
    ['steps not an array', (b: typeof valid) => { b.plan.steps = 'x'; }],
    ['step text missing', (b: typeof valid) => { (b.plan.steps as Record<string, unknown>[])[0] = { minutes: 3 }; }],
    ['step minutes NaN-like', (b: typeof valid) => { (b.plan.steps as Record<string, unknown>[])[0] = { minutes: 'x', text: 'Walk' }; }],
    ['step minutes negative', (b: typeof valid) => { (b.plan.steps as Record<string, unknown>[])[0] = { minutes: -1, text: 'Walk' }; }],
    ['unknown planner', (b: typeof valid) => { b.meta.planner = 'robot'; }],
  ])('%s -> ApiError(malformed)', (_n, fn) => {
    expect(() => parseWalkResult(mutate(fn as never))).toThrow(ApiError);
    try { parseWalkResult(mutate(fn as never)); } catch (e) { expect((e as ApiError).kind).toBe('malformed'); }
  });
  it('a valid body still parses (control)', () => {
    expect(parseWalkResult(valid).plan.title).toBe(aiResult.plan.title);
  });
});

describe('API client error mapping for the remaining statuses', () => {
  const kindFor = async (status: number) => {
    const fetchImpl = (async () => new Response('{"error":"SERVER-TEXT"}', { status })) as unknown as typeof fetch;
    try { await createWalkApi({ baseUrl: '', timeoutMs: 1000, fetchImpl }).planWalk({ minutes: 10, energy: 'normal' }); } catch (e) { return e as ApiError; }
    throw new Error('expected rejection');
  };
  it.each([[400, 'invalid_request', false], [404, 'not_found', true], [413, 'client', true], [429, 'busy', true], [500, 'server', true], [502, 'server', true], [503, 'busy', true]])('HTTP %i -> %s (retryable: %s), server text not kept', async (status, kind, retryable) => {
    const e = await kindFor(status as number);
    expect(e.kind).toBe(kind);
    expect(e.retryable).toBe(retryable);
    expect(e.message).not.toContain('SERVER-TEXT');
  });
});
