# Checkpoint 4: Structured AI + Safety

> **PocketWalk uses AI for activity generation, but deterministic application-level validation and safety rules remain authoritative.**
> AI proposes. The application validates. The application can reject. The fallback provides a deterministic alternative.

## Objective
Never trust model output because it is valid JSON. Add the deterministic layer that protects the product, without
rewriting what Checkpoint 3 built.

## What was built
```text
USER INPUT -> VALIDATION -> OUTDOOR CONTEXT -> GEMMA -> unknown text
  -> PARSE -> SCHEMA -> REPAIR (harmless only) -> BUSINESS RULES -> SAFETY RULES -> SAFE WALKPLAN
any rejection -> FALLBACK -> same business + safety rules -> (fail) fixed EMERGENCY plan
```
- **`src/safety/`**: `SafetyEngine.validate(plan, context, request)`. Pure, deterministic, knows no model/provider/Sentry (a test checks the imports). Only rejects; never rewrites.
- **Schema** (`planSchema.ts`): the CP3 shape, hardened: bounded strings, integer minutes 1 to 40, exactly 3 steps, optional validated `intensity`, unknown keys stripped and reported.
- **Business rules** (`businessRules.ts`): duration must equal the request, no step longer than the walk, no step under 10%, 14-word limit, no empty text, no markup/links, Latin/common script only, 600-character total.
- **Safety rules** (`rules.ts`): lexicon, proximity and whole-plan rules in 15 categories; context rules from the CP3 guidance codes (poor conditions, wet, wind, heat, cold, dark, low visibility, fog).
- **Repair vs rejection**: only whitespace, invisible characters, markdown and unknown keys are repaired, and every repair is reported. Everything else is rejected.
- **Fallback**: held to the same rules. If it ever fails them, `emergencyPlan` is served and labelled.
- **Truthful response**: `meta.planner` is `model` only if every layer passed. New `meta.validation` (stage statuses, `repaired`, `repairs`), `fallbackSource`, a fixed `message`, and real latencies present only when that step ran.
- **Sentry**: `pocketwalk.validate` now has one span per stage (parse, schema, repair, business, safety) plus `fallback_validate`; the agent span carries the failure stage, failure codes and validation statuses. Closed-set ids only.

## Repair vs rejection
| Repairable | Rejected |
|---|---|
| zero-width/control characters, markdown emphasis/bullets, whitespace runs, unknown keys | wrong duration, wrong step count, over-long wording, empty text, markup/links, unexpected scripts, any safety violation, unparseable or oversize output |

## Prompt injection
The only free text a client controls is `location.city`. It is validated, used for one weather lookup, and never enters the prompt;
unknown request keys are ignored. The prompt separates rules from data. If the model is manipulated anyway, instruction-override
language in its output is rejected and every hazard category is still enforced by code. Tested over HTTP in both directions.

## Privacy
No new data is collected, stored or sent: no accounts, no GPS, no history. Telemetry holds closed-set ids, statuses, numbers
and booleans. Never plan text, model output, the prompt, the city or coordinates (asserted against everything a recording Sentry
transport would send).

## Tests
381 passing in 16 files (193 CP3 unchanged + 188 new), no network. Plus a sweep of 1,536 checks (fallback and emergency plans x 128
guidance combinations x 3 durations x 2 energies), and a mutation check showing the suite fails when any layer is removed (see evidence).

## Known limitations (read these)
1. **Rule-based and English-only.** It matches words and phrases; it does not understand meaning. A hazard phrased in words the rules do not know can pass. Obfuscation handling (accents, zero-width, spacing, simple leetspeak, spaced letters, look-alike scripts rejected) raises the bar; it is not a defence against a determined adversary.
2. **Conservative, so it will have false positives** (e.g. "never cross the road", "close your eyes", any mention of "street", "water", "park" after dark). A false positive costs one deterministic fallback walk. **The real rejection rate of Gemma's output is not measured**; it could be high enough to make the AI path rare. Checkpoint 7 must measure it.
3. **Context rules rest on CP3's guidance bands**, which are product choices, not medical or meteorological thresholds. No new thresholds were invented.
4. **It knows nothing about the person's real surroundings.** It filters what a plan *says*. It is basic application-level filtering, not a safety certification, not medical advice, not navigation, and no replacement for the person's judgment and local knowledge.
5. **No repair retry.** There is no second model call; a rejection goes straight to the fallback.
6. **Fallback planner crash is still a 500** (CP3 behaviour, covered by a test). The emergency plan covers *validation* failure, not a thrown exception.
7. The emergency plan is verified by tests, not re-validated at runtime.
8. `intensity` is accepted from a model only defensively; the application owns intensity.
9. Not verified: live Gemma, live Open-Meteo, a GitHub Actions run, delivery to a real Sentry project, Sentry Explore -> Agents rendering, and any real latency.

## Next
Checkpoint 5: PocketWalk Frontend (not started).
