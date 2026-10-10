import { describe, expect, it } from 'vitest';
import { checkBusiness } from '../src/ai/businessRules';
import { MAX_PLAN_TEXT_CHARS } from '../src/ai/planSchema';
import { MAX_WORDS } from '../src/ai/prompt';
import type { WalkPlan } from '../src/ai/walkPlanner';
import { planObj } from './helpers/plans';

const req = (minutes = 20, energy: 'easy' | 'normal' = 'normal') => ({ minutes, energy });
const plan = (minutes = 20, over: Record<string, unknown> = {}) => planObj(minutes, over) as WalkPlan;
const codes = (p: WalkPlan, r = req(), intensity?: 'easy' | 'normal') => checkBusiness(p, r, intensity).map((i) => i.code);

describe('business rules: duration', () => {
  it('a plan that adds up exactly passes', () => {
    for (const m of [10, 20, 40]) expect(codes(plan(m), req(m))).toEqual([]);
  });
  it('longer than requested is rejected (no silent 60-minute plan for a 10-minute request)', () => {
    const p = plan(10);
    p.steps = [{ minutes: 20, text: 'Walk.' }, { minutes: 20, text: 'Sit.' }, { minutes: 20, text: 'Walk.' }];
    expect(codes(p, req(10))).toContain('duration_exceeds_request');
  });
  it('shorter than requested is rejected, with a distinct code', () => {
    const p = plan(20);
    p.steps[1]!.minutes = 1;
    expect(codes(p)).toContain('duration_below_request');
  });
  it('a single step longer than the whole walk is rejected', () => {
    const p = plan(10);
    p.steps = [{ minutes: 40, text: 'Walk.' }, { minutes: 1, text: 'Sit.' }, { minutes: 1, text: 'Walk.' }];
    expect(codes(p, req(10))).toContain('step_exceeds_request');
  });
});

describe('business rules: steps', () => {
  it('a step under 10% of the walk is "excessively tiny"', () => {
    const p = plan(40);
    p.steps = [{ minutes: 1, text: 'Walk.' }, { minutes: 38, text: 'Walk on.' }, { minutes: 1, text: 'Walk.' }];
    expect(codes(p, req(40))).toContain('step_too_short');
  });
  it('negative and zero-minute steps never reach this stage: the schema stops them', () => {
    // asserted in planSchema.test.ts; here we assert the rule would also catch zero if it did
    const p = plan(20);
    p.steps[0]!.minutes = 0;
    expect(codes(p)).toContain('step_too_short');
  });
  it(`wording over ${MAX_WORDS} words is rejected for steps and notice, not for the title`, () => {
    const long = 'word '.repeat(MAX_WORDS + 1).trim();
    const p = plan(20);
    p.steps[0]!.text = long;
    p.notice = long;
    p.title = 'A title';
    const found = checkBusiness(p, req()).filter((i) => i.code === 'word_limit_exceeded').map((i) => i.field);
    expect(found.sort()).toEqual(['notice', 'steps[0]']);
  });
  it('empty text after normalisation is rejected', () => {
    const p = plan(20);
    p.steps[0]!.text = '   ';
    expect(codes(p)).toContain('empty_text');
  });
});

describe('business rules: content hygiene and size', () => {
  it('total output over budget is rejected even if every field is within its own limit', () => {
    const p = plan(20);
    p.title = 'x'.repeat(40);
    const fourteenWords = 'abcdefghijkl '.repeat(MAX_WORDS).trim(); // 181 chars: under the 200 schema limit and the word limit
    for (const s of p.steps) s.text = fourteenWords;
    p.notice = fourteenWords;
    const total = p.title.length + p.steps.reduce((n, s) => n + s.text.length, 0) + p.notice.length;
    expect(total).toBeGreaterThan(MAX_PLAN_TEXT_CHARS);
    expect(codes(p)).toEqual(['output_too_large']); // and nothing else is wrong with it
  });
  it('markup, links and domains are rejected', () => {
    for (const text of ['Walk <b>slowly</b> now.', 'Visit https://example.com today.', 'Go to www.example.com.', 'See walks.example.com info.']) {
      const p = plan(20);
      p.steps[1]!.text = text;
      expect(codes(p), text).toContain('markup_or_link');
    }
  });
  it('characters outside Latin/common script are rejected (closes the homoglyph hole)', () => {
    const p = plan(20);
    p.steps[1]!.text = 'Walk to the r\u043Ead.'; // Cyrillic "о"
    expect(codes(p)).toContain('unexpected_characters');
    p.steps[1]!.text = '\u6B69\u3044\u3066\u304F\u3060\u3055\u3044'; // CJK
    expect(codes(p)).toContain('unexpected_characters');
  });
  it('ordinary punctuation, digits, accents and emoji are fine', () => {
    const p = plan(20);
    p.steps[1]!.text = 'Pause for 2 breaths \u2014 caf\u00E9 smells nice \uD83D\uDE42.';
    expect(codes(p)).toEqual([]);
  });
});

describe('business rules: intensity', () => {
  it('a model-volunteered "normal" intensity cannot exceed a requested "easy" walk', () => {
    expect(codes(plan(20), req(20, 'easy'), 'normal')).toContain('intensity_exceeds_request');
    expect(codes(plan(20), req(20, 'easy'), 'easy')).toEqual([]);
    expect(codes(plan(20), req(20, 'normal'), 'easy')).toEqual([]);
  });
});

describe('business rules: all issues are reported, not just the first', () => {
  it('returns every broken rule with its field', () => {
    const p = plan(20);
    p.steps = [{ minutes: 15, text: '   ' }, { minutes: 15, text: 'Walk.' }, { minutes: 15, text: 'Walk.' }];
    const found = codes(p);
    expect(found).toEqual(expect.arrayContaining(['duration_exceeds_request', 'empty_text']));
  });
});
