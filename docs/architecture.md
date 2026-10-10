# Architecture

> This document grew one checkpoint at a time. Sections are labelled with the checkpoint that introduced them, and a later section supersedes an earlier one where it says so. For the API contract see `docs/api.md`; for what has and has not been verified see `docs/checkpoints/checkpoint-9-evidence.md` and `checkpoint-10-evidence.md`.

PocketWalk is a deliberately simple monolith: one TypeScript/Express process, no database.

```text
                   ┌──────────────┐
                   │    Client    │
                   └──────┬───────┘
                          │  POST /walks/plan {minutes, energy, location?: {city}}
                          ▼
                   ┌──────────────┐
                   │  Controller  │  Zod validation (city: letters only, 2-80 chars)
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │  WalkService │  one traced agent run; decides model vs fallback
                   └──────┬───────┘
                          ▼
                   ┌──────────────┐
                   │   Context    │  context.build span, never throws
                   │   Builder    │
                   └──────┬───────┘
                      ┌───┴────┐
                      ▼        ▼
             WeatherProvider  Daylight          weather.fetch / daylight.calculate spans
             (Open-Meteo)     (pure function)
                      │        │
                      └───┬────┘
                          ▼
                   OutdoorContext  (enumerated facts + deterministic guidance)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
        GemmaPlanner            FallbackPlanner   (same guidance, deterministic, labelled "fallback")
   prompt -> ModelClient               │
   -> VALIDATION PIPELINE              │
      parse > schema > repair          │
      > business > SAFETY              │
              │                        ▼
              │                 same business + safety rules
              │                 (fail -> fixed emergency plan)
              └───────────┬────────────┘
                          ▼
                    Walk plan + honest meta
```

## Checkpoint 5: the frontend

`frontend/` is a separate npm package. The backend below is unchanged by Checkpoint 5 (no file in `src/` was modified).

```text
                 ┌──────────────────┐
                 │     React UI     │  pages: Home, Configure, Generating, Plan, Ready, ActiveWalk, Complete, Error
                 └────────┬─────────┘
                          │  useWalkFlow (one state machine, one in-flight request)
                          ▼
                 ┌──────────────────┐
                 │  Typed API client│  src/api/walkApi.ts: the only fetch() in the app
                 │  + response guard│  parseWalkResult(): unknown -> WalkResult | ApiError
                 └────────┬─────────┘
                          │  POST /walks/plan  (same origin; dev/preview proxy -> backend)
                          ▼
                 ┌──────────────────┐
                 │  PocketWalk API  │  controller -> WalkService (everything below is Checkpoints 1-4)
                 └────────┬─────────┘
                          ▼
          Context Engine -> Gemma -> parse/schema/repair/business -> Safety -> (fallback) -> Walk plan
```

```text
frontend/src/
  time/       clock.ts (the one Clock)
  api/        walkApi.ts (client), apiError.ts (one error shape), parseWalkResult.ts (runtime guard)
  app/        walkFlow.ts (pure reducer), walkTimer.ts (pure timer maths), copy.ts (all user-facing wording derived from API fields), App.tsx
  hooks/      useWalkFlow.ts (owns the state and the single request), useNow.ts (timestamp tick)
  pages/      Home, Configure, Generating, Plan, Ready, ActiveWalk, Complete, Error
  components/ ChoiceGroup (native radios), StepList, ErrorBoundary
  types/      walk.ts (wire types mirrored from the backend)
  styles/     app.css (tokens + all styles; no CSS framework)
```

**State model.** The UI is exactly one of `HOME | CONFIGURING | GENERATING | PLAN_READY | READY_TO_WALK | WALK_ACTIVE | EXIT_CONFIRMATION | WALK_COMPLETE | ERROR`
(a discriminated union; request, result and error live inside the states that own them). Invalid transitions are ignored by the reducer.
There are no `isLoading/hasError/showPlan` booleans.

**Contract.** Request: `{minutes: 10|20|40, energy: 'easy'|'normal', location?: {city}}`. Response: `{plan: {title, steps[3]{minutes,text}, notice}, meta}`.
Errors: `{error: string}` with HTTP 400/404/500. The UI reads only `plan`, `meta.planner`, `meta.fallbackSource` and `meta.context`
(weather conditions, daylight phase). It deliberately does not model validation or latency fields, so they cannot reach the screen.
There is no description field and no separate safety-note field in the backend `WalkPlan`, so the UI shows none: `notice` is shown as "Something to notice".

**Errors.** Every failure becomes an `ApiError{kind, status?, retryable}` (`network, timeout, invalid_request, not_found, server, client, malformed, aborted`).
The UI shows fixed copy per kind. Server text, URLs, status codes and stack traces are never stored or rendered.

**CORS.** The backend sets no CORS headers, so the browser calls its own origin and Vite (dev and `preview`) forwards `/walks` and `/health`.
`VITE_API_BASE_URL` exists for a deployment behind a reverse proxy or a future CORS change; it defaults to same-origin.

**Security.** Model text is rendered only as React text children (no raw-HTML API anywhere in `src/`; a test feeds hostile HTML through the UI).
No secrets in the bundle (greps in the evidence file). Location is one optional typed city; no GPS, no storage, no tracking.

## Checkpoint 6: the phone-down experience

The backend is unchanged by Checkpoint 6. All new code is in `frontend/src`.

```text
HOME -> CONFIGURING -> GENERATING -> PLAN_READY -> READY_TO_WALK -> WALK_ACTIVE -> WALK_COMPLETE -> (Done) HOME
                                                        ^               |  ^
                                                        |               v  |
                                                        +-------- EXIT_CONFIRMATION
                                                      (End walk)     (Keep walking / Escape -> WALK_ACTIVE)
```

**Why so little UI.** After Start the app deliberately asks for nothing: no tap-to-continue, no per-step prompts, no reminder to look at the screen.
The walk works if nobody looks at the phone. The timer is orientation only.

**Reducer rules** (`app/walkFlow.ts`). `START_WALK{now}` is valid only in `READY_TO_WALK`, so a double click or repeated key press is dropped (the state is already `WALK_ACTIVE`) and cannot restart or move the walk.
`WALK_ACTIVE` and `EXIT_CONFIRMATION` carry `startedAt` and `durationMs` (requested minutes x 60000); exiting and returning keep the same values, so no time is paused or lost.
`FINISH_WALK` is valid from both and is ignored once complete. `EDIT` and `BACK_TO_PLAN` are ignored during a walk. Exit needs two steps (`REQUEST_EXIT`, then `CONFIRM_EXIT`).

**Timer** (`app/walkTimer.ts`, `hooks/useNow.ts`, `time/clock.ts`). Everything derives from `WalkTiming{startedAt, durationMs}` and a `Clock{now()}` (the system clock is `Date.now()`, which keeps advancing while a phone sleeps; `performance.now()` may not).
`remaining = durationMs - clamp(now - startedAt, 0, durationMs)`: never negative, and a clock that steps backwards cannot show more than the full time.
Display rounds up, so `0:00` only ever means finished (1 ms left reads `0:01`). `useNow` re-reads the clock from a `setTimeout` chain scheduled for the next whole second of remaining time,
and again on `visibilitychange` and `pageshow`. Nothing counts ticks, there is no `setInterval` and no per-frame state; React updates about once per second.

**Steps.** The backend guarantees step minutes sum to the requested minutes, so the plan's own step lengths are the schedule (cumulative boundaries). The last step runs to the end,
so a plan that adds to less never leaves a gap. No timing is invented. The first 4 seconds show "You're ready. Put your phone away." (derived from elapsed time, display only; the timer starts at the press).

**Completion.** The active page calls `onFinished` once when `now >= end` (a ref guards the gap before the state changes; the reducer ignores repeats).
It still fires while the exit question is open. The completion screen shows the requested minutes. Nothing is stored.

**Refresh.** An active walk is ephemeral: refreshing returns to Home. Persisting would need stored timestamps, validation and clock-skew handling for little benefit.

**Accessibility.** `role="status"` announces only "Walk started" and each new step. The timer is `role="timer"` (implicitly not live); the digits are `aria-hidden` and a visually hidden
summary ("About 18 minutes remaining", "Less than a minute remaining") changes at most once a minute. The exit question is an `alertdialog` with `aria-modal`, the background is `inert`,
focus goes to "Keep walking" (the safe choice), Escape keeps walking, and focus returns to "Exit walk". Focus moves to each new screen's heading except between active and exit. The fade-in is disabled under `prefers-reduced-motion`.

**Browser limits.** No Wake Lock, notifications, audio, service worker or PWA. A locked phone may freeze the page; on return the time is recalculated. A walk that ends while the page is frozen shows as complete only when the page is visible again.

**Privacy and security.** No GPS, storage, analytics or new network requests after Start. Model text is still rendered only as React text. No frontend Sentry (unchanged decision; the backend remains the AI observability system).

## Checkpoint 7: observability

**What exists (CP2-CP4) and was kept:** one trace per request: `http.server POST /walks/plan` (auto-instrumented) -> `gen_ai.invoke_agent` -> `gen_ai.execute_tool context.build` (`weather.fetch`, `daylight.calculate`) -> `gen_ai.chat` -> `pocketwalk.validate` (parse, schema, repair, business, safety) -> `pocketwalk.fallback` + `pocketwalk.fallback_validate` when used. No second tracing architecture was added.

**What CP7 added** (all closed-set values, numbers or booleans):
- On `gen_ai.invoke_agent`: `pocketwalk.walk_duration_minutes`, `pocketwalk.energy`, `pocketwalk.duration_ms`, `pocketwalk.model_ms` (model path), `pocketwalk.fallback_ms` (fallback path), `pocketwalk.context.degraded`, and the closed-set `pocketwalk.error_category` (why the model path did not deliver) and `pocketwalk.context.error_category` (why context was degraded). They are separate so a trace shows both causes when both happen.
- On `gen_ai.chat`: `gen_ai.provider.name` (alongside the older `gen_ai.system`), `pocketwalk.model.status` ok|failed, `pocketwalk.duration_ms` (also for failures and timeouts), and on failure `pocketwalk.model.failure_reason` + `pocketwalk.error_category`. Token usage is recorded only when the provider returns it.
- Error categories (`src/observability/errorCategory.ts`, a total mapping from the existing reason enums): `context_timeout`, `context_provider_error`, `context_location_not_found`, `model_not_configured`, `model_timeout`, `model_provider_error`, `model_invalid_output`, `validation_failure`, `safety_rejection`, `unexpected_error`. Together with `pocketwalk.failure_stage` they answer "which stage, what kind of failure, was fallback used, how long did it take".
- Sampling is unchanged (`SENTRY_TRACES_SAMPLE_RATE`, default 1) but now printed at startup, with a warning when it is 1 in production. 1 is right for development and evidence on a tiny workload; it is not a production recommendation.

**Four paths an engineer can tell apart:** normal (`context -> chat ok -> validate ok`); model failure (`chat` status error + `model.failure_reason`, no `validate` span, `fallback` span); invalid output (`chat` ok, `validate` error with the failing stage span, `fallback`); context failure (`weather.fetch` failed, `context.degraded=true`, model/fallback still run).

**Privacy fix found by the CP7 privacy test:** CP6 reported unexpected (non-enum) errors with `Sentry.captureException(err)`, which sends the raw error message; a provider message containing a key or a city would have left the machine. Both call sites now use `captureUnexpected` (`tracing.ts`): error class, a fixed stage label and stack frames only, never the message. That remaining Express-handler path was closed in Checkpoint 8 (see below).

**Performance reasoning (no optimisation shipped).** The prompt is built from the outdoor context (`buildPrompt(context)`), so weather -> model is a true data dependency; running them in parallel would mean prompting without weather, which changes the product. Inside the context, forecast needs the coordinates from geocoding, also sequential by necessity. PocketWalk's own work (validation, orchestration) measured about 4 ms in the synthetic harness, so the remaining time can only be provider network and model time, which could not be measured in this build. See the evidence file.

## Checkpoint 8: reliability

**Request boundary (`POST /walks/plan`).** `express.json({ limit: '10kb' })` parses only `application/json`; a zod schema accepts `minutes` of exactly 10, 20 or 40, `energy` of `easy|normal` (default `normal`) and an optional `location.city` (2-80 letters). Unknown fields are ignored and never echoed (the contract is not strict). Every error is `{ "error": "<fixed text>" }`: 400 for invalid input or a malformed/mistyped body, 413 for a body over 10 kB, 404 for unknown routes, 500 for unexpected exceptions. Stack traces, exception text, provider errors and prompts never reach the client.

**Error handling (`middleware/errorHandler.ts`).** `HttpError` is an expected, client-safe message. Body-parser 4xx become "Bad request". Anything else is a bug: it is reported with `captureUnexpected` (error class, fixed stage label, stack frames; **never the message**) and logged by class name only. Sentry's own Express error handler is deliberately NOT installed, because it captures the raw exception.

**Sentry privacy controls (`observability/sentryConfig.ts`, `scrubEvent.ts`).** Beyond the CP7 `dataCollection` options: `beforeSend` replaces every exception message with `[redacted]` unless it is PocketWalk's own fixed "unexpected error in <stage>" text, reduces request data to method + path, deletes user data and local variables and empties breadcrumbs; `beforeBreadcrumb` drops all breadcrumbs (console and http breadcrumbs can quote raw text and URLs); `beforeSendSpan` (this SDK streams spans, so `beforeSendTransaction` is ignored and warns) removes client/network address, query, fragment, header and user attributes. The HTTP access log prints the path only (no query string, referrer or user agent). A real-process check (`tests/sentryWireCp8.test.ts`) runs `src/server.ts` against a local capture endpoint and inspects every outgoing byte. In that run the SDK itself produced a raw-message error event for the dev route; the scrubber turned it into `[redacted]`, which is why the global scrubber exists in addition to `captureUnexpected`. Not covered: ingestion by a real Sentry project.

**Timeouts and cancellation.** Weather: `WEATHER_TIMEOUT_MS` (default 3 s, max 15 s). Model: `GEMMA_TIMEOUT_MS` (default 15 s, max 120 s). Each budget aborts the provider's `AbortSignal`, and when it expires the outcome is always a `timeout` whatever the provider rejects with. A provider that answers or rejects after its timeout cannot change an already-built response and cannot cause an unhandled rejection (tested with a fake clock). There are no retries anywhere (one model call per request, tested). (Superseded in Checkpoint 9: there is now an overall deadline and the server cancels work when the client disconnects; see "Checkpoint 9".)

**Fallback flow.** model path (parse -> schema -> repair -> business -> safety) -> on any failure the deterministic `FallbackPlanner` -> its plan is validated by the same business and safety rules -> if it fails, the fixed `emergencyPlan` is served and labelled `fallbackSource: "emergency"` (and reported to Sentry by codes only). If the fallback planner itself throws, the request is a controlled 500: no success is fabricated. Weather failure never discards the model: it degrades the context (`weather: unavailable`, with a closed-set reason) and no weather is invented.

**Resource limits.** Request body 10 kB. Model output text 4000 characters after parsing (`MAX_RAW_CHARS`); model provider response body 1 MiB and weather response body 128 KiB, read with a streaming byte cap (`utils/boundedBody.ts`; declared Content-Length is checked first, then bytes are counted, and the stream is cancelled at the cap). JSON parsing of model text is depth-safe (a 20,000-level nest is rejected, tested). (Superseded in Checkpoint 9: an in-process rate limit and a concurrency cap now exist; see "Checkpoint 9".)

**Frontend recovery.** One API client (`api/walkApi.ts`) maps every failure to a closed `ApiError` kind with fixed, non-technical copy (server text is never kept). `useWalkFlow` owns a single in-flight request: a ref guard rejects a second submit in the same tick, a run id discards answers (success or failure) from an abandoned request, cancel and unmount abort the request. Failed requests show the error screen, never a plan; Try again repeats the same request; a rejected request (400) offers only "Change walk". An `ErrorBoundary` shows fixed copy instead of a blank page. The CP6 timer is unchanged (derived from timestamps, no network after the walk starts, completes once, refresh returns Home).

## Checkpoint 9: deployment

**Topology.** Browser -> one Node process -> { Gemma (Google Gemini API or Ollama), Open-Meteo, Sentry }. The same process serves the built frontend (`frontend/dist`, via `express.static`) and the API, so the browser sees one origin: no CORS, no proxy rules, and the frontend's relative `/walks/plan` just works. There is no SPA catch-all (the app has no client routes): only real files are served, so `/walks/plan` with the wrong method, an unknown API path or `/anything` is a JSON `404`, never the HTML page. In development the frontend is still served by Vite, which proxies `/walks` and `/health` to the backend; that proxy is not in the production build (the bundle scan checks it carries no dev host). A host in front (Render, Fly.io, Railway, Cloud Run, a CDN) terminates TLS and forwards to the process; HTTPS is the host's job.

**Trust boundaries.** The internet is untrusted: every request body is size-capped (10 kB), parsed as JSON only with `application/json`, and validated. The reverse proxy is trusted only as far as `TRUST_PROXY` says: the process calls `app.set('trust proxy', <hops>)` with a number, never `true`, so only the rightmost N `X-Forwarded-For` entries (those appended by your own proxies) are believed; anything a client writes to the left is ignored. `TRUST_PROXY` is mandatory in production because both wrong answers are harmful (see README). Model and weather providers are untrusted too: their output is validated and size-capped (CP8), and they get a timeout and the request's abort signal. Secrets live only in environment variables and are never logged; startup notes print provider names and numbers, never keys or the DSN.

**Request pipeline (order matters).** security headers (CSP, nosniff, no-referrer, frame-ancestors none, permissions-policy) -> drain marker (`Connection: close` once shutting down) -> **rate limiter on `POST /walks/plan`** (before body parsing, so malformed requests count) -> JSON parser -> `/health`, `/ready` -> `POST /walks/plan` -> static frontend -> JSON 404 -> error handler. Health, readiness and static files are never rate limited.

**Rate limiting (`middleware/rateLimiter.ts`).** Fixed window per client key, in memory, clock injectable. The key is the client address Express derives from `TRUST_PROXY`, with IPv4-mapped IPv6 unwrapped and IPv6 reduced to its /64 (so rotating the low bits does not escape the limit). The table is bounded (10,000 clients); when full of live clients, new clients are limited rather than evicting others (fail closed). 429 with `Retry-After` and `{ "error": "Too many requests. Please try again in a moment." }`. Per process: restarts reset it, instances do not share it, a client at a window boundary can briefly get up to 2x the limit. On a multi-instance host the real control should be the provider's/edge's.

**Concurrency control (`middleware/concurrencyGate.ts`).** A counter, not a queue: a slot is taken after the request body validates and returned in a `finally` on every path (success, fallback, unexpected error, timeout, deadline, client disconnect); `release` is idempotent, so no path can free a slot twice or leak one. At the cap the answer is an immediate `503` with `Retry-After`. The cap is per process (fleet total = cap x instances).

**Deadline and cancellation (`services/requestScope.ts`, `controllers/walkController.ts`, `services/walkService.ts`).** Every plan request gets a `RequestScope`: a deadline (`REQUEST_DEADLINE_MS`, default 25 s) and an abort signal that fires on the deadline or when the client's connection closes before the response finished. Budgets are carved from what is left: weather may use at most `remaining - 1.5 s reserve - 2 s model minimum` (and never more than `WEATHER_TIMEOUT_MS`); the model may use at most `remaining - 1.5 s reserve` (and never more than `GEMMA_TIMEOUT_MS`); if less than 2 s would remain for the model, it is not called and the fallback is served at once. Defaults: weather 3 s + model 15 s fit the 23.5 s that precede the reserve; the browser waits 30 s, 5 s longer than the deadline, so the server always answers first. If the deadline passes anyway (a provider that ignores its timeout), the controller races the work against the deadline and serves `planFallbackNow`: the deterministic fallback built from what is known (no provider calls), validated by the same business and safety rules (and the emergency plan if that fails), labelled `fallbackReason: "timeout"`. If even that throws, the answer is a controlled `504`, never an invented plan. A late result from abandoned work is ignored (the response is written once, behind a `headersSent`/`destroyed` guard) and its late failure cannot be an unhandled rejection. Client disconnect: the signal aborts the weather fetch and the model request (real `AbortSignal` on `fetch`), no new stage starts (`throwIfAbandoned`), nothing is written to the closed socket, and the slot is released. The reserve and the model minimum are injectable (`budgets`) so tests do not wait seconds. A provider that cannot be cancelled would keep running to its own timeout; both shipped providers are `fetch`-based and are cancelled.

**Health and readiness (`routes/healthRoutes.ts`, `lifecycle/readiness.ts`).** `/health` is liveness: 200 with `{status, service, uptimeSeconds}` for as long as the process runs, including while draining, and it never touches Google, Open-Meteo or Sentry (a provider outage must not make a platform restart a healthy process). `/ready` is readiness: `starting` (503) until the server is listening, `ready` (200), `shutting_down` (503). It makes no outbound call and its body holds fixed words only. Readiness only moves forward.

**Graceful shutdown (`lifecycle/shutdown.ts`).** On SIGTERM/SIGINT, once: readiness goes 503; the server stops accepting connections and drops idle keep-alive ones; responses sent while draining carry `Connection: close`; in-flight requests get `SHUTDOWN_GRACE_MS` (8 s) to finish, after which the remaining connections are closed (the lifecycle sees a disconnect, cancels the provider calls and frees capacity); Sentry is flushed (bounded 2 s); exit 0. A hard stop at grace + 5 s exits 1 if anything wedges. In a container `node` is PID 1 and receives SIGTERM directly.

**Production configuration (`config/env.ts`, `appFromEnv.ts`).** One validated schema; production fails to start (exit 1, message names the variable, never a value) without `TRUST_PROXY`, or with `SERVE_FRONTEND` on and no build. `buildAppFromEnv` is the single place settings become a running app, so the tests exercise what runs. Notes at startup state the limits in force and warn about: no model, no rate limit, and provider timeouts that exceed the deadline (they are then shortened per request). An unusable port prints the error code only and exits 1.

**Production observability.** Unchanged CP7/CP8 tracing and privacy (message-free error capture, event and span scrubbers, path-only access log, DSN never logged). New: the default trace sample rate is 0.1 in production (1 in development); set `SENTRY_TRACES_SAMPLE_RATE` to change it. Deadline-served requests are visible as `pocketwalk.deadline_exceeded` and skipped model calls as `pocketwalk.deadline_skipped_model`. Sentry being unconfigured, unreachable or throwing cannot affect a request (tested). Real Sentry ingestion remains unverified.

**Security headers and the CSP.** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`. `'unsafe-inline'` is for React inline style attributes; the page has one same-origin module script, one stylesheet and a `data:` favicon, no inline script and no external fonts or hosts (the real build was checked, and the browser runs logged no CSP violations). TLS and HSTS belong to the host.

## Backend source tree (Checkpoints 1-4)

```text
src/
  routes/ controllers/      HTTP only
  services/walkService.ts   one run; model vs fallback; meta
  context/
    types.ts                OutdoorContext and every enum (PocketWalk vocabulary, no provider terms)
    contextBuilder.ts       request -> OutdoorContext; timeout; failure containment; spans
    weatherProvider.ts      WeatherProvider interface + WeatherError
    openMeteoProvider.ts    the ONLY file that knows Open-Meteo URLs/fields; Zod-validates responses
    daylight.ts             local wall clock, time of day, day/night/near-sunrise/near-sunset
    normalize.ts            provider observation -> bands; deterministic guidance rules
    createWeatherProvider.ts
  ai/
    gemmaPlanner.ts         model call + runs the validation pipeline
    modelClient.ts, googleGemmaClient.ts, ollamaGemmaClient.ts   transports (unchanged)
    prompt.ts               fixed rules + guidance sentences + one JSON facts block
    planSchema.ts           WalkPlan schema (shape + hard size bounds)          [CP4]
    planRepair.ts           harmless normalisation only                         [CP4]
    businessRules.ts        PocketWalk rules: duration, step sizes, wording      [CP4]
    planValidation.ts       JSON extraction + synchronous composition of all layers
    validationPipeline.ts   the traced pipeline; validateDomainPlan for fallbacks [CP4]
    validationReport.ts     stage statuses / repair codes (no text, no values)  [CP4]
    emergencyPlan.ts        fixed by-the-door plan                              [CP4]
    fallbackPlanner.ts      deterministic, guidance-aware, labelled "fallback"
    errors.ts               PlannerError + closed reason set + failureStage()
  safety/                   [CP4] provider-independent: knows WalkPlan, OutdoorContext, request. Nothing else.
    engine.ts               SafetyEngine.validate(plan, context, request)
    rules.ts                lexicon / proximity / whole-plan rules, context-dependent via `when`
    text.ts                 normalisation (accents, zero-width, spacing, simple leetspeak), avoidance cues
    types.ts
  observability/            Sentry setup, span helpers, shared privacy options
```

## Facts vs. AI

| Deterministic (the application computes it) | Left to Gemma |
|---|---|
| local time and time of day, daylight phase, whether the walk ends after sunset | wording of title, steps, notice |
| weather condition, temperature band, precipitation, wind band | which gentle activity to suggest |
| guidance codes (`poor_conditions`, `dark`, `low_visibility`, `wet`, `hot`, `cold`, `windy`) | sequencing within the 3 steps |
| step minutes must add up (validator) | |

Gemma is never asked to work out the time, the weather category, or whether it is dark. It is told, as enumerated
JSON plus one fixed sentence per guidance code.

## The context step by step

1. Controller validates `location.city` (letters, spaces, `. , ' -`; 2-80 chars). Coordinates in the body are ignored.
2. `ContextBuilder.build` (inside the `context.build` tool span):
   - no `location` -> `weather`/`daylight` = `not_requested`; context equals the Checkpoint 2 context;
   - no provider configured -> `weatherFailure = not_configured`;
   - otherwise one `weather.fetch` span around `provider.lookup(city, {signal})`, under one abortable budget
     (`WEATHER_TIMEOUT_MS`). Expiry always yields `timeout`. Any non-`WeatherError` is contained as `unknown` and
     captured to Sentry; the walk is still served.
3. `OpenMeteoProvider` does geocode (city -> coordinates) then forecast (rounded coordinates -> current weather +
   today's sunrise/sunset, `timezone=auto`). Responses are Zod-validated with sanity bounds; unknown WMO codes are `malformed`.
4. `normalizeWeather` keeps five fields. `daylight.calculate` span: local wall-clock time in the place's time zone
   (from the provider) vs sunrise/sunset -> phase. No astronomy library.
5. `deriveGuidance` (pure) turns facts into guidance codes.
6. Gemma path: `buildPrompt` = fixed rules + guidance sentences + one JSON facts block. Fallback path: the same
   guidance picks a safe deterministic walk. Validation is unchanged from Checkpoint 2.

## The CP4 principle

> **AI proposes. The application validates. The application can reject. The fallback is a deterministic alternative.**

PocketWalk uses AI to generate the walk, but deterministic application-level validation and safety rules remain
authoritative. A model can return perfectly valid JSON that is still wrong for this person, this weather and this light.
Valid JSON is only the first gate.

```text
Gemma (proposes)
  -> unknown text
  -> PARSE            JSON out of text (fence/sentence tolerated); size-capped first
  -> SCHEMA           right shape, types, hard bounds                 -> schema_invalid
  -> REPAIR           harmless normalisation only (recorded)
  -> BUSINESS RULES   do the minutes add up, is the wording short     -> business_rule
  -> SAFETY RULES     deterministic, context-aware                    -> safety_violation
  -> safe WalkPlan
any rejection -> FallbackPlanner -> same business + safety rules -> (fail) emergency plan
```

Each layer is its own module and its own span. They answer different questions, so a trace says exactly where a plan died.

## WalkPlan schema

The Checkpoint 3 shape is kept (no client or test break); CP4 makes it strict.

| Field | Rule |
|---|---|
| `title` | string, trimmed, 1 to 40 chars |
| `steps` | exactly 3 objects |
| `steps[].minutes` | integer, 1 to 40 |
| `steps[].text` | string, trimmed, 1 to 200 chars (business rule: at most 14 words) |
| `notice` | string, trimmed, 1 to 200 chars (business rule: at most 14 words) |
| `intensity` | optional, `easy` or `normal`. The model is not asked for it. If a model volunteers one it must be valid and may not exceed the requested energy. It is dropped from the output: the application owns intensity (the request's `energy`). |

Unknown keys are **stripped** (not rejected) and reported as the repair `unknown_keys_dropped`. They never reach the client.
Raw model text over 4000 characters is refused before parsing. Schema errors record paths only, never values.

## Business rules (`businessRules.ts`)

Pure, model-independent, and **all** broken rules are reported, not just the first.

| Code | Meaning |
|---|---|
| `duration_exceeds_request` / `duration_below_request` | step minutes must add up to exactly the requested minutes |
| `step_exceeds_request` | no step longer than the whole walk |
| `step_too_short` | no step under 10% of the walk (at least 1 minute) |
| `word_limit_exceeded` | steps and notice at most 14 words |
| `empty_text` | nothing left after normalisation |
| `unexpected_characters` | only Latin / common-script characters. Also closes the look-alike-letter hole (a Cyrillic "o" would slip past the English safety lexicon) |
| `markup_or_link` | no HTML-like markup, no URLs or domains (a link means a screen) |
| `output_too_large` | total plan text at most 600 characters |
| `intensity_exceeds_request` | a volunteered `normal` for an `easy` request |

Equality (not "at most") on duration is deliberate: Checkpoint 2/3 required it, and a 5-minute plan for a 20-minute
request is also a wrong answer.

## Safety engine (`src/safety`)

```text
SafetyEngine.validate(plan, outdoorContext, request) -> { ok: true } | { ok: false, violations[] }
```

Pure and deterministic. It does not know Gemma, Google, Ollama, Sentry or HTTP (a test checks its imports). It only
**rejects**; it never rewrites a plan to make it safe. A violation is `{rule, category, field}`: never plan text.

Three kinds of rule, so this is not one big blacklist:

- **Lexicon rules** match normalised tokens, stems and phrases. `excusable` hazards may be *mentioned* when clearly avoided
  (`stay away from the road`: an avoidance cue within three tokens *before* the word, itself not negated). Climbing, trespass
  breaches, "without looking", health/safety claims and instruction artefacts are **never** excusable.
- **Proximity rules**: an unsafe verb near an animal noun (`feed the dog`).
- **Whole-plan rules**: in poor conditions the plan as a whole must stay by shelter.

| Category | Examples rejected |
|---|---|
| traffic | roads, highways, streets, cars, junctions, crossings (mention-only is excusable when avoided) |
| restricted_area | restricted/private/abandoned places, construction, railway, ducking under barriers, ignoring signs |
| climbing | climb, scramble, jump over, balance on rails, walking on walls (never excusable) |
| animals | approach/feed/pet/chase animals; dogs, strays, cattle, snakes, wildlife, bees |
| water, ingestion, fire, strangers | rivers, swimming; eating/drinking/foraging; fire; strangers |
| device_use | phone, screen, map, app, photo, headphones... Phrases like "put your phone away" are allowed |
| unsafe_behaviour | "without looking", eyes closed, blindfolded, walking backwards |
| claims | cure, therapy, medication, "guaranteed", "completely safe" |
| injection_artifact | "ignore previous instructions", "as an AI", "system prompt" in output |
| intensity | sprint, jog, run, workout always; hurry, stairs, steep, brisk additionally for `easy` |

**Context rules** read the Checkpoint 3 `guidance` codes (no new thresholds are invented here; those codes come from
`normalize.ts`, whose bands are product choices, not medical thresholds):

| Guidance | Rule |
|---|---|
| `poor_conditions` | plan must mention shelter (door, cover, porch, inside...); no trees, parks, trails, hills, open ground, going far |
| `wet` | no sitting, lying, lawns, benches, picnics |
| `windy` | no trees, branches, exposed hilltops, open ground |
| `hot` | no sunning, no steep effort |
| `cold` | no sitting, lingering, waiting, resting |
| `dark` | nothing that needs light (looking, watching, colours, views, sunsets), no sitting, no remote terrain |
| `low_visibility` | no remote terrain (parks, trails, woods...); fog also bans far views |

The same plan can be fine at noon and rejected in a storm or after dark. If weather or daylight is unknown, the context
adds **no** restrictions (nothing is assumed), but the always-on rules still apply.

**Obfuscation handling** (`text.ts`): accents, full-width letters, zero-width/bidi characters, odd spacing, simple digit-for-
letter swaps (`cl1mb`), letters spaced apart (`c l i m b`). This raises the bar. It is not a defence against a determined
adversary (see limitations).

## Repair vs rejection

| | Examples | Outcome |
|---|---|---|
| **Repairable** (harmless presentation) | zero-width/control characters, markdown emphasis/bullets/backticks, runs of whitespace, unknown keys | normalised, **recorded** in `meta.validation.repairs`, plan still labelled `model` |
| **Rejected** | wrong total duration, wrong number of steps, over-long wording, empty text, markup/links, any safety violation, unparseable output, too large | whole plan rejected, deterministic fallback |

Repair never changes meaning, never touches minutes, never truncates, never invents words. Re-splitting minutes or cutting
a sentence would be guessing, so those are rejections. (Extra steps and over-long wording were considered for repair and
deliberately kept as rejections; Checkpoint 3's tests also require it.)

## Fallback, emergency plan, and honesty

```text
model plan rejected / model failed / no model
  -> FallbackPlanner (deterministic, guidance-aware)
  -> business + safety rules (the SAME ones)
       pass -> served, fallbackSource: "deterministic"
       fail -> emergencyPlan(minutes), fallbackSource: "emergency", reported to Sentry as an error (codes only)
```

`emergencyPlan` is a fixed "stay by your door and listen" plan. A test proves the deterministic fallback **and** the
emergency plan pass every rule for all 128 guidance combinations x 3 durations x 2 energies (1,536 checks), so the emergency
path should never run; it exists so that a future edit to the fallback text cannot silently ship an unsafe plan.
If the fallback *planner itself throws* (a bug), the response is still a controlled 500 as in Checkpoint 3.

Response fields (`meta`):

| Field | Meaning |
|---|---|
| `planner` | `model` only if Gemma's plan passed **every** layer; otherwise `fallback`. Fallback is never labelled AI. |
| `provider`, `model` | present only for `model` |
| `fallbackReason` | closed set: `not_configured`, `timeout`, `unavailable`, `rate_limited`, `misconfigured`, `empty_response`, `invalid_json`, `schema_invalid`, `business_rule`, `safety_violation`, `unknown` |
| `fallbackSource` | `deterministic` or `emergency` (fallback only) |
| `message` | one fixed sentence per outcome class. Never provider text, rule ids or plan text |
| `validation` | `{parse, schema, business, safety: passed\|failed\|not_run, repaired, repairs[]}`. `not_run` = that stage never saw the output |
| `validationLatencyMs`, `safetyLatencyMs`, `fallbackLatencyMs` | real measurements, present only if that step actually ran |

If the model's plan was normalised, `planner` is still `model` and `validation.repaired` is `true`: the modification is explicit.

### Error categories

PocketWalk already had a closed `PlannerFailureReason` set; CP4 adds `safety_violation` and maps reasons to categories
(`failureStage()`) rather than adding classes for decoration:

| Category | Reason(s) |
|---|---|
| ModelParseError | `invalid_json` |
| SchemaValidationError | `schema_invalid` |
| BusinessValidationError | `business_rule` |
| SafetyViolationError | `safety_violation` |
| ProviderError | `unavailable`, `rate_limited`, `misconfigured`, `empty_response` |
| TimeoutError | `timeout` |

`PlannerError` optionally carries a `ValidationReport` (stage statuses, rule codes, timings) for traces. It never reaches a client.

## Prompt injection

- The only free text a client can send is `location.city`. It is validated (letters/spaces/few punctuation, 2 to 80), used for
  one weather lookup, and **never placed in the prompt**. The prompt contains fixed rules, fixed guidance sentences and an
  enumerated JSON facts block. Unknown request keys are ignored. So user text has no path to the model.
- The prompt separates the rules from the data and says everything after `Context:` is data, never an instruction.
- Defence in depth for the case where the *model* is manipulated anyway: output that echoes instruction-override language is
  rejected (`instruction_artifact`), hazard instructions are rejected by category, and the plan must still pass every layer.
  The prompt is guidance; the code decides.

## Failure matrix (all covered by tests)

| Gemma | Weather | Result |
|---|---|---|
| ok | ok | `planner: model`, full context |
| ok | failed | `planner: model`, partial context (`unavailable: ["weather","daylight"]` told to the model) |
| failed | ok | `planner: fallback`, context-aware deterministic walk |
| failed | failed | `planner: fallback`, generic deterministic walk |
| ok, output malformed / invalid / too large | any | `planner: fallback`, reason `invalid_json` / `schema_invalid` / `business_rule` |
| ok, output unsafe for this context | any | `planner: fallback`, reason `safety_violation`, context-aware fallback |
| ok, output only needs normalising | any | `planner: model`, `validation.repaired: true` |
| any, and the fallback itself fails the rules | any | `planner: fallback`, `fallbackSource: emergency` |

`meta.planner` is never `model` unless Gemma produced a plan that passed schema, business and safety validation.

## Daylight approach

`near_sunrise` = 30 min before to 45 min after sunrise. `near_sunset` = 60 min before to 30 min after sunset.
`night` = outside those, before sunrise-30 or after sunset+30. These windows are rough product choices, not measured
twilight. Sunrise/sunset come from the same forecast response (no extra call). If they are missing, not for today's
local date, or malformed, daylight is `unavailable` rather than guessed. Time of day uses fixed hour ranges
(05-11 morning, 12-16 afternoon, 17-20 evening, otherwise night).

## Location privacy

- Smallest useful representation: a city name typed or chosen by the user, per request. No GPS, no tracking, no storage.
- The city goes only to Open-Meteo's geocoder. Coordinates come from the geocoder, are rounded to 2 decimals before the
  forecast request, never leave `OpenMeteoProvider`, and are not returned.
- Gemma receives enumerated facts only (no city, no coordinates, no time zone). The API response's `meta.context`
  likewise contains no location.
- Sentry: spans carry enumerated attributes only. `dataCollection.urlQueryParams` is off, and automatic outgoing-request
  spans/breadcrumbs for the weather hosts are suppressed (`src/observability/sentryConfig.ts`).
- Open-Meteo's free API is **non-commercial only**; self-hosting or a paid plan is required for commercial use.

## Trace shape

```text
http.server  POST /walks/plan
  Router / handler                       (auto-instrumented Express spans)
    gen_ai.invoke_agent "invoke_agent PocketWalk"
        pocketwalk.fallback / .fallback_reason / .failure_stage / .failure_codes / .fallback_source
        pocketwalk.validation.{parse,schema,business,safety} / .plan_repaired / .repair_codes / .validation_ms
      gen_ai.execute_tool "execute_tool context.build"
        pocketwalk.weather  "weather.fetch"          provider, status ok|failed, failure_reason
        pocketwalk.daylight "daylight.calculate"     status, phase, time_of_day
      gen_ai.chat          "chat <model>"            model, settings, token usage
      pocketwalk.validate  "validate plan"           ends in ERROR status when the model's output is rejected
        pocketwalk.parse    "parse model output"     stage.result, json_extracted
        pocketwalk.schema   "schema validation"      stage.result, failed_paths
        pocketwalk.repair   "normalise plan"         repair.applied, repair.codes
        pocketwalk.business "business validation"    stage.result, failure_code
        pocketwalk.safety   "safety validation"      stage.result, violation_rules, violation_categories
      pocketwalk.fallback  "fallback plan"           only when the fallback was used
      pocketwalk.fallback_validate "validate fallback plan"   only when the fallback was used
```

A stage that rejects output ends **normally** with `pocketwalk.stage.result=failed` (a handled outcome, not a crash); only the
parent `pocketwalk.validate` span ends in error. A stage that never ran has no span (no meaningless spans). Attributes are
closed-set ids, statuses, numbers and booleans. **Never** plan text, model output, the prompt, the city, or coordinates.
A trace answers: did the model answer, did parsing / schema / business / safety pass, was fallback used, and why.

Verified locally with the real Sentry SDK and a recording transport (span tree, parenting, attributes, privacy of everything that
would be sent). CP7 attributes and error categories: see "Checkpoint 7: observability" above. Delivery to a real Sentry project and display in Explore -> Agents: not verified.

## Security notes
- No new runtime dependency. No weather credential exists, so none can leak. Gemma key handling unchanged.
- Model output is untrusted at every layer: size-capped, parsed defensively (pathological JSON, `__proto__`, lone surrogates and
  deep nesting are tested), schema-checked, normalised, rule-checked. Malformed output cannot crash the server (tested).
- Every outbound call has a timeout; every failure is mapped to a closed enum; provider bodies/messages are never copied.
- Clients see a fixed sentence (`meta.message`), never Zod text, rule ids, paths or model text (tested).
- Request body limit 10 kb (413); city validated; unknown keys ignored.
- **Honest scope:** this is basic application-level safety filtering. It is not a safety certification, not medical advice, not
  navigation, and it cannot know the person's real surroundings. It does not replace their judgment or local knowledge.

## Not built yet (on purpose)
Measured latency budget and fallback-rate measurement with real Gemma
(CP7), weather caching and optimisation, rate limiting, deployment.
