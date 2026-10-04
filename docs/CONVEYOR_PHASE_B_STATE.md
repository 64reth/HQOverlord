# Conveyor Phase B — state & continuation handoff

**Purpose:** so a fresh context can continue Phase B (functional + multi-agent conveyor routing) at full
quality. Read this + the `starnet-conveyor-pipeline` memory + `docs/CONVEYOR_PIPELINE_PLAN.md` first.

## Where we are (2026-06-15)

- **Branch:** `agent/workpipe-b` (worktree `C:\Users\<you>\gen-trees\workpipe-b`), forked off trunk
  `feat/harness-backend`. NOT merged yet.
- **Verify anything:** `cd C:\Users\<you>\gen-trees\workpipe-b && npm run test:fast` (all headless, must be green).
- **Phase A** (visualization: INTAKE→belt→desk→OUTBOX, backpressure, supersede-drop, splitter-visual) is
  **shipped to trunk + master**. Phase B makes it **functional + multi-agent**.

### Done + committed on agent/workpipe-b
| Commit | Stage | What |
|---|---|---|
| `6232722` | **B0** | BAY prop + additive `prop.agentId` (worldmodel addProp/projectGeometry/migrate carry it — migrate WHITELISTED prop fields, had to add agentId); `assignPropAgent`/`propsByType`/`propsByAgent`/`agentRoomId`; `F.bay` drawer w/ nameplate; `draw()` forwards agentId. +17 worldmodel.test (117). |
| `a5107d0` | **B1** | **THE KEYSTONE** — `frontend/app/pipeline.js` (pure, zero-dep UMD): `compileRoutingPlan(geo)→{sources,bays,junctions,belts,bayTileToAgent,reach,errors,hash}` + `resolveTarget(plan,{tag})→agentId\|null` + `ok(plan)`. Validates ORPHAN_SOURCE/DEAD_BAY/CYCLE(hard)/DUP_AGENT/FILTER_NO_DEFAULT/UNBOUND_BAY-warn. FILTER routes by tag (`routes{tag→dir}`+`def`). +26 pipeline.test; added pipeline.js to lint-determinism. |
| `7abf316` | **B2** | **Layout controls WHO runs.** `sidecar/routing/router.js` (holds posted plan, REFUSES non-deployable via `Pipeline.ok`, `resolveTarget`). `sidecar/index.js`: `POST /api/routing` + injects `resolveAgent`+`getTag` into the hub. `hub.js`: agentId resolution consults `resolveAgent` FIRST (routed‖sec.agentId‖tg_<chatId>); null→fallback (never stalls); **inflight re-keyed by chatId** (two chats→one agent don't cross-cancel). +6 channels.hub.test (40). |
| `bd0e721` | **B3** | **Content routes work.** `classify.js getTag(text)→code/research/general` (pure; code beats research; ambiguous→general default lane). `conveyor.js chooseExit` gains **FILTER** (route by `payload.tag`, missing-lane→def→first-lane, never drops) + **MERGE** (buffer K per-tile; first K-1 absorbed via a `false` consume sentinel→sink no-deliver; K-th rides on with combined `payload.merged` list) + an **`onAdvance(bx,info)`** telemetry seam (world.js wires it to `emit('workitem.advanced')`; kept out of conveyor.js so it stays event-registry-free). `pipeline.js resolveTarget` filter branch validates against `outLanes` (def→first-lane), mirroring the engine so visual==dispatch. +classify/conveyor/pipeline tests (65/50/29). |

**The entire headless FUNCTIONAL ROUTING CORE (B0–B2) is done with ZERO renderer changes.** `pipeline.js` is
the single authority `require()`d by both the frontend sim and the sidecar router → "box you watch" and
"agent that runs" are provably one plan.

## Architecture invariants (do not violate)
- `frontend/app/pipeline.js` is **zero-dep UMD**, pure (no RNG/wall-clock/mutation), lint-determinism-scanned.
  The sidecar `require()`s it. One compiler, two consumers, no drift.
- **Routing ⊥ capability:** a BAY's `agentId` = WHO runs; its room's objects = WHAT tools (via the UNCHANGED
  `resolveTools`). B5 wires the per-bay station; until then routed runs keep the hardcoded office.
- **Belt gates only the autonomous (Telegram) path, never browser chat.** Routed-mode is opt-in; `resolveTarget`
  → null ALWAYS falls back to today's resolution. Real work never stalls.
- **CYCLE is a HARD error** (a loop = infinite paid runOnce); the router refuses to store a cyclic plan.
- `shared/events.js` + `shared/schema.js` are ADDITIVE-ONLY (owned by cortex-memory — REQUEST changes). Phase B
  needs only `workitem.advanced` (for B3 junction telemetry); until granted, emit it via a **dynamic**
  `emit(name,payload)` (lint-emits only catches string literals). All other events already exist.
- Commit only your own files with explicit pathspecs (never `git add -A`).

## NEXT — B3 (engine filter/merger + real classifier) — independently mergeable green
1. **`frontend/app/classify.js`** — add pure `Classify.getTag(text)→'code'|'research'|'general'` beside
   `isTaskDirective` (keyword heuristic, deterministic, UMD-exported; default `'general'`). It's already wired:
   `sidecar/index.js` passes `getTag: (text)=>Classify.getTag?Classify.getTag(text):undefined` — adding it
   lights up real FILTER content-routing end-to-end.
2. **`frontend/app/conveyor.js`** — extend `chooseExit` (today split-only, ~L197) with `kind:'filter'` (route
   by `bx.payload.tag` → `config.routes[tag]||config.default` lane) and `kind:'merge'` (buffer K inbound boxes
   per-tile, emit one combined box on the K-th). SAME determinism as splitter (per-tile `rr` Map + fixed
   `LANE_ORDER` + tick-start snapshot). Emit `workitem.advanced` per crossing (dynamic emit until granted).
3. **`frontend/app/pipeline.js`** — `compileRoutingPlan` already classifies filter/merger into junctions with
   config; ensure merger `bufferSize` is threaded; `resolveTarget` already threads `{tag}` through filters.
4. **Tests:** `test/classify.test.js` (getTag), `test/conveyor.test.js` (filter routes by tag w/ overflow;
   merger emits one box at K; both replay-stable). `npm run test:fast` green.

## B4 progress (the VISIBLE multi-agent crew + bay authoring)
| Commit | Stage | What |
|---|---|---|
| `786cb89` | **B4a** | world.js `rederive()` → `compileRouting()`: `Pipeline.compileRoutingPlan(geo)` + POST `/api/routing` (hash-deduped). `buildJunctions()` derives from `plan.junctions` (filter/merger animate). `intakeMessage` tags the box via `Classify.getTag`. index.html loads `app/pipeline.js`. Non-breaking for an empty floor. |
| `662625e` | **B4b** | **Visible crew.** `agent` stays the HERO (untouched). `crew[]` = light static bodies, one per bound bay (`syncCrewFromPlan` in rederive). `drawAgent/drawFallback/drawBubble` take an optional `who` (hero path byte-identical, gated `who===agent`). `onWorkitemDeliver` routes a delivered box to its bound body via `resolveTarget` + lights the bay (`bayLit`); else the hero, as before. Verified: instrumented frame drew hero+2 crew. |
| `bac4388` | **B4b.2** | **Junctions carry config.** Found projectGeometry dropped a placed filter/merger's `routes/def/bufferSize` (B0 only carried `agentId`) → real filters were inert. Now carried additively in addProp/projectGeometry/migrate (sanitized E/W/N/S, bufferSize≥2) + `configureJunction(propId,cfg)` setter. A placed filter floor now compiles DEPLOYABLE. worldmodel.test 136. |
| `a30b798` | **B4c** | **Bay authoring + cost-safety ghosts.** build.js `openBayPicker` (reuses the refit-guide modal): place/click a BAY → assign an agent (roster from `opts.agents()` + free-text) → `assignPropAgent`. `rebake()` runs `compileRoutingPlan`; `drawRoutingValidation` paints pulsing RED markers (NO BELT/UNREACHABLE/LOOP!/NO DEFAULT/DUP AGENT) + AMBER (NO AGENT) on the floor before any paid run. A clean no-bay floor shows nothing. |
| `43d3379` | **B4d** | **Roster → picker (minimal).** app.js `Build.init` now passes `agents:()=>[the app agent]` so the picker lists real agents. The bay→agent binding persists via `station.serialize` (prop.agentId round-trips) — no save-schema change needed. The full `{agents,activeAgentId}` multi-agent app registry (multiple real agents, per-agent chat) is a SEPARATE, larger workstream beyond conveyor routing — deliberately out of scope here. |

**B3 + B4 (a/b/b.2/c/d) DONE + committed on agent/workpipe-b, all `npm run test:fast` green (30 files; classify 65, conveyor 50, pipeline 29, worldmodel 136). NOT merged.** The "connect agents to conveyors" vision is functional end-to-end: author bays + filters in REFIT → work sorts by content to the right bay → that agent appears + lights up → the sidecar dispatches the run there → unroutable floors flagged before spend.

| `3a38c54` | **B5** | **Per-bay capability isolation.** worldmodel `CAP_PROP_MAP` (prop→objectType: workstation=compute, cabinet=files, dish=web, server=memory) + `bayObjects(agentId)`. world.js enriches each plan bay with its room's cap-objects (POST dedupe keys on caps too). router `stationFor(agentId)` builds the resolveTools station from those, or null (→ office default). `runOnce` gains optional `o.station`; the hub passes `resolveStation(agentId)` for autonomous bay runs. An UNEQUIPPED bay grants no compute (cost-safe) → build.js shows an amber NO COMPUTE marker. +routing.b5.test (12) + worldmodel 141. |

**PHASE B COMPLETE (B0–B5) + committed on agent/workpipe-b, all `npm run test:fast` green (31 files). NOT merged.** Routing ⊥ capability, both driven by the one placed floor: the bay binding picks WHO runs; the bay room's objects pick WHAT tools (via the unchanged resolveTools); a FILTER sorts work by content; cost-safety ghosts (unroutable + NO COMPUTE) warn before any spend.

### NEXT — merge to trunk (awaiting andro's go-ahead)
- **Merge:** `gen-trees\sync-agent-tree.ps1 workpipe-b` (rebase onto trunk), `npm run test:fast` green, then from
  the integration tree `git merge agent/workpipe-b`, re-gate, ff master, tear down the worktree. Outward-facing
  + shared trunk → CONFIRM with andro first. The whole of B0–B5 is one green branch; mergeable as a unit.
- **Pending live check (nice-to-have, not blocking):** an in-browser click-test of the B4c/B4d picker UI
  (place a bay → picker opens → assign 'coder'). Headless gate + the bayObjects/Pipeline browser evals cover
  the logic; the picker DOM mirrors the proven showGuide modal. Re-test on the `workpipe-b-frontend` preview
  (port 8099) or post-merge: REFIT → PROP/LOGISTICS/BAY → place a bay (picker opens) → assign → place a filter +
  2 bays + equip each room with a console → DM 'research…'/'code…' → each sorts to the right bay + lights up.

### Verifying world.js (browser) — the worktree-served preview
The running `starnet-frontend` preview serves the *integration tree*, NOT this worktree. Added a
`workpipe-b-frontend` launch config (`http-server C:/Users/<you>/gen-trees/workpipe-b/frontend -p 8099`).
world.js is not headless; verify via that preview: `preview_eval` to compile a synthetic floor + check
`Pipeline`/`resolveTarget`, instrument `ctx.fillRect` to confirm bodies drew (screenshots time out on the
continuously-animating canvas). Drive real work via the awakening (which calls `connectChannelBridge`).

## NEXT — B5 (per-bay capability) + merge
- `sidecar/routing/router.js` `route()` builds the per-bay `station` from the delivered bay's room objects
  (`agentRoomId`→room's placed objects) and passes it to `runOnce` (which gains an OPTIONAL `station` param;
  absent = today's hardcoded office). `resolveTools` reused verbatim. `test/capgate.test.js`: a bay-room with a
  cabinet grants fs.*, without one grants none.
- Then `sync-agent-tree.ps1 workpipe-b` (rebase onto trunk), `npm run test:fast` green, `git merge
  agent/workpipe-b` from the integration tree, re-gate, ff master, tear down the worktree. B1–B3 are
  independently mergeable green BEFORE the XL B4 if you want to de-risk.

## Gotchas already discovered
- `worldmodel.migrate()` whitelists prop fields → had to add `agentId` to the whitelist or it drops silently.
- hub `inflight`/supersede must key by **chatId**, not agentId (else routing two chats to one agent cross-cancels).
- `lint-determinism` scans `shared/`+`sidecar/` only; `pipeline.js` was explicitly added to its scan (sidecar-shared).
