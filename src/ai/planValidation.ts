import { PlannerError } from './errors';
import { checkBusiness } from './businessRules';
import { parsePlanShape } from './planSchema';
import { repairPlan } from './planRepair';
import type { OutdoorContext } from '../context/types';
import { defaultSafetyEngine, type SafetyEngine } from '../safety/engine';
import type { WalkContext, WalkPlan } from './walkPlanner';

/** Model text longer than this is rejected before parsing. A real plan is a few hundred chars. */
export const MAX_RAW_CHARS = 4000;

export interface ExtractedJson {
  value: unknown;
  /** True when the JSON had to be cut out of a code fence or surrounding sentence. */
  extracted: boolean;
}

/** Pull a JSON object out of model text. Tolerates a ```json fence or a sentence around the object. */
export function extractJsonDetailed(raw: string): ExtractedJson {
  let candidate = raw.trim();
  let extracted = false;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(candidate);
  if (fenced?.[1] !== undefined) {
    candidate = fenced[1].trim();
    extracted = true;
  }
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) throw new PlannerError('invalid_json', 'No JSON object in model output');
    candidate = candidate.slice(start, end + 1);
    extracted = true;
  }
  try {
    return { value: JSON.parse(candidate), extracted };
  } catch {
    throw new PlannerError('invalid_json', 'Model output is not valid JSON');
  }
}

export function extractJson(raw: string): unknown {
  return extractJsonDetailed(raw).value;
}

/**
 * Synchronous composition of every authoritative layer, for callers that do not need per-stage
 * telemetry (tests, scripts):  schema -> repair -> business rules -> safety rules.
 * Throws PlannerError. Returns the clean, repaired plan. The instrumented pipeline
 * (validationPipeline.ts) runs the same stage functions, with spans and timings.
 */
export function validatePlan(
  candidate: unknown,
  context: WalkContext | OutdoorContext,
  engine: SafetyEngine = defaultSafetyEngine,
): WalkPlan {
  const shape = parsePlanShape(candidate);
  if (!shape.ok) throw new PlannerError('schema_invalid', `Plan failed schema validation at: ${shape.paths.join(', ')}`);

  const { plan } = repairPlan(shape.plan, shape.unknownKeysDropped);
  const request = { minutes: context.minutes, energy: context.energy };

  const issues = checkBusiness(plan, request, shape.intensity);
  if (issues.length > 0) {
    throw new PlannerError('business_rule', `Plan broke business rules: ${issues.map((i) => `${i.code}@${i.field}`).join(', ')}`);
  }
  const safety = engine.validate(plan, context as OutdoorContext, request);
  if (!safety.ok) {
    throw new PlannerError('safety_violation', `Plan broke safety rules: ${safety.violations.map((v) => `${v.rule}@${v.field}`).join(', ')}`);
  }
  return plan;
}

export function parseAndValidate(raw: string, context: WalkContext | OutdoorContext, engine?: SafetyEngine): WalkPlan {
  if (raw.length > MAX_RAW_CHARS) throw new PlannerError('schema_invalid', 'Model output is too long');
  return validatePlan(extractJson(raw), context, engine);
}
