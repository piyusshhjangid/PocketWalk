# Contributing to PocketWalk

Thanks for helping. PocketWalk is deliberately small, so the best contributions are focused, tested and honest about what they verify. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## What fits (and what does not)
Good fits: bug fixes, tests, clearer docs, accessibility fixes, safety-rule improvements (with tests), provider robustness, small quality-of-life changes to the existing flow.

PocketWalk is **intentionally not** a platform. These are out of scope, so please do not open pull requests for them: accounts or authentication, a database or walk history, GPS or maps, fitness tracking, gamification, social features, voice, notifications, Wake Lock, analytics, or extra services. If you are unsure, open an issue first and describe the problem you want to solve.

## Prerequisites
- Node.js 20 or newer (CI and the Docker image use 22) and npm
- Git
- Optional: Python 3 with Playwright (`pip install playwright && playwright install chromium`) for the browser scripts; Docker for the image
- You do **not** need any API key to develop or run the tests

## Set up
```bash
git clone <your fork> pocketwalk && cd pocketwalk
npm ci && npm run frontend:install
cp .env.example .env              # safe defaults: no model, so every walk is the deterministic fallback
npm run dev                       # API on :3000
npm run frontend:dev              # app on :5173 (second terminal)
```
To try a real model, set `GEMMA_PROVIDER=google` plus your own `GEMINI_API_KEY`, or `GEMMA_PROVIDER=ollama` plus `GEMMA_MODEL`. See the README for details. `.env` is git-ignored: keep it that way.

## Before you open a pull request
Run what CI runs, plus the docs check. All of it works offline:
```bash
npm run typecheck && npm test && npm run build
npm run frontend:typecheck && npm run frontend:test && npm run frontend:build
npm run check:bundle              # after the frontend build: no secrets or dev hosts in the browser bundle
npm run check:docs                # Markdown links and anchors resolve
npm audit && (cd frontend && npm audit)
```
Browser scripts are optional but welcome for UI changes (they need Playwright and a running server; see the commands in the README and the docstring at the top of each script in `scripts/browser/`).

### Where things live
| Path | What |
|---|---|
| `src/ai/` | prompt, model clients, parsing, schema, repair, business rules, fallback |
| `src/safety/` | deterministic safety rules |
| `src/context/` | weather lookup, daylight, normalisation |
| `src/services/`, `src/controllers/`, `src/middleware/`, `src/lifecycle/` | request pipeline, limits, deadline, readiness, shutdown |
| `src/observability/` | Sentry setup, spans, privacy scrubbers |
| `tests/`, `frontend/tests/` | backend and frontend tests (fakes in `tests/helpers/`) |
| `frontend/src/` | the React app; its only knowledge of the backend is `src/api/walkApi.ts` |
| `docs/` | API, architecture, logs, per-checkpoint evidence |

## Pull requests
- **One concern per pull request**, branched from `main` with a descriptive name (`fix/city-parsing`, `docs/api-errors`). Keep the diff reviewable.
- **Add or update tests** for behaviour you change. Prefer deterministic tests: injected fakes, controlled promises and fake clocks rather than sleeps, and never a live provider or a paid call. A fix for a bug should include a test that fails without it.
- **Do not weaken** a safety rule, a validation step, a privacy protection or an existing test to make something pass. If a rule is wrong, change it deliberately, explain why in the pull request, and add a test for the new behaviour.
- **Update the docs** your change makes untrue (README, `docs/api.md`, `docs/architecture.md`). `npm run check:docs` catches broken links.
- **Be exact about verification.** Say what you ran and what you did not. Do not claim that something was tested live, deployed, or measured unless it was, and do not add numbers you did not measure.
- Keep dependencies to a minimum; explain any new one.
- Fill in the pull request template. Maintainers may ask for changes; please do not take it personally, and we will try to be kind in return.

## Reporting bugs
Use the **Bug report** issue template: what you did, what you expected, what happened, which provider and mode (`planner: model` or `fallback`), and your environment. Please **do not paste** API keys, `.env` contents, Sentry DSNs, or real locations. Redact them. For a security or privacy problem (for example a way to make a secret, prompt or city appear in logs or traces), do **not** open a public issue: follow [`SECURITY.md`](SECURITY.md).

## Keeping secrets out of the repository
- Never commit `.env`, API keys, tokens, DSNs or private keys. `.gitignore` excludes `.env` and `.env.*` (but keeps `.env.example`). `.env.example` files hold only blanks and non-secret defaults.
- Tests use **obviously fake** values (for example `FAKE-KEY-SENTINEL`) to prove nothing leaks. Keep them fake: never put a real credential in a test, a fixture, a screenshot or a log excerpt.
- Check what you are about to commit: `git diff --cached`. A secret scanner such as gitleaks is a good extra habit (not required, not configured here).
- If you commit a secret by accident, treat it as leaked: revoke or rotate it at the provider first, then remove it from the history.
- Frontend `VITE_*` variables are bundled into public JavaScript. Never put anything secret in them; `npm run check:bundle` guards the built bundle.

## AI-assisted contributions
AI tools are welcome, and this project was itself built with AI assistance (see [`docs/ai-assistance-log.md`](docs/ai-assistance-log.md), which records what was accepted, rejected and corrected). The standard is the same as for any code: **you** are responsible for every line you submit.
- Read and understand all generated code and text before you open the pull request. If you cannot explain it, do not submit it.
- Run the checks above yourself. Generated tests that always pass prove nothing: try breaking the code and confirm the test fails.
- Verify claims. AI tools invent APIs, options, versions, measurements and test results. Check them, and do not copy fabricated numbers or "verified" statements into code or docs.
- Do not let a tool weaken safety rules, validation, privacy scrubbing or tests to get a green run. Review diffs for that specifically.
- Do not paste secrets, private data or real user locations into AI tools or into prompts that end up in the repository.
- Disclose meaningful AI assistance in the pull request description (a sentence is enough). It is not penalised; it helps reviewers know where to look hard.
- Respect licences: do not submit generated code you suspect is copied from an incompatible source.

## License
By contributing you agree that your contributions are licensed under the project's [MIT License](LICENSE).
