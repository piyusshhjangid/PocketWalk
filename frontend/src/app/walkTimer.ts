import type { WalkStep } from '../types/walk';

/** How long the "put your phone away" moment shows before the first instruction. Display only. */
export const INTRO_MS = 4000;

/** A walk is fully described by when it started and how long it lasts. Remaining time is derived, never counted down. */
export interface WalkTiming {
  startedAt: number;
  durationMs: number;
}

export const minutesToMs = (minutes: number): number => minutes * 60_000;

export const endsAt = (t: WalkTiming): number => t.startedAt + t.durationMs;

/** Elapsed time, clamped to [0, duration]: a clock that steps backwards cannot show more than the full duration left. */
export function elapsedMs(t: WalkTiming, now: number): number {
  return Math.min(Math.max(now - t.startedAt, 0), t.durationMs);
}

/** Remaining time, never negative and never more than the whole walk. */
export function remainingMs(t: WalkTiming, now: number): number {
  return t.durationMs - elapsedMs(t, now);
}

export const isFinished = (t: WalkTiming, now: number): boolean => now >= endsAt(t);

/** "19:59". Rounds UP, so 1 ms left reads 0:01 and 0:00 only ever means finished. */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(ms, 0) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Screen-reader summary. Changes at most once a minute, so it is never a per-second announcement. */
export function spokenRemaining(ms: number): string {
  if (ms <= 0) return 'Walk complete';
  const minutes = Math.ceil(ms / 60_000);
  if (ms <= 60_000) return 'Less than a minute remaining';
  return minutes === 1 ? 'About 1 minute remaining' : `About ${minutes} minutes remaining`;
}

/**
 * Which step is current. Uses the plan's own step lengths as cumulative boundaries; the last step runs
 * until the walk ends, so rounding or a plan that adds up to less than the walk never leaves a gap.
 */
export function stepIndexAt(steps: WalkStep[], elapsed: number): number {
  if (steps.length === 0) return 0;
  let boundary = 0;
  for (let i = 0; i < steps.length - 1; i++) {
    boundary += minutesToMs(steps[i]?.minutes ?? 0);
    if (elapsed < boundary) return i;
  }
  return steps.length - 1;
}

/** Delay until the displayed second next changes; aligned to the walk's end, not to wall-clock seconds. */
export function msUntilNextTick(remaining: number): number {
  return remaining % 1000 || 1000;
}
