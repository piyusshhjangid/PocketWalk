import type { ApiError } from '../api/apiError';
import type { Energy, OutdoorContext, WalkMinutes, WalkRequest } from '../types/walk';

export const MINUTE_OPTIONS: { value: WalkMinutes; label: string; hint: string }[] = [
  { value: 10, label: '10 min', hint: 'Quick reset' },
  { value: 20, label: '20 min', hint: 'Just right' },
  { value: 40, label: '40 min', hint: 'Unhurried' },
];

export const ENERGY_OPTIONS: { value: Energy; label: string; hint: string }[] = [
  { value: 'easy', label: 'Easy', hint: 'Slow and gentle' },
  { value: 'normal', label: 'Normal', hint: 'Your usual pace' },
];

export const energyLabel = (e: Energy): string => (e === 'easy' ? 'Easy' : 'Normal');
export const minutesLabel = (m: number): string => `${m} minutes`;

const CONDITION_LABELS: Record<string, string> = {
  clear: 'clear',
  cloudy: 'cloudy',
  fog: 'foggy',
  drizzle: 'drizzle',
  rain: 'rain',
  freezing_rain: 'freezing rain',
  snow: 'snow',
  thunderstorm: 'thunderstorm',
};

/** "18°C, light rain". Only from fields the backend returned; null when there is nothing to say. */
export function weatherLine(ctx: OutdoorContext): string | null {
  if (ctx.weather !== 'ok' || !ctx.conditions) return null;
  const { condition, temperatureC, precipitation } = ctx.conditions;
  const wet = ['drizzle', 'rain', 'snow'].includes(condition);
  const prefix = wet && (precipitation === 'light' || precipitation === 'heavy') ? `${precipitation} ` : '';
  const base = condition === 'clear' ? 'clear skies' : (CONDITION_LABELS[condition] ?? condition);
  return `${Math.round(temperatureC)}°C, ${prefix}${base}`;
}

/** Only the phases worth mentioning; ordinary daytime says nothing. */
export function daylightLine(ctx: OutdoorContext): string | null {
  if (ctx.daylight !== 'ok') return null;
  switch (ctx.daylightPhase) {
    case 'near_sunset':
      return 'Near sunset';
    case 'near_sunrise':
      return 'Near sunrise';
    case 'night':
      return 'After dark';
    default:
      return null;
  }
}

export interface ErrorCopy {
  title: string;
  body: string;
}

/** Fixed copy per failure kind. Nothing from the server is ever shown. */
export function errorCopy(error: ApiError, request: WalkRequest): ErrorCopy {
  const title = "We couldn\u2019t prepare your walk right now.";
  switch (error.kind) {
    case 'network':
      return { title, body: "PocketWalk can't be reached. Check your connection and try again." };
    case 'timeout':
      return { title, body: 'That took longer than expected. Try again in a moment.' };
    case 'busy':
      return { title, body: 'PocketWalk is busy right now. Try again in a moment.' };
    case 'invalid_request':
      return {
        title,
        body: request.location
          ? "Those settings weren't accepted. Check the city name, or leave it blank."
          : "Those settings weren't accepted. Change them and try again.",
      };
    default:
      return { title, body: 'Something went wrong on our side. Try again in a moment.' };
  }
}

/** Mirrors the backend's city rule (2 to 80 letters, spaces and . , ' -) so typos are caught before a request. */
const CITY_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .,'\u2019-]*$/u;
export function validateCity(raw: string): string | null {
  const city = raw.trim();
  if (city === '') return null;
  if (city.length < 2 || city.length > 80 || !CITY_PATTERN.test(city)) {
    return 'Use 2 to 80 letters. Numbers and symbols are not supported.';
  }
  return null;
}
