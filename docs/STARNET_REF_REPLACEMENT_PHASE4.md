# StarNet ref-Replacement Phase 4

Phase 4 is the cutover qualification phase. It is not a feature sprint. It
answers one question: can StarNet replace the reference harnessAgent as the user's main harness?

## Steering Commands

Run one classifier pass:

```powershell
npm.cmd run phase4
```

Run the continuous loop form:

```powershell
npm.cmd run phase4:loop
```

Run with live-provider proof enabled once a key exists:

```powershell
$env:OPENROUTER_API_KEY="<real key>"
npm.cmd run phase4:live
```

Create the attended evidence placeholders:

```powershell
npm.cmd run phase4:evidence:init:decision
```

Check whether the attended evidence packet is complete:

```powershell
npm.cmd run phase4:evidence:check
```

Evidence lands in:

- `.dogfood/phase4-<timestamp>/summary.md`
- `.dogfood/phase4-<timestamp>/phase4-status.json`
- `.dogfood/phase4-latest/`
- `.dogfood/phase4-attended-evidence.json`
- `.dogfood/phase4-decision.json`

## Phase 4 Goal

StarNet reaches replacement-ready standing when:

- P4.1 the reference harness baseline is documented and stable.
- P4.2 StarNet same-work trial passes through attended gamified UI evidence.
- P4.3 Paid live provider proof passes with real model/spend telemetry.
- P4.4 Two-pass soak passes once fresh and once after restart.
- P4.5 Failure/recovery proof passes for cancel, budget, denied consent, tool
  error, and checkpoint/restore.
- P4.6 Final go/no-go decision is recorded.

## Loop Algorithm

Every P4 session follows this loop:

1. Run `npm.cmd run phase4:loop`.
2. Open `.dogfood/phase4-latest/summary.md`.
3. Work the first non-pass row only.
4. If the row needs live or attended proof, satisfy that external input rather
   than patching code.
5. If the row fails as a product or gate defect, patch the smallest surface and
   rerun `npm.cmd run phase4:loop`.
6. Stop only when the verdict is green or the state is stably blocked on external
   proof.

The loop must not spin on missing provider keys, missing attended evidence,
missing Cargo/Rust, or missing final user decision.

## P4.1 the reference harness Baseline

Goal: make the replacement bar explicit.

Gate:

- `docs/STARNET_PHASE4_REF_BASELINE.md` exists.
- It names the core the reference harness behaviors StarNet must match.

## P4.2 StarNet Same-Work Trial

Goal: prove the same category of daily-driver work through StarNet's gamified UI.

Automated support:

- `npm.cmd run dogfood` proves replay-backed research/file, shell, verify,
  cancel, budget, and restart/resume slices.

Attended proof:

- `npm.cmd run phase4:evidence:init` can create the placeholder packet.
- `.dogfood/phase4-attended-evidence.json` must mark `sameWorkTrial.passed`.
- Evidence must include screenshots, run ids, transcript ids, artifact paths, and
  ledger rows.

## P4.3 Live Provider Proof

Goal: prove the real provider/key/model/spend path.

Gate:

- `node test/live.smoke.js` passes with a real key.
- Live audit passes with `SKYNET_AUDIT_LIVE_PROVIDER=1`.
- The resulting evidence records real model and spend telemetry honestly.

## P4.4 Two-Pass Soak

Goal: prove StarNet remains boring across a fresh run and a restart run.

Gate:

- `.dogfood/phase4-attended-evidence.json` marks fresh and restart pass.
- Transcript, ledger, artifacts, memory, and station state are preserved.

## P4.5 Failure/Recovery Proof

Goal: prove failure states are understandable and recoverable.

Automated support:

- Cancellation, budget, checkpoint, consent, shell, verify, and patch safety
  tests pass.

Attended proof:

- `npm.cmd run phase4:evidence:check` must pass.
- `.dogfood/phase4-attended-evidence.json` marks cancel, budget, denied consent,
  tool error, and checkpoint/restore paths.

## P4.6 Pilot Decision

Goal: record the replacement decision instead of leaving it implied.

Gate:

- `npm.cmd run phase4:evidence:init:decision` can create a blocked placeholder,
  but the final values must be set from the real cutover decision.
- `.dogfood/phase4-decision.json` exists.
- Decision is one of `ready-to-replace`, `limited-pilot`, `blocked`, or
  `not-ready`.
- `acceptedBy`, `acceptedAt`, and notes are present.

## Go/No-Go

Go:

- P4 verdict is green.
- Decision is `ready-to-replace` or `limited-pilot`.
- Any accepted pilot gaps are explicit.

No-go:

- Live provider proof has not passed.
- Attended same-work trial or restart soak has not passed.
- StarNet can lose transcript, artifact, model identity, spend truth, memory, or
  station state.
- Failure states can look like success.
