import type { RepairCode } from './validationReport';
import type { WalkPlan } from './walkPlanner';

/**
 * Repair = harmless, deterministic NORMALISATION of presentation. It never changes the meaning of a
 * plan, never invents content, and never touches minutes. Everything else is rejection.
 *
 *   Repairable : invisible/control characters, markdown emphasis/bullets, runs of whitespace, unknown keys.
 *   Rejected   : wrong duration, too many/few steps, too-long wording, empty text, anything the
 *                safety layer flags, anything unparseable. (Truncating or re-splitting would be guessing.)
 */

const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
const MARKDOWN_EMPHASIS = /[*_`~]+/g;
const LEADING_BULLET = /^\s*(?:[-\u2022#>]+|\d+[.)])\s+/;
const WHITESPACE_RUN = /\s{2,}/g;

function cleanText(input: string, codes: Set<RepairCode>): string {
  let s = input.replace(/[\t\n\r\f\v]/g, ' ');
  const noInvisible = s.replace(INVISIBLE, '');
  if (noInvisible !== s) codes.add('invisible_chars_removed');
  s = noInvisible;

  const noMarkdown = s.replace(LEADING_BULLET, '').replace(MARKDOWN_EMPHASIS, '');
  if (noMarkdown !== s) codes.add('markdown_stripped');
  s = noMarkdown;

  const collapsed = s.replace(WHITESPACE_RUN, ' ').trim();
  if (collapsed !== s.trim()) codes.add('whitespace_normalised');
  return collapsed;
}

export function repairPlan(plan: WalkPlan, unknownKeysDropped: boolean): { plan: WalkPlan; repairs: RepairCode[] } {
  const codes = new Set<RepairCode>();
  if (unknownKeysDropped) codes.add('unknown_keys_dropped');
  const repaired: WalkPlan = {
    title: cleanText(plan.title, codes),
    steps: plan.steps.map((s) => ({ minutes: s.minutes, text: cleanText(s.text, codes) })),
    notice: cleanText(plan.notice, codes),
  };
  return { plan: repaired, repairs: [...codes] };
}
