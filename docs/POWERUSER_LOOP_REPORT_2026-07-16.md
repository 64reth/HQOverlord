# StarNet power-user break/fix loop — 2026-07-16

Candidate under audit: `d3dcd61435f5af2d5d4d9a7ed43a03609a793b3d`  
Merge state: **isolated; not merged to `feat/harness-backend`**

Three independent agents audited the exact candidate as skeptical power users. They used physical
Windows control, the repository-owned live CDP journeys, real seeded sidecars, restart readback, and
focused HTTP suites. The in-app Browser backend was unavailable in all three lanes, so no claim below
depends on that surface. No audit lane changed product code.

## Confirmed findings

| ID | Sev | Concern | Evidence / owner |
| --- | --- | --- | --- |
| PL-01 | P1 | Short/small windows can place the COMMS composer and entire bottom dock below an unscrollable viewport. | Physical 175% zoom at an effective ~558×539 CSS viewport. `frontend/css/app.css` responsive grid/root overflow. |
| PL-02 | P1 | Every ordinary reload creates another unread “NOVA is online” notification. | Three reloads produced three persistent identical rows and badge count 3. `frontend/app/stationui.js` presence notification path. |
| PL-03 | P1 | Reload transient simultaneously claims “station unreachable”, `STANDBY`, `ONLINE`, and “COMMS online”. | Physical screenshot at ~2.2 seconds; settles by ~5.7 seconds. `frontend/app/app.js` bridge boot state and initial COMMS copy. |
| PL-04 | P1 | Skill Library switches and recipe disclosures have non-unique accessible names across ~40 skills. | Windows AX exposes only `ON`/`OFF` and `Read the recipe`. Skills renderer in `frontend/app/stationui.js`. |
| PL-05 | P1 | Full `qa:journeys` false-fails J2b because J2a E-STOP teardown can terminate the next held run. | 5/9 full-suite failures; isolated J2b 5/5 green. `scripts/qa/journeys.mjs` must await sidecar inflight drain/specific prior run end. |
| PL-06 | P2 | An invalid `file://` MCP URL returns 502 but is durably saved enabled with its token and retried eight times. | Live POST/read/restart proof; secret not echoed. `sidecar/index.js` connector validation/persistence order and MCP retry classification. |
| PL-07 | P2 | Settings search keeps Notifications highlighted while showing cross-section backup matches and leaves irrelevant headings ahead of the result. | Physical screenshot and DOM `activeTab=...notifs`. `mountConsole()` search in `stationui.js`. |
| PL-08 | P2 | Rapid CUSTOM selection + WAKE reports stale Codex model `gpt-5.5` instead of requiring the Custom `/v1` endpoint. | Fresh onboarding rapid-click DOM receipt. Async provider switch/validation order in `frontend/app/app.js`. |
| PL-09 | P2 | Notification dismiss actions are all named `Dismiss notification`. | Windows AX with three rows. Notification renderer in `stationui.js`. |
| PL-10 | P2 | Theme buttons expose no selected/pressed state. | Windows AX before/after Amber→Blue. Appearance renderer in `stationui.js`. |
| PL-11 | P2 | Two large console windows can clamp to identical bounds and perfectly occlude one another. | Physical Skills then Settings proof at 976px. `placeTerm`/`fitTermInViewport` in `stationui.js`. |
| PL-12 | P2 | Deliverables search/status/refresh/cleanup controls render as raw browser controls, unlike the CRT UI. | Same-run screenshot comparison. `frontend/app/deliverables.js`, `frontend/css/style.css`. |
| PL-13 | P2 | Deliverables intro copy exposes implementation jargon such as “opaque-origin sandbox” and “escaped and bounded”. | Physical copy review. `frontend/app/deliverables.js`. |
| PL-14 | P2 | Installed Windows AX exposes duplicate minimize/maximize/close controls from custom and top-level titlebars. | Installed candidate Windows AX tree. `frontend/app/titlebar.js` / Tauri window semantics. |
| PL-15 | P3 | `IN PROGRESS 3` can contain three cards all marked `DONE — REVIEW & SHIP`. | Live task-board DOM; state chips are truthful, aggregate label is not. Task board renderer in `stationui.js`. |
| PL-16 | P3 | Cinema mode ignores Escape even though Escape is the standard exit convention. | Physical keyboard proof; C and EXIT work. Cinema key handler. |

Cleared concerns: minimized windows do not leak hidden descendants into a fresh Windows AX snapshot;
panel close does not kill a run in isolation; provider/model status labels remain truthful; session
export/clear/bulk undo and terminal geometry survive reload; Workshop sandbox/token/cleanup/restart,
Night Shift, routines, recruitment, projects, permissions, and channel secret projections passed.

## Repair plan

### Lane F1 — UI shell, reachability, and accessibility

Owns PL-01, PL-02, PL-04, PL-07, PL-09..PL-16 except backend/boot items. Use red tests first.
Preserve existing window persistence and truthful state. Required live proof: short landscape and phone
reachability; reload notification dedupe; named Skill/notification actions; theme selected state; two
large windows visibly recoverable; themed/plain-language Deliverables; installed AX titlebar; Escape
from Cinema; task-board aggregate wording.

### Lane F2 — Boot and onboarding truth

Owns PL-03 and PL-08 in `frontend/app/app.js`. A reload must present one coherent connecting state until
the bridge is proven. Custom-provider validation must make the endpoint prerequisite win even under
rapid provider switching. Required proof: repeated timed reload snapshots and rapid CUSTOM→WAKE loops.

### Lane F3 — Backend and QA lifecycle reliability

Owns PL-05 and PL-06. Wait for prior run teardown using backend authority before starting J2b. Reject
non-HTTP(S) connector URLs before any config/secret write; distinguish syntactically valid saved-but-
offline endpoints and never retry permanent scheme errors. Required proof: 10 full journey loops,
invalid-scheme no-write/no-token restart readback, and valid-unreachable saved/error semantics.

## Composition gate before report

1. Focused red→green regressions for every PL item.
2. `npm run test:fast`, `npm run test:http`, and `npm run qa:journeys` on the composed candidate.
3. Repeat the new adversarial live journeys, including 10 full J2 sequences.
4. Rebuild/reinstall Tauri and run exact-head installed smoke plus Windows AX checks.
5. Report fixes, evidence, and residual risks to the user. **Do not merge without user review.**

## Repair outcome

All 16 confirmed concerns were repaired on the isolated `agent/qa-poweruser-root` composition branch.
The exact final commit is recorded by the installed smoke evidence; nothing in this loop has been
merged to `feat/harness-backend`.

| IDs | Resolution | Verification |
| --- | --- | --- |
| PL-01, PL-11 | Small viewports can scroll to COMMS and the dock; large overlapping windows recover with a visible cascade. | Responsive shell and terminal geometry regressions; physical seeded viewport/window proof. |
| PL-02, PL-09 | Presence notifications deduplicate across reloads; dismiss buttons include the notification subject. | Reload-count journey, notification rendering assertions, and Windows accessibility inspection. |
| PL-03 | Reload shows a single connecting state until the bridge is authoritative. | Ten timed reload loops, coherent from pre-authority through settled online state. |
| PL-04, PL-10, PL-14 | Skill controls have unique names, themes expose selection state, and the installed accessibility tree no longer duplicates titlebar controls. | Skills/appearance/titlebar regressions plus Windows accessibility inspection. |
| PL-05 | J2 waits for authoritative prior-run teardown before beginning the next held run. | Ten complete J2 sequences (380 assertions) and the full 129-step journey suite. |
| PL-06 | Non-HTTP(S) MCP URLs are rejected before config or secret persistence; valid unreachable URLs are explicitly saved-but-offline. | HTTP/restart readback and MCP end-to-end tests, including zero-write invalid-scheme proof. |
| PL-07 | Settings search activates the section containing the selected match and suppresses irrelevant section chrome. | Console search regressions and physical seeded proof. |
| PL-08 | Rapid CUSTOM-to-WAKE validation requires the Custom endpoint and cannot leak the previous provider model error. | Ten rapid onboarding loops and boot-provider truth regressions. |
| PL-12, PL-13 | Deliverables controls use the CRT visual language and user-facing copy replaces implementation jargon. | Deliverables UI/store suites and physical seeded review. |
| PL-15 | The task aggregate is labelled ACTIVE, while each card retains its authoritative state. | Task-board regression and updated full journey assertion. |
| PL-16 | Escape exits Cinema mode. | Shell keyboard regression and physical seeded proof. |

### Automated composition evidence

- `npm run test:fast`: 341 steps passed.
- `npm run test:http`: passed, including sidecar 418 coverage and 40 MCP end-to-end assertions.
- `npm run qa:journeys`: 129/129 passed.
- Focused suites passed for shell repairs, boot/provider truth, terminal resize, titlebar,
  Deliverables UI/store, Skills Library, and MCP behavior.
- Dedicated live stress passed: ten reload-state loops, ten rapid Custom-to-WAKE loops, and ten
  complete J2 lifecycle sequences.

### Residual limits and decisions

- The updater bundle cannot be cryptographically signed in this workspace because the private signing
  key is not present. The native executable and installer can still be built and tested locally.
- Real external provider credentials, OAuth grants, microphone hardware, and native file-picker
  integrations were not exercised; the seeded/mock and local backend paths were exercised instead.
- The separate background-supervisor lifecycle proposal remains an explicit product decision and is
  not part of this defect repair set.
