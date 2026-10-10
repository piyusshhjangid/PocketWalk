import type { OutdoorContext } from '../context/types';
import type { ValidationReport } from './validationReport';

/**
 * The seam between PocketWalk and whatever produces a walk.
 * Controllers and routes never see a model. Only WalkService sees this interface.
 */
export type Energy = 'easy' | 'normal';

export interface WalkContext {
  minutes: number;
  energy: Energy;
}

export interface WalkPlan {
  title: string;
  steps: { minutes: number; text: string }[];
  notice: string;
}

export interface PlannerResult {
  plan: WalkPlan;
  /** Real measured wall-clock timings in ms. Only present for steps that actually ran. */
  timings?: { modelMs?: number; validationMs?: number };
  /** Stage-by-stage validation record. Present for the model path. */
  validation?: ValidationReport;
}

/** Per-call limits from the request's remaining budget. Both are optional: without them a planner uses its own configured budget. */
export interface PlanOptions {
  /** Aborted when the request's deadline passes or the client disconnects. */
  signal?: AbortSignal;
  /** Upper bound for this call; the planner uses the smaller of this and its configured timeout. */
  timeoutMs?: number;
}

export interface WalkPlanner {
  /**
   * Who produced the plan. `model` means an open-weight model generated it AND the output passed
   * validation. `fallback` means deterministic text. The two are never mixed up in responses.
   */
  readonly kind: 'model' | 'fallback';
  readonly provider?: string;
  readonly model?: string;
  plan(context: OutdoorContext, options?: PlanOptions): Promise<PlannerResult>;
}
