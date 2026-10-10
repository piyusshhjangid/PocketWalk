# Checkpoint 9 manifest

Complete project snapshot (`pocketwalk-checkpoint9.zip`, top folder `pocketwalk/`). Excluded: `node_modules/`, `dist/`, `coverage/`, `.vitest/`, `.env*` (except `.env.example`), logs, screenshots.

## Added
- Backend: `src/appFromEnv.ts`, `src/lifecycle/readiness.ts`, `src/lifecycle/shutdown.ts`, `src/middleware/rateLimiter.ts`, `src/middleware/concurrencyGate.ts`, `src/middleware/securityHeaders.ts`, `src/services/requestScope.ts`
- Deployment: `Dockerfile`, `.dockerignore`
- Scripts: `scripts/scanBundle.ts`, `scripts/browser/cp9_limits.py`
- Tests: `tests/rateLimitCp9.test.ts`, `tests/concurrencyCp9.test.ts`, `tests/deadlineCp9.test.ts`, `tests/deploymentCp9.test.ts`, `tests/serverProcessCp9.test.ts`, `tests/helpers/liveServer.ts`, `frontend/tests/deploymentCp9.test.tsx`
- Docs: `docs/checkpoints/checkpoint-9-summary.md`, `-evidence.md`, `-manifest.md`

## Modified
- `src/server.ts` (thin: env -> `buildAppFromEnv`, listen on `HOST`/`PORT`, readiness, graceful shutdown, port-error handling)
- `src/app.ts` (security headers, drain marker, rate limiter before body parsing, trust proxy, concurrency gate, deadline, static frontend, readiness)
- `src/config/env.ts` (new settings, mandatory `TRUST_PROXY` in production, production sample-rate default)
- `src/controllers/walkController.ts` (request scope, deadline race, disconnect handling, slot release in `finally`)
- `src/routes/walkRoutes.ts`, `src/routes/healthRoutes.ts` (options; `/ready`)
- `src/services/walkService.ts` (scope-aware budgets, `planFallbackNow`, `serveFallback` extracted, injectable budgets)
- `src/ai/walkPlanner.ts`, `src/ai/gemmaPlanner.ts`, `src/context/contextBuilder.ts` (per-call signal and budget; abort listeners cleaned up)
- `src/observability/instrument.ts` (log wording only)
- `frontend/src/api/apiError.ts`, `frontend/src/app/copy.ts` (`busy` kind for 429/503)
- `frontend/tests/reliabilityCp8.test.tsx` (**2 existing tests modified**: the 429 copy expectation and the status-mapping table rows for 429 and 503, because those statuses now deliberately map to `busy`)
- `vitest.config.mts` (`testTimeout: 20000`; no assertion changed)
- `scripts/qaServer.ts` (optional `QA_FRONTEND_DIR` to serve the build same-origin)
- `.github/workflows/ci.yml` (jobs `package` and `docker` added; existing jobs untouched), `.env.example`
- `package.json` (0.9.0, scripts `build:all`, `check:bundle`, `qa:browser:limits`), `frontend/package.json`, both lockfiles (version fields only)
- `README.md`, `docs/architecture.md`, `docs/development-log.md`, `docs/ai-assistance-log.md`

## Removed
None. No existing test was deleted or skipped.

## Architectural changes
Single deployable serving API and frontend; per-request scope with deadline and cancellation; in-process rate limit and concurrency cap; readiness vs liveness; fail-fast production configuration.

## Verification status
Verified locally and from a clean extraction: typecheck, 611 backend and 151 frontend tests, builds, audits, bundle scan, 48 + 22 + 9 browser checks, privacy tests, graceful shutdown with a real process. **Not verified:** live hosting, Docker image build, GitHub Actions, real Sentry ingestion, live Gemma and Open-Meteo.
