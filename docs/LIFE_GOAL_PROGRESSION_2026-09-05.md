# Life-goal progression — 2026-09-05

The Commander level now represents recorded progress toward registered personal goals.
Crew feedback XP still represents crew development. Completing a plan does not assert
that the real-world goal has been achieved.

## Implemented loop

1. Create a goal with a success condition and at least one actionable step, or add a
   success condition to an existing plan. Choose which active goal to focus on.
2. Ask StarNet to help, or perform the action yourself and report what happened.
3. Track goal metrics and inspect the evidence behind earned Commander points.
4. Get next-step recommendations informed by goal criteria, metrics, prior results,
   and blocker feedback. Defer, mark blocked, request a smaller step, or resume a quest.
5. Extend a completed plan when more work remains. Explicitly confirm the outcome
   with evidence when the actual goal has been achieved.

The first scoring model awards 10 points for a goal-linked milestone or confirmed
quest, 10 at each goal-scoped metric checkpoint, and 100 for a confirmed goal.
Every 100 points advances one Commander level. These weights are initial product
choices, not a calibrated measure of distance to a life goal. Evidence receipts
distinguish user reports from other completion records. Existing earned history is
preserved; historical records do not receive invented retroactive points.

Goal confirmation and achievement keys are durable and deduplicated. A quest linked
to a milestone shares that milestone's award key. Metric regression or replacement
does not award the same goal checkpoint twice. Goal registration survives a lost
HTTP response using a stable locally persisted ID. History trimming preserves active
plans. User reports do not credit an assigned agent with the user's action.

Quest generation capacity is scoped to the goal. Switching focus preserves prior
quests without letting them fill the current recommendation slots. A response from
an AI request started for an earlier goal or step is discarded, with a visible
reason, if the planning context changed while the request was running.

## Live evidence

`node dev/life-goal-proof.mjs` launches its own seeded app and browser. The final
combined source passed the DOM -> HTTP -> durable store -> restart walkthrough:

- Three reported actions: active goal, 100% of plan, 30 Commander points, no achieved goal.
- Metric updates reached the planner request. A generated quest was deferred,
  resumed, and completed through a user report.
- Explicit outcome confirmation: 160 points, Commander level 2, evolution stage 1.
- Restart and repeated confirmation: unchanged points and evolution, no active completed goal.
- No collected browser warnings/exceptions or unthemed native-control paint failures.

The provider in this proof is a deterministic local mock. This verifies the product
loop and planning context plumbing, not the quality of recommendations from a real
provider. Installed-desktop behavior and release packaging are outside this proof.

The next product validation should assess whether recommended steps actually move
users toward their success conditions, and tune scoring and recommendation ranking
from that evidence. No powers or capabilities are locked behind Commander levels.

## Integration verification

Merged into `feat/harness-backend` as `46b944c11`, after combining the current website
preview repair. Pre-merge gates passed 722/722 fast and 99/99 HTTP. The combined
website candidate passed 722/722 fast and the live browser/restart proof again.
Post-merge gates passed 722/722 fast and 99/99 HTTP, both exit 0, on the unchanged
integration candidate. Logs are `dev/life-post-fast.log` and `dev/life-post-http.log`
in the integration checkout. The seeded proof receipt is retained in the task
worktree under `dev/.scratch-workspace/life-proof/receipt.json`.

The pre-existing unstaged QA notes and Rooms handoff were preserved. No package was
built or installed, and no release was published by this task.
