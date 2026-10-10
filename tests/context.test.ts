import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { ContextBuilder, summarizeContext } from '../src/context/contextBuilder';
import { createWeatherProvider } from '../src/context/createWeatherProvider';
import { classifyDaylight, classifyTimeOfDay, localWallClock } from '../src/context/daylight';
import { deriveGuidance, normalizeWeather, temperatureBand, windBand } from '../src/context/normalize';
import { at, FakeWeatherProvider, observation } from './helpers/fakeWeather';

const SUNRISE = '2026-10-07T06:00';
const SUNSET = '2026-10-07T18:00';
const daylightAt = (hhmm: string, walkMinutes = 20) =>
  classifyDaylight({ localNow: `2026-10-07T${hhmm}`, sunriseLocal: SUNRISE, sunsetLocal: SUNSET, walkMinutes });

describe('Test 6: time-of-day classification', () => {
  it.each([
    ['04:59', 'night'],
    ['05:00', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'afternoon'],
    ['16:59', 'afternoon'],
    ['17:00', 'evening'],
    ['20:59', 'evening'],
    ['21:00', 'night'],
    ['00:10', 'night'],
  ])('%s -> %s', (hhmm, expected) => {
    expect(classifyTimeOfDay(`2026-10-07T${hhmm}`)).toBe(expected);
  });
  it('rejects a malformed clock instead of guessing', () => {
    expect(classifyTimeOfDay('not a time')).toBeUndefined();
  });
});

describe('local wall clock', () => {
  it('converts a UTC instant into the place\'s local time', () => {
    expect(localWallClock(new Date('2026-10-07T12:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-07T18:00');
  });
  it('rolls over midnight and never prints hour 24', () => {
    expect(localWallClock(new Date('2026-10-07T18:40:00Z'), 'Asia/Kolkata')).toBe('2026-10-08T00:10');
  });
  it('throws for an unknown time zone (the builder treats that as unavailable)', () => {
    expect(() => localWallClock(new Date(), 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('Test 5: daylight calculation', () => {
  it.each([
    ['03:00', 'night'],
    ['05:29', 'night'],
    ['05:30', 'near_sunrise'],
    ['06:45', 'near_sunrise'],
    ['06:46', 'day'],
    ['12:00', 'day'],
    ['16:59', 'day'],
    ['17:00', 'near_sunset'],
    ['18:30', 'near_sunset'],
    ['18:31', 'night'],
    ['23:00', 'night'],
  ])('%s -> %s', (hhmm, phase) => {
    expect(daylightAt(hhmm)?.phase).toBe(phase);
  });

  it('knows when the walk would end after sunset', () => {
    expect(daylightAt('17:30', 40)?.walkEndsAfterSunset).toBe(true);
    expect(daylightAt('17:30', 10)?.walkEndsAfterSunset).toBe(false);
    expect(daylightAt('12:00', 40)?.walkEndsAfterSunset).toBe(false);
  });

  it('is unavailable (not guessed) for missing, malformed, or other-day sunrise/sunset', () => {
    const base = { localNow: '2026-10-07T12:00', walkMinutes: 20 };
    expect(classifyDaylight({ ...base, sunriseLocal: undefined, sunsetLocal: SUNSET })).toBeUndefined();
    expect(classifyDaylight({ ...base, sunriseLocal: SUNRISE, sunsetLocal: undefined })).toBeUndefined();
    expect(classifyDaylight({ ...base, sunriseLocal: 'garbage', sunsetLocal: SUNSET })).toBeUndefined();
    expect(classifyDaylight({ ...base, sunriseLocal: '2026-10-06T06:00', sunsetLocal: '2026-10-06T18:00' })).toBeUndefined();
    expect(classifyDaylight({ ...base, sunriseLocal: SUNSET, sunsetLocal: SUNRISE })).toBeUndefined();
  });
});

describe('Test 4: context normalization', () => {
  it('maps feels-like temperature to bands at the documented edges', () => {
    expect(
      [-5, 0, 1, 8, 9, 16, 17, 24, 25, 31.9, 32, 45].map(temperatureBand),
    ).toEqual(['freezing', 'freezing', 'cold', 'cold', 'cool', 'cool', 'mild', 'mild', 'warm', 'warm', 'hot', 'hot']);
  });
  it('maps wind speed to bands', () => {
    expect([0, 11.9, 12, 29.9, 30, 49.9, 50, 90].map(windBand)).toEqual([
      'calm', 'calm', 'breezy', 'breezy', 'windy', 'windy', 'very_windy', 'very_windy',
    ]);
  });
  it('keeps only product-relevant facts: no timezone, no sun times, no feels-like number', () => {
    const out = normalizeWeather(observation({ temperatureC: 14.6, feelsLikeC: 12, windKmh: 20, condition: 'rain', precipitation: 'moderate' }));
    expect(out).toEqual({ condition: 'rain', temperatureC: 15, temperatureBand: 'cool', precipitation: 'moderate', wind: 'breezy' });
    expect(Object.keys(out)).toEqual(['condition', 'temperatureC', 'temperatureBand', 'precipitation', 'wind']);
  });
});

describe('deterministic guidance', () => {
  const w = (over = {}) => normalizeWeather(observation(over));
  it('is empty for a comfortable day', () => {
    expect(deriveGuidance({ weather: w(), feelsLikeC: 22, daylight: 'day', walkEndsAfterSunset: false })).toEqual([]);
  });
  it('flags rain as wet, not poor', () => {
    expect(deriveGuidance({ weather: w({ condition: 'rain', precipitation: 'light' }), feelsLikeC: 20, daylight: 'day' })).toEqual(['wet']);
  });
  it.each([
    ['thunderstorm', { condition: 'thunderstorm', precipitation: 'heavy' }, 22],
    ['freezing rain', { condition: 'freezing_rain', precipitation: 'light' }, 0],
    ['heavy rain', { condition: 'rain', precipitation: 'heavy' }, 20],
    ['very strong wind', { windKmh: 70 }, 20],
    ['extreme heat', {}, 41],
    ['extreme cold', {}, -12],
  ])('%s -> poor_conditions', (_name, over, feelsLikeC) => {
    expect(deriveGuidance({ weather: w({ ...over, feelsLikeC }), feelsLikeC, daylight: 'day' })).toContain('poor_conditions');
  });
  it('hot and cold thresholds', () => {
    expect(deriveGuidance({ weather: w(), feelsLikeC: 33, daylight: 'day' })).toEqual(['hot']);
    expect(deriveGuidance({ weather: w(), feelsLikeC: 2, daylight: 'day' })).toEqual(['cold']);
  });
  it('dark at night; low_visibility near sunrise/sunset, in fog, or when the walk ends after sunset', () => {
    expect(deriveGuidance({ weather: w(), feelsLikeC: 20, daylight: 'night' })).toEqual(['dark']);
    expect(deriveGuidance({ weather: w(), feelsLikeC: 20, daylight: 'near_sunset' })).toEqual(['low_visibility']);
    expect(deriveGuidance({ weather: w(), feelsLikeC: 20, daylight: 'near_sunrise' })).toEqual(['low_visibility']);
    expect(deriveGuidance({ weather: w({ condition: 'fog' }), feelsLikeC: 20, daylight: 'day' })).toEqual(['low_visibility']);
    expect(deriveGuidance({ weather: w(), feelsLikeC: 20, daylight: 'day', walkEndsAfterSunset: true })).toEqual(['low_visibility']);
  });
  it('works with daylight only (no weather)', () => {
    expect(deriveGuidance({ daylight: 'night' })).toEqual(['dark']);
  });
});

describe('Test 8: full context', () => {
  it('combines request, local time, weather and daylight', async () => {
    const weather = FakeWeatherProvider.observing({ condition: 'rain', precipitation: 'light', temperatureC: 18.2, feelsLikeC: 17 });
    const { context, timings } = await new ContextBuilder({ weather, now: at('17:30') }).build({
      minutes: 40,
      energy: 'easy',
      location: { city: 'Jalandhar' },
    });
    expect(context).toMatchObject({
      minutes: 40,
      energy: 'easy',
      timeOfDay: 'evening',
      daylight: 'near_sunset',
      walkEndsAfterSunset: true,
      weather: { condition: 'rain', temperatureC: 18, temperatureBand: 'mild', precipitation: 'light', wind: 'calm' },
      availability: { weather: 'ok', daylight: 'ok' },
    });
    expect(context.guidance).toEqual(['low_visibility', 'wet']);
    expect(context.weatherFailure).toBeUndefined();
    expect(weather.cities).toEqual(['Jalandhar']);
    expect(timings.contextMs).toBeGreaterThanOrEqual(timings.weatherMs ?? 0);
  });

  it('uses the place\'s own time zone, not the server\'s', async () => {
    const weather = FakeWeatherProvider.observing({ timezone: 'Asia/Kolkata', sunriseLocal: '2026-10-07T06:10', sunsetLocal: '2026-10-07T17:55' });
    const { context } = await new ContextBuilder({ weather, now: at('12:30') }).build({ minutes: 20, energy: 'normal', location: { city: 'X' } });
    expect(context.timeOfDay).toBe('evening'); // 12:30Z is 18:00 in Kolkata
    expect(context.daylight).toBe('near_sunset');
  });
});

describe('Test 7: partial context', () => {
  it('no location: weather and daylight are "not_requested" and the context is just the request', async () => {
    const weather = FakeWeatherProvider.observing();
    const { context, timings } = await new ContextBuilder({ weather }).build({ minutes: 20, energy: 'easy' });
    expect(context).toEqual({
      minutes: 20,
      energy: 'easy',
      availability: { weather: 'not_requested', daylight: 'not_requested' },
      guidance: [],
    });
    expect(weather.cities).toHaveLength(0); // nothing was looked up
    expect(timings.weatherMs).toBeUndefined();
  });

  it('weather ok but no sunrise/sunset: weather and time are kept, daylight is unavailable', async () => {
    const weather = FakeWeatherProvider.observing({ sunriseLocal: undefined, sunsetLocal: undefined });
    const { context } = await new ContextBuilder({ weather, now: at('12:00') }).build({ minutes: 10, energy: 'normal', location: { city: 'Oslo' } });
    expect(context.weather).toBeDefined();
    expect(context.timeOfDay).toBe('afternoon');
    expect(context.daylight).toBeUndefined();
    expect(context.availability).toEqual({ weather: 'ok', daylight: 'unavailable' });
  });

  it('an unknown time zone from a provider degrades to "no time, no daylight", not an exception', async () => {
    const weather = FakeWeatherProvider.observing({ timezone: 'Mars/Olympus' });
    const { context } = await new ContextBuilder({ weather }).build({ minutes: 10, energy: 'normal', location: { city: 'Oslo' } });
    expect(context.weather).toBeDefined();
    expect(context.timeOfDay).toBeUndefined();
    expect(context.availability).toEqual({ weather: 'ok', daylight: 'unavailable' });
  });
});

describe('Test 2: weather provider failure', () => {
  const req = { minutes: 20 as const, energy: 'normal' as const, location: { city: 'Oslo' } };

  it.each(['unavailable', 'rate_limited', 'misconfigured', 'location_not_found', 'malformed'] as const)(
    'provider failure %s -> context says so and the build still succeeds',
    async (reason) => {
      const { context, timings } = await new ContextBuilder({ weather: FakeWeatherProvider.failing(reason) }).build(req);
      expect(context.weather).toBeUndefined();
      expect(context.availability).toEqual({ weather: 'unavailable', daylight: 'unavailable' });
      expect(context.weatherFailure).toBe(reason);
      expect(timings.weatherMs).toBeGreaterThanOrEqual(0); // an attempt was made and measured
    },
  );

  it('no provider configured -> not_configured', async () => {
    const { context, timings } = await new ContextBuilder().build(req);
    expect(context.weatherFailure).toBe('not_configured');
    expect(timings.weatherMs).toBeUndefined();
  });

  it('a hanging provider is cut off at the budget (timeout)', async () => {
    const started = performance.now();
    const { context } = await new ContextBuilder({ weather: FakeWeatherProvider.hanging(), weatherTimeoutMs: 80 }).build(req);
    expect(context.weatherFailure).toBe('timeout');
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('aborts the in-flight lookup when the budget is exceeded', async () => {
    let aborted = false;
    const weather = new FakeWeatherProvider(
      (_c, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }))
    );
    const { context } = await new ContextBuilder({ weather, weatherTimeoutMs: 50 }).build(req);
    expect(context.weatherFailure).toBe('timeout'); // not "unknown", even though the provider rejected with a plain Error
    expect(aborted).toBe(true);
  });

  it('a provider bug (non-WeatherError) is contained as "unknown"', async () => {
    const { context } = await new ContextBuilder({ weather: FakeWeatherProvider.crashing() }).build(req);
    expect(context.weatherFailure).toBe('unknown');
    expect(JSON.stringify(context)).not.toContain('secret');
  });
});

describe('client-safe summary', () => {
  it('contains enumerated facts only: no city, no timezone, no coordinates', async () => {
    const weather = FakeWeatherProvider.observing({ timezone: 'Asia/Kolkata', condition: 'rain', precipitation: 'light' });
    // 06:30Z is 12:00 local in Kolkata: a plain daytime walk, so only the rain guidance applies.
    const { context } = await new ContextBuilder({ weather, now: at('06:30') }).build({ minutes: 20, energy: 'normal', location: { city: 'Jalandhar' } });
    const json = JSON.stringify(summarizeContext(context));
    expect(json).not.toContain('Jalandhar');
    expect(json).not.toContain('Kolkata');
    expect(summarizeContext(context)).toMatchObject({ weather: 'ok', daylight: 'ok', conditions: { condition: 'rain' }, guidance: ['wet'] });
  });
});

describe('weather configuration', () => {
  it('defaults to Open-Meteo (no key needed) with a 3 s budget; blank values count as unset', () => {
    const env = loadEnv({ WEATHER_PROVIDER: '', WEATHER_TIMEOUT_MS: '' });
    expect(env.WEATHER_PROVIDER).toBe('open-meteo');
    expect(env.WEATHER_TIMEOUT_MS).toBe(3000);
    expect(createWeatherProvider(env)?.name).toBe('open-meteo');
  });
  it('can be switched off', () => {
    expect(createWeatherProvider(loadEnv({ WEATHER_PROVIDER: 'none' }))).toBeNull();
  });
  it('rejects unknown providers and out-of-range budgets, without printing the value', () => {
    expect(() => loadEnv({ WEATHER_PROVIDER: 'acme' })).toThrow(/WEATHER_PROVIDER/);
    expect(() => loadEnv({ WEATHER_TIMEOUT_MS: '50' })).toThrow(/WEATHER_TIMEOUT_MS/);
    expect(() => loadEnv({ WEATHER_TIMEOUT_MS: '999999' })).toThrow(/WEATHER_TIMEOUT_MS/);
    try { loadEnv({ WEATHER_PROVIDER: 'SUPERSECRETVALUE' }); } catch (e) { expect(String(e)).not.toContain('SUPERSECRETVALUE'); }
  });
  it('a weather provider needs no credential, so there is no weather key anywhere in the environment schema', () => {
    expect(Object.keys(loadEnv({}))).not.toContain('WEATHER_API_KEY');
  });
});
