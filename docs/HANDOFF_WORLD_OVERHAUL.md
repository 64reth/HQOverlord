# HANDOFF — world visual overhaul (`agent/world-overhaul`)

**Date:** 2026-09-04 · **Branch:** `agent/world-overhaul` · **Worktree:** `C:\Users\andro\gen-trees\world-overhaul`
**HEAD:** `58fc522f3` · **Status:** BUILT, NOT MERGED, Andrew mid-review. Gate/goldens/claims OWED (see §5).

Read `docs/BRAIN.md` + `CLAUDE.md` first; this file is the lane-specific truth.

## 1. What this branch is

Andrew's ask (2026-09-03): *"make StarNet truly look like a $40 pixel-art gorgeous Steam game… without
using too many resources."* Then, across ~15 review rounds: *keep StarNet as it is, immensely improve
textures + lighting, Stardew-level; more depth and detail; the exterior must not glow against the void.*

The branch FOLDS IN two older unmerged lanes first, so one verdict covers all three:
- `agent/world-gorgeous` (09-02 lighting glow-up: physical falloff, cool plate, warm film, reach 1.3)
- `agent/prop-gorgeous` (v46 props) — **its prop ART was later removed** (§3, Andrew rejected the
  beige "golden" workstations); only its harness files under `gal/` remain.

## 2. What Andrew has judged (this is the map — do not re-walk rejected ground)

| Verdict | Thing |
|---|---|
| ❌ "not even slightly a fan… brown tint, too bright, cheaper" | round 1: bloom 0.45, warm film 0.3, dither 0.45, sepia grade, brown stock deck |
| ❌ "way too dark, basically pitch black" | hull exposure 0.25 |
| ❌ "clusterfuck, lower quality… CRT way too strong, curve ridiculous" | the old-TV CRT pass (pitch-2 lines, RGB mask, bleed, roll bar, curve 0.13). **Reverted to previous filter values; the passes still exist at 0 on lab knobs.** |
| ❌ "not sure how I feel about the golden workstations" | v46 prop rebuild — **removed**, trunk's original prop art restored |
| ✅ (accepted, silently) | cool steel stock deck (`#3a3b41`), no sepia, cast shadows, prop light sources, hue-shifted shading, per-room fixture colour, pendants, 30px walls, running lights, exterior exposure 0.4 |
| ✅ "proceed" + reference image | the *Pixel Art Space Station* look: big bolted plates, 2px seams, lit bevels, chunky framed wall panels with braces/pipes, standing tube lamps with fat glows |
| ❓ not judged yet | four new decks (DIAMOND/CARGO/CERAMIC/RESIN), the SPINE polish, the wall/deck polish pass, the prop polish pass |

Standing laws he restated this lane: **subtle CRT, not strong** · exterior darker than interior but not
black · no brown tint · "keep the essence" when polishing (SPINE stayed 4×3 panels).

## 3. What changed (by file)

`frontend/app/stationbake.js`
- `shade()` — hue-shifted shading for every INTERIOR painter (deck, walls, side faces, corner crowns).
  Hull keeps `U.shade` (hull test pins its ladder).
- `HULL_EXPOSURE = 0.4` + `hshade()` — every hull palette scaled darker; hull-skin draw-time LIFTS scaled
  by the same factor so no skin re-brightens itself. `WALL_TONE.cap` 0.30→0.02; `LIGHT.crown` 0.45→0.1.
- LIGHT now `{ambient .84, pool .85, room .46, corridor .34, door .4, floor .24, crown .1, reach 1.3, cool .9, warm .16}`;
  DEPTH `dither .12`; WALL `up 30, corUp 16`. Locks moved with the values in `test/simulation-lighting.test.js`.
- `lampRgbOf()` per room kind (lab cool, bridge cooler, foundry sodium, quarters amber; hab unchanged).
  Lamps export `{…, rgb, hang}`; `bake()` returns `lamps` (chunk path too).
- Deck: `lowFreq()` tone drift (±2.5%), `plateGrade()`/`deckBolt()` helpers, SPINE rebuilt (4×3 panels,
  bevel ladder, paired grain, four-step panel light, real bolts, one character mark per panel), SLAB
  joints two-step, PLANK crowned boards + knot + screw, hazard chevrons on door sills (`bakeThreshold`).
  New decks: `deckDiamond/deckResin/deckCeramic/deckCargo` (registered in `worldmodel.js` FLOOR_MATERIALS + MAT_ORDER).
- Walls: `faceGrade()/hairPair()/rivetAt()` helpers; every recipe uses them; bulkhead gained cable tray,
  vents, conduit drops; a bevelled two-tile SEGMENT FRAME is painted over every room wall face.

`frontend/app/world.js`
- `drawPropLights` (additive per-prop light, cached gradients), `drawBloom` (scale-based, half-rate,
  **default 0**), `drawNavLights` (hull corner running lights), `drawOverhead` (pendant fixtures over
  `lamps` with `hang`), shadow pass after decals, `CRT` gained `bloom/emit/mask/bleed/roll` (all inert
  except `emit 0.6`). `drawGlows` uses the lamp's rgb.

`frontend/app/propsprites.js` — trunk's original F.* art + `drawShadow()`, `lightOf()`/`EMIT` (~90 ids),
hue-shifted `shade()` for all 1112 derived tones, own-hue outline (`inkFor` tally on a type's first
frame), chunkier `box()`/`frontFace()`.

`frontend/css/style.css` — default grade `saturate(1.06) contrast(1.1) brightness(0.94)` (sepia/hue-rotate gone).
`frontend/app/crtlab.js` — mirrors + presets `World: pre-09-03`, `CRT: pre-09-03/old TV/heavy TV`.
`dev/worldshot.mjs` — perf probe (`SKYNET_WS_PERF=1`), real GPU (`SKYNET_WS_GPU=1`), `SKYNET_WS_HOLD=1`.
`gal/shipped-propsprites.js` — trunk prop art for the `gal/shoot.mjs` A/B.

## 4. Measurements (real frames, furnished lounge crop, zoom 2)
trunk → current: luma mean 30→~42, sd 20.7→~27, crushed 12%→~4%. **Frame cost on the RTX: +0.3 ms**
(1.49→1.81 ms; bloom was the only real cost and is off). ⛔ Measure on the real GPU — SwiftShader makes any
full-frame canvas draw look like 3 ms.

## 5. OWED before merge
1. `npm run test:fast` — last GREEN at `e5c93efab`; ~15 commits since. Run it (10 min, alone).
2. Claims re-lock: `node scripts/qa/product-perfect/relock-surface.mjs` (clean tree) → commit → gate again.
3. Goldens: `npm run golden` then `npm run golden:bless` (expect ingame + the two translucent panels to move).
4. Andrew's verdict on §2's "not judged" rows, then `starnet-merge-ritual`. Merging this merges the
   09-02 glow-up too. The prop-gorgeous lane's art is NOT in here any more.

## 6. Recipes
- Shoot: `SKYNET_WS_GPU=1 SKYNET_SHOT_PORT=8964 SKYNET_CDP_PORT=9364 SKYNET_WS_OUT=<dir> node dev/worldshot.mjs <tag>`
  → `<tag>-wide/hab/lounge.png`. Crops: `node dev/worldcmp.mjs A.png B.png x y w h out.png <scale>`
  (lounge `420 180 470 330`, hab `400 100 500 300`). Variants via `SKYNET_WS_VARIANTS` — **cumulative**.
- Props A/B: `MSYS_NO_PATHCONV=1 node gal/shoot.mjs "ids=desk,console&zoom=5&work=1&crop=1&before=/gal/shipped-propsprites.js" C:/…/out.png 8931`
  (Windows-style output path; the sheet is 6000px wide — stack it before judging).
- Live for Andrew: `.claude/launch.json` config `world-overhaul-live` (node sidecar/index.js on :8787 against
  his REAL workspace). It died twice during the session; restart via preview_start.
- Patch scripts: write them to the scratchpad and `node` them; bash heredocs mangled twice.

## 7. Proposed next
Andrew still says the world is "not there". The systematic levers are spent; what remains is hand
authoring: rebuild the eight most-seen props (desk, console, bay, intake, outbox, core, rack, shelf) to
the reference language (thick own-hue outline, fat lit bevels, big simple forms, one accent), one family
per sheet, judged with `gal/shoot.mjs` BEFORE touching the rest. Then wall X-braces and ringed pipes and a
standing tube-lamp prop from the reference.


## 8. September 4 custom-world review continuation

Work is isolated in `agent/world-visual-audit-0904`; the custom seeded preview is on :9177.
Andrew strongly approved the projected prop shadows and refined agent contact shadows.
He rejected the subsequent reflected-light/threshold redesign; that pass was reverted.
Preserve the approved interior brightness, falloff, cool equipment palette and original chairs.
Interior illumination must exclude the exterior shell and wall crowns. The current bake has
an interior receiver shared by the baked exposure and animated glow clip. Window panes must
explicitly use destination-out when clearing the light map. `dev/interior-light-probe.mjs`
checks exterior invariance, receiver classification and transparent window pixels in Chromium.

Latest craftsmanship pass is implemented for review: gasketed equipment access leaves,
layered mounting pads/fasteners, recessed ventilation, sparse metal-deck inspection hatches,
and more resolved bulkhead and shell service fittings. It does not change lighting controls,
chair designs, footprints, capability state, or the custom layout. Reviewed at normal and
close zoom; 17 focused test steps passed, followed by two floor/chunk checks after hatch placement.

Performance / beacon follow-up: running lights now occupy 22 validated flat front-wall panels,
with a recessed 5px housing between the seams. Andrew rejected mounts on the sharp chamfered
corners: keep those clear. Small fronts get one lamp and wider fronts get two; adjoining shapes
share a facade. All housing pixels are opaque shell, outside the interior receiver and floor
tiles; the old 52 unvalidated corner offsets are gone. Geometry checks run during bake.

Idle bay/desk/desk2/plant art caches preserve discrete blink/name/mirror/chroma states; working
props still render live. Prop bodies/shadows outside the viewport are culled with a 64px margin.
Projected shadows retain the approved shape, cached at 4x; the floor-clipped shadow pass is cached
at screen resolution and invalidates on camera/layout/bake/resize/context-loss changes. Agent
shadows and interior exposure are unchanged. Interior clip construction now happens during bake.

Real Chromium probes: 192 prop-art comparisons were pixel-identical; 96 shadow comparisons across
four zooms averaged 1.66/255 channel difference in shadow-covered pixels. Cached shadow-pass pixels
matched a fresh render after focus, resize and simulated context loss. Interior/exterior/window
regression probe passed. GPU benchmark (RTX 5060 Ti, 1440x900, 20s settled sample): full station
improved from approximately 37 FPS to 56.8 FPS, with p95 frame interval 16.8ms. The close-up held
60 FPS, with 3.8ms median / 5.5ms p95 frame callback cost. This is a local
renderer measurement, not an all-device performance guarantee. Reproduce with
`node dev/world-performance-probe.mjs review --gpu --settled`; add `--close` for the close-up.
`dev/nav-light-probe.mjs` and `dev/world-cache-probe.mjs` reproduce placement/art/cache checks.

Hallway entrance follow-up: real corridor openings through the room's raised north/back wall
now have splayed jamb faces and mitered crown ends, with a continuous deck through the throat.
The old short corridor rails previously carried straight into the room face. Their stale crown
records also excluded interior light after wall art had painted over them, leaving detached dark
vertical strips. The mouth pass replaces that geometry and removes only the superseded crown
records. Jambs receive interior light; crown tops remain excluded, and glass stays transparent.
It is a bake-only repair bounded to the entrance tiles, with no per-frame work or traversal changes.
`node dev/junction-probe.mjs` compares the custom demo against 14f7ac19a and checks one- through
four-tile entrances with both bulkhead and viewport walls in Chromium. All eight variants remain
walkable, and the custom station's base/light pixel changes stay entirely inside doorway regions
(zero changes outside). The interior/exterior/window probe and six focused test steps also passed.

September 5 doorway depth correction: Andrew observed agents painting through those new jambs.
The doorway had only been drawn in baseCv, beneath every entity. The bake now supplies ten small
solid entrance overlays in the custom demo, sorted with props/bodies at the wall's floor contact.
These include the adjacent solid shoulders so an occluded arm cannot reappear on the next wall
panel. The glass tint stays in the base only; glass panes are excluded from the solid overlays.
Empty station pixels and bodies already in front remain identical. Overlays are created during
bake, skipped offscreen, and rebaked after context loss. Movement/collision rules are unchanged.
`node dev/door-depth-probe.mjs` verifies opaque wall occlusion, visible aperture pixels, unchanged
empty/front views and transparent panes for eight width/material combinations; it also walks the
real movement helper through every fixture in both directions with zero illegal tile transitions,
drives a live custom-world agent across the entrance, and checks context-loss recovery.

September 5 cockpit UI pass (the six approved UI recommendations):
- COMMS now has a cropped, cached agent portrait, clearer identity hierarchy, a recessed multiline
  composer, and more legible conversation headers. Crew portraits reuse the same per-skin cache.
- Crew filters ALL / WORKING / NEEDS YOU read the existing run map and per-workstream pending
  approvals. Hidden rows are excluded from the rail's measured row cuts. Session/project chrome
  has quieter headings, clearer selection, and more breathing room.
- Refit tool shelves collapse; keyboard arming opens the matching shelf. A larger selected prop
  preview shows its actual footprint, facing, flip and capability. It uses the real sprite painter
  once per selection/orientation change; it adds no frame-loop work or placement side effects.
- Abilities distinguishes disabled, enabled-but-missing-prop and available toolsets using the API's
  switch/placement facts. The setup router is a disclosure with one service/catalog route. Config
  opens on three concise summaries; expanding, jumping, editing and rerendering preserve the group.
- Task Board, Outbox, Library and Agent Record links suspend the source window and provide Back.
  Conversation handoffs expose COMMS with a return shortcut. Existing drafts and scroll positions
  survive because navigation uses the window manager's minimize/restore lifecycle.
- `frontend/css/interface.css` supplies shared matte housings, recessed content and consistent
  selected/focus states through theme tokens. Narrow layouts reserve enough space for COMMS.

`node dev/interface-probe.mjs` exercises the custom seeded app without submitting any tasks or model
calls. Its 21 live checks cover portrait bounds and live skin refresh without transcript replay, truthful idle/approval filters, toolset state,
config expansion/editing, preserved drafts and return navigation, selected prop orientation, and
composer fit at 1049/700/475px. Screenshots and results are in `.worldshots/interface/`.
Station art, lighting, chair shape, movement and doorway depth were not modified by this UI pass.

## September 5 command-room material study

Andrew approved a one-room pilot to address the world/UI quality gap. Added opt-in ALLOY deck and
MONOCOQUE hull materials through the existing catalogs; defaults and other rooms are unchanged.
ALLOY uses quiet 4x3 plates, restrained captive fasteners, and recessed edges at darker floor-paint
insets. MONOCOQUE uses broad structural panels with protected rails, six existing silhouette stamps,
and sparse maintenance latches. Both are baked; no new per-frame loop or texture upload.

The custom demo's r1 keeps its viewport wall, dimensions, original chairs, shadow geometry and all
equipment/assignments. Its command desk gets a 6x6 cobalt inset; the two monitor stands move north
one tile, and the workbench/camera rig move away from the central silhouette. Four positions change;
no equipment is added or removed. Interior lighting settings and masks remain byte-identical.

`dev/command-room-probe.mjs` creates fixed-camera before/after views and proves the changes stay
within the room/shell, equipment identity/assignment preservation, and unchanged lighting/glass.
Real Chromium chunk comparison permits only the exact existing signed 1/255 alpha-rounding error
at two unchanged coordinates; no new error is introduced. Headless material tests cover locality,
distinctness and chunk parity. Evidence and the comparison viewer: `.worldshots/command-room/`.
`dev/apply-command-room-demo.mjs` applies only the reviewed fields to the owned scratch save,
refusing if those fields moved since the comparison. Original room data remains in the review
artifact for reversal. This is a command-room pilot, not a station-wide rollout or installed build.

## September 5 wall-corner colour repair

The interior-light receiver included straight raised walls but omitted their angled faces above
the room footprint. This left 9,022 visible face pixels at exterior ambient in the current custom
demo. Corner painting now records its exact interior pixels after silhouette/nearer-wall clipping;
the receiver includes those pixels and still subtracts all crowns. No light settings change.

Viewport strips had a second defect: low-alpha glass tint was read back as opaque RGB when sampled
onto a solid corner, making that metal cyan. The strip now composites the tint over the wall's own
face metal before sampling. The real straight windows keep their original transparency.

Run `node dev/wall-blend-probe.mjs --before`, then `node dev/wall-blend-probe.mjs` against the owned
custom demo. The live Chromium check records zero missed face pixels and zero crown coverage,
with byte-identical crown art/light, exterior lighting and glass panes versus fe88f76b3. Captures
of the command room and solid-walled quarters are under `.worldshots/wall-blend/`. This repair is
baked with existing materials, does not edit the station save and adds no frame-loop work.

## September 5 construction inventory

The collapsed build-tool groups could hide PROPS entirely on narrow layouts: CSS removed the
details summaries but left their contents collapsed. Build mode now has ten persistent tool
buttons and a Select landing with four direct starting points. The bottom construction tray
has a global prop search, a flat category rail with catalog counts, sprite cards with footprints,
and a separate selected-item inspector. PLACE ON DECK folds the inventory away; the next valid
deck click still goes through the existing model validation and undo history.

The inspector retains equipment-purpose and harness-backed access information. Workflow guidance
is contextual to Belt/Lines (and active tutorials), with a height/position bound above the tray.
Narrow trays offer ITEM DETAILS / BACK TO PROPS. Container queries keep tool labels readable
when text is enlarged. Search preserves focus; selecting a card preserves shelf scroll and the
existing canvases. Each thumbnail paints once, then only selected/hovered items animate.

`node dev/build-kit-probe.mjs` verifies 25 live checks on a disposable in-memory copy of the
custom station: full catalog, search/recovery, six viewport sizes, enlarged text, real pointer
placement, undo/redo, contextual guidance, and exit. It leaves the user's scratch save untouched.
`--gpu` also samples the full 144-item shelf; the local RTX 5060 Ti run measured 59.6 FPS,
16.8 ms p95 frame intervals, and 8.1 ms mean build-render callback time. This is a local sample,
not a frame-rate guarantee on other hardware. Evidence lives in `.worldshots/build-kit/`.

## September 5 left-sidebar correction

Andrew rejected the bottom catalog because it took too much away from the station. The build
console is now anchored on the left, bounded to 340 physical pixels. Search and every category
stay directly accessible above a two-column prop grid; a compact selected-item preview sits
below it. ITEM DETAILS replaces the inventory inside that same panel. MINIMIZE folds the
console to its header, and Fit releases its camera inset while minimized. Short viewports
scroll the console instead of moving it to the bottom or hiding build tools.

The live probe now checks the left edge and width at six viewport sizes, plus placement,
undo/redo, enlarged text, item details, and workflow-card separation. Its 25 checks pass;
current captures and receipts are under `.worldshots/build-kit-left/`. The full-width bottom
tray and its independent right-hand inspector are superseded by this correction.

## September 5 build-sidebar clarity pass

The left console now separates Build & Decorate, Edit Your Station, and Workflows into three
permanently visible groups. COPY and LAYOUTS replace the less explicit DUPE and LINES labels.
A single CATEGORY picker replaces the crowded chip grid, retaining every real category/count;
search still spans the complete catalog. The Select landing has a short three-step guide and
two direct starting points. The tutorial guides users through the category picker when needed.

The selected prop always exposes supported Turn/Flip controls, PLACE PROP and CANCEL. About
this prop stays in the same sidebar. Place focuses the deck without hiding the panel; Cancel
returns to Select. Escape closes the category picker or About view before deselecting. Clicking
the deck to dismiss the picker does not also stamp a prop. Props preview their validated
footprint before clicking, with validation cached by station revision, prop, facing and tile.

`node dev/build-kit-probe.mjs --gpu` passed 33 live checks on a disposable in-memory station,
including pointer placement, undo/redo, picker dismissal, hover validation caching, six screen
sizes and 145% text zoom. No runtime exceptions were recorded. The 144-item shelf measured
60 FPS, 16.7 ms p95 frame intervals and 7.1 ms mean build-render callback time on the local
RTX 5060 Ti. These are local observations, not guarantees for other hardware. Evidence and
captures are in `.worldshots/build-kit-clarity/`; the user's custom save is untouched.

## September 5 ability-first prop library

The left Props panel now opens on Abilities, with five compact choices derived from the existing
STARTER set: Files, Web & Browser, Terminal, Memory and Images. Selecting an ability shows its
suggested prop, purpose, sharing scope and actual per-agent tool access above Place. Other Designs
shows every prop with the same capability mapping and explains that they provide the same tools.
The chosen alternate remains selected when returning to the core list. No grants or saves change.

Workstations & Workflows and Decoration are separate purpose sections. Classification checks the
real capability map before the old catalog tier; decorative-looking functional props cannot be
misfiled as appearance-only. Functional station controls stay separate from decoration too. All
search results and selected previews explicitly label their purpose. Connected services remain
optional, with connection/access guidance rather than a promise that a placed prop is ready.

The core choices display current tool-access states. Outside the core view, the same five states
remain in a compact overview. The selected agent can be changed and access explicitly refreshed.
States come from the existing /api/toolsets projection and refresh after station edits and undo/redo;
equivalent-design selection reuses that response. Failed reads show CHECK ACCESS, not missing gear.
Profile/Full Access grants and switched-off toolsets retain their real meaning. The tutorial uses
the new ability choices and preserves its existing requisition-the-rest action.

`node dev/prop-abilities-probe.mjs --gpu` passes 32 live checks against a disposable in-memory copy
of the custom demo. It covers real endpoint agreement, agent changes, five-choice desktop fit,
classification, alternatives, pointer placement, undo/redo, a simulated access outage, five viewport
sizes and enlarged text. No runtime exceptions. The 112-item decoration shelf measured 60 FPS,
16.8 ms p95 frame intervals and 9.2 ms mean render callback time on the local GPU run. Evidence:
`.worldshots/prop-abilities/`. These measurements do not guarantee performance on other hardware.

## September 5 direct prop placement and hover identification

The selected-prop footer no longer has PLACE PROP or CANCEL buttons. Choosing a catalog item
already arms placement: move onto the station to preview its footprint, then click a clear spot.
Escape returns to Select. The footer now keeps the sprite, name, purpose badge, short description,
supported orientation controls and a plain placement hint. Detailed access and sharing explanations
remain under About; the live ability overview stays above the catalog. Decoration shows its own
description. The smaller footer and reduced minimum panel height give space back to browsing.

Catalog hover and keyboard focus use the existing shared station tooltip for the prop name and
purpose. They never change selection or open an inspector. The tooltip clears on departure;
there is no new tooltip controller, native title bubble or per-frame work.

The updated `dev/prop-abilities-probe.mjs --gpu` passes 36 live checks, including direct pointer
placement without an intermediate button, Escape cancellation, hover/focus behavior, About details,
responsive layout, undo/redo and access truth. No runtime exceptions. The 112-item decoration shelf
measured 60 FPS, 16.7 ms p95 frame intervals and 7.55 ms mean render callback time in this local run.
Current receipts and screenshots supersede the earlier placement-button UI in `.worldshots/prop-abilities/`.

## September 5 approachable conveyor setup

Clicking a conveyor prop now opens a wide setup screen (960px on desktop, bounded by the viewport).
The generic INBOX / SORT / BAY / DESK strip is removed. Bay setup leads with choosing an agent and
writing their instructions; Inbox setup leads with naming the workflow and choosing a schedule or
channel. The actual connected steps remain editable alongside the settings. Filters name the real
destinations from the compiled routing plan. Outboxes and simple path props explain their function
and explicitly say when no extra settings are needed. Loop and Joiner retain their existing controls.

Manual agent IDs, alternate starting agents, advanced loop classification and workflow budgets stay
available under disclosures. The selected schedule method remains visible while its form is open.
Names, briefs and gate settings retain their existing save behavior; schedules and Filter routes
have explicit save buttons. No backend APIs, routing semantics or execution permissions changed.
The body scrolls independently of the header and Done footer, keyboard focus stays inside setup,
and generic placement coaching waits until setup closes so it cannot obscure the form. This adds
no per-frame rendering work. The left Build kit and custom station layout are preserved.

`node dev/workflow-setup-probe.mjs` passes 46 live checks on a disposable in-memory station, covering
agent search/assignment, brief persistence, workstation creation, schedule preview, route/gate saves,
keyboard behavior, four smaller viewport sizes and enlarged text. No runtime exceptions. Evidence:
`.worldshots/workflow-setup/`. The existing `dev/inbox-when-picker-shots.mjs` also verifies that Save
Schedule persists the chosen cadence through the real seeded server and reads back its agent,
whole-workflow flag and next run. It uses an isolated workspace and mock provider, with no model run.

## September 5 crew search and session attention

The Crew ALL / WORKING / NEEDS YOU strip is removed. A small Find an agent control in the header
opens a name/ID search; Escape or its close control clears the query and restores the roster.
Crew rows keep their existing activity indicators. Searching temporarily reveals a roster dragged
shut, then restores that saved split when closed. Session controls retain their space in the rail.

Pending requests are shown on their actual sessions: Approval needed for consent and Reply needed
for an agent question. A conditional Waiting for you shortcut counts sessions, including separate
requests on the same agent, and filters the list to those conversations. Orphaned channel IDs do
not count; an archived session with a live request remains reachable. Clicking a result opens its
own conversation and existing request UI. Resolving the final request removes the shortcut and
restores the normal list. Session search exits the filter, and Projects hides session controls.
Compact pending rows put their badges below the title so the action cannot squeeze out its name.

No backend, consent, or execution behavior changed. Updates reuse the existing rail heartbeat.
`node dev/session-attention-probe.mjs` passes 31 live checks using fixture requests on an isolated
seeded server, with no model calls or consent decisions. It checks exact-session navigation into
the approval UI, two requests on one agent, questions, orphan/archived cases, resolution, search,
keyboard/focus recovery, three smaller viewport sizes, enlarged text and saved roster collapse.
No runtime exceptions. Evidence: `.worldshots/session-attention/`. The custom demo save is preserved.

## September 5 header instruments

The station level, E-STOP and connection readout now share the dashboard's recessed, matte
hardware styling. The level has a rank emblem and its existing measured XP progress. E-STOP
has a larger target, a stop symbol and a HALT RUNS subtitle. Uplink and activity share a
two-line readout with a connection symbol, replacing the old signal bars and oval status pill.
Existing status IDs, writers, save-health indicator, halt action and Alt+H shortcut remain intact.
Colors follow all six palettes; narrow layouts progressively remove decorative symbols.
This adds no timers, animation loops, network requests or world-render work.

`dev/header-instruments-probe.mjs` exercises layout from 320 to 1440 pixels, enlarged text,
theme changes, real E-STOP requests and connection loss/recovery on a disposable seeded server.
Evidence lives in `.worldshots/header-instruments/`. The custom station at port 9177 is preserved.

### September 6: E-STOP moved to SYSTEM

Per user feedback, the header now keeps only station level and the connection readout.
E-STOP is the last SYSTEM menu item, labeled "halt all runs · Alt+H". The menu's existing
keyboard navigation and close-on-selection behavior apply. The halt handler and global Alt+H
shortcut are unchanged. Updated header verification checks the menu action at narrow widths
and sends real halt requests only to the disposable test server.

## September 6 trunk reconciliation and suspended fixture removal

Synced the world/UI lane with trunk `9fa38c05b`. The header keeps the newer Commander achievement
progression from JourneyStore, using the refined instrument styling. Session attention now coexists
with trunk's Chats/Automated views and grouped routine history: pending sessions remain reachable
across category filters and archives; Waiting for you lists every pending session without grouping.
Leaving that view restores the saved category and grouping. E-STOP remains under SYSTEM.

Removed the world renderer's suspended pendant stems, shades and bright tubes at the user's request.
The existing room light sources, light pools, wall-mounted fixtures, shadows and interior masks remain.
This removes an overlay draw pass rather than changing the room's lighting calculation.

Final source candidate `03f098895` also includes trunk `948557c62` and its newer Extensions UI.
Merge preparation passed all 723 fast steps, 100 HTTP steps, and 149 live UI checks; the custom
144-prop station is preserved. Verification scope and receipts are recorded in
`docs/WORLD_INTERFACE_MERGE_READINESS_2026-09-06.md`. The lane is prepared for integration,
not yet merged or packaged as an installed release.

### Session filters simplified after review

The session rail now offers only ALL and AUTOMATED. The retired CHATS preference falls back
to ALL on load. AUTOMATED strictly shows sessions with automation provenance, including legacy
automation sessions; ordinary active, pinned, failed or waiting sessions no longer bypass that
filter. Waiting for you remains a separate shortcut to pending responses across all sessions.
An empty automation list explains that there are no automation sessions yet.

### Final integration

Session spacing now uses 2px gaps and 5px vertical padding without stacked row margins.
Merged at `fb22656be`; both the final branch and integrated trunk passed all 724 fast steps.
The HTTP suite passed 101 steps, and the updated session live probe passed 36 checks.
See `docs/WORLD_INTERFACE_MERGE_READINESS_2026-09-06.md` for the final integration receipts.
