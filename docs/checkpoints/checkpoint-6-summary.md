# Checkpoint 6 summary: the phone-down experience

**Goal:** turn `READY_TO_WALK` into "Here's what to do. Now go." The app should help the person leave the app.

## What changed
- The Ready screen has one real primary action, **Start walking** (the CP5 gap is closed; no dead end).
- New states: `WALK_ACTIVE`, `EXIT_CONFIRMATION`, `WALK_COMPLETE`. The backend is untouched.
- The active screen shows one large instruction, the plan's "notice" line, a dim time-left, tiny step dots and a small **Exit walk**. For 4 seconds it first says "You're ready. Put your phone away."
- Steps advance by themselves using the plan's own minutes. Nothing asks to be tapped; the walk works if nobody looks at the screen.
- The timer is derived from `startedAt + duration` through an injectable `Clock`, recalculated on visibility changes; it is never counted down.
- Exit asks first (keep walking is the default focus; Escape keeps walking); the timer runs underneath, and a walk that ends meanwhile completes.
- Completion: "Walk complete. Nice. You spent N minutes outside. [Done]". No XP, streaks, history or sharing. Done returns Home; nothing is stored.

## Product decision
PocketWalk intentionally minimises interaction after the walk begins. That is not a missing feature. The timer is for orientation; the screen should not become the activity.

## Not added, on purpose
Map, GPS, distance or steps, calories, notifications, audio or voice, Wake Lock, PWA, accounts, analytics, persistence, pause, breathing or mindfulness features, frontend Sentry.

## Decisions worth knowing
Walks are ephemeral (refresh goes Home). `Date.now()` is used because a sleeping phone must not stop time. Plan steps are the schedule; no timing is invented. The fade-in is the only motion and is off under reduced motion.

## Limits
A normal web page cannot run with the screen locked. If the phone sleeps, the page is frozen; the time is recalculated when it is visible again. Verified in headless Chromium only. See `checkpoint-6-evidence.md`.

**Next:** Checkpoint 7, Sentry performance and observability. Do not start it until asked.
