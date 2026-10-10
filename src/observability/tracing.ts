import * as Sentry from '@sentry/node';

/**
 * Thin helpers so spans follow Sentry's documented agent-tracing conventions in one place.
 * Without Sentry.init (tests, no DSN) these still run the callback and simply create no-op spans.
 */

export const AGENT_NAME = 'PocketWalk';

/** Container span for one whole PocketWalk run: op `gen_ai.invoke_agent`. */
export function withAgentSpan<T>(fn: () => Promise<T>): Promise<T> {
  return Sentry.startSpan(
    {
      op: 'gen_ai.invoke_agent',
      name: `invoke_agent ${AGENT_NAME}`,
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'gen_ai.agent.name': AGENT_NAME,
      },
    },
    fn,
  );
}

/** A deterministic tool-like step inside the agent run: op `gen_ai.execute_tool`. */
export function withToolSpan<T>(toolName: string, fn: () => Promise<T> | T): Promise<T> {
  return Sentry.startSpan(
    {
      op: 'gen_ai.execute_tool',
      name: `execute_tool ${toolName}`,
      attributes: {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': toolName,
        'gen_ai.agent.name': AGENT_NAME,
      },
    },
    async () => fn(),
  );
}

/** A plain custom span for steps that are not model calls or tools. */
export function withStepSpan<T>(op: string, name: string, fn: () => Promise<T> | T): Promise<T> {
  return Sentry.startSpan({ op, name }, async () => fn());
}

export interface ModelSpanInfo {
  provider: string;
  model: string;
  maxOutputTokens: number;
  temperature: number;
}

/**
 * A real model call: op `gen_ai.chat`. Prompt and output text are deliberately NOT attached
 * (privacy: see instrument.ts). Only model name, settings and token counts are recorded.
 */
export function withModelSpan<T>(info: ModelSpanInfo, fn: (span: Sentry.Span) => Promise<T>): Promise<T> {
  return Sentry.startSpan(
    {
      op: 'gen_ai.chat',
      name: `chat ${info.model}`,
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': info.provider,
        'gen_ai.provider.name': info.provider,
        'gen_ai.request.model': info.model,
        'gen_ai.request.max_tokens': info.maxOutputTokens,
        'gen_ai.request.temperature': info.temperature,
        'gen_ai.agent.name': AGENT_NAME,
      },
    },
    fn,
  );
}

/**
 * Record how a model call ended on its own span: status, real elapsed time, and (on failure) a closed-set
 * reason. Called from the planner so a failed `gen_ai.chat` span says WHY without any provider text.
 */
export function recordModelOutcome(
  span: Sentry.Span,
  outcome: { status: 'ok' } | { status: 'failed'; reason: string; category: string },
  durationMs: number,
): void {
  span.setAttributes({
    'pocketwalk.model.status': outcome.status,
    'pocketwalk.duration_ms': durationMs,
    ...(outcome.status === 'failed'
      ? { 'pocketwalk.model.failure_reason': outcome.reason, 'pocketwalk.error_category': outcome.category }
      : {}),
  });
}

/** Attach PocketWalk-specific facts to whichever span is currently active (no-op without Sentry). */
export function annotateActiveSpan(attributes: Record<string, string | number | boolean>): void {
  Sentry.getActiveSpan()?.setAttributes(attributes);
}

/**
 * A custom span for one step of context building (`weather.fetch`, `daylight.calculate`).
 * Callers attach only enumerated facts: never a city, coordinates, or provider payloads.
 */
export function withContextSpan<T>(op: string, name: string, fn: (span: Sentry.Span) => Promise<T> | T): Promise<T> {
  return Sentry.startSpan({ op, name }, async (span) => fn(span));
}

/**
 * A custom span for one validation stage (`pocketwalk.parse`, `.schema`, `.business`, `.safety`, ...).
 * A stage that REJECTS output is an expected, handled outcome, so it ends normally with
 * `pocketwalk.stage.result=failed` and a closed-set failure code. It is not an exception, and it never
 * carries model text. The parent `pocketwalk.validate` span is what ends in error when output is rejected.
 */
export function withStageSpan<T>(op: string, name: string, fn: (span: Sentry.Span) => T): Promise<T> {
  return Sentry.startSpan({ op, name }, async (span) => fn(span));
}

/**
 * Report an UNEXPECTED error (a bug, not a handled provider failure) without its message.
 * Raw error messages can carry provider response text, keys, paths or a city, so only the error class,
 * a fixed stage label and the stack frames (code locations, not data) are sent.
 */
export function captureUnexpected(err: unknown, stage: string): void {
  try {
    const name = err instanceof Error ? err.name : 'NonError';
    const safe = new Error(`unexpected error in ${stage}`);
    safe.name = name;
    if (err instanceof Error && err.stack) {
      // Keep the frames, drop the first line (which is "Name: raw message").
      safe.stack = `${name}: ${safe.message}\n${err.stack.split('\n').filter((l) => l.trimStart().startsWith('at ')).join('\n')}`;
    }
    Sentry.captureException(safe, { tags: { 'pocketwalk.stage': stage } });
  } catch {
    // Reporting must never break a request: a Sentry failure is swallowed here.
  }
}

/** A log-safe description of an unexpected error: class name only, never the message (it can hold keys or provider text). */
export function describeUnexpected(err: unknown): string {
  return err instanceof Error ? err.name : 'NonError';
}
