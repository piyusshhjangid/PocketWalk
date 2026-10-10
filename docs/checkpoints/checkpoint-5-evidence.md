# Checkpoint 5 evidence

Every claim below was produced by a command or browser run in this checkpoint. Anything not run is under NOT VERIFIED.
Browser = headless Chromium (Playwright 1.56, Chromium 1194) on Linux. No other browser or device was used.

## CODE VERIFIED
- `frontend`: `npm run typecheck` clean; `npm test` **75 passed** (5 files: api 22, contract 10, copy 17, flow 4, app 22); `npm run build` clean.
  Bundle: 234.6 kB JS (73.5 kB gzip), 7.4 kB CSS.
- Backend regression, unchanged `src/`: `npm run typecheck` clean; `npm test` **381 passed** (16 files); `npm run build` clean; `npm audit` shows 0 vulnerabilities for both packages at install.
- Covered by tests: home renders with one action and no tech branding; only 10/20/40 and easy/normal are offered; request body is built correctly (no `location` key unless a city is typed); GPS is never requested;
  loading status without percentages or internals; AI plan, fallback plan (no failure wording), hostile HTML rendered as text, error states for network/timeout/server/malformed, no Try again for a 400, retry sends the same request once,
  rapid repeated activation sends one request, Cancel aborts and a late answer is ignored, Cancel is not offered instantly, keyboard-only flow and focus moves to each new heading.
- API contract tests parse **responses captured from the real CP4 app** (`npm run fixtures:frontend`): model plan with weather, model plan without location, three fallback reasons, 400, 404, 500.
- Greps: no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `frontend/src`; `fetch(` only in `src/api/walkApi.ts`; no key/secret/DSN/Gemma/Sentry strings in `frontend/dist` or `frontend/src` (only comments saying never to put secrets in VITE_ variables).
- Contrast computed from the palette: body text 13.7:1, muted text 5.8:1, button text 9.1:1, error text 6.5:1, control borders 3.9:1 (WCAG 1.4.11), focus ring 5.9:1.

## BACKEND VERIFIED
- The unchanged CP4 backend ran as a real process: `npx tsx src/server.ts` (dev) and, from the clean extraction, the compiled `node dist/server.js` with `NODE_ENV=production GEMMA_PROVIDER=none WEATHER_PROVIDER=none`.
  `GET /health` answered and `POST /walks/plan` returned the real fallback walk (`planner: "fallback"`, `fallbackReason: "not_configured"`).
- Not a live model: with `GEMMA_PROVIDER=none` every walk is the deterministic fallback by design.

## INTEGRATION VERIFIED (real browser -> real frontend build -> proxy -> real CP4 app)
Run twice: in the working tree (QA passes) and again from the clean extraction of the final ZIP.
Frontend = `vite preview` of the production build.

Clean extraction, compiled backend, no model:
- Home -> Start -> Configure (10 min, Normal) -> Plan -> Ready, 390x844 touch: plan rendered; **a double-click on Plan my walk produced exactly 1 POST** with body `{"minutes":10,"energy":"normal"}`; no console or page errors.
- Backend process killed -> "We couldn't prepare your walk right now. Something went wrong on our side..." with Try again / Change walk (never blank); backend restarted -> **double-click on Try again -> 1 new POST**, plan shown.
- Desktop 1280x800, keyboard only (Tab, Enter, Arrow, Tab...): full flow to Ready, focus on the Ready heading, one POST `{"minutes":40,"energy":"easy"}`, no errors.

Clean extraction, real CP4 app with scripted model and weather (`scripts/qaServer.ts`; the model and the weather service are stand-ins, everything else is the real pipeline):
- **Normal AI response** (`planner: "model"`), city "Jalandhar": plan shown with "18°C, light rain."; request body had the city; no errors.
- **Fallback response** (model unavailable): a normal plan ("Short lit loop near home", "19°C, cloudy. Near sunset.") with one quiet line "A simple ready-made walk."; no failure wording.
- **Cancel**: absent at 0.3 s, present by 1.5 s; clicking it returns to the form; 1 POST.

Working-tree QA (same harness), in addition:
- Weather outage still gives a plan with no weather line. Model output containing "Climb the wall" was rejected by the real safety engine and the user saw the fallback plan, no wall climb.
- Slow model (6 s): loading status, plan after ~6.3 s, 1 POST for a double-click. Cancel mid-request, late answer ignored, 1 POST total.
- Real HTTP 500 (fallback planner crash), then recovery and Try again -> plan. Simulated malformed 200 body -> error state, Try again offered.
- Client timeout (dev server with `VITE_REQUEST_TIMEOUT_MS=4000`, model hanging): error "That took longer than expected" after 5.0 s; Try again then succeeded.
- Browser-level aborted request -> "PocketWalk can't be reached..."; Try again then succeeded.
- `prefers-reduced-motion: reduce`: computed `animation-name` is `none` for the home trail and loading path; with no preference it is `trail`.
- Responsive pass at 360x740, 390x844, 430x932, 768x1024, 1280x800, 1440x900 on Home, Configure, Plan and Ready: `scrollWidth == innerWidth` everywhere (no horizontal overflow), no console errors, all buttons/inputs/choice tiles at least 44 px.
  Screenshots were looked at; bugs found and fixed are listed in the development log (wrapping "16 min", uneven tiles at 360 px, over-wide desktop button, faint control borders, double-tap hitting Cancel).

## NOT VERIFIED
- **Live Gemma** (no key; network sandbox): the model path was exercised only with a scripted model client. The real rejection/fallback rate of Gemma output is still unknown.
- **Live Open-Meteo**: weather came from a scripted provider. `npm run smoke:weather -- <city>` was not run.
- **Sentry delivery** (backend unchanged; no frontend Sentry exists). **GitHub Actions**: the new `frontend` CI job was never run.
- Safari/iOS, Firefox, Chrome on Android, any physical phone, any screen reader (NVDA, VoiceOver, TalkBack), forced-colors mode, browser zoom/large-text settings, touch gestures beyond Playwright's emulation.
- Production deployment, cross-origin deployment (the backend has no CORS), HTTPS, caching headers, real-network latency, bundle behaviour on slow devices.
- A real HTTP 400 from the UI: the client validates the city first, so the browser cannot produce one; it is covered by a unit test using the captured real 400 body.
- Automated accessibility audit (axe/Lighthouse) was not run; accessibility claims rest on semantic markup, the keyboard run, the contrast arithmetic and the tests above.

## Clean-extraction record
The ZIP that was extracted and tested was built just before the evidence and manifest files were finalised. `diff -r` between that extraction and the final ZIP shows no difference outside `*.md` files (documentation only).
Fresh directory, `unzip pocketwalk-checkpoint5.zip`; the ZIP listing contains no `node_modules/`, `dist/`, `coverage/`, `.env` or credentials (`.env.example` files only).
`npm ci` in root and `frontend/` (0 vulnerabilities); both typechecks; backend 381 and frontend 75 tests; both builds; compiled backend + production frontend + Playwright flows above.
