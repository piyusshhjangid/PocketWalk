import { describe, expect, it } from 'vitest';
import { elapsedMs, endsAt, formatRemaining, INTRO_MS, isFinished, minutesToMs, msUntilNextTick, remainingMs, spokenRemaining, stepIndexAt } from '../src/app/walkTimer';

const t = { startedAt: 1_000_000, durationMs: minutesToMs(20) };
const steps = [
  { minutes: 8, text: 'a' },
  { minutes: 4, text: 'b' },
  { minutes: 8, text: 'c' },
];

describe('walk timer (pure, timestamp based)', () => {
  it('starts at the full requested duration', () => {
    expect(remainingMs(t, t.startedAt)).toBe(20 * 60_000);
    expect(formatRemaining(remainingMs(t, t.startedAt))).toBe('20:00');
    expect(endsAt(t)).toBe(t.startedAt + 1_200_000);
  });

  it('one second later shows 19:59', () => {
    expect(formatRemaining(remainingMs(t, t.startedAt + 1000))).toBe('19:59');
  });

  it('is correct after a late callback: remaining depends only on the timestamp, not on ticks', () => {
    // A throttled tab wakes up 7 minutes 13 seconds late; nothing "caught up" tick by tick.
    expect(formatRemaining(remainingMs(t, t.startedAt + 433_000))).toBe('12:47');
  });

  it('rounds up so 0:00 only ever means finished', () => {
    const end = endsAt(t);
    expect(formatRemaining(remainingMs(t, end - 1))).toBe('0:01');
    expect(isFinished(t, end - 1)).toBe(false);
    expect(formatRemaining(remainingMs(t, end))).toBe('0:00');
    expect(isFinished(t, end)).toBe(true);
  });

  it('never shows negative time, before or after the walk', () => {
    expect(remainingMs(t, endsAt(t) + 99_999)).toBe(0);
    expect(formatRemaining(-5000)).toBe('0:00');
    // negative elapsed (clock stepped backwards): capped at the full duration, never more
    expect(elapsedMs(t, t.startedAt - 60_000)).toBe(0);
    expect(remainingMs(t, t.startedAt - 60_000)).toBe(t.durationMs);
  });

  it('summarises remaining time for screen readers at minute granularity', () => {
    expect(spokenRemaining(18 * 60_000)).toBe('About 18 minutes remaining');
    expect(spokenRemaining(17 * 60_000 + 1)).toBe('About 18 minutes remaining');
    expect(spokenRemaining(61_000)).toBe('About 2 minutes remaining');
    expect(spokenRemaining(60_000)).toBe('Less than a minute remaining');
    expect(spokenRemaining(1)).toBe('Less than a minute remaining');
    expect(spokenRemaining(0)).toBe('Walk complete');
  });

  it('picks the step from cumulative step lengths; the last step runs to the end', () => {
    const at = (min: number) => stepIndexAt(steps, minutesToMs(min));
    expect(at(0)).toBe(0);
    expect(at(7.99)).toBe(0);
    expect(at(8)).toBe(1);
    expect(at(11.99)).toBe(1);
    expect(at(12)).toBe(2);
    expect(at(20)).toBe(2);
    expect(stepIndexAt([{ minutes: 5, text: 'only' }], 999_999)).toBe(0);
    expect(stepIndexAt([], 5)).toBe(0);
  });

  it('schedules the next tick for the next whole second of remaining time', () => {
    expect(msUntilNextTick(18_500)).toBe(500);
    expect(msUntilNextTick(18_000)).toBe(1000);
    expect(msUntilNextTick(1)).toBe(1);
  });

  it('intro is shorter than the shortest possible step', () => {
    expect(INTRO_MS).toBeLessThan(minutesToMs(1));
  });
});
