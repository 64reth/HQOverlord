# StarNet 24/7 loop suite — the machine that keeps the machine improving

Each loop is a self-contained prompt file. Launch one per Claude Code session with `/loop`:

```
/loop <interval> Read C:\Users\<you>\Desktop\gen\loops\<file>.md and execute it fully.
```

App-dependent loops boot the app themselves if it isn't running (`npm start` → :8787).
Every loop obeys AGENTS.md (worktree protocol) and appends a terse dated digest to
`qa/STATUS.md`. **No loop ever fake-greens: red or unverifiable = report, never claim.**

| # | Loop | File | Interval | Session dir | Kills |
|---|------|------|----------|-------------|-------|
| L1 | Overseer | overseer.md | 30m | integration tree | merge debt, dead sessions, lane rot |
| L2 | Truth Auditor | truth-auditor.md | 2h | any worktree | the app lying about state |
| L3 | Green Guardian | green-guardian.md | 1h | integration tree (read-only) | fake-done, silent trunk breakage |
| L4 | Beginner Run | beginner-run.md | 4h | own worktree | beginner confusion, onboarding rot |
| L5 | Janitor | janitor.md | daily | integration tree | stale branches/docs/TODOs, doc-status lies |
| L6 | Adversarial Reviewer | adversarial-reviewer.md | 6h | own worktree | half-baked happy-path features |
| L7 | Debt Burner | debt-burner.md | daily | own worktree | complexity creep in hotfiles |
| L8 | Security Sweep | security-sweep.md | weekly | own worktree | leaked secrets/PII, unsafe surfaces |
| L9 | Perfectionist | perfectionist.md | self-paced | own worktree | un-mapped/imperfect surface (drives the Station Atlas to `perfected`) |
| L10 | Dogfood | dogfood.md | daily / self-paced (RC-soak driver) | own worktree | seam bugs that only appear when the product is USED like a real user (recruit→assign→interrupt→restart→open); the reason Andrew is the first tester |
| L11 | Red→Green Closer | red-green-closer.md | self-paced (per open finding) | own worktree | the gap between DETECTED and FIXED — fans repair agents at one red finding and crowns only the patch a script proved on a clean tree |

## Priority if running fewer sessions
Minimum viable set: **L1 + L3** (nothing merges wrong, nothing stays broken).
Add **L2 + L6** next (honesty + adversarial depth). L4/L5/L7/L8 are the daily/weekly tier.
**L11 is the only loop that repairs** — it is worth running the moment L3 has a standing red,
and pointless when the ledger is empty.

## Rules common to every loop (read before executing any file)
1. **Grep trunk first.** Before "fixing" anything from a plan/audit/memory claim, grep trunk
   for the symbols — audits go stale in hours on this repo.
2. **Evidence or it didn't happen.** Live claims need a DOM round-trip/screenshot/log line
   pasted into the digest. Verbal claims count for zero.
3. **Fix small things in your own lane; file big things.** A loop may fix a ≤~30-line clear
   defect in its own worktree branch and leave it for L1 to merge (gate green first). Anything
   larger becomes a filed finding in `qa/findings/` — loops don't start feature lanes.
4. **One digest line minimum per tick**, even if "no findings" — silence is indistinguishable
   from a dead session.
5. **Never touch another agent's worktree; never edit the integration tree** (L1's merges and
   L5's reaping are the sanctioned exceptions).

## The SWEEP — `loops/sweep/` (a fan-out, not a loop)

The ten loops above run on a schedule and keep the machine from **regressing**. The sweep is
the other half: a one-shot fan-out of ten adversarial lanes, one per surface slice
(safecell, providers, channels, sessions, autonomy, skills, onboarding, voice, world, release),
launched together when you are about to ship a fix-heavy update.

Its findings go to `qa/bugs/` — a **tracked** register, unlike the machine-local
`qa/findings/` above — so a lane's work survives the session and worktree that found it:

```bash
node scripts/qa/bugs.mjs --list --status open
```

Read `loops/sweep/README.md` before launching one.
