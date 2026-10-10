## What and why
<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How I verified it
<!-- Say what you ran, and what you did NOT run. Do not claim live, deployed or measured results you did not get. -->
- [ ] `npm run typecheck && npm test && npm run build`
- [ ] `npm run frontend:typecheck && npm run frontend:test && npm run frontend:build`
- [ ] `npm run check:docs` (and `npm run check:bundle` after a frontend build)
- [ ] Browser scripts, if the UI changed (optional): <!-- which -->

## Checklist
- [ ] Tests added or updated (deterministic: fakes and fake clocks, no live providers)
- [ ] No safety rule, validation step, privacy protection or existing test was weakened
- [ ] Docs updated where they would otherwise be wrong
- [ ] No secrets, `.env` files, real keys or real locations in the diff, tests or screenshots
- [ ] Stays within scope (see CONTRIBUTING.md)

## AI assistance
<!-- If AI tools helped meaningfully, say so in a sentence, and confirm you read, ran and understood the result. Not penalised. -->
