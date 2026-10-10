import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { FallbackPlanner } from '../src/ai/fallbackPlanner';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import { validateDomainPlan } from '../src/ai/validationPipeline';
import type { WalkPlanner } from '../src/ai/walkPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { MIN_MODEL_BUDGET_MS, RESPONSE_RESERVE_MS, RequestAbandonedError, RequestScope } from '../src/services/requestScope';
import { defaultSafetyEngine } from '../src/safety/engine';
import { WalkService } from '../src/services/walkService';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';
import { FakeWeatherProvider } from './helpers/fakeWeather';
import { ctx } from './helpers/plans';
import { deferred, listen, post } from './helpers/liveServer';

const req = { minutes: 20 as const, energy: 'normal' as const, location: { city: 'Oslo' } };
/** Real-server deadline tests use a short deadline, so they also shrink the reserve and minimum (production: 1500 / 2000 ms). */
const SMALL = { responseReserveMs: 30, minModelBudgetMs: 20 };
const noLoc = { minutes: 20 as const, energy: 'normal' as const };

describe('RequestScope', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('counts down, resolves `deadline` on time, and aborts the signal with reason "deadline"', async () => {
    const s = new RequestScope({ deadlineMs: 1000 });
    expect(s.remainingMs()).toBe(1000);
    await vi.advanceTimersByTimeAsync(400);
    expect(s.remainingMs()).toBe(600);
    expect(s.signal.aborted).toBe(false);
    let fired = false; void s.deadline.then(() => { fired = true; });
    await vi.advanceTimersByTimeAsync(599);
    expect(fired).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toBe(true);
    expect(s.signal.aborted).toBe(true);
    expect(s.reason).toBe('deadline');
    expect(s.remainingMs()).toBe(0);
  });
  it('the first abort reason wins', () => {
    const s = new RequestScope({ deadlineMs: 1000 });
    s.abort('disconnect'); s.abort('deadline');
    expect(s.reason).toBe('disconnect');
    expect(() => s.throwIfAbandoned()).toThrow(RequestAbandonedError);
    s.dispose();
  });
  it('a deadline-abort does NOT count as abandoned (a safe answer can still be given)', async () => {
    const s = new RequestScope({ deadlineMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(() => s.throwIfAbandoned()).not.toThrow();
  });
  it('dispose clears the timer, and is safe to repeat: no timers leak', () => {
    const s = new RequestScope({ deadlineMs: 5000 });
    expect(vi.getTimerCount()).toBe(1);
    s.dispose(); s.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('budgets inside one request (fake clock)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const svc = (client: FakeModelClient, builder: ContextBuilder, modelTimeoutMs = 60_000) =>
    new WalkService(new GemmaPlanner({ client, timeoutMs: modelTimeoutMs }), new FallbackPlanner(), builder);
  const valid = async (r: Awaited<ReturnType<WalkService['planWalk']>>) =>
    expect((await validateDomainPlan(r.plan, ctx({ minutes: 20 }), defaultSafetyEngine)).ok).toBe(true);

  it('a request that finishes inside its budget succeeds as a model walk', async () => {
    const scope = new RequestScope({ deadlineMs: 25_000 });
    const r = await svc(FakeModelClient.replying(validPlanJson(20)), new ContextBuilder({ weather: FakeWeatherProvider.observing() })).planWalk(req, scope);
    expect(r.meta.planner).toBe('model');
    scope.dispose();
  });

  it('a slow MODEL is bounded by the REMAINING budget, not its own (longer) configured timeout, leaving the reserve', async () => {
    const scope = new RequestScope({ deadlineMs: 25_000 });
    let done = false;
    const p = svc(FakeModelClient.hanging(), new ContextBuilder(), 60_000).planWalk(noLoc, scope).then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(25_000 - RESPONSE_RESERVE_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await p;
    expect(r.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout' });
    expect(scope.remainingMs()).toBe(RESPONSE_RESERVE_MS); // the reserve is still there for the response
    await valid(r);
    scope.dispose();
  });

  it('a slow CONTEXT provider is bounded so the model still gets its minimum', async () => {
    const scope = new RequestScope({ deadlineMs: 25_000 });
    const builder = new ContextBuilder({ weather: FakeWeatherProvider.hanging(), weatherTimeoutMs: 60_000 });
    const client = FakeModelClient.replying(validPlanJson(20));
    const p = svc(client, builder).planWalk(req, scope);
    await vi.advanceTimersByTimeAsync(25_000 - RESPONSE_RESERVE_MS - MIN_MODEL_BUDGET_MS); // weather cap
    const r = await p;
    expect(r.meta.context).toMatchObject({ weather: 'unavailable', weatherFailure: 'timeout' });
    expect(r.meta.planner).toBe('model'); // the model still ran with what was left
    expect(client.prompts).toHaveLength(1);
    scope.dispose();
  });

  it('the fallback gets what the model did not use: total virtual time is deadline minus the reserve, then fallback runs instantly', async () => {
    const scope = new RequestScope({ deadlineMs: 25_000 });
    const builder = new ContextBuilder({ weather: FakeWeatherProvider.hanging(), weatherTimeoutMs: 60_000 });
    const p = svc(FakeModelClient.hanging(), builder).planWalk(req, scope);
    await vi.advanceTimersByTimeAsync(25_000 - RESPONSE_RESERVE_MS - MIN_MODEL_BUDGET_MS); // weather gives up
    await vi.advanceTimersByTimeAsync(MIN_MODEL_BUDGET_MS); // model gives up at the cap
    const r = await p;
    expect(r.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout', context: { weatherFailure: 'timeout' } });
    expect(scope.remainingMs()).toBe(RESPONSE_RESERVE_MS);
    await valid(r);
    scope.dispose();
  });

  it('too little time for the model: it is NOT called, the fallback is served at once', async () => {
    const scope = new RequestScope({ deadlineMs: 3_000 }); // 3000 - 1500 reserve < 2000 minimum
    const client = FakeModelClient.replying(validPlanJson(20));
    const weather = FakeWeatherProvider.observing();
    const r = await svc(client, new ContextBuilder({ weather })).planWalk(req, scope);
    expect(client.prompts).toHaveLength(0);
    expect(r.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout' });
    expect(r.meta.context.weatherFailure).toBe('timeout'); // no time for a lookup either: honestly reported, nothing invented
    await valid(r);
    scope.dispose();
  });

  it('an already-aborted request starts no provider call at all', async () => {
    const scope = new RequestScope({ deadlineMs: 25_000 });
    scope.abort('disconnect');
    const client = FakeModelClient.replying(validPlanJson(20));
    await expect(svc(client, new ContextBuilder({ weather: FakeWeatherProvider.observing() })).planWalk(req, scope)).rejects.toBeInstanceOf(RequestAbandonedError);
    expect(client.prompts).toHaveLength(0);
    scope.dispose();
  });

  it('timers and abort listeners are cleaned up after a normal request', async () => {
    const scope = new RequestScope({ deadlineMs: 25_000 });
    await svc(FakeModelClient.replying(validPlanJson(20)), new ContextBuilder({ weather: FakeWeatherProvider.observing() })).planWalk(req, scope);
    scope.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('planFallbackNow builds a safe labelled walk without calling any provider', async () => {
    const client = FakeModelClient.replying(validPlanJson(20));
    const weather = FakeWeatherProvider.observing();
    const r = await svc(client, new ContextBuilder({ weather })).planFallbackNow(req);
    expect(client.prompts).toHaveLength(0);
    expect(r.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout', context: { weather: 'unavailable', weatherFailure: 'timeout' } });
    await valid(r);
  });
});

describe('the HTTP request deadline (real server, small real deadline)', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => unhandled.push(e);
  beforeEach(() => { unhandled.length = 0; process.on('unhandledRejection', onUnhandled); });
  afterEach(() => { process.off('unhandledRejection', onUnhandled); });

  /** A planner that ignores every budget and signal, as a buggy or uncancellable provider would. */
  function stuckPlanner() {
    const seen: { signal?: AbortSignal; timeoutMs?: number } = {};
    const gate = deferred<never>();
    const planner: WalkPlanner = { kind: 'model', provider: 'x', model: 'y', plan: (_c, o) => { Object.assign(seen, o); return gate.promise; } };
    return { planner, seen, gate };
  }

  it('a request that exceeds its deadline gets ONE safe fallback response, labelled, and the provider signal is aborted', async () => {
    const { planner, seen } = stuckPlanner();
    const live = await listen(createApp({ quiet: true, nodeEnv: 'production', planner, requestDeadlineMs: 150, budgets: SMALL }));
    closers.push(live.close);
    const t = performance.now();
    const res = await post(live.url, noLoc);
    const elapsed = performance.now() - t;
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.meta).toMatchObject({ planner: 'fallback', fallbackReason: 'timeout' });
    expect(json.plan.steps.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1500);
    expect(seen.signal?.aborted).toBe(true);
  });

  it('late resolution cannot change the response, send a second one, or cause an unhandled rejection', async () => {
    const { planner, gate } = stuckPlanner();
    const live = await listen(createApp({ quiet: true, nodeEnv: 'production', planner, requestDeadlineMs: 120, budgets: SMALL }));
    closers.push(live.close);
    const res = await post(live.url, noLoc);
    const first = await res.text();
    gate.reject(new Error('too late')); // the stuck call finally fails, after the response was sent
    await new Promise((r) => setTimeout(r, 50));
    expect(res.status).toBe(200);
    expect((JSON.parse(first) as any).meta.planner).toBe('fallback');
    expect(unhandled).toEqual([]);
    expect((await post(live.url, noLoc)).status).toBe(200); // server healthy
  });

  it('late SUCCESS from the stuck provider is also ignored', async () => {
    const { planner, gate } = stuckPlanner();
    const live = await listen(createApp({ quiet: true, nodeEnv: 'production', planner, requestDeadlineMs: 120, budgets: SMALL }));
    closers.push(live.close);
    const res = await post(live.url, noLoc);
    const body = (await res.json()) as unknown;
    gate.resolve({ plan: { title: 'LATE MODEL PLAN', steps: [], notice: '' } } as never);
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.stringify(body)).not.toContain('LATE MODEL PLAN');
  });

  it('deadline reached AND the safe fallback cannot be built -> controlled 504, never a fake plan', async () => {
    const { planner } = stuckPlanner();
    const broken: WalkPlanner = { kind: 'fallback', plan: async () => { throw new Error('fallback bug'); } };
    const live = await listen(createApp({ quiet: true, nodeEnv: 'production', planner, fallbackPlanner: broken, requestDeadlineMs: 100, budgets: SMALL }));
    closers.push(live.close);
    const res = await post(live.url, noLoc);
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'This took longer than expected. Please try again.' });
  });

  it('a normal fast request is untouched by the deadline machinery', async () => {
    const live = await listen(createApp({
      quiet: true, nodeEnv: 'production', requestDeadlineMs: 5000, budgets: SMALL,
      planner: new GemmaPlanner({ client: FakeModelClient.replying(validPlanJson(20)), timeoutMs: 3000 }),
    }));
    closers.push(live.close);
    const res = await post(live.url, noLoc);
    expect(((await res.json()) as any).meta.planner).toBe('model');
  });
});

describe('client disconnect (real sockets)', () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });

  it('abandoning a request cancels the in-flight model call', async () => {
    const started = deferred();
    let signal: AbortSignal | undefined;
    const client = new FakeModelClient((_p, s) => { signal = s; started.resolve(); return new Promise(() => undefined); });
    const live = await listen(createApp({ quiet: true, nodeEnv: 'production', planner: new GemmaPlanner({ client, timeoutMs: 20_000 }), requestDeadlineMs: 25_000 }));
    closers.push(live.close);
    const abort = new AbortController();
    const call = post(live.url, noLoc, abort.signal).catch((e: unknown) => e);
    await started.promise;
    expect(signal?.aborted).toBe(false);
    abort.abort();
    await call;
    await vi.waitFor(() => expect(signal?.aborted).toBe(true), { timeout: 3000, interval: 5 });
  });

  it('no NEW work starts after the client left: the model is never called if the client disconnects during weather', async () => {
    const inWeather = deferred();
    let weatherSignal: AbortSignal | undefined;
    const weather = new FakeWeatherProvider((_c, sig) => { weatherSignal = sig; inWeather.resolve(); return new Promise(() => undefined); });
    const client = FakeModelClient.replying(validPlanJson(20));
    const live = await listen(createApp({
      quiet: true, nodeEnv: 'production',
      planner: new GemmaPlanner({ client, timeoutMs: 5000 }),
      contextBuilder: new ContextBuilder({ weather, weatherTimeoutMs: 20_000 }),
      requestDeadlineMs: 25_000,
    }));
    closers.push(live.close);
    const abort = new AbortController();
    const call = post(live.url, req, abort.signal).catch((e: unknown) => e);
    await inWeather.promise;
    abort.abort();
    await call;
    await vi.waitFor(() => expect(weatherSignal?.aborted).toBe(true), { timeout: 3000, interval: 5 });
    await new Promise((r) => setTimeout(r, 40)); // give a (wrong) model call every chance to happen
    expect(client.prompts).toHaveLength(0);
  });

  it('a response is never written to a closed connection (no error, server stays healthy)', async () => {
    const started = deferred();
    const release = deferred<{ text: string }>();
    const client = new FakeModelClient(() => { started.resolve(); return release.promise; });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
    const live = await listen(createApp({ quiet: true, nodeEnv: 'production', planner: new GemmaPlanner({ client, timeoutMs: 20_000 }) }));
    closers.push(live.close);
    const abort = new AbortController();
    const call = post(live.url, noLoc, abort.signal).catch((e: unknown) => e);
    await started.promise;
    abort.abort(); await call;
    release.resolve({ text: validPlanJson(20) }); // the provider answers after the client is gone
    await new Promise((r) => setTimeout(r, 40));
    expect(errors).toEqual([]);
    expect((await fetch(`${live.url}/health`)).status).toBe(200);
    spy.mockRestore();
  });
});
