# 02 — 20 concepts (all targeting Sentry) and scoring

> **Historical planning document.** Written at Checkpoint 0 (6 Oct 2026), before any code existed, as planning notes for the challenge. The built product differs from it in places: for example, outdoor context only informs the walk and never refuses or delays one (there is no "window gate"), the model is called once with no repair retry, and the checkpoint plan was reorganised. It is kept for the record and does **not** describe the current project. For that, see the [README](../README.md), [architecture](architecture.md) and [API reference](api.md).

Hard filter applied: rejected anything that is only 'AI recommends outdoor tasks', 'AI identifies things', or 'uses voice/Gemma'. A concept must be a *workflow*.

Weights: CatFit 15, TG 10, OpenAI 10, PartnerNeed 15, Demo 10, Speed 10, Reliab 10, Orig 5, Writing 5, Portfolio 5, Diff 5. Scores are my judgement (INFERENCE).

| Rank | Concept | CatFit | TG | OpenAI | PartnerNeed | Demo | Speed | Reliab | Orig | Writing | Portfolio | Diff | **Weighted** |
|--|--|--|--|--|--|--|--|--|--|--|--|--|--|
| 1 | PocketWalk (latency = screen time; window-gated 15-min walk) | 9 | 9 | 8 | 9 | 8 | 8 | 8 | 7 | 9 | 7 | 7 | **8.30** |
| 2 | Golden Hour Gate (refuses/delays when weather+daylight window is poor) | 8 | 8 | 8 | 8 | 7 | 8 | 8 | 7 | 7 | 6 | 7 | **7.65** |
| 3 | Cloud Notebook (sky-watching prompts from cloud-cover data) | 7 | 9 | 7 | 7 | 7 | 7 | 7 | 8 | 8 | 5 | 7 | **7.20** |
| 4 | Guardrail Walk (red-team harness vs. walk generator) | 8 | 5 | 8 | 8 | 6 | 6 | 7 | 7 | 7 | 7 | 6 | **6.95** |
| 5 | Stoop Hour (balcony/stoop sun-angle micro-session) | 7 | 8 | 7 | 7 | 7 | 6 | 6 | 8 | 7 | 5 | 7 | **6.85** |
| 6 | Rain Window Runner (find dry 20-min windows) | 7 | 8 | 7 | 7 | 7 | 7 | 6 | 6 | 6 | 6 | 6 | **6.80** |
| 7 | Sunset Chaser (be at open sky at golden hour) | 7 | 8 | 7 | 7 | 7 | 7 | 7 | 5 | 6 | 5 | 5 | **6.75** |
| 8 | Weather-Proof Plan B (outdoor + covered-outdoor) | 7 | 7 | 7 | 7 | 6 | 7 | 7 | 5 | 6 | 5 | 5 | **6.55** |
| 9 | Phone-Down Pact (time-boxed pledge) | 6 | 8 | 6 | 6 | 6 | 7 | 7 | 5 | 6 | 4 | 4 | **6.15** |
| 10 | Night Sky Planner | 6 | 8 | 7 | 6 | 6 | 5 | 5 | 6 | 6 | 5 | 5 | **6.00** |
| 11 | Bench Break (5-min outdoor micro-break for desk workers) | 6 | 7 | 7 | 6 | 6 | 5 | 5 | 5 | 6 | 5 | 5 | **5.85** |
| 12 | Listening Walk (soundscape) | 5 | 8 | 7 | 5 | 5 | 6 | 6 | 7 | 6 | 4 | 5 | **5.80** |
| 13 | Leaf Ledger (neighbourhood noticing checklist) | 5 | 8 | 7 | 5 | 5 | 7 | 7 | 4 | 5 | 4 | 3 | **5.70** |
| 14 | Walk Debrief (dictated field note) | 6 | 5 | 7 | 6 | 5 | 6 | 6 | 5 | 5 | 4 | 4 | **5.60** |
| 15 | Trailhead Briefing Auditor (summarise park alerts) | 6 | 6 | 7 | 6 | 5 | 5 | 5 | 5 | 5 | 5 | 5 | **5.60** |
| 16 | Season Spotter (frost/foliage checklist) | 5 | 8 | 7 | 5 | 5 | 7 | 7 | 3 | 5 | 4 | 2 | **5.60** |
| 17 | Kid Scavenger Builder (privacy/safety heavy) | 5 | 8 | 7 | 5 | 6 | 6 | 5 | 4 | 6 | 5 | 3 | **5.60** |
| 18 | Neighbour Noticing (photo notes) | 5 | 8 | 7 | 5 | 6 | 4 | 4 | 6 | 6 | 5 | 5 | **5.50** |
| 19 | Dog-walk Variety Agent | 4 | 7 | 6 | 4 | 5 | 7 | 7 | 4 | 5 | 4 | 3 | **5.20** |
| 20 | Commute Detour (needs maps) | 5 | 7 | 6 | 5 | 5 | 3 | 3 | 5 | 5 | 5 | 4 | **4.85** |
## Top 5 competitiveness (STRATEGIC ESTIMATE — not a win probability; uncertainty is large because competitor counts are UNKNOWN)

| Project | P1 MVP | P2 Partner works | P3 Judge gets it | P4 Memorable demo | P5 Original | P6 Article | P7 Touch Grass | P8 Partner essential | **Competitiveness index** |
|--|--|--|--|--|--|--|--|--|--|
| PocketWalk | 0.80 | 0.80 | 0.65 | 0.60 | 0.55 | 0.65 | 0.85 | 0.60 | **0.69** |
| Golden Hour Gate | 0.80 | 0.80 | 0.60 | 0.50 | 0.50 | 0.55 | 0.85 | 0.60 | **0.66** |
| Cloud Notebook | 0.75 | 0.80 | 0.55 | 0.55 | 0.65 | 0.60 | 0.90 | 0.50 | **0.67** |
| Stoop Hour | 0.70 | 0.75 | 0.55 | 0.55 | 0.65 | 0.55 | 0.85 | 0.50 | **0.64** |
| Rain Window Runner | 0.70 | 0.70 | 0.55 | 0.55 | 0.50 | 0.50 | 0.85 | 0.55 | **0.61** |

## Top 2 head-to-head
- **PocketWalk**: one tap → tool-grounded window check → Gemma composes a 3-step walk → validator → "Phone down, back by 5:42". Headline metric TTPD (time-to-phone-down) gives the Sentry data a *reason to exist*.
- **Golden Hour Gate**: cleverer refusal behaviour, but weaker headline and demo.
- **Decision:** PocketWalk, and absorb the Gate as a feature (if the window is bad, it tells you when the next good one is — and the trace shows why).

## Why not the others
Cloud Notebook has the best originality but Sentry isn't needed by it; Guardrail Walk is a great *article* but weak Touch Grass; Stoop Hour / Rain Window Runner are feature variants of PocketWalk's gate.
