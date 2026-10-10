# Checkpoint 9 summary: Production deployment

**Goal:** make PocketWalk deployable as a small, bounded, reproducible production service.

## Status: PARTIAL
Everything that can be built and verified locally is: production build and start, same-origin serving, limits, deadline, cancellation, readiness, graceful shutdown, configuration, bundle scan, browser runs and the full test suites, all repeated from a clean extraction. **Not done / not verified:** no live deployment, no Docker image build (no Docker here), no GitHub Actions run (including the two new jobs), no real Sentry ingestion.

## What changed
- **Architecture:** one Node service that also serves the built frontend, so the browser talks to one origin (no CORS, no proxy rules).
- **The CP8 open items:** rate limit (429), concurrency cap (503), overall request deadline with a safe fallback or a controlled 504, provider budgets that shrink to the time left, abandoned requests now cancel their provider calls and free their slot.
- **Production safety:** `TRUST_PROXY` mandatory and numeric (never "trust all"), fail-fast configuration, `/ready` next to `/health`, graceful shutdown, CSP and security headers, Sentry trace sampling defaults to 0.1 in production.
- **Artifacts:** `Dockerfile`, `.dockerignore`, `build:all`, `check:bundle`, two CI jobs (production build + bundle scan; docker build + smoke).
- **Frontend:** one change: HTTP 429/503 show "PocketWalk is busy right now" instead of the generic error. No design change.

## What was deliberately not done
No Redis, queue, database, provider-specific host config, deploy workflow, SPA catch-all, extra dependencies, or retries.

## Honest limits
The limiter and the cap are per process (a multi-instance host needs an edge limit). A deployed host, the right `TRUST_PROXY` value, TLS, and secrets entry are the user's.

## Tests
Backend 611 (513 existing + 98 new); frontend 151 (147 existing + 4 new); browser 48/48 (happy path), 22/22 (failures), 9/9 (real limiter), all against the same-origin production-shaped server; 8 mutation checks. Details: `checkpoint-9-evidence.md`.

**Next:** Checkpoint 10, Open-Source Polish. Not started.
