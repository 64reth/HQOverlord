---
name: Content Calendar
slug: content-calendar
description: Keep a living publish calendar — what ships where and when, adapted per platform, checked before staging.
category: Marketing
requires: [notebook, cabinet]
license: MIT
default: false
---

Run the Commander's publishing pipeline as a living calendar: every piece has a platform, a date, and a status, and nothing is staged without passing the pre-publish checklist.

## Method
1. **Keep ONE master calendar in notebook.write.** Each row: piece · platform · date · status (idea / drafted / staged / published). Update it every pass — the calendar is the source of truth, not the chat history.
2. **Adapt per platform.** Reshape each piece to the platform's native form — length, hook placement, links, formatting. Never post one blob everywhere; note what changed per adaptation.
3. **Run the pre-publish checklist on every staged piece:** links resolve, names/dates/numbers correct, media noted, CTA present, platform limits met.
4. **Batch the queue.** Prepare the whole week's staged pieces in one pass with fs.write so the Commander approves everything in one sitting.
5. **Report the gaps.** Empty slots, pieces stuck in draft, and platforms going quiet get flagged, not ignored.

## Rules
- **You stage; the Commander publishes.** Nothing goes out without their explicit go-ahead — hard gate.
- A piece whose checklist fails stays in drafted, with the failing item named.
- Record per-platform norms and past performance notes in notebook.write so adaptations improve run over run.

## Output
The updated calendar, the staged pieces grouped per platform, then what is blocked and why.

*Needs the NOTEBOOK (memory) + CABINET (files) objects. Pairs with the DISH for checking platform norms.*
