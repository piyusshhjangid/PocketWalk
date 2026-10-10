# PocketWalk Checkpoint 2

## Objective
Replace the placeholder planner with a real Gemma (open-weight) workflow: prompt -> model -> structured output ->
validation -> safe response, with timeout, failure handling, fallback, and Sentry tracing.

## Previous checkpoint
Checkpoint 1 (`pocketwalk-checkpoint1.zip`). Re-verified from a clean `npm ci` before any change: typecheck PASS,
9/9 tests PASS, build PASS. The ZIP had no `.git`; CI and real-Sentry delivery were never verified (open from CP1).

## What changed
- Real model path: `GemmaPlanner` over a `ModelClient` (hosted Google Gemma or local Ollama).
- Strict validation of model output (parse -> Zod schema -> business rules).
- Closed set of failure reasons; timeout enforced with an abortable budget.
- Deterministic `FallbackPlanner`, always labelled `fallback`; `WalkService` decides model vs fallback.
- Honest response metadata (`planner`, `provider`, `model`, `fallbackReason`, `modelLatencyMs`, `durationMs`).
- Sentry: `gen_ai.chat` model span, `pocketwalk.validate`, `pocketwalk.fallback`, `pocketwalk.fallback*` attributes.
- `npm run smoke:gemma` for a real one-shot provider check.

## Why it changed
So Gemma actually produces the walk, and nothing the model says reaches the user unless it passes validation.

## Architecture changes
See `docs/architecture.md`. New seam: `WalkPlanner` (kind `model` | `fallback`) + `ModelClient` transport.

## Files added
`src/ai/{errors,modelClient,googleGemmaClient,ollamaGemmaClient,prompt,planValidation,gemmaPlanner,fallbackPlanner,createPlanner}.ts`,
`scripts/smokeGemma.ts`,
`tests/{env,httpIntegration,modelClients,sentry}.test.ts`, `tests/helpers/fakeModel.ts`,
`docs/checkpoints/checkpoint-2-{summary,manifest,evidence}.md`

## Files modified
`src/ai/walkPlanner.ts`, `src/app.ts`, `src/server.ts`, `src/config/env.ts`, `src/observability/tracing.ts`,
`src/services/walkService.ts`, `tests/walk.test.ts`, `tsconfig.json` (include `scripts/`), `package.json` (version 0.2.0,
`smoke:gemma` script), `package-lock.json` (version only), `.env.example`, `README.md`, `docs/architecture.md`,
`docs/development-log.md`, `docs/ai-assistance-log.md`

## Files removed
`src/ai/placeholderPlanner.ts` (replaced by `fallbackPlanner.ts`)

## Dependencies added
None. Uses Node's built-in `fetch` and `AbortController`. (An SDK was considered and rejected: one HTTP call does not
justify the weight or maintenance.)

## Dependencies removed
None.

## Tests added
46 new tests (9 -> 55): scripted-model API tests, validator rules (malformed/truncated/missing/wrong-type/wrong-count/
minutes-sum/too-long), timeout + abort, unexpected crash, no-model-configured, request validation, both adapters with
injected `fetch`, both adapters over real HTTP (incl. slow server), env validation, Sentry span tree + privacy.

## Tests executed
`npm test`: 6 files, 55 tests, all passing, no network. `npm run typecheck`, `npm run build`: clean.
Compiled-server smoke runs: no provider (fallback, `not_configured`); `google` without key (fails fast with readable
message); `ollama` at a refused port (fallback, `unavailable`).
`npm audit`: 0 vulnerabilities (run 2026-10-07).

## Results
| Spec test | Result |
|---|---|
| 1 Valid request -> valid AI plan | PASS (scripted model + real HTTP to local imitation server) |
| 2 Malformed AI output -> rejected | PASS |
| 3 Missing field -> rejected | PASS |
| 4 Model failure -> fallback | PASS |
| 5 Model timeout -> controlled response | PASS |
| 6 Invalid request -> 4xx | PASS |
| 7 Sentry instrumentation does not break behaviour | PASS (real SDK, no-op transport) |

## Security changes
API key only via env, sent in a header (not URL), never logged or printed; env errors print paths not values; prompt has
no user free text; client-visible failure info is a closed enum; model text/prompt never attached to spans or responses;
raw model output capped at 4000 chars before parsing.

## Sentry changes
New spans `gen_ai.chat`, `pocketwalk.validate`, `pocketwalk.fallback`; agent span attributes `pocketwalk.fallback`,
`pocketwalk.fallback_reason`; token usage attributes when the provider returns them. Prompt/output not recorded.

## AI changes
Gemma prompt (`src/ai/prompt.ts`), two provider clients, parse/validate pipeline. Model: `gemma-4-26b-a4b-it` default
for hosted (id from Google's docs, read 2026-10-07); no default for Ollama.

## Documentation changes
README, architecture, `.env.example`, development log, AI-assistance log, this summary/manifest/evidence.

## Known limitations
- **No live Gemma call has been made.** Adapters are verified against local imitations of the wire formats only.
  Gemma-on-Gemini-API specifics (e.g. thinking parts, safety blocks, quotas) are handled defensively but unconfirmed.
- Only two context inputs, so plans are generic until CP3.
- Safety rules (content filtering) and repair-retry are CP4; current validation is shape + business rules only.
- 15 s timeout is an unmeasured placeholder (CP7).
- No rate limiting yet (a public endpoint that calls a paid/quota-limited model needs it before deployment).
- Planning doc `docs/05-CHECKPOINTS.md` uses an older checkpoint numbering than the master prompt; not edited.

## Problems encountered
Timeout/abort race (found by a test, fixed); Sentry v11 span JSON shape; stale `dist/` in a baseline build; see development log.

## Decisions made
See `docs/development-log.md` (Decisions).

## Evidence required from user
See `docs/checkpoints/checkpoint-2-evidence.md`.

## Definition of Done
| Item | Status |
|---|---|
| Gemma is actually integrated (adapter + provider wiring) | PASS (code); live call NOT VERIFIED |
| Gemma performs a meaningful task (composes the walk) | PASS by design; quality with real model NOT VERIFIED |
| AI adapter exists | PASS |
| AI output is structured | PASS |
| Output is validated | PASS |
| Invalid output handled | PASS |
| Timeout handled | PASS |
| Model failure handled | PASS |
| Fallback exists | PASS |
| Sentry traces the AI workflow | PASS locally; delivery to real Sentry NOT VERIFIED |
| No secrets committed/packaged | PASS (checked on clean extraction) |
| Tests pass | PASS (55/55) |
| Typecheck passes | PASS |
| Build passes | PASS |
| CI passes | NOT VERIFIED (needs GitHub push) |
| Documentation updated | PASS |
| Development log updated | PASS |
| Checkpoint summary exists | PASS |
| Checkpoint manifest exists | PASS |
| Clean ZIP extraction succeeds | PASS (see final report) |

## Completed items
Everything marked PASS above.

## Remaining items
Live Gemma verification (`npm run smoke:gemma`), push to GitHub + green CI, real Sentry trace screenshots, fill LICENSE name.

## Next checkpoint
Checkpoint 3 — Outdoor Context Engine. Do not start until approved.
