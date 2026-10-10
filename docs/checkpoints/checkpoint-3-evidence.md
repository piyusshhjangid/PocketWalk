# Checkpoint 3: Evidence checklist

Capture real artifacts only. Do not edit or fabricate. Items marked * turn "NOT VERIFIED" into "LIVE SERVICE VERIFIED".
Everything below is for you to run: the build environment could not reach Open-Meteo, Gemma, GitHub or Sentry.

## What the build environment already produced (CODE VERIFIED)
- [x] `npm ci`, `npm run typecheck`, `npm test` (193 passing, 10 files), `npm run build` on a clean extraction of the ZIP
- [x] `npm run scenarios`: offline run of scenarios A-E (comfortable, rain, near sunset, weather unavailable, Gemma unavailable)
      using scripted weather and a scripted model. Captured output:

```text
A  comfortable, Gemma up        planner=model     guidance=[]                 model told: no condition guidance
B  rain, Gemma up               planner=model     guidance=[wet]              model told: "It is wet. Prefer sheltered or covered stretches..."
B2 rain, Gemma down             planner=fallback  guidance=[wet]              plan: "Easy covered loop near home" (rain-aware, labelled fallback)
C  near sunset, Gemma up        planner=model     guidance=[low_visibility]   model told: "Light is low or fading..."
C2 after dark, Gemma down       planner=fallback  guidance=[dark]             plan: "Short lit loop near home"
D  weather unavailable, Gemma up planner=model    weather=unavailable, weatherFailure=unavailable, model told what is unknown
E  Gemma down, weather up       planner=fallback  fallbackReason=unavailable  plan: "Easy loop near home"
E2 both down                    planner=fallback  weather=unavailable         plan: "Easy loop near home"
```
      (Condensed from `npm run scenarios`; the script prints the full context and plan for each. These use scripted stand-ins:
      they prove what PocketWalk does with context, not what real Gemma writes.)
- [x] Compiled server (`node dist/server.js`): `GET /health` 200; CP2-style request (no location) 200 with
      `context.weather = not_requested`; request with a city while the weather host was unreachable from the sandbox: 200,
      `weather = unavailable`, `weatherFailure = misconfigured` (proxy answered 403), walk still served; invalid city 400.
- [x] Clean-extraction check: no `.env`, `node_modules`, `dist`, keys, or Sentry credentials in the ZIP (see final report)

## Live checks (you)
- [ ] * `npm run smoke:weather -- <your city>` output (real Open-Meteo: normalised context + `weather=<n> ms`; no coordinates printed)
- [ ] * Same with a city that cannot exist, to see `location_not_found`
- [ ] * `npm run smoke:gemma` with your key (carried over from CP2)
- [ ] * `npm run dev` with `GEMMA_PROVIDER` set, then
      `curl -X POST localhost:3000/walks/plan -H 'content-type: application/json' -d '{"minutes":20,"energy":"easy","location":{"city":"<city>"}}'`
      showing `"planner": "model"` and `meta.context.weather = "ok"`. Save the full JSON.
- [ ] Same request with `WEATHER_PROVIDER=none` (or Wi-Fi off) showing `weatherFailure` and a still-valid walk
- [ ] Same request with a deliberately bad Gemma key showing `planner: fallback` AND `meta.context.weather = "ok"`
- [ ] * Sentry screenshot: waterfall for `POST /walks/plan` showing `context.build` > `weather.fetch` + `daylight.calculate`, then `gen_ai.chat`
- [ ] * Confirm in Sentry (search spans/breadcrumbs for your city and coordinates) that no location appears
- [ ] Sentry Explore -> Agents view (or a note of what is missing)
- [ ] * Green GitHub Actions run link:
- [ ] `git log --oneline`
- [ ] LICENSE: replace `<YOUR NAME>`

## Measurements for Checkpoint 7 (only record what you actually measure)
| Metric | Value | How measured |
|---|---|---|
| Weather lookup latency (geocode + forecast) | NOT VERIFIED | |
| Context-build latency | NOT VERIFIED | |
| Gemma latency | NOT VERIFIED | |
| Total request latency | NOT VERIFIED | |
| Does weather lookup materially affect total latency? | NOT VERIFIED | |
| What happens at the 3 s weather budget | NOT VERIFIED | |

The Sentry spans `weather.fetch`, `execute_tool context.build`, `chat <model>` and the response fields
`meta.weatherLatencyMs`, `meta.contextLatencyMs`, `meta.modelLatencyMs`, `meta.durationMs` are the sources for this table.
