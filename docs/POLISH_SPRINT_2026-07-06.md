# Polish sprint — 2026-07-06 (visual-truth audit + Commander UX asks)

Source: five-lane truthful-telemetry audit (this session) + Andrew's direct asks.
Orchestrator: Fable. Implementation agents: Opus, one worktree each, `agent/<lane>` branches.
Gate: `npm run test:fast` green + live verification per `starnet-verify` before merge.

## Lane 1 — `ux-popup-escape` (Andrew ask)
Every popup/beat that asks the Commander questions must be exitable without answering.
Surfaces to inventory and fix: intake interview (frontend/app/intake.js — skippable per-question,
but is there a visible "leave the whole interview" exit?), curiosity nudge (curiosity.js),
onboarding/awakening question flow, pitch/suggestion cards, ArmConfirm/prospect confirm cards
(chat.js beat family), and any stationui modal that traps focus. Deliver: consistent ✕ / ESC
dismissal on all of them, dismissal recorded as "waved off" (existing dismissed-state stores),
never punished, never re-asked in the same session.

## Lane 2 — `ux-topbar-disconnect` (Andrew ask)
Remove the ⏏ DISCONNECT button from the topbar (frontend/index.html:221, app.js:2168 wiring,
app.css/topbar.css layout refs). Keep the internal `disconnect()` teardown function — recovery /
resume paths still reference the disconnect concept. Do NOT touch `btn-codex-logout` (Codex auth,
different thing).

## Lane 3 — `dossier-agent-mgmt` (Andrew ask)
Agent dossier (stationui.js) gains: (a) DELETE AGENT — with a confirm step, removes the agent
from the roster + world + persisted stores, never deletes its past run history/artifacts silently
(archive, don't wipe); check sidecar roster API for what exists. (b) CHANGE SKIN — skin is chosen
at genesis (app.js identity fields name · skin · voice); expose a skin picker in the dossier that
re-uses the genesis skin options and live-updates the world sprite. Hero deletion is a product
question — block deleting the hero (last agent) rather than asking.

## Lane 4 — `voice-button-reliability` (Andrew bug)
"The voice button does not always work reliably." Reproduce-first (starnet-debugging). Suspects:
frontend/app/voice.js dual STT path (browser SpeechRecognition vs desktop MediaRecorder→/api/stt),
init/permission races, button state machine getting stuck after a failed recognition start,
hands-free loop re-arm (chat.js:4048), recent desktop haveKey() fix (8c25d4fc) adjacency.
Deliver: diagnosis + fix + a button state that always recovers (visible error state, never dead).

## Lane 5 — `truth-run-lifecycle` (audit T1: findings 2, 4 + T3 cron/hero items)
- finishReason ('length'/'content_filter') must reach the frontend: additive field on
  agent.run.end (contract change — ADDITIVE ONLY, coordinate via shared/events.js owner rules)
  from sidecar/loop.js:195 + index.js; chat.js renders a truncated/filtered turn honestly
  (no "◈ delivered" crate/XP for a cut reply — render a distinct "cut short" recap state).
- Hero stuck-working fix: chat.js:4025-4028 — background hero run end must reset activity
  (unconditional teardown like crew, minus the view-move; never move the camera).
- Cron session wedge + orphan: autosessions.js:101/150 — reconcile busy state and backfill
  missed cron.result on SSE reconnect and on boot (drop the Workstreams.get dedupe skip when the
  adopted session has no reply yet).
- Frontend-fabricated assistant turns (autosessions.js:120-129): mark as system-styled lines,
  not role:'assistant'; transcript-fetch failure must say "couldn't load output", not "nothing
  to report".

## Lane 6 — `truth-channel-tee` (audit T1: finding 3 + discord enum + delivery agentId)
- Expand sidecar/channels/sse.js runTeeView whitelist: forward tool_result (redacted like
  tool_call — name/ok only, no payloads), deliverable, agent.run.error, memory.write/recall,
  capdenied — match the cron-driver lane's observability. ALSO fix the inverse privacy drift:
  cron sink (cron-driver.js:146) currently broadcasts full argsSummary — strip to match B4
  redacted-egress.
- Discord gateway 'connecting'/'reconnecting' (discord.gateway.js:213/257/287) fail the frozen
  channel.connect enum and are silently dropped — either map to nearest legal state on emit or
  additively extend the enum; panel must not go stale during reconnects.
- channel.delivery: carry agentId (additive) so world.js:5096 pulses the RIGHT dish.

## Lane 7 — `truth-props-glow` (audit T1: findings 1, 5 + T3 connector clear)
- Jukebox reconciliation: wire it for real — add jukebox to CAP_PROP_MAP (worldmodel.js:77),
  so placed jukebox → spotify grant on interactive runs; sprite glow keyed to Spotify OAuth
  connected state (dead-vs-live law), not always-on; /tools + friendlyerror copy updated to the
  real unlock chain (place + connect OAuth). fullOffice()'s no-prop jukebox for autonomous runs
  is a PRODUCT DECISION — leave as-is, flag in report.
- Tool-fire surge honesty: world.js:5165-5184 — consume agent.tool_result errors; denied/failed
  calls must not render the success surge (red/dim variant like the workbench verify path).
  Kill the wrong-room fallback world.js:1374-1382 (`return cands[0]`) — no prop in the acting
  agent's room → no pulse.
- Connector portal: clear/downgrade connState entries absent from a SUCCESSFUL /api/connectors
  poll (world.js:5154-5163) so a removed connector stops glowing green.
- Workbench pulse room-scoping (propsprites.js:4731) if cheap; else note.

## Lane 8 — `truth-chrome-instruments` (audit T2: findings 6-10 + shell.bg.exit)
- #sig UPLINK (index.html:217): wire it to real link state (the world already tracks SSE health
  — linkStaleDim / LINK DOWN, world.js:5261) — bars degrade / label changes when the bridge dies.
- ONLINE pill + dossier status (stationui.js:90/762): ONLINE only when the sidecar link is
  actually up; otherwise LINK DOWN / OFFLINE.
- Widget rail staleness (widgets.js:229/420): on poll failure or SSE drop, dim values + source
  tag flips from 'live' to a stale cue (mirror canvas linkStaleDim). SPEND TODAY (topbar.js:74):
  same stale cue + day-boundary reset.
- Model dock (modeldock.js:338): offline fallback catalog must be labeled (the connect screen's
  "(catalog offline)" pattern); drop fabricated model ids from the hardcoded lists — keep only
  ids known real.
- Providers panel (stationui.js:1898): "● CONNECTED" → "● KEY SAVED" (or verify live); configured
  ≠ connected.
- shell.bg.exit consumer: minimal honest surface — a COMMS/system line or logbook entry when a
  background process exits (events.js:143 exists solely for this; grep-verified zero listeners).

## Deferred / product decisions for Andrew
- fullOffice() autonomous capability vs floor props (audit F4) — sandbox-power vs object=capability
  tension; needs a ruling, not a patch.
- localLine slash-command output styled as agent speech (chat.js:625) — deliberate pattern; restyle?
- focusAgent global-model overwrite (app.js:364) — "follows station default" can lie; small fix but
  touches model-pinning semantics.

## Merge order (starnet-merge-ritual per branch)
Small/independent first: 2 → 1 → 8 → 7 → 6 → 5 → 3 → 4 (4 lands whenever diagnosis completes).
