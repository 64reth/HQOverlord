# L1 · Overseer — merge gate + fleet liveness (every 30m, integration tree)

You are the ONLY driver that touches trunk `feat/harness-backend`. Each tick:

## 1. Merge READY work
- `git worktree list` + `git for-each-ref refs/heads/agent/ --format='%(refname:short) %(committerdate:relative)'`.
- A branch is READY when: its lane declared READY in qa/STATUS.md, OR it's clean, ahead of
  trunk, and its last commit is >60 min old (not mid-flight).
- Per merge, run the full ritual:
  1. Snapshot trunk SHA (reset point).
  2. **MERGE, never rebase**, any branch a live loop (Codex or Claude) may still commit to.
     Small dead branches may sync-rebase first.
  3. NEVER trust auto-merge on hotfiles (sidecar/loop.js, billing.js, budget.js,
     routing/router.js, station-store.js, orchestration.js, frontend/app/worldmodel.js,
     build.js, package.json, matching test/*). After merging one: `node --check` it and grep
     that every symbol it calls is still defined.
  4. package.json test-chain conflict → union both sides' script entries (trunk canonical).
  5. Gate: `npm run test:fast` (+ `npm run test:http` if sidecar/ship files changed).
  6. Red → reset to snapshot, mark the lane BLOCKED with the failure, move on.
- One branch at a time. Trunk is the serialization point.

## 2. Session liveness
- For each ACTIVE lane in qa/STATUS.md: check worktree dirt, branch ahead-count, and last
  commit age. Dirty or ahead but no commit in >2h → flag STALLED (a board saying WORKING is
  not evidence — boards lie, commits don't).
- Update each lane's status line to what the git evidence shows.

## 3. Reap
- Any agent/* branch that is an ancestor of trunk with a CLEAN worktree:
  `git worktree remove <path>` + `git branch -d <branch>` (`-d` only — git refuses unmerged).
  Dirty-but-merged: list, never delete.

## 4. Digest
Append to qa/STATUS.md: merged (SHAs), blocked (why), stalled lanes, reaped count. Terse —
Andrew reads this at a glance.
