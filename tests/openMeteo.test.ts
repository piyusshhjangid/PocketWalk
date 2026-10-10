import { describe, expect, it } from 'vitest';
import { OpenMeteoProvider } from '../src/context/openMeteoProvider';
import { WeatherError } from '../src/context/weatherProvider';

/**
 * Fixtures follow the response shapes in Open-Meteo's official docs (read 2026-10-07).
 * They are hand-written to that documented shape, NOT captured from the live service.
 */
const geocodeOk = { results: [{ id: 1, name: 'Jalandhar', latitude: 31.32559, longitude: 75.57618, timezone: 'Asia/Kolkata', country: 'India' }], generationtime_ms: 0.4 };
const forecastOk = {
  latitude: 31.3, longitude: 75.6, elevation: 230, generationtime_ms: 0.2, utc_offset_seconds: 19800,
  timezone: 'Asia/Kolkata', timezone_abbreviation: 'GMT+5:30',
  current_units: { temperature_2m: '°C' },
  current: { time: '2026-10-07T18:00', interval: 900, temperature_2m: 27.3, apparent_temperature: 29.1, weather_code: 61, wind_speed_10m: 9.4 },
  daily_units: { sunrise: 'iso8601' },
  daily: { time: ['2026-10-07'], sunrise: ['2026-10-07T06:13'], sunset: ['2026-10-07T17:52'] },
};

type Call = { url: string; init?: RequestInit };
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that answers geocoding and forecast calls from the supplied responders and records every call. */
function fakeFetch(geo: () => Response | Promise<Response>, forecast: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return u.includes('/v1/search') ? geo() : forecast();
  }) as typeof fetch;
  return { impl, calls };
}
const lookup = (p: OpenMeteoProvider, signal = new AbortController().signal) => p.lookup('Jalandhar', { signal });
const rejection = async (p: Promise<unknown>): Promise<WeatherError> => {
  try { await p; } catch (e) { return e as WeatherError; }
  throw new Error('expected a rejection');
};

describe('Test 1: valid weather response', () => {
  it('maps the documented shape into a WeatherObservation', async () => {
    const { impl } = fakeFetch(() => json(geocodeOk), () => json(forecastOk));
    const obs = await lookup(new OpenMeteoProvider({ fetchImpl: impl }));
    expect(obs).toEqual({
      timezone: 'Asia/Kolkata',
      temperatureC: 27.3,
      feelsLikeC: 29.1,
      windKmh: 9.4,
      condition: 'rain',
      precipitation: 'light',
      sunriseLocal: '2026-10-07T06:13',
      sunsetLocal: '2026-10-07T17:52',
    });
  });

  it('sends the documented requests: city only to the geocoder, rounded coordinates to the forecast, no key, no header secrets', async () => {
    const { impl, calls } = fakeFetch(() => json(geocodeOk), () => json(forecastOk));
    await lookup(new OpenMeteoProvider({ fetchImpl: impl }));
    expect(calls).toHaveLength(2);

    const geo = new URL(calls[0]!.url);
    expect(geo.origin + geo.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(geo.searchParams.get('name')).toBe('Jalandhar');
    expect(geo.searchParams.get('count')).toBe('1');

    const fc = new URL(calls[1]!.url);
    expect(fc.origin + fc.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(fc.searchParams.get('latitude')).toBe('31.33'); // 31.32559 rounded to ~1 km
    expect(fc.searchParams.get('longitude')).toBe('75.58');
    expect(fc.searchParams.get('timezone')).toBe('auto');
    expect(fc.searchParams.get('forecast_days')).toBe('1');
    expect(fc.searchParams.get('current')).toBe('temperature_2m,apparent_temperature,weather_code,wind_speed_10m');
    expect(fc.searchParams.get('daily')).toBe('sunrise,sunset');
    expect(fc.searchParams.has('name')).toBe(false); // the city is not sent to the forecast service
    expect(fc.searchParams.has('apikey')).toBe(false);
    expect(Object.keys((calls[1]!.init?.headers ?? {}) as object)).toEqual(['accept']);
  });

  it('URL-encodes the city (no query injection)', async () => {
    const { impl, calls } = fakeFetch(() => json(geocodeOk), () => json(forecastOk));
    await new OpenMeteoProvider({ fetchImpl: impl }).lookup("X&count=100&format=xlsx", { signal: new AbortController().signal });
    const geo = new URL(calls[0]!.url);
    expect(geo.searchParams.get('name')).toBe('X&count=100&format=xlsx');
    expect(geo.searchParams.get('count')).toBe('1');
    expect(geo.searchParams.get('format')).toBe('json');
  });

  it.each([
    [0, 'clear', 'none'], [3, 'cloudy', 'none'], [45, 'fog', 'none'], [53, 'drizzle', 'moderate'],
    [65, 'rain', 'heavy'], [67, 'freezing_rain', 'heavy'], [73, 'snow', 'moderate'], [82, 'rain', 'heavy'], [95, 'thunderstorm', 'heavy'],
  ])('WMO code %i -> %s / %s', async (code, condition, precipitation) => {
    const { impl } = fakeFetch(() => json(geocodeOk), () => json({ ...forecastOk, current: { ...forecastOk.current, weather_code: code } }));
    const obs = await lookup(new OpenMeteoProvider({ fetchImpl: impl }));
    expect([obs.condition, obs.precipitation]).toEqual([condition, precipitation]);
  });

  it('null sunrise/sunset (e.g. polar day) is fine: the observation just has no sun times', async () => {
    const body = { ...forecastOk, daily: { time: ['2026-06-21'], sunrise: [null], sunset: [null] } };
    const { impl } = fakeFetch(() => json(geocodeOk), () => json(body));
    const obs = await lookup(new OpenMeteoProvider({ fetchImpl: impl }));
    expect(obs.sunriseLocal).toBeUndefined();
    expect(obs.sunsetLocal).toBeUndefined();
  });
});

describe('Test 3: malformed weather response', () => {
  const forecastWith = (patch: object) => ({ ...forecastOk, ...patch });
  const cases: [string, () => Response][] = [
    ['forecast: missing current block', () => json({ timezone: 'UTC' })],
    ['forecast: temperature is a string', () => json(forecastWith({ current: { ...forecastOk.current, temperature_2m: 'warm' } }))],
    ['forecast: absurd temperature', () => json(forecastWith({ current: { ...forecastOk.current, temperature_2m: 900 } }))],
    ['forecast: negative wind', () => json(forecastWith({ current: { ...forecastOk.current, wind_speed_10m: -5 } }))],
    ['forecast: unknown weather code', () => json(forecastWith({ current: { ...forecastOk.current, weather_code: 424242 } }))],
    ['forecast: fractional weather code', () => json(forecastWith({ current: { ...forecastOk.current, weather_code: 61.5 } }))],
    ['forecast: missing timezone', () => json({ current: forecastOk.current })],
    ['forecast: not JSON', () => new Response('<html>oops</html>', { status: 200 })],
    ['forecast: JSON null', () => json(null)],
  ];
  it.each(cases)('%s -> malformed', async (_name, respond) => {
    const { impl } = fakeFetch(() => json(geocodeOk), respond);
    const err = await rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl })));
    expect(err).toBeInstanceOf(WeatherError);
    expect(err.reason).toBe('malformed');
  });

  it('geocoding with an unexpected shape -> malformed', async () => {
    const { impl } = fakeFetch(() => json({ results: [{ latitude: 'north', longitude: 1 }] }), () => json(forecastOk));
    expect((await rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl })))).reason).toBe('malformed');
  });

  it('a malformed sunrise value is dropped (daylight unavailable), it does not fail the whole lookup', async () => {
    const body = forecastWith({ daily: { sunrise: ['garbage'], sunset: ['2026-10-07T17:52'] } });
    const { impl } = fakeFetch(() => json(geocodeOk), () => json(body));
    const obs = await lookup(new OpenMeteoProvider({ fetchImpl: impl }));
    expect(obs.sunriseLocal).toBeUndefined();
    expect(obs.sunsetLocal).toBe('2026-10-07T17:52');
  });
});

describe('provider failures', () => {
  it('no match for the city -> location_not_found (and no forecast call)', async () => {
    for (const body of [{ generationtime_ms: 0.1 }, { results: [] }]) {
      const { impl, calls } = fakeFetch(() => json(body), () => json(forecastOk));
      expect((await rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl })))).reason).toBe('location_not_found');
      expect(calls).toHaveLength(1);
    }
  });

  it.each([
    [429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'], [400, 'misconfigured'], [404, 'misconfigured'],
  ])('HTTP %i from the forecast service -> %s, and the response body is never copied', async (status, reason) => {
    const { impl } = fakeFetch(() => json(geocodeOk), () => json({ error: true, reason: 'SECRET-PROVIDER-TEXT' }, status));
    const err = await rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl })));
    expect(err.reason).toBe(reason);
    expect(err.message).not.toContain('SECRET-PROVIDER-TEXT');
  });

  it('HTTP 429 from the geocoder -> rate_limited', async () => {
    const { impl } = fakeFetch(() => json({}, 429), () => json(forecastOk));
    expect((await rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl })))).reason).toBe('rate_limited');
  });

  it('network failure -> unavailable, without echoing the underlying message', async () => {
    const impl = (async () => { throw new TypeError('connect ECONNREFUSED 10.0.0.1:443 secret'); }) as unknown as typeof fetch;
    const err = await rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl })));
    expect(err.reason).toBe('unavailable');
    expect(err.message).not.toContain('secret');
  });

  it('an aborted request -> timeout', async () => {
    const controller = new AbortController();
    const impl = ((_u: string, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    const pending = rejection(lookup(new OpenMeteoProvider({ fetchImpl: impl }), controller.signal));
    controller.abort();
    expect((await pending).reason).toBe('timeout');
  });
});
