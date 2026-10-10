import { useEffect, useState } from 'react';
import { msUntilNextTick } from '../app/walkTimer';
import type { Clock } from '../time/clock';

/**
 * Current time for the active walk, re-read at most once per displayed second.
 *
 * Each tick re-reads the clock, so a late timer (throttled or frozen background tab) just means a
 * bigger jump, never a wrong value. When the page becomes visible again the clock is read at once.
 * Nothing here counts ticks. `end` is the walk's authoritative end timestamp.
 */
export function useNow(clock: Clock, end: number): number {
  const [now, setNow] = useState(() => clock.now());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const sync = () => {
      if (stopped) return;
      if (timer !== undefined) clearTimeout(timer);
      const current = clock.now();
      setNow(current);
      if (current >= end) return;
      timer = setTimeout(sync, msUntilNextTick(end - current));
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };

    sync();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [clock, end]);

  return now;
}
