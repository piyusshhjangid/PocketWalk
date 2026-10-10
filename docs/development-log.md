# Checkpoint 1 — Foundation

## Goal
Prove one complete technical path: Express/TypeScript app -> health endpoint -> traced placeholder workflow -> Sentry spans -> automated CI.

## What I changed
- Express 5 + TypeScript service (`src/`), `GET /health`, `POST /walks/plan`.
- `WalkService` + `WalkPlanner` interface + deterministic `PlaceholderPlanner` (explicitly not AI).
- Sentry init (`src/observability/instrument.ts`), span helpers (`tracing.ts`).
- Vitest + Supertest tests, GitHub Actions CI, `.env.example`, `.gitignore`, docs.

## Why I changed it
Everything later (Gemma, validator, latency budget, optimisation story) hangs off a traced workflow and a replaceable model seam. Proving that first is cheaper than debugging it later.

## Sentry integration
- `@sentry/node` v11, initialised in `instrument.ts`, imported first in `server.ts` (required so Express/http get instrumented).
- Spans: `gen_ai.invoke_agent` (container) -> `gen_ai.execute_tool` (context) and `pocketwalk.plan` (placeholder step).
- Privacy: `dataCollection` disables user info, cookies, headers, query params, bodies, and gen-AI inputs/outputs.
- No DSN = Sentry disabled, app still runs. CI needs no secrets.
- **Locally verified:** with the SDK pointed at a local capture server, the app emitted 4 requests' worth of spans with correct parent/child nesting and one error event for `/debug-sentry`.
- **NOT yet verified:** delivery to a real Sentry project and appearance under Explore -> Agents. See "What remains".

## Tests
9 tests, all passing locally: health shape + 404; placeholder determinism and step totals; valid/invalid/malformed requests; production error does not leak details; debug route absent in production.

## CI
`.github/workflows/ci.yml`: `npm ci` -> typecheck -> test -> build on Node 22. **Not yet run on GitHub** (needs your push).

## Problems encountered
- `sendDefaultPii` is gone in Sentry SDK v11 (replaced by `dataCollection`).
- TypeScript 7 removed `moduleResolution: node10`.
- Sentry v11 sends spans as individual span items, not classic "transaction" envelopes; inspect accordingly.

## Decisions
- CommonJS output, `instrument` imported first (simplest correct setup for Sentry).
- Zod for env and request validation now (already planned for model output later).
- No CORS middleware (not needed yet; default is same-origin only).
- Placeholder step uses a custom op, not `gen_ai.chat`, to avoid pretending it is a model call.
- `npm audit` not in CI yet (planned CP8); run manually, result below.

## What remains
- Push to GitHub, confirm CI green.
- Put a real DSN in `.env`, send a request, confirm spans in Sentry; check whether `gen_ai.invoke_agent` shows in Explore -> Agents (the CP1 gate). If the Agents view needs extra attributes (e.g. a model name), that is the first thing to diagnose.
- Fix `<YOUR NAME>` in LICENSE.

## Evidence
See `docs/checkpoints/checkpoint-1-evidence.md` (checklist; fill with real captures only).

## Next checkpoint
CP2: model adapter (Gemma hosted + Fake), strict JSON, real latency logged.

---

# Checkpoint 2 — Gemma AI core

## Task
Replace the placeholder planner with a real open-weight (Gemma) workflow behind the existing
`WalkPlanner` seam: structured output, validation, timeout, failure handling, fallback, Sentry tracing.

## Audit of Checkpoint 1 (what was actually true)
- Verified on a clean `npm ci`: typecheck passes, 9 tests pass, build passes.
- The ZIP contained no `.git`, so no commit SHA is available. CI had never run on GitHub (CP1 doc says so).
- `docs/checkpoints/checkpoint-1-evidence.md` was an unfilled checklist: CP1's Sentry-to-real-project and
  Explore -> Agents checks were still outstanding. Not blocking for CP2, but still open.
- `LICENSE` still contains `<YOUR NAME>`.

## What I changed
- New `src/ai/`: `errors`, `modelClient` (+ HTTP/error classification), `googleGemmaClient`,
  `ollamaGemmaClient`, `prompt`, `planValidation`, `gemmaPlanner`, `fallbackPlanner`, `createPlanner`.
- `WalkService` now takes `(primary | null, fallback)`, returns honest `meta`, and traces fallback decisions.
- `env.ts` gains Gemma settings with fail-fast cross-field validation.
- `tracing.ts` gains `withModelSpan` (`gen_ai.chat`) and `annotateActiveSpan`.
- Removed `placeholderPlanner.ts` (the CP1 placeholder). The new `FallbackPlanner` is explicitly labelled `fallback`.
- `npm run smoke:gemma` for a one-command real-provider check.

## Decisions
- **Hosted Gemma first, Ollama second, both thin.** Hosted model id `gemma-4-26b-a4b-it` is taken from Google's
  Gemma-on-Gemini-API docs (read 2026-10-07). Ollama has no assumed default tag because I could not verify one.
- **No new dependencies.** Node 22 `fetch` + `AbortController` are enough; an SDK would add weight for one HTTP call.
- **Instructions in the user turn, no JSON-mode / system-instruction parameters.** I could not verify Gemma supports them
  on the Gemini API, and the validator makes them unnecessary for correctness.
- **Fallback lives in CP2, minimally.** The CP2 gate requires "model failure -> fallback". The richer fallback bank,
  repair retry, and safety rules remain CP4.
- **Model failure is a 200 with `planner: "fallback"`, not a 5xx.** The user always gets a walk; the label stays honest.
- **Validation is inside `GemmaPlanner`**, so the only model path cannot skip it.
- Timeout default 15 s is a placeholder, not a measurement. CP7 replaces it with data.

## Failures and corrections during the build
- **Real bug found by a test:** a client that rejects when aborted could win the race against the timeout rejection and be
  classified `unknown` instead of `timeout`. Fixed: the planner now reports `timeout` whenever its own budget expired.
- Sentry SDK v11 serialises spans as `name` + `attributes['sentry.op']` (streamed shape), not `op`/`description`; the first
  version of the Sentry test assumed the old shape and failed.
- `pkill -f` in a smoke-test command matched my own shell; and a stale `dist/placeholderPlanner.js` from the baseline
  build was still present. `dist/` is rebuilt from clean before packaging.

## Testing
55 tests, 6 files, no network, no paid calls: API behaviour with scripted model outputs; validator rules; both adapters
with injected `fetch`; both adapters over real HTTP against a local server (including a slow server to prove the
abort/timeout works over a real socket); env validation; real Sentry SDK span tree + privacy check.

## NOT verified
- Any live call to Google or Ollama (no key / no internet in the build environment).
- GitHub Actions run, real Sentry project delivery, Explore -> Agents.

---

# Checkpoint 3: Outdoor Context Engine

## Task
Make PocketWalk context-aware: user preferences + local time + weather + daylight -> normalised `OutdoorContext` -> Gemma,
without breaking Checkpoint 2 (fallback, validation, Sentry, API).

## Audit of Checkpoint 2 (what was actually true)
Re-verified from a clean `npm ci` before any change: typecheck PASS, 55/55 tests PASS. Gemma adapters (Google, Ollama),
validation, fallback and Sentry spans all present as documented. `contextBuilder.ts` was a pass-through placeholder
(`{minutes, energy}`) wrapped in a `prepare_context` tool span. Still open from CP2 and **not** addressed here: live Gemma
call, GitHub Actions run, real Sentry delivery, `LICENSE` name, no rate limiting.

## What I changed
- New `src/context/`: `types`, `weatherProvider` (interface + `WeatherError`), `openMeteoProvider`, `daylight`, `normalize`,
  `contextBuilder` (moved from `src/services/`), `createWeatherProvider`.
- `WalkService` takes a `ContextBuilder`, wraps it in the `context.build` tool span (replacing `prepare_context`), annotates the
  agent span, and returns `meta.context`, `meta.contextLatencyMs`, `meta.weatherLatencyMs`.
- `prompt.ts`: fixed guidance sentence per code + one facts JSON block (identical to CP2's block when no location is sent).
- `fallbackPlanner.ts`: honours the same guidance (storm/dark/low light/rain/heat/cold/wind), still labelled `fallback`.
- Controller: optional `location: {city}`; `env.ts`: `WEATHER_PROVIDER`, `WEATHER_TIMEOUT_MS`.
- `sentryConfig.ts`: shared privacy options used by `instrument.ts` and by the privacy test.
- Scripts: `smoke:weather`, `scenarios`.

## Decisions
- **Provider: Open-Meteo.** No API key (nothing to leak or provision), current weather + daily sunrise/sunset in one call,
  local time zone via `timezone=auto`, keyless geocoding by city name. Contract read from the official docs on 2026-10-07
  (geocoding and forecast pages). Not chosen: key-gated providers (signup + secret handling before the deadline for no
  extra value here). Cost: two sequential HTTP calls per request, and a **non-commercial-only** free tier.
- **Location = a city name, per request.** No GPS, no storage. Coordinates exist only inside the provider (rounded to ~1 km)
  and never leave it. Free-text city is validated to letters/spaces/`.,'-` and URL-encoded; it never enters a prompt.
- **Daylight from the same forecast response**, compared against the local clock. No astronomy library, no extra call.
  Unavailable (not guessed) when sunrise/sunset are missing or not for the local date.
- **Time zone comes from the weather provider**, so a failed lookup also means no time-of-day. Accepted: a server clock in
  an unknown zone would be a guess. Revisit in CP5 if the client can send an IANA zone.
- **Deterministic guidance, not model judgement.** Seven codes derived in code, each mapped to one fixed prompt sentence and
  one fallback branch. This is the minimum "do not make a poor situation worse" rule; the full safety system is CP4.
- **Weather failure never fails the walk.** One abortable budget for the whole lookup; every failure is a closed enum;
  non-`WeatherError` exceptions are contained as `unknown` and captured.
- **No new dependencies.** Node `fetch` + `AbortController`, Zod (already present) for provider-response validation, `Intl` for local time.
- **`meta.context` added to the response** (enumerated facts, no location) so the client can later show "light rain, 15 C"
  and so a fallback or a missing weather source is never silent. Existing fields are unchanged.
- **Kept CP2's prompt rule** "never mention darkness/water/..." but added "unless the context says so", so the dark guidance and rain do not contradict it.

## Failures and corrections during the build
- Two of my own tests had wrong expectations, not code bugs: 12:00Z is 17:30 in Kolkata (so "near sunset" was correct), and
  06:30Z is 12:00 local, which is `afternoon` (not `morning`). Fixed the tests after working out the arithmetic.
- A redundant `else if (fog)` branch in the guidance function (fog was already handled above it) was removed on review.
- **Sentry control experiment:** I ran the privacy test with the outgoing-request suppression removed. The leak test still
  passed (Sentry v11's `urlQueryParams: false` already scrubs query strings), but automatic `http.client` spans for the
  weather hosts did appear. So the suppression is defence in depth plus span hygiene, not the only line of defence. Documented as such.
- In the build sandbox the egress proxy answers 403 for Open-Meteo, which the adapter correctly classifies as `misconfigured`
  (a 4xx that is not 429). The walk was still served. This was the only "live" provider interaction possible here; it says
  nothing about Open-Meteo itself.

## Testing
193 tests, 10 files, no network, no paid calls (55 from CP2, unchanged and passing; 138 new): daylight windows and edges,
time-of-day boundaries, time-zone conversion incl. midnight rollover, normalisation bands, every guidance rule, builder
(success, partial, no location, no provider, each failure reason, hang -> timeout + abort, provider bug), Open-Meteo adapter
against documented-shape fixtures (requests sent, mapping, malformed bodies, HTTP statuses, network error, abort), the four
Gemma x weather combinations over HTTP, prompt contents (facts present, location/raw fields absent), fallback validity for
every guidance combination, request validation, env, and real-SDK Sentry span tree + privacy.

## NOT verified
- Any live call to Open-Meteo (the sandbox blocks it). Fixtures are written from the docs, not captured from the service.
- Real timings of weather lookup, context build or Gemma. None are claimed.
- Any live Gemma call, GitHub Actions run, real Sentry delivery (all carried over from CP2).


# Checkpoint 4: Structured AI + Safety

## Task
Make the AI pipeline robust: never trust model output because it is valid JSON. Add a deterministic, provider-independent
safety layer that runs after generation, validate the fallback with the same rules, keep telemetry truthful, and do not
break Checkpoint 3.

## Audit of Checkpoint 3 (what was actually true)
Re-verified from a clean `npm ci` before any change: typecheck PASS, 193/193 tests PASS. The CP3 plan schema was
`{title, steps[3]{minutes,text}, notice}`; parse, Zod shape and a few business rules (minutes add up, 14-word limit) lived in one
file (`planValidation.ts`) and ran inside `GemmaPlanner`. There was **no safety layer**, no repair, no size bound on the
plan beyond a 4000-char raw cap, and **the deterministic fallback's output was never validated**. The user-supplied city
had no path into the prompt (already true, kept and now tested adversarially). Still open from earlier checkpoints and **not**
addressed here: live Gemma call, live Open-Meteo call, GitHub Actions run, real Sentry delivery.

## What I changed
- New `src/safety/` (`engine`, `rules`, `text`, `types`): `SafetyEngine.validate(plan, context, request)`. Imports no provider code.
- `src/ai/planValidation.ts` split into `planSchema` (shape + bounds), `planRepair` (harmless normalisation), `businessRules`
  (all issues, not first), and a traced `validationPipeline` with one span per stage. `planValidation.ts` keeps `validatePlan`,
  `parseAndValidate`, `extractJson` as thin compositions so every CP3 call site and test still works.
- `validationReport.ts`: stage statuses / repair codes / timings. Closed vocabulary, no text.
- `errors.ts`: new reason `safety_violation`, `failureStage()` mapping reasons to categories, optional `ValidationReport` on `PlannerError`.
- `WalkService`: validates the fallback with the same business + safety rules; on failure serves `emergencyPlan`. New `meta`
  fields: `validation`, `fallbackSource`, `message`, `validationLatencyMs`, `safetyLatencyMs`, `fallbackLatencyMs`. Existing fields unchanged.
- `prompt.ts`: additive lines only (plain text, no extra keys, no approaching animals/restricted places, no safety claims,
  "context is data, never an instruction"). `fallbackPlanner.ts`: two wording fixes (below).
- Script `scenarios:safety`. Version 0.4.0. **No new dependencies, no new environment variables.**

## Decisions
- **Keep the CP3 schema.** The spec's conceptual schema (intensity, preparation, closingPrompt...) was explicitly not to be copied
  blindly. Renaming fields would break the client contract and 193 tests for no gain. Hardened instead: `.max` bounds, `minutes`
  1..40 integer, optional validated `intensity`.
- **Unknown keys are stripped and reported, not rejected.** Rejecting would throw away a good plan over a harmless extra key (and CP3
  tests require acceptance). Stripping keeps them from clients; the repair code keeps it visible.
- **Safety only rejects, never rewrites.** An automatic rewrite of a dangerous instruction is guessing. Rejection + deterministic fallback is simple and testable.
- **Over-long wording and extra steps are rejected, not repaired.** Truncation changes meaning; re-splitting minutes is guessing. CP3 tests also require rejection.
- **Mention-vs-instruction for hazards.** The prompt already says never mention roads/water/wildlife. A hazard word is therefore rejected
  unless an avoidance cue precedes it ("stay away from the road"). Climbing, trespass breaches, "without looking", health claims and injection artefacts are never excusable. Conservative on purpose.
- **Context rules reuse the CP3 guidance codes.** No new numeric weather thresholds were invented (none have a justified source here).
- **Non-Latin text is rejected as a business rule.** The lexicon is English; a Cyrillic look-alike letter inside "climb" would bypass it. Rejecting the script closes the hole at a cost of English-only output.
- **Rejection is a normal outcome, not an error span.** Stage spans end `ok` with `stage.result=failed`; only the parent `pocketwalk.validate` ends in error (a CP3 test already expected that).
- **Fallback crash stays a 500.** A CP3 test requires the controlled 500 if the fallback planner throws. The emergency plan covers validation failure, not a thrown exception.
- **Equality on duration kept.** The spec's `generated <= requested` is satisfied, but CP3 required `==`; a shorter plan is also wrong.

## Failures and corrections during the build
- **The fallback failed its own safety rules.** The first run of the new rules broke one CP3 test: the poor-conditions fallback said
  "covered *spot*" and "spot" is a light-dependent verb banned in the dark. Combined `poor_conditions + dark`, the deterministic fallback was unsafe by the app's own rules. Fixed the wording; a test now enumerates all 128 guidance subsets x 3 durations x 2 energies (1,536 checks) for fallback and emergency plans.
- The same sweep found a second conflict I would otherwise have shipped: the cold fallback title was "brisk" for an `easy` request, and `brisk` is banned for easy. Now `Short gentle loop near home` for easy.
- The poor-conditions fallback said "watch the weather", which the dark rule bans. Reworded to "listen to the weather".
- **Telemetry inaccuracy found by reading real output:** an oversize (1 MB) model reply reported `parse: "passed"` although it was refused before parsing. That claimed a stage succeeded that never ran. Now `parse: "failed"` with code `output_too_long`. A test asserts it.
- **My own test errors, not code bugs:** a "total output too large" fixture added up to 556 characters (limit 600); and two safety fixtures reused a notice ("shades of green") or a step ("distant birds") that the new rules correctly reject. Fixtures corrected, rules unchanged.
- **A privacy test failed and was a false alarm.** `LEAKYTEXT` appeared in the captured Sentry event. Tracing it showed it was Sentry attaching the *test file's own source line* to a stack frame, not runtime plan text. The marker is now built at runtime so the assertion tests what it claims.
- **Mutation check** (does the suite notice if a layer is removed?): safety engine always-ok = 97 tests fail; business always-pass = 24; schema accepts anything = 22; context rules ignored = 13; fallback not validated = 3; repair of titles skipped = 7. All caught.

## Testing
381 tests, 16 files, no network, no paid calls (193 from CP3 unchanged and passing; 188 new): schema (15), business rules (14), safety engine
(83), validation pipeline + repair + 1,536-combination fallback sweep (21), HTTP pipeline integration + security (46), real-SDK Sentry span tree + privacy (9).

## NOT verified
- Any live Gemma call, so **the real rejection/fallback rate of Gemma's output is unknown** (the rules are conservative; it could be high).
- Any live Open-Meteo call, GitHub Actions run, or delivery to a real Sentry project (all carried over).
- Real latency. The timings printed by `scenarios:safety` are from scripted stand-ins in a sandbox, not Gemma.

## Checkpoint 5: Frontend experience

Goal: a real, mobile-first React frontend on the unchanged CP4 backend. No backend source file was modified.

### Audit findings that shaped the build (from the CP4 code, not the prompts)
- No frontend existed. The API is `POST /walks/plan` only; minutes are exactly 10/20/40; energy is `easy|normal`; location is `{city}` or nothing.
- `WalkPlan` is `{title, steps[3], notice}`: no description, no safety-note field. The UI therefore shows none rather than inventing them.
- Errors are `{error: string}` (400 invalid body, 404, 500). Fallbacks are HTTP 200 with `meta.planner = "fallback"`.
- **No CORS headers.** A browser app on another origin cannot call the API. Chosen fix: no backend change; the Vite dev/preview server proxies `/walks` and `/health`.
- There is no frontend Sentry. Decision: none added (see summary): the backend remains the AI observability system, and a crash boundary shows fixed copy.

### What was built
Vite + React 19 + TypeScript package in `frontend/`; typed API client with runtime response guard; discriminated-union state machine with one in-flight request;
six screens; plain CSS with tokens; 75 tests; fixtures captured from the real backend; a QA harness (`scripts/qaServer.ts`).

### Decisions
- **No "Start walking" button on the Ready screen.** The phone-down experience is Checkpoint 6; a button that does nothing is dishonest. The screen says "Ready?" and offers back / plan another.
- **Fallback is shown as a normal plan** with one quiet line ("A simple ready-made walk."). It is honest (the backend promises fallback text is never labelled AI) without saying anything failed.
- **Client city validation mirrors the backend rule** so typos are caught before a request. The backend still validates; the UI copy for a 400 is fixed text.
- **No state library, no router, no UI kit.** A reducer and six components are enough. JS bundle 234 kB (73 kB gzip), almost all React.
- **Fixtures are captured, not hand-written** (`npm run fixtures:frontend` runs the real app via supertest with a scripted model/weather), so the contract tests parse real response shapes.

### Failures and corrections during the build
- A first `mkdir` used brace expansion under `sh`, which created one literal directory named `{api,components,...}`; the files then failed to write. Found immediately, fixed, files rewritten. I also deleted the fixtures folder while tidying and regenerated it from the backend.
- One test of mine was wrong (it expected Tab to reach "Back" first; focus correctly starts on the heading). Fixed the test, not the app.
- **Real visual bugs found only by looking at screenshots:** at desktop width "16 min" wrapped onto two lines and step text ran past its divider; at 360px the "Take your time" hint wrapped and made the tiles uneven; on desktop the Start button stretched across the whole column. All fixed and re-checked.
- **Contrast check found weak control borders** (1.46:1 for the inputs and unselected tiles). Darkened to about 3.9:1.
- **Real UX bug found by the clean-extraction browser run:** a quick double-tap on "Try again" started the request, the screen swapped to "Preparing your walk", and the second tap landed on the Cancel button in about the same place, aborting the request and dropping the person back on the form. Fix: Cancel only appears after 1.5 s (its space is reserved so nothing jumps), with a test. Single-click behaviour was already one POST; this only affected fast double-taps.
- QA tooling stumbles (not product bugs): background servers did not survive between tool calls, `pkill -f` once killed my own shell, and `ss`/`fuser` were missing, so a stale backend answered on port 3000 and I briefly tested the wrong server. Caught because `/__qa/set` returned 404. The first headless-Chromium Tab landed one step late until focus was anchored on the page body.

### Not verified
Live Gemma, live Open-Meteo, Sentry delivery, GitHub Actions, any browser other than headless Chromium, real phones, screen readers, production deployment.

## Checkpoint 6 - phone-down experience

### Audit (verified against the files, not the CP5 report)
Frontend state was a discriminated union ending at `READY_TO_WALK`; `ReadyPage` had no start control by design; `WalkPlan.steps` are `{minutes, text}` and the backend business rule makes them sum to the requested minutes;
there were no timers or browser tests in the repo (CP5's browser QA ran from outside it); CP5 baseline: frontend typecheck clean, 75 tests.

### What was built
Start action; `WALK_ACTIVE`, `EXIT_CONFIRMATION`, `WALK_COMPLETE`; a `Clock` abstraction; pure timer maths; a once-per-second timestamp tick that also recalculates on visibility; a quiet dark active screen; a two-step exit; a plain completion screen;
37 new frontend tests; `scripts/browser/cp6_flow.py` (47 browser checks).

### Decisions
- **Timer from timestamps** (`startedAt + duration`), `Date.now()` rather than `performance.now()`, because the phone-down case is a sleeping phone.
- **The intro is display-only**, derived from elapsed time, so the timer starts at the press and there is no extra state or screen.
- **Plan steps are the schedule**; no timing is invented. **Walks are ephemeral**: refresh goes Home.
- **Exit keeps the timer running** under the confirmation instead of pausing, so there is no pause state and no lost time; a walk that ends while the question is open completes.
- **No pause, no per-step interaction, no voice, no notifications, no Wake Lock, no persistence, no frontend Sentry.**

### Failures and corrections during the build
- Testing Library's async helpers only drain fake timers when a `jest` global exists; under Vitest every `await user.click()` hung until timeout (22 of 22 tests). Fixed with a tiny scoped shim in `tests/walk.test.tsx`. Diagnosed by isolating, not guessing.
- A test of mine expected a straight apostrophe where the app uses a typographic one (test bug, not app bug). A convoluted assertion about the spoken summary was rewritten.
- Browser QA: I passed milliseconds to Playwright-Python's clock, which takes seconds for plain numbers, so the page thought it was year ~58000 and `run_for` never returned. Switched to `datetime`. Separately, `page.screenshot()` hangs while the fake clock is paused (it waits for an animation frame), so screenshots moved to a section with a running clock.
- A focus-trap check failed because it counted `<body>` (Tab leaving the page into browser UI) as an escape. The real requirement is that focus never lands on the inert background; the assertion was corrected to test that, and it passes. A focus check after a real double-click also failed: the second click lands on the new screen and blurs the heading (a test artifact; keyboard start is tested separately).
- One screenshot looked too dim. I measured it: it was caught mid fade-in; the computed colour is `#eef4ee` and opacity settles at 1.
- Tooling: a command exceeded the 300 s limit because background servers kept the shell attached; and I again used `pkill -f` with a pattern present in my own command line, which killed the command (twice; same mistake as CP5).

### Not verified
Real phones, Safari/iOS, Firefox, Android Chrome, any screen reader, forced-colors mode, real tab throttling or screen lock, GitHub Actions, live Gemma/Open-Meteo/Sentry (all unchanged from CP5), production.


## Checkpoint 7 - Sentry performance and observability

### Audit (verified against the files, not the CP6 report)
CP6 baseline reproduced from the ZIP: backend typecheck clean, 381 tests; frontend typecheck clean, 112 tests; both builds and `npm audit` clean (0 vulnerabilities).
The tracing architecture already existed from CP2-CP4 (agent span, context tool span with weather/daylight children, `gen_ai.chat`, a validate span with one child per stage, fallback spans, `dataCollection` privacy options, suppression of weather-host request spans). CP7 extended it instead of replacing it.
Gaps found: no closed-set error category on traces; a failed model span did not say why or how long it took; no request-shape or total-duration attributes on the root; no `gen_ai.provider.name`; the sample rate was silent; and, via the new privacy test, raw error messages were sent by `captureException`.

### Environment (what could and could not be done)
No `GEMINI_API_KEY`, no Ollama, no route to Google or Sentry from the build sandbox. So: **no live Gemma measurement, no live Open-Meteo measurement, no Sentry delivery check.** None of these were faked.

### Baseline and investigation
`scripts/measureLatency.ts` (new, `npm run measure:latency`) drives the same `WalkService` the route uses and reports per-stage p50/p95/min/max from the timings the service already records. With no provider configured it runs a SYNTHETIC mode: scripted model and weather with artificial delays (model 800 ms, weather 300 ms). 30 runs after one discarded warm-up, in-process, no HTTP, no Sentry:

| stage (ms) | p50 | p95 | min | max |
|---|---:|---:|---:|---:|
| total | 1106.0 | 1114.0 | 1105.0 | 1117.0 |
| context | 301.0 | 302.0 | 300.0 | 302.0 |
| model | 801.0 | 802.0 | 800.0 | 806.0 |
| validation | 3.4 | 10.2 | 2.3 | 10.3 |

The context and model rows are the delays I chose plus about 1 ms; they are not measurements of anything real. The only real information is PocketWalk's own overhead: total minus context minus model is about 4 ms, validation about 3 ms. Conclusion: in-process work is not where latency can come from; the real bottleneck (Gemma vs weather network time) is unknown until someone runs the script live.

### Bottleneck and optimisation
**None identified, none applied.** Dependency analysis: the prompt needs the context, so weather and model cannot be parallelised without changing behaviour; geocode -> forecast is inherently sequential. A geocode cache (city -> coordinates) would remove one network hop, but it is server-side state keyed by user-entered cities and there is no live evidence it matters, so it was not built. Result for the before/after question: **no reliable performance improvement was demonstrated**, because none was attempted without evidence.

### Decisions
- Extend the existing spans; do not add a tracing layer. Keep the agent span as the logical root (the HTTP server span above it is automatic).
- Error categories are a pure mapping over the existing closed enums; no new failure taxonomy.
- Context and model causes get separate attributes so a trace can show both.
- Sample rate stays configurable, default 1, now announced at startup (documented as a development/evidence setting).
- No frontend change; CP6 behaviour preserved (browser run below).

### Failures and corrections during the build
- My first privacy test failed twice. One failure was my own regex rejecting an empty string (test bug, loosened). The other was real: raw error messages (a fake provider message containing a key and a city, and a TypeError message) appeared in the outgoing Sentry error envelope via `captureException`. Fixed in the code (`captureUnexpected`), not the test. A third, smaller failure was a test artifact: Sentry's source-context lines quoted the literal in my fake provider's source; the fake now builds the message at runtime so the test checks the message and not the source file.
- The leak is a CP6 defect that CP6's privacy test did not catch because it never made a provider throw a non-enum error.

### Not verified
Live Gemma, live Open-Meteo, Sentry delivery and the Sentry UI, any real latency number, GitHub Actions, any browser other than headless Chromium, real phones.

## Checkpoint 8 - Reliability and testing

### Audit and baseline (reproduced from the CP7 ZIP, not taken from the report)
Backend typecheck clean, 392 tests; frontend typecheck clean, 112 tests; both builds and both `npm audit` (0 vulnerabilities) as reported. No discrepancy. Express 5, so a throwing async handler reaches the error middleware (no unhandled rejection from the route).
Read before changing: error handler, app wiring, controller and zod schema, walk service, planner/timeout code, both model clients, the Open-Meteo provider, validation pipeline, emergency plan, Sentry config and instrumentation, the frontend API client, `useWalkFlow`, `ErrorBoundary`, error copy, existing tests, CI.
What was already solid and was left alone: provider `AbortSignal` propagation, timeout helpers (a late result or late rejection cannot change a built response), no retries, validated fallback with an emergency plan, strict frontend response parsing, single-flight submit with run ids, closed error copy.

### Findings (each fixed and covered by a test that fails without the fix)
1. **Confirmed (the CP7 open item): unexpected 500s leaked their message to Sentry.** `errorHandler` called `Sentry.captureException(err)` and `Sentry.setupExpressErrorHandler` captured the raw error as well. Fixed: both removed in favour of `captureUnexpected` (class + stage + frames, no message); the handler logs the class name only.
2. **Global SDK paths were unguarded** (console breadcrumbs, request data, unhandled-rejection capture, local variables). Added `scrubEvent` as `beforeSend` and `beforeBreadcrumb` dropping all breadcrumbs. In the real-process check the SDK produced its own raw-message error event for the dev route; the scrubber redacted it, which is the evidence this layer is needed.
3. **`beforeSendTransaction` was a silent no-op** (this SDK streams spans; it logs a warning). Replaced with `beforeSendSpan` (`scrubSpan`), which drops client/network address, query, fragment, header and user attributes the http instrumentation adds.
4. **The HTTP access log (morgan) printed query strings** (`?token=...`), found by the real-process test's last assertion. Now path only, no referrer or user agent.
5. **Provider response bodies were read unbounded** (`res.json()`). Added a streaming byte cap (model 1 MiB, weather 128 KiB) mapped to existing closed reasons.
6. `captureUnexpected` itself could throw if the SDK did; it now swallows reporting failures (a Sentry fault cannot break a request).

### Examined and found safe (no change)
`dangerouslySetInnerHTML`/`eval`/dynamic HTML: none in backend or frontend. All telemetry call sites: closed-set values only. No request/header/prompt/model-output logging. Floating promises: only `void`ed shutdown and `.catch`-guarded stream cancels. Secrets: the API key is only a request header inside the Google client. Model text is rendered as text on the frontend (existing test).

### Decisions
- No rate limiter (single-process in-memory limiting is wrong for more than one instance; belongs at the edge in CP9). Documented, not hidden.
- No overall request deadline and no server-side cancellation on client disconnect: the budgets already bound work, and plumbing a signal through every layer was not justified here. Documented as limitations.
- CI left unchanged: it already uses Node 22, `npm ci`, all four checks on both halves, read-only permissions and no secrets.
- The global scrubber redacts every exception message, including genuine bugs. Class and stack frames remain, which is enough to locate a bug; a message that might hold a key is not worth keeping.

### Failed approaches and corrections during the build
- First scrubber used `beforeSendTransaction`; the SDK warned it is ignored for streamed spans. Switched to `beforeSendSpan`.
- Adding `beforeSend` to the shared privacy options overwrote the capture hook of one existing test (`safetyTrace.test.ts`), which then found no message event. Fixed the test's hook order so it records what the scrubber outputs; assertions unchanged. This is the only modified test.
- My own test expectations were wrong in three places: `charset=utf-7` with ASCII JSON is simply parsed (200), so the charset test uses an unknown charset instead; the browser scenario for a 500 needs the model to fail first (`mode=crash` only breaks the fallback); a Playwright route lambda took the wrong arguments. Each was a script/test mistake, not a product defect.
- Mutation checks: restoring the CP7 error handler and removing the scrubber fails 3 privacy tests (including the real-process one); removing the stale-response check fails 2 frontend tests; removing the in-flight ref guard initially failed NOTHING (user-event re-renders between clicks), so a same-tick hook test was added and then failed as it should.

### Not verified
Live Gemma, live Open-Meteo, ingestion by a real Sentry project, GitHub Actions, real devices or browsers other than headless Chromium.

## Checkpoint 9 - Production deployment

### Audit and baseline (reproduced from the CP8 ZIP, not taken from the report)
Backend typecheck clean, 513 tests; frontend typecheck clean, 147 tests; `npm audit` 0 vulnerabilities (both). Matches the CP8 report; no discrepancy. Not reproduced at this point: the browser counts (48 and 22), which were re-run later against the new same-origin shape. No Docker or Podman in the build environment.
Read before changing: server and app wiring, env schema, health route, walk controller and router, walk service, both timeout helpers, context builder, the frontend API client and Vite config, CI, `.gitignore`, `.env.example`.
Facts that shaped the design: the backend sends no CORS headers; the frontend calls a relative `/walks/plan` (`VITE_API_BASE_URL` defaults to empty); the frontend has no client-side routes; the frontend's timeout is 30 s; `app.listen(PORT)` had no host, no proxy setting, and a SIGTERM handler that only called `server.close()` with a 10 s hard exit.

### Architecture decision
One Node service that also serves `frontend/dist`. Chosen over "static frontend + separate API" because the project already has no CORS by design, the frontend is already same-origin, and a second deployable would add CORS, a build-time API URL and a second set of failure modes for a two-endpoint app. Cost: the Node process also serves static files (negligible here; a CDN can be put in front without changes). Provider-specific parts left to the user: the host, TLS, secrets entry, the proxy hop count, any edge rate limit.

### The seven CP8 open items
1. Rate limit: added (in-process, fixed window per client, before body parsing, `POST /walks/plan` only).
2. Concurrency cap: added (counter + immediate 503, released in a `finally`).
3. Overall deadline: added (`RequestScope`, budgets carved from the remaining time, deadline race in the controller, `planFallbackNow`, controlled 504).
4. Max timeouts exceeding the frontend's 30 s: `REQUEST_DEADLINE_MS` is capped at 28 s by the schema and each provider budget is shortened to what is left; configured timeouts that exceed the deadline produce a startup warning.
5. Abandoned requests: now cancelled (disconnect aborts the weather fetch and the model request, no new stage starts, nothing is written to the closed socket, the slot is released).
6. Real Sentry ingestion: still **not verified** (no access to a Sentry project).
7. GitHub Actions: still **not verified**; CI extended (below) but not run remotely.

### Other changes
Production config fails fast (`TRUST_PROXY` required); `/ready` added next to `/health`; graceful shutdown rewritten and made testable; security headers and a CSP; `buildAppFromEnv` so the tests exercise the real wiring; bundle scanner; Dockerfile and `.dockerignore`; trace sample rate defaults to 0.1 in production; frontend gains a `busy` error kind so a 429 or 503 no longer says "something went wrong on our side".

### Findings and failed approaches during the build (all fixed unless noted)
- **My first deadline tests tested nothing.** With a 150 ms test deadline, the 1.5 s reserve plus 2 s minimum model budget meant the model was (correctly) skipped, so the "deadline wins" path never ran, and one test even produced a real unhandled rejection from its own never-awaited promise. Two real consequences: the budgets became injectable (`budgets` option) so the path can be tested in milliseconds, and the schema minimum for `REQUEST_DEADLINE_MS` was raised from 2000 to 5000, because below about 3.5 s no model call can ever fit.
- A leftover constant reference after that refactor (`RESPONSE_RESERVE_MS`) made most of the new tests fail at runtime with a ReferenceError while typecheck was red; fixed.
- Burst test hung: I answered the held requests as soon as three were admitted, which freed capacity before the other seven had connected, so they were admitted and waited forever. Fixed by waiting for all seven refusals first. (A test race, not a product bug.)
- The drain-header test compared against supertest's own `Connection: close`; now forces keep-alive for the comparison.
- **Pre-existing test flaky under load.** One of three consecutive runs failed; I reproduced it by running three suites in parallel on this one-CPU machine: `validationPipeline.test.ts` "EVERY subset of guidance x duration x energy" takes 2.4 s alone and 7+ s under contention against vitest's 5 s default. My new real-process tests added the contention. Fix: `testTimeout: 20000` in `vitest.config.mts` (no assertion changed). Re-verified with three parallel suites, 611 passing each.
- A "port 3000 busy" confusion in my own browser procedure: killing the `npx` wrapper left `qaServer` listening, so a later server exited with EADDRINUSE and a browser run hit the wrong server; found from the exit message, then ports were verified free before each run. `pkill -f` also matched its own shell. Process hygiene, not product.
- A plain `npm ci` with `NODE_ENV=production` skips the dev dependencies and breaks `tsc` (reproduced: TS2688). The documented build command uses `--include=dev`; the Dockerfile build stage is unaffected because `NODE_ENV` is only set in the runtime stage.
- The Playwright "Task was destroyed but it is pending" line in the failure script is noise from its deliberately never-answered route; it does not affect results (not fixed).

### Mutation checks
Each protection was broken in turn and the tests had to fail: trusting every proxy (2 fail), never releasing a slot (6), removing the deadline race (4), ignoring disconnects (3), removing the limiter (7), ignoring the remaining budget for the model (4), removing the drain header (1), serving HTML for unknown paths (2). All were restored; the suites are green.

### Docker status
Not built: no Docker here. Substitute checks: the build stage's exact commands were run on a copy of the project with `.dockerignore` applied (98 files, `tests/` excluded) and succeeded; the runtime stage's exact file layout (`package.json`, pruned production `node_modules`, `dist`, `frontend/dist`, no dev tools) was started like the image `CMD` and probed (health, ready, app shell, API, headers, SIGTERM). The CI `docker` job would be the first real build; it has not run.

### Not verified
Live hosting, a real Docker image build and run, GitHub Actions (including the two new jobs), real Sentry ingestion, live Gemma and Open-Meteo, real phones, browsers other than headless Chromium, behaviour behind a real reverse proxy (hop counts were tested with the header semantics, not with a real proxy).

## Checkpoint 10 - Open-source polish

### Audit and baseline (reproduced from the CP9 ZIP, not taken from the report)
Backend typecheck clean, 611 tests; frontend typecheck clean, 151 tests; `npm audit` 0 vulnerabilities (both). Matches the CP9 report; no discrepancy. The browser counts (48, 22, 9) and the builds were re-run later from the final tree.
Read before changing: README, architecture, both logs, all checkpoint docs, package manifests, LICENSE, `.gitignore`, both `.env.example` files, CI, Dockerfile, scripts, and the tree for stray or generated files.

### What was found
- **README was out of date and in the wrong shape:** it announced "Checkpoint 6", was organised as a per-checkpoint changelog (240 lines), and answered few of a newcomer's questions in order. No contributor guidance, Code of Conduct, issue or PR templates, or security policy existed.
- **`LICENSE` is MIT with the copyright line still `<YOUR NAME>`.** The text is otherwise the canonical MIT text (compared programmatically) and agrees with `package.json` and `frontend/package.json` (`MIT`). Not fixed: the holder's name is the owner's decision, so it is flagged, not invented.
- **The six planning documents (`docs/00`-`05`) look current but are not:** they describe a "window gate" that refuses a walk, a repair retry, and a different checkpoint plan. Checked against the source: no refusal or gate exists, and the model is called once.
- `frontend/.env.example` still said "the CP4 backend sends no CORS headers" and did not mention that production serves the frontend itself (the CORS fact is still true; the framing was stale).
- `architecture.md` was titled "Architecture (Checkpoint 6)" though it covers CP1 to CP9.
- No guard against broken documentation links; `package.json` had no keywords; `.gitignore` did not exclude release archives.
- Secret-shaped strings in the repository: exactly three, all deliberately fake test fixtures (a fake key sentinel, a fake DSN, a private-key header used to test the bundle scanner). Kept.
- Nothing obsolete to delete: no debug scripts, temporary files or generated artifacts were present in the tree (`dist`, `node_modules`, `.env` are absent and ignored).

### What was done
- **README rewritten** (127 lines): purpose and audience, features, how it works (diagram and the six-step flow), the safety limits stated plainly, technology, local setup with no API key, provider table, configuration, commands, testing, production, a three-row verified / externally verified / not verified table, known limitations, documentation index, contributing, license. Every claim was checked against the repo (for example the `.env.example` defaults, the script names, the ports, and the removal of an unverified "three-tap" wording). The old per-checkpoint README sections were not copied elsewhere unchanged: the API detail moved to the new `docs/api.md`, and the per-checkpoint detail already lives in `architecture.md` and `docs/checkpoints/`.
- **`docs/api.md`** (new): endpoints, request rules, response and `meta` fields, error table including the CP9 statuses (429, 503, 504).
- **`CONTRIBUTING.md`**: scope and what is out of scope, prerequisites, setup, the exact pre-PR commands, a map of where code lives, PR expectations, bug reporting, secrets hygiene, and AI-assisted contribution rules (read it, run it, break it to prove the test works, verify claims, never weaken safety or tests, never paste secrets, disclose).
- **`CODE_OF_CONDUCT.md`**: Contributor Covenant **2.1**, text and attribution preserved verbatim, fetched from the official contributor-covenant.org page (not written from memory). Only its own `jangidpiyush16011@gmail.com` placeholder is left, for the owner.
- **`SECURITY.md`** (new, not asked for by name but needed: the issue template tells people not to report privacy problems publicly, so there has to be somewhere else to go).
- **Issue forms** (`bug_report.yml`, `feature_request.yml`) and **PR template**: short, with a redaction checkbox, a scope check, and a verification section that asks what was and was not run.
- **Historical banner** on `docs/00`-`05` (kept, not deleted; the banner states how the product differs). `frontend/.env.example` and the `architecture.md` title corrected. Keywords added; `*.zip` ignored.
- **`scripts/checkDocs.ts`** and `npm run check:docs`: every relative Markdown link and heading anchor must resolve (GitHub slug rules); owner-only placeholders are listed as notices, never failures. `tests/docsCheckCp10.test.ts` (15 tests) covers the checker, then holds the repository to it, and also asserts the contributor files exist, the README links to them, the Code of Conduct keeps its attribution and headings, and `LICENSE` is MIT and agrees with both `package.json` files. Mutation-checked: a broken README link, a renamed CoC heading and a broken CONTRIBUTING link each fail the tests; restored.

### Decisions
- Contributor Covenant **2.1** rather than 3.0 (which the site now lists as latest): 2.1 is the version the project can verify and is still widely adopted; moving to 3.0 later is a one-file change.
- No badges (none could be honest: there is no CI run, release or deployment to point at), no CHANGELOG, no Dependabot or CODEOWNERS, no `repository`/`bugs`/`homepage`/`author` fields in `package.json`: each needs a fact only the owner has.
- `config.yml` for the issue chooser was not added: its contact links need a repository URL.
- Existing CI was left unchanged: `npm test` already runs the docs tests, so documentation changes are checked on every push.

### Mistakes and corrections during the build
- My first search for the Code of Conduct returned secondary copies (a Hugging Face space, forum threads, pull requests), some truncated; I discarded them and fetched the official page, because the task requires the established text preserved.
- An early README line said "Three-tap flow"; nothing in the repo supports a tap count, so it was removed.
- The new docs tests passed on the first run, which proves nothing, so I broke the docs on purpose before trusting them.

### Not verified
That GitHub renders the issue forms and the PR template (only YAML validity was checked locally); how GitHub's community profile scores the repository; external hyperlinks (the checker is offline); everything listed as unverified in `checkpoint-9-evidence.md` (live deployment, Docker image build, GitHub Actions, real Sentry ingestion, live providers, multi-instance behaviour).
