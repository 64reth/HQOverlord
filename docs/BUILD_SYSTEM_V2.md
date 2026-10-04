# StarNet Build System v2 — polish the machine that builds the machine

> 2026-07-02 retro on HOW StarNet gets built (Claude orchestrator + worktree lanes + Codex
> cron loops), mined from the merge memories, plan docs, and the live repo state. Each item
> names the recurring failure it kills and the concrete mechanism. Ranked by payoff.

## The evidence (what actually goes wrong, ranked by recurrence)

1. **Stale audits** — "THE BIG LESSON (hit 5+ times): audit/triage claims go stale in HOURS."
   ~14 of 25 "merge-candidate" branches were fully superseded; the reference harness readiness sweep had
   4 false-positive gaps that almost got "fixed" (one fix was mid-flight before being caught).
2. **Lifecycle debt** — 121 `agent/*` branches exist; **108 are already merged into trunk**
   but their worktrees + branches were never torn down. The worktree registry (the protocol's
   source of truth) is ~90% dead entries. Teardown is in the rules but never happens because
   it's a manual afterthought.
3. **package.json test-chain conflicts** — the #1 recurring merge conflict. Root cause is
   structural: `test:fast:raw` is a 7,099-char `&&` chain that EVERY branch adding a test must
   edit at the same spot.
4. **Hotfile auto-merge lies** — git auto-merge silently combined a "dead code" deletion with
   a branch that used the function (`updateSafetyClearance`); headless gate couldn't catch it.
5. **Fake-done / app-lies / half-baked** — work claimed complete without live verification;
   the #1 human frustration. Partially killed by the gate, still relies on discipline.
6. **Sessions stall silently** — parallel sessions die, status boards say WORKING, work sits.
7. **Plan-doc sprawl** — 8+ plan docs at repo root, each with embedded STATUS that goes stale
   the moment a parallel lane ships (this is what feeds failure #1).

## P0 — Kill stale-audit rework: the "grep trunk first" preflight

- **Rule (add to AGENTS.md):** before building or merging ANY item from a plan doc, audit, or
  memory, grep trunk for the feature's symbols/routes/files. The plan doc is a hypothesis;
  trunk is the truth. Budget: 2 minutes of grep saves a superseded lane.
- **Mechanism:** `scripts/preflight.ps1 <keyword...>` — greps trunk + lists branches touching
  matching files + prints last-commit dates. One command, no excuse to skip.
- Plan docs get a header stamp: `> STATUSES STALE AS OF <date> — grep trunk before trusting.`

## P1 — Automatic lane teardown (the janitor becomes a script, not a rule)

- **Mechanism:** `gen-trees/reap-merged-trees.ps1`:
  for each `agent/*` branch that is (a) an ancestor of trunk and (b) has a clean worktree,
  `git worktree remove` + `git branch -d` (`-d` not `-D` — git itself refuses if unmerged).
  Dirty-but-merged trees get LISTED, never deleted.
- Run it as the closing step of every merge campaign (orchestrator habit) or as a daily loop.
- **One-time cleanup now:** reap the 108 merged lanes → registry drops to ~13 real entries and
  `git worktree list` becomes trustworthy again.

## P2 — Make the test gate conflict-free (delete the &&-chain)

- Replace `test:fast:raw`'s 7,099-char chain with a runner: `node scripts/run-tests.mjs`
  that globs `test/*.test.js` + the two lint scripts, runs them sequentially, fails fast.
- Branches adding a test now add ONLY their test file — zero package.json edit → the #1
  conflict class disappears. Exclusions (slow/http tests) live in a small skip-list inside
  the runner (rarely touched).
- Keep `test:http` explicit. Verify the runner executes the identical set before switching
  (diff the glob against the current chain).

## P3 — Codify the merge gate as a script (merge craft is currently oral tradition)

`scripts/merge-gate.ps1 <branch>` run from the integration tree:
1. Snapshot trunk SHA (auto-reset point).
2. Refuse rebase if branch tip is < 60 min old or branch is on the Codex live-loop list
   (merge-never-rebase); otherwise offer sync-rebase for small branches.
3. Merge; then for every hotfile in the merge: `node --check` + grep that every symbol the
   file calls is still defined (the `updateSafetyClearance` class of bug).
4. Run the gate (`test:fast`, + `test:http` for ship-touching diffs).
5. On green: print "LIVE-VERIFY REQUIRED" checklist line for UI/run-loop diffs — merge is not
   DONE until a live :8787 observation is recorded (screenshot or DOM round-trip).
6. On red: reset to snapshot, report.

## P4 — One live status board; archive executed plans

- Root keeps ONE live doc: `STATUS.md` (or the existing qa/STATUS.md) — what's in flight,
  which lanes are live, what's blocked on Andrew. Everything else (`ORCHESTRATION_PLAN`,
  `AUTONOMOUS_BUILD_PLAN`, `FULL_RELEASE_POLISH_PLAN`, parity plans…) moves to
  `docs/archive/` the day it's executed, with a one-line tombstone pointing at the merge SHAs.
- Rationale: stale embedded statuses are the raw material of failure #1.

## P5 — Session liveness (the stall killer)

- The overseer loop (L1 from the recurring-problems memory) is the right design; the missing
  piece is a cheap signal. **Mechanism:** every lane session touches
  `gen-trees/<name>/.heartbeat` (a dated one-liner: current step) at each work chunk; the
  overseer flags any ACTIVE lane whose heartbeat is older than ~40 min OR whose worktree is
  dirty-but-idle. Board status derives from heartbeats, not from hand-edited text.

## Operating rhythm (the loop between Claude and Codex, tightened)

- **Claude = the only merge gate.** One driver on trunk, ever. (Already true — keep it.)
- **Codex branches: merge, never rebase; seal a loop before tearing down its tree.** (Proven.)
- **Per feature:** preflight-grep → worktree lane → build small + commit small → gate green →
  live-verify with evidence → Claude merges via merge-gate script → reap the lane same day.
- **Per campaign close:** reap script + archive executed plan docs + one terse digest to Andrew.

## Immediate actions (awaiting Andrew's go where destructive)

1. ✅ Safe now: write preflight/reap/run-tests/merge-gate scripts in a worktree lane.
2. ⚠️ Needs go-ahead: run the reaper on the 108 merged lanes (deletes worktrees + branches;
   `-d` only, dirty trees spared and listed).
3. ⚠️ Needs go-ahead: archive the executed plan docs out of repo root.
4. Decide: the 13 unmerged branches (list in this retro's session) — most are known-superseded;
   preflight-grep each, merge the ≤3 real ones, let the reaper take the rest after.
