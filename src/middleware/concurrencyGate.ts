/**
 * A hard cap on simultaneous walk plans in this process. No queue: when full, the caller is told "busy" at once.
 * `tryAcquire` returns a release function (idempotent) or null. Every acquirer MUST release in a `finally`.
 * In-process only: with several instances each has its own cap, so the fleet total is max x instances.
 */
export class ConcurrencyGate {
  private active = 0;

  constructor(readonly max: number) {}

  get inFlight(): number {
    return this.active;
  }

  tryAcquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
}
