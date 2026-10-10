import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { walkApi, createWalkApi } from '../src/api/walkApi';
import { App } from '../src/app/App';
import { fixture, responseFrom } from './fixtures';

/** CP9 frontend production configuration: same-origin by default, and a client timeout that outlasts the server's deadline. */

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('production API addressing', () => {
  it('with no VITE_API_BASE_URL the app calls a RELATIVE path (same origin as the page), never a hard-coded host', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return responseFrom(fixture('model-plan-weather')); }));
    await walkApi.planWalk({ minutes: 20, energy: 'normal' });
    expect(calls).toEqual(['/walks/plan']);
    expect(calls[0]).not.toMatch(/localhost|127\.0\.0\.1|^https?:/);
  });

  it('an explicit VITE_API_BASE_URL (separate hosting) is joined without a double slash', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => { calls.push(String(url)); return responseFrom(fixture('model-plan-weather')); }) as unknown as typeof fetch;
    await createWalkApi({ baseUrl: 'https://api.example.test/', timeoutMs: 5000, fetchImpl }).planWalk({ minutes: 20, energy: 'normal' });
    expect(calls).toEqual(['https://api.example.test/walks/plan']);
  });

  it('the default client timeout is 30 s: longer than the backend deadline (25 s), so the server answers first', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))));
    let settled = false;
    const p = walkApi.planWalk({ minutes: 20, energy: 'normal' }).catch((e: { kind: string }) => { settled = true; return e.kind; });
    await vi.advanceTimersByTimeAsync(25_000 + 1000); // past the server's default deadline
    expect(settled).toBe(false); // the browser is still waiting for the server's answer
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await p).toBe('timeout');
  });
});

describe('503 from the service shows the busy copy', () => {
  it('HTTP 503 -> "busy" message, no status or server text, and Try again then works', async () => {
    let calls = 0;
    const fetchImpl = (async () => (++calls === 1 ? new Response('{"error":"PocketWalk is busy right now. Please try again in a moment."}', { status: 503, headers: { 'retry-after': '2' } }) : responseFrom(fixture('model-plan-weather')))) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<App api={createWalkApi({ baseUrl: '', timeoutMs: 5000, fetchImpl })} />);
    await user.click(screen.getByRole('button', { name: 'Start a walk' }));
    await user.click(screen.getByRole('button', { name: 'Plan my walk' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/busy right now/i);
    expect(document.body.textContent).not.toMatch(/503|retry-after/i);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: /i.m ready/i });
  });
});
