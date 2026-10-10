/**
 * One request's time budget and cancellation, shared by every stage.
 *
 *  - `deadline`: a promise that resolves when the whole-request deadline is reached.
 *  - `signal`: aborted when the deadline passes OR the client disconnects. Provider calls hang a listener on it.
 *  - `remainingMs()`: what is left, so each stage can shrink its own timeout instead of spending time it does not have.
 *
 * `dispose()` clears the timer; call it in a `finally`. Safe to call more than once.
 */
export type AbortReason = 'deadline' | 'disconnect';

/** Time kept back for validation, the deterministic fallback and writing the response. */
export const RESPONSE_RESERVE_MS = 1_500;
/** Below this, calling the model is pointless (it could not answer in time), so the fallback is served directly. */
export const MIN_MODEL_BUDGET_MS = 2_000;

/** The two slices of a request's time that are never spent waiting on a provider. Injectable so tests need not wait seconds. */
export interface Budgets {
  responseReserveMs: number;
  minModelBudgetMs: number;
}
export const DEFAULT_BUDGETS: Budgets = { responseReserveMs: RESPONSE_RESERVE_MS, minModelBudgetMs: MIN_MODEL_BUDGET_MS };

export class RequestAbandonedError extends Error {
  constructor() {
    super('The client disconnected');
    this.name = 'RequestAbandonedError';
  }
}

export interface RequestScopeOptions {
  deadlineMs: number;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
}

export class RequestScope {
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private readonly deadlineAt: number;
  private timer: NodeJS.Timeout | undefined;
  private abortReason: AbortReason | undefined;
  readonly deadline: Promise<void>;

  constructor(options: RequestScopeOptions) {
    this.now = options.now ?? Date.now;
    this.deadlineAt = this.now() + options.deadlineMs;
    this.deadline = new Promise<void>((resolve) => {
      this.timer = setTimeout(() => {
        this.abort('deadline');
        resolve();
      }, options.deadlineMs);
    });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get reason(): AbortReason | undefined {
    return this.abortReason;
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAt - this.now());
  }

  /** First reason wins. Aborting twice is harmless. */
  abort(reason: AbortReason): void {
    if (this.abortReason) return;
    this.abortReason = reason;
    this.controller.abort();
  }

  /** Stages call this between steps: once the client is gone, no new work is started. */
  throwIfAbandoned(): void {
    if (this.abortReason === 'disconnect') throw new RequestAbandonedError();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
