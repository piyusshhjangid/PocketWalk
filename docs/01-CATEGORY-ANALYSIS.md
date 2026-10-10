# 01 — Category analysis

> **Historical planning document.** Written at Checkpoint 0 (6 Oct 2026), before any code existed, as planning notes for the challenge. The built product differs from it in places: for example, outdoor context only informs the walk and never refuses or delays one (there is no "window gate"), the model is called once with no repair retry, and the checkpoint plan was reorganised. It is kept for the record and does **not** describe the current project. For that, see the [README](../README.md), [architecture](architecture.md) and [API reference](api.md).

Scores are STRATEGIC ESTIMATES (1–10 each; Opportunity Score = mean of 10 criteria). Not probabilities. Only Sentry's docs were read; others rest on the one-line official briefs, so treat their rows as lower-confidence.

| Rank | Category | Impl | Integ | Demo | Proof | TG | Open | Deadline | Reliab | Diff | Story | **Score** | Risk |
|--|--|--|--|--|--|--|--|--|--|--|--|--|--|
| 1 | Sentry Agent Tracing | 8 | 8 | 8 | 10 | 6 | 7 | 8 | 8 | 7 | 8 | **7.8** | GREEN |
| 2 | ElevenLabs | 6 | 7 | 9 | 7 | 10 | 6 | 6 | 5 | 5 | 8 | **6.9** | YELLOW |
| 3 | SerpApi | 8 | 8 | 6 | 6 | 7 | 6 | 8 | 6 | 5 | 6 | **6.6** | GREEN-YELLOW |
| 4 | Entire | 9 | 8 | 5 | 7 | 5 | 5 | 9 | 8 | 4 | 6 | **6.6** | GREEN (co-entry only) |
| 5 | Mastra | 6 | 6 | 5 | 5 | 6 | 8 | 6 | 6 | 5 | 6 | **5.9** | YELLOW |
| 6 | GitHub Copilot | 7 | 6 | 5 | 7 | 5 | 5 | 7 | 7 | 3 | 5 | **5.7** | YELLOW (crowded) |
| 7 | MongoDB Atlas | 7 | 7 | 4 | 5 | 5 | 6 | 7 | 7 | 4 | 5 | **5.7** | YELLOW |
| 8 | Backboard | 6 | 5 | 5 | 5 | 5 | 7 | 6 | 5 | 5 | 5 | **5.4** | YELLOW (docs unread) |
| 9 | Temporal | 4 | 4 | 6 | 7 | 5 | 6 | 4 | 5 | 6 | 6 | **5.3** | RED |
| 10 | Tiger Data | 6 | 6 | 4 | 5 | 5 | 6 | 6 | 6 | 4 | 5 | **5.3** | YELLOW |

Criteria: Impl simplicity, Integration clarity, Demo clarity, Proofability, Touch-Grass fit, Open-AI fit, Deadline feasibility, Reliability, Differentiation, Prize-story strength.

## Per-category verdict
- **Sentry (GREEN, pick A).** The brief asks for *evidence in the write-up* (traces, latency, tokens, cost, debugging story) — exactly what a strong writer can produce in 5 days. Integration = SDK + manual spans. Proof = dashboard screenshots. Risk: looking bolted-on; fixed by making the trace data drive a real optimisation story.
  Remove-Sentry test: app still works, but the project loses its measurement spine and guardrail audit trail. Honest: this is an evidence category, so "essential" means "the evidence layer".
- **ElevenLabs (YELLOW, pick C / backup).** Best natural fit for "screen is shortest part", but obvious ⇒ probably crowded (INFERENCE). Mic permissions, mobile audio autoplay rules and latency add demo risk. ElevenLabs is a closed API, so open-weight must be Gemma, not the voice.
- **Entire (co-entry only, pick B for effort).** Near-zero engineering (share agent sessions in the write-up) but judges see process, not product. Use only if you genuinely use it; never the primary strategy.
- **SerpApi (GREEN-YELLOW).** Easy, but fresh web search isn't *necessary* for a walk; weather/daylight come from better, free structured sources. Fails the "is fresh info genuinely needed" test.
- **Mastra (YELLOW).** Would be Frontend→Mastra→LLM→answer unless a real workflow exists. Sentry has a native Mastra exporter, so it's a possible later add — not now.
- **GitHub Copilot (YELLOW).** "I used Copilot" is claimable by almost everyone (INFERENCE: crowded). Needs issue→agent PR→review→CI evidence trail.
- **MongoDB / Tiger Data (YELLOW).** No real data problem in a stateless walk app; adding vector search would be prize-farming.
- **Backboard (YELLOW).** Memory/RAG/R-CLI; docs unread; a walk app doesn't need memory. Revisit only if docs show something that fits.
- **Temporal (RED).** Durable workflows for a 3-second request would be forced.

## Top 3
- **A — Sentry Agent Tracing.** Winning angle: *"We use Sentry not as an add-on but as the instrument that measures — and shrinks — how many seconds our AI keeps you staring at your phone before you walk out the door."* Judge proof: Explore→Agents run trace (agent → weather tool → Gemma call → validation → fallback), p50/p95 latency chart before vs after, token/cost columns, one debugged failure.
- **B — Entire (effort ratio).** Optional co-entry: embedded agent session. Judge proof: session link.
- **C — ElevenLabs (backup).** Winning angle: *"The voice reads the three steps so the phone can go in the pocket."* Adds a thin VoiceAdapter; also traced in Sentry.

## Optional free co-entries (only if truthful)
Gemma (featured, $200) if Gemma is truly the model; Render or DigitalOcean (featured) if you truly host there; Entire/Copilot if truly used. Winning counts once, so co-entry costs nothing but narrative focus — list only ones you can evidence.
