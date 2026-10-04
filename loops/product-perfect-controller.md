# Product-Perfection Controller — first failing wave until PRODUCT PERFECT

Mandate: execute `qa/product-perfect/waves.json` in dependency order and keep working the first
non-passing wave until its machine gate passes. This is one serialized judging loop, not eight
competing feature loops.

## Every wake

1. Read `AGENTS.md`, the required StarNet doctrine/orientation docs, this file, and the active goal.
   Run `git worktree list` and inspect live agents before making changes. Work only in an assigned
   isolated worktree; never feature-edit the integration tree.
2. Run `node scripts/qa/product-perfect.mjs --status`. The first non-pass is the only active wave.
   If an earlier receipt became stale, return to it automatically. Never accept a hand-edited status,
   prose claim, old receipt, browser substitute for desktop proof, or proof from another commit.
3. If another live lane owns the same files, do not overlap it. Collect its evidence or route one
   bounded task to the owner. At most one wave is active; subagents may work only on disjoint bounded
   checks with separate worktrees.
4. Run `node scripts/qa/product-perfect.mjs --run`. For the first failing condition, reproduce the
   failure, add a regression verifier, implement the smallest complete fix in its owning lane, and
   verify in the live app when the condition is user-visible. Tests alone do not prove live behavior.
5. Commit only owned paths with explicit pathspecs. Never edit `shared/events.js` or
   `shared/schema.js`; route additive contract needs to their owner. Run `npm run test:fast`, plus
   `npm run test:http` for sidecar/ship changes, before a branch is declared ready.
6. Rerun the current wave. Advance only on a candidate-bound PASS receipt. Record a concise digest
   containing commit, wave, failing/passing check, evidence path, and next action. An unchanged
   external blocker is a wait condition, not permission to start a later wave.

Each wake must produce one of: a verified pass, a bounded commit with evidence, or a precise blocker.
Do not spin and do not weaken a condition to manufacture progress.

## Stop conditions

- Success: all eight waves pass for one immutable candidate and the controller prints
  `PRODUCT PERFECT`. Mark the active goal complete, pause this heartbeat, and report the evidence.
  Do not publish or release.
- Blocked: only after the same external/human blocker persists for three consecutive wakes and no
  safe in-scope work remains, mark the goal blocked, pause the heartbeat, and ask one precise question.
- Safety: if the active goal is missing or the heartbeat targets another task, pause immediately.
