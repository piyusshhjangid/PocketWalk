import type { ValidationReport } from './validationReport';

/**
 * Every way the AI step can fail, as a closed set. Only these enum values ever reach an API
 * client (as `fallbackReason`). Raw provider messages, response bodies and prompts do not.
 */
export type PlannerFailureReason =
  | 'not_configured' // no model provider configured
  | 'timeout' // model did not answer within the budget
  | 'unavailable' // network failure or provider 5xx
  | 'rate_limited' // provider 429
  | 'misconfigured' // provider 4xx other than 429: bad key, wrong model name, bad request
  | 'empty_response' // provider answered with no usable text (or blocked the answer)
  | 'invalid_json' // text was not parseable JSON
  | 'schema_invalid' // JSON parsed but wrong shape / missing fields / wrong types
  | 'business_rule' // right shape, but breaks a PocketWalk rule (e.g. minutes do not add up)
  | 'safety_violation' // valid plan, but the deterministic safety layer rejected it
  | 'unknown'; // unexpected bug; also captured to Sentry

export class PlannerError extends Error {
  constructor(
    public readonly reason: PlannerFailureReason,
    message: string,
    /** Stage-by-stage validation record, when the failure happened after the model answered. Internal: never sent to clients. */
    public readonly report?: ValidationReport,
  ) {
    super(message);
    this.name = 'PlannerError';
  }
}

/**
 * Which pipeline stage a failure reason belongs to. This is the single place that maps PocketWalk's
 * closed reason set onto the error categories used in docs and telemetry:
 *   model (ProviderError / TimeoutError), parse (ModelParseError), schema (SchemaValidationError),
 *   business (BusinessValidationError), safety (SafetyViolationError).
 */
export type FailureStage = 'model' | 'parse' | 'schema' | 'business' | 'safety' | 'none';

export function failureStage(reason: PlannerFailureReason): FailureStage {
  switch (reason) {
    case 'invalid_json':
      return 'parse';
    case 'schema_invalid':
      return 'schema';
    case 'business_rule':
      return 'business';
    case 'safety_violation':
      return 'safety';
    case 'not_configured':
      return 'none';
    default:
      return 'model'; // timeout, unavailable, rate_limited, misconfigured, empty_response, unknown
  }
}
