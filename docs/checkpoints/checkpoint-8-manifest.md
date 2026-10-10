# Checkpoint 8 manifest

Complete project snapshot (`pocketwalk-checkpoint8.zip`, top folder `pocketwalk/`). Excluded: `node_modules/`, `dist/`, `coverage/`, `.env*` (except `.env.example`), logs, screenshots.

## Added
- `src/observability/scrubEvent.ts` (event, span and breadcrumb scrubbers)
- `src/utils/boundedBody.ts` (streaming byte cap)
- `tests/sentryPrivacyCp8.test.ts`, `tests/sentryFailureCp8.test.ts`, `tests/sentryWireCp8.test.ts`, `tests/apiReliabilityCp8.test.ts`, `tests/failureHandlingCp8.test.ts`
- `frontend/tests/reliabilityCp8.test.tsx`
- `scripts/browser/cp8_failures.py`
- `docs/checkpoints/checkpoint-8-summary.md`, `-evidence.md`, `-manifest.md`

## Modified
- `src/middleware/errorHandler.ts` (message-free capture, class-only log, headers-sent guard)
- `src/app.ts` (Sentry's raw Express error handler removed; path-only access log)
- `src/observability/sentryConfig.ts` (beforeSend, beforeSendSpan, beforeBreadcrumb)
- `src/observability/tracing.ts` (`captureUnexpected` swallows reporting faults; `describeUnexpected`)
- `src/ai/modelClient.ts` (bounded body read, `MAX_MODEL_BODY_BYTES`)
- `src/context/openMeteoProvider.ts` (bounded body read, `MAX_WEATHER_BODY_BYTES`, abort mid-body = timeout)
- `tests/safetyTrace.test.ts` (existing test: capture hook now wraps the shared scrubber; assertions unchanged)
- `package.json` (version 0.8.0, script `qa:browser:failures`), `frontend/package.json` (version), both lockfiles (version fields only)
- `README.md`, `docs/architecture.md`, `docs/development-log.md`, `docs/ai-assistance-log.md`

## Removed
None. No frontend source file changed.

## Architectural changes
Unexpected errors are reported without messages; Sentry has a global scrubber; provider bodies are size-capped. API contract, UI, CP6 timer and CP7 span structure are unchanged.

## Verification status
Verified offline and from a clean extraction: typecheck, 513 backend and 147 frontend tests, builds, audits, 48 + 22 browser checks, privacy tests including the real-process wire test. **Not verified:** live Gemma, live Open-Meteo, real Sentry ingestion, GitHub Actions.
