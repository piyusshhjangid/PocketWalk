import { describe, expect, it } from 'vitest';
import { parseWalkResult } from '../src/api/parseWalkResult';
import { daylightLine, validateCity, weatherLine } from '../src/app/copy';
import type { OutdoorContext } from '../src/types/walk';
import { fixture } from './fixtures';

describe('outdoor context copy', () => {
  it('shows only what the backend returned', () => {
    const ctx = parseWalkResult(fixture('model-plan-weather').body).meta.context;
    expect(weatherLine(ctx)).toBe('18°C, light rain');
    expect(daylightLine(ctx)).toBeNull(); // plain daytime says nothing
  });

  it('says nothing when no location was sent or weather was unavailable', () => {
    const none = parseWalkResult(fixture('fallback-not-configured').body).meta.context;
    expect(weatherLine(none)).toBeNull();
    expect(daylightLine(none)).toBeNull();
    expect(weatherLine({ weather: 'unavailable', daylight: 'unavailable', guidance: [] })).toBeNull();
  });

  it('mentions the sun only when it matters', () => {
    const base: OutdoorContext = { weather: 'ok', daylight: 'ok', guidance: [] };
    expect(daylightLine({ ...base, daylightPhase: 'near_sunset' })).toBe('Near sunset');
    expect(daylightLine({ ...base, daylightPhase: 'night' })).toBe('After dark');
    expect(daylightLine({ ...base, daylightPhase: 'day' })).toBeNull();
  });
});

describe('city validation (mirrors the backend rule)', () => {
  it.each(['', '  ', 'Pune', 'São Paulo', "Xi'an", 'Paris, France', 'Saint-Étienne'])('accepts %j', (v) => expect(validateCity(v)).toBeNull());
  it.each(['A', '12345', 'Pune1', '<script>', 'http://x.y', '-Paris', 'a'.repeat(81)])('rejects %j', (v) => expect(validateCity(v)).not.toBeNull());
});
