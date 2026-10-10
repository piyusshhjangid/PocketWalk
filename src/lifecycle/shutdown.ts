import type http from 'node:http';
import type { Readiness } from './readiness';

export interface ShutdownDeps {
  server: Pick<http.Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
  readiness: Readiness;
  /** How long in-flight requests may finish after the signal before their connections are closed. */
  graceMs: number;
  /** Flush telemetry. Must never throw the shutdown off course. */
  closeTelemetry: () => Promise<unknown>;
  exit: (code: number) => void;
  log?: (message: string) => void;
}

/**
 * Graceful shutdown, once. Order matters:
 *  1. readiness -> 503 so the load balancer stops sending traffic (liveness stays 200: the process is not broken);
 *  2. stop accepting connections and drop idle keep-alive ones (responses sent from now on say `Connection: close`);
 *  3. in-flight requests get `graceMs` to finish; then the remaining connections are closed, which the request lifecycle
 *     sees as a disconnect, aborting its provider calls and releasing its capacity;
 *  4. telemetry is flushed (bounded) and the process exits 0. A hard stop at grace + 5 s exits 1 if anything wedges.
 */
export function createShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  const log = deps.log ?? (() => undefined);
  let started = false;
  return async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    log(`[pocketwalk] ${signal} received: not accepting new work, finishing in-flight requests`);
    deps.readiness.markShuttingDown();

    const hardStop = setTimeout(() => deps.exit(1), deps.graceMs + 5_000);
    hardStop.unref();

    const closed = new Promise<void>((resolve) => deps.server.close(() => resolve()));
    deps.server.closeIdleConnections();
    const grace = setTimeout(() => {
      log('[pocketwalk] grace period over: closing remaining connections');
      deps.server.closeAllConnections();
    }, deps.graceMs);

    await closed;
    clearTimeout(grace);
    try {
      await deps.closeTelemetry();
    } catch {
      // Telemetry is best effort.
    }
    clearTimeout(hardStop);
    deps.exit(0);
  };
}
