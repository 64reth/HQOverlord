# StarNet ref-Replacement Readiness Loops

This is the operating system for getting StarNet close enough to pilot in place of the reference harness
without burning cycles on the wrong surface area. The thesis is simple: first make the
signals trustworthy, then make the harness honest, then run one paid smoke, then decide.

Phase-specific execution docs:

- Phase 1: this document, "Tonight's Order".
- Phase 2: `docs/STARNET_REF_REPLACEMENT_PHASE2.md`, the daily-driver proof.
- Phase 3: `docs/STARNET_REF_REPLACEMENT_PHASE3.md`, the beta replacement proof.

## North Star

StarNet is pilot-ready only when the core loop is boringly reliable:

- The gate is deterministic. Red means a product problem, not timing noise.
- Golden diffs are reviewed, narrow, and intentionally blessed.
- Spend, tokens, and model identity are truthful. Unknown or unmetered is labeled, never disguised as free.
- A paid live run proves the real provider path with a real key and model.
- Known ref-surface gaps are named and queued, not allowed to blur the pilot decision.

## Session Protocol

Every session follows the same loop:

1. Claim an isolated worktree and a narrow write set.
2. State the invariant being repaired.
3. Patch the smallest product or gate surface that makes the invariant true.
4. Run the smallest targeted test that can fail for the fix.
5. Run the relevant gate.
6. Record what remains accepted, deferred, or blocked.

No session re-blesses visual baselines until the changed frames have been inspected. No
session edits `shared/events.js` or `shared/schema.js` unless it owns that contract.

## Tonight's Order

### 1. Gate Trust: Audit Determinism

Goal: `npm run audit` must not depend on a live provider returning a 401 quickly enough.

Loop:

1. Replace provider timing races with a deterministic local audit provider by default.
2. Wait on terminal `agent.run.*` lifecycle, not a fixed network-delay window.
3. Keep a live-provider escape hatch for the paid smoke.
4. Run audit at least three consecutive times.

Gate: three consecutive `npm run audit` passes.

### 2. Visual Trust: Golden Diffs

Goal: distinguish coherent UI baseline movement from real regressions.

Loop:

1. Run `npm run golden`.
2. Inspect only flagged frames.
3. Fix real regressions before blessing. In this batch, `build-skills` cropped at `1440x900` is real.
4. Update only reviewed signatures, not the whole baseline.
5. Re-run `npm run golden`.

Gate: `npm run golden` passes after targeted baseline updates.

### 3. Truthful Telemetry: Spend And Model Honesty

Goal: the durable record never implies that an unknown/unmetered run was free, and never
forgets which model actually ran after fallback.

Loop:

1. Preserve actual model identity from requested model, fallback result, Codex default, or explicit `(unknown)`.
2. Record subscription/Codex usage as `unmetered`.
3. Exclude unmetered rows from metered USD aggregates while still counting runs and tokens.
4. Mark cold-catalog usage as `unpriced` so the host can backfill only when pricing becomes available.
5. Surface the distinction in Logbook and Insights.

Gate: targeted spend/model tests plus `npm run test:fast`.

### 4. Paid Live Smoke

Goal: prove the real paid provider path once a key and model env exist.

Command shape:

```powershell
$env:OPENROUTER_API_KEY="<real key>"
$env:SKYNET_AUDIT_LIVE_PROVIDER="1"
npm.cmd run audit
```

Gate: the task scenario reaches `agent.run.start` and `agent.run.end`, HUD/logbook spend is truthful,
and no fake/mock provider is in use.

### 5. Conscious Deferrals

These are real, but they are not tonight's replacement blocker:

- Browser automation and desktop computer-use parity.
- Clean-machine Tauri verification when `cargo` is missing.
- Full the reference harness surface matching beyond the core loop.

Queue them for this-week work after the pilot gate is trusted.

## Pilot Go/No-Go

Go for a StarNet pilot when all are true:

- `npm run audit` passes repeatedly.
- `npm run golden` passes after reviewed visual updates.
- `npm run test:fast` passes.
- One paid live audit passes with a real key/model.
- Open deferrals are documented and accepted for pilot scope.

No-go if any of these are true:

- Audit red can still be caused by timing, provider availability, or stale selectors.
- UI goldens contain uninspected changed frames.
- Durable run history can show blank model identity or misleading `$0.0000` for unmetered usage.
- Paid live smoke has not been run when provider credentials are available.
