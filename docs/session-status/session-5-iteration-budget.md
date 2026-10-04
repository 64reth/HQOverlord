# Session 5 - Subagent Iteration Budget

## Current Slice

H6.3 subagent budget containment: worker `maxIters` propagation and no-op turn refund.

## Changed Files

- `sidecar/loop.js`
- `sidecar/tools/builtin/orchestration.js`
- `test/loop.replay.test.js`
- `test/orchestration.test.js`
- `docs/REF_HARNESS_PARITY_PLAN.md`
- `docs/session-status/session-5-iteration-budget.md`

## Evidence

- `runAgentLoop` default iteration ceiling now matches the lead default of 40 when no caller supplies `limits.maxIters`.
- Empty/no-assistant/no-tool turns refund to that turn's starting count.
- Refunds do not erase earlier productive tool turns.
- `team.dispatch`, background dispatch, `team.resume`, and `team.spawn` pass an explicit worker iteration cap of 10 by default.
- `workerMaxIters` dependency override is covered for tuned worker caps.

## Tests Run

- `node test/loop.replay.test.js` - pass at 2026-06-26 07:52 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 07:52 UTC
- `node test/loop.replay.test.js` - pass at 2026-06-26 08:51 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 08:51 UTC
- `node test/loop.replay.test.js` - pass at 2026-06-26 09:52 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 09:52 UTC
- Not rerun at 2026-06-26 10:52 UTC; this loop made no implementation edits because the remaining production plumbing is blocked/held.
- `node test/loop.replay.test.js` - pass at 2026-06-26 17:59 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 17:59 UTC
- `node test/loop.replay.test.js` - pass at 2026-06-26 18:58 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 18:58 UTC
- `node test/loop.replay.test.js` - pass at 2026-06-26 20:00 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 20:00 UTC
- `node test/loop.replay.test.js` - pass at 2026-06-26 21:01 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 21:01 UTC
- `node test/loop.replay.test.js` - pass at 2026-06-26 22:04 UTC
- `node test/orchestration.test.js` - pass at 2026-06-26 22:04 UTC

## Full Gate

- `npm.cmd run test:fast` - pass at 2026-06-26 07:53 UTC
- `npm.cmd run test:fast` - pass at 2026-06-26 08:52 UTC
- `npm.cmd run test:fast` - pass at 2026-06-26 09:52 UTC
- Not rerun at 2026-06-26 10:52 UTC; not declaring READY while production run-host plumbing remains blocked.
- `npm.cmd run test:fast` - pass at 2026-06-26 17:59 UTC
- `npm.cmd run test:fast` - pass at 2026-06-26 18:58 UTC
- `npm.cmd run test:fast` - pass at 2026-06-26 20:00 UTC
- `npm.cmd run test:fast` - pass at 2026-06-26 21:01 UTC
- `npm.cmd run test:fast` - pass at 2026-06-26 22:04 UTC

## Live Verification

- Not applicable for this backend loop/accounting slice.

## Blockers / Holds

- `sidecar/index.js` is required to consume `o.maxIters` in production `runOnce`, but board check at 2026-06-26 07:52 UTC showed it is contended by `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`. Held instead of editing the contended run host.
- `sidecar/index.js` is also outside the Session 5 owned-file list in `docs/STARNET_SESSION_LOOPS_1_6.md`; final production plumbing needs owner/orchestrator coordination before this session can touch it.
- Board check at 2026-06-26 08:51 UTC now also shows `sidecar/loop.js` actively contended by `agent/starnet-replacement-eval` and `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- Board check at 2026-06-26 09:51 UTC still shows `sidecar/loop.js` actively contended by `agent/starnet-replacement-eval` and `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- Board check at 2026-06-26 10:51 UTC still shows `sidecar/loop.js` actively contended by `agent/starnet-replacement-eval` and `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- `sidecar/index.js` inspection at 2026-06-26 10:52 UTC still shows `runAgentLoop` using `limits: { maxIters: CAPS.maxIters, ... }`; `o.maxIters` is not yet consumed by the production run host.
- Board check at 2026-06-26 17:57 UTC still shows `sidecar/loop.js` actively contended by `agent/starnet-replacement-eval` and `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- Board check at 2026-06-26 17:57 UTC still shows `sidecar/index.js` actively contended by `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`; it also remains outside the Session 5 owned-file list.
- `AGENTS.md` was requested by the session prompt but is absent under `C:\Users\<you>\gen-trees`; this run followed `docs/STARNET_SESSION_LOOPS_1_6.md` and existing repository conventions.
- Board check at 2026-06-26 18:58 UTC still shows `sidecar/index.js` actively contended by `agent/hermes-settings-audit`, `agent/starnet-replacement-eval`, and `agent/starnet-spend-model-honesty`; it also remains outside the Session 5 owned-file list.
- `sidecar/index.js` inspection at 2026-06-26 18:58 UTC still shows `runAgentLoop` using `limits: { maxIters: CAPS.maxIters, ... }`; `o.maxIters` is not yet consumed by the production run host.
- Board check at 2026-06-26 19:59 UTC still shows `sidecar/loop.js` actively contended by `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- Board check at 2026-06-26 19:59 UTC still lists `sidecar/index.js` as a contended file across multiple lanes; it also remains outside the Session 5 owned-file list.
- `sidecar/index.js` inspection at 2026-06-26 20:00 UTC still shows `runAgentLoop` using `limits: { maxIters: CAPS.maxIters, ... }`; `o.maxIters` is not yet consumed by the production run host.
- Board check at 2026-06-26 21:00 UTC still shows `sidecar/loop.js` actively contended by `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- Board check at 2026-06-26 21:00 UTC still lists `sidecar/index.js` as a contended file across multiple lanes; it also remains outside the Session 5 owned-file list.
- `sidecar/index.js` inspection at 2026-06-26 21:01 UTC still shows `runAgentLoop` using `limits: { maxIters: CAPS.maxIters, ... }`; `o.maxIters` is not yet consumed by the production run host.
- Board check at 2026-06-26 22:02 UTC still shows `sidecar/loop.js` actively contended by `agent/starnet-spend-model-honesty`; held instead of editing a hot owned implementation file.
- `sidecar/index.js` remains outside the Session 5 owned-file list; inspection at 2026-06-26 22:02 UTC still shows `runAgentLoop` using `limits: { maxIters: CAPS.maxIters, ... }`; `o.maxIters` is not yet consumed by the production run host.

## Readiness Claim

HELD-FOR-COORDINATION. The owned loop and orchestration surfaces are implemented and targeted/full tests pass, but the session is not READY until `sidecar/index.js` can be safely updated to thread `o.maxIters` into `runAgentLoop` limits.

## Next Loop Condition

Wake after the `sidecar/index.js` and `sidecar/loop.js` contention clears, then add the narrow production run host plumbing if the orchestrator/owner permits this session to touch the run host; otherwise request the owner to thread `o.maxIters` into `runAgentLoop` limits. Run targeted tests plus `npm.cmd run test:fast`, then commit or mark READY.
