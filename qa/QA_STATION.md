# QA STATION — the runbook (STAND UP THE WATCH)

> **What this is:** the operating manual for StarNet's Self-Testing Station — the crew of
> scripts + Claude sessions that finds breakage so **Andrew doesn't have to be the
> bug-finder**. Charter: `docs/SELF_TEST_STATION_PLAN.md` (Parts 2/3/5 for the crew, the
> findings spine, and the laws). Live dashboard: `qa/STATUS.md`. Known baseline:
> `qa/KNOWN_ISSUES.md`. Every claim below was verified against trunk `feat/harness-backend`
> @ `ef47f9d` on 2026-07-01.
>
> **The one rule that shapes everything:** *scripts detect + ledger; sessions judge + notify.*
> A `node` script NEVER pings Andrew — it appends a deduped finding and exits nonzero on red.
> A Claude session (Overseer / Visual Auditor) reads the ledger, decides, and is the only
> thing that ever notifies. Keep that split and the station stays honest and quiet.

---

## Table of contents

1. [At a glance — the crew](#1--at-a-glance--the-crew)
2. [Green Guardian](#2--green-guardian)
3. [Beginner Run](#3--beginner-run)
4. [Truth Auditor](#4--truth-auditor)
5. [Visual Auditor](#5--visual-auditor)
6. [Overseer (the daily digest)](#6--overseer-the-daily-digest)
6b. [Ledger reconcile — is the register still true?](#6b--ledger-reconcile--is-the-register-still-true)
7. [Janitor](#7--janitor)
7b. [Cartographer](#7b--cartographer)
7c. [Perfectionist](#7c--perfectionist)
7d. [Red→Green Closer](#7d--redgreen-closer)
8. [Port registry](#8--port-registry)
9. [The notification rule](#9--the-notification-rule)
10. [KNOWN_ISSUES triage flow](#10--known_issues-triage-flow)
11. [Scheduling — the decision & the glue](#11--scheduling--the-decision--the-glue)
12. [Cold start — stand the whole watch up on a fresh machine](#12--cold-start--stand-the-whole-watch-up-on-a-fresh-machine)
13. [Activation — the single command that turns the watch ON](#13--activation--the-single-command-that-turns-the-watch-on)

---

## 1 · At a glance — the crew

| Crew member | Question | Runner | Launch line | Cadence | Output |
| --- | --- | --- | --- | --- | --- |
| **Green Guardian** | Is trunk green + does the app boot/look right? | script | `npm run qa:guardian` | per-merge (`--watch`) **and/or** hourly | ledger + `qa/STATUS.md` + `.bugloops/guardian-<stamp>/` |
| **Beginner Run** | Can a fresh user reach first value, unassisted? | script | `npm run qa:beginner` | daily `--ui-only`; weekly `--live` | ledger + `qa/STATUS.md` + `.bugloops/beginner-<stamp>/` |
| **Truth Auditor** | Does the UI show what actually happened? | script | `npm run audit` (also runs inside every Guardian cycle) | every Guardian cycle | `.uiaudit/audit-report.json` |
| **Saboteur** | Do hostile inputs or authority mutations break a real sidecar? | script | `npm run qa:saboteur` (also runs inside every Guardian cycle) | every Guardian cycle | ledger + `.bugloops/saboteur-<stamp>/report.json` |
| **Visual Auditor** | Is the rendered game coherent? *(needs eyes)* | **session** | `/loop` per `scripts/VISUAL_AUDITOR.md` | self-paced, local | `SESSIONS.md` + re-shot PNGs |
| **Overseer** | What broke today, what needs Andrew? | **session** | `/loop` reading the ledger | daily | `qa/digests/<date>.md` + P0 pings |
| **Janitor** | What's rotting in the workshop? | script | `npm run qa:janitor` | weekly | ledger (P2) + `qa/digests/janitor-<date>.md` |
| **Cartographer** | Is every surface element mapped (nothing un-enumerated)? | script | `npm run qa:atlas` | weekly + after big merge waves | registry `qa/atlas/areas/*.json` + `ATLAS.md` + `qa/STATUS.md` + ledger (P2 dead-entry) |
| **Perfectionist** | Is every surface element correct, purposeful, polished? | **session** | `/loop` per `loops/perfectionist.md` | self-paced, local | registry judgment fields + ledger + routed fixes |
| **Red→Green Closer** | Can a detected defect be turned into a PROVEN patch? | script + **session** | `npm run qa:closer -- --open <fp>` then `--referee <runId>` | per open finding | `qa/closer/<runId>/` (winner.patch + VERDICT.md) |

Two runner kinds, cleanly separated (Charter Part 2):
- **Scripts** — node, headless, no vision. Detect, write findings, exit nonzero. Never notify.
- **Sessions** — Claude `/loop` on Andrew's machine. Read findings, look at pixels, judge,
  route, notify. Scripts detect; sessions decide.

---

## 2 · Green Guardian

**Answers:** "Is trunk green and does the app still boot + look right?"
**Script:** `scripts/qa/guardian.mjs` · **Ports:** 8940–8949 (CDP 9340–9349).

One cycle pins trunk HEAD into a **dedicated** detached worktree (`../_qa-guardian-pin`,
override `SKYNET_GUARDIAN_PIN`; created + `npm install`'d on first run, `git reset --hard`'d
to trunk each cycle) and composes the detectors in dependency order:
`test:fast` → `test:http` → `qa:saboteur` → `shoot` → `golden` → `audit` → `qa:journeys`.
The Saboteur uses a replayable seed to attack every literal API route's token/origin boundary
plus malformed payloads on stateful seams; it always uses a disposable seeded workspace. It
files ONE deduped finding per regression
(fingerprinted per failing suite / frame / assertion), refreshes the Guardian row in
`qa/STATUS.md`, and exits nonzero on any red. **STATUS.md + findings are written into the
Guardian script's OWN repo** (resolved from `import.meta.url`), so the dashboard survives the
pin's next `reset --hard`.

### Launch lines
```bash
npm run qa:guardian                    # one cycle; exit 0 green / 1 red or BLOCKED
npm run qa:guardian -- --skip-visual   # test:fast + audit only (no Chrome; CI-lite)
npm run qa:guardian:watch              # poll trunk HEAD; run a cycle each time it MOVES
npm run qa:guardian:watch -- --interval 120   # poll every N seconds (default 60)
```

### Cadence — run it BOTH ways (they cover different failure windows)
- **Per-merge (primary): the long-running `--watch` process.** `qa:guardian:watch` polls
  `git rev-parse` on trunk (cheap) and fires a full cycle the instant HEAD moves — i.e. the
  moment any lane merges. This catches **parallel-breakage** (a merge broke another lane)
  within one cycle, which is the whole point. Run it as a persistent process (see §11).
- **Hourly (belt-and-suspenders): a scheduled one-shot.** A Task Scheduler entry running
  `npm run qa:guardian` hourly re-verifies trunk even when nothing merged (catches
  environment drift, flaky-then-real failures, and covers any window where the watch process
  died).
- Use `--skip-visual` for a Chrome-free fast lane on machines/CI without a display; the full
  visual gates (`shoot`/`golden`/`audit`) need headless Chrome.

> **Overlap is NOT harmless — a lock serializes it (fixed 2026-07-08).** The hourly one-shot,
> the standing `--watch` process, and any manual run all target the **same** pinned worktree
> and the **same** 8940–8943 port range. Before the lock they collided physically: two
> `git reset --hard` / `git worktree` operations raced on the shared
> `.git/worktrees/**/index.lock` (finding **90fe0bcc**: *"Unable to create …/index.lock: File
> exists. Another git process seems to be running"*), and two sidecars fought for the same
> ports, timing the visual gates out into **BLOCKED P0s** (findings 9b077d5e / 6fc6c002). Dedup
> only stops a *standing red* from filing twice — it does **nothing** about two processes
> corrupting each other's checkout mid-run. The earlier claim that "the two overlap harmlessly"
> was **false**. The Guardian now takes a **machine-global cross-process lock** (a heartbeat
> lockfile at `%TEMP%/starnet-qa-guardian.lock`, override `SKYNET_GUARDIAN_LOCK`, with
> PID-liveness + stale-heartbeat reclaim). A one-shot that fires while a cycle is running finds
> the lock held and **exits 0 as redundant** (the running cycle already covers this or a newer
> trunk); pass `--wait` to queue instead. `--watch` takes the lock per-cycle and **skips** a
> poll whose head it can't lock, retrying once the lock frees. So the three launch styles now
> **serialize** instead of clobbering — the `_qa-guardian-pin` divergence + BLOCKED-P0 wedge is
> structurally gone.
>
> **Dismissed findings no longer pin the cycle RED.** A gate can exit nonzero on a defect that
> was already **triaged + dismissed** in the ledger (e.g. the J2b panel-close busy-poll flake,
> finding `6feab179` — reproduced PASS in isolation, only flakes under CPU starvation). By the
> anti-nag law a dismissed defect must never re-nag, yet a bare nonzero exit still forced the
> STATUS row RED and blocked `qa:ready` forever. The Guardian now treats a red (non-BLOCKED)
> gate whose **every** derived finding is on the dismissed/known baseline as **review-clean** —
> exactly as the golden gate already does per-frame — so the dismissal takes effect at the cycle
> verdict. `journeys.mjs` mirrors this for its own exit code (so `journeys-last-run.json` records
> `pass`), and a genuinely BLOCKED detector is **never** excused this way (no-fake-green holds).

### What RED means
Exit code **1** = a real regression OR a BLOCKED step. Concretely:
- **`test-fast` red (P0):** a unit/contract suite failed on trunk. The merge gate itself is
  broken — trunk is not shippable. One finding per failing suite.
- **`shoot` red (P1):** a UI state failed to open / the app never booted in-game. One
  finding per failing state (from `manifest.json`).
- **`golden` red (P1):** a frame moved beyond the animation-noise floor — a merged branch
  changed the look. One finding per flagged frame (from `golden-report.json`). If the change
  is a legitimate improvement, a human re-blesses (`npm run golden:bless`) — the Guardian
  only detects.
- **`audit` red (P1):** the UI claimed a state the harness can't prove (hard-failing
  assertion; soft failures are environment signals, never build failures). One finding per
  assertion (from `audit-report.json`).
- **BLOCKED (P0):** a step could not even run (git/npm/spawn failure, timeout, missing
  report). Filed loudly; the cycle never silently passes (No-fake-green law, Part 5).

Evidence for every cycle lands in `.bugloops/guardian-<stamp>/` (per-step logs, flagged
golden PNGs, gate reports). **The Guardian never notifies** — a red cycle surfaces to Andrew
only through the Overseer digest (§6) / the P0 rule (§9).

---

## 3 · Beginner Run

**Answers:** "Can a brand-new user reach first value, unassisted, in under 10 minutes?"
**Script:** `scripts/qa/beginner-run.mjs` · **Ports:** 8950–8959 (CDP 9350–9359).

CDP-drives the **cold** fresh-install path (NOT the seeded one every other detector uses):
boots a sidecar with `SKYNET_WORKSPACES=<OS-temp>` (empty → the connect screen shows) and
**without** `SKYNET_DEV` (so nothing auto-resumes — the connect screen + awakening run for
real). It steps title → connect → create-agent → awakening → first-directive, screenshotting
and timing **every** step, with a per-step budget and a total budget of **10 minutes** (the
product-thesis number). On a stall: it screenshots the stuck frame, files a P0 finding
fingerprinted on the stuck step, and exits nonzero.

### Launch lines
```bash
npm run qa:beginner                    # --ui-only (default): every screen REACHABLE up to the LLM boundary
npm run qa:beginner:live               # --live: real key from env, full path to a first deliverable
# useful flags:
npm run qa:beginner -- --keep          # keep the temp workspace + browser profile for inspection
npm run qa:beginner -- --step-scale 2  # 2× every per-step budget (slow machines)
```

### Cadence
- **Daily `--ui-only`.** No key, no cost, ~84s on this machine (verified 2026-07-01). Asserts
  every screen/control on the fresh path is reachable up to the first real `/api/run`
  (the awakening ceremony is client-scripted, so it's 100% reachable UI-only; reaching the
  LLM boundary is a PASS — we never fake an LLM reply).
- **Weekly `--live`.** Drives the full path through a real first deliverable. This is the
  only crew run that spends tokens — see the cost note below.

### `--live` env-var contract (HARD: never in files, never echoed)
The real key is sourced **from the environment ONLY** — never committed, never echoed, never
written into any evidence file. After a `--live` run the CLI automatically runs
`npm run lint:evidence-secrets` over the run dir to prove no key leaked into a screenshot or
log; if the lint trips, the run fails.

- Default env var: **`SKYNET_OPENROUTER_KEY`** (fallback **`STARNET_OPENROUTER_KEY`**).
- Override the var name with `--key-env <NAME>`.
- If `--live` is passed and the var is empty, the script **refuses to run** (loud error, no
  boot) — it never falls back to a placeholder.
- Set it in the session's environment only, e.g. (PowerShell, current shell only):
  ```powershell
  $env:SKYNET_OPENROUTER_KEY = (Get-Content "$HOME\.claude\projects\C--Users-<you>-Desktop-gen\memory\.openrouter-key" -Raw).Trim()
  npm run qa:beginner:live
  Remove-Item Env:\SKYNET_OPENROUTER_KEY   # scrub it back out when done
  ```
  Do NOT put the key in `.env`, a launch.json, a scheduled-task definition, or anywhere on
  disk. The weekly `--live` run is a **session** task (a human/agent exports the key for that
  one run), never a headless scheduled task.

### Cost note (`--live`)
A `--live` pass drives the fresh path through create-agent → awakening → first directive →
first deliverable. The awakening ceremony is client-scripted (**zero** model calls); the only
billed work is the tutorial's first command plus the first-deliverable run — a handful of
`/api/run` turns. With the placeholder default model (`anthropic/claude-3.5-sonnet` class,
via `SKYNET_DEFAULT_MODEL`) that's on the order of a **few thousand tokens total** — pennies
per run. It is safe as a **weekly** cadence; do not put it on an hourly/daily loop (cost +
rate-limit noise for no added signal — `--ui-only` already covers reachability daily).

### What RED means
Exit nonzero = the fresh user got stuck. The finding names the exact stuck step
(`boot` / `title` / `connect` / `create-agent` / `awakening` / `first-directive` /
`first-deliverable`), with the stuck screenshot as evidence in `.bugloops/beginner-<stamp>/`.
This is the **beginner-confusion** tripwire: onboarding regressed and a machine caught it
instead of Andrew. This script is the *ruler* the zero-to-value session optimizes against —
it measures, it does not fix.

---

## 4 · Truth Auditor

**Answers:** "Does the UI show what actually happened?" (the anti **app-lies** detector.)
**Script:** `npm run audit` (`scripts/audit.mjs`) · runs on the Guardian's ports inside a
Guardian cycle (8942/9342), or on 8930s ad-hoc when run standalone.

The audit boots a seeded sidecar and asserts, for each scenario, that the *displayed* state
equals the *event-reduced truth* — it cannot be fooled by a UI that lies. It is composed into
**every Green Guardian cycle** as the fourth gate, so under normal operation you never run it
by hand; the Guardian files any hard-failing assertion for you.

### Run it standalone
```bash
npm run audit                          # all scenarios; nonzero exit on any HARD-failing assertion
```
Report → `.uiaudit/audit-report.json`; a failing frame is captured in `.uiaudit/`. Current
trunk state: 44/45 assertions pass, **1 known soft skip** (soft failures are environment
signals, never build failures — mirrored by the Guardian's parser). The two expected
placeholder-key artifacts are pre-loaded in `qa/KNOWN_ISSUES.md` and never re-file.

### What RED means
A hard assertion failed: a panel is claiming state the harness can't prove. That is exactly
the class of bug that ships "green in unit tests, broken live" — always live-smoke `npm run
audit` after touching the harness (No-fake-green law precedent: the rebrand-drift bug).

---

## 5 · Visual Auditor

**Answers:** "Is the rendered game *coherent*?" — overlap, off-center, clash, disconnected,
unpolished, untruthful. **This one needs eyes**, so it is NOT a headless script and NOT
schedulable as a cron/Task-Scheduler job.

**It runs as a local Claude `/loop` session with vision.** The authoritative runbook is
**`scripts/VISUAL_AUDITOR.md`** — do not duplicate it here; that file owns the launch line,
the incoherence rubric, the golden-diff triage (read ONLY changed frames), and the small-fix
mandate. In one sentence: open a Claude Code session in the repo and run the `/loop` prompt
at the top of `scripts/VISUAL_AUDITOR.md`; it shoots every UI state (ports **8930–8939**),
reads each PNG, catalogs incoherence, fixes small cross-cutting issues in the `live-polish`
worktree + re-shoots to confirm, and routes bigger ones to UI-SHELL / WORLD-GAME.

**Cadence:** self-paced, on Andrew's machine (it needs the local app + vision). It is the
sibling of the Overseer loop — one watches pixels, the other watches the ledger.

---

## 6 · Overseer (the daily digest)

**Answers:** "What broke today, and what needs Andrew?" **This is a session, not a script** —
it is the only crew member that judges the whole ledger and notifies.

The digest itself is *rendered* by the ledger CLI; the Overseer **session** runs it daily,
saves it, reads it, and pings on P0.

### Render the digest
```bash
node scripts/qa/ledger.mjs --digest                 # today, to stdout (grouped P0→P1→P2, then by crew)
node scripts/qa/ledger.mjs --digest --write         # ALSO persist to qa/digests/<today>.md
node scripts/qa/ledger.mjs --digest --date 2026-07-01 --write   # a specific day
node scripts/qa/ledger.mjs --status                 # live per-crew roll-up (the STATUS.md table, fresh)
```
Every finding in the digest carries its evidence path + fingerprint (Evidence law: no finding
without an artifact). `--write` lands it at `qa/digests/<date>.md`.

### The Overseer `/loop` session prompt
Open a Claude Code session in the repo (`C:\Users\<you>\Desktop\gen`) and run:

```
/loop 24h  Run one Overseer cycle: render today's QA digest with
  `node scripts/qa/ledger.mjs --digest --write`, read it, and triage.
  For each OPEN finding: confirm it against its evidence path, then either ROUTE it to the
  owning feature session (note the owner in the finding / SESSIONS.md and set status=routed
  via the ledger) or DISMISS it if invalid (status=dismissed — dismissed fingerprints never
  re-file). If ANY P0 is open, NOTIFY Andrew immediately (push/Telegram/Discord — see §9)
  with the P0 title + evidence path; P1/P2 wait for the morning digest. Scripts never notify —
  YOU are the notifier. Compare today's digest against yesterday's to spot new vs. standing
  issues. Write nothing outside qa/ and the ledger.
```

`24h` fires it daily; drop the interval to self-pace. It reads `qa/digests/`, writes today's
digest, and is the single throat-to-choke for notifications. **On P0 it notifies; on P1/P2 it
lets the morning digest do the talking** (anti-nag).

---

## 6b · Ledger reconcile — is the register still true?

**Question it answers:** *which "open" rows are already fixed on trunk?* The register drifts stale
in the FIXED direction — an audit found ~25 of 28 open `qa/bugs/` records already closed by code on
trunk, and the Janitor seat carried 400+ open rows nobody re-checked. A backlog that over-reports
stops being an authority (docs/MISTAKES.md law #2: plan docs lie within hours — the register is a
plan doc too), and lanes re-build fixes that already shipped.

`scripts/qa/ledger-reconcile.mjs` re-checks every record's **machine-checkable anchors** against
the current tree and writes one row per record / finding:

| Anchor the record names | What is checked |
| --- | --- |
| a fix commit (`fix:` or a sha in `## Verdict`) | `git merge-base --is-ancestor <sha> HEAD` |
| a test path (`test/x.test.js`) | exists? `node test/x.test.js` green? (a test named in `## Verdict` is the fix's REGRESSION — hard evidence; one named elsewhere is pre-existing coverage — weak) |
| a file[:line] + the defective code quoted in backticks | does that code still exist in the cited file (then anywhere under the code roots)? |
| Janitor findings (removable worktree / stranded branch / dead doc ref) | `git worktree list`, branch exists / merged, the doc still cites the missing file |

| Verdict | Meaning |
| --- | --- |
| `likely-fixed` (`hard` / `soft`) | fix commit is an ancestor, or the quoted defect code is gone. **hard** = a passing regression test agrees |
| `still-open` | a named test is RED, or the quoted defect code is still present |
| `unverifiable` | no anchor a machine can re-check — the row says WHICH anchor it needs |

**It closes nothing.** A closure still goes through the register flow with a human reading the row:
`node scripts/qa/bugs.mjs --set <fp> --status fixed --fix <sha> --verdict "..."` (which regenerates
`qa/BUGS.md`). Closed records are always audited too (is the recorded `fix:` actually on this tree?).

```
npm run qa:reconcile                      # open records + closed audit + ledger findings; runs named tests
node scripts/qa/ledger-reconcile.mjs --all        # judge closed records by their anchors too
node scripts/qa/ledger-reconcile.mjs --no-run     # anchors + git only, no test execution (seconds)
node scripts/qa/ledger-reconcile.mjs --json       # the result object to stdout
npm run qa:reconcile:ci                   # --ci: exit 3 if a likely-fixed record is still open > 7 days (--stale-days N)
node scripts/qa/ledger-reconcile.mjs --findings-dir <path>   # reconcile another checkout's qa/findings
```

Report lands at `qa/digests/reconcile-<date>.md` + `.json` (machine-local like every digest; pass
`--no-write` to skip). Named tests run under the same hermetic app-data profile as the gate runner;
suites on `test/http.list` are reported "not run here" unless `--http` (a bare `node` of one is
red for environment reasons and would read as a false still-open).

**Law 7 (2026-08-21) — a new bug record must carry an anchor.** `bugs.mjs --validate` (in
`test:fast` via `test/qa-bugs-register.test.js`) refuses a record found on/after 2026-08-21 that
names no test path, no `file:line`, and no quoted code. Older anchor-less records are grandfathered
and listed by the report so they can be back-filled. `ledger.mjs --status` now also shows the age of
each crew's oldest open finding and how many are older than 30 days, so volume reads as age, not as
400 live defects.

**Cadence:** `qa:reconcile:ci` in the merge ritual / Guardian cycle (seconds, no tests); the full
`qa:reconcile` weekly alongside the Janitor, and before any register closure commit.

---

## 7 · Janitor

**Answers:** "What's rotting in the workshop?" — merged-but-not-removed worktrees, stranded
branches, root-litter PNGs/logs, docs referencing deleted files, evidence-dir bloat.
**Script:** `scripts/qa/janitor.mjs` · no sidecar, no ports.

**Propose-only, always (Part 0 + read-only law).** The Janitor NEVER deletes, prunes, or
edits anything outside its own report + ledger findings. For a removable worktree it prints
the exact `remove-agent-tree.ps1 <name> -DeleteBranch` command for a human/orchestrator to
run — it never runs it. Hygiene findings are **P2** (informational, never a merge blocker).

It **watches the MAIN integration tree read-only** (git metadata is shared; `git -C <path>
status` is a read) and **writes only into its own checkout** (`qa/findings/`, the digest, its
STATUS row). Point writes elsewhere with `--out-root <dir>` or `QA_JANITOR_OUT` — it will
**never** default writes to MAIN.

### Launch lines
```bash
npm run qa:janitor                     # sweep; write report + file findings + update STATUS row
npm run qa:janitor -- --dry-run        # sweep + print the report; file NOTHING (no writes)
npm run qa:janitor -- --stale-days 30  # override the 14-day "stranded branch" threshold
```

### Cadence
**Weekly.** Hygiene drifts slowly; a weekly `--dry-run` for review, promoted to a real filing
run when Andrew wants the findings in the digest, is plenty. Report → `qa/digests/janitor-<date>.md`.

### What "red" means
The Janitor exits **0 on a clean sweep** (P2 hygiene is never a blocker) and nonzero **only
if the sweep itself could not run** (BLOCKED loudly). Its findings are proposals, not alarms —
they show up in the Overseer digest for a human to action the printed commands.

---

## 7b · Cartographer

**Answers:** "Is every surface element ENUMERATED — is anything un-mapped or vanished?" This is the
**script half** of the perfection loop. The regression crew above proves trunk stays green; the
Cartographer proves the *surface* is fully accounted for. It is the sibling of the Perfectionist
session (§7c) — one enumerates, the other judges.
**Script:** `scripts/qa/cartographer.mjs` · **Ports:** 8920–8929 (CDP 9320–9329) · **Registry:**
`qa/atlas/` (charter: `qa/atlas/README.md`).

One `--sweep` does two enumerations and merges the result into a sharded registry:

1. **Static** (no browser): slash commands (`sidecar/slash.js` catalog, built-ins only), API routes
   (every `req.method === … && <url match>` guard form AND every declarative `ROUTES` table entry
   — `{ m: '<METHOD>', exact|qsplit|prefix|qprefix: '/api/…' }` — in `sidecar/index.js`; the sweep report prints
   *matched vs. method-guard count* so a miss is visible), bus events (`shared/events.js` `EVENTS`
   keys — READ ONLY, an owned contract file), and shoot states (`buildStates()` from
   `scripts/lib/states.mjs`).
2. **Live DOM** (skipped under `--static-only`): boots the seeded sidecar exactly like `journeys.mjs`,
   walks every `buildStates()` state, and enumerates every interactive element (`button`, `[role]`,
   `a[href]`, inputs, `[data-term]`, …) with a stable key, deduped across states (first state wins).

**Merge = the station law made mechanical** (`qa/atlas/README.md`): a new element → a SKELETON entry
(`status: unmapped`, harvested fields filled); an existing one → `lastSeen` refreshed and **nothing a
session decided**; an entry of a swept kind no longer found → `missing: true` + ONE deduped **P2
`dead-entry`** ledger finding. Skeletons are NOT findings — the registry itself is the queue; the
ledger only ever hears about *vanished* entries.

### Launch lines
```bash
npm run qa:atlas            # full sweep: static enum + live DOM walk (ports 8920/9320); merge shards
npm run qa:atlas:static     # static half only (slash/routes/events/states) — no Chrome, fast
npm run qa:atlas:status     # gauge (PERFECTED-fresh X/Y) + regen qa/atlas/ATLAS.md + STATUS row
```

### Cadence
**Weekly + after big merge waves.** The surface drifts when features land: a merge wave adds routes /
commands / UI controls, so a sweep after one keeps the registry from going stale. The keyless static
half (`qa:atlas:static`) is safe to run any time; the live half needs headless Chrome + a free 8920s
port, exactly like the other visual crew.

### Evidence + STATUS + no-fake-green
Every sweep writes `.uiatlas/sweep-report.json` (counts per kind/area, new + missing lists, states
walked, elements per state) and `.uiatlas/sweep.log`. `--status` refreshes the **Cartographer** row in
`qa/STATUS.md` (single-row splice; inserted after the Janitor row if absent) and regenerates the
generated `qa/atlas/ATLAS.md` index. Findings are filed through `scripts/qa/ledger.mjs --add` so
dedup / known-refusal stay the ONE implementation. **The Cartographer never notifies.** Exit codes:
**0** clean sweep · **1** the sweep ran and filed `dead-entry` findings · **2** BLOCKED (boot/CDP
failure, a state drive `NOTFOUND`, a spawn error) — a P0 BLOCKED finding is filed with the log path as
evidence and the cycle never silently passes (No-fake-green law, Part 5).

---

## 7c · Perfectionist

**Answers:** "Is every surface element CORRECT, purposeful, and polished?" This is the **session half**
of the perfection loop — the judgment crew that consumes the Cartographer's registry and drives every
entry to `perfected`. **It needs judgement (and live-app proof), so it is NOT a headless script** and
NOT schedulable as a cron/Task-Scheduler job — like the Visual Auditor and the Overseer, it is a local
Claude `/loop` session.

**It runs on Opus** (repo delegation law), driven by **`loops/perfectionist.md`** — that file owns the
launch prompt, the 7-point rubric, and the DISSECT→PROVE→JUDGE→file→promote cycle; do not duplicate it
here. In one sentence: pick ONE area batch by priority (escapes-adjacent first, then user-traffic
order; stale before unmapped), claim it in `docs/NEXT.md`, trace each entry's full seam and fill
`purpose`/`promise`/`wiring`, PROVE the promise live (DOM round-trips + `window.__world` reads, never
screenshots), judge against the rubric (purpose · promise · works · truthful · discoverable · polished ·
covered), file every miss through the ledger and **route the fix to a feature lane** (never fix in the
QA lane), and set `status: perfected` + `auditedAt` only when all seven hold.

**Cadence:** self-paced, on Andrew's machine (it needs the local app + live proof). Multiple
Perfectionist sessions may run at once **only on different areas** (the sharded registry makes that
safe — the one-session-one-area law in `qa/atlas/README.md` + `docs/MISTAKES.md` #4). The convergence
gauge is `npm run qa:atlas:status`; the loop never ends because **staleness re-queues work** — a
`perfected` entry whose wired files change since `auditedAt.sha` drops back into the queue.

---

## 7d · Red→Green Closer

**Answers:** "Can a detected defect be turned into a PROVEN patch — without a human in the middle?"
Every other crew member above ends at *route it to a lane*. The Closer is the edge that was
missing: a red finding goes in, a patch that a **script** proved goes out.
**Script:** `scripts/qa/closer.mjs` (the referee) · **Session:** `loops/red-green-closer.md` (the
repair agents) · **Ports:** 8970–8979 (CDP 9370–9379) · **Runs:** `qa/closer/<runId>/`.

Because it is the only crew member that *writes code*, it is the one held to the hardest standard.
Three locks, each aimed at a specific way a self-repair loop rots:

1. **Write-set lint — mute-the-alarm.** The cheapest fake fix is editing the detector: weaken the
   assertion, re-bless the golden, drop the suite from `test/fast.list`, add the fingerprint to
   `KNOWN_ISSUES.md`, neuter the npm script. A candidate whose patch touches any of those is
   **DISQUALIFIED before the gate is run** — it never gets the chance to go green by lying. The
   rule is directional: **ADDING** a test is encouraged, **modifying/deleting/renaming** one is a
   violation. `test/` is protected on *every* gate, not just `test-fast`, because `test:fast` is
   the collateral gate on every run — otherwise a golden fix could quietly silence a unit test it
   broke.
2. **Oracle separation — grading your own homework.** The candidate's tree never gates. The referee
   exports the diff, resets **its own** checkout to the base sha, applies the patch there, and runs
   the gate itself. Candidate worktrees are provisioned **without `node_modules`** by default, so a
   repair agent physically cannot run the gate that judges it (`--install-candidates` opts out for
   agents that want to iterate; the verdict is unaffected either way).
3. **Baseline-RED proof — the detector that never detects.** Before *any* patch is credited the
   referee runs the gate at the base sha and requires **RED**. A green baseline BLOCKS the whole
   run (`baseline-not-red`): the finding is stale, the repro is wrong, or the detector is flaky —
   and in all three cases a "passing" patch proves nothing. Without this lock a flaky gate hands
   out wins for empty diffs.

### Launch lines
```bash
npm run qa:closer -- --open <fingerprint> --candidates 3   # provision candidate worktrees + briefs
npm run qa:closer -- --referee <runId>                     # judge every candidate; crown a winner
npm run qa:closer:list                                     # every run and its verdict
npm run qa:closer -- --status <runId>                      # one run's VERDICT.md
npm run qa:closer -- --close <runId>                       # remove candidate worktrees (evidence kept)
```

Each candidate worktree gets `CLOSER_BRIEF.md` at its root — the whole contract handed to one
repair agent, including the **refusal path**: an agent that concludes the detector itself is wrong
writes `CLOSER_VERDICT.md` and changes nothing, because retiring a detector is a human's call.

### What each verdict means
- **winner** (exit 0) — the failing gate went green on a clean tree and `test:fast` stayed green.
  The patch lands at `qa/closer/<runId>/winner.patch`. **The Closer never merges** — that goes to
  the merge ritual. Ties break on smallest patch (lines, then files), so a two-line fix beats a
  scattershot rewrite that passes the same gate.
- **no-winner** (exit 1) — every candidate was disqualified, failed to apply, or left the gate red.
  The finding stays open. Nothing is filed: the defect already has a finding, and a second
  "we couldn't fix it" row is exactly the nagging the anti-nag law forbids.
- **BLOCKED** (exit 2) — the Closer could not judge. This is the only case that files, as its own
  **P0** (no-fake-green law): a Closer that cannot judge never crowns a winner.

### Cadence
Per open finding, self-paced — it is pointless on an empty ledger and worth running the moment the
Guardian has a standing red. One run at a time: a machine-global lock (`starnet-qa-closer.lock`,
same law as the Guardian's) serializes the shared referee checkout and the 8970s ports; a second
run exits 0 as redundant.

---

## 8 · Port registry

Loops must not collide — multiple sidecars may run at once (Charter Part 3 / Part 5 port law).
Each crew boots sidecars **only** in its assigned range. Mirrored in `qa/STATUS.md`.

| Range | Owner | CDP range |
| --- | --- | --- |
| 8920–8929 | Cartographer (live DOM sweep, default 8920/9320) | 9320–9329 |
| 8930–8939 | Visual Auditor (`scripts/VISUAL_AUDITOR.md`) | 9330–9339 |
| 8940–8949 | Green Guardian (shoot 8940/9340 · golden 8941/9341 · audit 8942/9342 · journeys 8943/9343) | 9340–9349 |
| 8950–8959 | Beginner Run (default 8950/9350) | 9350–9359 |
| 8960–8969 | Ad-hoc / manual (Perfectionist sessions boot here) | 9360–9369 |
| 8970–8979 | Red→Green Closer (referee re-runs a gate: shoot 8970 · golden 8971 · audit 8972 · journeys 8973) | 9370–9379 |

Truth Auditor has no range of its own: inside a Guardian cycle it uses the Guardian's audit
ports (8942/9342); run standalone it defaults to the 8930s.

---

## 9 · The notification rule

**Scripts never notify. Sessions notify. Only P0 pings.** (Charter Part 2 + Part 5.)

- A `node` script's only outputs are: a deduped ledger finding + a nonzero exit code on red.
  It has no push/channel access and must never gain any — that keeps the watch quiet and
  keeps the detect/decide split intact.
- The **Overseer session** is the sole notifier. Its rule:
  - **P0 open** → notify Andrew **immediately** (push / Telegram / Discord) with the finding
    title + evidence path. P0 = trunk red or the fresh user hard-stuck: things that block
    shipping or first-value.
  - **P1 / P2** → **no immediate ping**; they ride the daily morning digest.
- **Anti-nag:** fingerprint dedup means a standing failure files once, not every cycle;
  `dismissed`/`known` fingerprints never re-file. So a P0 that's already been seen and
  acknowledged does not re-ping.

---

## 10 · KNOWN_ISSUES triage flow

The lifecycle of a finding, and why the same defect never nags twice:

```
 script detects ──► ledger.add() ──► [known/dismissed fingerprint?] ──► REFUSED (never files)
                                        │ no
                                        ▼
                                   filed: status=open ──► Overseer session triages:
                                        │
              ┌─────────────────────────┼──────────────────────────────┐
              ▼                          ▼                              ▼
      ROUTE to a feature          DISMISS (invalid /            Leave OPEN (real,
      session (status=routed,     won't-fix): status=           unrouted) → rides the
      note owner in the finding    dismissed → fingerprint       next digest until actioned
      / SESSIONS.md)               NEVER re-files
```

- **Route:** a real defect the station can't fix (it only detects). Set the finding's status
  to `routed`, record the owning feature lane, and hand the evidence to that session. Fixes
  happen in normal feature lanes, never in the QA scripts (except the QA scripts' own bugs).
- **Dismiss:** invalid / expected / won't-fix. Set status `dismissed`. **Dismissed
  fingerprints never re-file** — same anti-nag law as the product. Use this instead of
  deleting, so the suppression is durable across re-runs.
- **Bless as known baseline:** for an expected-forever artifact (e.g. the placeholder-key
  audit artifacts), add a row to `qa/KNOWN_ISSUES.md` with its `fingerprint:` token — the
  ledger scrapes that file and refuses the fingerprint on `--add`. One file, no second data
  store. To retire a baseline (a real fix landed), delete its row and the crew re-files it
  fresh if it recurs.
- Check any fingerprint's state: `node scripts/qa/ledger.mjs --dedup-check <fingerprint>`.

---

## 11 · Scheduling — the decision & the glue

**Decision (this lane's call):** use **all three** runner styles, matched to each crew's
nature — do not force one mechanism onto crews it doesn't fit:

| Crew | Mechanism | Why |
| --- | --- | --- |
| Green Guardian (per-merge) | **long-running `--watch` process** | must fire the instant trunk moves; a persistent poller is the only thing that catches a merge within one cycle. Polls `git rev-parse` — cheap. |
| Green Guardian (hourly) + Janitor (weekly) | **Windows Task Scheduler** | pure time-triggered, headless, no key, no judgement — the textbook cron case. |
| Beginner Run (`--ui-only` daily) | **Task Scheduler** | headless, no key, deterministic — safe unattended. |
| Beginner Run (`--live` weekly) | **session task** (human/agent exports the key for one run) | spends tokens + needs a secret from env; must never live in a scheduled-task definition. |
| Overseer (daily) + Visual Auditor | **Claude `/loop` session** | they *judge* and *notify* / need *eyes* — a script can't do either. |

**Why not "one Task Scheduler for everything":** two crew members (Overseer, Visual Auditor)
require a Claude session (judgement + vision) and cannot be a headless task; and `--live`
Beginner requires a secret that must never be written into a task definition. **Why not "just
`/loop` sessions for everything":** the purely-mechanical, keyless, headless jobs (hourly
Guardian, daily `--ui-only`, weekly Janitor) don't need a Claude session burning tokens to
babysit them — Task Scheduler is cheaper and survives reboots. So: **Task Scheduler for the
headless keyless jobs, a standing `--watch` process for per-merge, `/loop` sessions for the
judging/vision/secret jobs.**

**HARD CONSTRAINT — prepare, do not execute.** This lane PREPARES the scheduling glue but
never registers a task or launches a persistent process. Registration is the orchestrator's
explicit final activation step (§13). The glue is a single script:

### `scripts/qa/register-watch.ps1` (prepared, NOT run)
A PowerShell script that registers the headless jobs as Windows Scheduled Tasks. It is
**inert until an operator runs it**, defaults to a **dry-run that only PRINTS** what it would
register, and only mutates the system when called with `-Apply`. It registers:
- `StarNet-QA-Guardian-Hourly` → `npm run qa:guardian` every hour.
- `StarNet-QA-Beginner-Daily` → `npm run qa:beginner` (`--ui-only`) daily.
- `StarNet-QA-Janitor-Weekly` → `npm run qa:janitor` weekly.

It does NOT register the `--watch` Guardian (that's a standing process, started once — see
§13), the `--live` Beginner (secret; session-only), or the Overseer / Visual Auditor
(sessions). Unregister with `-Remove`. See the header of `scripts/qa/register-watch.ps1` for
the exact flags.

---

## 12 · Cold start — stand the whole watch up on a fresh machine

From zero (fresh clone, no `node_modules`, no pin), in order:

1. **Toolchain:** Node (repo runs on the pinned Node; `node -v` must succeed) + a headless
   Chrome/Chromium the CDP scripts can launch (the visual gates need it; `--skip-visual` /
   `--ui-only` do not). Git with worktree support.
2. **Deps:** from the repo root, `npm install`. (The Guardian's pinned checkout `npm
   install`s itself on its first cycle — no action needed.)
3. **Smoke each headless crew member once, cheap first:**
   ```bash
   npm run qa:janitor -- --dry-run        # no ports, fastest — proves git/fs plumbing
   npm run qa:beginner                    # --ui-only fresh path (~85s); proves Chrome + CDP + sidecar boot
   npm run qa:guardian -- --skip-visual   # test:fast + audit; proves the gate composition (no Chrome)
   npm run qa:guardian                    # full cycle incl. shoot/golden (proves headless Chrome end-to-end)
   ```
   Each should print a clear GREEN/PASS and exit 0. A non-zero exit at this stage is a real
   environment problem — fix it before scheduling (No-fake-green: a detector that can't run
   must fail loudly, never be scheduled into silent-pass).
4. **Render a digest** to confirm the ledger is wired: `node scripts/qa/ledger.mjs --status`
   then `node scripts/qa/ledger.mjs --digest`.
5. **Verify the pin location** (optional): the Guardian created `../_qa-guardian-pin`
   (override `SKYNET_GUARDIAN_PIN`). It lives one level up from the repo — expected.
6. **Then activate** (§13). Scheduling is the LAST step, only after every crew member has
   smoked green by hand.

Ports 8930–8959 must be free (nothing else bound). The `--live` Beginner run additionally
needs `SKYNET_OPENROUTER_KEY` in the session env (never on disk) — but that's a weekly session
task, not part of cold-start.

---

## 13 · Activation — the single command that turns the watch ON

> **Orchestrator only.** Everything above is inert documentation + a dry-run script until an
> operator runs these. This lane does not run them.

**A. Headless scheduled jobs** (hourly Guardian + daily `--ui-only` Beginner + weekly
Janitor) — one command. Point `-RepoRoot` at the integration tree so the tasks run there:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\qa\register-watch.ps1 -RepoRoot C:\Users\<you>\Desktop\gen -Apply
```

(Works under Windows PowerShell 5.1 — no `pwsh` required. Run WITHOUT `-Apply` first to
preview the exact plan — the script is inert until `-Apply`. `-Remove` tears the tasks down.
Verified 2026-07-01: the dry-run prints all three tasks and registers nothing.)

**B. Per-merge Guardian** — start the standing watch process once (it runs until stopped;
launch it detached / in its own window / as a service wrapper of your choice):

```powershell
npm run qa:guardian:watch
```

**C. Sessions** (judgement + vision — start these as Claude Code `/loop` sessions on Andrew's
machine, not via Task Scheduler):
- **Overseer (daily):** the `/loop 24h ...` prompt in §6.
- **Visual Auditor (self-paced):** the `/loop` prompt at the top of `scripts/VISUAL_AUDITOR.md`.
- **Beginner `--live` (weekly):** a session that exports `SKYNET_OPENROUTER_KEY` from Andrew's
  local key store for one run, then `npm run qa:beginner:live`, then scrubs the env var.

That's the whole watch: **A** turns on the headless cron jobs, **B** turns on per-merge
guarding, **C** turns on the judging/vision/secret loops. After that, Andrew reads the
morning digest and triages — machines find the problems.
