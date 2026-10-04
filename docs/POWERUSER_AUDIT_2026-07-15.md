# StarNet power-user deep-dive audit — 2026-07-15

Source tested: `75cad9e8` on three isolated worktrees, isolated save roots, unique ports,
the real sidecar, project-native headless Chrome/CDP, and deterministic mock providers.
No production data, credentials, external messages, or installed-app state were changed.

## Executive result

The standing automated baseline is green, but the power-user sweep confirmed **14 new
behavioral defects**: **4 P1**, **8 P2**, and **2 P3**. The dominant pattern is truthful-state
drift across seams: UI claims outlive or exceed backend proof, persisted state disappears
from its management surface, or a failure path loses useful context.

No fixes were implemented in this audit.

## New confirmed findings

### P1 — high impact

#### PU-01 — Night Shift accepts and persists nonexistent or unblessed focus targets

- Repro: `POST /api/nightshift/focus` with
  `{ "kind":"project", "ref":"C:\\definitely\\missing\\not-blessed" }`; the same class
  reproduced with a nonexistent thread.
- Actual: HTTP 200 reports `ok:true`, `resolved:true`, `source:"steer"`; status presents the
  target as current focus while `buildMode:"build"` and `workshopGranted:true`. The path does
  not exist and `/api/permissions` contains no matching grant. The bogus focus survives restart.
- Expected: reject it, or report it as unresolved/unavailable. The UI itself asks for a
  “blessed project path.”
- Seam: `sidecar/index.js:7942` validates only nonempty `kind/ref`, despite the nearby contract
  comment requiring an already-blessed project.
- Why it matters: direct truthful-telemetry violation on an autonomous-work control.

#### PU-02 — Disabled MCP connectors disappear after restart while their secret remains stored

- Repro: create a manual HTTP connector with `enabled:false` and a harmless sentinel token;
  confirm it in `connectors.json`; restart the same save root; query `/api/connectors` and open
  the Connectors UI.
- Actual: the persisted record and token remain on disk, boot counts the connector, but the API
  and UI return no row. The user cannot re-enable, edit, or remove it.
- Expected: disabled connectors remain visible and manageable after restart.
- Seam: boot registers only `c.enabled !== false` (`sidecar/index.js:4530`), while the list route
  returns runtime manager state (`sidecar/index.js:5079`) rather than saved configurations.
- Why it matters: invisible secret-bearing state and a restart-only management failure.

#### PU-03 — Recovery “Export Agent” includes browser BYOK secrets despite “secrets excluded” copy

- Repro: plant harmless sentinel
  `starnet.byok.key.openrouter=QA_PLANTED_BROWSER_KEY_SENTINEL`; invoke the real recovery
  `#btn-export`; inspect the collected/exported payload.
- Actual: `Backup.collectStore()` and the export contain the exact sentinel. The UI reports the
  export saved successfully. Settings’ separate STATION BACKUP explicitly says secrets are
  excluded and must be re-entered.
- Expected: browser BYOK credentials are excluded, or the export is explicitly treated and
  protected as secret-bearing.
- Seam: `frontend/app/backup.js:33` collects every `starnet.*` localStorage entry.
- Safety note: only a planted sentinel was read; it was removed after the proof.

#### PU-04 — A dragged Settings window can become completely unreachable after viewport shrink

- Repro: at 1440×900 open Settings, drag it to the far-left clamp, resize to 375×812, then
  expand to 900×600.
- Actual: the live rect became `x:-996, width:330, right:-666`; at 900×600 its right edge was
  still `-204`. Zero pixels were reachable. `termPos.settings.left=-996` survived page reload.
- Expected: resize/restoration clamps at least the titlebar and controls into the viewport.
- Likely seam: `frontend/app/stationui.js` drag clamping allows only 64px of a wide window to
  remain, then responsive width changes do not rebase the saved coordinate.

### P2 — material UX, data, or telemetry defects

#### PU-05 — Clearing Night Shift steer hides CLEAR but leaves the old directive as current focus

- Repro: set a steer, click CLEAR, then inspect `/api/nightshift/status` and the Settings panel.
- Actual: `steered:false`, but the same focus and “you asked me to focus…” reason remain; the
  CLEAR affordance disappears.
- Expected: resolve a fresh derived focus or show no current focus.
- Seam: `sidecar/nightfocus.js:245` preserves `s.focus`, and same-day resolution reuses it.

#### PU-06 — Signal FORGET claims token deletion but leaves Signal fully configured

- Repro: configure Signal against a dead local bridge, then click FORGET.
- Actual: success says the stored token was purged, yet Signal has no token, endpoint/account
  remain, status stays `configured:true`, and FORGET remains visible.
- Expected: remove the configuration or accurately describe that there is no token to forget.
- Seam: generic channel copy/actions in `frontend/app/stationui.js`; Signal’s clear callback is
  a no-op.

#### PU-07 — Offline Ollama/custom providers can claim “KEY SAVED / 1 key / ACTIVE”

- Repro: leave Ollama daemon absent; query its empty model catalog and inspect provider
  projection/UI.
- Actual: the frontend manufactures a credential row and generic key count; selected
  provider/model can be labeled ACTIVE without endpoint reachability.
- Expected: “local endpoint configured” plus a separately proven reachable/runnable state.
- Seam: unconditional Ollama credential truth in `frontend/app/harness.js:184`, projected by
  generic provider rendering in `frontend/app/stationui.js:2236` and `:2275`.

#### PU-08 — Re-recruiting a class creates indistinguishable duplicate display names

- Repro: with existing `researcher` / `RESEARCHER`, recruit Researcher again using the default
  name.
- Actual: durable IDs become `researcher` and `researcher-2`, but both display as `RESEARCHER`
  across roster/COMMS/dossier/floor surfaces.
- Expected: warn, require a name, or auto-name the second agent distinctly.
- Note: double-submit protection held; this is display-name ambiguity, not duplicate submission.

#### PU-09 — A fresh session appears ONLINE and accepts input while its agent is busy elsewhere

- Repro: start a slow run in session A, click +NEW, observe A’s truthful busy rail row, then send
  in session B.
- Actual: session B says online, keeps the composer enabled, accepts the turn, then creates
  durable user/error turns and a retry card because the same agent mutex is held. Run A continues.
- Expected: an agent-busy banner with queue/foreground-A behavior, or a disabled composer.
- Seam: COMMS status is workstream-local while rail/backend availability is agent-global.

#### PU-10 — Busy refusal says “started 1 min ago” after about one second

- Repro: trigger PU-09 roughly 0.7–1.0 seconds after run A begins.
- Actual: error says the holding run started “1 min ago.”
- Expected: “just now” or “<1 min.”
- Seam: `sidecar/index.js:6784` uses `Math.max(1, Math.round(age / 60000))`.

#### PU-11 — Mid-stream sidecar death produces a generic unknown error

- Repro: begin a slow streamed response, kill the isolated sidecar after tokens arrive.
- Actual: top-level link truth correctly becomes LINK DOWN / STATION UNREACHABLE, but the turn
  says only “Something went wrong on that turn — try again,” with no local-service restart or
  reload guidance.
- Expected: network/local-service-specific recovery copy.
- Seam: unexpected disconnect misses the network classification path in
  `frontend/app/chat.js:4885` / `friendlyerror.js`.

#### PU-12 — Mid-stream sidecar death discards already-visible partial assistant text

- Repro: same as PU-11; compare DOM before death, active history after death, and history after
  sidecar restart plus page reload.
- Actual: streamed text visible before death disappears; durable history retains only the generic
  error. Deliberate Stop correctly preserves partial text, so the unexpected-error path diverges.
- Expected: preserve partial content and append a disconnect marker.
- Seam: stopped branch persists the accumulator; unexpected-error branch persists only the error.

### P3 — lower-impact friction

#### PU-13 — Rapid +NEW creates unlimited durable empty sessions

- Repro: click +NEW five times synchronously.
- Actual: five empty Untitled/General sessions are created and survive reload; no debounce,
  coalescing, undo, or cleanup exists.
- Expected: reuse the untouched blank session or coalesce rapid creation.
- Seam: `frontend/app/app.js:2626` unconditionally creates; `workstreams.js:144` always pushes.

#### PU-14 — Deliberately stopped runs have no visible retry action

- Repro: stop an active streamed run with the visible Stop control.
- Actual: partial output and RUN STOPPED persist correctly, but there is no Try again control or
  hint that `/retry` exists. Failure cards do provide a retry button.
- Expected: parity with failure recovery, or explicit `/retry` guidance.
- Related queue item: GA-3 tracks visible retry generally; this stopped-run branch remains rough.

## Reconfirmed known gaps — not refiled as new

- Recruit names enforce 18 characters without a visible counter/helper (`NEXT.md` GC-16).
- Floating windows are not user-resizable (`GA-16`).
- No durable deliverables library, workshop bulk cleanup, or image/Markdown/CSV inline preview
  (`GB-2`, `GB-18`, `GB-19`).
- No conversation/session search UI despite an underlying search primitive (`GB-1` / `GA-6`).
- No whole-conversation export/clear (`GA-7`).
- No bulk session cleanup/archive-old (`GA-22`).
- Routines stop when the desktop/sidecar exits; the critical supervised-lifecycle item is already
  open in `NEXT.md`.

## Verified passes and breadth

- `npm run test:fast`: **328/328 steps green** at `75cad9e8`.
- `npm run test:http`: **all 31 HTTP/e2e suites green**, including 404 sidecar assertions plus
  attachments, summon, path trust, MCP, cron, autonomy, workshop, night shift, threads, channels,
  shell, and verify-run coverage.
- `npm run qa:journeys`: **123/123 assertions green** across task lifecycle, E-STOP, panel close,
  reload mid-run, rapid double-send/toggle, deliverable serving, crew idle/work behavior, and slash
  input routing.
- Live agent sweeps covered: onboarding/connect surfaces; COMMS streaming/stop/slash/attachments;
  concurrent sessions and offline recovery; 14 station windows; dialog focus/minimize/restore/
  z-order/responsive behavior; recruitment; recipes; REFIT controls; task/quest/skill/dossier
  surfaces; providers/models; budgets/runtime knobs; permissions/projects/path trust; MCP;
  Signal/channels; cron/routines; Night Shift/autonomy; backup/recovery; auth/origin boundaries;
  and restart persistence.
- Correct behaviors specifically observed: deliberate Stop preserves partial output and cancels
  durably; attachment removal leaves no orphan file; invalid model IDs warn; rail busy state is
  truthful; LINK DOWN recovers after restart; window focus trap/minimize/restore/z-order generally
  work; rapid SUMMON double-click is guarded; token auth and evil-origin rejection hold.

## Coverage limits and open verification

- This was the dev app with deterministic mock providers, not the installed Tauri/WebView2 build.
- No real provider billing/rate-limit/auth/OAuth lifecycle or real messaging token was exercised.
- Full awakening/interview was not completed.
- Canvas body quick-actions, physical prop/belt mutation and reclaim, Change Skin/Delete Agent,
  actual workshop keep/discard, and non-HTML deliverable opening were not completed.
- Atlas status at this head reports **0 perfected-fresh / 1410**, with **444 stale**, **123
  unmapped**, and **1 missing** entry. Automated green receipts therefore do not prove exhaustive
  current-surface coverage.

## Raw evidence locations

- Core flows: `C:\Users\<you>\gen-trees\qa-core-poweruser-715\.qa-core-temp`
- World/windows: `C:\Users\<you>\gen-trees\qa-world-windows-0716\.bugloops\qa-world-windows`
- Control-plane evidence was live-captured with harmless sentinels; its isolated processes/data
  were intentionally cleaned after verification. Exact responses and seams are preserved above.

## Recommended attack order

1. PU-03 secret-bearing export contradiction.
2. PU-01 Night Shift unproved focus and PU-02 invisible disabled connectors.
3. PU-04 off-screen durable window position.
4. PU-09/PU-10 same-agent cross-session busy state.
5. PU-11/PU-12 disconnect classification and partial-transcript preservation.
6. Remaining P2 telemetry/copy defects, then P3 cleanup friction.

Per the escape-loop law, each fix should first add a failing journey/assertion for the exact
reproduction, then prove the original behavior live.
