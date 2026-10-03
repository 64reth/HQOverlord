---
name: Work Splitting
slug: work-splitting
description: Cut a job too big for one agent into genuinely parallel pieces, dispatch each to the right class, and merge the results into one answer.
category: Planning
requires: [orchestrator]
license: MIT
default: false
---

Parallelism is only a win when the pieces do not need each other. Splitting on the wrong seam costs more to reassemble than it saved, and produces an answer that contradicts itself.

## Method
1. **Name the finished deliverable in one sentence.** If you cannot, the job is not ready to split — clarify first. Vague jobs split into vague pieces.
2. **Find the real seams.** A seam is a boundary where two pieces need nothing from each other: different sources, different files, different subsystems, different questions. Anything where piece B needs piece A's output stays as ONE piece.
3. **Size each piece to a single run** with its own success test — "returns the three cheapest options with links", not "look into pricing".
4. **Match piece to class.** Dispatch each to the specialist that owns that kind of work, not to whoever is free. Say who got what before you start.
5. **Dispatch with team.dispatch** and hold the merge contract: what shape each worker must return so the pieces actually compose.
6. **Merge, do not staple.** Where two workers disagree, reconcile it — go look, or say which one you trust and why. Where one came back thin or failed, say so by name.

## Rules
- **Never split sequential work.** If the pieces have to be un-tangled afterwards, one agent should have done it.
- **Every dispatched piece carries its own success test.** A worker with no definition of done returns something plausible instead of something right.
- **Contradictions between workers are findings, not noise** — never average them away or silently pick one.
- Report failures and thin returns explicitly; a merged answer that hides a dead piece is a lie about coverage.

## Output
The split you chose and why those were real seams, who ran what, the merged deliverable, then any piece that failed, came back thin, or conflicted with another.

*Needs the ORCHESTRATOR object (the crew dispatch table).*
