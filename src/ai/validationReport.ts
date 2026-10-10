/** Stage-by-stage record of what happened to model output. Closed vocabulary: no text, no values. */

export type StageStatus = 'passed' | 'failed' | 'not_run';

export type RepairCode =
  | 'invisible_chars_removed' // zero-width / control characters
  | 'markdown_stripped' // emphasis markers, backticks, list bullets
  | 'whitespace_normalised' // runs of spaces collapsed
  | 'unknown_keys_dropped'; // extra keys the schema does not define

export interface StageTimings {
  parseMs?: number;
  schemaMs?: number;
  repairMs?: number;
  businessMs?: number;
  safetyMs?: number;
  /** Wall-clock for the whole validation pipeline (all stages that ran). */
  totalMs: number;
}

export interface ValidationReport {
  parse: StageStatus;
  schema: StageStatus;
  business: StageStatus;
  safety: StageStatus;
  repaired: boolean;
  repairs: RepairCode[];
  /** Rule / issue codes behind a failure. Closed set of ids, never plan text. Internal and traces only. */
  failureCodes: string[];
  timingsMs: StageTimings;
}

/** What is safe to show a client: statuses and repair codes, nothing more. */
export type ValidationSummary = Pick<ValidationReport, 'parse' | 'schema' | 'business' | 'safety' | 'repaired' | 'repairs'>;

export function notRunReport(): ValidationReport {
  return {
    parse: 'not_run',
    schema: 'not_run',
    business: 'not_run',
    safety: 'not_run',
    repaired: false,
    repairs: [],
    failureCodes: [],
    timingsMs: { totalMs: 0 },
  };
}

export function summarize(r: ValidationReport): ValidationSummary {
  return { parse: r.parse, schema: r.schema, business: r.business, safety: r.safety, repaired: r.repaired, repairs: [...r.repairs] };
}
