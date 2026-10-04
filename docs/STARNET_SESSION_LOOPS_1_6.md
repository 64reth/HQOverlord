# StarNet critical gaps - sessions 1-6 goal + loop control

> Control document for six parallel StarNet implementation loops. The purpose is to
> close the current critical gaps without clobbering active Claude Code or Codex
> work. Each session owns one worktree and one goal. Sessions may run continuously,
> but they must respect the dependency gates and file ownership below.

## Non-negotiable protocol

1. Work only in the named worktree on the named branch. Never feature-edit
   `C:\Users\<you>\Desktop\gen`.
2. Before every iteration, run `git worktree list` and `git status --short --branch`.
3. Before touching any hot file, run `node scripts/board.mjs --files <paths>` when
   available. If the file is hot, record `HELD-FOR-COORDINATION` and continue with
   an independent subtask.
4. Commit only the files owned by the session, using explicit pathspecs. Never use
   `git add -A` or `git add .`.
5. `shared/events.js` and `shared/schema.js` are additive-only and owned elsewhere.
   If a session needs a contract change, write a request in this document rather
   than editing those files directly.
6. A loop is not DONE until tests are green, live/product verification is complete
   where applicable, the branch is rebased onto trunk, and the orchestrator has
   merged it or explicitly marked it accepted.
7. No session self-merges to trunk. Set status to `READY` and let the orchestrator
   serialize merges.

## Dependency graph

```
S1 sidecar station authority
  -> S2 org validator / PipelineEdge enforcement
  -> S6 builder scale final integration

S3 desktop release proof
  waits for active StarNet hardening/Tauri branches to land or be retired

S4 managed billing
  independent after API hardening is merged

S5 subagent budget containment
  independent, but coordinates with S4 if both touch budget/loop plumbing
```

Sessions may run continuously by looping through SELECT -> BUILD -> VERIFY -> SYNC
until DONE, BLOCKED, or HELD. A HELD session wakes after every trunk merge and retries
its sync/board check.

## Session 1 - Sidecar-owned Station authority

**Goal.** Move the station authority boundary to the sidecar so routing and capability
grants are derived server-side from a validated Station document, not trusted from
renderer-posted `placed` objects or bay object lists.

**Worktree / branch.** `C:\Users\<you>\gen-trees\station-authority-gap1` on
`agent/station-authority-gap1`.

**Owned files.**
- `sidecar/station-store.js` or `sidecar/station/*.js`
- `sidecar/routing/router.js`
- `test/station-authority.test.js`, `test/routing.b5.test.js`
- Narrow integration hooks in `sidecar/index.js`
- Narrow client changes in `frontend/app/world.js`, `frontend/app/harness.js`, and
  `frontend/app/app.js` only after the sidecar API is tested
- `frontend/app/worldmodel.js` only for narrow serialization/migration fixes such as
  preserving `connectorId`

**Avoid / coordinate.**
- Avoid broad rewrites of `frontend/app/worldmodel.js`; it remains the pure model.
- Do not edit `shared/events.js` without an additive request.
- Coordinate before touching `sidecar/index.js`, `frontend/app/world.js`, or
  `frontend/app/app.js`.

**Loop.**
1. SELECT the next trust-boundary item:
   `router.setStation` -> `/api/station` -> transactional last-good station ->
   router derives plan -> interactive run ignores forged `placed`.
2. Write a failing test first for the selected item.
3. Implement the smallest server-side slice.
4. Verify forged client payloads cannot grant web/files/shell/connector tools, and
   forged legacy `/api/routing` plans cannot override an authoritative station.
5. Run `npm run test:fast`; run `npm run test:http` once the HTTP surface changes.
6. Live-smoke a refit edit and a COMMS run.
7. Sync, mark `READY`, wait for orchestrator merge, then select the next item.

**Done condition.**
- Sidecar can load, persist, validate, and derive from `SaveDoc.station`.
- Routing plan and bay capability objects are derived by the sidecar from the Station.
- Interactive `/api/run` no longer trusts `body.placed` for grant authority.
- Forged station/routing/capability HTTP tests fail closed.
- Invalid/non-deployable station updates are transactional and leave the last-good
  routing state active.
- Existing builder/refit UX still works live.

## Session 2 - Org validator and door-gated workflow graph

**Goal.** Make the station layout a validated multi-agent org graph: every agent has
one legal anchor, every grant resolves to a placed object, and handoff edges are
runnable only when the door/path graph permits them.

**Worktree / branch.** `C:\Users\<you>\gen-trees\org-graph-gap2` on
`agent/org-graph-gap2`.

**Owned files.**
- `frontend/app/orgvalidator.js` or `sidecar/station/org-validator.js`
- `frontend/app/pipeline.js`
- `test/org-validator.test.js`, `test/pipeline.test.js`, `test/worldmodel.test.js`
- Later integration in `sidecar/routing/router.js` after S1 lands
- `frontend/app/worldmodel.js` only for additive `edges: []`,
  `PipelineEdge` accessors/mutators, and migration defaults
- `package.json` only to add the new validator test to `test:fast`

**Avoid / coordinate.**
- Do not add sidecar mutation authority until S1 exposes its API.
- Do not edit UI panels except for a small validation message hook after core tests pass.

**Loop.**
1. If S1 is not merged, work only on pure validation modules and tests.
2. SELECT one invariant: seated agent, duplicate bay, missing compute, unreachable bay,
   sealed-room edge, invalid connector binding, dead handoff.
3. Write the failing pure test.
4. Implement validator result shape `{ok, errors, warnings, graph}`.
5. Add one integration assertion to routing/worldmodel tests.
6. Run `npm run test:fast`.
7. After S1 lands, wire validator into sidecar station acceptance and routing acceptance.
8. Repeat until every invalid AgentOrg snapshot is refused before runtime.

**Done condition.**
- CI rejects invalid org snapshots.
- `PipelineEdge {from,to,whenKind,lane?}` persists and migrates as `[]` for old docs.
- `PipelineEdge A->B` is runnable iff rooms are connected by the path/door graph.
- Severed corridors produce a legible reason and disable the handoff.
- No partial invalid AgentOrg reaches `resolveTools` or `runOnce`.
- Stable reason code exists for severed edges, e.g.
  `PIPELINE_SEVERED_CONNECT_CORRIDOR`.

## Session 3 - Desktop package proof and release gate

**Goal.** Produce a verified desktop release path: build, boot, updater manifest,
installer/security checks, and release smoke.

**Worktree / branch.** `C:\Users\<you>\gen-trees\starnet-release-gate` on
`agent/starnet-release-gate`.

**Owned files.**
- `src-tauri/**`
- `scripts/prepare-node.mjs`
- `scripts/starnet-release-manifest.mjs`
- `scripts/release-smoke.mjs` or `test/desktop-release.test.js`
- `test/starnet-release-manifest.test.js`
- `package.json` release scripts
- `SHIP_CHECKLIST.md` if present, otherwise `docs/DESKTOP_RELEASE_CHECKLIST.md`

**Avoid / coordinate.**
- Active lanes `agent/starnet-hardening-integration`,
  `agent/starnet-hardening-7-8-tests-tauri`, and `agent/starnet-tests-tauri` touch
  the same area. Start in WATCH mode until those branches are merged or retired.
- Do not weaken Tauri CSP/capabilities to make the build pass.

**Loop.**
1. WATCH: sync after each trunk merge; if hardening branches are still active, inspect
   only and prepare tests/checklists that do not conflict.
2. SELECT one release proof: Rust toolchain detection, `desktop:build`, boot log,
   updater manifest, installer smoke, signature/notarization placeholder check.
3. Add/adjust an automated check where possible.
4. Run `npm run test:fast`, `npm run test:http`, and `npm run desktop:build`.
5. If Rust/Cargo is missing, mark `BLOCKED-RUST-TOOLCHAIN` with exact command and
   keep all pre-build checks green.
6. When build succeeds, boot the packaged app and capture proof in the checklist.
7. Repeat until release smoke is green from clean checkout to launched app.

**Done condition.**
- `npm run desktop:build` succeeds on a machine with Rust/Cargo.
- Packaged app boots its bundled sidecar and reaches healthy state.
- Updater manifest generation is tested.
- Release smoke covers boot -> onboard/key -> station load -> real or replay run ->
  screenshot/zero console errors.
- Manifest generation rejects bad SemVer, non-HTTPS URLs, empty signatures, and emits
  valid `latest.json`.

**Windows command note.** Use `npm.cmd`, not `npm`, when PowerShell execution policy
blocks `npm.ps1`.

## Session 4 - Managed credits and billing adapter

**Goal.** Add a managed-credit spending path alongside BYOK without regressing the
existing truthful ledger, budget caps, or key ownership model.

**Worktree / branch.** `C:\Users\<you>\gen-trees\managed-credits` on
`agent/managed-credits`.

**Owned files.**
- `sidecar/billing.js`
- `sidecar/budget.js`, `sidecar/ledger.js`, provider adapter seams as needed
- `test/billing.test.js`, `test/budget.test.js`, `test/ledger.test.js`
- Narrow route hooks in `sidecar/index.js`
- `test/sidecar.http.test.js`, `test/e2e.run.test.js`
- Frontend provider/HUD files only after backend invariants pass:
  `frontend/app/harness.js`, `frontend/app/app.js`, `frontend/app/stationui.js`,
  `frontend/app/safety.js`

**Avoid / coordinate.**
- Do not touch UI billing panels until backend tests prove the model.
- Coordinate with S5 before editing `sidecar/loop.js` or shared budget structures.
- Never log tokens, provider keys, or managed-credit credentials.

**Loop.**
1. SELECT one billing invariant: account balance, debit-on-run, refund/failed run,
   exhausted balance, BYOK isolation, cap kill, telemetry.
2. Write failing test against pure billing/ledger code.
3. Implement backend adapter with injected provider/payment client.
4. Add route only after pure tests pass.
5. Run `npm run test:fast`; run `npm run test:http` if routes change.
6. Live-smoke with a fake managed-credit provider; never spend real money in CI.
7. Repeat until managed and BYOK runs are selectable and isolated.

**Done condition.**
- Managed run debits managed balance exactly once.
- Exhaustion blocks spend with a clear reason before paid work starts.
- BYOK runs do not touch managed balance.
- HUD/API expose reconciled final spend, not estimates as final truth.
- `budget.resume` cannot bypass exhausted managed credits.
- Persistence/debit failures fail closed for managed credits.

## Session 5 - Subagent iteration and cost containment

**Goal.** Finish the reference harness H6.3: worker/subagent runs get bounded iteration budgets, no-op
turns are refunded, and delegated loops cannot quietly burn the lead's full budget.

**Worktree / branch.** `C:\Users\<you>\gen-trees\iteration-budget` on
`agent/iteration-budget`.

**Owned files.**
- `sidecar/loop.js`
- `sidecar/tools/builtin/orchestration.js`
- `sidecar/subagents.js` if needed
- `test/iteration-budget.test.js`, `test/orchestration.test.js`,
  `test/subagents.test.js`, `test/loop.replay.test.js`

**Avoid / coordinate.**
- Coordinate with S4 on shared budget semantics.
- Do not alter tool capability grants or consent rules.
- Keep `loop.replay` byte-identical unless a fixture intentionally covers the new
  worker budget behavior.

**Loop.**
1. SELECT one limit case: worker `maxIters`, lead remains 40, no-op refund,
   compaction/failover retry refund, hard floor, telemetry.
2. Write failing test.
3. Thread worker `maxIters` through `team.dispatch`, background workers, and
   `runOnce`/loop limits.
4. Implement no-op refund narrowly in loop accounting, restoring only to that
   turn's starting count.
5. Run targeted tests plus `npm run test:fast`.
6. Verify `loop.replay` remains byte-identical for non-worker runs.
7. Repeat until H6.3 acceptance is met and update `REF_HARNESS_PARITY_PLAN.md`.

**Done condition.**
- Worker dispatched with `maxIters=10` has loop limit 10 while lead remains at the
  normal default.
- Empty/no-assistant/no-tool turns and pure failover/compaction retries do not consume
  effective worker turns.
- Delegated runs still obey per-worker USD/day/global caps and concurrency limits.
- Refund never erases earlier productive turns.

## Session 6 - Builder scale and visual release baseline

**Goal.** Make the mutable builder scale beyond small stations: chunked/incremental bake,
bounded canvas memory, and repeatable visual release baselines.

**Worktree / branch.** `C:\Users\<you>\gen-trees\gap6-builder-bake` on
`agent/gap6-builder-bake`.

**Owned files.**
- `frontend/app/stationbake.js`
- `frontend/app/build.js`
- `frontend/app/world.js` only for narrow cache integration
- `frontend/app/worldmodel.js` only for dirty-rect metadata if needed
- `frontend/app/BUILDER.md`
- `scripts/golden.mjs`, `scripts/shoot.mjs`, `scripts/audit.mjs`
- `scripts/lib/states.mjs` and `scripts/goldens.json` only for deliberate visual
  baseline additions
- `test/worldmodel.test.js`, new `test/stationbake.chunk.test.js`
- `package.json` only to add the new chunk test to `test:fast`

**Avoid / coordinate.**
- Wait for S1/S2 before changing station authority or org semantics.
- Coordinate before touching `world.js`; it is a hot file.
- Do not introduce new gameplay claims; this is performance/release proof, not UX copy.

**Loop.**
1. SELECT one scale slice: dirty rect precision, bakeRegion seam, chunk store, visible
   chunk culling, LRU eviction, golden baseline.
2. Write a headless or pixel/golden test where possible.
3. Implement with unchanged visuals for the seed station.
4. Run `npm run test:fast`, `npm run shoot`, `npm run golden`.
5. Live-smoke REFIT edit on desktop and mobile viewport sizes.
6. Repeat until large-station edits rebake only touched chunks and visuals remain stable.

**Done condition.**
- Editing one prop/room marks exact dirty chunks and does not rebake the whole station.
- Bounds/origin changes may reset chunk metadata, but must not allocate a full-world
  `baseCv`/`lightCv`.
- A large synthetic station renders with bounded canvas count and no visible seams.
- Golden visual baseline exists and blocks regressions for release.
- Seed-station chunk composite matches the monolithic bake within established visual
  tolerance.

## Worktree creation commands

Run these from PowerShell. Use the `-ExecutionPolicy Bypass` wrapper because this
machine blocks local `.ps1` execution by default.

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\<you>\gen-trees\new-agent-tree.ps1 station-authority-gap1
powershell -ExecutionPolicy Bypass -File C:\Users\<you>\gen-trees\new-agent-tree.ps1 org-graph-gap2
powershell -ExecutionPolicy Bypass -File C:\Users\<you>\gen-trees\new-agent-tree.ps1 starnet-release-gate
powershell -ExecutionPolicy Bypass -File C:\Users\<you>\gen-trees\new-agent-tree.ps1 managed-credits
powershell -ExecutionPolicy Bypass -File C:\Users\<you>\gen-trees\new-agent-tree.ps1 iteration-budget
powershell -ExecutionPolicy Bypass -File C:\Users\<you>\gen-trees\new-agent-tree.ps1 gap6-builder-bake
```

## Per-session status ledgers

Each implementation session writes only its own status file. The central status board
below is owned by the orchestrator and is updated only when branches are merged,
blocked, or explicitly accepted.

- Session 1: `docs/session-status/session-1-station-authority.md`
- Session 2: `docs/session-status/session-2-org-graph.md`
- Session 3: `docs/session-status/session-3-release-gate.md`
- Session 4: `docs/session-status/session-4-managed-credits.md`
- Session 5: `docs/session-status/session-5-iteration-budget.md`
- Session 6: `docs/session-status/session-6-builder-bake.md`

A session status file should contain: current slice, changed files, targeted tests,
full gates, live verification, blockers/holds, and readiness claim. This keeps loop
progress visible without creating a shared-doc merge hotspot.
## Session prompt template

Use this exact opening prompt for each Codex/Claude session, replacing the session
number and worktree:

```
You are StarNet Session <N>. Read AGENTS.md and docs/STARNET_SESSION_LOOPS_1_6.md.
Work only in <worktree> on <branch>. You are not alone in the repo.

Run your session loop continuously:
1. sync/check worktree registry,
2. select the next unmet item from your session section,
3. write a failing test or explicit verification recipe,
4. implement the smallest slice,
5. run the required gate,
6. commit only your owned files by pathspec,
7. update only your own `docs/session-status/session-*.md` ledger,
8. repeat until your DONE condition is met, or mark BLOCKED/HELD with the exact reason.

Never self-merge to trunk. When complete, report READY to the orchestrator with changed
files, tests, live verification, remaining risks, and whether the result meets the
session's done condition.
```

## Status board

| Session | Branch | Status | Current gate | Notes |
|---|---|---|---|---|
| 1 Sidecar Station Authority | `agent/station-authority-gap1` | TODO | none | Highest-priority authority boundary |
| 2 Org Validator / PipelineEdge | `agent/org-graph-gap2` | TODO | waits on S1 for sidecar integration | Can build pure validator first |
| 3 Desktop Release | `agent/starnet-release-gate` | WATCH | waits on active Tauri hardening lanes | Rust toolchain may block final build |
| 4 Managed Billing | `agent/managed-credits` | TODO | none | Keep BYOK isolated; managed fails closed |
| 5 Subagent Budget | `agent/iteration-budget` | TODO | none | the reference harness H6.3 |
| 6 Builder Scale | `agent/gap6-builder-bake` | TODO | waits on S1/S2 for authority semantics | Can build bake/chunk tests first |

## Perfect-standard checklist

A session is "perfect standard" only if all are true:

- The named DONE condition is met without waivers.
- `npm run test:fast` is green in the session worktree after final sync.
- Any touched HTTP/desktop/release surface also passes its required gate.
- UI or visual changes are live-verified with screenshots/golden checks.
- No trusted-authority path depends on renderer-asserted capabilities.
- No secrets are logged or sent to the renderer.
- The branch is rebased onto current trunk and ready for orchestrator merge.
- Remaining risks are either zero or explicitly accepted in the status board.

