import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WalkApi } from '../src/api/walkApi';
import { App } from '../src/app/App';
import type { Clock } from '../src/time/clock';
import type { WalkResult } from '../src/types/walk';
import { parseWalkResult } from '../src/api/parseWalkResult';
import { fixture } from './fixtures';

// Testing Library only advances fake timers inside its async helpers when it sees a `jest` global.
// Under Vitest that detection fails and every await user.click() waits on a frozen setTimeout, so
// expose the one method it calls. Scoped to this file; removed in afterAll.
beforeAll(() => {
  (globalThis as unknown as { jest: unknown }).jest = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };
});
afterAll(() => {
  delete (globalThis as unknown as { jest?: unknown }).jest;
});

// 20 minute walk: 8 + 4 + 8, matching the default 20 min request.
const base = parseWalkResult(fixture('model-plan-weather').body);
const result: WalkResult = {
  ...base,
  plan: {
    title: 'Slow loop, listening walk',
    steps: [
      { minutes: 8, text: 'Walk out slowly along the nearest footpath.' },
      { minutes: 4, text: 'Stop and listen for distant birds.' },
      { minutes: 8, text: 'Return the way you came, unhurried.' },
    ],
    notice: 'Notice how many shades of green you can find.',
  },
};

const T0 = new Date('2026-10-08T10:00:00Z').getTime();
const clock: Clock = { now: () => Date.now() };
const MIN = 60_000;

let user: ReturnType<typeof userEvent.setup>;
let planWalk: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  planWalk = vi.fn(async () => result);
  render(<App api={{ planWalk } as unknown as WalkApi} clock={clock} />);
});
afterEach(() => {
  vi.useRealTimers();
});

async function toReady() {
  await user.click(screen.getByRole('button', { name: 'Start a walk' }));
  await user.click(screen.getByRole('button', { name: 'Plan my walk' }));
  await act(async () => {}); // let the (instant, scripted) plan request resolve; findBy* would wait on frozen timers
  await user.click(screen.getByRole('button', { name: /i.m ready/i }));
}
async function startWalk() {
  await toReady();
  await user.click(screen.getByRole('button', { name: 'Start walking' }));
}
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const visibleTime = () => screen.getByRole('timer').querySelector('[aria-hidden="true"]')?.textContent;
function jumpClock(ms: number) {
  // A frozen/throttled page: wall-clock time moves, no timer callback ran in between.
  vi.setSystemTime(Date.now() + ms);
}
function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
}

describe('ready -> start', () => {
  it('the Ready screen has one real primary action, Start walking', async () => {
    await toReady();
    expect(screen.getByRole('heading', { level: 1, name: 'Ready?' })).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start walking' });
    expect(start).toHaveClass('btn--primary');
    expect(screen.getAllByRole('button').filter((b) => b.classList.contains('btn--primary'))).toHaveLength(1);
  });

  it('Start walking goes to the active walk with the phone-away moment, and the full requested time', async () => {
    await startWalk();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You\u2019re ready.Put your phone away.');
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(visibleTime()).toBe('20:00');
    expect(screen.getByRole('timer')).toHaveTextContent('About 20 minutes remaining');
  });

  it('double-click and repeated keyboard activation start exactly one walk', async () => {
    await toReady();
    await user.dblClick(screen.getByRole('button', { name: 'Start walking' }));
    expect(visibleTime()).toBe('20:00');
    advance(5000);
    expect(visibleTime()).toBe('19:55'); // a second start would have reset this to 20:00
    expect(planWalk).toHaveBeenCalledTimes(1);
  });

  it('can be started with the keyboard alone (Enter, then a second Enter is harmless)', async () => {
    await toReady();
    const start = screen.getByRole('button', { name: 'Start walking' });
    start.focus();
    await user.keyboard('{Enter}');
    advance(3000);
    await user.keyboard('{Enter}'); // focus is on the new heading; nothing to activate
    expect(visibleTime()).toBe('19:57');
  });
});

describe('active walk', () => {
  it('counts down from timestamps: one second elapsed', async () => {
    await startWalk();
    advance(1000);
    expect(visibleTime()).toBe('19:59');
  });

  it('after the phone-away moment it shows the first step and the notice, nothing else', async () => {
    await startWalk();
    advance(4000);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Walk out slowly along the nearest footpath.');
    expect(screen.getByText(/shades of green/)).toBeInTheDocument();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Exit walk']);
    expect(document.body.textContent).not.toMatch(/gemma|sentry|model|provider|weather|fallback|°C/i);
    expect(screen.queryByText('Slow loop, listening walk')).not.toBeInTheDocument(); // the full plan is not repeated
  });

  it('moves through the timed steps by itself, with no interaction', async () => {
    await startWalk();
    advance(8 * MIN - 1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Walk out slowly');
    advance(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stop and listen for distant birds.');
    advance(4 * MIN);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Return the way you came');
    expect(visibleTime()).toBe('8:00');
  });

  it('a delayed timer (clock jumped, no callbacks) shows the true remaining time and step', async () => {
    await startWalk();
    jumpClock(9 * MIN + 30_000); // 9m30s into the walk, nothing ticked
    setVisibility('visible');
    expect(visibleTime()).toBe('10:30');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Stop and listen');
  });

  it('hiding the page, time passing, and showing it again recalculates from the clock', async () => {
    await startWalk();
    advance(30_000);
    setVisibility('hidden');
    jumpClock(10 * MIN); // time passes while hidden; throttled timers do not run
    setVisibility('visible');
    expect(visibleTime()).toBe('9:30');
    expect(screen.getByRole('timer')).toHaveTextContent('About 10 minutes remaining');
  });

  it('only announces meaningful changes: started, then each step, never the clock', async () => {
    await startWalk();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Walk started. Put your phone away.');
    const seen: string[] = [];
    const mo = new MutationObserver(() => seen.push(status.textContent ?? ''));
    mo.observe(status, { childList: true, characterData: true, subtree: true });
    advance(4000);
    advance(60_000);
    advance(3 * MIN);
    await act(async () => {});
    expect(seen.length).toBeLessThanOrEqual(1); // step 1 text, then nothing for 4+ minutes of ticks
    advance(4 * MIN);
    expect(status).toHaveTextContent('Step 2 of 3. Stop and listen for distant birds.');
    mo.disconnect();
    expect(status.textContent).not.toMatch(/\d+:\d\d/);
  });

  it('the spoken time summary is not a per-second live region', async () => {
    await startWalk();
    const timer = screen.getByRole('timer');
    expect(timer.getAttribute('aria-live') ?? 'off').toBe('off');
    expect(timer.closest('[aria-live]:not([aria-live="off"])')).toBeNull();
    const spoken = () => timer.querySelector('.visually-hidden')?.textContent;
    expect(spoken()).toBe('About 20 minutes remaining');
    advance(10_000); // ten visible seconds pass: the spoken text is unchanged
    expect(spoken()).toBe('About 20 minutes remaining');
    advance(60_000); // it only moves on a minute boundary
    expect(spoken()).toBe('About 19 minutes remaining');
  });

  it('never asks for location, notifications or the network after the walk starts', async () => {
    const geo = { getCurrentPosition: vi.fn(), watchPosition: vi.fn() };
    Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await startWalk();
    advance(21 * MIN);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(geo.watchPosition).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(planWalk).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });
});

describe('completion', () => {
  it('completes at exactly the end, not one millisecond before', async () => {
    await startWalk();
    advance(20 * MIN - 1);
    expect(screen.queryByRole('heading', { name: 'Walk complete.' })).not.toBeInTheDocument();
    expect(visibleTime()).toBe('0:01');
    advance(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Walk complete.' })).toHaveFocus();
  });

  it('is simple and human: no scores, streaks or metrics, one Done button', async () => {
    await startWalk();
    advance(20 * MIN);
    expect(screen.getByText('Nice.')).toBeInTheDocument();
    expect(screen.getByText('You spent 20 minutes outside.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/xp|streak|point|badge|leaderboard|congrat|ai-generated|calorie|steps taken/i);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Done']);
  });

  it('happens once: later ticks and a late visibility change do not repeat or revert it', async () => {
    await startWalk();
    jumpClock(25 * MIN); // frozen page returns long after the end
    setVisibility('visible');
    expect(screen.getByRole('heading', { level: 1, name: 'Walk complete.' })).toBeInTheDocument();
    advance(10 * MIN);
    setVisibility('visible');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Walk complete.' })).toHaveLength(1);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('Done goes back to the start and nothing about the walk is kept', async () => {
    await startWalk();
    advance(20 * MIN);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { level: 1, name: 'PocketWalk' })).toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('exit', () => {
  it('a normal tap on Exit walk only asks; the timer keeps running underneath', async () => {
    await startWalk();
    advance(10_000);
    await user.click(screen.getByRole('button', { name: 'Exit walk' }));
    expect(screen.getByRole('alertdialog', { name: 'End this walk?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep walking' })).toHaveFocus();
    advance(5000);
    await user.click(screen.getByRole('button', { name: 'Keep walking' }));
    expect(visibleTime()).toBe('19:45'); // no pause, no restart, no lost time
  });

  it('Start -> Exit -> End walk returns to Ready with the plan intact', async () => {
    await startWalk();
    await user.click(screen.getByRole('button', { name: 'Exit walk' }));
    await user.click(screen.getByRole('button', { name: 'End walk' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Ready?' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Start walking' })).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });

  it('Start -> Exit -> Keep walking returns to the same walk, focus back on Exit walk', async () => {
    await startWalk();
    advance(60_000);
    await user.click(screen.getByRole('button', { name: 'Exit walk' }));
    await user.click(screen.getByRole('button', { name: 'Keep walking' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exit walk' })).toHaveFocus();
    expect(visibleTime()).toBe('19:00');
  });

  it('Escape is the same as Keep walking', async () => {
    await startWalk();
    await user.click(screen.getByRole('button', { name: 'Exit walk' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(visibleTime()).toBe('20:00');
  });

  it('if the walk ends while the question is open, it completes instead of being lost', async () => {
    await startWalk();
    await user.click(screen.getByRole('button', { name: 'Exit walk' }));
    advance(20 * MIN);
    expect(screen.getByRole('heading', { level: 1, name: 'Walk complete.' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('after ending a walk it can be started again with a fresh full timer', async () => {
    await startWalk();
    advance(5 * MIN);
    await user.click(screen.getByRole('button', { name: 'Exit walk' }));
    await user.click(screen.getByRole('button', { name: 'End walk' }));
    await user.click(screen.getByRole('button', { name: 'Start walking' }));
    expect(visibleTime()).toBe('20:00');
  });
});
