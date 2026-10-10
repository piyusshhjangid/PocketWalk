# Checkpoint 2 manifest

Checkpoint: 2 (Gemma AI core)
Date: 2026-10-07
Git commit: NOT VERIFIED (the Checkpoint 1 ZIP contained no .git; none was created)
Git branch: NOT VERIFIED
Node version: v22.22.2 (build environment); package.json engines >=20; CI configured for 22
Package manager: npm 10.9.7 (package-lock.json present)
Major dependencies: @sentry/node 11.4.0, express 5.2.1, zod 4.6.5, dotenv 18.0.5, morgan 1.12.1;
  dev: typescript 7.0.2, vitest 5.0.3, supertest 7.3.1, tsx 4.23.15. No new dependencies in this checkpoint.
Tests: 55 passing in 6 files (local, no network). Run on a clean extraction of the ZIP.
Build: PASS (tsc -p tsconfig.build.json, from clean dist)
CI: NOT VERIFIED (workflow unchanged from CP1; never run on GitHub)
Sentry: spans verified locally with the real SDK and a no-op transport. Delivery to a real Sentry project: NOT VERIFIED.
Gemma: adapters for Google Gemini API (default model gemma-4-26b-a4b-it) and Ollama implemented and tested against
  local imitation servers. Live call to real Gemma: NOT VERIFIED.
Deployment: none (Checkpoint 9)
Known limitations: see checkpoint-2-summary.md
