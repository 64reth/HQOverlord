# HANDOFF — SHIPPED-pallet "I click it and nothing shows up" report (2026-08-24)

Everything below is **VERIFIED** unless labelled UNPROVEN. The work is DONE and merged to trunk;
what remains is releasing it to the user and one optional judgement call.

---

## The report

A live user's screenshot: the OUTBOX pallet reading **SHIPPED 18**, and (1) "is this supposed to be
growing like this forever?" (2) "I click it and nothing shows up."

## Diagnosis — two real dead-click bugs in `frontend/app/world.js` (VERIFIED)

1. **Jitter-swallowed clicks — the primary cause.** The canvas mouse seam flagged ANY down→up
   movement as a camera drag (`drag.moved = true` on the first `mousemove`, mouseup returns early
   on `wasDrag`). A natural click carries 1–2px of jitter, so prop clicks (OUTBOX, boards, bays —
   ALL world clicks) randomly did nothing. This affected every clickable thing on the floor, not
   just the outbox.
2. **Pallet dead zone.** `outboxAt()` hit-tested only the 24px chute footprint, but the SHIPPED
   pallet draws ~42px wide below it. The outer crate columns — half the visible object — were
   unclickable (no pointer cursor, no window).

His other two questions, answered from the code (VERIFIED by reading `drawShippedPallet`):
- **Not growing forever.** Crates cap at 12 visible (4×3 — exactly his screenshot at count 18);
  the count is SHIPPED TODAY (server truth, `/api/runs` since local midnight) and resets daily.
- **It is supposed to look like that.** 12 green crates + VT323 glow counter over CRT is the design.

## The fix (merged, trunk `feat/harness-backend`)

| commit | what |
|---|---|
| `8761f7f9f` | fix(world): >4px cumulative travel required before a press becomes a pan; `outboxAt` widens ±12px below the chute bottom (pallet span only — footprint above, so neighbouring bay/board clicks are never shadowed). frontend + website/app mirror synced. |
| `8e686256b` | docs(qa): STATUS.md merge digest |
| `787e0a49f` | qa(claims): release-surface re-lock (mandatory after any release-surface byte change — `node scripts/qa/product-perfect/relock-surface.mjs` on a clean tree, or `qa-product-perfect-claims.test` fails the fast gate) |

## Proof (VERIFIED, live app)

`dev/outbox-click-proof.mjs` — attaches to a running `dev/seed-deliverables.js`, stamps a real
outbox via the station store, and drives REAL MouseEvents on the game canvas:
- A: mousedown → 2px move → mouseup at the chute centre ⇒ OUTBOX window opens
- B: live cursor sweep ⇒ clickable half-width at the pallet row 67px vs 34px at the chute row
- C: clean click on an OUTER crate column ⇒ OUTBOX window opens

**With fix: 3/3 PASS. With fix stashed (the shipped behavior): 3/3 FAIL** — reproduces his report.
Shots: `dev/.shots-outbox-click/` (in the `outbox-click` worktree). Run it again any time:
`node dev/seed-deliverables.js` (leave running) then `node dev/outbox-click-proof.mjs`.

Gates: worktree `test:fast` 685/685 green pre-merge; **merged trunk `test:fast` 685/685 green**.
`test:http` NOT run (no sidecar/route change).

## Owed / not done

- **The user is still on the broken build.** The fix is trunk-only; he gets it with the next
  release cut (v0.10.9 is the last shipped tag). Nothing in this lane touched the release train.
- UNPROVEN: whether HIS specific clicks were cause 1 or cause 2 — both were live-reproducible and
  both are fixed, but no telemetry says which he hit. Don't promise "fixed" until he's on a build
  containing `8761f7f9f` and confirms.
- Optional judgement call: the >4px threshold matches typical click jitter; if anyone reports
  "camera feels sticky on tiny drags," that constant is the dial (world.js mousemove handler).
- Worktree `C:\Users\andro\gen-trees\outbox-click` (branch `agent/outbox-click`) is merged; only
  untracked `.shots-outbox-click/` remains — reap with `remove-agent-tree.ps1 outbox-click -DeleteBranch`
  after grabbing the shots if wanted.
