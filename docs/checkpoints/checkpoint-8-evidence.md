# Checkpoint 8 evidence

## Environment
Linux sandbox, Node 22, no provider credentials, no route to Google, Open-Meteo, Sentry or GitHub. Headless Chromium via Playwright for Python (not a project dependency).

## Baseline (CP7 ZIP, reproduced before editing)
Backend typecheck clean, 392 tests. Frontend typecheck clean, 112 tests. `npm audit`: 0 vulnerabilities (both). Matches the CP7 report; no discrepancy.

## Privacy finding and fix (verified)
| Check | Result |
|---|---|
| Unexpected 500 message reached Sentry in CP7 | **Confirmed** by reading the code (`captureException(err)` + `setupExpressErrorHandler`) and by the mutation run below |
| Fix | `captureUnexpected` (class + stage + frames), SDK handler removed, `scrubEvent` (`beforeSend`), `beforeBreadcrumb` drop, `scrubSpan` (`beforeSendSpan`), path-only access log |
| Mutation check | Restoring CP7's handler and removing the scrubber made 3 tests fail (2 in-process, 1 real-process); restoring the fix passes them |
| Real-process wire test | `src/server.ts` against a local capture endpoint; fake key, token, cookie, auth header, city sent via query/headers/body; **none appears in any outgoing byte or in the server log**; `http.server` span and the sanitised error event did arrive |
| Level reached | Code-level instrumentation verified; outgoing-event privacy verified in tests and on the wire to a LOCAL endpoint. **Ingestion by a real Sentry project: NOT VERIFIED** |

## The 18 required regressions
| # | Behaviour | Test |
|---|---|---|
| 1 | Express exception does not leak to the client | `apiReliabilityCp8` "unexpected internal exceptions"; `sentryPrivacyCp8` #1 |
| 2 | ...nor to Sentry | `sentryPrivacyCp8` #2, scrubber and request-data tests; `sentryWireCp8` |
| 3 | Model timeout -> fallback, provider aborted | `failureHandlingCp8` "3. model timeout" (fake clock) |
| 4 | Context timeout does not hang | "4. context timeout"; "model AND context both hang" (sum of budgets) |
| 5 | Invalid output cannot bypass validation | the "5." and structure/size cases (empty strings, wrong types, step count, wrong total, bad minutes) |
| 6 | Unsafe output cannot bypass safety | "6. unsafe" cases (road, water, climbing); HTML and prompt-injection cases |
| 7 | Invalid fallback is never returned as a plan | "7. a fallback that fails validation..." (emergency plan, labelled); wrong-total variant |
| 8 | Malformed provider JSON | "8. malformed JSON", prose, array/null/number/string, odd provider shapes |
| 9 | Oversized model output | "9. oversized output" (parse cap) and "9. an oversized model-provider body" (byte cap, Google and Ollama) |
| 10 | Failed Sentry submission cannot break a request | `sentryFailureCp8` (transport throws/rejects, `beforeSend` throws, no unhandled rejection) |
| 11 | Frontend network failure recovers | `reliabilityCp8` "11."; browser "connection refused -> Try again" |
| 12 | Frontend timeout recovers | `reliabilityCp8` "12."; browser "timeout" (fake clock) |
| 13 | Rapid repeats create one request | "13." (user-event), "13b." (same tick), browser "double-click: exactly one POST" |
| 14 | Late responses cannot overwrite newer state | "14." (late success), stale failure test, unmount test |
| 15 | CP6 timer stays timestamp-based | existing, unmodified: `walk.test.tsx` (counts down from timestamps; delayed timer; visibility), `walkTimer.test.ts` |
| 16 | Active walk sends no network requests | existing "never asks for location, notifications or the network after the walk starts"; browser "active walk sends no further requests" |
| 17 | Completion happens once | existing "happens once: later ticks and a late visibility change do not repeat or revert it" |
| 18 | Normal end-to-end flow works | `cp6_flow.py` 48/48; `app.test.tsx`, `walk.test.tsx` |

## Test results
| | Count |
|---|---:|
| Backend existing | 392 (1 file modified: `safetyTrace.test.ts`, capture-hook ordering only, no assertion changed) |
| Backend new | 121 (`sentryPrivacyCp8` 8, `sentryFailureCp8` 4, `sentryWireCp8` 1, `apiReliabilityCp8` 46, `failureHandlingCp8` 62) |
| Backend total | **513 passing**, 22 files |
| Frontend existing | 112, unmodified |
| Frontend new | 35 (`reliabilityCp8.test.tsx`) |
| Frontend total | **147 passing**, 8 files |
| Removed / skipped | 0 / 0 |
| Flakiness | backend suite 3 consecutive passes, frontend 2, the wire + failure files 3; none observed |
| Browser | `cp6_flow.py` 48 passed / 0 failed; `cp8_failures.py` 22 passed / 0 failed |

The test count is not the measure of reliability: three bugs were found and fixed, and each guard was mutation-checked (see the development log).

## Typecheck, build, audit
Backend and frontend typecheck, build: pass. `npm audit`: 0 vulnerabilities (both). No dependency was added or upgraded.

## CI
`.github/workflows/ci.yml` inspected and parsed locally: Node 22, `npm ci`, typecheck/test/build for backend and frontend, `contents: read`, no secrets, no provider credentials. Unchanged. **A real GitHub Actions run: NOT VERIFIED.** The new tests need only devDependencies (`tsx`) and a free localhost port.

## Verification limits
No live Gemma or Open-Meteo; fixtures are hand-written to documented shapes. No real Sentry ingestion. No GitHub run. Headless Chromium only; no real phone. The browser failure script uses `scripts/qaServer.ts` (scripted stand-ins).
