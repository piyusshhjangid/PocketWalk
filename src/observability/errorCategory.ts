import type { PlannerFailureReason } from '../ai/errors';
import { failureStage } from '../ai/errors';
import type { WeatherFailureReason } from '../context/types';

/**
 * The closed set of error categories PocketWalk puts on traces. One place maps the existing
 * reason enums (PlannerFailureReason, WeatherFailureReason) onto engineer-facing names, so a trace
 * answers "what stage failed and what kind of failure was it" without free text.
 * Never contains provider messages, plan text, prompts or locations.
 */
export type ErrorCategory =
  | 'context_timeout'
  | 'context_provider_error'
  | 'context_location_not_found'
  | 'model_not_configured'
  | 'model_timeout'
  | 'model_provider_error'
  | 'model_invalid_output'
  | 'validation_failure'
  | 'safety_rejection'
  | 'unexpected_error';

export function modelErrorCategory(reason: PlannerFailureReason): ErrorCategory {
  switch (reason) {
    case 'not_configured':
      return 'model_not_configured';
    case 'timeout':
      return 'model_timeout';
    case 'unavailable':
    case 'rate_limited':
    case 'misconfigured':
      return 'model_provider_error';
    case 'empty_response':
    case 'invalid_json':
      return 'model_invalid_output';
    case 'schema_invalid':
    case 'business_rule':
      return 'validation_failure';
    case 'safety_violation':
      return 'safety_rejection';
    case 'unknown':
      return 'unexpected_error';
  }
}

export function contextErrorCategory(reason: WeatherFailureReason): ErrorCategory | undefined {
  switch (reason) {
    case 'not_configured':
      return undefined; // a deployment choice, not a failure
    case 'timeout':
      return 'context_timeout';
    case 'location_not_found':
      return 'context_location_not_found';
    case 'unavailable':
    case 'rate_limited':
    case 'misconfigured':
    case 'malformed':
      return 'context_provider_error';
    case 'unknown':
      return 'unexpected_error';
  }
}

/** Re-export so callers can state the stage next to the category from one import. */
export { failureStage };
