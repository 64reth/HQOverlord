---
fingerprint: 0245a284
slug: add-agents-silently-fails-when-group-backend-is
title: Add agents silently fails when group backend is unavailable
surface: sessions
severity: P1
status: fixed
found: 2026-09-06
lane: comms-add-agents-0906
fix: cf6b3ca03c372c404bcb46997a56d570d7747d70
origin: owner
report: Owner report in local task on 2026-09-06; Add agents does nothing on port 9177
affected: Dev server port 9177, world-visual-audit-0904 backend; desktop installer unknown
family: group-chat-picker
installer: unverified
recovery: unconfirmed
---

# Add agents silently fails when group backend is unavailable

## Symptom

Clicking COMMS' Add agents button leaves the direct conversation unchanged, with no picker or visible explanation.

## Repro

1. Load a frontend containing GroupChat against a backend without GET /api/groups (reported dev instance: localhost:9177).
2. Open a direct conversation and click Add agents.
3. Observe that no window appears. The hidden group-only gc-notice contains a JSON parse error for the plain-text 404 response.

## Evidence

Live browser reproduction on localhost:9177: no gc-picker element after the click; gc-notice text was `Unexpected token 'o', "not found" is not valid JSON`. The listener's process began on September 5 from the world-visual-audit-0904 worktree; that branch lacks the /api/groups route. Current trunk contains GET and POST handlers.

The production-module regression in test/group-chat-picker.test.js fails against the original source with `picker is visible before the backend responds`. The patched source passes loading, duplicate-click, plain-text 404, 401/403, malformed JSON, roster-sync rejection, Retry, member selection, Cancel, and late-response scenarios.

Live patched app at localhost:9187: clicking Add agents opened ADD AGENTS, the seeded NOVA lead row, the empty-crew explanation, disabled SAVE and working CANCEL. After recruiting a disposable PICKER TEST peer, Add agents listed NOVA, selecting it enabled START GROUP CHAT, and saving showed both names with a 2 AGENTS header. Reloading retained the group; clicking the participant header reopened AGENTS IN THIS CHAT with both members.

A temporary loopback proxy reproduced the original plain-text 404. The patched picker displayed `Group chat is unavailable on this server. Run the current StarNet backend, then try again.` with RETRY and CANCEL. Restoring the route and clicking RETRY populated the real roster. Browser warning/error logs were empty during recovery. The proxy was removed after verification.

`node test/group-sessions.http.test.js` passed its real runOnce, file publication, handoff, question/answer and restart scenarios. The first broad customer-journey attempt stopped at sidecar.http with `Fatal process out of memory: Re-embedded builtins: set permissions`; its isolated rerun passed 504 assertions. The first fast gate stopped at eval-campaign-preflight (missing child output); its isolated rerun passed 10 assertions. Broad gate retries are recorded below when complete.

## Verdict

Source fix cf6b3ca03 merged as ceafd9c67. Full fast gate passed 725/725 before and after integration; test/group-chat-picker.test.js and group HTTP scenarios pass. Live verification covered immediate picker, readable missing-route error with successful Retry, two-agent group creation, reload and server restart persistence. Final check on port 9177 opened the picker and listed NOVA plus 25 available peers after that server process had restarted. Earlier transient gate failures were superseded by successful complete runs. Receipt: qa/digests/2026-09-06-add-agents.md. Installer and reporter recovery remain unverified.

## Regression

Before: network/parsing errors are caught by a handler that writes only to the hidden group transcript. After: the picker is already visible while loading; failures are displayed inside it, and Retry can populate the crew after recovery. See test/group-chat-picker.test.js.

## Sibling coverage

{
  "adapters": [{"target":"group API missing, unauthorized, malformed, and recovered responses","state":"covered","test":"test/group-chat-picker.test.js","scenario":"404, 401/403, malformed response, roster failure and successful Retry","gate":"fast"}],
  "entrypoints": [{"target":"direct COMMS Add agents","state":"covered","test":"test/group-chat-picker.test.js","scenario":"production click opens loading window before awaiting HTTP, then selects a peer","gate":"fast"},{"target":"existing group participant header","state":"blocked","reason":"Live-verified opening the shared picker after reload with both saved members; this entry has no dedicated automated UI scenario in the gate."}],
  "displays": [{"target":"browser picker","state":"covered","test":"test/group-chat-picker.test.js","scenario":"connected loading panel and role=alert error panel","gate":"fast"},{"target":"installed desktop","state":"blocked","reason":"No installer was rebuilt or exercised for this source-only repair."}],
  "lifecycle": [{"target":"cancel, rapid clicks and retry","state":"covered","test":"test/group-chat-picker.test.js","scenario":"single loading window, successful Retry, cancellation ignores late success, reopening works","gate":"fast"},{"target":"saved group backend restart","state":"covered","test":"test/group-sessions.test.js","scenario":"recovery retains pending work and never dispatches it on boot","gate":"fast"}]
}
