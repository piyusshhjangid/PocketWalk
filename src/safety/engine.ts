import type { WalkPlan } from '../ai/walkPlanner';
import type { OutdoorContext } from '../context/types';
import { DEFAULT_RULES, type LexiconRule, type RuleScope, type SafetyRule } from './rules';
import { findPhrase, isExcusedMention, stripPhoneAwayPhrases, tokenize } from './text';
import type { SafetyRequest, SafetyResult, SafetyViolation } from './types';

interface Unit {
  field: string;
  tokens: string[];
}

/** The text a person would read, field by field. */
function unitsOf(plan: WalkPlan): Unit[] {
  return [
    { field: 'title', tokens: tokenize(plan.title) },
    ...plan.steps.map((s, i) => ({ field: `steps[${i}]`, tokens: tokenize(s.text) })),
    { field: 'notice', tokens: tokenize(plan.notice) },
  ];
}

function lexiconHits(rule: LexiconRule, tokens: readonly string[]): number[] {
  const idx: number[] = [];
  const exact = new Set(rule.tokens ?? []);
  const stems = rule.stems ?? [];
  tokens.forEach((t, i) => {
    if (exact.has(t) || stems.some((s) => t.startsWith(s))) idx.push(i);
  });
  for (const phrase of rule.phrases ?? []) idx.push(...findPhrase(tokens, tokenize(phrase)));
  return idx;
}

/**
 * The deterministic safety layer.
 *
 *   engine.validate(plan, context, request)  ->  { ok: true } | { ok: false, violations }
 *
 * It takes plain domain objects only. It does not know whether the plan came from Gemma, another
 * model, a human, or the fallback planner, and it never calls anything. The same input always gives
 * the same answer. It only rejects: it does not rewrite a plan to make it safe (see "repair vs rejection"
 * in docs/architecture.md).
 */
export class SafetyEngine {
  constructor(private readonly rules: readonly SafetyRule[] = DEFAULT_RULES) {}

  validate(plan: WalkPlan, context: OutdoorContext, request: SafetyRequest): SafetyResult {
    const scope: RuleScope = { context, request };
    const units = unitsOf(plan);
    const found = new Map<string, SafetyViolation>();
    const add = (rule: SafetyRule, field: string): void => {
      found.set(`${rule.id}@${field}`, { rule: rule.id, category: rule.category, field });
    };

    for (const rule of this.rules) {
      if (rule.when && !rule.when(scope)) continue;

      if (rule.kind === 'plan') {
        const all = units.flatMap((u) => u.tokens);
        if (rule.violated(all)) add(rule, 'plan');
        continue;
      }

      for (const unit of units) {
        if (rule.kind === 'lexicon') {
          const tokens = rule.allowPhoneAway ? stripPhoneAwayPhrases(unit.tokens) : unit.tokens;
          const hits = lexiconHits(rule, tokens);
          if (hits.some((i) => !rule.excusable || !isExcusedMention(tokens, i))) add(rule, unit.field);
        } else {
          const verbs = new Set(rule.verbs);
          const nouns = new Set(rule.nouns);
          const t = unit.tokens;
          const hit = t.some((tok, i) => verbs.has(tok) && t.slice(i + 1, i + 1 + rule.window).some((n) => nouns.has(n)));
          if (hit) add(rule, unit.field);
        }
      }
    }

    return found.size === 0 ? { ok: true } : { ok: false, violations: [...found.values()] };
  }
}

export const defaultSafetyEngine = new SafetyEngine();
