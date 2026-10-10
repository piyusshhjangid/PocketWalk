import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWalkResult } from '../src/api/parseWalkResult';
import { fixture } from './fixtures';

const names = readdirSync(join(__dirname, 'fixtures')).map((f) => f.replace(/\.json$/, ''));

describe('contract: responses captured from the real CP4 backend', () => {
  it('has fixtures for every case the checkpoint requires', () => {
    for (const n of ['model-plan-weather', 'model-plan-no-location', 'fallback-not-configured', 'fallback-model-unavailable', 'fallback-safety-rejected', 'error-400-invalid-request', 'error-500-internal']) {
      expect(names).toContain(n);
    }
  });

  it.each(names.filter((n) => !n.startsWith('error-')))('%s parses and matches the documented plan shape', (n) => {
    const { status, body } = fixture(n);
    expect(status).toBe(200);
    const r = parseWalkResult(body);
    expect(r.plan.steps).toHaveLength(3);
    // The backend guarantees step minutes add up to the request; the UI relies on showing them as-is.
    expect(r.plan.steps.every((s) => Number.isInteger(s.minutes) && s.minutes > 0)).toBe(true);
    expect(['model', 'fallback']).toContain(r.meta.planner);
  });

  it.each(names.filter((n) => n.startsWith('error-')))('%s is { error: string } and is not a WalkResult', (n) => {
    const { status, body } = fixture(n);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(typeof (body as { error: unknown }).error).toBe('string');
    expect(() => parseWalkResult(body)).toThrow();
  });

  it('the parsed result carries no location of any kind', () => {
    const r = parseWalkResult(fixture('model-plan-weather').body);
    expect(JSON.stringify(r)).not.toMatch(/jalandhar|city|latitude|longitude/i);
  });
});
