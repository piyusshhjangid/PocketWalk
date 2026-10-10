# 04 — Demo, proof package, article, judge Q&A

> **Historical planning document.** Written at Checkpoint 0 (6 Oct 2026), before any code existed, as planning notes for the challenge. The built product differs from it in places: for example, outdoor context only informs the walk and never refuses or delays one (there is no "window gate"), the model is called once with no repair retry, and the checkpoint plan was reorganised. It is kept for the record and does **not** describe the current project. For that, see the [README](../README.md), [architecture](architecture.md) and [API reference](api.md).

## Demos
- **30 s:** hook line → tap "20 min" → trace waterfall (agent → window tool → Gemma → validate) → "TTPD 9.4 s" (placeholder; real number later) → pocket → outside.
- **60 s:** + a rejected unsafe output visible as a span event + fallback fired by budget.
- **3 min:** + before/after p50/p95 chart, local vs hosted Gemma comparison, real walk footage, the one bug Sentry found.

## Proof package (what each proves)
| Evidence | Proves |
|--|--|
| Explore→Agents run screenshot | real agent spans, not a log |
| Trace waterfall of one run | tool, model, validation in one tree |
| p50/p95 latency before vs after | trace data drove a change |
| Token/cost columns (UNKNOWN until captured) | cost visibility |
| Rejection span event | guardrails are inspectable |
| Fallback-by-budget trace | latency budget is real |
| Debug story (bug → trace → fix commit) | "how you debugged it" |
| TTPD measurement | Touch Grass is operationalised |
| Public repo + CI run | technical execution |
| Real walk photo/notes | "took it outside" bonus (must be real) |
| Agent session (DevRelay and/or Entire) | process |

## Article (official template headings, DEV tags: devchallenge, hf26challenge)
- Title: concrete, e.g. "I measured how long my 'get off your phone' app kept me on my phone".
- What I Built → Demo → Code → How I Built It (window gate, Gemma, validator, budget, Sentry spans) → Why Does Open Innovation Matter? (swap Gemma sizes/providers, measure each; local option; no location sent to a closed model; cost) → My Agent Session → Prize Categories (Sentry; add others only with evidence).
- Inside How I Built It, include: what failed, what the trace showed, what I changed, limitations, real-world test.
- No marketing adjectives; every claim has a number or a screenshot or is labelled as a limitation.

## Judge questions (answers to be finalised with real data)
1. Why Sentry? — the category is about showing the agent's work; I needed per-stage latency and rejection visibility.
2. What if removed? — see remove-the-partner test; honest answer included in article.
3. Why not logs? — span tree ties tool, model and validator to one run and one TTPD.
4. Where exactly used? — `src/agent/*` spans, `@sentry/react` TTPD.
5. Can I reproduce? — `.env.example`, Fake adapter, steps in README.
6. Did you really use it? — screenshots with timestamps in window.
7. What did you learn? — from CP7 (real).
8. What bug did it expose? — from CP7 (real; do not invent).
9. Why is Gemma appropriate? — small structured task; small models suit it; swap tested.
10. Is it offline? — only the Ollama path, only if tested.
11. Is location private? — rounded, not stored, not in Sentry.
12. Is it safe? — allow-list + validator + disclaimer.
13. Why not a bigger app? — screen should be the shortest part.
14. What's original? — latency-as-screen-time + window gate.
15. Next? — more windows, voice (ElevenLabs), local-only mode.

## Hostile judge review (and the fixes already folded in)
- "Fake AI integration" → real Gemma call, adapter swap measured.
- "Fake Sentry integration" → real spans + real optimisation + real debug story.
- "Weak Touch Grass" → one-screen output, phone-down screen, return-by time, real walk.
- "Generic task generator" → window gate + TTPD + inspectable guardrails.
- "Poor writing" → budget 1 full day (Oct 10) for article, plus proofread pass Oct 11.
- "Unsupported claims" → numbers only from real runs; placeholders marked UNKNOWN.
- "Unnecessary features" → scope lock.
- "Started before window" → repo created Oct 6; commits after deadline noted in README.
