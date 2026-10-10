import type {
  DaylightPhase,
  Guidance,
  OutdoorContext,
  OutdoorWeather,
  TemperatureBand,
  WeatherObservation,
  WindBand,
} from './types';

/** Feels-like temperature (deg C) -> band. The edges are product choices, not measurements. */
export function temperatureBand(feelsLikeC: number): TemperatureBand {
  if (feelsLikeC <= 0) return 'freezing';
  if (feelsLikeC <= 8) return 'cold';
  if (feelsLikeC <= 16) return 'cool';
  if (feelsLikeC <= 24) return 'mild';
  if (feelsLikeC < 32) return 'warm';
  return 'hot';
}

/** Wind speed (km/h) -> band. */
export function windBand(kmh: number): WindBand {
  if (kmh < 12) return 'calm';
  if (kmh < 30) return 'breezy';
  if (kmh < 50) return 'windy';
  return 'very_windy';
}

export const HEAT_FEELS_LIKE_C = 32;
export const EXTREME_HEAT_FEELS_LIKE_C = 40;
export const COLD_FEELS_LIKE_C = 3;
export const EXTREME_COLD_FEELS_LIKE_C = -10;

/** A provider observation -> the small weather facts PocketWalk keeps. Raw fields are dropped here. */
export function normalizeWeather(obs: WeatherObservation): OutdoorWeather {
  return {
    condition: obs.condition,
    temperatureC: Math.round(obs.temperatureC),
    temperatureBand: temperatureBand(obs.feelsLikeC),
    precipitation: obs.precipitation,
    wind: windBand(obs.windKmh),
  };
}

/**
 * Deterministic rules from facts. Pure function: same facts, same guidance, in a fixed order.
 * `feelsLikeC` is passed separately because the normalised weather keeps only a band.
 */
export function deriveGuidance(input: {
  weather?: OutdoorWeather;
  feelsLikeC?: number;
  daylight?: DaylightPhase;
  walkEndsAfterSunset?: boolean;
}): Guidance[] {
  const { weather, feelsLikeC, daylight, walkEndsAfterSunset } = input;
  const out: Guidance[] = [];

  if (weather) {
    const severePrecip =
      weather.condition === 'thunderstorm' ||
      weather.condition === 'freezing_rain' ||
      weather.precipitation === 'heavy';
    const extremeTemp =
      feelsLikeC !== undefined &&
      (feelsLikeC >= EXTREME_HEAT_FEELS_LIKE_C || feelsLikeC <= EXTREME_COLD_FEELS_LIKE_C);
    if (severePrecip || weather.wind === 'very_windy' || extremeTemp) out.push('poor_conditions');
  }

  if (daylight === 'night') out.push('dark');
  else if (
    daylight === 'near_sunrise' ||
    daylight === 'near_sunset' ||
    walkEndsAfterSunset === true ||
    weather?.condition === 'fog'
  ) {
    out.push('low_visibility');
  }

  if (weather) {
    if (weather.precipitation !== 'none') out.push('wet');
    if (feelsLikeC !== undefined && feelsLikeC >= HEAT_FEELS_LIKE_C) out.push('hot');
    if (feelsLikeC !== undefined && feelsLikeC <= COLD_FEELS_LIKE_C) out.push('cold');
    if (weather.wind === 'windy' || weather.wind === 'very_windy') out.push('windy');
  }
  return out;
}

/** Convenience for planners that only have a context. */
export function hasGuidance(context: OutdoorContext, code: Guidance): boolean {
  return context.guidance?.includes(code) ?? false;
}
