# 00 — Verified facts (checked Oct 6, 2026)

> **Historical planning document.** Written at Checkpoint 0 (6 Oct 2026), before any code existed, as planning notes for the challenge. The built product differs from it in places: for example, outdoor context only informs the walk and never refuses or delays one (there is no "window gate"), the model is called once with no repair retry, and the checkpoint plan was reorganised. It is kept for the record and does **not** describe the current project. For that, see the [README](../README.md), [architecture](architecture.md) and [API reference](api.md).

Labels: VERIFIED = read on an official page today. INFERENCE = my reasoning. UNKNOWN = not checked.

## Challenge (VERIFIED — dev.to/devteam announcement + dev.to/challenges/hf26)
- Week 1 theme "Touch Grass": open-weight models / open-source AI that gets people off the screen and into the world. "The best builds make the screen the shortest part of the experience."
- Prizes: 1 overall $250 (+DEV++); 6 featured categories $200; **10 partner categories $100** (17 winners, $2,450).
- Your 10 $100 categories match the official list exactly: Backboard, ElevenLabs, Entire, GitHub Copilot, Mastra, MongoDB Atlas, Sentry Agent Tracing, SerpApi, Temporal, Tiger Data.
- Featured ($200, NOT your target): Render, TabPFN, Tinker, Arduino, DigitalOcean, **Gemma**.
- Judging order: Writing Quality (most weight) > Relevance to theme > Creativity > Technical execution > Partner-tech use (optional).
- Deadline: **Oct 11, 11:59 PM PDT = Oct 12, 06:59 UTC = Oct 12, 12:29 PM IST.** Organisers confirmed everyone submits by their own local time reading of that deadline. INFERENCE: treat Oct 11, 8 PM IST as your real deadline.
- Submission = a DEV post tagged `devchallenge, hf26challenge`, using the official template (What I Built / Demo / Code / How I Built It / Why Does Open Innovation Matter? / My Agent Session (optional) / Prize Categories).
- You opt into a partner category by *listing it in the Prize Categories section* and genuinely using the tech. One project may enter several categories; you can win only once per challenge.
- Rules that bite: project must be **new and started inside the window** (commits after deadline must be noted in README); 18+; English only for prize eligibility; teams ≤ 4; plagiarism disqualifies; AI assistance is allowed.
- Partner credits (Tinker, Render, Backboard, ElevenLabs): hacktoberfest.com/my/promos.
- "Bonus points if you take it outside, use it, and tell us how it went."
- DEV's own tip: partner winners come from a smaller pool.

## Sentry Agent Tracing (VERIFIED — docs.sentry.io)
- Agent Tracing is GA. Captures model calls, tool executions, handoffs, token usage, cost as spans in normal traces; Conversations via `gen_ai.conversation.id`; agent name via `gen_ai.agent.name`.
- Node.js agent-tracing guide + manual instrumentation guide exist; Vercel AI SDK usage tracked; privacy controls exist; data visible under Explore → Agents.
- Category brief: "Show your agent's work: how it's set up, how it performs (latency, tokens, cost), what you found, and how you debugged it. Include traces or screenshots in your write-up."

## UNKNOWN (must check at the listed checkpoint)
- Number of submissions per category (not visible). Competition per category = UNKNOWN.
- Exact span ops/attributes for manual instrumentation → CP1.
- Current Gemma model IDs/quotas on the provider you pick → CP2.
- Open-Meteo free-use terms for a public demo → CP3.
- Whether Entire supports your coding agent → only matters for optional co-entry.
- What other submissions exist: I saw Gemma "task generator" projects (Grass Ticket, Out There, Touch Grass Sports AI, AeroGemma) and an offline bird-call identifier. **Plain "Gemma generates 3 outdoor tasks" is saturated — do not build that.**
