# PocketWalk

**One tap picks a walk length. Gemma plans a short outdoor walk. The application validates it. Then the phone goes down.**

PocketWalk is a small, mobile-first web app and Node API. You choose 10, 20 or 40 minutes (and optionally easy or normal energy and a city), get a short three-step walk, press "Start walking", and the screen goes quiet so you can put the phone away. Built for DEV's Hacktoberfest 2026 "Touch Grass" challenge.

## Why it exists
People open their phone "to decide what to do" and lose ten minutes. PocketWalk tries to make the screen the shortest part of the experience, and treats its own AI latency as screen time: the AI request is traced with Sentry so that latency, failures and fallbacks can be seen and measured. The walk is written by **Gemma** (open weights), hosted on the Gemini API or run locally with Ollama, so model and provider can be swapped.

**Who it is for:** anyone who wants a quick prompt to step outside, and developers who want a compact, well-tested example of an AI feature that treats model output as untrusted: validated, safety-filtered, with a labelled deterministic fallback, and observable without recording private data.

## Features
- **A short flow, no typing required:** choose a duration and energy, optionally add a city. Then a plan, a "Ready?" screen, and a phone-down walk with a timestamp-based timer, steps that advance on their own, and "Walk complete."
- **Gemma-written walks that are never trusted blindly:** every answer passes parse, schema, harmless repair, business rules and deterministic safety rules. Any failure serves a validated fallback walk, and the response says which one you got.
- **Outdoor context:** with a city, PocketWalk looks up current weather and today's sunrise and sunset, and gives the model only normalised facts (for example `rain`, `cool`, `near_sunset`). No GPS.
- **Works with no credentials:** with no model configured every walk is the deterministic fallback, so the whole app runs and tests without any API key.
- **Observable and private:** the backend traces each request (context, model call, each validation stage, fallback) in Sentry; prompts, model output, plan text, API keys and the city are never recorded.
- **Bounded:** request deadline, per-client rate limit, concurrency cap, provider timeouts that are cancelled, graceful shutdown.
- **Nothing is stored:** no accounts, database, history, location, notifications or analytics.

## How it works
```text
Browser (React)  ──POST /walks/plan──▶  Express API  ──▶  Context builder ──▶ Open-Meteo (weather)  + daylight (computed)
   one origin                            validates         normalised facts only
                                         the request   ──▶  Gemma (Gemini API or Ollama)
                                                       ──▶  Validation: parse → schema → repair → business → safety
                                                       ──▶  Fallback walk if anything fails (held to the same rules)
                                         Sentry traces the run (backend only)
```
1. **Request:** `{ minutes: 10|20|40, energy?, location?: { city } }`, validated and size-limited.
2. **Context:** weather and daylight become a small set of enumerated facts plus a few deterministic guidance rules. If weather is unavailable the walk is still planned.
3. **Model:** Gemma gets a short prompt built from those facts and must reply with JSON (title, three steps with minutes, a notice). It has a timeout and is cancelled if the request ends.
4. **Validation:** the reply is treated as untrusted. Safety rules cover traffic, restricted places, climbing, animals, water, screens, health claims and effort, plus weather- and light-aware rules.
5. **Fallback:** on any failure (no model, timeout, provider error, malformed or unsafe output) a deterministic walk is returned, validated by the same rules; if even that fails a fixed emergency plan is used, and if nothing safe can be built the API returns an error rather than an invented plan.
6. **Response:** the plan plus `meta` saying `planner: "model"` or `"fallback"`, why, and timings. See [`docs/api.md`](docs/api.md).

*AI proposes. The application validates. The application can reject.* This is application-level filtering, **not a safety guarantee**: it is a conservative, English-only, rule-based filter that will reject some harmless plans and cannot understand meaning or know your real surroundings. It is not medical advice or navigation.

## Technology
Backend: Node.js 22, TypeScript, Express 5, Zod, `@sentry/node`, Vitest, Supertest. Frontend: React 19, TypeScript, Vite, Vitest, Testing Library. Providers: Google Gemini API or Ollama (Gemma), Open-Meteo (weather, free tier is non-commercial). Optional: Docker.

## Run it locally
Prerequisites: Node.js 20 or newer (CI and Docker use 22) and npm. No API key is needed.

```bash
git clone <your fork or this repository> pocketwalk && cd pocketwalk
npm ci && npm run frontend:install
cp .env.example .env            # defaults are safe: no model, Open-Meteo for weather
npm run dev                     # API on http://localhost:3000        (terminal 1)
npm run frontend:dev            # app on http://localhost:5173        (terminal 2, proxies /walks to the API)
curl -X POST localhost:3000/walks/plan -H 'content-type: application/json' -d '{"minutes":20,"energy":"easy"}'
```

### Choose a model provider (in `.env`)
| Goal | Settings |
|---|---|
| No model (default) | `GEMMA_PROVIDER=none`: every response is `planner: "fallback"` |
| Hosted Gemma | `GEMMA_PROVIDER=google` and `GEMINI_API_KEY=<your key from Google AI Studio>` |
| Local Gemma | `GEMMA_PROVIDER=ollama` and `GEMMA_MODEL=<your local Ollama model tag>` |

Check a real provider with your own credentials: `npm run smoke:gemma`, `npm run smoke:weather -- <city>`. Offline walk-throughs of failure and safety cases: `npm run scenarios`, `npm run scenarios:safety`.
Set `SENTRY_DSN` to your own Sentry project to send traces; leave it empty and nothing is sent.

### Configuration
Everything is an environment variable, validated at start-up (`src/config/env.ts`). The annotated list is [`.env.example`](.env.example); the frontend has its own [`frontend/.env.example`](frontend/.env.example) (public values only, never secrets).

| Variable | Meaning (default) |
|---|---|
| `GEMMA_PROVIDER`, `GEMINI_API_KEY`, `GEMMA_MODEL`, `OLLAMA_BASE_URL` | Model provider settings (above) |
| `GEMMA_TIMEOUT_MS`, `WEATHER_PROVIDER`, `WEATHER_TIMEOUT_MS` | Provider budgets (15000, `open-meteo`, 3000) |
| `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE` | Tracing (off; 1 in development, 0.1 in production) |
| `REQUEST_DEADLINE_MS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`, `MAX_CONCURRENT_PLANS` | Limits (25000, 20 per 60000, 8) |
| `TRUST_PROXY` | **Required in production:** number of reverse proxies in front of the server |

## Development commands
| Command | What it does |
|---|---|
| `npm run dev` / `npm run frontend:dev` | API / app with reload |
| `npm run typecheck` / `npm run frontend:typecheck` | TypeScript, no emit |
| `npm test` / `npm run frontend:test` | Backend / frontend test suites |
| `npm run build:all` | Compile the backend (`dist/`) and build the frontend (`frontend/dist/`) |
| `npm run check:bundle` | Scan the browser bundle for secrets and hard-coded dev hosts |
| `npm run check:docs` | Check that Markdown links and anchors resolve |
| `npm audit` and `cd frontend && npm audit` | Dependency advisories |

### Testing
`npm test` and `npm run frontend:test` need **no network, no credentials and no paid AI calls**: models and weather are injected fakes, Sentry tests use a recording transport or a local capture endpoint, and a few tests start the real server on free local ports. Optional browser checks use Playwright for Python (not a project dependency, not run in CI): `npm run qa:browser`, `npm run qa:browser:failures`, `npm run qa:browser:limits`; see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Production
One Node service serves the API and the built frontend from a single origin (no CORS).
```bash
npm ci --include=dev && npm --prefix frontend ci --include=dev && npm run build:all   # --include=dev: hosts often set NODE_ENV=production while building
NODE_ENV=production TRUST_PROXY=1 npm start                                            # listens on $PORT; /health = liveness, /ready = readiness
docker build -t pocketwalk . && docker run --rm -p 3000:3000 -e TRUST_PROXY=0 pocketwalk
```
Pass `GEMINI_API_KEY` and `SENTRY_DSN` as host secrets, never in the repository. `TRUST_PROXY` must match your host (usually `1` behind one proxy); a wrong value either shares one rate-limit bucket between everyone or lets clients fake their address. Limits, deadlines, health semantics and shutdown are in [`docs/architecture.md`](docs/architecture.md) ("Checkpoint 9").

## What has been verified
| Status | What |
|---|---|
| **Verified locally** (automated and scripted, no live services) | Backend and frontend typechecks, tests and builds; dependency audits; Sentry event privacy (in tests and on the wire to a *local* endpoint); the production build started as a real process; rate limit, concurrency cap, request deadline, client-disconnect cancellation and SIGTERM draining; browser checks in headless Chromium (happy path, failure and retry, rate limit) against the production-shaped server; a simulated Docker build and runtime layout |
| **Verified externally** | **Nothing.** No live deployment, GitHub Actions run, Sentry project or live model has been checked |
| **Not verified** | A live deployment; a real `docker build`; GitHub Actions (including the Docker job); ingestion by a real Sentry project; live Gemma and Open-Meteo calls (adapters are tested against local imitations of their wire formats); behaviour behind a real reverse proxy; multi-instance behaviour; real phones and browsers other than headless Chromium; any latency or performance number |

Per-checkpoint evidence, with the exact counts and commands: [`docs/checkpoints/`](docs/checkpoints/). Test counts at the last checkpoint: backend 626, frontend 151.

## Known limitations
- Context comes from a **city name only** (no GPS). The first geocoder match is used, so an ambiguous name can resolve to the wrong place; add the country (`"Paris, France"`).
- Weather needs internet access to Open-Meteo, whose free tier is non-commercial only.
- The safety layer is rule-based and English-only (see above). How often real Gemma output is rejected has not been measured.
- A normal web page cannot run with the screen locked, hold it awake (no Wake Lock is used) or send a notification. If the phone sleeps, time is recalculated from timestamps when the page is visible again. Refreshing during a walk returns to Home: walks are intentionally not stored.
- The rate limit and concurrency cap are **per process**: restarts reset them and several instances do not share them, so a multi-instance host needs an edge limit.
- Deliberately out of scope: accounts, a database, walk history, GPS or maps, fitness tracking, gamification, social features, voice, notifications.

## Documentation
- [`docs/api.md`](docs/api.md): endpoints, request and response contract, errors
- [`docs/architecture.md`](docs/architecture.md): pipeline, safety rules, tracing and privacy, limits, deployment
- [`docs/development-log.md`](docs/development-log.md): what was built, measured, found and fixed, checkpoint by checkpoint
- [`docs/ai-assistance-log.md`](docs/ai-assistance-log.md): how AI assistance was used, and what was accepted or rejected
- [`docs/checkpoints/`](docs/checkpoints/): summary, evidence and manifest for each checkpoint
- [`docs/03-FINAL-PROJECT.md`](docs/03-FINAL-PROJECT.md) and the other `docs/00`-`05` files: the original planning documents (historical; the product evolved)

## Contributing
Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) (setup, tests, pull requests, secrets, AI-assisted contributions). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report bugs with the issue template; report security or privacy problems as described in [`SECURITY.md`](SECURITY.md).

## License
[MIT](LICENSE).
