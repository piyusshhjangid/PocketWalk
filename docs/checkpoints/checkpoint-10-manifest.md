# Checkpoint 10 manifest

Complete project snapshot (`pocketwalk-checkpoint10.zip`, top folder `pocketwalk/`). Excluded: `node_modules/`, `dist/`, `coverage/`, `.vitest/`, `.env*` (except the two `.env.example` files), logs, screenshots, archives.

## Added
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`
- `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/feature_request.yml`
- `docs/api.md`
- `scripts/checkDocs.ts`, `tests/docsCheckCp10.test.ts` (15 tests)
- `docs/checkpoints/checkpoint-10-summary.md`, `-evidence.md`, `-manifest.md`

## Modified
- `README.md` (rewritten; API detail moved to `docs/api.md`)
- `docs/00-VERIFIED-FACTS.md`, `docs/01-CATEGORY-ANALYSIS.md`, `docs/02-CONCEPTS-AND-SCORES.md`, `docs/03-FINAL-PROJECT.md`, `docs/04-DEMO-PROOF-ARTICLE.md`, `docs/05-CHECKPOINTS.md` (a historical-document banner added under the title; nothing else changed)
- `docs/architecture.md` (title and a reading guide; no technical content changed), `docs/development-log.md`, `docs/ai-assistance-log.md`
- `frontend/.env.example` (a stale comment corrected; no setting changed)
- `.gitignore` (`*.zip`)
- `package.json` (version 0.10.0, `keywords`, script `check:docs`), `frontend/package.json` (version), both lockfiles (version fields only)

## Removed
None. No test, deployment protection or documentation was deleted.

## Unchanged on purpose
`LICENSE` (owner must supply the holder name), all of `src/`, `frontend/src/`, existing tests, `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`.

## Verification status
Verified locally and from a clean extraction: typechecks, 626 backend and 151 frontend tests, builds, audits, bundle scan, docs check, 48 + 22 + 9 browser checks. **Not verified:** GitHub rendering of the templates, GitHub Actions, a live deployment, a real Docker build, real Sentry ingestion, live providers.
