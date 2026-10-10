import { ApiError } from './apiError';
import type {
  Availability,
  DaylightPhase,
  OutdoorContext,
  Precipitation,
  TimeOfDay,
  WalkMetadata,
  WalkResult,
  WeatherCondition,
} from '../types/walk';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const AVAILABILITY: readonly string[] = ['ok', 'unavailable', 'not_requested'];
const PHASES: readonly string[] = ['night', 'near_sunrise', 'day', 'near_sunset'];
const TIMES: readonly string[] = ['morning', 'afternoon', 'evening', 'night'];
const CONDITIONS: readonly string[] = ['clear', 'cloudy', 'fog', 'drizzle', 'rain', 'freezing_rain', 'snow', 'thunderstorm'];
const PRECIPITATION: readonly string[] = ['none', 'light', 'moderate', 'heavy'];

/**
 * Narrow `unknown` JSON to a WalkResult, or throw ApiError('malformed'). A renderable plan is
 * checked strictly. Context is optional detail: anything unrecognised is dropped, so the UI shows
 * less rather than guessing. Strings stay strings and are rendered as text, never as HTML.
 */
export function parseWalkResult(json: unknown): WalkResult {
  if (!isRecord(json) || !isRecord(json.plan) || !isRecord(json.meta)) throw new ApiError('malformed');
  const { title, steps, notice } = json.plan;
  if (typeof title !== 'string' || title.trim() === '') throw new ApiError('malformed');
  if (typeof notice !== 'string' || notice.trim() === '') throw new ApiError('malformed');
  if (!Array.isArray(steps) || steps.length === 0) throw new ApiError('malformed');

  const parsedSteps = steps.map((s: unknown) => {
    if (!isRecord(s) || typeof s.text !== 'string' || s.text.trim() === '') throw new ApiError('malformed');
    if (typeof s.minutes !== 'number' || !Number.isFinite(s.minutes) || s.minutes < 0) throw new ApiError('malformed');
    return { minutes: s.minutes, text: s.text };
  });

  const planner = json.meta.planner;
  if (planner !== 'model' && planner !== 'fallback') throw new ApiError('malformed');

  const meta: WalkMetadata = { planner, context: parseContext(json.meta.context) };
  if (typeof json.meta.fallbackReason === 'string') meta.fallbackReason = json.meta.fallbackReason;
  const source = json.meta.fallbackSource;
  if (source === 'deterministic' || source === 'emergency') meta.fallbackSource = source;

  return { plan: { title, steps: parsedSteps, notice }, meta };
}

const oneOf = <T extends string>(allowed: readonly string[], v: unknown): T | undefined =>
  typeof v === 'string' && allowed.includes(v) ? (v as T) : undefined;

function parseContext(raw: unknown): OutdoorContext {
  if (!isRecord(raw)) return { weather: 'not_requested', daylight: 'not_requested', guidance: [] };

  const ctx: OutdoorContext = {
    weather: oneOf<Availability>(AVAILABILITY, raw.weather) ?? 'not_requested',
    daylight: oneOf<Availability>(AVAILABILITY, raw.daylight) ?? 'not_requested',
    guidance: Array.isArray(raw.guidance) ? raw.guidance.filter((g: unknown): g is string => typeof g === 'string') : [],
  };
  const phase = oneOf<DaylightPhase>(PHASES, raw.daylightPhase);
  if (phase) ctx.daylightPhase = phase;
  const time = oneOf<TimeOfDay>(TIMES, raw.timeOfDay);
  if (time) ctx.timeOfDay = time;

  const c = raw.conditions;
  if (isRecord(c) && typeof c.temperatureC === 'number' && Number.isFinite(c.temperatureC)) {
    const condition = oneOf<WeatherCondition>(CONDITIONS, c.condition);
    if (condition) {
      ctx.conditions = {
        condition,
        temperatureC: c.temperatureC,
        temperatureBand: typeof c.temperatureBand === 'string' ? c.temperatureBand : '',
        precipitation: oneOf<Precipitation>(PRECIPITATION, c.precipitation) ?? 'none',
        wind: typeof c.wind === 'string' ? c.wind : '',
      };
    }
  }
  return ctx;
}
