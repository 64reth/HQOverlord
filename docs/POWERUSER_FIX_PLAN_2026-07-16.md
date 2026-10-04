# StarNet power-user findings — complete fix plan

Plan date: 2026-07-16
Audit source: `75cad9e8`
Plan baseline: `bf99df2a`
Finding source: `docs/POWERUSER_AUDIT_2026-07-15.md`

## Objective

Close all 14 newly confirmed power-user defects and the product gaps reconfirmed by the audit,
without losing StarNet's truthful-telemetry, persistence, sandbox, or one-sidecar invariants.

Completion is behavioral, not code-shaped: every original reproduction must pass in the live app,
each defect must gain an EL-3 regression, restart-sensitive state must survive a real sidecar
restart, the composed gates must be green on the exact merged head, and installed-shell claims
must be re-proven in the installed desktop build.

## Ground-truth reconciliation

Trunk advanced from the audited head to `bf99df2a` through task-context elicitation. The new work
touches task briefs, commander context, channel continuation, and clarification turns. It does not
close or materially change any PU-01..PU-14 seam. All 14 findings remain planned.

No change to `shared/events.js` or `shared/schema.js` is currently required. If implementation
discovers otherwise, stop and request the governed additive contract change rather than editing
those files inside a feature lane.

## Operating rules

1. One lane per worktree and branch; claim the lane in `docs/NEXT.md` before editing.
2. Every lane begins with an automated reproduction that fails for the audited reason.
3. Make the smallest fix, then run the original live reproduction. Do not combine unrelated
   cosmetic cleanup.
4. `sidecar/index.js` lanes merge one at a time. `frontend/app/stationui.js` lanes also merge one
   at a time. `chat.js` has one owner for the full COMMS wave.
5. Commit tests separately before the fix where practical, but never merge a red test-only commit
   to trunk.
6. Per lane: `node --check` touched JS, focused tests, `npm run test:fast`; sidecar/route lanes also
   run `npm run test:http`; then live-app proof. Persistence findings require a sidecar restart.
7. After every hotfile merge, grep that every called symbol still exists.

## Attack order

### Wave 1 — P1 safety and control-plane truth

Run lanes 1A and 1D in parallel. Lanes 1B and 1C both own `sidecar/index.js`, so merge them
serially in that order. All four must land before Wave 2.

#### Lane 1A — Secret-safe recovery export — PU-03

Ownership:

- `frontend/app/backup.js`
- recovery/export copy in the connect screen if needed
- new focused backup/export test

Implementation shape:

- Replace “all `starnet.*` keys” collection with an explicit export allowlist or explicit secret
  denylist backed by tests. Exclude all provider/BYOK/channel/OAuth/token/key material, including
  scoped keys such as `starnet.byok.key.<provider>`.
- Add a bundle metadata field that states `secretsIncluded:false`; import remains compatible with
  older bundles but never writes excluded credential keys from an untrusted bundle without the
  existing consent/recovery boundary.
- Make recovery EXPORT AGENT and Settings STATION BACKUP use the same secret-exclusion contract and
  copy.

EL-3 regression:

- Plant sentinel values under every credential prefix, export, and assert none occur in serialized
  output while roster/memory/settings data still round-trips.
- Assert the export status counts nonsecret records, not “keys” in a way that implies credentials.

Done means:

- In the real recovery UI, plant a harmless sentinel credential, click EXPORT AGENT, inspect the
  generated JSON, and observe zero sentinel material plus `secretsIncluded:false`.
- Import the bundle into an isolated save and observe expected nonsecret state restored.

#### Lane 1B — Night Shift focus authority — PU-01 and PU-05

Ownership:

- `sidecar/index.js` focus route only
- `sidecar/nightfocus.js`
- `test/nightfocus.test.js`
- `test/nightshift-focus.e2e.test.js`
- minimal Night Shift UI copy only if backend response cannot fully drive it

Implementation shape:

- Validate `kind:project` against currently blessed project roots, canonicalizing through the
  existing path-trust/project authority. Existence alone is insufficient.
- Validate `kind:thread` against a real open/picked thread and `kind:goal` against current goal
  truth. Unknown kinds and missing references return an actionable 4xx response and do not mutate
  durable focus state.
- Make DELETE remove both the steer and its steer-derived cached focus. Immediately resolve from
  current evidence; if none exists, return `focus:null`.
- Status must never pair a rejected/unavailable target with `resolved:true` or imply that build
  authority exists merely because workshop mode is enabled.

EL-3 regression:

- Missing path, existing-but-unblessed path, revoked path, missing thread, stale goal, and malformed
  kind all fail without state mutation.
- Blessed project and real thread succeed.
- Set → clear returns a new derived focus or null, hides the old reason, and survives restart.

Done means:

- The exact audited bogus-path request is rejected live; status remains unchanged.
- A blessed project can be steered, CLEAR removes its directive, and restart preserves only the
  valid post-clear state.

#### Lane 1C — Durable disabled MCP management — PU-02

Ownership:

- `sidecar/index.js` connector boot/list/config routes
- `sidecar/mcp/manager.js` only if a saved-vs-runtime projection helper belongs there
- `test/e2e.mcp-connector.test.js`
- `test/connectors-ui.test.js`

Implementation shape:

- Treat saved connector configs as management truth and runtime manager state as health truth.
  `/api/connectors` should merge them by ID, redact all secret fields, and return disabled entries
  with an explicit disabled/not-running state.
- Continue warming only enabled connectors. Do not register disabled connectors merely to list
  them.
- Ensure edit, enable, remove, refresh, and secret-preservation semantics operate on the saved row
  even when no runtime instance exists.
- Correct the misleading boot “warming N” count so it counts enabled candidates only.

EL-3 regression:

- Create enabled and disabled connectors with sentinel tokens, restart, assert both management rows
  remain, no secret echoes, only enabled connector warms, disabled can be re-enabled and removed.

Done means:

- In the live Connectors panel, disable a connector, restart the sidecar, observe the same disabled
  row, re-enable it, then remove it and prove the config/token record is gone.

#### Lane 1D — Viewport-safe terminal positions — PU-04

Ownership:

- the generic window positioning/drag/restore block in `frontend/app/stationui.js`
- focused pure position-clamp test plus a live responsive journey

Implementation shape:

- Extract one pure “visible terminal rect” clamp used by initial placement, drag end, restore,
  viewport resize, and responsive width changes.
- Guarantee a reachable titlebar and close control on every supported viewport, not a fixed 64px of
  the pre-resize width.
- Rebase persisted coordinates when the viewport or terminal dimensions change; save the repaired
  position so reload does not resurrect the bad coordinate.
- Apply the invariant to all floating terminals, not only Settings.

EL-3 regression:

- Desktop-wide window dragged to minimum X → phone resize → desktop resize → reload/reopen; at each
  step assert titlebar intersection and reachable close control.
- Cover oversized width/height, negative saved positions, and viewport smaller than minimum window.

Done means:

- The exact `x:-996` reproduction repairs itself live on shrink and remains repaired after reload.

### Wave 2 — Remaining truthful-state and data-loss defects

Wave 2A owns `stationui.js` after 1D. Wave 2B owns `chat.js` exclusively and takes its small
`sidecar/index.js` age-copy hunk only after lanes 1B/1C merge.

#### Lane 2A — Provider/channel claim honesty — PU-06 and PU-07

Ownership:

- provider and channel sections of `frontend/app/stationui.js`
- `frontend/app/harness.js`
- Signal disconnect/config route only if removing configuration requires backend support
- `test/provider-connections-ui.test.js`
- `test/channels.signal.test.js` and channel UI coverage

Implementation shape:

- Model provider state as separate facts: credential saved, endpoint configured, endpoint reachable,
  catalog available, and selected. “ACTIVE” means runnable/reachable, not selected plus a model ID.
- Ollama/custom rows say LOCAL ENDPOINT CONFIGURED or OFFLINE; never synthesize a key row/count.
- Keep real keyed-provider copy unchanged and truth-backed.
- Replace Signal FORGET with REMOVE CONFIGURATION, clearing endpoint/account and any stored adapter
  state with a verified persist. If product intent is only “disconnect,” remove the purge language
  and hide FORGET entirely for tokenless adapters.

EL-3 regression:

- Offline Ollama, reachable Ollama stub, custom URL offline/online, keyed provider saved-but-invalid,
  and selected-but-unreachable states render distinct truthful labels.
- Signal remove clears persisted configuration, becomes `configured:false`, survives restart, and
  never claims token deletion.

Done means:

- Live Settings cannot show KEY SAVED/1 key for keyless providers; ACTIVE changes only with a proven
  runnable endpoint. Signal removal makes its card unconfigured after restart.

#### Lane 2B — Agent-global COMMS availability and disconnect durability — PU-09..PU-12

Ownership:

- `frontend/app/chat.js`
- `frontend/app/friendlyerror.js`
- the smallest necessary global-run selector in App/Channels/World
- `sidecar/index.js` busy-age wording only
- `test/comms-presence.test.js`, `test/friendlyerror.test.js`, transcript/runmeta tests
- one new journey covering cross-session mutex and one covering sidecar death mid-stream

Implementation shape:

- Before send, resolve agent-global availability. If the selected agent is busy in another stream,
  show BUSY IN <session>, disable normal send, and offer VIEW ACTIVE RUN. Do not invent a queue in
  this fix.
- Recheck server-side as authority; race-time mutex refusal maps to the same UI state without adding
  a durable failed user turn where possible.
- Format sub-minute holder age as “just now” or “<1 min”; retain source/session guidance.
- Classify transport loss during SSE as local-service/network failure and show restart/reload
  guidance consistent with LINK DOWN.
- Persist accumulated partial assistant text before appending a disconnect marker. Deliberate Stop
  behavior remains unchanged.

EL-3 regression:

- Run in A → open B: B reports the same agent busy, send is unavailable, VIEW ACTIVE RUN returns to A.
- Force the race after preflight and assert the backend refusal is friendly and nonduplicating.
- Kill sidecar after streamed tokens: partial text plus disconnect marker survives restart/reload;
  error is classified as station unreachable, not unknown.
- Age boundaries: 0s, 59s, 60s, and multi-minute.

Done means:

- Both audited live repros produce truthful cross-session and disconnect behavior, with durable
  partial text and no misleading one-minute claim.

#### Lane 2C — Recruit identity clarity — PU-08 and known 18-character feedback gap

Ownership:

- recruit/summon UI and naming helper
- backend summon-name normalization only if needed as a defensive invariant
- summon/recruit/name tests

Implementation shape:

- Default names are unique in the current roster (`Researcher 2`, `Researcher 3`, etc.) while user-
  entered duplicates receive an inline warning and explicit confirmation or must be changed.
- Keep internal ID uniqueness independent of display-name uniqueness.
- Render a live `used / 18` counter and clear helper text; never silently truncate pasted values.
- Existing saves with duplicate names remain loadable and get disambiguating secondary ID text until
  renamed; do not silently rename historical agents.

EL-3 regression:

- Default duplicate class, explicit duplicate name, case-insensitive duplicate, 18/19/pasted length,
  and old-save duplicate rendering.

Done means:

- Re-recruiting Researcher proposes a distinct visible name; long paste is explained before summon;
  old duplicates remain identifiable.

### Wave 3 — Session cleanup and recovery friction

#### Lane 3A — Blank-session coalescing and stopped-run retry — PU-13 and PU-14

Ownership:

- session creation in `frontend/app/app.js` / `frontend/app/workstreams.js`
- stopped-run action rendering in `frontend/app/chat.js` after Wave 2B merges
- workstream and chat-runmeta tests

Implementation shape:

- If the active session is untouched and empty, +NEW focuses/reuses it rather than creating another.
  Once it has content, a new session is created normally. Rapid clicks are idempotent within the same
  event turn.
- Provide Try again on RUN STOPPED using the existing `/retry` semantics and disabled-state rules.

EL-3 regression:

- Five synchronous +NEW actions from one untouched blank create one row; content then +NEW creates a
  second; reload preserves only legitimate sessions.
- Stop after partial output → Try again sends exactly one new turn and does not duplicate history.

Done means:

- The audited rapid-click and stopped-run repros both behave correctly live and after reload.

### Wave 4 — Reconfirmed product gaps

These are larger than bug fixes. They start only after PU-01..PU-14 are green so new feature work
does not obscure escape closure.

#### Lane 4A — Session power tools

Closes: conversation/session search, whole-conversation export, clear conversation, and bulk
session cleanup/archive-old.

Implementation shape:

- One search surface over session titles and transcript hits, using the existing search primitive.
- Export active conversation as Markdown and JSON with secrets/hidden system data excluded.
- Clear is explicit, confirms scope, creates a recovery checkpoint, and never deletes unrelated
  agent memory.
- Bulk operations support archive empty/completed/older-than, show a preview count, and are undoable.

Done means:

- Seed 50 sessions with known hits; search finds title/body matches; export round-trips; bulk archive
  affects only previewed rows; clear/undo survives restart.

#### Lane 4B — Resizable floating terminals

Closes: GA-16. Builds on the Wave 1D positioning invariant.

Implementation shape:

- Shared keyboard- and pointer-accessible resize affordance with per-window min/max dimensions.
- Persist dimensions with positions; clamp both on viewport changes; responsive phone layout remains
  usable. Preserve focus trap, z-order, minimize, and restore behavior.

Done means:

- Resize Settings, Skills, Dossier, and a small console; reload; shrink viewport; all remain reachable
  and content does not clip beyond existing intentional overflow rules.

#### Lane 4C — Deliverables and Workshop library

Closes: durable deliverables library, workshop bulk cleanup, and inline image/Markdown/CSV preview.

Implementation shape:

- A backend-backed library over real artifact/workshop records, with search/filter, source run,
  status, size, created time, and open/keep/discard actions.
- Inline preview is allowlisted by type and size: sanitized Markdown, bounded CSV table, and image
  object URLs that are always revoked. Executable HTML keeps the existing sandboxed OPEN path.
- Bulk cleanup previews exact targets, protects pending/kept items by default, and records undo where
  underlying storage supports it.

Done means:

- Generate HTML, Markdown, CSV, image, failed, pending, kept, and discarded artifacts; every record
  appears truthfully, previews safely, opens correctly, and bulk cleanup cannot cross its previewed
  set. Restart preserves the library.

#### Lane 4D — Supervised background lifecycle for routines/channels

Closes: routines and channels dying when the desktop window exits.

This is a genuine product decision checkpoint. Recommended direction for approval:

- a Tauri tray supervisor owns the one sidecar;
- closing the window keeps the station running only when routines/channels/autonomy require it and
  makes that state explicit;
- Quit StarNet stops the sidecar after a bounded drain;
- launch-at-login is opt-in;
- tray/status UI shows armed work and provides Open, Pause Automation, and Quit;
- no hidden daemon and no claim of 24/7 work while the supervisor is absent.

Required proof after direction is approved:

- close window with an armed short routine → process remains, routine fires exactly once, durable
  result appears after reopening;
- explicit Quit stops it; reboot/login opt-in starts one sidecar only; update/install cleanly drains
  it; E-STOP reaches background work; disabled state creates no background process.

## Ownership and merge map

| Lane | Primary hot files | May run with | Must merge after |
| --- | --- | --- | --- |
| 1A export | `backup.js` | 1B, 1D | current trunk |
| 1B focus | `index.js`, `nightfocus.js` | 1A, 1D | current trunk |
| 1C MCP | `index.js` | 1A, 1D | 1B |
| 1D windows | `stationui.js` window core | 1A, 1B/1C | current trunk |
| 2A provider/channel | `stationui.js`, `harness.js` | 2B, 2C | 1C and 1D |
| 2B COMMS | `chat.js`, small `index.js` hunk | 2A, 2C | 1C |
| 2C recruit | recruit UI, summon seam | 2A, 2B | Wave 1 |
| 3A sessions | `app.js`, `workstreams.js`, `chat.js` | none touching `chat.js` | 2B |
| 4A session tools | session/transcript UI | 4B, 4C | 3A |
| 4B resize | `stationui.js` window core | 4A, 4C | 2A |
| 4C deliverables | workshop/returns/UI/routes | 4A, 4B | Waves 1–3 |
| 4D lifecycle | Tauri shell, sidecar ownership | 4A–4C | owner decision |

## Composed verification gate

After each wave merges into the integration branch:

1. `node --check` every changed JavaScript file.
2. `npm run test:fast`.
3. `npm run test:http` for Waves 1, 2, and 4C/4D.
4. `npm run qa:journeys`, including the new cross-session, disconnect, recovery-export, viewport,
   and connector-restart journeys.
5. Start the real seeded app and replay every PU reproduction assigned to that wave.
6. Restart the sidecar for focus, connector, channel, transcript, session, library, and lifecycle
   persistence proofs.
7. Re-run Cartographer and add/refresh Atlas coverage for every new control/route.
8. For terminal/window or Tauri changes, rebuild the desktop app and run installed-exe smoke/CDP
   proof. Dev-browser proof cannot substitute.

Final campaign closure requires:

- PU-01..PU-14 all marked fixed with linked EL-3 evidence;
- all reconfirmed gaps in Wave 4 either live-proven or, for 4D, explicitly blocked on the recorded
  owner decision rather than silently omitted;
- zero new P0/P1 ledger findings caused by the campaign;
- exact-head Green Guardian and installed smoke receipts;
- no claim of READY without `npm run qa:ready`, and no claim of PRODUCT PERFECT without
  `npm run qa:product-perfect`.

## Suggested delivery cadence

- Day 1: Wave 1A, 1B, 1D; then 1C after 1B.
- Day 2: Wave 2A, 2B, 2C.
- Day 3: Wave 3A plus composed PU-01..PU-14 reproof.
- Days 4–6: Wave 4A, 4B, 4C.
- Wave 4D: starts after the tray/background-lifecycle direction is approved; budget 2–4 days plus
  an installed-app/reboot/update soak.

The schedule is intentionally subordinate to evidence. A lane that cannot reproduce its finding
stops for diagnosis; it does not “fix” the remembered symptom.
