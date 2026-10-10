import type { Energy } from '../ai/walkPlanner';

/**
 * The safety layer's vocabulary. Nothing here knows which model, provider or SDK produced a plan:
 * the engine receives plain domain objects (WalkPlan, OutdoorContext, the walk request).
 */

export type SafetyCategory =
  | 'traffic'
  | 'restricted_area'
  | 'climbing'
  | 'animals'
  | 'water'
  | 'ingestion'
  | 'fire'
  | 'strangers'
  | 'device_use'
  | 'unsafe_behaviour'
  | 'intensity'
  | 'weather'
  | 'visibility'
  | 'claims'
  | 'injection_artifact';

/**
 * One broken rule. It deliberately carries NO plan text: only the rule id, its category and which
 * field it hit. That keeps violations safe to put in traces and logs.
 */
export interface SafetyViolation {
  rule: string;
  category: SafetyCategory;
  /** `title`, `steps[0]`..`steps[2]`, `notice`, or `plan` for whole-plan constraints. */
  field: string;
}

export type SafetyResult = { ok: true } | { ok: false; violations: SafetyViolation[] };

/** The part of the original walk request the safety layer needs. A WalkRequest satisfies this. */
export interface SafetyRequest {
  minutes: number;
  energy: Energy;
}
