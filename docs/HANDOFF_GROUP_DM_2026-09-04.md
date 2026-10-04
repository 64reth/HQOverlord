# StarNet group DM handoff — 2026-09-04

## Start here

Continue in `C:\Users\andro\gen-trees\group-dm-plan-0904`, branch
`agent/group-dm-plan-0904`. This work is NOT merged into the shared integration
checkout `C:\Users\andro\Desktop\gen` (`feat/harness-backend`).
Implementation and verification were committed through `03dad97d9` before this
handoff. The worktree was clean. Respect AGENTS.md and the StarNet task doctrine;
do not edit another agent's worktree or feature-edit the integration checkout.

Local preview: http://127.0.0.1:9137/ — already running. The in-app browser is open
on a two-agent Group chat (NOVA and RESEARCHER). Actual sidecar PID at handoff was
48908; rediscover processes before stopping/restarting anything.

## User intent and accepted design

The user wants a NORMAL chat session with multiple chosen agents. They explicitly
rejected the growing collection of settings, modes, checkboxes and enable toggles.
Do not reintroduce the control panel or move it behind another menu.

- Keep participants, agent count, and + Add agents integrated into the EXISTING
  COMMS identity line (`#comms-idbar`). No extra header row.
- Use the actual normal COMMS composer (`#chat-inputrow` / `#chat-input`), Send,
  attachment staging and Stop. There is no second group composer.
- Add agents opens StarNet's real terminal window, using
  `StationUI.toggleTerm('group-agents', 'ADD AGENTS', ...)`. Keep it under `#terms`
  so the existing CRT layer applies. The earlier body-mounted popup looked wrong.
- Picker: search, clickable agent rows, selected count, ADD and Cancel. No checkbox,
  enable button, default-responder dropdown, session-title form or advanced settings.
- Removed Chat options, turn-limit controls, independent-answer switches, session
  instructions, saved-group/branch/catch-up controls and completed activity history
  from the group UI. Backend capabilities may still exist; that is NOT permission
  to expose them again.
- Keep speaker labels on every group reply, including consecutive different agents.
  Only active work, approvals, failures or continuation needs add contextual controls.

The user has NOT yet approved the final simplified UI. Next step is their hands-on
feedback, not speculative feature expansion.

## Implementation map

- `frontend/app/group-chat.js`: participant line, standard-terminal picker, durable
  group discovery/polling, transcript, mention/reply targeting, file previews,
  contextual turn states, send and Stop integration.
- `frontend/app/chat.js`: routes group loading/sending/stopping through GroupChat
  while reusing normal composer controls; exports refreshGroupControls.
- `frontend/app/app.js` and workstream integration: group session adoption/persistence.
- `sidecar/group-sessions.js`: membership, durable transcript and turn queue,
  handoffs, exact-version shared artifacts, controls and restart recovery.
- `sidecar/index.js`: group API and normal execution-host integration.
- `website/app/app/*`: generated mirrors; run `npm run sync:website` after frontend edits.
- `docs/GROUP_DM_VERIFICATION_2026-09-04.md`: accumulated evidence. Early sections
  describe the original, larger UI. Its Normal chat simplification section and THIS
  handoff supersede those historical descriptions of visible controls.

Latest important commits:
- `71a3f641d`: removed control panel and reused normal composer.
- `93c419eb1`: extracted group loading helper.
- `90f77672d`: refreshed product-perfect source lock.
- `03dad97d9`: final green test-gate evidence.

## Verified behavior

Latest full `npm run test:fast`: ALL 702 steps green, log
`dev/group-simple-fast.log`. A first run hit the history-pin source check's fixed
4000-character window. Extracting loadGroupConversation preserved behavior and
restored that check; the complete rerun passed. Source mirrors and QA locks updated.

Live UI checks on the final build:
- Normal composer sent an @researcher message; its real response appeared in the
  shared transcript, and the input cleared.
- Normal Stop interrupted an active turn; durable state confirmed `stopped`.
- Sending after Stop resumed without requiring a Resume setting.
- Switched back to a direct chat and verified its normal composer/log appeared.
- Opened the simple picker from direct and group sessions and canceled without
  changing membership. Earlier live checks verified selectable rows and ADD saving.
- No removed options or second composer in the DOM. Header/transcript/composer
  had matching x-coordinate and width and no horizontal overflow at the tested size.
- Final reload showed two participants, visible normal composer, zero old options.

Earlier real-provider proof preserved in session "Group DM live test", id
`e2375442-a340-4e1f-a2bc-d46cb2d2c93e`: ENGINEER published an intentionally wrong
arithmetic file, RESEARCHER read the exact artifact and requested correction,
ENGINEER republished, RESEARCHER verified. Four real turns completed.
Original backend HTTP suite passed all 90 tests with a 900-second outer timeout;
a previous 600-second outer timeout expired on its final test. This UI follow-up
ran the full fast gate, not another HTTP suite.

## Preview and data

Run from this worktree with `node dev/seed.js --keep`; use `SKYNET_PORT=9137` if a
restart is needed. Preserve local `dev/.env.dev` credentials without printing them.
The seed launcher uses `dev/.scratch-workspace`; `--keep` matters for preserving
sessions and test artifacts. Existing isolated profile is `dev/.group-profile`.
Inspect the existing launch configuration before restarting. Do not use npm run serve.

Do not reset/delete the user's local sessions or artifacts for cleanup. The original
proof group also contains composer/Stop test messages from this follow-up.

## Limits and next-agent cautions

- Group dispatch is sequential. Parallel dispatch, external channels and scheduling
  are separate work, not part of this UI handoff.
- Shared artifacts are immutable versions, limited to 1 MiB each. Group context has
  bounded history. Normal staged attachments are transferred to the shared artifact
  endpoint when sent; native file selection was not exercised in the latest follow-up.
- This is local-browser evidence, not installed-desktop or public-release evidence.
- No trunk integration was performed. Other agents have changed trunk, including
  chat.js. Before any merge, follow the merge ritual: synchronize by MERGING trunk
  into this Codex-authored branch, resolve in its worktree, refresh locks and rerun
  required gates. Do not rebase a Codex-authored branch or overwrite others' changes.
- Commit explicit pathspecs only; no agent co-author trailers. Source-lock relocking
  requires a clean worktree: commit reviewed changes before running
  `node scripts/qa/product-perfect/relock-surface.mjs`.

## Suggested continuation prompt

Read docs/HANDOFF_GROUP_DM_2026-09-04.md in the group-dm-plan-0904 worktree.
Preserve the normal-chat simplicity and accepted StarNet styling. Inspect the live
preview on port 9137 and address my next feedback with the smallest necessary change.
Do not bring back group settings or an extra header row.

## UI pass (2026-09-04, later session) — what changed in `frontend/app/group-chat.js`

Andrew: "fix the UI for agent group chats." Smallest visual fixes, no new controls, no settings.

- Identity line: UNCHANGED. A pill version was tried and Andrew reverted it the same evening
  ("I actually liked the top bar before") — keep the `▪ NAME ▪ NAME · N agents · + Add agents` row.
- ADD AGENTS picker REBUILT (Andrew: "terrible, I need it easier to understand and use"): two
  lists, one verb each. IN THIS CHAT (rows show colour LED, NAME, class tagline, `✕ REMOVE`; the
  lead is marked LEAD and cannot be removed) and ADD TO THIS CHAT (`+ ADD` moves the row up
  instantly). Hint line explains @name vs the lead answering. Footer shows the pending delta
  (`+1 agent · −1 agent`, "no changes yet") and SAVE is disabled until something changed; from a
  direct chat the button reads START GROUP CHAT. Search box appears only when the crew > 6.
  No toggles, no checkboxes, no "Added" state to decode.
- Speaker labels: `YOU` → `COMMANDER` (matches direct chat). Agent names take the agent's roster
  colour and the bubble rail follows it. The per-message `REPLY` button is gone: clicking a
  speaker's name is the reply affordance (sets `to NAME ✕` above the composer).
- Shared files: full-width button stack → one `SHARED ▤ file ▤ file` chip row (tool-chip voice);
  open chip highlights; preview beneath unchanged.
- Turn states: `Name: running` text → the direct chat's presence voice (`● NAME working`), gold
  for held/approval/queued, red for failed/interrupted. State words: connecting… / working /
  needs approval / ready / stopping (truthful: `working` only once the sidecar reports running).
- Streaming drafts get a blinking caret; partial replies print `partial · work did not complete`.

Live-verified on :9137 (1100×620 and 300px COMMS): no OS-painted controls, no horizontal
overflow, pill/name-click/@-autocomplete/picker all work, one real @researcher turn showed the
state row then the reply under RESEARCHER.
