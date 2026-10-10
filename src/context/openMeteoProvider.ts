import { z } from 'zod';
import type { Precipitation, WeatherCondition, WeatherObservation } from './types';
import { WeatherError, type WeatherProvider } from './weatherProvider';
import { BodyTooLargeError, readBoundedJson } from '../utils/boundedBody';

/** A forecast reply is about 2 KB. 128 KiB is generous and still a hard stop. */
export const MAX_WEATHER_BODY_BYTES = 128 * 1024;

/**
 * Open-Meteo adapter. Contract verified against the official docs (read 2026-10-07):
 *   GET {geocoding}/v1/search?name=<city>&count=1&language=en&format=json
 *       -> { results?: [{ latitude, longitude, ... }] }   (no "results" key when nothing matches)
 *   GET {forecast}/v1/forecast?latitude&longitude&current=...&daily=sunrise,sunset&timezone=auto&forecast_days=1
 *       -> { timezone, current: {...}, daily: { sunrise: [..], sunset: [..] } }   (local times, 'YYYY-MM-DDTHH:mm')
 * No API key. The free tier is for non-commercial use (see docs/architecture.md).
 *
 * Privacy: the city is sent only to the geocoder. Coordinates are rounded to 2 decimals (about 1 km)
 * before the forecast request, are never returned from this class, and never reach Gemma or Sentry.
 */

const geocodeSchema = z.object({
  results: z.array(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })).optional(),
});

const forecastSchema = z.object({
  timezone: z.string().min(1).max(64),
  current: z.object({
    temperature_2m: z.number().min(-90).max(60),
    apparent_temperature: z.number().min(-120).max(80),
    weather_code: z.number().int(),
    wind_speed_10m: z.number().min(0).max(500),
  }),
  daily: z
    .object({
      sunrise: z.array(z.string().nullable()).optional(),
      sunset: z.array(z.string().nullable()).optional(),
    })
    .optional(),
});

/** WMO weather interpretation codes, as listed in the Open-Meteo docs. Unknown code -> malformed. */
const WMO: Record<number, { condition: WeatherCondition; precipitation: Precipitation }> = {
  0: { condition: 'clear', precipitation: 'none' },
  1: { condition: 'clear', precipitation: 'none' },
  2: { condition: 'cloudy', precipitation: 'none' },
  3: { condition: 'cloudy', precipitation: 'none' },
  45: { condition: 'fog', precipitation: 'none' },
  48: { condition: 'fog', precipitation: 'none' },
  51: { condition: 'drizzle', precipitation: 'light' },
  53: { condition: 'drizzle', precipitation: 'moderate' },
  55: { condition: 'drizzle', precipitation: 'moderate' },
  56: { condition: 'freezing_rain', precipitation: 'light' },
  57: { condition: 'freezing_rain', precipitation: 'moderate' },
  61: { condition: 'rain', precipitation: 'light' },
  63: { condition: 'rain', precipitation: 'moderate' },
  65: { condition: 'rain', precipitation: 'heavy' },
  66: { condition: 'freezing_rain', precipitation: 'light' },
  67: { condition: 'freezing_rain', precipitation: 'heavy' },
  71: { condition: 'snow', precipitation: 'light' },
  73: { condition: 'snow', precipitation: 'moderate' },
  75: { condition: 'snow', precipitation: 'heavy' },
  77: { condition: 'snow', precipitation: 'light' },
  80: { condition: 'rain', precipitation: 'light' },
  81: { condition: 'rain', precipitation: 'moderate' },
  82: { condition: 'rain', precipitation: 'heavy' },
  85: { condition: 'snow', precipitation: 'light' },
  86: { condition: 'snow', precipitation: 'heavy' },
  95: { condition: 'thunderstorm', precipitation: 'heavy' },
  96: { condition: 'thunderstorm', precipitation: 'heavy' },
  97: { condition: 'thunderstorm', precipitation: 'heavy' },
  99: { condition: 'thunderstorm', precipitation: 'heavy' },
};

const LOCAL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export interface OpenMeteoOptions {
  geocodingBaseUrl?: string;
  forecastBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly name = 'open-meteo';
  private readonly geocodingBaseUrl: string;
  private readonly forecastBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenMeteoOptions = {}) {
    this.geocodingBaseUrl = (options.geocodingBaseUrl ?? 'https://geocoding-api.open-meteo.com').replace(/\/+$/, '');
    this.forecastBaseUrl = (options.forecastBaseUrl ?? 'https://api.open-meteo.com').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async lookup(city: string, { signal }: { signal: AbortSignal }): Promise<WeatherObservation> {
    const place = await this.geocode(city, signal);
    return this.forecast(place.latitude, place.longitude, signal);
  }

  private async geocode(city: string, signal: AbortSignal): Promise<{ latitude: number; longitude: number }> {
    const url = `${this.geocodingBaseUrl}/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
    const body = await this.getJson(url, signal);
    const parsed = geocodeSchema.safeParse(body);
    if (!parsed.success) throw new WeatherError('malformed', 'Geocoding response had an unexpected shape');
    const first = parsed.data.results?.[0];
    if (!first) throw new WeatherError('location_not_found', 'No matching place');
    return first;
  }

  private async forecast(latitude: number, longitude: number, signal: AbortSignal): Promise<WeatherObservation> {
    const query = new URLSearchParams({
      latitude: latitude.toFixed(2),
      longitude: longitude.toFixed(2),
      current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
      daily: 'sunrise,sunset',
      timezone: 'auto',
      forecast_days: '1',
    });
    const body = await this.getJson(`${this.forecastBaseUrl}/v1/forecast?${query.toString()}`, signal);
    const parsed = forecastSchema.safeParse(body);
    if (!parsed.success) throw new WeatherError('malformed', 'Forecast response had an unexpected shape');

    const { current, daily, timezone } = parsed.data;
    const mapped = WMO[current.weather_code];
    if (!mapped) throw new WeatherError('malformed', 'Unknown weather code');

    const first = (list: (string | null)[] | undefined): string | undefined => {
      const v = list?.[0];
      return typeof v === 'string' && LOCAL_CLOCK.test(v) ? v : undefined;
    };
    return {
      timezone,
      temperatureC: current.temperature_2m,
      feelsLikeC: current.apparent_temperature,
      windKmh: current.wind_speed_10m,
      condition: mapped.condition,
      precipitation: mapped.precipitation,
      sunriseLocal: first(daily?.sunrise),
      sunsetLocal: first(daily?.sunset),
    };
  }

  /** One GET. Maps every failure to a WeatherError. Provider messages and bodies are never copied. */
  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, signal });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (signal.aborted || name === 'AbortError' || name === 'TimeoutError') {
        throw new WeatherError('timeout', 'Weather request timed out');
      }
      throw new WeatherError('unavailable', 'Weather provider unreachable');
    }
    if (!res.ok) {
      if (res.status === 429) throw new WeatherError('rate_limited', 'Weather provider rate limit');
      if (res.status >= 500) throw new WeatherError('unavailable', `Weather provider error (${res.status})`);
      throw new WeatherError('misconfigured', `Weather provider rejected the request (${res.status})`);
    }
    try {
      return await readBoundedJson(res, MAX_WEATHER_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) throw new WeatherError('malformed', 'Weather provider response was too large');
      // A timeout/abort while the body was still streaming is a timeout, not a malformed body.
      if (signal.aborted) throw new WeatherError('timeout', 'Weather request timed out');
      throw new WeatherError('malformed', 'Weather provider returned a non-JSON body');
    }
  }
}
