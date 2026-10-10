import type { WalkContext } from '../ai/walkPlanner';

/**
 * PocketWalk's own vocabulary for the outdoors. Nothing in this file knows which weather provider
 * exists. Gemma and the API only ever see these enumerated values, never a provider's raw JSON.
 */

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type DaylightPhase = 'night' | 'near_sunrise' | 'day' | 'near_sunset';

export type WeatherCondition =
  | 'clear'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'freezing_rain'
  | 'snow'
  | 'thunderstorm';
export type Precipitation = 'none' | 'light' | 'moderate' | 'heavy';
export type TemperatureBand = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';
export type WindBand = 'calm' | 'breezy' | 'windy' | 'very_windy';

/** What a weather provider hands back, already in PocketWalk terms (see WeatherProvider). */
export interface WeatherObservation {
  /** IANA time zone of the place, e.g. "Asia/Kolkata". Used only to work out local time. */
  timezone: string;
  temperatureC: number;
  feelsLikeC: number;
  windKmh: number;
  condition: WeatherCondition;
  precipitation: Precipitation;
  /** Local wall-clock "YYYY-MM-DDTHH:mm" in `timezone`. Absent when the provider has none. */
  sunriseLocal?: string;
  sunsetLocal?: string;
}

/** The normalised weather facts that reach Gemma and the client. */
export interface OutdoorWeather {
  condition: WeatherCondition;
  /** Whole degrees Celsius. */
  temperatureC: number;
  temperatureBand: TemperatureBand;
  precipitation: Precipitation;
  wind: WindBand;
}

/** Why weather could not be used. A closed set: no provider text ever reaches a client. */
export type WeatherFailureReason =
  | 'not_configured' // location given, but no weather provider is configured
  | 'location_not_found' // provider could not match the city
  | 'timeout' // lookup exceeded WEATHER_TIMEOUT_MS
  | 'unavailable' // network failure or provider 5xx
  | 'rate_limited' // provider 429
  | 'misconfigured' // provider 4xx other than 429
  | 'malformed' // provider answered with something we could not trust
  | 'unknown'; // unexpected bug; also captured to Sentry

export type Availability = 'ok' | 'unavailable' | 'not_requested';

/**
 * Deterministic rules the application derives from the facts. Each code maps to one fixed sentence in
 * the prompt, and to one branch in the fallback planner. Gemma never decides these.
 * Full safety and repair rules are Checkpoint 4. These are the minimum so that context cannot
 * push the planner toward an obviously poor walk.
 */
export type Guidance =
  | 'poor_conditions' // thunderstorm, freezing rain, heavy precipitation, very strong wind, extreme heat or cold
  | 'dark' // after dark
  | 'low_visibility' // near sunrise or sunset, the walk would end after sunset, or fog
  | 'wet' // precipitation that is not severe
  | 'hot'
  | 'cold'
  | 'windy';

/** Everything a planner may know about the walk. All extras are optional: Checkpoint 2 callers still work. */
export interface OutdoorContext extends WalkContext {
  timeOfDay?: TimeOfDay;
  daylight?: DaylightPhase;
  /** True when "now + walk length" is later than sunset. */
  walkEndsAfterSunset?: boolean;
  weather?: OutdoorWeather;
  availability?: { weather: Availability; daylight: Availability };
  weatherFailure?: WeatherFailureReason;
  guidance?: Guidance[];
}

/** The part of the context that is safe and useful to show the client (no location of any kind). */
export interface ContextSummary {
  weather: Availability;
  weatherFailure?: WeatherFailureReason;
  daylight: Availability;
  timeOfDay?: TimeOfDay;
  daylightPhase?: DaylightPhase;
  conditions?: OutdoorWeather;
  guidance: Guidance[];
}
