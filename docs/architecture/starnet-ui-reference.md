# StarNet operator UI reference

## Source and reuse check (before implementation)

Reference revision `fbddbf992f8e7082196f07c3024781fcf1c276fc` is inspected locally; `C:/Projects/starnet` is read-only throughout. `LICENSE` is MIT, copyright © 2026 Andrew Sims. `package.json` also declares MIT. Code may be used, modified and redistributed with the full copyright, permission and disclaimer notice retained in substantial copies.

`NOTICE.md`, **StarNet's own name and artwork**, explicitly states that the code license does not license the name/logo, station artwork, sprites or brand identity. No StarNet graphical assets will be copied. The sprite/furniture manifests identify frame and asset paths, not an independent grant. HQ uses original artwork with equivalent rendering roles. No endorsement is claimed.

`NOTICE.md`, **Bundled fonts**, separately licenses VT323 under SIL OFL 1.1, © 2011 The VT323 Project Authors (peter.hull@oikoi.com). The unchanged local font is reusable with its copyright and full OFL text; those notices are bundled beside it. Provider icons have a separate MIT notice but are unnecessary here. Skills, audio, decoder and other third-party packages are not reused. Full code attribution is bundled in `public/notices/STARNET-MIT.txt` and is accessible from the operator UI.

## Implementation map traced before rebuilding

| Source | Actual structure/flow | HQ mapping |
| --- | --- | --- |
| `frontend/index.html`, `css/app.css`, `css/style.css`, `css/interface.css`, `css/panelchrome.css` | Full viewport cabinet: top instrument bar → left CREW/session rail → central canvas → right COMMS → grouped bottom dock; amber phosphor tokens, locally loaded VT323, molded/recessed panels | Same cabinet hierarchy, type/color/spacing vocabulary; business selector replaces station identity. No objective banner or dashboard navigation. |
| `app/app.js` focusAgent/selectAgent, `app/stationui.js` buildAgents/openAgent | A validated roster selection repoints COMMS identity, model and world focus; unavailable IDs never silently impersonate another agent; dossier exposes identity and kit | Client adapter validates selection against received business roster; crew/canvas/COMMS selector share one selected ID; details display backend permissions/model and jobs. |
| `app/navdock.js` | Grouped bottom docks, viewport-clamped popovers, outside-click/Escape dismissal, arrow/Home/End keyboard model | Reuse the unchanged permitted menu implementation for CREW / WORK / SYSTEM; opens existing jobs, knowledge, tools, approvals and ledger panes. No unsupported menu items. |
| `app/worldmodel.js`, `app/stationbake.js`, `app/world.js`, `js/assets.js` | Geometry/static floor bake separate from entities; reusable sprites with direction/state; pointer hit testing, pan/zoom, focus ring/camera; labels and work glyphs overlay bodies | Original single-room canvas: cached floor/walls/props → station sprites → agent sprites → selection/status overlays. Original images, same roles; camera movement is view navigation, never simulated work. |
| `app/world.js` run/tool subscriptions and link health | agent.run.start/end own work lamps; tool-call/result IDs own work glyphs; snapshot reconcile clears drift; disconnected link dims uncertainty | HQ active ownership + execution operation + durable job status → UI model → canvas glyph/crew/COMMS status. No active job means idle posture; latest completed/failed outcome is a separate factual badge. |
| `shared/events.js`, `sidecar/channels/sse.js`, world connectChannelBridge | Validated events → bounded SSE → one EventSource → U.bus listeners → run/tool maps → glyphs/ticker; reconnect snapshot reconciliation | Keep stronger HQ scoped full snapshots after committed saves, adapt into one frontend projection model. Heartbeat loss disables mutations and sets operational activity unknown. Reconnect rehydrates; no job retry. |
| `app/stationui.js`, `app/warroom.js`, `app/dossier.js` (Commander beliefs), `css/tasks.css`, `css/comms.css` | Tool/memory/task/ledger windows and consent surfaces; conversation identity, status and controls stay next to the world | Existing HQ jobs/artifacts/knowledge/permissions/accounting presented in dock windows and selected-agent COMMS. Exact operation approval and cancellation go to backend. |
| `css/app.css` responsive cabinet breakpoints | Narrow screen retains crew+canvas, COMMS spans next row, bottom docks wrap; compact/scroll fallback for short windows | Same responsive hierarchy at 390px; full three-column cabinet at 1440px. Windows clamp inside viewport; controls remain accessible. |

## Functional parity checklist

| StarNet function | Class | HQ equivalent / decision |
| --- | --- | --- |
| Cabinet / crew rail / graphical stage / COMMS / bottom docks | A | Rebuilt shell; no old dashboard retained |
| Crew search, select agent, focus ring and dossier | C | Shared selection adapter + roster search + selected agent detail |
| Canvas station geometry, labels, camera pan/zoom/reset | C | Original one-room renderer and permitted shell vocabulary |
| Per-agent job/work/tool indicators, activity ticker | B/C | Backend-owned executions/jobs/facts projected truthfully |
| Task board and job controls | B/C | Durable HQ jobs, dependency waits, cancel/run controls in WORK |
| Tools/kit inspection | B/C | Allowed tool IDs and recorded dispatch/result metadata |
| Notebook/memory | B/C | Business-scoped sources, knowledge and immutable artifacts |
| Ledger/budget instruments | B/C | Exact actual expenses/revenue; configured limits labelled separately |
| Consent/approvals | B/C | Exact durable operation review; trusted human decisions and resume |
| Hydration / one SSE / reconnect / link loss | B | Existing HQ transport retained and adapted |
| Panel close / expand / keyboard/outside menu dismissal | A | Dock windows and COMMS expansion |
| Human job creation/composer | C | Backend-scoped generic create-job command; no simulated chat reply |
| Recruit/summon agents, model changes, terminal/computer-use | D | Missing corresponding HQ authority; not rendered as functioning controls |
| Session chat streaming, steer/type-ahead, attachments/voice | D | HQ has jobs/artifacts, not a durable chat/session API; no fabricated transcript |
| Refit/campus construction, marketplaces, channels, cron | D | Outside existing HQ functionality / this phase |
| Commander quests, XP, scores, targets, subscriptions | D | Explicitly excluded by this request |
| Emergency stop | D | No runtime halt authority; no button |

Deliberate differences are limited to required HQ authority/business isolation, job instead of chat semantics, full authoritative snapshots, original unlicensed-art replacements, unsupported D functions, and removal of gamification. Each is required by the task or by absent backend authority, not a new product direction.

## Verification and visual comparison

All A/B/C rows above are implemented. D rows are deliberately absent, rather than disabled speculative controls. The single canvas uses original consoles and the existing original HQ agent SVG. No StarNet station/sprite/logo artwork is distributed. `navdock.js` and the VT323 font are unchanged source copies under their respective licences; shell CSS adapts MIT layout/tokens with attribution.

Visual review inspected HQ cabinet, dossier and ledger screenshots at 390 and 1440 pixels. Direct reference comparison used StarNet's existing `qa/evidence/0.11.2-closeout-0911/crowded-floor.png` cabinet screenshot, its backdrop/cinema evidence, and the current shell/CSS source. The same top/crew/world/COMMS/dock hierarchy, amber instrument chrome, font, window controls and station selection are retained. The reference sidecar was not launched and its directory was not written. Original HQ art is deliberately less detailed than StarNet's restricted artwork; this is not a claim of pixel/art parity.

The local Chrome smoke uses scratch durable state, no model execution and blocks external page requests. It checks all 11 supported windows, crew/COMMS and actual canvas selection, durable job creation/SSE, real server loss, mutation disabling, unknown activity, and restart hydration. Restart renews the host-minted HttpOnly session without exposing a token or retrying any operation. Heartbeat expiry is tested deterministically in the browser state reducer.

The development fixture cleanup was applied to the existing ignored Business 001 local store. Active configuration and stored state no longer contain the accidental customer/price/deadline target. Only that unexecuted bootstrap job and its associated command/fact records are removed; surviving provenance is not rewritten. Genuine execution/financial/evidence/causal history makes cleanup refuse.

Verification: 11 control-centre + 4 core + 3 events + 147 unchanged runtime + 12 Business 001 tests = 177 passing. Workspace/root typecheck, web build and diff check pass. Browser evidence is local and ignored under `apps/control-centre/.local/smoke/`.
