/**
 * Wire types for POST /walks/plan, mirrored from the CP4 backend
 * (src/controllers/walkController.ts, src/ai/walkPlanner.ts, src/services/walkService.ts,
 * src/context/types.ts, src/ai/errors.ts). Only fields the backend really sends are declared.
 * tests/contract.test.ts parses responses captured from the real backend to keep these honest.
 */

export type WalkMinutes = 10 | 20 | 40;
export type Energy = 'easy' | 'normal';

/** Request body. `location.city` is the only location the backend accepts. */
export interface WalkRequest {
  minutes: WalkMinutes;
  energy: Energy;
  location?: { city: string };
}

export interface WalkStep {
  minutes: number;
  text: string;
}

export interface WalkPlan {
  title: string;
  steps: WalkStep[];
  /** The "what to notice" prompt. */
  notice: string;
}

export type Availability = 'ok' | 'unavailable' | 'not_requested';
export type DaylightPhase = 'night' | 'near_sunrise' | 'day' | 'near_sunset';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
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

export interface OutdoorWeather {
  condition: WeatherCondition;
  temperatureC: number;
  temperatureBand: string;
  precipitation: Precipitation;
  wind: string;
}

/** `meta.context`: what PocketWalk knew about the outdoors. Never contains a location. */
export interface OutdoorContext {
  weather: Availability;
  weatherFailure?: string;
  daylight: Availability;
  timeOfDay?: TimeOfDay;
  daylightPhase?: DaylightPhase;
  conditions?: OutdoorWeather;
  guidance: string[];
}

/**
 * `meta`. The backend also sends validation/latency details; the UI deliberately does not model
 * them, so they cannot leak into the interface.
 */
export interface WalkMetadata {
  planner: 'model' | 'fallback';
  fallbackReason?: string;
  fallbackSource?: 'deterministic' | 'emergency';
  context: OutdoorContext;
}

export interface WalkResult {
  plan: WalkPlan;
  meta: WalkMetadata;
}
