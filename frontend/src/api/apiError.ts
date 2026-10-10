/**
 * One error shape for everything that can go wrong between the browser and POST /walks/plan.
 * The UI shows fixed, friendly copy chosen from `kind`. Server text, URLs and stack traces are
 * never stored here, so they cannot be rendered by accident.
 */
export type ApiErrorKind =
  | 'network' // fetch failed: offline, backend down, DNS, CORS
  | 'timeout' // the browser gave up waiting
  | 'invalid_request' // HTTP 400 (backend rejected the request body)
  | 'not_found' // HTTP 404: wrong base URL or backend not serving this route
  | 'busy' // HTTP 429 (rate limited) or 503 (service busy): a moment later it will work
  | 'server' // other HTTP 5xx
  | 'client' // any other 4xx
  | 'malformed' // 2xx whose body is not a WalkResult
  | 'aborted'; // the person cancelled

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(kind: ApiErrorKind, status?: number) {
    super(`PocketWalk request failed: ${kind}${status ? ` (HTTP ${status})` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    if (status !== undefined) this.status = status;
    // A bad request will fail the same way again unless the person changes it.
    this.retryable = kind !== 'invalid_request' && kind !== 'aborted';
  }
}

export function statusToKind(status: number): ApiErrorKind {
  if (status === 400) return 'invalid_request';
  if (status === 404) return 'not_found';
  if (status === 429 || status === 503) return 'busy';
  if (status >= 500) return 'server';
  return 'client';
}
