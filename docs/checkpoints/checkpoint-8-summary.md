# Checkpoint 8 summary: Reliability and testing

**Goal:** make the existing product dependable without changing it.

## Status: PARTIAL
All code, tests, builds, audits and browser checks pass offline and from a clean extraction. **Not verified:** live Gemma, live Open-Meteo, ingestion by a real Sentry project, and a GitHub Actions run (none reachable from the build environment).

## What changed
- **Privacy fix (the CP7 open item): confirmed and fixed.** Unexpected 500s no longer send their message to Sentry; Sentry's raw Express error handler was removed; a global event/span scrubber and breadcrumb drop back it up; the access log prints the path only.
- **Resource limits:** provider response bodies are read with a streaming byte cap (model 1 MiB, weather 128 KiB).
- **Reporting can't break requests:** `captureUnexpected` swallows SDK faults (tested with a failing transport and a throwing `beforeSend`).
- **Tests:** a full HTTP-contract matrix, a failure matrix (timeouts on a fake clock, late results, hostile model output, fallback failure, weather failures, oversized bodies), Sentry privacy tests including a real-process wire test, frontend recovery/stale-response/duplicate-submit tests, and a browser failure/retry script.
- No change to the API contract, the UI, the CP6 timer or CP7 tracing semantics.

## What did not change (and why)
No rate limiter, no retries, no overall deadline, no CI change; see `docs/architecture.md` ("Checkpoint 8") for reasons. No dependency changes.

## Tests
Backend 513 (392 existing, 1 of those modified in harness only, plus 121 new); frontend 147 (112 existing unmodified plus 35 new); browser 48/48 (happy path) and 22/22 (failures). Details and the mapping of the 18 required regressions: `checkpoint-8-evidence.md`.

**Next:** Checkpoint 9, Production Deployment. Not started.
