# 05 — Checkpoints (small gaps) and your prerequisites

> **Historical planning document.** Written at Checkpoint 0 (6 Oct 2026), before any code existed, as planning notes for the challenge. The built product differs from it in places: for example, outdoor context only informs the walk and never refuses or delays one (there is no "window gate"), the model is called once with no repair retry, and the checkpoint plan was reorganised. It is kept for the record and does **not** describe the current project. For that, see the [README](../README.md), [architecture](architecture.md) and [API reference](api.md).

Each checkpoint ends with a runnable/zip-able state and a gate. Dates are IST.

| CP | When | Deliverable | Gate |
|--|--|--|--|
| 0 | Oct 6 | This planning zip | You approve the category & project |
| 1 | Oct 6 eve | Repo scaffold, CI, hello-world traced run in Sentry | Span visible in Explore→Agents |
| 2 | Oct 7 am | Model adapter (Gemma hosted + Fake), strict JSON | Valid JSON from real Gemma; latency logged |
| 3 | Oct 7 pm | Window gate tool (sunset + weather) | Unit tests; bad-window reply works |
| 4 | Oct 7 eve | Validator + safety + fallback bank | Malformed/unsafe tests pass |
| 5 | Oct 8 am | API vertical slice, all spans nested | Full trace tree in Sentry |
| 6 | Oct 8 pm | React one-screen UI + phone-down screen | Works one-handed on phone; **backup decision at noon** |
| 7 | Oct 9 am | TTPD instrumentation, latency budget, optimisation loop | Real before/after numbers |
| 8 | Oct 9 pm | Tests, E2E, security pass, deploy | CI green, live URL |
| 9 | Oct 10 am | Real outdoor test + evidence capture | Photos, screenshots, notes |
| 10 | Oct 10 pm | README, docs, demo video, article draft | Complete draft |
| 11 | Oct 11 | Proofread, rules recheck, submit by 8 PM IST | Post published |

## Issue list (GitHub)
#1 Product & plan · #2 Sentry spike · #3 Model adapter · #4 Window gate · #5 Validator/safety · #6 Fallback & budget · #7 API slice · #8 UI · #9 TTPD & optimisation · #10 Tests/CI · #11 Docs · #12 Demo · #13 Submission.
Commit style: `feat(agent): add window gate span`, never "final".

## What I need from you before CP1
1. Create a free Sentry account + a Node project; keep the DSN handy (never paste it in public).
2. Get a Gemma-capable API key from your chosen provider (Google AI Studio is the likeliest) and claim partner credits at hacktoberfest.com/my/promos.
3. Create an empty **public** GitHub repo today (must start inside the window).
4. Tell me your Node version and whether you can run Ollama locally.
5. Optional: an Entire / DevRelay account if you want the session embedded.
