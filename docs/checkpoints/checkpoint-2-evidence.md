# Checkpoint 2 — Evidence checklist

Capture real artifacts only. Do not edit or fabricate. Items marked * are what turns "NOT VERIFIED" into "PASS".

- [ ] * `npm run smoke:gemma` output with `GEMMA_PROVIDER=google` and your own key (shows latency, tokens, validated plan, or failure reason)
- [ ] (optional) same with `GEMMA_PROVIDER=ollama` and your local model tag
- [ ] * Terminal: `npm run dev` with the provider set, then a `curl` to `/walks/plan` showing `"planner": "model"`
- [ ] A `curl` with a deliberately wrong key or tiny `GEMMA_TIMEOUT_MS=500` showing `"planner": "fallback"` and its reason
- [ ] `npm test` output (55 passing)
- [ ] * Green GitHub Actions run link:
- [ ] * Sentry screenshot: trace waterfall for `POST /walks/plan` showing `gen_ai.chat`
- [ ] Sentry Explore -> Agents view (or a note of what is missing)
- [ ] `git log --oneline`
- [ ] LICENSE: replace `<YOUR NAME>`
