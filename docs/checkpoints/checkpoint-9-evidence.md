# Checkpoint 9 evidence

## Environment
Linux sandbox, **one CPU**, Node 22, no Docker or Podman, no provider credentials, no route to Google, Open-Meteo, Sentry or GitHub, headless Chromium via Playwright for Python (not a project dependency).

## Baseline (CP8 ZIP, reproduced before editing)
Backend typecheck clean, 513 tests. Frontend typecheck clean, 147 tests. `npm audit` 0 vulnerabilities (both). The CP8 browser counts (48, 22) were re-run on the new same-origin shape rather than on the old one. No discrepancy.

## 1. Deployment architecture
1. **Chosen:** one Node.js service that also serves `frontend/dist`; Gemma, Open-Meteo and Sentry are reached from the backend only.
2. **Why:** the backend has no CORS by design and the frontend already calls a relative `/walks/plan`; the app has no client-side routes. One origin removes CORS, a build-time API URL and a second deployable, for a two-endpoint app. A CDN can still sit in front.
3. **How frontend requests reach the backend:** same origin, `fetch('/walks/plan')`. In development Vite proxies `/walks` and `/health`; that proxy is not in the production build. Verified: the default client calls a relative path (frontend test), the bundle contains no dev host (scan), and three browser suites ran against a single process serving both.
4. **Environment variables:** read once by a validated schema at start-up (`config/env.ts`); production requires `TRUST_PROXY`; everything else has a safe default; secrets are host-dashboard environment variables. `.env.example` holds only blanks and non-secret defaults. Frontend: only `VITE_API_BASE_URL` and `VITE_REQUEST_TIMEOUT_MS` (both public, both optional).
5. **Provider-specific (left to the user):** the host, TLS/HSTS, entering secrets, the `TRUST_PROXY` hop count for that host, an edge rate limit if more than one instance runs.
6. **Actually deployed vs prepared:** **nothing was deployed.** Prepared and verified locally: production build, production start, Docker build/runtime layout by simulation (below), CI jobs (YAML validated only).

## 2. Build and runtime evidence
| Check | Result |
|---|---|
| `npm run build:all` | pass (backend `dist/`, frontend `frontend/dist/`) |
| Build with `NODE_ENV=production` set | plain `npm ci` breaks `tsc` (TS2688, reproduced); `npm ci --include=dev` works; documented |
| Production start (`node dist/server.js`, env scrubbed) | binds `0.0.0.0:PORT`; `/health` 200, `/ready` 200, `/` 200 HTML, `POST /walks/plan` 200, `GET /walks/plan` 404 JSON |
| Headers on `/` | CSP, nosniff, no-referrer, `Cache-Control: no-cache`; assets `immutable` |
| Bundle scan (`npm run check:bundle`) | 3 text files, clean (no key/DSN/private-key shapes, no server variable names, no dev host) |
| Docker | **NOT built** (no Docker). Simulated: the build stage's commands on a `.dockerignore`-filtered copy (98 files, `tests/` excluded) passed; the runtime stage layout (`package.json`, pruned `node_modules` without tsx/vitest/typescript, `dist`, `frontend/dist`) started like the image `CMD` and served every probe, and exited on SIGTERM |
| ZIP | no `node_modules`, `dist`, `coverage`, `.env`, logs; secret-shape scan below |

## 3. Limits, deadline, cancellation (tests that fail without the code)
| Required scenario | Test |
|---|---|
| Below the limit succeeds; over it gets 429 in the standard shape with `Retry-After`; no implementation detail | `rateLimitCp9` first test |
| Limit resets with the window | `rateLimitCp9` "resets" (injected clock) |
| Health stays available | `rateLimitCp9` "/health and /ready are never limited" |
| Spoofed forwarding headers | `rateLimitCp9`: trust 0 ignores the header; trust 1 counts only the proxy-appended address; no header falls back to the socket; `deploymentCp9` repeats it through `buildAppFromEnv`; IPv6 /64 rotation test |
| Concurrency cap, excess rejected predictably | `concurrencyCp9`: burst of 10 against a cap of 3 = exactly 3 admitted, 7 refused with 503 + `Retry-After`, refused ones never reach the model, no queueing |
| Capacity released on success / failure / timeout / unexpected 500 / client disconnect / deadline | `concurrencyCp9`, one test each (black-box: after the event, a full set of `max` requests is admitted again) |
| Invalid requests do not consume capacity | `concurrencyCp9` |
| Within budget succeeds; slow model bounded; slow context bounded; fallback gets the remaining budget | `deadlineCp9` (fake clock): model stops at `deadline - 1.5 s`, weather at `remaining - 3.5 s`, model skipped when under 2 s remain |
| Exceeding the deadline returns a safe outcome; late resolution cannot change it; no duplicate response; no unhandled rejection | `deadlineCp9` real server: one labelled fallback, provider signal aborted, late success and late failure ignored; fallback also broken -> controlled 504 |
| No timers/listeners leak | `deadlineCp9` (`vi.getTimerCount() === 0`), scope `dispose` |
| Client disconnect | `deadlineCp9`: the in-flight model call is aborted; with weather in flight the model is never called; nothing is written to the closed socket |
| Shutdown | `deploymentCp9` ordering (fake clock) and `serverProcessCp9` real process: idle exit 0; **in-flight request at SIGTERM is cut off after the 1 s grace, its provider connection is torn down, exit 0, elapsed under 8 s (not the 20 s model timeout)** |
| Health and readiness states | `deploymentCp9`: starting 503, ready 200, shutting_down 503, health 200 throughout, fixed bodies, no provider calls |
| Missing required production configuration | `deploymentCp9` + `serverProcessCp9`: exit 1, message names `TRUST_PROXY`, no secret printed; missing frontend build and a taken port are also clear exits |
| Missing optional Sentry | `serverProcessCp9`: says "SENTRY_DSN is not set" and serves; unreachable DSN: serves, DSN never in the log |
| API vs frontend routing | `deploymentCp9`: unknown API paths and wrong methods are JSON 404, never HTML; dotfiles and traversal not served |
| Malformed/oversized/invalid-type body, 500, timeouts | existing CP8 suites, unchanged and green |
| Sensitive-data scrubbing | existing CP8 suites (including the real-process wire test), unchanged and green |

**Mutation checks** (break the protection, tests must fail): trust all proxies (2 failed), never release a slot (6), remove the deadline race (4), ignore disconnects (3), remove the limiter (7), ignore the remaining budget (4), remove the drain header (1), serve HTML for unknown paths (2). All restored; suites green.

## 4. Test results
| | Count |
|---|---:|
| Backend existing | 513, unmodified |
| Backend new | 98 (`rateLimitCp9` 18, `concurrencyCp9` 12, `deadlineCp9` 20, `deploymentCp9` 41, `serverProcessCp9` 7) |
| Backend total | **611 passing**, 27 files |
| Frontend existing | 147 (2 modified, see below) |
| Frontend new | 4 (`deploymentCp9.test.tsx`) |
| Frontend total | **151 passing**, 9 files |
| Removed / skipped | 0 / 0 |
| Modified | 2 frontend tests in `reliabilityCp8.test.tsx`: the 429 copy expectation and the status table (429, 503 now map to `busy`), because those statuses now deliberately mean "busy" |
| Config change | `vitest.config.mts` `testTimeout: 20000` (no assertion changed) |

**Flakiness found and fixed:** one of three consecutive backend runs failed. Reproduced with three suites in parallel on this one-CPU machine: the pre-existing `validationPipeline` exhaustive test takes 2.4 s alone and 7+ s under load against vitest's 5 s default, and the new real-process tests add load. After the timeout change, three parallel suites each passed 611, and repeated sequential runs passed.

## 5. Browser regression (production-shaped, one origin)
| Script | Result |
|---|---|
| `cp6_flow.py` (happy path, real compiled server, production mode, limiter on) | 48 passed / 0 failed (17 plan requests, under the 20/min default) |
| `cp8_failures.py` (500, garbage 200, refused, 429, 503, timeout, retry, model-down, cancel) against `qaServer` serving the build | 22 passed / 0 failed |
| `cp9_limits.py` (real limiter, `RATE_LIMIT_MAX=2`) | 9 passed / 0 failed: third request shows "busy right now", API returns 429 + `Retry-After`, `/health`, `/ready` and the app shell still 200, no console errors (so the CSP blocked nothing) |

## 6. Security and privacy review
Unchanged CP7/CP8 protections all still pass (message-free Sentry capture, scrubbers, path-only access log, real-process wire test). New surface reviewed: the limiter key (address only, never logged or echoed in a response body), the readiness body (fixed words), startup notes (names and numbers; a test asserts a fake key never appears), `Connection: close` while draining, static serving (dotfiles ignored, traversal tested, no listing), CSP (checked against the real build: no inline script, no external host). `TRUST_PROXY=true` is impossible (numeric schema, tested).

## 7. Dependency audit
`npm audit`: 0 vulnerabilities, backend and frontend. No dependency added or upgraded.

## 8. CI
`.github/workflows/ci.yml` parsed locally. Existing `verify` and `frontend` jobs untouched. Added `package` (install both halves, `build:all`, `check:bundle`) and `docker` (build image, smoke-test `/ready`, `/health`, the app shell, the API, a JSON 404, `docker stop` exit code 0). `contents: read`, no secrets, no deploy step, `timeout-minutes` set. **None of this has run on GitHub**; the `docker` job is the first real image build. The commands in the docker job's smoke script that do not need Docker were run locally against the simulated runtime layout.

## 9. Live hosting status
**Not deployed.** No host account, credentials or network access. The user steps are in the report.

## 10. Not verified
Live deployment; a real Docker image build and run; GitHub Actions including the new jobs; real Sentry ingestion; live Gemma and Open-Meteo; behaviour behind a real reverse proxy (hop counting was tested with the header semantics, not with a real proxy); multi-instance behaviour of the limiter and cap (per process by design); real phones and browsers other than headless Chromium; performance numbers (none measured, none claimed).
