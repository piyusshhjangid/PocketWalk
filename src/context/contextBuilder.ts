import * as Sentry from '@sentry/node';
import { captureUnexpected, withContextSpan } from '../observability/tracing';
import { classifyDaylight, classifyTimeOfDay, localWallClock } from './daylight';
import { deriveGuidance, normalizeWeather } from './normalize';
import type {
  Availability,
  ContextSummary,
  DaylightPhase,
  OutdoorContext,
  TimeOfDay,
  WeatherFailureReason,
  WeatherObservation,
} from './types';
import { WeatherError, type WeatherProvider } from './weatherProvider';
import type { Energy } from '../ai/walkPlanner';

export interface WalkRequest {
  minutes: 10 | 20 | 40;
  energy: Energy;
  /** Coarse location only: a city name. Never coordinates. Optional: without it there is no weather. */
  location?: { city: string };
}

export interface ContextTimings {
  /** Real elapsed time of the whole context build. */
  contextMs: number;
  /** Real elapsed time of the weather lookup. Present only when a lookup was attempted (even if it failed). */
  weatherMs?: number;
}

export interface BuiltContext {
  context: OutdoorContext;
  timings: ContextTimings;
}

export interface ContextBuilderOptions {
  /** null or omitted = no weather provider configured. */
  weather?: WeatherProvider | null;
  /** Budget for the whole weather lookup (geocode + forecast). Past it the lookup is aborted. */
  weatherTimeoutMs?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export const DEFAULT_WEATHER_TIMEOUT_MS = 3000;

/** Abortable budget. When it expires the result is ALWAYS a `timeout` WeatherError, whatever the provider rejects with. */
function runWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const failure = () => new WeatherError('timeout', `Weather lookup did not finish within ${ms} ms`);
  if (parent?.aborted) return Promise.reject(failure());
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onParentAbort: (() => void) | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(failure());
      controller.abort();
    }, ms);
    if (parent) {
      onParentAbort = () => {
        timedOut = true;
        reject(failure());
        controller.abort();
      };
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  });
  return Promise.race([fn(controller.signal), timeout])
    .catch((err: unknown) => {
      if (timedOut) throw failure();
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      if (parent && onParentAbort) parent.removeEventListener('abort', onParentAbort);
    });
}

/** Per-call limits from the request's remaining budget (see RequestScope). Both optional. */
export interface BuildOptions {
  signal?: AbortSignal;
  /** Upper bound for the weather lookup; the smaller of this and the configured timeout applies. 0 or less skips the lookup. */
  weatherTimeoutMs?: number;
}

/**
 * request -> OutdoorContext.
 *
 * Gathers facts (local time, weather, daylight), normalises them, derives the deterministic guidance,
 * and survives provider failure: a failed lookup yields a context that says so, never an exception.
 * The weather provider is the only place that talks to the outside world.
 */
export class ContextBuilder {
  private readonly weather: WeatherProvider | null;
  private readonly weatherTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: ContextBuilderOptions = {}) {
    this.weather = options.weather ?? null;
    this.weatherTimeoutMs = options.weatherTimeoutMs ?? DEFAULT_WEATHER_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  async build(request: WalkRequest, options?: BuildOptions): Promise<BuiltContext> {
    const started = performance.now();
    const base = { minutes: request.minutes, energy: request.energy } as const;
    const finish = (context: OutdoorContext, weatherMs?: number): BuiltContext => ({
      context,
      timings: { contextMs: Math.round(performance.now() - started), ...(weatherMs !== undefined ? { weatherMs } : {}) },
    });

    // No location: nothing to look up. Time and daylight need a place's time zone, so they are absent too.
    if (!request.location) {
      return finish({
        ...base,
        availability: { weather: 'not_requested', daylight: 'not_requested' },
        guidance: [],
      });
    }

    const lookup = await this.lookupWeather(request.location.city, options);
    if (!lookup.observation) {
      return finish(
        {
          ...base,
          availability: { weather: 'unavailable', daylight: 'unavailable' },
          weatherFailure: lookup.failure,
          guidance: [],
        },
        lookup.weatherMs,
      );
    }

    const obs = lookup.observation;
    const weather = normalizeWeather(obs);
    const { timeOfDay, daylight, walkEndsAfterSunset } = await this.calculateDaylight(obs, request.minutes);
    const context: OutdoorContext = {
      ...base,
      ...(timeOfDay ? { timeOfDay } : {}),
      ...(daylight ? { daylight } : {}),
      ...(walkEndsAfterSunset !== undefined ? { walkEndsAfterSunset } : {}),
      weather,
      availability: { weather: 'ok', daylight: daylight ? 'ok' : 'unavailable' },
      guidance: deriveGuidance({ weather, feelsLikeC: obs.feelsLikeC, daylight, walkEndsAfterSunset }),
    };
    return finish(context, lookup.weatherMs);
  }

  /** Weather lookup inside a `weather.fetch` span. Never throws. */
  private async lookupWeather(
    city: string,
    options?: BuildOptions,
  ): Promise<{ observation?: WeatherObservation; failure?: WeatherFailureReason; weatherMs?: number }> {
    const provider = this.weather;
    if (!provider) return { failure: 'not_configured' };
    const budgetMs = Math.min(this.weatherTimeoutMs, options?.weatherTimeoutMs ?? Number.POSITIVE_INFINITY);
    // No time left for a lookup that could finish: skip it, honestly reported as a timeout.
    if (budgetMs <= 0) return { failure: 'timeout', weatherMs: 0 };

    const started = performance.now();
    const elapsed = (): number => Math.round(performance.now() - started);
    try {
      const observation = await withContextSpan('pocketwalk.weather', 'weather.fetch', async (span) => {
        span.setAttribute('pocketwalk.weather.provider', provider.name);
        try {
          const result = await runWithTimeout((signal) => provider.lookup(city, { signal }), budgetMs, options?.signal);
          span.setAttribute('pocketwalk.weather.status', 'ok');
          return result;
        } catch (err) {
          const reason = err instanceof WeatherError ? err.reason : 'unknown';
          span.setAttributes({ 'pocketwalk.weather.status': 'failed', 'pocketwalk.weather.failure_reason': reason });
          throw err;
        }
      });
      return { observation, weatherMs: elapsed() };
    } catch (err) {
      if (err instanceof WeatherError) return { failure: err.reason, weatherMs: elapsed() };
      // A bug, not an expected provider failure. Keep serving walks, but make it visible.
      captureUnexpected(err, 'weather');
      return { failure: 'unknown', weatherMs: elapsed() };
    }
  }

  /** Local time + daylight from the observation, inside a `daylight.calculate` span. Never throws. */
  private calculateDaylight(
    obs: WeatherObservation,
    minutes: number,
  ): Promise<{ timeOfDay?: TimeOfDay; daylight?: DaylightPhase; walkEndsAfterSunset?: boolean }> {
    return withContextSpan('pocketwalk.daylight', 'daylight.calculate', (span) => {
      let localNow: string;
      try {
        localNow = localWallClock(this.now(), obs.timezone);
      } catch {
        // Unknown time zone from the provider: treat like missing data rather than guessing.
        span.setAttribute('pocketwalk.daylight.status', 'unavailable');
        return {};
      }
      const timeOfDay = classifyTimeOfDay(localNow);
      const result = classifyDaylight({
        localNow,
        sunriseLocal: obs.sunriseLocal,
        sunsetLocal: obs.sunsetLocal,
        walkMinutes: minutes,
      });
      span.setAttributes({
        'pocketwalk.daylight.status': result ? 'ok' : 'unavailable',
        ...(timeOfDay ? { 'pocketwalk.time_of_day': timeOfDay } : {}),
        ...(result ? { 'pocketwalk.daylight.phase': result.phase } : {}),
      });
      return { timeOfDay, daylight: result?.phase, walkEndsAfterSunset: result?.walkEndsAfterSunset };
    });
  }
}

/** The client-safe view of a context: enumerated facts only, no location of any kind. */
export function summarizeContext(context: OutdoorContext): ContextSummary {
  const availability = context.availability ?? { weather: 'not_requested' as Availability, daylight: 'not_requested' as Availability };
  return {
    weather: availability.weather,
    ...(context.weatherFailure ? { weatherFailure: context.weatherFailure } : {}),
    daylight: availability.daylight,
    ...(context.timeOfDay ? { timeOfDay: context.timeOfDay } : {}),
    ...(context.daylight ? { daylightPhase: context.daylight } : {}),
    ...(context.weather ? { conditions: context.weather } : {}),
    guidance: context.guidance ?? [],
  };
}
