import { PlannerError } from './errors';
import type { ModelClient } from './modelClient';
import { runModelOutputPipeline } from './validationPipeline';
import { defaultSafetyEngine, type SafetyEngine } from '../safety/engine';
import { buildPrompt } from './prompt';
import type { OutdoorContext } from '../context/types';
import type { PlanOptions, PlannerResult, WalkPlanner } from './walkPlanner';
import { modelErrorCategory } from '../observability/errorCategory';
import { recordModelOutcome, withModelSpan } from '../observability/tracing';

export interface GemmaPlannerOptions {
  client: ModelClient;
  /** Latency budget for the model call. Past it the call is aborted and the caller falls back. */
  timeoutMs: number;
  /** Deterministic safety layer. Defaults to the standard rule set; injectable for tests. */
  safety?: SafetyEngine;
}

/**
 * Run `fn` with an AbortSignal that fires at `ms`. If the budget is exceeded the result is ALWAYS a
 * `timeout` PlannerError, even if the client rejects with something else because it was aborted.
 */
function runWithTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const failure = () => new PlannerError('timeout', `Model did not answer within ${ms} ms`);
  // The request is already over (deadline or disconnect): do not even start the provider call.
  if (parent?.aborted) return Promise.reject(failure());
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onParentAbort: (() => void) | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(failure());
      controller.abort();
    }, ms);
    if (parent) {
      // Deadline passed or client left while the provider call is in flight: cancel it and stop waiting.
      onParentAbort = () => {
        timedOut = true;
        reject(failure());
        controller.abort();
      };
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  });
  return Promise.race([fn(controller.signal), timeout])
    .catch((err: unknown) => {
      if (timedOut) throw failure();
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      if (parent && onParentAbort) parent.removeEventListener('abort', onParentAbort);
    });
}

/**
 * The model-backed planner: prompt -> Gemma -> parse -> schema -> repair -> business -> safety.
 * It either returns a plan that passed EVERY layer or throws a PlannerError. Unvalidated text never leaves here.
 */
export class GemmaPlanner implements WalkPlanner {
  readonly kind = 'model' as const;
  readonly provider: string;
  readonly model: string;

  constructor(private readonly options: GemmaPlannerOptions) {
    this.provider = options.client.provider;
    this.model = options.client.model;
  }

  async plan(context: OutdoorContext, planOptions?: PlanOptions): Promise<PlannerResult> {
    const { client } = this.options;
    const timeoutMs = Math.min(this.options.timeoutMs, planOptions?.timeoutMs ?? Number.POSITIVE_INFINITY);
    const prompt = buildPrompt(context);

    const modelStart = performance.now();
    const generation = await withModelSpan(
      {
        provider: client.provider,
        model: client.model,
        maxOutputTokens: client.maxOutputTokens,
        temperature: client.temperature,
      },
      async (span) => {
        const t = performance.now();
        try {
          const response = await runWithTimeout((signal) => client.generate(prompt, { signal }), timeoutMs, planOptions?.signal);
          if (response.usage?.inputTokens !== undefined) {
            span.setAttribute('gen_ai.usage.input_tokens', response.usage.inputTokens);
          }
          if (response.usage?.outputTokens !== undefined) {
            span.setAttribute('gen_ai.usage.output_tokens', response.usage.outputTokens);
          }
          recordModelOutcome(span, { status: 'ok' }, Math.round(performance.now() - t));
          return response;
        } catch (err) {
          // Closed-set reason only. Raw provider text never reaches the span.
          const reason = err instanceof PlannerError ? err.reason : 'unknown';
          recordModelOutcome(
            span,
            { status: 'failed', reason, category: modelErrorCategory(reason) },
            Math.round(performance.now() - t),
          );
          throw err;
        }
      },
    );
    const modelMs = Math.round(performance.now() - modelStart);

    const { plan, report } = await runModelOutputPipeline(generation.text, context, this.options.safety ?? defaultSafetyEngine);
    return { plan, timings: { modelMs, validationMs: report.timingsMs.totalMs }, validation: report };
  }
}
