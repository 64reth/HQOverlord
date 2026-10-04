# Session 1 - Station Authority

## Current slice

HELD-FOR-COORDINATION on the HTTP integration slice. The next unmet Session 1 items are `/api/station` acceptance/persistence and `/api/run` ignoring forged `body.placed`, both of which require `sidecar/index.js`. That file is still contended as of 2026-06-26T21:59Z, so no source edits were made in this loop.

## Changed files

- `sidecar/station-store.js`
- `sidecar/routing/router.js`
- `frontend/app/worldmodel.js`
- `test/station-authority.test.js`
- `test/routing.b5.test.js`
- `docs/session-status/session-1-station-authority.md`
- 2026-06-26T10:52Z loop only updated `docs/session-status/session-1-station-authority.md`.
- 2026-06-26T17:56Z loop only updated `docs/session-status/session-1-station-authority.md`.
- 2026-06-26T18:56Z loop only updated `docs/session-status/session-1-station-authority.md`.
- 2026-06-26T19:57Z loop only updated `docs/session-status/session-1-station-authority.md`.
- 2026-06-26T20:58Z loop only updated `docs/session-status/session-1-station-authority.md`.
- 2026-06-26T21:59Z loop only updated `docs/session-status/session-1-station-authority.md`.

## Evidence

- Added a routing test proving forged legacy plan objects (`cabinet`, `workbench`) cannot grant files or shell when an authoritative Station document is installed.
- Added a transactional test proving invalid empty Station updates are refused and the last-good Station remains active.
- Preserved `connectorId` through Station deserialize/migration so sidecar-derived connector portal authority keeps the bound server identity.
- Added pure station-store coverage proving `SaveDoc.station` can be accepted from a save envelope, missing Station data is refused, and invalid Station updates leave the last-good Station active.
- Added routing coverage proving a forged legacy RoutingPlan cannot override `resolveTarget()` after a Station document with deployable conveyor geometry is installed.
- Added routing coverage proving a non-deployable Station routing update is refused and the last-good Station-derived route remains active.
- `sidecar/index.js` remained untouched because it is still contended.
- 2026-06-26T21:59Z board retry confirmed `sidecar/index.js` is still contended, so the HTTP station/run authority slice remains held.

## Targeted tests

- `node test\routing.b5.test.js` - pass, 30 assertions.
- `node test\station-authority.test.js` - pass, 9 assertions.
- `node test\worldmodel.test.js` - pass, 181 assertions.
- `node test\routing.b5.test.js` - pass, 36 assertions on 2026-06-26T04:55:42-04:00.
- `node test\station-authority.test.js` - pass, 9 assertions on 2026-06-26T04:55:42-04:00.
- Not rerun in the 2026-06-26T05:50:59-04:00 loop because no source code changed.
- Not rerun in the 2026-06-26T06:52:58-04:00 loop because the session is held before code changes.
- Not rerun in the 2026-06-26T13:56:34-04:00 loop because the session is held before code changes.
- Not rerun in the 2026-06-26T14:56:42-04:00 loop because the session is held before code changes.
- Not rerun in the 2026-06-26T15:57:29-04:00 loop because the session is held before code changes.
- Not rerun in the 2026-06-26T16:58:48-04:00 loop because the session is held before source code changes.
- Not rerun in the 2026-06-26T17:59:12-04:00 loop because the session is held before source code changes.

## Full gates

- `npm.cmd run test:fast` - pass on 2026-06-26T02:54:34-04:00.
- `npm.cmd run test:fast` - pass on 2026-06-26T03:56:00-04:00.
- `npm.cmd run test:fast` - pass on 2026-06-26T04:55:42-04:00.
- Not rerun in the 2026-06-26T05:50:59-04:00 loop because the session is held before code changes. Run before any READY claim.
- Not rerun in the 2026-06-26T06:52:58-04:00 loop because no source code changed and the session remains HELD. Run before any READY claim.
- Not rerun in the 2026-06-26T13:56:34-04:00 loop because no source code changed and the session remains HELD. Run before any READY claim.
- Not rerun in the 2026-06-26T14:56:42-04:00 loop because no source code changed and the session remains HELD. Run before any READY claim.
- Not rerun in the 2026-06-26T15:57:29-04:00 loop because no source code changed and the session remains HELD. Run before any READY claim.
- Not rerun in the 2026-06-26T16:58:48-04:00 loop because no source code changed and the session remains HELD. Run before any READY claim.
- Not rerun in the 2026-06-26T17:59:12-04:00 loop because no source code changed and the session remains HELD. Run before any READY claim.

## Live verification

- Not run in this checkpoint. No frontend runtime flow or HTTP route was changed.

## Blockers / holds

- HELD-FOR-COORDINATION on `sidecar/index.js` for the `/api/station` hook. `node scripts/board.mjs --files sidecar/index.js sidecar/station-store.js sidecar/routing/router.js test/sidecar.http.test.js docs/session-status/session-1-station-authority.md` on 2026-06-26T07:53Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this checkpoint.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js sidecar/station-store.js sidecar/routing/router.js test/sidecar.http.test.js test/station-authority.test.js docs/session-status/session-1-station-authority.md` on 2026-06-26T08:51Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this checkpoint.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js sidecar/station-store.js sidecar/routing/router.js test/sidecar.http.test.js docs/session-status/session-1-station-authority.md` on 2026-06-26T09:50Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js sidecar/station-store.js sidecar/routing/router.js test/sidecar.http.test.js test/station-authority.test.js test/routing.b5.test.js docs/session-status/session-1-station-authority.md` on 2026-06-26T10:52Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js sidecar/station-store.js sidecar/routing/router.js test/sidecar.http.test.js test/station-authority.test.js docs/session-status/session-1-station-authority.md` on 2026-06-26T17:56Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js sidecar/station-store.js sidecar/routing/router.js test/station-authority.test.js test/routing.b5.test.js frontend/app/world.js frontend/app/harness.js frontend/app/app.js frontend/app/worldmodel.js` on 2026-06-26T18:56Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js` on 2026-06-26T19:57Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit` and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js` on 2026-06-26T20:58Z reported active uncommitted edits to `sidecar/index.js` in `agent/hermes-settings-audit` and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.
- HELD-FOR-COORDINATION still applies to `sidecar/index.js`. `node scripts/board.mjs --files sidecar/index.js` on 2026-06-26T21:59Z reported active uncommitted edits to `sidecar/index.js` in `(detached)`, `agent/hermes-settings-audit`, and `agent/starnet-spend-model-honesty`. No `sidecar/index.js` edits were made in this loop.

## Readiness claim

- Checkpoint only, not Session 1 READY. Station-store and router now derive routing/capability authority from accepted Station documents, but remaining Session 1 loop items include `/api/station` acceptance/persistence hook in `sidecar/index.js`, `/api/run` ignoring forged `body.placed`, HTTP forged-station/routing/capability tests, `npm.cmd run test:fast`, and live refit/COMMS smoke.

## Next loop condition

- Retry the `sidecar/index.js` board check after the active lanes release it. Then wire `/api/station`/save acceptance through `stationStore.setSaveDoc()` and `router.setStation()` before removing interactive trust in renderer-posted `placed`.
