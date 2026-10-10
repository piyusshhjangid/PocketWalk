# Checkpoint 5 summary: frontend experience

**Result:** a real, mobile-first React frontend (`frontend/`) that calls the unchanged CP4 `POST /walks/plan`.
No file in `src/` was modified. Version 0.5.0.

## Flow
`HOME -> CONFIGURING -> GENERATING -> PLAN_READY -> READY_TO_WALK`, with `ERROR` reachable from `GENERATING` (retry or change the walk).

| Screen | What the person sees |
|---|---|
| Home | "PocketWalk", "A little less screen. A little more outside.", one button: Start a walk |
| Configure | How long (10 / 20 / 40 min), how it feels (Easy / Normal), optional city, Plan my walk |
| Generating | "Preparing your walk...", a quiet status, Cancel. No percentages, no internals |
| Plan | duration and intensity, title, three timed steps, "Something to notice", outdoor line if the API sent one, I'm ready |
| Ready | "Ready?", "Put your phone away and head out.", a glance at the steps. No timer (that is Checkpoint 6) |
| Error | "We couldn't prepare your walk right now." plus fixed, kind-specific help; Try again only when retrying can help |

## Architecture in one paragraph
`walkApi.ts` is the only code that knows the endpoint. It returns a validated `WalkResult` or an `ApiError{kind,status,retryable}`.
`useWalkFlow` runs one reducer over six named states and allows one request in flight (a ref, so a double click before re-render is still one POST).
Pages are plain components; every user-facing sentence derived from API fields lives in `app/copy.ts`.
The backend has no CORS headers, so dev and `vite preview` proxy `/walks` and `/health`; `VITE_API_BASE_URL` (default empty = same origin) is for later.

## Behaviour that follows from the real contract
- Only values the backend supports are offered: minutes 10/20/40, energy easy/normal. Location is one optional typed city; GPS is never requested.
- The backend `WalkPlan` has no description and no separate safety note, so none is shown or invented. `notice` is the "what to notice" prompt.
- A fallback plan (HTTP 200, `meta.planner = "fallback"`) renders as a normal plan with one quiet line, "A simple ready-made walk." It does not say anything failed.
- Weather is shown only if `meta.context` has it ("18°C, light rain"); daylight only when it matters ("Near sunset", "After dark").
- Model-written text is rendered as text. A test pushes `<img onerror>`, `<script>` and `javascript:` links through the UI and finds no element created.

## Numbers (measured in this checkpoint)
- Frontend tests: 75 passing (5 files). Backend tests: 381 passing, unchanged. Both typechecks and both production builds pass.
- Production bundle: 234 kB JS (73 kB gzip) + 7.4 kB CSS. One runtime dependency family: `react`, `react-dom`.
- Browser QA in headless Chromium at 360, 390, 430, 768, 1280, 1440 px: no horizontal overflow, no console errors, exactly one POST per walk, all touch targets at least 44 px.

## Decisions worth knowing
1. **No frontend Sentry.** The spec says not to add a monitoring stack automatically. The backend already traces the AI workflow; a frontend SDK would add a dependency and a privacy surface for little evidence. An error boundary guarantees a non-blank fallback. Revisit if real-user crashes need tracking.
2. **No "Start walking" button.** It would have nothing to start before Checkpoint 6.
3. **No dark theme, no router, no state library.** Not needed for the checkpoint.
4. **City validation is duplicated on purpose** (UX only); the backend remains the authority.

## Known limitations
- Tested in headless Chromium only. No Safari/iOS, Firefox, real phone, or screen reader.
- The backend must be reachable same-origin (proxy) for the app to work; cross-origin needs CORS or a reverse proxy.
- The ready screen is a hand-off, not the phone-down experience.
- Live Gemma and live Open-Meteo were not exercised (no key, no allowed network); see the evidence file.
