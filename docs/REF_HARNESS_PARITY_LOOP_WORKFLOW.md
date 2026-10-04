# the reference harness Parity Loop Workflow

## Goal Condition

The loop is complete when each of the five ref-parity areas has:

1. A reference-harness reference invariant identified from `C:\Users\<you>\harness-ref`.
2. A StarNet gap assessment against the current JS/Tauri harness.
3. A concrete code or test change for the highest-risk gap.
4. Passing targeted verification and `npm run test:fast`.
5. A scoped commit on the active agent worktree.

## Automated Loop

Repeat until all five areas are green:

1. Pick the highest-risk unchecked area.
2. Read the reference harness source and tests for the invariant, not just docs.
3. Read the StarNet implementation and current tests.
4. Classify the gap as `implementation`, `coverage`, or `already-covered`.
5. Add the smallest regression test that would catch the ref-class failure.
6. Patch StarNet using existing modules and contracts.
7. Run the narrow test, then the relevant suite.
8. Update this file with the result.
9. Commit only the touched files.

## Areas

| Area | the reference harness invariant | StarNet gap | Loop status |
| --- | --- | --- | --- |
| 1. Routines / cron | Manual run must claim/fire immediately through the same observable run body as scheduled fires. Scheduled/manual fires must be visible outside the local panel. | Closed: `/api/cron/run` now shares the scheduled-fire work-item helper, broadcasts run lifecycle SSE, and has source-lock plus real sidecar e2e coverage. | Green: `node test/cron.run-now.test.js`, `node test/cron.tick.test.js`, and `npm.cmd run test:http` passed. |
| 2. Messaging channels | Inbound platform messages must drive the same run host, keep session/delivery boundaries durable, and survive transport edge cases with fake-transport tests. | Closed: Telegram can now be pointed at a local Bot API fake, and a true sidecar e2e proves inbound DM -> `runOnce` -> provider -> `sendMessage` -> SSE -> transcript. | Green: `node test/channels.telegram.e2e.test.js`, channel unit tests, and `npm.cmd run test:http` passed. |
| 3. Subagents / delegation | Background workers need durable lifecycle records, interrupt/resume, bounded nesting, and no approval deadlocks. | Closed: foreground worker access already had sidecar coverage; added a real sidecar e2e for `team.spawn(background:true)` proving SSE task/lifecycle visibility and `/api/subagents` durable completion. | Green: `node test/e2e.subagent-background.test.js`, `node test/orchestration.test.js`, `node test/subagents.test.js`, and `npm.cmd run test:http` passed. |
| 4. MCP / connectors | Connectors must keep tool discovery and tool calls behind a stable manager with safe transport behavior, refresh, and portal visibility. | Closed: added a real sidecar e2e proving `/api/connectors` configuration, MCP initialize/list/call, model exposure of `mcp__demo__lookup`, manual routine execution, and SSE MCP tool-call visibility. | Green: `node test/e2e.mcp-connector.test.js`, MCP unit tests, and `npm.cmd run test:http` passed. |
| 5. State safety | the reference harness takes pre-update/pre-migration full-state backups and has targeted cron snapshot restore paths so protected jobs are not silently lost. | Closed: cron routines now use the same resilient JSON helper as other protected stores, snapshotting `cron.jobs.json.bak` before durable replace and recovering it on torn/corrupt boot. | Green: `node test/cron.durability.test.js` and `node test/cron.api.test.js` cover protected routine recovery. |
