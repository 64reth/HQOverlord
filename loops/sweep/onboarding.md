# SWEEP · onboarding — awakening, interview, recruitment, first run

Read `loops/sweep/README.md` first; it carries the protocol. Surface key: `onboarding`.
**Rank 7 of 10** — the product is LOCKED on beginners, so a defect here costs users you never
hear from. They do not file bugs; they leave.

## What you own

`frontend/app/intake.js` · `interview.js` · `dialogue.js` · `hint.js` · `glossary.js` ·
recruitment + FOR-YOU shelf surfaces · `sidecar/scout.js` · `questinject.js` ·
`questrefresh.js` · `quest-store.js` · `dev/onboard-fresh.js`

## How to run this lane

**From a genuinely fresh station, every time** (`node dev/onboard-fresh.js`). A seeded station
hides exactly the bugs this lane exists to find. Then play it as a beginner who does the wrong
thing — not as an author who knows the intended path.

## The failure states to walk

1. **The stranded user.** At every step, ask: if this fails right now, does the user know what
   to do? No key. Wrong key. Offline. Every provider down. Closed the window mid-interview.
   Refused a permission the flow needed. **Walk the failure states live** — this is the whole
   point of the lane.
2. **Answer badly.** Empty answers, one-character answers, a 5,000-word answer, emoji only, a
   different language, an answer that contradicts an earlier one. Then go BACK and change an
   answer after the flow has already acted on it.
3. **Quit and return.** Close at every stage and reopen. Restart the sidecar mid-onboarding.
   Does it resume where it was, restart honestly, or land in a half-built station?
4. **Fresh-install leaks.** A fresh station must contain nothing from a previous one. Grep the
   first-run state for seeded agents, seeded sessions, seeded quests, leftover keys.
5. **Sandbox, no gating.** Full power from minute one. Any grind, unlock, level requirement or
   permission wall discovered on this path is a product-law violation, not a feature — file it
   as P1 even if it looks deliberate.
6. **The shelf must never be empty.** A negative-heavy rank term once emptied the FOR YOU shelf
   entirely. Drive the recommender with hostile inputs (reject everything, like nothing, one
   interest, no interests) and prove it always returns something.
7. **Ask plainly.** Awakening questions must read as plain questions. Anything that reads as a
   riddle or a personality quiz is a defect on this surface.
8. **First real work.** The tour is not the finish line — drive the beginner's FIRST actual task
   to a deliverable they can open. A deliverable is done when it OPENS, not when it is written.

## Done means

Two complete passes from a fresh station: one cooperative, one hostile. Every dead end recorded
with the exact step and what the user was shown.
