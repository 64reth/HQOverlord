# Game Coherence Matrix — test every layer, prove no feature overlaps another

**Goal (Andrew):** test *every layer of the simulated / gamification aspect* and guarantee
**no overlapping between features** — visually OR functionally — then tie it all together so the
whole thing composes instead of colliding. This is the master checklist the Visual-Auditor loop
(`VISUAL_AUDITOR.md`) drives every cycle, using `uishoot.mjs` (static) + `uiplay.mjs` (interactive).

## The 3 overlap dimensions (what "no overlapping" means)
- **V · Visual stacking** — no two surfaces occlude each other wrongly. ONE paradigm per moment:
  a **centered modal under a focus scrim** (dock panels) OR a **full-bleed overlay** (recruitment,
  refit) — never a third, never two at once. The floor + COMMS dim behind an open modal.
- **F · Functional conflict** — opening feature X must not break, leak into, or double-drive Y.
  One mode active at a time. No dogpiled beats. Agent bodies never driven by two systems at once.
  The reply message always lands readable at the bottom of COMMS, tool logs above it.
- **T · Transition residue** — entering/exiting a mode leaves NO leftover. (Already caught: refit
  mode didn't exit when a dock panel opened; panels must fully close, scrim torn down, body restored.)

## The layers (every gamification surface) — each tested in V/F/T
| # | Layer | Drive | V | F | T |
|---|-------|-------|---|---|---|
| 1 | World floor / agents (present, sit, idle-wander, camera, multi-body) | uishoot ingame + uiplay | | | |
| 2 | Workstations (desk+chair+seat, bound to agent, object=capability) | place a prop, summon | | | |
| 3 | Conveyor / pipeline (work items, bays, routing) | refit TEST belts | | | |
| 4 | BUILD / refit (rooms, hallway, paint, move, reclaim, prop catalog, PLACE a prop) | open BUILD, place prop, exit | | | |
| 5 | Dock panels ×15 (open/close clean, centered, no leftover) | uishoot sweep | ✓ | | |
| 6 | COMMS (message, tool logs, reply-at-bottom, beats: turn-in/memory/curiosity/approval) | uiplay run + double-send | | | |
| 7 | Summon / recruitment (bay → summon → guidance → new body walks to desk) | uiplay summon | | | |
| 8 | HUD / XP / reactor (model, tokens, spend, level, reactor gauge) | uishoot + a real run | | | |
| 9 | Dossiers (agent + commander) | open both | | | |
| 10 | Voice controls (mic, mute, hands-free) | toggle each | | | |
| 11 | Autonomous (cron/routines, messaging, rewind, logbook) | open each | | | |
| 12 | Onboarding / awakening (first-run path) | fresh (non-seed) boot | | | |

## Method (per layer)
1. Drive the layer into each of its states with the harness.
2. Run the detectors: stacking (uiplay STACK_FN), console errors/exceptions, transition-residue
   (after closing a mode: assert `#terms` empty, no `.refit-overlay`, `body` has no mode class,
   scrim gone, exactly one or zero full-screen surfaces).
3. Read the frames to catch what box-math misses (aesthetic clash, paradigm mismatch).
4. Log each finding (layer · dimension · what · owner) to SESSIONS.md "VISUAL-AUDIT findings".
5. Fix small/cross-cutting directly + re-shoot to confirm; route structural to UI-SHELL/WORLD-GAME.

## Tie-it-together (the unification — stops overlap recurring)
- **Single UI authority:** one doc + helper that every feature opens through, enforcing the paradigm
  rules above (mode exclusivity; centered-modal-under-scrim vs full-bleed; floor/COMMS dim behind).
  New features pick a lane instead of inventing a third → no future collisions.
- **Mode-exclusivity invariant:** at most ONE full-screen mode (refit / recruitment / onboarding)
  may be active, and opening any of them (or a dock panel) first tears down whatever was open.
- Wire this matrix into the Visual-Auditor loop so the whole sweep + the residue assertions run
  every cycle — the 24/7 guarantee that no merge reintroduces an overlap.

## Status ledger (filled during execution)
- L5 Dock panels — V: **FIXED** (center-single + scrim, `8f3dda8`). T: residue close works in harness.
- L4 BUILD/refit — T: refit-exit residue handled in harness close; **app-side exit-on-panel-open: TODO verify**.
- L6 COMMS — F: basic chat + double-send clean, no console errors (`uiplay`). Beats under load: TODO.
- (remaining layers: pending execution)
