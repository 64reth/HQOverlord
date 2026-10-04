# StarNet ref-Replacement Phase 2

Phase 1 made the signals trustworthy: deterministic audit, reviewed golden baselines,
fixed `build-skills`, and honest spend/model history. Phase 2 is the daily-driver proof.
The goal is not to match every the reference harness surface yet. The goal is to prove that StarNet can
do real work repeatedly through the gamified UI without lying, losing state, or making a
red gate feel optional.

## Phase 2 Goal

StarNet reaches "pilot as main harness" standing when a real-key, real-work dogfood pack
passes and the remaining the reference harness gaps are consciously accepted or assigned.

Phase 2 is complete only when:

- A paid live smoke passes with a real provider key and a real model.
- A daily-driver task pack proves research, file write, shell/verify, transcript resume,
  memory/logbook, and cancellation/budget paths on a seeded station.
- A restart/resume pass proves run history, transcripts, ledger, and station state survive.
- A safety pass proves consent, checkpoint/restore, and file-jail behavior around mutating tools.
- `npm run test:fast`, `npm run test:http`, `npm run audit`, and `npm run golden` are green.
- Deferred ref-surface gaps have explicit owners and are not confused with pilot blockers.

## Steering Commands

Phase 2 is driven by one evidence-producing runner:

```powershell
npm.cmd run phase2
```

The runner writes `.dogfood/phase2-<timestamp>/summary.md`,
`.dogfood/phase2-<timestamp>/phase2-status.json`, and refreshes
`.dogfood/phase2-latest/`.

Variants:

```powershell
npm.cmd run phase2:live      # require/attempt paid provider live smoke
npm.cmd run phase2:desktop   # also classify desktop/Tauri toolchain state
```

Loop for every Phase 2 session:

1. Run `npm.cmd run phase2` or the relevant variant.
2. Open `.dogfood/phase2-latest/summary.md`.
3. Fix the first failing required step, or satisfy the first blocked external dependency.
4. Rerun the same command.
5. Only claim progress from the evidence folder, not memory.

## What Still Holds Replacement Back

### Blocker A: No Paid Live Proof Yet

The deterministic mock is correct for CI, but it is not a substitute for a real paid call.
Until one live run passes, StarNet has not proven the final provider/key/model/spend path.

Gate:

```powershell
$env:OPENROUTER_API_KEY="<real key>"
$env:SKYNET_AUDIT_LIVE_PROVIDER="1"
npm.cmd run audit
```

Evidence:

- `task/run-dispatched` and `task/run-lifecycle` pass.
- The audit log clearly says it used the live provider, not the deterministic mock.
- The resulting ledger/run history records the actual model and metered or unmetered status honestly.

### Blocker B: No Real Daily-Driver Dogfood Pack

the reference harness earns trust by handling ordinary work smoothly. StarNet needs a repeatable pack of
real tasks that exercise the harness through the UI and sidecar, not only unit tests.

The pack should include:

- Research: web search/fetch with cited output.
- File deliverable: write a small report into a jailed workspace.
- Shell/verify: run a harmless command or project check after consent.
- Resume: restart sidecar and reopen the run transcript/logbook.
- Memory: save or surface one durable fact, then prove it recalls in a later turn.
- Cancellation/budget: cancel or hit a tiny cap and verify the end state is honest.

Gate:

- A single command or checklist produces artifacts under `.dogfood/`.
- Failures produce a diagnosis, not just a screenshot.
- All artifacts point back to run ids, transcript ids, and ledger rows.

Execution checklist: `docs/STARNET_DOGFOOD_TASK_PACK.md`.

### Blocker C: Safety Needs A UI-Level Proof

The tests cover consent, file jail, checkpoint, and shell behavior. Replacement confidence
requires one UI-driven proof that mutating tools cannot silently damage the workspace.

Gate:

- File write asks for approval in COMMS.
- Shell/verify requires the right capability and consent.
- Checkpoint exists before mutating shell/verify work.
- Restore returns the workspace to the prior state.
- Denied consent becomes an honest tool error and the run finishes cleanly.

### Blocker D: Restart/Resume Must Feel Boring

the reference harness is reliable because finished work remains findable. StarNet has transcript, runstore,
ledger, and save-store surfaces, but Phase 2 must prove the full path after a sidecar restart.

Gate:

- Finish a task with output.
- Stop and restart the sidecar.
- Reopen StarNet.
- Logbook still shows the run, spend/model labels, and transcript link.
- Memory/notebook and saved station state survive.

### Blocker E: Desktop Clean-Machine Is Still Not Verified

Cargo missing is not a pilot blocker, but it is a release blocker. Phase 2 should tee it up
without letting it consume the daily-driver proof.

Gate:

- `desktop:prepare` is documented and green.
- `desktop:build` has a clear prerequisite check for Rust/Cargo.
- The failure mode says what to install instead of looking like a product failure.

### Blocker F: the reference harness Surface Gaps Are Real But Not All Blocking

These do not block Phase 2 pilot unless the daily-driver task pack needs them:

- Browser automation.
- Desktop computer-use.
- Broader connector parity.
- Full release packaging.

They become Phase 3 work unless the paid/dogfood proof exposes them as core-loop blockers.

## Phase 2 Session Map

### Session 2.1: Paid Live Smoke

Ownership:

- `scripts/audit.mjs` only if the live path exposes a real audit issue.
- No golden changes.

Loop:

1. Confirm provider key/model env exists.
2. Run live audit.
3. Capture `.uiaudit/audit-report.json`.
4. If red, classify as product bug, provider config, or audit bug.
5. Patch only the proven cause.
6. Rerun live audit once and mock audit once.

Done:

- Live audit passes.
- Mock audit still passes.
- Spend/model row is truthful.

### Session 2.2: Daily-Driver Dogfood Harness

Ownership:

- New `scripts/dogfood.mjs` or `docs/STARNET_DOGFOOD_TASK_PACK.md`.
- Sidecar or frontend changes only if the pack exposes a real defect.

Loop:

1. Define six tasks: research, file, shell/verify, resume, memory, cancel/budget.
2. Run them against a seeded scratch workspace.
3. Save run ids, transcript ids, output files, screenshots, and ledger snippets.
4. Convert repeatable checks into tests where cheap.
5. Keep non-automatable UI steps as a checklist with exact evidence.

Done:

- One command or checklist can be rerun by another agent.
- The pack catches at least one class of daily-driver regression that `test:fast` would miss.

### Session 2.3: Safety And Restore Proof

Ownership:

- `sidecar/checkpoint*`, `sidecar/tools/builtin/*`, `test/checkpoint*`, `test/consent*`,
  and narrow UI affordances in `frontend/app/stationui.js` if needed.

Loop:

1. Run a harmless mutating action behind consent.
2. Verify checkpoint creation before the mutation.
3. Deny one mutation and confirm paired tool error.
4. Accept one mutation and restore it.
5. Add or tighten tests around any discovered gap.

Done:

- Mutating work is undoable, consented, and inspectable from the UI.

### Session 2.4: Restart/Resume Proof

Ownership:

- `sidecar/runstore.js`, `sidecar/transcriptstore.js`, `sidecar/ledger.js`, `sidecar/index.js`,
  and Logbook UI only if a persistence gap is found.

Loop:

1. Run a real or replay-backed task with a transcript.
2. Kill and restart the sidecar.
3. Reopen Logbook and transcript.
4. Confirm ledger, model label, unmetered/metered status, and memory state.
5. Add a restart e2e test if the failure is automatable.

Done:

- A finished run remains explainable after restart.

### Session 2.5: UX Friction Pass

Ownership:

- `frontend/app/stationui.js`, `frontend/css/app.css`, `scripts/lib/states.mjs`,
  `scripts/goldens.json` only for reviewed visual changes.

Loop:

1. Run `npm run shoot` and `npm run golden`.
2. Inspect only changed frames.
3. Fix overlap, crop, misleading labels, or dead controls.
4. Bless only reviewed signatures.
5. Re-run golden.

Done:

- The main harness surfaces look calm and legible during real work.

### Session 2.6: Desktop Release Prep

Ownership:

- `scripts/prepare-node.mjs`, `src-tauri/*`, docs around desktop prerequisites.

Loop:

1. Run `npm run desktop:prepare`.
2. Run `npm run desktop:build`.
3. If Cargo/Rust is missing, improve the prerequisite message or document it.
4. Do not chase packaging unless the daily-driver proof is already green.

Done:

- Desktop state is classified as "pilot non-blocker" or "release blocker" with exact next action.

## Phase 2 Go/No-Go

Go for StarNet as the main pilot harness when:

- Phase 1 gates remain green.
- Live paid smoke passes.
- Dogfood pack passes twice, once fresh and once after restart.
- Safety/restore proof passes.
- Remaining gaps are explicitly accepted for pilot scope.

No-go when:

- A live provider run cannot complete.
- A real task can lose transcript, spend, model identity, or deliverable provenance.
- Mutating tools can run without consent or rollback evidence.
- Golden/audit red becomes something agents learn to ignore.

## Phase 3 Preview

Phase 3 is defined in `docs/STARNET_REF_REPLACEMENT_PHASE3.md`. It starts only
after Phase 2 proves the core loop, or when a Phase 2 blocker explicitly becomes
Phase 3 work. Its themes:

- Browser automation and desktop computer-use parity.
- Clean-machine Tauri release verification.
- Wider connector and MCP parity.
- Multi-agent delegation stress and budget sharing.
- Longer-run soak tests that simulate a full work evening.

Until Phase 2 is green, Phase 3 stays queued or reports blockers honestly through
`npm.cmd run phase3`.
