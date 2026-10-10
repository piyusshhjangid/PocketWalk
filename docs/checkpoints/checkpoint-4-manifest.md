# Checkpoint 4 manifest

Checkpoint: 4 (Structured AI + safety)
Date: 2026-10-07
Git commit: NOT VERIFIED. The Checkpoint 3 ZIP had no .git and none is shipped.
Git branch: NOT VERIFIED
Node version: v22.22.2 (build environment); package.json engines >=20; CI configured for 22
Package manager: npm 10.9.7 (package-lock.json present; only the version field changed)
Version: 0.4.0
Major dependencies: unchanged from CP3: @sentry/node 11.4.0, express 5.2.1, zod 4.6.5, dotenv 18.0.5, morgan 1.12.1;
  dev: typescript 7.0.2, vitest 5.0.3, supertest 7.3.1, tsx 4.23.15. **No new dependencies. No new environment variables.**
Tests: 381 passing in 16 files (local, no network), run on a clean extraction of the ZIP.
Typecheck: PASS
Build: PASS (tsc -p tsconfig.build.json, from clean dist)
npm audit: 0 vulnerabilities (2026-10-07)
CI: NOT VERIFIED (workflow unchanged; never run on GitHub)
Weather: unchanged; live call NOT VERIFIED
Sentry: spans verified locally with the real SDK and a recording transport. Delivery to a real Sentry project: NOT VERIFIED.
Gemma: adapters unchanged; live call NOT VERIFIED. Real Gemma rejection/fallback rate: NOT VERIFIED.
Timings: validation/safety/fallback latencies are measured by the code, but the only numbers captured here come from scripted
  stand-ins in a sandbox. Gemma latency, real validation overhead and total latency: NOT VERIFIED.
Deployment: none (Checkpoint 9)

New files:
  src/safety/{engine,rules,text,types}.ts
  src/ai/{planSchema,planRepair,businessRules,validationPipeline,validationReport,emergencyPlan}.ts
  scripts/safetyScenarios.ts
  tests/{planSchema,businessRules,safetyEngine,validationPipeline,safetyPipeline,safetyTrace}.test.ts, tests/helpers/plans.ts
  docs/checkpoints/checkpoint-4-{summary,manifest,evidence}.md
Modified: src/ai/{errors,planValidation,gemmaPlanner,walkPlanner,prompt,fallbackPlanner}.ts, src/services/walkService.ts,
  src/app.ts, src/observability/tracing.ts, package.json, package-lock.json (version), README.md,
  docs/{architecture,development-log,ai-assistance-log}.md
Unchanged on purpose: weather provider, daylight, context builder, Gemma/Ollama adapters, Sentry init/privacy config, HTTP routes,
  controller, env.ts, .env.example, CI workflow, CP1-CP3 tests.
Removed: none
Known limitations: see checkpoint-4-summary.md
