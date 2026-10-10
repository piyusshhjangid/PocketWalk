# AI assistance log

Format: Task / AI assistance / What it suggested / What I accepted / What I changed / Why / How I tested.
**Fill the "What I accepted/changed" lines yourself after reviewing. Do not leave them as written by the assistant.**

## Checkpoint 1

| Field | Entry |
|---|---|
| Task | Scaffold Express + TypeScript service with Sentry tracing, tests, CI |
| AI assistance | Claude (Anthropic) generated the scaffold and tests |
| What it suggested | Placeholder planner behind a `WalkPlanner` interface; agent/tool spans using Sentry's documented `gen_ai.*` conventions; Zod for env + input; `dataCollection` privacy settings |
| What I accepted | _(you fill in)_ |
| What I changed | _(you fill in)_ |
| Why I changed it | _(you fill in)_ |
| How I tested it | `npm run typecheck`, `npm test` (9 pass), `npm run build`, ran compiled server, curl on all routes. Spans inspected via a local capture server (no real Sentry yet) |

### Things the assistant got wrong or had to correct during the build
- Docs it first read showed `sendDefaultPii`; the installed `@sentry/node` v11 no longer has that option (it uses `dataCollection`). Caught by the type checker.
- First `tsconfig` used `moduleResolution: node10`, which TypeScript 7 removed. Caught by the type checker.

## Checkpoint 2

| Field | Entry |
|---|---|
| Task | Replace placeholder with Gemma adapter (hosted + local), validation, timeout, fallback, Sentry spans, tests |
| AI assistance | Claude (Anthropic) designed and wrote the code, tests and docs, and ran the test/build/smoke checks |
| What it suggested | `ModelClient` transport split from `GemmaPlanner`; closed-enum failure reasons; validation inside the planner; failures served as 200 + labelled fallback; no new dependencies; `smoke:gemma` script |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | `npm test` (55 pass), `npm run typecheck`, `npm run build`, compiled server run with no provider, with provider=google and no key (fails fast), and with an unreachable Ollama (fallback). **No live Gemma call yet: run `npm run smoke:gemma`.** |

### Things the assistant got wrong or had to correct during the build
- Timeout race (see development log): caught by its own test, not by review.
- Assumed the older Sentry span JSON shape in a test; corrected after inspecting real SDK output.
- Be able to explain before submission: the prompt, why validation sits inside `GemmaPlanner`, why failures return 200, and what `fallbackReason` means.

## Checkpoint 3

| Field | Entry |
|---|---|
| Task | Add an outdoor context engine: weather provider, daylight, normalisation, deterministic guidance, context-aware Gemma prompt and fallback, Sentry spans, tests |
| AI assistance | Claude (Anthropic) audited Checkpoint 2, researched the Open-Meteo contract from its official docs, designed and wrote the code, tests and docs, and ran the typecheck/test/build/compiled-server checks |
| What it suggested | Open-Meteo (keyless; weather + sunrise/sunset in one call); city-only location with coordinates confined to the provider; context and guidance computed in code rather than by the model; one fixed prompt sentence per guidance code; failure of weather never fails the walk; `meta.context` for honesty; suppressing automatic Sentry spans for the weather hosts |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | `npm test` (193 pass), `npm run typecheck`, `npm run build`, `npm audit` (0), compiled server with real `fetch` (CP2-style request, city request with the weather host unreachable, invalid city). **No live Open-Meteo or Gemma call: run `npm run smoke:weather -- <city>` and `npm run smoke:gemma`.** |

### Things the assistant got wrong or had to correct during the build
- Two test expectations were wrong because of time-zone arithmetic (see development log); the code was right.
- Left a redundant fog branch in the first draft of the guidance function; removed on review.
- Assumed Sentry's outgoing-request instrumentation was the only thing keeping the city out of telemetry; a control run showed `urlQueryParams: false` already scrubs it. The docs now say what each layer actually does.
- Be able to explain before submission: why the time zone comes from the weather provider, what each guidance code does, why the fallback also reads the guidance, and the daylight windows (they are product choices, not measurements).

## Checkpoint 4

| Field | Entry |
|---|---|
| Task | Add structured AI output validation and a deterministic safety layer: schema, repair, business rules, safety engine, fallback validation, emergency plan, truthful meta, validation spans, tests |
| AI assistance | Claude (Anthropic) audited Checkpoint 3 from the ZIP, designed and wrote the code, tests and docs, ran typecheck/test/build, a mutation check, a live compiled-server check and a clean-extraction check |
| What it suggested | Keep the CP3 schema and harden it; split validation into separate parse/schema/repair/business/safety stages with one span each; a provider-independent `SafetyEngine` that only rejects; hazard rules that distinguish mentioning from instructing; context rules driven by the existing guidance codes; validate the fallback with the same rules plus a fixed emergency plan; reject non-Latin text to close the look-alike-letter bypass; a 1,536-combination fallback sweep; telemetry as closed-set ids only |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | `npm test` (381 pass), `npm run typecheck`, `npm run build`, `npm audit` (0), `npm run scenarios:safety`, mutation check of each layer, compiled server from a clean extraction. **No live Gemma, Open-Meteo, Sentry or GitHub Actions run.** |

### Things the assistant got wrong or had to correct during the build
- The deterministic fallback broke the new safety rules in two places ("spot" in the dark; "brisk" for easy). The sweep test found them; the fallback wording was fixed, not the rules.
- Reported `parse: passed` for output refused before parsing; found by reading real script output, fixed and tested.
- Four tests had wrong expectations or fixtures (an arithmetic slip, reused fixture text that the rules correctly reject), and one privacy test was a false alarm caused by Sentry quoting the test's own source line. None were code bugs, and each was diagnosed before changing anything.
- Be able to explain before submission: why safety only rejects and never rewrites; why mention-only hazards are excusable but climbing never is; why unknown weather adds no restrictions; why non-Latin output is rejected; why the fallback is validated; and what the safety layer does **not** do (it is a conservative English-only filter, not a certification).

## Checkpoint 5

| Field | Entry |
|---|---|
| Task | Build the real PocketWalk frontend on the CP4 backend: Home, configure, generating, plan, ready, error; typed API client; tests; browser QA; docs |
| AI assistance | Claude (Anthropic) audited the CP4 ZIP, designed and wrote the frontend, tests, fixture-capture script, QA harness and docs, ran typecheck/tests/builds, and drove headless Chromium for browser QA |
| What it suggested | No backend change (proxy instead of CORS); a discriminated-union state machine with a ref-guarded single request; an ApiError kind that maps to fixed copy so no server text renders; fixtures captured from the real app; showing a fallback as a normal plan with one quiet line; no "Start walking" button until CP6; no frontend Sentry |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | `frontend`: typecheck, 75 tests, production build; backend regression: typecheck, 381 tests, build; headless Chromium against the real backend and a scripted-model/weather harness at 360/390/430/768/1280/1440 px; keyboard-only flow; clean-extraction run. **No live Gemma, Open-Meteo, Sentry or GitHub Actions run.** |

### Things the assistant got wrong or had to correct during the build
- A shell brace-expansion slip created a literal `{api,components,...}` folder; I also deleted the fixtures folder by mistake and regenerated it.
- One keyboard test expected the wrong first Tab stop.
- Shipped a Cancel button that appeared instantly where the start button had been, so a fast double-tap could abort its own request; the clean-extraction browser run caught it, and I added a 1.5 s delay with a regression test.
- Screenshots exposed layout bugs the tests could not (wrapping "16 min", uneven tiles at 360 px, over-wide desktop button); a contrast calculation exposed faint control borders.
- During QA I briefly tested a stale backend because my port check tool did not exist; noticed from a 404 and redone.
- Be able to explain before submission: why the proxy instead of CORS; why the UI shows no safety note or description; why the Ready screen has no start button; why fallback is not announced as a failure; what the response guard does and does not check.

## Checkpoint 6 - phone-down experience

| Item | Entry |
|---|---|
| AI assistance | Claude (Anthropic) audited the CP5 ZIP, designed and wrote the Start action, state additions, clock and timer, active/complete screens, tests, the browser QA script and docs; ran typecheck, tests, builds and headless Chromium |
| What it suggested | Remaining time derived from `startedAt + duration` with an injectable clock; the plan's own step lengths as the schedule; the intro as a derived display phase (no extra state); exit that keeps the timer running (no pause state); `role=timer` with a minute-level hidden summary instead of announcing seconds; ephemeral walks; no Wake Lock, notifications, voice or frontend Sentry |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | `frontend`: typecheck, 112 tests, production build; backend regression: typecheck, 381 tests, build; headless Chromium (Playwright for Python) against the production build and the real compiled backend, 47 checks, fake clock for most timing plus one unfaked real-time check. **No real device, other browser, screen reader or live service.** |

### Things the assistant got wrong or had to correct during the build
- Passed milliseconds to a seconds-based Playwright clock API, which hung the browser run until isolated.
- Took screenshots under a paused fake clock (hang), then misread a mid-fade screenshot as low contrast until it measured the computed colour.
- Two test assertions were wrong rather than the app (apostrophe; focus-trap counting `<body>`).
- Repeated the `pkill -f` self-kill and a background-server shell hang from earlier checkpoints.
- Be able to explain before submission: why time is derived rather than counted; why `Date.now()`; why exit does not pause; why a refresh ends the walk; why there is no wake lock or notification; what the fake-clock browser tests do and do not prove.


## Checkpoint 7 - Sentry performance and observability

| Item | Entry |
|---|---|
| AI assistance | Claude (Anthropic) audited the CP6 ZIP, extended the existing tracing, wrote the error-category mapping, the latency script, 11 tests and the docs; ran typecheck, tests, builds, audit and the headless-Chromium regression |
| Suggested and implemented | Closed-set `pocketwalk.error_category` over the existing reason enums; model-outcome attributes on `gen_ai.chat` (status, duration, failure reason); request-shape and duration attributes on the agent span; `gen_ai.provider.name`; startup log of the sample rate; `captureUnexpected` to stop sending raw error messages; a synthetic-mode latency harness |
| Suggested and NOT implemented (rejected by the assistant) | Running weather and the model in parallel (prompt depends on context); a geocode cache (no live evidence, adds state); lowering the default sample rate (a deployment decision; documented instead); frontend Sentry or any UI change (out of scope, CP6 decision); recording token counts the provider does not return; any invented before/after numbers |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | 11 new offline tests with the real Sentry SDK and a recording transport (success, model failure, timeout, invalid output, business rejection, context failure, both failing, no-location, closed category mapping, two privacy tests); backend typecheck, 392 tests, build, audit; frontend typecheck, 112 tests, build, audit; `cp6_flow.py` 48 checks against the compiled backend. **No live Gemma, Open-Meteo or Sentry.** |

### Things the assistant got wrong or had to correct during the build
- The first privacy test run failed: a real leak (raw error messages sent by `captureException`) plus two test-side mistakes (empty-string regex, a literal quoted by Sentry's source-context lines). Fixed the leak in code, the test mistakes in the test.
- The leak was in CP6 code the assistant had previously written/accepted; the CP6 privacy test did not cover non-enum errors.
- Be able to explain before submission: why there is no optimisation; why the synthetic table proves nothing about Gemma; why weather cannot run in parallel with the model; what `captureUnexpected` keeps and drops; what is still unscrubbed (the Express error handler's own 500 capture).

## Checkpoint 8 - Reliability and testing

| Item | Entry |
|---|---|
| AI assistance | Claude (Anthropic) audited the CP7 ZIP, found and fixed the privacy and resource-limit issues below, wrote the new tests and browser script, ran every check, and wrote the docs |
| Suggested and implemented | Remove Sentry's raw Express error capture and route unexpected errors through a message-free capture; a global event/span scrubber; drop breadcrumbs; path-only access log; streaming byte caps for provider bodies; a real-process Sentry wire test against a local endpoint; fake-clock timeout tests; same-tick duplicate-submit and stale-response frontend tests; a browser failure/retry script |
| Suggested and NOT implemented (rejected by the assistant) | An in-process rate limiter (wrong for multi-instance; deployment concern); retries (the task forbids arbitrary ones and none are needed); an overall request deadline and server-side abort on client disconnect (bounded already, larger plumbing change, documented); changing CI (already correct); dependency upgrades; loosening any safety rule or validation to pass a test |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | 121 new backend tests, 35 new frontend tests, 22 new browser checks; mutation checks (restore each bug, confirm the tests fail); 3x backend and 2x frontend repeat runs for flakiness; clean-extraction rerun of all checks. **No live Gemma, Open-Meteo, Sentry ingestion or GitHub Actions.** |

### Things the assistant got wrong or had to correct during the build
- Used a Sentry hook (`beforeSendTransaction`) that the SDK ignores for streamed spans; found from the SDK's own warning.
- Broke one existing test's capture hook by adding `beforeSend` to the shared options (fixed the test's ordering, assertions unchanged).
- Three of its own test or script expectations were wrong (utf-7 charset, the crash-mode setup, a Playwright handler signature).
- A first duplicate-submit test did not actually exercise the in-flight guard; mutation testing exposed that and a better test replaced it.
- Be able to explain before submission: why every exception message is now redacted; why there is no rate limit; why the server keeps working for an abandoned request; what the wire test does and does not prove; the one modified test.

## Checkpoint 9 - Production deployment

| Item | Entry |
|---|---|
| AI assistance | Claude (Anthropic) audited the CP8 ZIP, chose the deployment shape, implemented the limits, deadline, cancellation, readiness, shutdown and configuration, wrote the tests, Dockerfile and docs, and ran every check |
| Suggested and implemented | Single service serving the frontend (same origin); in-process fixed-window rate limiter before body parsing with IPv6 /64 keys and a bounded table; a concurrency counter released in a `finally`; a per-request `RequestScope` (deadline, abort on disconnect, remaining-time budgets) with a fallback-at-deadline and a controlled 504; readiness vs liveness; testable graceful shutdown; mandatory `TRUST_PROXY` in production; CSP and security headers; production sample-rate default 0.1; bundle scanner; Dockerfile; CI package and docker jobs; a `busy` error kind in the frontend |
| Suggested and NOT implemented (rejected by the assistant) | Redis or any shared store for limits (the task forbids it and one process does not need it); a request queue; an `express-rate-limit` or `helmet` dependency (small, testable, no new supply-chain surface); a catch-all SPA route (the app has no client routes, and it would risk returning HTML for API paths); `trust proxy: true`; provider-specific config files (`render.yaml`, `vercel.json`) because no host was chosen for the user; an automatic deploy workflow (no credentials or protections to justify it); retries; probing providers from `/ready`; changing the product UI beyond one error message |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | 98 new backend tests and 4 new frontend tests; 8 mutation checks (each protection broken, tests must fail); 3 parallel suites for load; a simulated Docker build and runtime layout; same-origin browser runs (48 + 22 + 9 checks); clean-extraction rerun of everything. **No live host, no Docker build, no GitHub run, no real Sentry.** |

### Things the assistant got wrong or had to correct during the build
- Wrote deadline tests whose premise was impossible (deadline shorter than the reserve), so the path under test never ran; found because they failed, not because they passed. This also exposed that the schema minimum for the deadline was meaningless.
- Left a stale constant after a refactor, then misread the resulting mass failure as several different problems before finding the one cause.
- Wrote two test races (a burst test that freed capacity too early, a connection-header comparison contaminated by the test client).
- Missed that its own new tests would add CPU contention that exposed a pre-existing timing-sensitive test; found by reproducing under load rather than by re-running until green.
- Left a stale server on port 3000 and almost trusted a browser run against the wrong server.
- Be able to explain before submission: why the limiter runs before body parsing; why `TRUST_PROXY` is mandatory and numeric; why concurrency refusal is 503 and rate refusal is 429; what happens at the deadline and why it is a fallback and not an error; why disconnects release capacity; why `/ready` and `/health` differ; what the simulated Docker check does and does not prove; the modified existing tests and the one config change.

## Checkpoint 10 - Open-source polish

| Item | Entry |
|---|---|
| AI assistance | Claude (Anthropic) audited the CP9 ZIP, rewrote the README, wrote `docs/api.md`, `CONTRIBUTING.md`, `SECURITY.md`, the issue forms and PR template, fetched and applied the Contributor Covenant 2.1 text, wrote the docs checker and its tests, and ran every check |
| Suggested and implemented | README rewrite organised around a newcomer's questions; an explicit verified / externally verified / not verified table; API reference split out of the README; contributor guide with AI-assistance rules; Contributor Covenant 2.1 verbatim; a security policy; issue forms with a redaction checkbox; historical banners on the planning docs; an offline link-and-anchor checker with tests that guard the repository |
| Suggested and NOT implemented (rejected by the assistant) | Filling the LICENSE holder with a guessed name (the owner's decision); inventing a Code of Conduct or security contact (a fake address would receive real reports); status or CI badges (nothing verified to point at); stars, adopters, benchmarks or a deployment URL; deleting the planning docs (kept with a banner instead, since deletion loses history and they are still useful context); a CHANGELOG, Dependabot, CODEOWNERS; `repository`/`homepage`/`author` fields; an issue-chooser `config.yml` (needs a repository URL); changing CI (already covers the docs tests); any product or dependency change |
| What I accepted | _(you fill in)_ |
| What I rejected / changed | _(you fill in)_ |
| Why | _(you fill in)_ |
| How I tested it | 15 new tests (checker behaviour, then the repository's own links and anchors, contributor files, CoC attribution, licence consistency); mutation checks; the full backend, frontend, build, audit and browser suites re-run from a clean extraction. **No GitHub rendering, no GitHub Actions, no external link checking.** |

### Things the assistant got wrong or had to correct during the build
- Took secondary copies of the Code of Conduct from a search at first; replaced them with the official text.
- Wrote an unverified "three-tap" claim into the first README draft; caught it on review against the code.
- Wrote docs tests that passed first time and had to prove they could fail.
- Be able to explain before submission: why the licence holder and the contact addresses are left as marked placeholders; why 2.1 and not 3.0; why the planning documents are bannered rather than deleted; why there are no badges; what the checker does and does not check (relative links and anchors only, offline).
