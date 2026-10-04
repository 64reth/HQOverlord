# Session 2 - Org Validator / PipelineEdge

## Current State

- Status: `HELD-S1-SIDECAR-AUTHORITY`
- Branch/worktree: `agent/org-graph-gap2` in `C:\Users\<you>\gen-trees\org-graph-gap2`
- Current slice: pure org graph validator plus additive `PipelineEdge` persistence/readiness; extended with duplicate/self/malformed raw `PipelineEdge` rejection, explicit grant-bound agent validation, footprint-level placed-object validation, and malformed `PipelineEdge.lane` rejection. Current run rechecked the dependency gate and found S1 still unmerged, so no sidecar acceptance/routing wiring was attempted.
- Runbook note: `AGENTS.md` was requested but is absent under `C:\Users\<you>\gen-trees`; followed `docs/STARNET_SESSION_LOOPS_1_6.md`.

## Changed Files

- `frontend/app/orgvalidator.js`
- `frontend/app/worldmodel.js`
- `test/org-validator.test.js`
- `test/worldmodel.test.js`
- `package.json`
- `docs/session-status/session-2-org-graph.md`

## Evidence

- Added pure validator result shape `{ok, errors, warnings, graph}`.
- Added stable severed handoff reason code: `PIPELINE_SEVERED_CONNECT_CORRIDOR`.
- Validates:
  - duplicate bay anchors: `AGENT_DUPLICATE_ANCHOR`
  - missing compute: `AGENT_MISSING_COMPUTE`
  - disconnected legal bay room: `AGENT_UNREACHABLE_ANCHOR`
  - unplaced grant object: `GRANT_UNPLACED_OBJECT`
  - grant bound to an invalid agent id: `GRANT_BAD_AGENT`
  - grant bound to an unknown agent: `GRANT_UNKNOWN_AGENT`
  - grant bound to an agent seated in another room: `GRANT_WRONG_ROOM`
  - grant object footprint crossing room/void boundaries: `GRANT_BAD_FOOTPRINT`
  - bay anchor footprint crossing room/void boundaries: `AGENT_ANCHOR_BAD_FOOTPRINT`
  - unbound connector portal: `CONNECTOR_UNBOUND`
  - unknown edge endpoint: `PIPELINE_UNKNOWN_AGENT`
  - malformed raw edge shape: `PIPELINE_BAD_EDGE`
  - duplicate edge definition: `PIPELINE_DUPLICATE_EDGE`
  - self-loop edge definition: `PIPELINE_SELF_EDGE`
  - no projected path graph: `PIPELINE_NO_PATH_GRAPH`
  - sealed/severed handoff path: `PIPELINE_SEVERED_CONNECT_CORRIDOR`
- Added additive `doc.edges: []` migration/default with `PipelineEdge {from,to,whenKind,lane?}` accessors and mutators.
- Preserved `connectorId` through worldmodel migration so connector portal grants remain stable after deserialize.
- Added spawn/trunk-to-bay path validation so an agent cannot be seated in an otherwise valid but unreachable room.
- Added duplicate `PipelineEdge` validation so readiness for a repeated `{from,to,whenKind,lane?}` key is hard-false instead of silently ambiguous.
- Added self-loop `PipelineEdge` validation so raw snapshots cannot mark `A->A` handoffs runnable by pathing to the same anchor.
- Added grant-bound agent validation so a prop-level `agentId` can only target a known legal agent seated in the same room as the placed grant object.
- Added malformed raw `PipelineEdge` validation so blank endpoints or missing/invalid `whenKind` fail with `PIPELINE_BAD_EDGE` before path readiness is evaluated.
- Added footprint-level validation so raw snapshots cannot grant capability objects or legal bay anchors by placing only the top-left tile on deck while the rest crosses into another room or void.
- Added malformed `PipelineEdge.lane` validation so raw snapshots and migrated docs reject lane labels outside the same stable token grammar as `whenKind`.

## Tests Run

- `node test/worldmodel.test.js` - pass, `worldmodel: OK (192 assertions)`
- `node test/org-validator.test.js` - pass, `org-validator: OK (44 assertions)`
- `node test/pipeline.test.js` - pass, `pipeline: OK (32 assertions)`
- `npm.cmd run test:fast` - pass on 2026-06-26T14:00:21-04:00 after the grant-bound agent validation slice.
- `npm.cmd run test:fast` - pass on 2026-06-26T15:01:47-04:00 after the malformed raw `PipelineEdge` validation slice.
- `node test/org-validator.test.js` - pass, `org-validator: OK (50 assertions)` on 2026-06-26T16:00:51-04:00 after footprint validation.
- `node test/worldmodel.test.js` - pass, `worldmodel: OK (192 assertions)` on 2026-06-26T16:00:51-04:00.
- `node test/pipeline.test.js` - pass, `pipeline: OK (32 assertions)` on 2026-06-26T16:00:51-04:00.
- `npm.cmd run test:fast` - pass on 2026-06-26T16:00:51-04:00 after the footprint validation slice.
- `node test/org-validator.test.js` - pass, `org-validator: OK (50 assertions)` on 2026-06-26T17:01:07-04:00 during S1 dependency recheck.
- `node test/worldmodel.test.js` - pass, `worldmodel: OK (192 assertions)` on 2026-06-26T17:01:07-04:00.
- `node test/pipeline.test.js` - pass, `pipeline: OK (32 assertions)` on 2026-06-26T17:01:07-04:00.
- `npm.cmd run test:fast` - pass on 2026-06-26T17:01:07-04:00 while held for S1 sidecar authority.
- `node test/org-validator.test.js` - pass, `org-validator: OK (52 assertions)` on 2026-06-26T18:02:01-04:00 after `PipelineEdge.lane` validation.
- `node test/worldmodel.test.js` - pass, `worldmodel: OK (193 assertions)` on 2026-06-26T18:02:01-04:00.
- `node test/pipeline.test.js` - pass, `pipeline: OK (32 assertions)` on 2026-06-26T18:02:01-04:00.
- `npm.cmd run test:fast` - pass on 2026-06-26T18:02:01-04:00 after `PipelineEdge.lane` validation.

## Full Gates

- `npm.cmd run test:fast` completed green on 2026-06-26T14:00:21-04:00 after the grant-bound agent validation slice.
- `npm.cmd run test:fast` completed green on 2026-06-26T15:01:47-04:00 after the malformed raw `PipelineEdge` validation slice.
- `npm.cmd run test:fast` completed green on 2026-06-26T16:00:51-04:00 after footprint-level placed-object validation.
- `npm.cmd run test:fast` completed green on 2026-06-26T17:01:07-04:00 during the current S1 dependency hold recheck.
- `npm.cmd run test:fast` completed green on 2026-06-26T18:02:01-04:00 after malformed `PipelineEdge.lane` rejection.
- No HTTP or live sidecar gate run in this checkpoint; this slice is pure validation/model persistence only.

## Live Verification

- Not applicable for this checkpoint. No UI, HTTP, or runtime sidecar integration was changed.

## Blockers / Holds

- `HELD-S1-SIDECAR-AUTHORITY`: runbook says if S1 is not merged, Session 2 works only on pure validation modules and tests. Sidecar station acceptance/routing integration remains blocked until S1 exposes the authority API.
- Current coordination board command `node scripts/board.mjs --files frontend/app/orgvalidator.js test/org-validator.test.js test/pipeline.test.js test/worldmodel.test.js frontend/app/pipeline.js frontend/app/worldmodel.js package.json docs/session-status/session-2-org-graph.md` showed no uncommitted tracked edits for `frontend/app/orgvalidator.js`; it also showed `agent/station-authority-gap1` still unmerged and ahead of trunk, so the S1 dependency remains explicit.

## Readiness Claim

- This checkpoint is ready as a pure Session 2 slice and is currently held for S1 integration.
- Overall Session 2 done condition is not yet met because sidecar station/routing acceptance cannot be wired until S1 lands.

## Next Loop Condition

- If S1 is still unmerged: select the next pure invariant (additional edge readiness or grant-to-placed-object cases) and add tests to `test/org-validator.test.js`.
- If S1 is merged: wire `OrgValidator.validateOrg` into sidecar station acceptance and routing acceptance without editing shared event/schema contracts.
