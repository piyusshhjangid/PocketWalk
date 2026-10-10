import type { DaylightPhase, TimeOfDay } from './types';

/**
 * Daylight is deliberately simple: no astronomy. The weather provider already returns today's local
 * sunrise and sunset, so a phase is a comparison of "local now" against those two times.
 * The windows below are rough guides, not measurements of twilight.
 */
const MINUTE = 60_000;
const SUNRISE_BEFORE = 30;
const SUNRISE_AFTER = 45;
const SUNSET_BEFORE = 60;
const SUNSET_AFTER = 30;

const LOCAL_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:mm" read as plain numbers. Same trick for every value, so offsets cancel out. */
function wallClockMs(local: string): number | undefined {
  if (!LOCAL_CLOCK.test(local)) return undefined;
  const ms = Date.parse(`${local}:00Z`);
  return Number.isNaN(ms) ? undefined : ms;
}

/** The wall-clock time in `timeZone` as "YYYY-MM-DDTHH:mm". Throws RangeError for an unknown zone. */
export function localWallClock(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function classifyTimeOfDay(localClock: string): TimeOfDay | undefined {
  const m = LOCAL_CLOCK.exec(localClock);
  if (!m) return undefined;
  const hour = Number(m[2]);
  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 16) return 'afternoon';
  if (hour >= 17 && hour <= 20) return 'evening';
  return 'night';
}

export interface DaylightResult {
  phase: DaylightPhase;
  /** True when the walk (starting now) would finish after sunset. */
  walkEndsAfterSunset: boolean;
}

/**
 * Works out the daylight phase. Returns undefined (daylight unavailable) when sunrise or sunset is
 * missing, malformed, or not for the same local date as "now" (e.g. polar day, or a midnight edge).
 */
export function classifyDaylight(input: {
  localNow: string;
  sunriseLocal: string | undefined;
  sunsetLocal: string | undefined;
  walkMinutes: number;
}): DaylightResult | undefined {
  const { localNow, sunriseLocal, sunsetLocal, walkMinutes } = input;
  if (!sunriseLocal || !sunsetLocal) return undefined;
  if (sunriseLocal.slice(0, 10) !== localNow.slice(0, 10) || sunsetLocal.slice(0, 10) !== localNow.slice(0, 10)) {
    return undefined;
  }
  const now = wallClockMs(localNow);
  const sunrise = wallClockMs(sunriseLocal);
  const sunset = wallClockMs(sunsetLocal);
  if (now === undefined || sunrise === undefined || sunset === undefined || sunset <= sunrise) return undefined;

  const walkEndsAfterSunset = now + walkMinutes * MINUTE > sunset;
  let phase: DaylightPhase;
  if (now < sunrise - SUNRISE_BEFORE * MINUTE || now > sunset + SUNSET_AFTER * MINUTE) phase = 'night';
  else if (now <= sunrise + SUNRISE_AFTER * MINUTE) phase = 'near_sunrise';
  else if (now >= sunset - SUNSET_BEFORE * MINUTE) phase = 'near_sunset';
  else phase = 'day';
  return { phase, walkEndsAfterSunset };
}
