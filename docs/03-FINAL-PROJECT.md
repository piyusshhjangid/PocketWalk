# 03 — PocketWalk: final project spec (LOCKED at CP0)

> **Historical planning document.** Written at Checkpoint 0 (6 Oct 2026), before any code existed, as planning notes for the challenge. The built product differs from it in places: for example, outdoor context only informs the walk and never refuses or delays one (there is no "window gate"), the model is called once with no repair retry, and the checkpoint plan was reorganised. It is kept for the record and does **not** describe the current project. For that, see the [README](../README.md), [architecture](architecture.md) and [API reference](api.md).

**Primary category:** Best Use of Sentry Agent Tracing. **Backup:** ElevenLabs. **Model:** Gemma (open weights). **Partner:** Sentry only.

**Memory sentence:** "We treated our AI's latency as screen time, and used Sentry traces to shrink it."

## Core workflow
1. User taps one of three durations (10 / 20 / 40 min) + energy (easy / normal). Nothing to type.
2. Agent run starts (Sentry agent span, conversation id per run).
3. Tool: **window gate** — coarse location (rounded, never stored) → hourly weather (Open-Meteo, UNKNOWN terms → CP3) + sunset computed locally. If no safe window: reply "Not now — next good window 5:10 PM", trace shows why.
4. Gemma receives a small JSON (minutes, window end, sunset, temp, rain %, wind, energy) and returns JSON: title, 3 steps (≤14 words each, with minutes), one "notice" prompt.
5. Validator: parse → Zod → business rules (minutes fit window, ends ≥15 min before sunset) → safety rules (banned categories). One repair retry, then deterministic fallback bank. Each rejection is a span event.
6. **Latency budget:** if the model hasn't answered within the budget (target 6 s, UNKNOWN until measured), serve a fallback walk and mark the span. Budget exists because every second is screen time.
7. Result screen: big text, "Back by 5:42", then "Phone down" (near-black screen). Frontend records TTPD = open → pocket tap, sent as a span measurement.

**Unforgettable demo moment:** split screen — phone in a hand tapping "20 min", and in the same video the Sentry trace waterfall appearing, ending with "TTPD 9.4 s" (illustrative; real number measured at CP7), then the phone going into a pocket and cut to a real walk.

## Differentiation (workflow, not feature)
Existing entries generate tasks. PocketWalk (a) grounds the plan in a tool-computed time window, (b) treats the AI's own latency as a screen-time cost and measures it, (c) makes every guardrail decision inspectable in traces, (d) outputs *less* — one screen, then nothing.

## Remove-the-partner test
- Version A: window gate + Gemma + validator + budgeted fallback + TTPD instrumented + p50/p95 improvement story + inspectable rejections.
- Version B (no Sentry): same app, but no measurement, no evidence of why a fallback fired, no before/after, no debugging story. **Materially worse as a submission; as an app the user can't tell.** That's inherent to an observability category — mitigate by making the optimisation loop the article's spine.

## Judge-in-20-seconds
What: a one-tap walk planner. Who: people who open their phone "to decide" and lose 10 minutes. AI: Gemma composes the walk from real weather/daylight. Partner: Sentry traces the agent so latency, tokens, cost and guardrail rejections are visible. Outside: it ends with a phone-down screen and a return time.

## Gemma plan
- Input: tiny structured JSON (no free text from the user → shrinks prompt-injection surface).
- Output: strict JSON. Never trusted before validation.
- Adapters: `GoogleGemma` (hosted; weights open, inference not local), `Ollama` (local; the real open-weight story), `Fake` (tests/demo fallback). Do not claim offline until tested end-to-end.
- Hosted vs local is decided at CP2 by measured latency; *comparing them in Sentry is itself a piece of evidence* and the "why open innovation": swap model/size/provider and measure the screen-time cost.

## Architecture
React/Vite/TS/Tailwind (static) → Express/TS API → Controller (thin) → `WalkService` → `WindowTool` | `ModelAdapter` → `Validator` (Zod + rules) → `FallbackBank`. Sentry: `@sentry/react` (TTPD, connected trace) + `@sentry/node` (agent spans). **THIS is the part that makes the partner necessary:** the span tree + TTPD measurement + rejection events.
**Deviation from your preferred stack:** no PostgreSQL/Prisma. There is no data problem (no accounts, nothing stored). Adding a DB would be prize-farming overhead.

## Scope lock
MUST (before Oct 11): window gate, Gemma adapter, validator+safety, fallback bank, budget fallback, Sentry spans + TTPD, one-screen UI + phone-down screen, tests, CI, README, article, demo, ≥1 real outdoor test, evidence screenshots.
SHOULD (only if MVP done): Ollama adapter comparison run, second language NOT included (English only), PWA install.
DO NOT BUILD: accounts, DB, maps, push notifications, leaderboards, social, payments, analytics dashboard, vector search, Redis/queues, microservices, native app, photo/voice input, extra partners.

## Safety / privacy / security
- Safety: model may only choose from allow-listed activity types (walk, look, listen, sit, stretch). Block: climbing, water, roads/traffic, restricted/private areas, wildlife contact, eating plants, night/alone, experiments, screen use. Disclaimer in app. Unsafe weather → no walk.
- Privacy: coarse lat/lon rounded to 0.1°, used per request, not stored; no analytics; Sentry configured to **not record location or user text**; check Sentry privacy controls at CP1; no IP/user identifiers beyond defaults needed.
- Security: keys only in env/server; `.env.example`; rate limit; input schema validation; no URLs fetched from user input (no SSRF); strict JSON from model; CSP; `npm audit` in CI.

## Testing & CI
Unit: window logic, validator, safety, parser. Integration: API with Fake adapter; adapter contract. E2E (Playwright): tap → result → phone-down. CI (GitHub Actions on PR+main): install → typecheck → lint → test → build.

## Failure strategy
| Failure | Response |
|--|--|
| Gemma slow/down | latency budget → fallback bank, span flagged `fallback=true` |
| Malformed/unsafe output | repair once → fallback |
| Weather API down | conservative window (daylight only, no rain claims) + visible notice |
| Sentry unreachable | app unaffected (SDK is non-blocking); evidence captured earlier |
| Render cold start | warm-up ping before recording; this is also a real finding to write up |
| Live demo risk | pre-recorded video is primary; live link is bonus |

## Backup pivot (ElevenLabs)
Trigger: by **Oct 8, 12:00 IST** no parent-child agent spans in Explore→Agents. Action: add `VoiceAdapter` (TTS reads the 3 steps; STT optional) behind the same service; keep Sentry for latency of the voice stage if it works. Cost ≈ half a day. Don't pivot if Sentry works.

## Risks
Biggest weakness: a 3-step walk is a thin agent. Fix: ≥2 tool/validation stages, repair loop, real before/after numbers. Biggest judging risk: "Sentry bolted on". Fix: article spine = trace-driven optimisation + one debugged failure with screenshot.
