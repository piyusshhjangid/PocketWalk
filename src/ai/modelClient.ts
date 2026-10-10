import { BodyTooLargeError, readBoundedJson } from '../utils/boundedBody';
import { PlannerError } from './errors';

/** A model reply is at most a few KB of plan JSON; 1 MiB leaves ample room for provider metadata and is still a hard stop. */
export const MAX_MODEL_BODY_BYTES = 1024 * 1024;

/** Raw text from a model plus optional token usage. Nothing here is trusted yet. */
export interface ModelResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** A transport to one model provider. It knows HTTP, not PocketWalk. */
export interface ModelClient {
  readonly provider: string;
  readonly model: string;
  readonly maxOutputTokens: number;
  readonly temperature: number;
  generate(prompt: string, options: { signal: AbortSignal }): Promise<ModelResponse>;
}

/** Map a thrown fetch error to a PlannerError. Never includes the original message. */
export function classifyFetchError(err: unknown, signal: AbortSignal): PlannerError {
  const name = (err as { name?: string } | null)?.name;
  if (signal.aborted || name === 'AbortError' || name === 'TimeoutError') {
    return new PlannerError('timeout', 'Model request timed out');
  }
  return new PlannerError('unavailable', 'Model provider unreachable');
}

/** Map a non-2xx HTTP status to a PlannerError. The response body is deliberately ignored. */
export function classifyHttpStatus(status: number): PlannerError {
  if (status === 429) return new PlannerError('rate_limited', 'Model provider rate limit');
  if (status >= 500) return new PlannerError('unavailable', `Model provider error (${status})`);
  return new PlannerError('misconfigured', `Model provider rejected the request (${status})`);
}

export async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return await readBoundedJson(res, MAX_MODEL_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) throw new PlannerError('schema_invalid', 'Model provider response was too large');
    throw new PlannerError('empty_response', 'Model provider returned a non-JSON body');
  }
}
