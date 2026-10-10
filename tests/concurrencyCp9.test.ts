import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { GemmaPlanner } from '../src/ai/gemmaPlanner';
import type { WalkPlanner } from '../src/ai/walkPlanner';
import { ContextBuilder } from '../src/context/contextBuilder';
import { ConcurrencyGate } from '../src/middleware/concurrencyGate';
import { FakeModelClient, validPlanJson } from './helpers/fakeModel';
import { FakeWeatherProvider } from './helpers/fakeWeather';
import { deferred, listen, post } from './helpers/liveServer';

/**
 * CP9: the in-process cap on simultaneous plans. "Held" requests wait on promises the test controls; nothing sleeps.
 * Leak checks are black-box: after every way a request can end, a full set of `max` requests must still be admitted.
 */
const body = { minutes: 20, energy: 'normal' };
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((c) => c())); });

/** A model whose calls the test releases one by one. */
function heldModel() {
  const waiting: ReturnType<typeof deferred<{ text: string }>>[] = [];
  const signals: AbortSignal[] = [];
  const client = new FakeModelClient((_p, signal) => {
    const d = deferred<{ text: string }>();
    waiting.push(d);
    signals.push(signal);
    return d.promise;
  });
  return { client, waiting, signals, answerAll: () => waiting.forEach((d) => d.resolve({ text: validPlanJson(20) })) };
}

async function serve(opts: { max: number; client: FakeModelClient; deadlineMs?: number; fallbackThrows?: boolean; timeoutMs?: number }) {
  const app = createApp({
    quiet: true, nodeEnv: 'production',
    planner: new GemmaPlanner({ client: opts.client, timeoutMs: opts.timeoutMs ?? 5000 }),
    ...(opts.fallbackThrows ? { fallbackPlanner: { kind: 'fallback', plan: async () => { throw new Error('fallback bug'); } } as WalkPlanner } : {}),
    maxConcurrentPlans: opts.max,
    ...(opts.deadlineMs ? { requestDeadlineMs: opts.deadlineMs } : {}),
  });
  const live = await listen(app);
  closers.push(live.close);
  return live;
}

/** After whatever just happened, `max` requests must all be admitted at once: proof that no slot leaked. */
async function expectFullCapacity(url: string, max: number, model: ReturnType<typeof heldModel>) {
  const before = model.waiting.length;
  const calls = Array.from({ length: max }, () => post(url, body));
  await vi_waitFor(() => model.waiting.length === before + max);
  const extra = await post(url, body);
  expect(extra.status).toBe(503); // exactly `max` admitted, and the next is refused
  model.answerAll();
  for (const r of await Promise.all(calls)) expect(r.status).toBe(200);
}
async function vi_waitFor(cond: () => boolean) {
  const { vi } = await import('vitest');
  await vi.waitFor(() => { if (!cond()) throw new Error('not yet'); }, { timeout: 4000, interval: 5 });
}

describe('ConcurrencyGate', () => {
  it('admits up to max, refuses beyond, and a release frees exactly one slot', () => {
    const g = new ConcurrencyGate(2);
    const a = g.tryAcquire(); const b = g.tryAcquire();
    expect(a && b).toBeTruthy();
    expect(g.tryAcquire()).toBeNull();
    expect(g.inFlight).toBe(2);
    a!();
    expect(g.inFlight).toBe(1);
    expect(g.tryAcquire()).not.toBeNull();
  });
  it('releasing twice cannot free a slot that belongs to someone else', () => {
    const g = new ConcurrencyGate(1);
    const a = g.tryAcquire()!;
    a(); a(); a();
    expect(g.inFlight).toBe(0);
    const b = g.tryAcquire();
    expect(b).not.toBeNull();
    expect(g.tryAcquire()).toBeNull(); // the extra release() calls did not mint capacity
  });
});

describe('concurrent walk plans', () => {
  it('simultaneous requests respect the cap; the excess gets a fast 503 in the standard shape, never queued', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 2, client: m.client });
    const first = post(url, body); const second = post(url, body);
    await vi_waitFor(() => m.waiting.length === 2);
    const t = performance.now();
    const refused = await post(url, body);
    expect(performance.now() - t).toBeLessThan(1000); // answered at once, not after the others
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: 'PocketWalk is busy right now. Please try again in a moment.' });
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(m.waiting).toHaveLength(2); // the refused request never reached the model
    m.answerAll();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it('invalid requests do not consume capacity (validation happens before the slot is taken)', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 1, client: m.client });
    const held = post(url, body);
    await vi_waitFor(() => m.waiting.length === 1);
    const bad = await post(url, { minutes: 7 });
    expect(bad.status).toBe(400); // not 503
    m.answerAll();
    expect((await held).status).toBe(200);
  });

  it('capacity is released after SUCCESS', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 2, client: m.client });
    const done = [post(url, body), post(url, body)];
    await vi_waitFor(() => m.waiting.length === 2);
    m.answerAll();
    for (const r of await Promise.all(done)) expect(r.status).toBe(200);
    await expectFullCapacity(url, 2, m);
  });

  it('capacity is released after a model FAILURE (safe fallback served)', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 2, client: m.client });
    const calls = [post(url, body), post(url, body)];
    await vi_waitFor(() => m.waiting.length === 2);
    m.waiting.forEach((d) => d.reject(new Error('provider blew up')));
    for (const r of await Promise.all(calls)) { expect(r.status).toBe(200); expect(((await r.json()) as any).meta.planner).toBe('fallback'); }
    await expectFullCapacity(url, 2, m);
  });

  it('capacity is released after a model TIMEOUT', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 1, client: m.client, timeoutMs: 40 });
    const r = await post(url, body); // the held model never answers: the 40 ms budget fires
    expect(((await r.json()) as any).meta.fallbackReason).toBe('timeout');
    await expectFullCapacity(url, 1, m);
  });

  it('capacity is released after an UNEXPECTED 500 (fallback itself throws)', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 1, client: m.client, fallbackThrows: true, timeoutMs: 30 });
    const r = await post(url, body);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: 'Internal server error' });
    // A leaked slot would make this 503. With the slot back, the request is admitted (and 500s again, which is fine here).
    const again = await post(url, body);
    expect(again.status).toBe(500);
  });

  it('capacity is released after a CLIENT DISCONNECT', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 2, client: m.client });
    const aborts = [new AbortController(), new AbortController()];
    const calls = aborts.map((a) => post(url, body, a.signal).catch((e: unknown) => e));
    await vi_waitFor(() => m.waiting.length === 2);
    aborts.forEach((a) => a.abort());
    await Promise.all(calls);
    await vi_waitFor(() => m.signals.every((s) => s.aborted)); // the abandoned model calls were cancelled
    await expectFullCapacity(url, 2, m);
  });

  it('capacity is released when the REQUEST DEADLINE ends the request', async () => {
    const stuck: WalkPlanner = { kind: 'model', provider: 'x', model: 'y', plan: () => new Promise(() => undefined) };
    const app = createApp({ quiet: true, nodeEnv: 'production', planner: stuck, maxConcurrentPlans: 1, requestDeadlineMs: 120 });
    const live = await listen(app); closers.push(live.close);
    expect((await post(live.url, body)).status).toBe(200); // deadline fallback
    expect((await post(live.url, body)).status).toBe(200); // slot was returned: not a 503
  });

  it('a burst of 10 against a cap of 3 admits exactly 3 and refuses 7', async () => {
    const m = heldModel();
    const { url } = await serve({ max: 3, client: m.client });
    const statuses: number[] = [];
    const calls = Array.from({ length: 10 }, () => post(url, body).then((r) => { statuses.push(r.status); return r; }));
    // Release the held three only AFTER all seven refusals have arrived, otherwise freed capacity would admit late arrivals.
    await vi_waitFor(() => m.waiting.length === 3 && statuses.filter((s) => s === 503).length === 7);
    m.answerAll();
    await Promise.all(calls);
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 503)).toHaveLength(7);
  });

  it('weather held up + cap: the cap counts the whole request, not only the model call', async () => {
    const hold = deferred<never>();
    const inWeather = deferred();
    const weather = new FakeWeatherProvider(() => { inWeather.resolve(); return hold.promise as never; });
    const m = heldModel();
    const app = createApp({
      quiet: true, nodeEnv: 'production', planner: new GemmaPlanner({ client: m.client, timeoutMs: 5000 }),
      contextBuilder: new ContextBuilder({ weather, weatherTimeoutMs: 3000 }), maxConcurrentPlans: 1,
    });
    const live = await listen(app); closers.push(live.close);
    const held = post(live.url, { ...body, location: { city: 'Oslo' } }); // stuck in weather, model not yet called
    await inWeather.promise; // the request is now inside the weather lookup
    expect(m.waiting).toHaveLength(0);
    expect((await post(live.url, body)).status).toBe(503);
    hold.reject(new Error('weather gave up'));
    await vi_waitFor(() => m.waiting.length === 1);
    m.answerAll();
    expect((await held).status).toBe(200);
  });
});
