# Checkpoint 6 evidence

Every claim below was produced by a command or browser run in this checkpoint. Anything not run is under NOT VERIFIED.
Browser = headless Chromium 141 via Playwright for Python 1.56 on Linux. No other browser or device was used.
Most timing checks use Playwright's **fake clock** (so a 10-minute walk takes seconds); one check uses the real, unfaked clock. See the limits under NOT VERIFIED.

## CODE VERIFIED
- `frontend`: `npm run typecheck` clean; `npm test` **112 passed** (7 files: api 22, contract 10, copy 17, flow 10, app 22, walkTimer 9, walk 22); `npm run build` clean.
  Bundle: 240.42 kB JS (75.03 kB gzip), 9.76 kB CSS (2.90 kB gzip). CP5 was 234.6 kB / 7.4 kB. 37 tests are new; 75 existed, one CP5 assertion changed (the Ready screen no longer says "put your phone away", it has a Start button).
- Timer maths (pure, `tests/walkTimer.test.ts`): full duration at start, 19:59 after one second, correct after a late callback, 1 ms left reads 0:01 and not finished, exactly 0 is finished, never negative, a clock stepping backwards is capped at the full duration, minute-level spoken summary, step boundaries (7.99 / 8 / 11.99 / 12 / 20 minutes, single-step and empty plans), next-tick scheduling.
- Reducer (`tests/flow.test.ts`): START_WALK only from READY_TO_WALK and a second one changes nothing; exit needs two steps; keep restores identical timing; FINISH_WALK completes once, also while the exit question is open; EDIT and BACK_TO_PLAN ignored during a walk.
- UI with fake timers and an injected clock (`tests/walk.test.tsx`, jsdom): one primary action on Ready; Start goes to the intro with focus on the heading and 20:00; double-click and repeated Enter start one walk (a second start would have reset the time); step transitions at exact boundaries; clock jump with no callbacks shows true time and step; hidden-then-visible recalculates; announcements are only "started" and each step (a MutationObserver sees no per-second changes) and never contain the clock; the timer is not inside a live region; no geolocation, no `fetch`, no second plan request after Start; completion at exactly the end and not 1 ms before; completion happens once even when a frozen page returns late; Done goes Home with nothing in local/session storage; all exit paths; Escape; fresh full timer after restarting.
- Static greps on `frontend/src`: no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`new Function` (0); no geolocation, Notification, wakeLock, serviceWorker, local/session storage or `setInterval` (0); `fetch(` only in `src/api/walkApi.ts`; no key/secret/DSN/Gemma/Sentry strings in `src` or `dist` (0).
- Contrast (computed from the palette, not measured on screen): text `#eef4ee` on `#17382b` 11.5:1; muted `#bdd0c4` 7.9:1; exit control `#cfe0d5` 9.3:1; focus ring `#9ec5ff` 7.3:1 (8.7:1 on the confirmation panel); light button text 13.7:1; ghost button border 11.1:1. CP5 palette values are unchanged.

## BACKEND VERIFIED
- Unchanged `src/`: `npm run typecheck` clean; `npm test` **381 passed** (16 files); `npm run build` clean; `npm audit` 0 vulnerabilities (root and frontend), in the working tree and again from the clean extraction.
- The compiled backend (`node dist/server.js`, `NODE_ENV=production GEMMA_PROVIDER=none WEATHER_PROVIDER=none`) answered `/health` and `POST /walks/plan` with the real deterministic fallback plan. This is not a live model.

## BROWSER VERIFIED (production frontend build, headless Chromium)
`python3 scripts/browser/cp6_flow.py`, **48 checks passed, 0 failed**, in the working tree (47 before a keyboard-race fix to the script, 0 failed) and again from the clean extraction (48 passed).
- Full flow Home > Configure > Generate > Plan > Ready > Start > Active > Complete > Done at 390x844 touch. A double-click on Start gave one walk; 10:00 at start, 9:57 three seconds later (a second start would have reset it); after the 4 s intro the first plan step appears; only "Exit walk" is a button; no AI, provider, weather, fallback or temperature text on the active screen.
- A 4-minute jump in the fake clock shows the recalculated time and the next step; no network requests during the walk; spoken summary is minute-level; completes exactly once; the completion heading has focus; Done returns Home and nothing is stored.
- Exit: asks first (alertdialog); focus lands on "Keep walking"; keeping loses no time (9:45) and returns focus to "Exit walk"; Escape keeps walking; "End walk" returns to Ready with Start available and focus on the heading; no extra plan request. Tab x8 never lands on the inert walk behind the dialog and both buttons are reachable.
- Keyboard-only on desktop 1280x800: first Tab lands on the start button; Tab from the Ready heading lands on Start walking; Enter starts; the active heading has focus; Tab reaches Exit walk with a visible light-blue focus ring (`rgb(158, 197, 255)`).
- Reduced motion: with no preference the walk fade-in is `settle`, with `reduce` it is `none`; timer and instruction work in both.
- Responsive at 360x740, 390x844, 430x932, 1280x800, 1440x900: no horizontal overflow on the active, exit and complete screens; every button at least 44 px high; no console or page errors.
- Refresh during a walk returns to Home with no timer and nothing stored.
- One unfaked run: the page's own timer went 10:00 to 9:57 in 3.3 s of real time.
- Visual: I looked at the screenshots for Ready (390), active (390, settled), exit (390), complete (390) and active (1280). The active screen is calmer than the plan screen. Screenshots taken within about a second of a screen appearing show it mid fade-in, which looks dim; the computed colour is `#eef4ee` at opacity 1 once settled (measured).

## INTEGRATION VERIFIED
The browser checks above run the production build through the Vite preview proxy into the real compiled CP4 backend, from a clean extraction of the candidate ZIP (see below).

## ACCESSIBILITY VERIFIED (markup and behaviour only)
Semantic structure, `role=timer` with hidden minute-level text and `aria-hidden` digits, `role=status` for meaningful changes only, `alertdialog` with `aria-modal` and an inert background, focus management, visible focus ring, reduced motion. This rests on the jsdom and Chromium checks above and the contrast arithmetic. **No screen reader and no automated audit (axe/Lighthouse) was run.**

## NOT VERIFIED
- **Real devices**, Safari/iOS, Firefox, Chrome on Android, touch gestures beyond Chromium's emulation.
- **Screen readers** (NVDA, VoiceOver, TalkBack): announcement behaviour is inferred from markup, not heard.
- **Real background behaviour**: tab throttling, screen lock, app switching and sleep. The fake clock proves that the displayed time is recomputed from timestamps when the page runs again; it does not prove what a real phone does while locked.
- Real-time long runs: no 10, 20 or 40 minute walk was waited out; one 3-second real-time check only.
- Forced-colors mode, browser zoom and large-text settings, automated accessibility audit, contrast measured from rendered pixels.
- Live Gemma, live Open-Meteo, Sentry delivery, the GitHub Actions `frontend` job (never run), production or cross-origin deployment.
- The browser script is not in CI and Playwright is not a project dependency, so the 48 browser checks are reproducible only by someone who installs Playwright for Python.

## Clean-extraction record
The candidate ZIP was built from the working tree, then extracted into a fresh directory and run from scratch: `npm ci` in root and `frontend/` (0 vulnerabilities each), both typechecks, backend 381 and frontend 112 tests, both builds, compiled backend + production frontend, browser script (48 passed), greps.
The final ZIP differs from that tested ZIP only in the two files `docs/checkpoints/checkpoint-6-evidence.md` and `docs/checkpoints/checkpoint-6-manifest.md` (checked with `diff -r`; no non-documentation difference).
The ZIP listing contains no `node_modules/`, `dist/`, `coverage/`, `.env`, logs or credentials (`.env.example` files only).
