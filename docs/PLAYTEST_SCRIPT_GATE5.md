# Gate 5 — Andrew's 10-minute attended playtest

The one gate never run (SHIP_READINESS 2026-07-02 row 5). Run it on trunk with
`npm start`, a real OpenRouter key, and a stopwatch. The point is NOT to hunt bugs —
it's to feel where a beginner loses trust. Say your reactions out loud / jot them;
each step has a single pass question.

Total: ~10 minutes. Do it in one sitting, no dev tools open.

## Setup (before the clock)
- Fresh profile: temporarily rename your saved state so onboarding runs
  (or use the dev seed's fresh-start path if you prefer — but fresh is the point).
- `npm start`, open the app, have your OpenRouter key on the clipboard.

## The script

| # | Do | Pass question | ~time |
|---|----|----|----|
| 1 | Sit through awakening + interview, answer honestly | Did any moment feel scripted/fake or drag? Did you know what to type at each prompt? | 3 min |
| 2 | Paste the key when asked | Was it obvious WHERE the key goes and that it worked? | 1 min |
| 3 | Give one real task in COMMS, in your own words (e.g. "research X and save me a short report file") | While it ran: did you ever wonder "is it frozen?" If an approval appeared: was it obvious the ball was in YOUR court? | 3 min |
| 4 | When it finishes: **find the output file on disk** without asking anyone | Could you actually locate the file? How long did it take? | 1 min |
| 5 | Rate the run (👍/👌/👎) | Did you understand what rating does? | 30 s |
| 6 | Summon a second agent from the Recruitment Bay | After summon, did you know the next required step (desk/REFIT)? Or dead-end? | 1.5 min |
| 7 | Open SKILLS, then RECIPES, then ROUTINES once each | Could you say in one sentence how they relate? | 1 min |

## Scoring
- Any step where the honest answer is "no / I was lost" = a P0-class finding. Note the
  step number and the exact moment ("after summon toast I didn't know what REFIT was").
- 7/7 clean = thumbs-up gate 5; cut the next build same day per the ship decision rule.

## Where to put results
Drop raw notes at the bottom of this file (or just tell the orchestrator session);
they get triaged against docs/UX_CONFUSION_AUDIT_2026-07-04.md — most steps map 1:1
to known P0/P1 items, so your notes confirm/deny and re-rank that list with real data.

## Notes from the run (fill in)

- Date/build:
- Step findings:
- Overall verdict (ship / fix first):
