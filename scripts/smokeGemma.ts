/**
 * One real call to the configured Gemma provider. Run it yourself with your own key:
 *
 *   GEMMA_PROVIDER=google GEMINI_API_KEY=... npm run smoke:gemma
 *   GEMMA_PROVIDER=ollama GEMMA_MODEL=<your-local-tag> npm run smoke:gemma
 *
 * It exercises the exact production path (prompt -> model -> parse -> validate) and prints the
 * measured latency, token usage and either the validated plan or the failure reason.
 * It never prints the API key. Exit code 0 = a validated model plan was produced.
 */
import 'dotenv/config';
import { createModelPlanner } from '../src/ai/createPlanner';
import { PlannerError } from '../src/ai/errors';
import { loadEnv } from '../src/config/env';

async function main(): Promise<void> {
  const env = loadEnv();
  const planner = createModelPlanner(env);
  if (!planner) {
    console.error('GEMMA_PROVIDER is "none". Set GEMMA_PROVIDER=google (with GEMINI_API_KEY) or ollama (with GEMMA_MODEL).');
    process.exit(2);
  }
  console.log(`provider=${planner.provider} model=${planner.model} timeout=${env.GEMMA_TIMEOUT_MS}ms`);
  for (const energy of ['easy', 'normal'] as const) {
    const started = performance.now();
    try {
      const { plan, timings } = await planner.plan({ minutes: 20, energy });
      console.log(`\n[${energy}] OK in ${Math.round(performance.now() - started)} ms (model ${timings?.modelMs} ms, validation ${timings?.validationMs} ms)`);
      console.log(JSON.stringify(plan, null, 2));
    } catch (err) {
      const reason = err instanceof PlannerError ? err.reason : 'unknown';
      console.error(`\n[${energy}] FAILED after ${Math.round(performance.now() - started)} ms: reason=${reason}`);
      process.exitCode = 1;
    }
  }
}

void main();
