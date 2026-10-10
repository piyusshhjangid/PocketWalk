# Checkpoint 10 evidence

## Environment
Linux sandbox, one CPU, Node 22, no Docker, no GitHub access, headless Chromium via Playwright for Python (not a project dependency). Web access was used once, to fetch the official Contributor Covenant 2.1 text.

## Baseline (CP9 ZIP, reproduced before editing)
Backend typecheck clean, 611 tests. Frontend typecheck clean, 151 tests. `npm audit` 0 vulnerabilities (both). Matches the CP9 report. The CP9 browser counts were re-run on the final tree (below).

## 1. README and presentation
The README was rewritten from a 240-line per-checkpoint changelog (headed "Checkpoint 6") to 127 lines. Every claim was checked against the repository: the `.env.example` defaults (`GEMMA_PROVIDER=none`, `WEATHER_PROVIDER=open-meteo`), the script names, the ports (3000 API, 5173 app), the safety categories, the provider table, and the stack. One unsupported phrase ("three-tap flow") was removed. The README does not claim a live deployment, real Sentry ingestion, live Gemma measurements or a CI run; its verification table lists **Externally verified: nothing**.

### Can a new contributor answer the questions quickly?
| Question | Where it is answered |
|---|---|
| What does PocketWalk do? | README top, "Why it exists", "Features" |
| How do I run it locally? | README "Run it locally" (no API key needed); CONTRIBUTING "Set up" |
| How do I configure providers? | README "Choose a model provider" and "Configuration"; `.env.example` |
| How do I run the tests? | README "Development commands" and "Testing"; CONTRIBUTING "Before you open a pull request" |
| How does the AI workflow work? | README "How it works"; `docs/architecture.md` |
| How are unsafe model outputs handled? | README "How it works" steps 4-5 and the stated limits; `docs/architecture.md` (safety rules) |
| How does fallback work? | README step 5; `docs/api.md` (`meta` fields, `fallbackReason`, `fallbackSource`) |
| How do I report a bug? | `.github/ISSUE_TEMPLATE/bug_report.yml`; CONTRIBUTING "Reporting bugs"; `SECURITY.md` for privacy/security |
| How can I contribute? | CONTRIBUTING (scope, setup, PR rules, AI-assisted contributions) |
| What is verified and what is incomplete? | README "What has been verified" and "Known limitations"; `checkpoint-9-evidence.md` and this file |

## 2. Contributor onboarding
| File | Notes |
|---|---|
| `CONTRIBUTING.md` | prerequisites, setup, exact pre-PR commands, code map, PR expectations, bug reporting, secrets hygiene, AI-assisted contribution rules, out-of-scope list |
| `CODE_OF_CONDUCT.md` | Contributor Covenant **2.1**, text and attribution preserved verbatim from contributor-covenant.org (a test asserts the attribution sentence, the Mozilla credit and all eleven section headings). One placeholder remains: `jangidpiyush16011@gmail.com` |
| `SECURITY.md` | private reporting route, what counts, what the project already does. Same contact placeholder |
| `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml` | GitHub issue forms; YAML parsed locally; redaction and scope checkboxes |
| `.github/PULL_REQUEST_TEMPLATE.md` | verification section asks what was and was not run; AI-assistance line |

GitHub rendering of the forms and template was **not** checked (no GitHub access).

## 3. License and metadata
- `LICENSE` is MIT. Its text equals the canonical MIT text (compared programmatically, ignoring whitespace) except for the copyright line, which reads **`Copyright (c) 2026 <YOUR NAME>`**. `package.json` and `frontend/package.json` both say `MIT`, so they agree with the file. A test asserts this agreement.
- **Not changed:** the holder name is the owner's choice (a person's legal name, a handle or an organisation). `npm run check:docs` prints a notice while the placeholder remains.
- **Suggested repository description** (not applied; GitHub was not touched): *Mobile-first walk planner. Gemma writes a short outdoor walk, the app validates it with deterministic safety rules and a labelled fallback, then the phone goes down. Node/Express + React, traced with Sentry.*
- **Suggested topics** (not applied): `gemma`, `llm`, `sentry`, `observability`, `typescript`, `react`, `vite`, `express`, `structured-output`, `open-weights`, `outdoors`, `walking`, `hacktoberfest`.

## 4. Repository hygiene
| Review item | Result |
|---|---|
| `.gitignore` | already excluded `.env*` (keeps `.env.example`), `node_modules`, `dist`, `coverage`, `.vitest`; added `*.zip` |
| `.env.example` (both) | blanks and non-secret defaults only; stale CORS comment in the frontend one corrected |
| Secret-shaped strings | exactly three, all fake test fixtures (a key sentinel, a DSN shape and a private-key header used to test the secret scanners): kept |
| Debug scripts, temp files, generated artifacts | none present in the tree. The `scripts/` files are documented tools (smoke, scenarios, QA, scanners) |
| Duplicate or obsolete docs | `docs/00`-`05` are CP0 planning notes that no longer match the product (a refusing "window gate", a repair retry). Kept and labelled historical rather than deleted |
| Docker, CI, deployment files | unchanged |
| ZIP | no `.env`, `node_modules`, `dist`, `coverage`, logs or archives (below) |

## 5. CI and security
`.github/workflows/ci.yml` unchanged. The new docs tests run inside `npm test`, so the existing `verify` job checks documentation on every push, offline. **None of CI has run on GitHub.** `npm run check:bundle` and the privacy tests are unchanged and pass.

## 6. Tests
| | Count |
|---|---:|
| Backend existing | 611, unmodified |
| Backend new (`docsCheckCp10.test.ts`) | 15 |
| Backend total | **626 passing**, 28 files |
| Frontend | **151 passing**, 9 files, unchanged |
| Modified / removed / skipped | 0 / 0 / 0 |

Mutation checks on the new tests: a broken README link, a renamed Code of Conduct heading and a broken CONTRIBUTING link each made the tests fail; restored and green.

## 7. Browser regression (production-shaped server, from the final tree)
| Script | Result |
|---|---|
| `cp6_flow.py` (happy path) | 48 passed / 0 failed |
| `cp8_failures.py` (failure and retry) | 22 passed / 0 failed |
| `cp9_limits.py` (real rate limiter) | 9 passed / 0 failed |

## 8. Not verified
That GitHub renders the issue forms and PR template; GitHub's community-profile scoring; external hyperlinks (the checker covers relative links and anchors only); a live deployment; a real `docker build`; GitHub Actions (including the Docker job); ingestion by a real Sentry project; live Gemma and Open-Meteo; multi-instance behaviour; real phones and other browsers.

## 9. Owner actions that remain
Fill in the `LICENSE` holder; supply the contact method in `CODE_OF_CONDUCT.md` and `SECURITY.md` (and enable private vulnerability reporting if that is the chosen route); set the repository description and topics; confirm the issue forms render; push and check the CI jobs.
