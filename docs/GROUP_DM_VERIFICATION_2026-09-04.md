# Group DM local build verification

Implemented in `agent/group-dm-plan-0904`, isolated from the integration tree.
Local preview: http://127.0.0.1:9137, launched with `node dev/seed.js --keep`.
The scratch workspace and browser profile are isolated from production data.

## Shipped behavior

Create a group from chosen roster agents, or add agents to an existing direct session.
The group has one persistent transcript, explicit authors, a default responder,
targeted mentions/replies, and backend-owned turn scheduling. Agent handoffs can
return to an earlier participant, with a configurable turn limit and explicit continuation.
Actual run states, approvals, stops, errors, context cutoffs, and measured usage are shown.

Shared files are immutable versions with hashes, authenticated previews/downloads,
and exact-version reads for other participants. Other controls include independent
answers, lead comparison, session instructions, saved groups, branches, catch-up,
membership changes, interruption, retries, pause/resume, and durable restart recovery.
Station emergency stop includes group runs and queues. Direct chats remain available.

## Live browser proof

Tested with real provider responses using `anthropic/claude-haiku-4.5` on NOVA,
RESEARCHER, and ENGINEER. Group `e2375442-a340-4e1f-a2bc-d46cb2d2c93e`
is preserved as **Group DM live test** in the local preview.

The engineer created a deliberately incorrect arithmetic file, published it, and
handed review to the researcher. The researcher read the exact snapshot and requested
a correction. The engineer published a new version, then the researcher verified it.
All four turns completed through the normal execution host:

| Participant | Run ID |
| --- | --- |
| Engineer | `b56cc181-5d6e-4e28-b6cc-86648cc0486a` |
| Researcher | `69a7359d-270a-4c9c-ba5b-8f5f54921762` |
| Engineer | `fb1de573-a4ca-4288-8f4c-17b4946f0bf7` |
| Researcher | `8eda6669-8f5a-471c-aed6-27df115037e6` |

Original SHA256: `8afe257cabbac3c2d162cf9657ea284d23e0fdf4daa2c6d5ee28cace2ff8c276`.
Corrected SHA256: `cae91dcf656fede4262dba5815c12c695b52dea8e86889b904619fad0a9bf142`.
Opened the corrected version through the UI and observed the exact bytes:

```text
GROUP_DM_PROOF
2 + 2 = 4
```

Also verified in the browser:

- Three independent answers used the same context cutoff (#6).
- Removed and re-added the researcher without losing history or starting a run.
- Direct reply selected the original author.
- Paused the group and queued a request; interrupt-and-send stopped that request
  and ran only the replacement. The completed reply was `NEW_INSTRUCTION_CONFIRMED`.
- Restarted the sidecar and reloaded: transcript, roster, files, and outcomes survived.
- Saved instructions and changed the turn limit; created a reusable group and verified
  a new session had the selected agents/instructions and an empty transcript.
- Branched the discussion with copied context and no copied runs; deleted that disposable branch.
- Renamed the fresh session **Try your group chat**.
- Converted an existing direct session by adding the researcher.
- Browser console returned no warnings/errors during final interaction checks.

The eight completed proof-group turns total $0.2944169 measured usage; the stopped
queued request has no run ID. The UI rounds this to $0.2944.

## Automated verification

Focused coordinator tests cover routing, idempotency, revision conflicts, bounded
handoffs, exact artifacts, independent context, cancellation, approval ownership,
agent leases, emergency stop, branching, deletion, and restart behavior.
The HTTP integration test boots the actual sidecar and execution host with a mock
provider, writes/publishes/reviews a real file, and checks durable recovery.

- `npm run test:fast`: **702 steps green**, exit 0.
- Focused `node test/group-sessions.test.js`: PASS.
- Focused `node test/group-sessions.http.test.js`: PASS; also passed within the full HTTP run.
- Syntax checks, deterministic/emits lint, website mirror checks, and fail-open ratchet: PASS.
- The standard `npm run test:http` wrapper reached its 600,000 ms limit after
  `routing.sample.e2e.test` passed (89/90 steps), while the last step was running.
  No preceding assertion failed. Reran the exact unchanged full HTTP list through
  `npm run test:http:raw` with a 900,000 ms outer watchdog: **90 steps green**, exit 0,
  including `route-honesty.e2e: OK (66 assertions)`. No assertions or test steps were
  removed or relaxed. Logs: `dev/group-fast-final.log` and `dev/group-http-complete.log`.

## Simplified session UI follow-up

User feedback: the initial group controls were confusing. Replaced the separate
GROUP CHAT / ADD AGENTS / PARTICIPANTS entry points with one **+ Add agents**
button in the session header. The header shows the count and every selected name.
The picker opens directly to searchable agent checkboxes and **Done**; session
naming, default responder, and saved groups are optional collapsed settings.
The main group view contains the transcript and one send button. Workflow controls,
instructions, and historical run/cost details are under **Chat options**. Active
work and approvals remain visible; shared files appear when present.

Verified in the live browser: new direct session -> Add agents -> search/select ->
Done converts that same session; the header shows three names and "3 agents".
Removing an agent changes the count to two; adding it back restores three.
Reload preserves the roster. Workstream tests: 193 assertions passed; website mirror
check: 8 assertions passed. No backend execution behavior changed in this follow-up.
The follow-up fast suite passed all 702 steps (`dev/group-simple-fast.log`).
Keyboard focus was also verified to skip collapsed settings and loop within the picker.

## StarNet styling and alignment follow-up

Replaced generic pill/box styling with the existing phosphor, panel, text, border,
and raised-control tokens. Message markup now reuses COMMS `.cmsg`, `.who`, and
`.body` styling. The composer is a compact inline prompt/input/send row. The roster
header uses a stable grid, with names in a horizontally scrollable line. The picker
has a phosphor title bar, aligned search/selection rows, and a right-aligned footer.

Found the narrow-window bug: at a 591 x 912 viewport, COMMS is 200 px tall but the
old transcript minimum height pushed the composer below its bottom edge. Replaced
that minimum and whole-panel scrolling with a shrinking transcript and fixed composer.
Live DOM measurements after the change: COMMS bottom 836 px, composer bottom 809 px,
group scroll height equals client height. The same held with the 12-message proof
conversation. Picker is centered at x=85.5, width=420, height=355.47; its search and
agent rows share x=98.5 and width=394. Theme-control scan found no native white paint.
Browser warning/error log was empty. Focused control-floor tests passed 101 assertions
and workstream tests passed 193 assertions.
The full styling follow-up fast suite passed all 702 steps (`dev/group-theme-fast.log`).

## Existing identity-line integration

Per the user's annotated screenshot, removed the extra roster row entirely.
The original `comms-idbar` now owns the add button and group roster. Direct sessions
retain the NOVA selector and pinned readout; group sessions show the names/count
in that same line. Live verification found no `gc-launch` element, no header inside
the group transcript, and a 41 px identity row in both modes. The existing selector
and add button shared the same vertical center. The group picker still opened from
the inline button. Focused workstream (193) and website mirror (8) assertions passed.
Full fast regression: 702 steps green (`dev/group-inline-fast.log`).

## Standard terminal picker

Replaced the custom body-level picker with `StationUI.toggleTerm` / `closeTerm`.
The old popup's z-index 50000 placed it above the CRT scanline layer at 950.
The picker now mounts in `.term-body` under `#terms` (stacking layer 50), with the
standard `.term` glass overlay, chrome, window sizing, power animation, focus/close
behavior, and resize handle. It uses shared `key-input`, `set-row`, `fbc-sel`, and
button styling. The accepted COMMS identity line was not changed.

Live checks verified `#gc-picker` inside `.term-body`, its window under `#terms`,
the shared scanline background and glass gradients, `.term-chrome` and `.term-x`.
Search, Cancel, reopen, and Done worked; saving preserved the existing two-agent
roster, removed the picker cleanly, and retained exactly one top-bar add button.
No browser warnings/errors. Focused control-floor (101) and workstream (193)
assertions passed.
Standard-terminal follow-up: all 702 fast steps passed (`dev/group-terminal-fast.log`).

## Selectable agent list and ADD

Removed picker checkboxes. Full-width agent rows now support mouse and keyboard
selection, with `aria-pressed` and an Added indicator. Search filters names without
clearing selection. The explicit ADD action saves the chosen roster through the
existing endpoint. The standard terminal and COMMS identity line are preserved.
Live checks counted zero picker checkboxes, observed the selection count change
from two to three on click and back to two on Enter, and verified ADD closed cleanly
with the two-agent roster intact. Browser error/warning log was empty. Focused
workstream (193), control-floor (101), and mirror (8) assertions passed.
Full fast suite: 702 steps green (`dev/group-select-fast.log`).

## Normal chat simplification

Removed Chat options, session instructions, turn-limit controls, independent-answer
switches, and the separate group composer. Group conversations now use the existing
COMMS input, Send, attachment staging, and Stop controls. The accepted participant
line and standard CRT terminal picker remain; the picker contains only search,
selectable agent rows, selection count, ADD, and Cancel. Completed activity rows
are no longer repeated below the conversation. Every group message retains its
speaker label, including consecutive replies from different agents.

Live preview on port 9137: sent an @researcher message through the normal composer,
observed its reply in the group transcript and the cleared input. Started another
turn after Stop without a Resume setting, then interrupted it with the normal Stop
button; the durable group record confirmed `stopped`. Verified the direct-chat
composer still appears after switching sessions. The header, transcript, and
composer shared the same x-coordinate and width with no horizontal overflow.
No removed options or second composer remained in the DOM. Opened the simplified
picker from both group and direct chats and canceled without changing membership.
Attachment transfer uses the existing staged-file route; native file selection was
not exercised in this follow-up.
Full fast suite: all 702 steps passed (`dev/group-simple-fast.log`).

## Scope of the evidence

This is local feature verification, not an installed-desktop or public-release claim.
Dispatch is sequential within a group; independent answers share a context snapshot.
Files are limited to 1 MiB per version. Context has explicit bounded-history cutoffs.
External channels, scheduling, and parallel dispatch remain separate future work.
