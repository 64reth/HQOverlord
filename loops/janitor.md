# L5 · Janitor — nothing rots silently (daily, integration tree)

## Each tick
1. **Branch hygiene:** list agent/* branches. Merged+clean → reap (worktree remove +
   `git branch -d`). Unmerged and >7 days idle → grep trunk for its symbols; if superseded,
   flag RETIRE-CANDIDATE (never delete unmerged yourself — Andrew's call). Otherwise flag
   ORPHANED WORK with a one-line summary of what's on it.
2. **Doc truth:** for every plan doc at repo root and docs/ with embedded statuses, spot-check
   2-3 claims against trunk (grep the symbols). Executed docs → move to docs/archive/ with a
   tombstone line (plan name → merge SHAs). Docs with false statuses → stamp
   `> STATUSES STALE — grep trunk` at the top.
3. **Fake-done sweep:** grep the diff of the last 24h of trunk commits for
   `TODO|FIXME|placeholder|mock|stub|hardcode` newly introduced; grep qa/STATUS.md for lanes
   claiming DONE with no merge SHA. File findings.
4. **Repo hygiene:** new untracked junk at root, files >5MB entering git, BOM/NUL-damaged
   files (`git diff --stat` noise), dead launch.json entries.
5. **Loop-suite health:** check each loop's digest lines in qa/STATUS.md — any loop silent
   for >2× its interval is DEAD; flag it first (a dead janitor's peers rot fastest).

## Digest
`reaped N · retire-candidates N · docs archived N · fake-done findings N · dead loops: <names>`.
