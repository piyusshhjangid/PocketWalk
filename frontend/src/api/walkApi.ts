import { ApiError, statusToKind } from './apiError';
import { parseWalkResult } from './parseWalkResult';
import type { WalkRequest, WalkResult } from '../types/walk';

export interface WalkApiConfig {
  /** '' = same origin (proxied in dev/preview). Public value: never put secrets here. */
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface WalkApi {
  planWalk(request: WalkRequest, options?: { signal?: AbortSignal }): Promise<WalkResult>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The only place in the frontend that knows POST /walks/plan exists. UI code calls planWalk() and
 * gets a WalkResult or an ApiError; it never sees fetch, URLs, status codes or server text.
 */
export function createWalkApi(config: WalkApiConfig): WalkApi {
  const doFetch = config.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const url = `${config.baseUrl.replace(/\/+$/, '')}/walks/plan`;

  return {
    async planWalk(request, options = {}) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);
      const onCallerAbort = () => controller.abort();
      if (options.signal?.aborted) controller.abort();
      else options.signal?.addEventListener('abort', onCallerAbort, { once: true });

      try {
        let response: Response;
        try {
          response = await doFetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(request),
            signal: controller.signal,
          });
        } catch {
          if (timedOut) throw new ApiError('timeout');
          if (options.signal?.aborted) throw new ApiError('aborted');
          throw new ApiError('network');
        }

        if (!response.ok) throw new ApiError(statusToKind(response.status), response.status);

        let json: unknown;
        try {
          json = await response.json();
        } catch {
          if (timedOut) throw new ApiError('timeout');
          if (options.signal?.aborted) throw new ApiError('aborted');
          throw new ApiError('malformed', response.status);
        }
        return parseWalkResult(json);
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

function readTimeout(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1000 && n <= 120_000 ? n : DEFAULT_TIMEOUT_MS;
}

/** The app's API instance, configured from public Vite variables. */
export const walkApi: WalkApi = createWalkApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  timeoutMs: readTimeout(import.meta.env.VITE_REQUEST_TIMEOUT_MS),
});
