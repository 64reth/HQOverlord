# SELF-TESTING STATION — QA crew charter & build plan

> Working contract for the Self-Testing Station session (started 2026-07-01).
> Written for DELEGATION: each lane in Part 4 is a self-contained brief for ONE
> Opus 4.8 agent in its own worktree, per the repo protocol (CLAUDE.md).
> Substrate claims were verified against trunk `feat/harness-backend` @ `fd79626`
> on 2026-07-01. **Re-grep before acting on any file:line — code moves.**

---

## PART 0 — Mission

Andrew cannot be the bug-finder. Five-plus sessions build in parallel; breakage
is currently discovered by Andrew using the app. The recurring sins this station
exists to catch automatically: **fake-done** (merged but doesn't work live),
**app-lies** (UI shows something the harness didn't do), **parallel-breakage**
(a merge broke another lane's feature), **beginner-confusion** (fresh-user path
regresses and nobody notices).

Goal state: Andrew reads a morning digest and triages findings; machines find
the problems.

**Non-goals (hard boundaries):**
- The station **detects and routes; it does not fix product code.** Fixes happen
  in normal feature lanes. (Exception: lanes below may fix the QA scripts
  themselves. The pre-existing Visual-Auditor loop keeps its documented
  small-fix mandate — see `scripts/VISUAL_AUDITOR.md`.)
- **Propose-only for anything destructive.** The Janitor never deletes; it
  reports exact commands for a human/orchestrator to run.
- This is dev tooling + Claude sessions, NOT an in-game feature. No product UI,
  no `shared/events.js` changes, no sidecar edits.

---

## PART 1 — Substrate that ALREADY EXISTS (do not rebuild)

Verified on trunk 2026-07-01. Every lane must reuse these, not reinvent them.

| Piece | Entry point | What it does |
|---|---|---|
| Seeded headless boot | `npm run dev:seed` (`dev/seed.js`), fixtures in `dev/fixtures/seed-workspace/` | Boots a sidecar pre-onboarded onto the live floor (no title screen) |
| 17-state screenshot sweep | `npm run shoot` (`scripts/shoot.mjs` + `scripts/lib/{cdp,states,seed,shootRun}.mjs`) | CDP-driven headless Chrome, fixed-wait capture (beats the animating-canvas timeout), writes PNGs + `manifest.json`, exits nonzero on failure |
| Truthfulness assertions | `npm run audit` (`scripts/audit.mjs`, DEV-gated `frontend/app/testapi.js`) | 4 scenarios (floor-rest / task / summon / moat), asserts displayed state == event-reduced truth |
| Golden-frame diffing | `npm run golden` / `golden:bless` (`scripts/golden.mjs`, baseline `scripts/goldens.json`) | Animation-tolerant change detection; flags only frames that really moved |
| Composed evidence sweep | `npm run qa:guardian` (`scripts/qa/guardian.mjs`) | The one command composing `test:fast` → `test:http` → `shoot` → `golden` → `audit` → `qa:journeys` against a pinned trunk copy, filing one deduped ledger finding per regression. (An earlier draft of this row named `scripts/bug-hunt.mjs`; that script was never built — the Guardian is what shipped.) |
| Durable hunt backlog | `npm run qa:bugs` (`scripts/qa/bugs.mjs`, files in `qa/bugs/`) | The TRACKED bug register the sweep lanes file into, so findings survive the session and worktree that found them — the portable counterpart to machine-local `qa/findings/` |
| Test gates | `npm run test:fast` (~380 steps), `test:http` | The merge gate |
| Visual-Auditor runbook | `scripts/VISUAL_AUDITOR.md` | The documented /loop launch for the vision-driven UI-coherence cycle (needs a local session with vision) |
| Interactive/transition probes | `scripts/uiplay.mjs`, `uiresidue.mjs`, `uisummon.mjs`, `uiprobe.mjs`, `uimeasure.mjs` | Chat-run driving, transition residue, summon flow, DOM/geometry dumps |

**Known-baseline findings (pre-load into the ledger as KNOWN, never re-file):**
VA-3 (undimmed floor/COMMS behind some centered modals), VA-6 (modal content
clipping), the 2 expected placeholder-key audit artifacts, stale
`.mkt-primary` selector in `scripts/audit.mjs` scenarioSummon (fixed by lane Q3).

**What does NOT exist (the actual gaps this plan builds):**
1. Nothing runs on a schedule — every detector is fire-by-hand.
2. No findings ledger: no dedup, no known-issues baseline, no digest, no routing.
3. The fresh-user path (boot WITHOUT dev seed: title → connect → create agent →
   awakening → first directive) has ZERO coverage — `shoot`/`audit` boot seeded,
   deliberately skipping onboarding.
4. `audit` coverage gaps (from the harness's own STILL-TO-DRIVE list): prop
   placement via canvas drag, a tool-using run with approval prompts, HUD/XP
   truth, conveyor TEST belts.
5. No hygiene watch: ~115 worktrees (most stale), stray root artifacts
   (~25 loose PNGs at repo root today), branches with stranded unmerged work.

---

## PART 2 — The crew (what runs, and as what)

Two kinds of runner, cleanly separated:
- **Scripts** (node, headless, no vision): detect, write findings, exit nonzero.
- **Sessions** (Claude /loop or scheduled, on Andrew's machine): read findings,
  look at flagged pixels, judge, route, notify. Scripts detect; sessions decide.

| Crew member | Question it answers | Runner | Cadence |
|---|---|---|---|
| **Green Guardian** | "Is trunk green and does the app still boot + look right?" | script (`guardian.mjs`) driven by a scheduled task or loop session | every merge / ~hourly |
| **Beginner Run** | "Can a brand-new user reach first value, unassisted?" | script (`beginner-run.mjs`), judged by a session | daily |
| **Truth Auditor** | "Does the UI show what actually happened?" | `npm run audit` + `golden` (expanded by Q3), composed in guardian cycles | every guardian cycle |
| **Visual Auditor** | "Is the rendered game coherent?" (needs eyes) | EXISTING local /loop per `scripts/VISUAL_AUDITOR.md` | self-paced |
| **Overseer** | "What broke today, what needs Andrew?" | session: reads ledger → writes digest → notifies | daily |
| **Janitor** | "What's rotting in the workshop?" | script (`janitor.mjs`) + session review | weekly |

---

## PART 3 — The findings spine (the shared substrate, lane Q0)

Everything meets at one ledger. Directory layout (all new, repo-root `qa/`):

```
qa/
  findings/<id>.json      one finding, schema below
  KNOWN_ISSUES.md         human-readable baseline (seeded from Part 1 list)
  STATUS.md               one-page dashboard: last run + result per crew member
  digests/<date>.md       Overseer output, one per day
scripts/qa/
  ledger.mjs              append / dedup / query / digest library + CLI
  guardian.mjs            (Q1)
  beginner-run.mjs        (Q2)
  janitor.mjs             (Q4)
```

**Finding schema (JSON, one file per finding):**
`{ id, fingerprint, ts, crew, severity: P0|P1|P2, title, detail,`
`  evidence: [paths], status: open|routed|fixed|dismissed|known, routedTo }`

**Ledger laws:**
- Every finding MUST carry evidence paths (screenshot, log, manifest) — no
  vibes-findings. Evidence lives beside the finding or in `.bugloops/`.
- `fingerprint` = stable hash of (crew + check-id + normalized subject), so the
  same defect never files twice. **dismissed/known fingerprints never re-file**
  (same anti-nag law as the product).
- Scripts APPEND findings and exit nonzero on any P0; they never notify.
  Sessions (Overseer) read the ledger, judge, and notify.
- `ledger.mjs` is a pure UMD-style module with injected io+clock (matches
  `runstore.js`/`transcriptstore.js` house pattern) + `test/qa-ledger.test.js`
  wired into `test:fast`.

**Port registry (loops must not collide — multiple sidecars may run at once):**
Visual Auditor keeps 8930s (documented). Guardian: 8940-8949. Beginner Run:
8950-8959. Ad-hoc/manual: 8960+. Record in `qa/STATUS.md` header.

---

## PART 4 — Lanes (one Opus 4.8 agent per lane, own worktree each)

Protocol per CLAUDE.md, non-negotiable: create your worktree
(`gen-trees\new-agent-tree.ps1 <lane>`), edit ONLY there, pathspec commits,
`npm run test:fast` green + sync-rebase before merge, one merge to trunk at a
time. `shared/events.js`/`schema.js` untouched (this plan needs nothing from
them). Every lane ends with a **movie test** — a proof artifact, not a claim.

### Q0 — FINDINGS SPINE  (worktree `qa-spine`) — lands FIRST
- **Builds:** `scripts/qa/ledger.mjs` + CLI (`--add --json`, `--digest`,
  `--dedup-check`, `--status`), `qa/` layout, `qa/KNOWN_ISSUES.md` seeded with
  the Part 1 baseline, `test/qa-ledger.test.js` in `test:fast`, npm script
  `qa:ledger`.
- **Reuses:** house io/clock-injection pattern; `.bugloops/` as evidence home.
- **Movie test:** add the same finding twice → one file; add a `known`
  fingerprint → refused; `--digest` renders a readable morning report from 3
  synthetic findings.

### Q1 — GREEN GUARDIAN  (worktree `qa-guardian`)
- **Builds:** `scripts/qa/guardian.mjs` — one cycle = sync a DEDICATED pinned
  worktree to trunk head (never runs in the integration tree, never in another
  agent's worktree), then compose: `test:fast` → `npm run shoot` → `npm run
  golden` → `npm run audit` (bounded-subprocess plumbing shared via
  `scripts/lib/run-command.mjs` rather than duplicated). Writes one
  ledger entry per regression (fingerprinted per failing suite/frame/assertion),
  updates `qa/STATUS.md`, exits nonzero on red. npm script `qa:guardian`.
  Plus `qa:guardian:watch` — re-runs when trunk HEAD moves (poll `git
  rev-parse`; cheap).
- **Decide in-lane (document the choice):** Windows Task Scheduler entry vs.
  relying on the Q5 loop session to invoke it. Default: script is
  schedule-agnostic; Q5 wires the schedule.
- **Movie test:** on a throwaway branch, deliberately break one test and one
  UI state → run one guardian cycle → both findings appear in the ledger with
  evidence, STATUS.md flips red, exit code nonzero; revert → cycle goes green
  and files nothing new.

### Q2 — BEGINNER RUN  (worktree `qa-beginner`) — the genuinely new build
- **Builds:** `scripts/qa/beginner-run.mjs` — CDP-drive a FRESH install path,
  NOT the seeded one: boot the sidecar **without** dev seeding against a
  throwaway temp workspace (re-derive the workspace override mechanics from
  `dev/seed.js` — do not touch the real `%LOCALAPPDATA%` workspace), then step:
  title screen → connect/key entry → create agent → awakening → first directive
  → first visible deliverable. Screenshot + timestamp EVERY step; per-step
  timeout budget; total budget **10 minutes** (the thesis number). On stall:
  screenshot, ledger finding with the step name, nonzero exit.
- **Two modes:** `--ui-only` (placeholder key via `SKYNET_DEFAULT_MODEL` +
  dummy `SKYNET_OPENROUTER_KEY`, asserts every screen is REACHABLE) and
  `--live` (real key **from env only** — the runner session sources it from
  Andrew's local key store; never committed, never echoed, never written into
  evidence bundles — run `npm run lint:evidence-secrets` over the output as
  part of the lane's gate).
- **Reuses:** `scripts/lib/cdp.mjs`, `shootRun.mjs` patterns; stable
  `id`/`[data-term]` selectors (re-derive from `index.html`/`navdock.js`).
- **Movie test:** `--ui-only` full pass on trunk producing a step-by-step
  screenshot strip (title → floor) + timing table; then a sabotage check
  (temporarily hide the create-agent button via a local hack) → the script
  files "stuck at create-agent" with the screenshot proving it.
- **Note:** this script IS the measuring stick the upcoming day-1 zero-to-value
  session will optimize against. Build it as the ruler, not the fix.

### Q3 — TRUTH AUDITOR EXPANSION  (worktree `qa-truth`)
- **Builds (all additive to `scripts/audit.mjs` + `scripts/lib/states.mjs`):**
  fix the stale scenarioSummon selector (`.mkt-primary` → current
  `.mkt-cta-main`/`.mkt-deploy` — re-grep `marketplace.js` first); new
  scenarios from the harness's own STILL-TO-DRIVE list: **prop-place** (REFIT
  canvas drag via CDP `Input.dispatchMouseEvent` at tile coords → assert
  `World.heroCaps` gains the capability), **tool-run with approval** (drive a
  run that hits a permission prompt → assert the prompt renders and the run
  resumes on approve), **HUD/XP truth** (displayed floor stats == event-reduced
  counts after a scripted run), **conveyor** (TEST belt moves a crate; merger
  doesn't lose it silently).
- **Movie test:** `npm run audit` on trunk: all pre-existing scenarios still
  pass, each new scenario passes, and each new scenario FAILS correctly when
  its subject is sabotaged locally (prove the detector detects).

### Q4 — JANITOR  (worktree `qa-janitor`)
- **Builds:** `scripts/qa/janitor.mjs` → `qa/findings/` + a `qa/digests/`
  hygiene section. Checks: worktrees whose branch is fully merged into trunk
  AND clean (report the exact `remove-agent-tree.ps1` command — NEVER run it);
  branches ahead of trunk with no commits in N days (stranded work = the
  fake-done pattern — surface it, don't judge it); stray artifacts at repo
  root (loose PNGs/logs — flag, don't delete); docs under `docs/` + root plans
  referencing files that no longer exist (the docs-lie pattern);
  `.bugloops/`/`.uishots*` disk growth. npm script `qa:janitor`.
- **Movie test:** one run on the real repo today → a report that correctly
  lists (a) ≥1 merged-and-removable worktree, (b) the root PNG litter,
  (c) ≥1 dead doc reference — each verified true by hand for the demo.

### Q5 — STAND UP THE WATCH  (worktree `qa-watch`) — lands LAST
- **Builds:** `qa/QA_STATION.md` — THE runbook: exact launch line per crew
  member (Guardian schedule or /loop line; Beginner Run daily line; Overseer
  digest /loop line — pattern-match `scripts/VISUAL_AUDITOR.md` which stays
  authoritative for the Visual Auditor), the port registry, the notification
  rule (Overseer session notifies Andrew on P0 via push/channel — sessions
  notify, scripts never do), and cost notes for `--live` beginner runs.
  Plus whatever thin glue the chosen scheduling needs (Task Scheduler XML or
  documented /loop prompts — decide in-lane, document why).
- **Movie test (the whole station's proof):** every crew member completes ONE
  real cycle end-to-end on trunk — guardian green cycle, beginner `--ui-only`
  pass, janitor report, Overseer digest generated from the real ledger — and
  `qa/STATUS.md` shows all rows with fresh timestamps. Screenshot the digest.

---

## PART 5 — Consistency laws (the station's non-negotiables)

1. **Evidence law:** no finding without an artifact path. Screenshots/logs or
   it didn't happen. (`lint:evidence-secrets` gates anything that could
   capture a key.)
2. **Anti-nag law:** fingerprint dedup; dismissed/known never re-files.
3. **No-fake-green law:** every script exits nonzero on real failure; a
   detector that can't run reports BLOCKED loudly, never silently passes.
   (Precedent: the rebrand-drift bug — unit-green, runtime-broken. Always
   live-smoke `npm run audit` after touching the harness.)
4. **Read-only law:** QA runs against trunk state in ITS OWN pinned worktree
   or temp workspaces; never the integration tree, never another agent's
   worktree, never the real user workspace. Destructive ops are proposals.
5. **Detect/decide split:** scripts detect + ledger; sessions judge + notify.
6. **Port law:** every loop boots sidecars only in its assigned port range.
7. **Collision law:** new files live under `scripts/qa/` + `qa/` only.
   Shared touches are exactly: `package.json` (one script line per lane —
   merge lanes to trunk ONE at a time), `test:fast` chain (Q0), and
   `scripts/audit.mjs`/`states.mjs` (Q3, no other session owns them today).
   Zero edits to `world.js`, `chat.js`, `sidecar/`, `shared/`.

---

## PART 6 — Build order & delegation

```
Q0 (spine)  ──►  Q1, Q2, Q3, Q4  (parallel, 4 agents)  ──►  Q5 (watch)
```
Q1–Q4 are file-disjoint from each other except one `package.json` line each —
sequence only their MERGES, not their work.

**Kickoff prompt template (per lane, for an Opus 4.8 agent):**

> Read `CLAUDE.md`, then `docs/SELF_TEST_STATION_PLAN.md`. You are lane **Qn**.
> Create your worktree (`gen-trees\new-agent-tree.ps1 <lane-worktree-name>`) and
> work only there. Re-verify every substrate claim you depend on by grepping
> current code before building. Build the lane as specced, keep to the Part 5
> laws, prove the movie test with artifacts, get `npm run test:fast` green,
> sync-rebase, then stop and report — the orchestrator merges.

Merged lanes report back here; the orchestrator (this session) is the merge
gate, one lane at a time, gate re-run on trunk after each merge.
