import { describe, expect, it } from 'vitest';
import { MAX_NOTICE_CHARS, MAX_STEP_MINUTES, MAX_STEP_TEXT_CHARS, parsePlanShape } from '../src/ai/planSchema';
import { MAX_TITLE_CHARS } from '../src/ai/prompt';
import { planObj } from './helpers/plans';

const failsAt = (candidate: unknown): string[] => {
  const r = parsePlanShape(candidate);
  if (r.ok) throw new Error('expected schema failure');
  return r.paths;
};

describe('WalkPlan schema: valid', () => {
  it('accepts a valid plan and returns exactly the domain shape', () => {
    const r = parsePlanShape(planObj(20));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.plan).sort()).toEqual(['notice', 'steps', 'title']);
      expect(r.unknownKeysDropped).toBe(false);
    }
  });
});

describe('WalkPlan schema: structure (the cases the spec calls invalid)', () => {
  it('missing field', () => {
    const { notice: _n, ...noNotice } = planObj(20);
    expect(failsAt(noNotice)).toContain('notice');
    const { title: _t, ...noTitle } = planObj(20);
    expect(failsAt(noTitle)).toContain('title');
  });
  it('wrong type: minutes "twenty"', () => {
    const p = planObj(20);
    p.steps[0].minutes = 'twenty';
    expect(failsAt(p)).toContain('steps.0.minutes');
  });
  it('wrong type: steps is a string, not an array', () => {
    expect(failsAt(planObj(20, { steps: 'walk around' }))).toContain('steps');
  });
  it('wrong type: title is a number; root is an array; root is null', () => {
    expect(failsAt(planObj(20, { title: 5 }))).toContain('title');
    expect(failsAt([])).toContain('(root)');
    expect(failsAt(null)).toContain('(root)');
  });
  it('intensity "extreme" is not a supported value', () => {
    expect(failsAt(planObj(20, { intensity: 'extreme' }))).toContain('intensity');
  });
  it('negative, zero and fractional minutes', () => {
    for (const bad of [-20, 0, 2.5]) {
      const p = planObj(20);
      p.steps[1].minutes = bad;
      expect(failsAt(p)).toContain('steps.1.minutes');
    }
  });
  it(`absurd duration: 500 minutes (limit ${MAX_STEP_MINUTES})`, () => {
    const p = planObj(20);
    p.steps[0].minutes = 500;
    expect(failsAt(p)).toContain('steps.0.minutes');
  });
  it('step count: empty, one, four and hundreds of steps', () => {
    expect(failsAt(planObj(20, { steps: [] }))).toContain('steps');
    expect(failsAt(planObj(20, { steps: [{ minutes: 20, text: 'Walk.' }] }))).toContain('steps');
    const many = Array.from({ length: 500 }, () => ({ minutes: 1, text: 'Walk.' }));
    expect(failsAt(planObj(20, { steps: many }))).toContain('steps');
    expect(failsAt(planObj(20, { steps: [...planObj(20).steps, { minutes: 1, text: 'Extra.' }] }))).toContain('steps');
  });
});

describe('WalkPlan schema: empty and oversized values', () => {
  it('empty and whitespace-only strings are rejected', () => {
    expect(failsAt(planObj(20, { title: '' }))).toContain('title');
    expect(failsAt(planObj(20, { notice: '   ' }))).toContain('notice');
    const p = planObj(20);
    p.steps[2].text = '\n\t ';
    expect(failsAt(p)).toContain('steps.2.text');
  });
  it('oversized title, step text and notice are rejected', () => {
    expect(failsAt(planObj(20, { title: 'x'.repeat(MAX_TITLE_CHARS + 1) }))).toContain('title');
    const p = planObj(20);
    p.steps[0].text = 'x'.repeat(MAX_STEP_TEXT_CHARS + 1);
    expect(failsAt(p)).toContain('steps.0.text');
    expect(failsAt(planObj(20, { notice: 'x'.repeat(MAX_NOTICE_CHARS + 1) }))).toContain('notice');
  });
  it('limits are inclusive: exactly at the limit passes the schema', () => {
    expect(parsePlanShape(planObj(20, { title: 'x'.repeat(MAX_TITLE_CHARS) })).ok).toBe(true);
  });
  it('schema errors report paths, never values', () => {
    const paths = failsAt(planObj(20, { title: 'SECRET-MODEL-TEXT'.repeat(10) }));
    expect(JSON.stringify(paths)).not.toContain('SECRET');
  });
});

describe('WalkPlan schema: extra fields', () => {
  it('unknown keys are stripped and reported, never passed through', () => {
    const p = planObj(20, { debug: 'x', systemPrompt: 'leak' });
    p.steps[0].extra = true;
    const r = parsePlanShape(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.unknownKeysDropped).toBe(true);
      expect(JSON.stringify(r.plan)).not.toContain('leak');
      expect(JSON.stringify(r.plan)).not.toContain('extra');
    }
  });
  it('a valid intensity is accepted but dropped from the plan (the application owns intensity)', () => {
    const r = parsePlanShape(planObj(20, { intensity: 'easy' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intensity).toBe('easy');
      expect('intensity' in r.plan).toBe(false);
    }
  });
});
