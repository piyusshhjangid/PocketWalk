/**
 * Readiness is "should a load balancer send me traffic": it becomes true once the server is listening and false as soon as
 * shutdown starts, so a draining instance leaves rotation while still finishing in-flight work.
 * Liveness (/health) deliberately ignores this: a draining process is alive and must not be restarted early.
 * Neither depends on Google, Open-Meteo or Sentry.
 */
export type ReadinessState = 'starting' | 'ready' | 'shutting_down';

export class Readiness {
  private current: ReadinessState = 'starting';

  get state(): ReadinessState {
    return this.current;
  }

  markReady(): void {
    if (this.current === 'starting') this.current = 'ready';
  }

  markShuttingDown(): void {
    this.current = 'shutting_down';
  }
}
