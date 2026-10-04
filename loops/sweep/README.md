# The SWEEP — ten parallel adversarial lanes, one shared backlog

The `loops/` suite above keeps the machine from **regressing**. The sweep is different: it
exists to find bugs that **no detector can currently see**, on surfaces nothing currently
exercises. Run it when you are about to ship a fix-heavy update.

## Why a fan-out and not another script

The repo already owns the detector floor — `npm run qa:guardian` runs `test:fast` →
`test:http` → `shoot` → `golden` → `audit` → `qa:journeys` against a pinned copy of trunk and
files deduped ledger findings. **Every one of those is a regression detector.** They prove
known-good behavior did not break. None of them can find a defect on a surface nobody wrote a
test for — and that is where the bugs are.

Look at what actually shipped-and-was-caught recently: the voice cold-off guillotining a reply
mid-stream, `/approvals on` silently cutting a Telegram agent from 59 tools to 4, the skill
guard's verdict having zero consumers, `/skill` preload throwing ReferenceError into its own
swallowing catch, Settings claiming "No standing approvals" when the sidecar was offline.
**Not one of those was found by a script.** Every one was found by an agent walking a failure
state live. So the sweep is agents, and the scripts are the floor they stand on.

## Launching

One Claude Code session per lane, each in its own worktree on its own `agent/sweep-<surface>`
branch, per the repo worktree protocol:

```bash
node scripts/qa/bugs.mjs --list --status open
```

Then in each session: *Read `loops/sweep/<surface>.md` and execute it fully.*

Ten lanes is the full sweep. Fewer? Take them in this order — it is ranked by how much a defect
there costs a real user: **safecell → providers → channels → sessions → autonomy → skills →
onboarding → voice → world → release**.

## The protocol every lane obeys

1. **Grep trunk before believing anything.** Plans, audits, memory and this file go stale in
   HOURS on a multi-agent trunk. "X is missing" is a hypothesis until you grep for the symbol.
   The most expensive recent mistake in this repo was an agent reporting its own harness
   missing four capabilities that had all already shipped.
2. **Read the register first**, so you never re-find what another lane already owns:
   `node scripts/qa/bugs.mjs --list --surface <yours>`.
3. **Hunt failure states, not happy paths.** 476 test files already cover the happy path. Your
   value is entirely in what happens when things go wrong: empty/huge/unicode input,
   double-submit, rapid toggle, mid-run reload, sidecar restart mid-operation, revoked
   permission, expired token, offline endpoint, two agents at once, provider 429.
4. **Rank by what it costs:** CORRUPTS STATE > LIES > SPENDS MONEY > HANGS > UGLY ERROR. The
   product's core promise is truthful telemetry, so *the app asserting something the backend
   cannot prove* is a P0 here even when it looks cosmetic.
5. **Evidence or it didn't happen.** A DOM round-trip, a log line, the bytes that reached the
   provider, a screenshot. Never a claim alone, and never a claim from reading source — this
   repo has shipped bugs that every unit test and every HTTP test passed straight through.
6. **Fix small, file big.** A clear defect under ~30 lines: fix it in YOUR branch, gate green,
   leave it for the merge lane. Anything larger: file it and move on. Lanes do not start
   feature work.
7. **File everything you find** — including what you fixed:

```bash
node scripts/qa/bugs.mjs --new --title "..." --surface <surface> --severity P1 --lane sweep/<surface>
```

Then fill in `## Symptom`, `## Repro` and `## Evidence` (an unfilled bug fails the gate),
run `npm run qa:bugs:index`, and **commit the bug file on your branch**. That is what makes
your finding survive your session. Closing one:

```bash
node scripts/qa/bugs.mjs --set <fingerprint> --status fixed --fix <commit-sha>
```

8. **Never** touch another worktree, the integration tree, `shared/events.js`, or
   `shared/schema.js`. If your fix moves a locked release-surface file, the claims re-lock is
   **owed in your lane**, as its own commit — never forward-fixed on trunk.
9. **Report honestly.** "Found 3, fixed 1, 2 filed, live check not done on X" is a good report.
   A false "done" is the cardinal sin here.

## What each lane owes at the end

- The register rows it filed (committed on its branch).
- `npm run test:fast` green on its branch, or the exact red step named.
- One paragraph: what it walked, what it found, what it did NOT get to.

A lane that finds nothing still reports — silence is indistinguishable from a dead session.
