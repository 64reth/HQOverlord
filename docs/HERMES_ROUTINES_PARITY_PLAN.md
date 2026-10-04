# Hermes routines/cron parity completion plan

## Completion bar

Parity means equivalent observable behavior for scheduled work, not matching internal architecture or merely
having similarly named fields. A claim is complete only when the final trunk build passes deterministic
conformance, repository gates, restart/fault injection, and a live seeded-app journey.

## Conformance matrix

| Capability | StarNet seam | Required proof | State |
| --- | --- | --- | --- |
| Result delivery | cron driver + channel/session delivery | exact final output reaches origin/specific target once | Implemented; focused + HTTP + live proof |
| Script/no-agent | guarded shell script preflight | zero-provider execution, timeout/failure, durable stdout | Implemented; HTTP + live proof |
| Skills/project cwd | required preloads + host-validated run cwd | missing skill fails closed; concurrent runs keep isolated cwd | Implemented; focused + HTTP proof |
| Context pipelines | `contextFrom` assembly | upstream output is fenced, rescanned, ordered, and durable | Implemented; focused proof |
| Per-job tools | toolset intersection after authority resolution | disabled families and nested/parallel maps stay unavailable | Implemented; focused proof |
| Continuable delivery | channel history + per-run transcript | delivered prompt/output can continue after restart | Implemented; HTTP + live proof |
| Output-limit continuation | shared agent loop | scheduled model run deduplicates continuation and accounts every call | Implemented; active scheduled-runtime trajectory |
| Active-run recovery | append-only run journal | interrupted cron is attributable; uncertain mutations never auto-replay | Shared runtime landed; cron attribution proof added |
| Durable recall | segmented transcript index | old routine output remains retrievable after restart/rotation | Implemented; boot-level cron transcript recovery proof |
| Behavioral evaluation | trajectory evaluator | active cron task reproduces reviewed deterministic receipt | Implemented; 8/8 active scenarios pass |

## Execution order

1. Keep `agent/cron-hermes-parity` synchronized by merging current `feat/harness-backend` into it.
2. Preserve host-minted cron identity in active-run recovery records and prove it across a real restart.
3. Add a deterministic scheduled-run trajectory covering semantic continuation, delivery, journaling, and recall.
4. Exercise failure cases: killed process, uncertain mutation, corrupt/torn journal, delivery failure, and bounded continuation exhaustion.
5. Run focused tests, the active bridge evaluation pack, `npm run test:fast`, and `npm run test:http`.
6. Run `node dev/seed.js --keep` and verify the Routines UI plus script/model delivery and recovery telemetry.
7. Merge through the worktree protocol, rerun both full gates on the exact merged trunk, and only then record a parity verdict.

## Stop conditions

Do not claim complete parity while any matrix row lacks runtime evidence, either full gate is red, the branch is
not merged, or an interrupted mutating tool call can be replayed automatically. Differences outside the
routines/cron category are tracked separately and do not weaken or inflate this verdict.
