# Checkpoint 7 evidence

## Environment
Linux sandbox, Node 22, no `GEMINI_API_KEY`, no Ollama, no route to Google, Open-Meteo or Sentry. Everything below that involves a model or weather used scripted stand-ins and is labelled so.

## Provider / model
Live: **none** (not available). Offline: `FakeModelClient` / `FakeWeatherProvider` (tests), synthetic stand-ins (latency script). Gemma was not replaced by another model; it was simply not reachable.

## Trace structure (verified by tests with the real Sentry SDK and a recording transport)
```text
http.server POST /walks/plan                 (auto; not exercised offline: tests call the service directly, the browser run used the real server with Sentry disabled)
  gen_ai.invoke_agent                         minutes, energy, fallback, fallback_reason, failure_stage, error_category, context.error_category,
                                              context.degraded, duration_ms, model_ms | fallback_ms, validation.*, validation_ms
    gen_ai.execute_tool context.build         weather.fetch (provider, status, failure_reason) / daylight.calculate
    gen_ai.chat <model>                       gen_ai.provider.name, request.model, model.status, duration_ms, [failure_reason, error_category], [token usage if returned]
    pocketwalk.validate                       parse / schema / repair / business / safety (error status when output rejected)
    pocketwalk.fallback + .fallback_validate  only when fallback used
```
Paths asserted in `tests/observabilityCp7.test.ts`: normal; model provider failure; model timeout; invalid JSON; business-rule rejection; weather timeout (model still runs); weather error + model timeout (both categories present); no location (no context error).

## Baseline measurements
**None real.** Synthetic harness only (30 runs + 1 warm-up, in-process, sequential, no HTTP, no Sentry, artificial delays model 800 ms / weather 300 ms):

| stage (ms) | p50 | p95 | min | max |
|---|---:|---:|---:|---:|
| total | 1106.0 | 1114.0 | 1105.0 | 1117.0 |
| context | 301.0 | 302.0 | 300.0 | 302.0 |
| model | 801.0 | 802.0 | 800.0 | 806.0 |
| validation | 3.4 | 10.2 | 2.3 | 10.3 |

Context/model rows are the chosen delays; only the remainder is real: PocketWalk overhead ~4 ms, validation ~3 ms (warm, one-CPU sandbox). Sentry ingestion is excluded (spans are sent asynchronously after the response).

## Bottleneck
Not identified (needs live data). Run `npm run measure:latency -- 20 <city>` with `GEMMA_PROVIDER` set, and compare the model and context rows.

## Optimisation / after
None. Parallel weather+model is invalid (prompt needs context); geocode -> forecast is sequential by data dependency; a geocode cache was considered and not built (no evidence, adds state). Before/after table: **not applicable**. No reliable performance improvement was demonstrated.

## Tests
| | Count |
|---|---:|
| Backend existing (unmodified) | 381 |
| Backend new (`tests/observabilityCp7.test.ts`) | 11 |
| Backend modified | 0 |
| Backend total | 392 |
| Frontend (unchanged) | 112 |
| Browser regression `scripts/browser/cp6_flow.py` | 48 checks, 0 failed |

Typecheck, build and `npm audit` (0 vulnerabilities) pass for backend and frontend. The browser run used the compiled backend (`GEMMA_PROVIDER=none`, Sentry disabled) and the production frontend build: no console errors, no API change, and no Sentry/trace/latency/provider text in `frontend/src` or the bundle.

## Privacy audit
Searched all telemetry call sites (28 outside `tracing.ts`; no `setUser`, `setContext`, `setTag` or breadcrumbs in `src`; none reference city or location). Attributes are closed-set ids, numbers and booleans (enforced by a test that every `pocketwalk.*` string value is a short token). Excluded: prompts, model output, plan text, keys, headers, cookies, city, coordinates, time zone, provider payloads (tests assert none appear in spans or in sent envelopes). **Finding and fix:** raw error messages from unexpected errors were sent by `captureException` (reproduced by the new test); replaced with `captureUnexpected`. **Remaining:** the Express error handler's own capture of unexpected 500s still sends the raw message.

## Sentry verification
**NOT VERIFIED — real Sentry delivery unavailable in this environment.** Only the SDK's would-be-sent payload was inspected.

## Limitations
No live Gemma/Open-Meteo/Sentry; no real latency data; no bottleneck; no optimisation; headless Chromium only; GitHub Actions not run; the synthetic table must not be quoted as performance.
