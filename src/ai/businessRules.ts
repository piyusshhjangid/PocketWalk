import { MAX_PLAN_TEXT_CHARS } from './planSchema';
import { MAX_WORDS } from './prompt';
import type { Energy, WalkPlan } from './walkPlanner';

/**
 * PocketWalk's own rules for a plan that already has the right shape. Pure, deterministic, and
 * independent of any model. Returns EVERY broken rule (not just the first) so traces show the full picture.
 */

export type BusinessIssueCode =
  | 'duration_exceeds_request' // steps add up to more than was asked for
  | 'duration_below_request' // steps add up to less than was asked for
  | 'step_exceeds_request' // one step is longer than the whole walk
  | 'step_too_short' // a step is under 10% of the walk
  | 'word_limit_exceeded' // wording too long to read at a glance
  | 'empty_text' // nothing left after normalisation
  | 'unexpected_characters' // characters outside the Latin/common ranges
  | 'markup_or_link' // HTML-like markup or a URL
  | 'output_too_large' // total text over budget
  | 'intensity_exceeds_request';

export interface BusinessIssue {
  code: BusinessIssueCode;
  field: string;
}

export interface BusinessRequest {
  minutes: number;
  energy: Energy;
}

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Every character must be Latin script or Common (digits, punctuation, spaces, symbols) or an
 * Inherited combining mark. This also closes the homoglyph hole: a Cyrillic "а" inside "climb"
 * would sail past the English safety lexicon, so it is rejected here instead.
 */
const ALLOWED_CHARS = /^[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]*$/u;
const MARKUP = /<\s*\/?\s*[a-z!]/i;
const LINK = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|in|co|app|dev|xyz)\b)/i;

export function checkBusiness(plan: WalkPlan, request: BusinessRequest, intensity?: Energy): BusinessIssue[] {
  const issues: BusinessIssue[] = [];
  const add = (code: BusinessIssueCode, field: string): void => void issues.push({ code, field });

  const total = plan.steps.reduce((sum, s) => sum + s.minutes, 0);
  if (total > request.minutes) add('duration_exceeds_request', 'plan');
  else if (total < request.minutes) add('duration_below_request', 'plan');

  const minStep = Math.max(1, Math.ceil(request.minutes * 0.1));
  plan.steps.forEach((s, i) => {
    if (s.minutes > request.minutes) add('step_exceeds_request', `steps[${i}]`);
    if (s.minutes < minStep) add('step_too_short', `steps[${i}]`);
  });

  const texts: [string, string][] = [
    ['title', plan.title],
    ...plan.steps.map((s, i): [string, string] => [`steps[${i}]`, s.text]),
    ['notice', plan.notice],
  ];
  for (const [field, text] of texts) {
    if (text.trim().length === 0) add('empty_text', field);
    if (!ALLOWED_CHARS.test(text)) add('unexpected_characters', field);
    if (MARKUP.test(text) || LINK.test(text)) add('markup_or_link', field);
    if (field !== 'title' && wordCount(text) > MAX_WORDS) add('word_limit_exceeded', field);
  }
  if (texts.reduce((n, [, t]) => n + t.length, 0) > MAX_PLAN_TEXT_CHARS) add('output_too_large', 'plan');

  if (intensity === 'normal' && request.energy === 'easy') add('intensity_exceeds_request', 'plan');
  return issues;
}
