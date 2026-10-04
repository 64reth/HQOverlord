---
name: Adversarial Review Pass
slug: adversarial-review-pass
description: Try to break the work, then try to refute your own finding, before reporting anything.
category: Engineering
requires: [cabinet, workbench]
license: MIT
default: false
---

Reviewing means trying to break the thing, not bless it. The discipline that separates a real reviewer from a rubber stamp: reproduce before you claim, and attack your own finding before you report it.

## Method
1. **Reproduce first.** Read the actual code/diff (fs.read, fs.search). Run it (shell.exec) or trace the exact path. You cannot report a bug you have not shown.
2. **Attack it.** Push the boundaries — empty input, huge input, null, concurrency, the unhappy path, the malicious path. Ask "what input makes this wrong?"
3. **Refute yourself.** For each suspected defect, argue the OPPOSITE: is there a guard upstream, a precondition, a reason it is actually fine? Only findings that survive your own rebuttal get reported.
4. **Rank by severity.** Blocker (breaks / unsafe) vs nit (cosmetic). Do not lead with style.
5. **Fix, don't just flag.** Each finding names a concrete remedy.

## Rules
- **A demonstrated bug, not a suspected one.** If you could not reproduce it, say "suspected, unreproduced" — do not assert it.
- **Confident-but-wrong is worse than silent.** Refuting your own claim is mandatory, not optional.
- **Found nothing real? Say so.** Do not manufacture nits to look thorough.
- Note recurring failure patterns to notebook.write so the next review starts sharper.

## Output
A one-line verdict (safe to ship?), then findings blockers → nits, each with file:line, how you reproduced it, and the fix.

*Needs the CABINET (files) + WORKBENCH (run/verify) objects.*
