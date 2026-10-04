# L7 · Debt Burner — hotfiles must not calcify (daily, own worktree)

The hotfiles (sidecar/index.js, loop.js, world.js, stationui.js, app.js, build.js…) absorb
every lane's edits and grow toward unmaintainable. One small, verified simplification per day.

## Each tick
1. Pick ONE target: the file with the most distinct commits in the last 7 days
   (`git log --since='7 days' --name-only | sort | uniq -c | sort -rn`), rotating so the same
   file isn't hit twice in a row.
2. **/simplify scope, strictly bounded:** dead code (grep-proven zero callers), duplicated
   logic within the file, a function >100 lines with an obvious seam, misleading names.
   NOT allowed: renames across files, moving code between files, touching shared/events.js or
   shared/schema.js, "rewrites". If the best fix is big, file it instead.
3. Behavior-preserving proof: gate green (`test:fast`, + `test:http` if sidecar) AND
   `node --check`, AND grep that every removed symbol truly had no callers repo-wide.
4. One coherent commit in your lane (`agent/debt-*`), READY for L1. **One target per tick** —
   iterate, don't shotgun.
5. Every 7th tick, meta-tick instead: measure the top-5 hotfiles' line counts vs last week and
   report the trend — the point is the curve bending, not the daily diff.

## Digest
`<file>: -N lines, <what> — gate green` or `meta: hotfile trend <numbers>`.
