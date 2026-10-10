# Security policy

## Supported versions
Only the latest commit on `main` is supported. PocketWalk has no released versions yet.

## Reporting a vulnerability or privacy problem
Please **do not open a public issue** for security or privacy problems. Report them privately by jangidpiyush16011@gmail.com (for example GitHub's "Report a vulnerability" private advisory, once the repository owner has enabled it).

Include what you found, how to reproduce it, and what you think the impact is. Redact real secrets and real locations. You should get an acknowledgement; this is a small volunteer project, so please be patient.

## What counts
Things we want to hear about privately:
- a way to make an API key, DSN, prompt, model output, plan text or a user's city appear in logs, traces, error responses or the browser bundle
- a way to bypass request validation, the rate limit, the concurrency cap or the request deadline in a way that costs the operator money or availability
- a way to make the server return model-written text that skips the validation and safety pipeline
- an injection or cross-site scripting path in the frontend or the static file serving

Things that are ordinary bugs (public issues are fine): a harmless walk wrongly rejected by the safety rules, a hazardous phrase the rules do not recognise (the safety layer is a conservative English-only filter and is documented as not a guarantee, see the README), wrong weather for an ambiguous city name, and similar.

## What the project already does
Responses never contain stack traces or provider errors; Sentry events are scrubbed and prompts, model output and locations are never recorded; request bodies are size-limited; secrets live in environment variables only. Details: `docs/architecture.md`. None of this has been audited by a third party.
