# PocketWalk Checkpoint 3: Outdoor Context Engine

## Objective
Make PocketWalk context-aware. Replace "duration + energy -> Gemma" with
"request + local time + weather + daylight -> ContextBuilder -> OutdoorContext -> Gemma", keeping Checkpoint 2's
validation, fallback, Sentry tracing and public API intact.

## Previous checkpoint
Checkpoint 2 (`pocketwalk-checkpoint2.zip`). Re-verified from a clean `npm ci` before any change: typecheck PASS,
55/55 tests PASS. Gemma adapters (Google, Ollama), validation, fallback and Sentry spans were present as documented.
`contextBuilder` was a pass-through placeholder. Open from CP2 and unchanged: live Gemma call, GitHub Actions run, real Sentry
delivery, `LICENSE` name, rate limiting.

## What changed
- `src/context/`: typed `OutdoorContext`, `WeatherProvider` interface, Open-Meteo adapter, daylight/time-of-day logic,
  normalisation, deterministic guidance rules, `ContextBuilder`.
- Gemma prompt carries normalised facts + one fixed sentence per guidance code. Fallback planner follows the same guidance.
- `POST /walks/plan` accepts an optional `location: {city}`. Response gains `meta.context`, `meta.contextLatencyMs`,
  `meta.weatherLatencyMs`. Nothing existing was removed or renamed.
- Sentry: `context.build` > `weather.fetch` + `daylight.calculate`, failure attributes, privacy options shared with a test.
- `npm run smoke:weather -- <city>` and `npm run scenarios`.

## Architecture changes
See `docs/architecture.md`. New seam: `WeatherProvider`. `ContextBuilder` moved from `src/services/` to `src/context/`.
`WalkService` takes a `ContextBuilder` as an optional third constructor argument (default: no weather provider).

## Weather provider
**Open-Meteo.** Evaluated on: no key (nothing to leak or provision), current weather and sunrise/sunset in one request,
local time zone from `timezone=auto`, keyless city geocoding, simple JSON, easy to fake locally. Contract read from the
official geocoding and forecast docs on 2026-10-07. Trade-offs: two sequential calls per request; free tier is
**non-commercial only**; no SLA on the free endpoint; rate limits not verified. Requests: geocode
`GET /v1/search?name=&count=1&language=en&format=json`, then forecast
`GET /v1/forecast?latitude=&longitude=&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=sunrise,sunset&timezone=auto&forecast_days=1`.
Responses are Zod-validated with sanity bounds; unknown weather codes are `malformed`.

## Daylight approach
No astronomy library. Sunrise/sunset come from the forecast response (local wall-clock), compared with the local clock
in the place's time zone (`Intl`). Phases: `night`, `near_sunrise` (-30/+45 min), `day`, `near_sunset` (-60/+30 min), plus
`walkEndsAfterSunset`. Time of day by fixed hour ranges. Missing/mismatched/malformed sun times -> daylight `unavailable`.
The windows are product choices, not measured twilight.

## Context schema
```text
OutdoorContext {
  minutes, energy                       (from the request)
  timeOfDay?      morning | afternoon | evening | night
  daylight?       night | near_sunrise | day | near_sunset
  walkEndsAfterSunset?  boolean
  weather?        { condition, temperatureC (whole), temperatureBand, precipitation, wind }
  availability    { weather, daylight }: ok | unavailable | not_requested
  weatherFailure? not_configured | location_not_found | timeout | unavailable | rate_limited | misconfigured | malformed | unknown
  guidance        poor_conditions | dark | low_visibility | wet | hot | cold | windy  (deterministic)
}
```
Raw provider fields, time zone, sun times, feels-like number and coordinates are dropped before this point.

## Gemma changes
`buildPrompt(context)`: same fixed rules plus "use only the facts in the context; do not guess anything listed as
unavailable" and "nothing that needs good light unless daylight is day"; a "Conditions (follow these)" list with one fixed
sentence per active guidance code; one JSON facts block. With no location the facts block is byte-identical to CP2's. The
model never computes time, weather category or darkness. Output is still parsed and validated exactly as in CP2. Real Gemma
output quality with this prompt: **NOT VERIFIED**.

## Sentry changes
New spans `execute_tool context.build` (replaces `prepare_context`), `weather.fetch`, `daylight.calculate`. Attributes are
enumerated only (provider name, status, failure reason, phase, time of day). Agent span gains `pocketwalk.weather`,
`.daylight`, `.context_ms`, `.weather_failure`. Automatic outgoing-request spans and breadcrumbs for the weather hosts are
suppressed. Verified with the real SDK and a recording transport that nothing sent contains the city, coordinates, time zone,
prompt or model output. Real delivery / Explore -> Agents: **NOT VERIFIED**.

## Tests
193 passing in 10 files (55 CP2 unchanged + 138 new), no network. Highlights: daylight and time-of-day edges; every guidance
rule; builder for success/partial/failure/timeout/provider-bug; Open-Meteo adapter against documented-shape fixtures; the four
Gemma x weather combinations over HTTP; prompt contents; fallback validity for every guidance combination; request validation;
env; real-SDK span tree and telemetry privacy. Typecheck clean. Build clean. `npm audit`: 0 vulnerabilities (2026-10-07).

## Security
No weather credential exists (none needed). Gemma key handling unchanged (header only, never logged). All third-party calls are
server-side with an abort budget. Provider failures map to a closed enum; provider bodies and messages are never copied into
errors, responses or telemetry. City input is validated and URL-encoded; no user text reaches any prompt. `.env`, keys,
`node_modules`, `dist` are not packaged (checked on the clean extraction).

## Privacy
City name only, per request, never stored. No GPS, tracking, maps or routes. Coordinates stay inside the provider and are rounded to
~1 km. Gemma gets enumerated facts only. `meta.context` and Sentry contain no location. The city is sent to Open-Meteo (a third
party); the coordinates derived from it are sent there too.

## Known limitations
- **No live Open-Meteo call was made** (sandbox egress blocks it). Adapter verified against fixtures written from the docs.
- First geocoder match wins; ambiguous names can resolve to the wrong place (the user can add a country).
- Time zone, and therefore time of day and daylight, comes from the weather provider; if weather fails these are unavailable too.
- Two sequential provider calls add latency; no caching (CP7). The 3 s budget is an unmeasured placeholder.
- Guidance thresholds (heat >= 32 C feels-like, extreme >= 40 / <= -10, cold <= 3, wind bands, daylight windows) are product
  choices, not validated. They are **not** the full safety system, which is Checkpoint 4.
- Open-Meteo free tier is non-commercial; its rate limits were not verified.
- A weather-code unknown to the mapping makes weather `unavailable` (`malformed`) rather than guessing.
- Carried over from CP2: no live Gemma call, CI not run, no rate limiting, `LICENSE` name placeholder.

## Problems encountered
Two wrong test expectations from time-zone arithmetic (fixed in the tests); a redundant fog branch removed; a Sentry control
experiment showed `urlQueryParams: false` already scrubs queries, so the suppression is defence in depth (documented). The
sandbox proxy returns 403 for Open-Meteo (classified `misconfigured`; the walk was still served). See `docs/development-log.md`.

## Decisions
See `docs/development-log.md` (Decisions).

## Definition of Done
| Item | CODE VERIFIED | LIVE SERVICE VERIFIED |
|---|---|---|
| Outdoor context model exists | PASS | n/a |
| Context builder exists | PASS | n/a |
| Current time represented | PASS | n/a |
| Weather context works | PASS (fakes + documented-shape fixtures + local imitation server over real HTTP) | NOT VERIFIED |
| Daylight context works | PASS | NOT VERIFIED |
| Provider responses normalised | PASS | NOT VERIFIED |
| Gemma receives normalised context | PASS (prompt inspected via scripted model) | NOT VERIFIED |
| AI output remains structured / validation unchanged / fallback unchanged | PASS | NOT VERIFIED (no live Gemma) |
| Weather failure, partial context, Gemma failure, combined failure handled | PASS | partial: only a sandbox-proxy 403 was exercised live |
| External calls have timeout behaviour | PASS | NOT VERIFIED |
| No unnecessary precise location; no sensitive context in Sentry; no secrets in logs; no provider keys in frontend | PASS | n/a |
| Context trace exists; weather and Gemma measurable; failure paths traceable | PASS (real SDK, recording transport) | NOT VERIFIED (real Sentry) |
| New tests pass / old tests pass / typecheck / build | PASS (193/193; 55/55 old) | n/a |
| CI remains valid | workflow unchanged; NOT VERIFIED (never run on GitHub) | NOT VERIFIED |
| README, architecture, dev log, AI log, summary, manifest, evidence | PASS | n/a |

## Completed
Everything marked PASS above.

## Not verified
Live Open-Meteo; live Gemma; any real latency number (weather, context, Gemma, total: **NOT VERIFIED**, none claimed);
GitHub Actions; Sentry delivery and Explore -> Agents.

## User actions required
See `checkpoint-3-evidence.md`. In short: `npm run smoke:weather -- <your city>`, `npm run smoke:gemma`, push to GitHub for
a green CI run, one real request with a city and `GEMMA_PROVIDER` set, Sentry waterfall screenshot, fill in `LICENSE`, and the
"accepted / rejected / why" rows in `docs/ai-assistance-log.md`.

## Next checkpoint
Checkpoint 4: Structured AI + Safety (full safety rules, repair retry). Do not start until approved.
