# Group coordination follow-up â€” 2026-09-05

Worktree: C:\Users\andro\gen-trees\group-dm-plan-0904
Branch: agent/group-dm-plan-0904. Not merged into trunk.

## Requested stages implemented

1. Hardened the existing coordinator: bounded pending work, origin-scoped retry
   allowance, duplicate pending handoffs, repeated-request pause with explicit
   continuation, atomic Stop for active/queued/question work, preserved A-B-A review.
2. Explicit Add NAME and mention from autocomplete. This adds membership only;
   composing an @mention alone never adds an agent or starts a run. Judgment calls
   reuse brief.ask via the normal run host, persist in group storage, support choice
   buttons and the normal composer, and accept an answer once. A restarted or
   timed-out execution continues in a fresh attributed turn without silently replaying
   the previous tool invocation. Multiselect questions stage choices in the composer.
3. Small handoff lines tied to actual parent turns; existing activity area reports
   queued, connecting, working, waiting for your answer and incomplete work. No task
   success is inferred from an empty queue. No extra header or settings panel.
4. A watchdog distinguishes active tool work, approval/question waits, busy agents,
   and abandoned queued handoffs. Quiet active work gets a factual quiet indicator,
   never an automatic replay. A missing worker is rearmed; a sufficiently old abandoned
   handoff gets at most one lead follow-up per origin, with the original held. Paused,
   stopped and restarted work is not auto-resumed. Thresholds: 450 seconds without
   progress, 1200 seconds with an open tool call. No user-facing settings added.

## Evidence collected

- Expanded test/group-sessions.test.js passes: invitation idempotency, live question
  answers, duplicate answers, restart, timeout, Stop with queued work, repeated-request
  guard, injected scheduler interruption, single recovery nudge, quiet running work
  without replay, and real-token clearing of the quiet flag.
- Expanded test/group-sessions.http.test.js passes: actual runOnce/brief.ask question,
  durable card data, selected answer returned into the SAME run; existing shared-file
  publish/read/handoff and restart proof retained.
- Live port 9137: created a fresh test group; Add ENGINEER and mention changed 2 to 3
  members and filled @engineer without adding messages. Real ENGINEER question card
  survived refresh; choosing Executives resumed and completed its run.
- Real RESEARCHER question persisted across a hard sidecar restart. A normal typed
  answer was recorded once and dispatched a new continuation. That provider execution
  later returned reason empty and was correctly shown failed/partial; do not claim its
  final output was successful. Prompts explicitly identified the content as test text.
- Real NOVA pending question was canceled through normal Stop. Durable question state
  became canceled and turn state stopped. Browser error log was empty after reconnect.
- Live test group id: ws_mtny650d8z63 (Group chat). Original Group DM live test retained.

## Running the preview

Use node dev/seed.js --keep from this worktree with SKYNET_PORT=9137 and
SKYNET_DEFAULT_MODEL=anthropic/claude-haiku-4.5. Existing dev/.env.dev supplies the key;
never print it. Preserve dev/.scratch-workspace. APPDATA/LOCALAPPDATA/XDG_DATA_HOME
were set to this worktree's dev/.group-profile. Discover actual processes before restart.

## Gate status

Final verification: all 702 fast steps and all 90 HTTP steps GREEN.
Logs: dev/group-coordination-fast.log and dev/group-coordination-http.log.
The unchanged manifests were run sequentially with a 1200-second outer deadline
using scripts/timeout.mjs and npm run test:fast:raw / test:http:raw. Earlier runs
hit an LSP process-count race, unrelated sidecar boot timeouts and the default
600-second whole-suite deadline. The LSP and workshop cases passed in isolation;
the final complete sequential runs passed without excluding tests.

Final live reload: zero old settings or second-composer elements; matching header,
transcript and composer geometry with no horizontal overflow. Internal TASK_QUESTION
fallback markers no longer appear in chat; the durable card owns question rendering.
After Stop and the final backend restart, a new normal-composer message completed
with the requested READY reply. Preview launcher PID at handoff: 30944 (rediscover
its actual child before stopping it). No merge into trunk was performed.

## Scope

No parallel group execution, new settings, inferred task-completion status, arbitrary
prose-triggered agent runs, or automatic replay of uncertain tool effects. Agent models,
credentials, permissions and workspace jails still resolve through the existing run host.
Recovery fault cases were exercised deterministically in the coordinator tests; the
450/1200-second watchdog thresholds were not waited out in the interactive preview.
