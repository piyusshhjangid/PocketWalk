# Checkpoint 7 summary: Sentry performance and observability

**Goal:** make the AI request lifecycle measurable and diagnosable, and optimise only what evidence supports.

## Status: PARTIAL
Instrumentation, privacy, tests and regression are done and verified offline. **No live measurement and no Sentry delivery were possible** in the build environment, so there is no real bottleneck finding and no optimisation.

## What changed
- Existing trace (HTTP -> agent -> context -> model -> validation stages -> fallback) kept and extended; no second tracing system.
- New closed-set `pocketwalk.error_category` (e.g. `model_timeout`, `model_invalid_output`, `safety_rejection`, `context_timeout`) plus a separate `pocketwalk.context.error_category`.
- Model span records status, real duration (also on failure/timeout) and failure reason; the agent span records request shape (minutes, energy) and durations.
- Sample rate printed at startup, with a production warning at 1.
- **Privacy fix:** CP6 sent raw error messages for unexpected errors; now only error class, stage label and stack frames are sent.
- `npm run measure:latency` (live when a provider is configured, otherwise labelled synthetic).

## What did not change
The product, the API contract and the frontend. No frontend Sentry, storage, analytics or new UI.

## Honest result
No optimisation was applied: weather -> prompt -> model is a real dependency, and there is no live evidence for anything else. **No reliable performance improvement was demonstrated.** The synthetic harness shows PocketWalk's own overhead is about 4 ms; it says nothing about Gemma or Open-Meteo.

## Tests
Backend 392 (381 existing, unmodified, plus 11 new); frontend 112 (unchanged); browser regression 48 checks pass. See `checkpoint-7-evidence.md`.

**Next:** Checkpoint 8, Reliability & Testing. Do not start it until asked.
