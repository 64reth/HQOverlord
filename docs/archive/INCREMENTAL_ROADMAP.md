# Incremental Roadmap

> **StarNet** — converting the v7 fully-simulated pixel-art colony sim into a real, downloadable, gamified AI-agent harness desktop app. This roadmap slices the entire build into the smallest individually-shippable, test-gated steps, ordered to validate the central bet (real agent work on the kept v7 canvas via the U.bus event seam) as early as possible and never take a big risky leap.

---

## A. Universal Definition-of-Done Checklist

**No step is "done" until every box is checked. The next step does not start until the current one is committed green. One step = one revertable commit touching as few files as possible (target ≤ 3).**

1. **Goal met** — the step's one-line goal is demonstrably achieved, nothing more (no scope creep from later steps).
2. **Tests written first / alongside** — the gating test(s) named in the step exist and pass; they fail if the behavior regresses.
3. **Headless-green** — `node` headless suite (`world.behavior`, `validate_map`, `contract`, `save.migrate` as applicable) exits 0.
4. **Contract honored** — any event crossing a process/bus boundary is in `shared/events.js` and passes two-way `validate()`; a lint greps for `U.bus.emit('…')` names absent from the registry and fails on a miss.
5. **Determinism** — no bare `Math.random()` / `Date.now()` in world-model or behavior paths; injected clock + seeded RNG used; a same-seed double-run is byte-identical.
6. **No invariant violated** — walkability, no-strand, no-lost-deliverable, no-double-charge, grids==full-rebuild, doorGraph==reachability all hold after the step.
7. **Save-safe** — if the step changes a persisted shape, it adds a versioned migration rung with its own test and a pre-migration backup; a legacy fixture still loads.
8. **Secrets-safe** — no key / prompt-content / PII reaches logs at info level (redaction test passes); BYOK secret stays in the OS keychain.
9. **Resilient** — the step's error paths are boring and recoverable (dropped malformed event, crashed sidecar, cancelled run, corrupt save) — each logged, no data loss, no stack trace shown to the user.
10. **Visual/smoke clean** — if the frontend is touched: app boots, one run drives, screenshot taken, **zero console errors**, baseline visually unchanged (unless the change is the intent, then baseline updated deliberately).
11. **Revertable & scoped** — one commit, minimal file surface, reverts cleanly.
12. **Polish** — matches the v7 phosphor/CRT fiction; rejections show specific human-readable reasons; UX feels native (instant, no jank, subtle "saved" feedback).

> The fast suite (lint + contract + world.behavior + save.migrate) must stay **< ~10s** so the gate is never skipped under pressure.

---

## B. Phase Sequence

| Phase | Name | Make-or-break outcome | World state |
|-------|------|----------------------|-------------|
| **0** | Browser-first scaffold | Engine port + sidecar + **stub** bridge re-emitting v7 events on U.bus | One fixed room, fake events |
| **1** | The real-agent spine | **One real agent, one fixed room, one working computer, real streaming + real cost (BYOK)** | One fixed room, REAL events |
| **1.5 / 2** | Tauri wrap + onboarding | Desktop shell owns secrets; character creator + gamified first-computer beat | One fixed room, packaged |
| **3** | **THE BUILDER** *(first-class phase)* | Mutable data-driven world, Mutation API, build mode, camera, save versioning, layout=workflow | Mutable, growing, camera |
| **4** | Multi-agent + tool expansion | N agents, full object→capability map, real handoffs, scheduled triggers | Multi-room org graph |
| **5** | Billing + distribution | Managed credits, signed packaging, auto-update | Shipped product |

**Build-order rule:** Phase 1 proves the spine on the *existing* fixed room before any mutable-world work. The full builder is its own phase **after** P1 (locked D8). Steps 0.x → 1.x are the critical path; everything else is additive on the proven seam.

---

## Phase 0 — Browser-First Scaffold (engine port + sidecar + stub bridge)

*Goal of the phase: stand up the contract, the seams, and the discipline so the v7 canvas runs unchanged from a swappable event source — before any real call.*

### 0.0 — Repo + headless harness baseline
- **Goal:** `gen/` boots the v7 frontend verbatim in a browser and the v7 headless tests run from `gen/`.
- **Deliverables:** `gen/` workspace; copied v7 `util.js, map.js, render.js, sprites.js, agents.js, sim.js, ui.js, propterm.js, index.html`; npm scripts for `validate_map` + `test_world`.
- **Port/create:** copy v7 files verbatim; create `package.json`, `gen/test/` wrappers.
- **DoD:** v7 renders pixel-identical in browser from `gen/`; `node validate_map.js` and `node test_world.js` exit 0.
- **Tests:** `validate_map` (layout invariants), `test_world` (walkability + save round-trip + behavior coverage).

### 0.1 — Freeze the event contract
- **Goal:** the entire U.bus/WS vocabulary is defined once and validated.
- **Deliverables:** `shared/events.js` — frozen `EVENTS` registry (all v7 names: `chat, task, sale, deliverable, parcel, flagged, intel, stats, level, day, notify, objectives, party` + reserved `agent.run.*, agent.token, agent.cost, run.cancel, permission.prompt, worldChange, capdenied, route`), `validate(name,payload)`, `SCHEMA_VERSION`.
- **Port/create:** new `shared/events.js`.
- **DoD:** every registered event has one valid + one invalid fixture; malformed payload is dropped+logged, never thrown.
- **Tests:** `contract:*` (per-event valid/invalid); lint that greps `U.bus.emit('…')` names not in `EVENTS`.

### 0.2 — Determinism injection
- **Goal:** world-model + behavior are reproducible.
- **Deliverables:** `makeClock(nowMs)`, `makeRng(seed)`; thread through `WORLD.tick(dt, nowMs, rng)`; ban bare `Math.random`/`Date.now` in `map.js`/`agents.js` core.
- **Port/create:** edit `agents.js`, `map.js`; convert `test_world.js` to seed-driven.
- **DoD:** two same-seed harness runs produce byte-identical coverage stats; a wrong-seed assertion fails loudly.
- **Tests:** `world.behavior` (seeded), `determinism:double-run-equal`; lint bans bare RNG/clock outside sidecar.

### 0.3 — Save envelope + migration ladder (no-op v0→v1)
- **Goal:** every save carries a top-level version and goes through a forward-only ladder, before any shape can change.
- **Deliverables:** `SaveEnvelope{schemaVersion, ...}`, `loadSave/saveSave`, `MIGRATIONS` map, pre-migration backup, `validateSave`.
- **Port/create:** wrap v7 `SIM.serialize/SIM.load` + `idc` counter restore in `sidecar/db/migrate.js`.
- **DoD:** legacy versionless v7 blob loads, writes a backup, lands at CURRENT, round-trips stably; corrupt blob rejected without crash.
- **Tests:** `save.migrate` (legacy→current, corrupt-reject, round-trip-stable), one test per rung.

### 0.4 — Node sidecar skeleton
- **Goal:** a Node process exists that owns IO and speaks the contract over localhost WS.
- **Deliverables:** `sidecar/index.js` (WS server on a chosen port + token), structured **redacting** logger, error boundaries.
- **Port/create:** new `sidecar/`.
- **DoD:** sidecar starts, accepts a WS connection with token, echoes a contract-validated ping; secrets never logged at info.
- **Tests:** `safety:redaction`, `contract:ping`, sidecar start/stop smoke.

### 0.5 — Stub bridge replaces SIM as the event source
- **Goal:** the frontend gets its events from the bridge (still fake), not from in-process `sim.js`.
- **Deliverables:** `bridge.js` — WS client; validates inbound (h2c) then `U.bus.emit(name,payload)`; validates+forwards user actions (c2h). Sidecar runs a **scripted fake** emitting v7-shaped events.
- **Port/create:** new `bridge.js`; sidecar `fakeSource.js`; remove `sim.js` from the boot path (keep file for reference).
- **DoD:** v7 frontend runs identically driven by sidecar-emitted fake events; it cannot tell the source changed; one malformed wire event is dropped, render loop unaffected.
- **Tests:** `contract` round-trip on every emitted name; `smoke:boot-render-clean` (zero console errors); payload-shape contract test per event `agents.js` consumes (e.g. `deliverable{room,agentId}`).

### 0.6 — CI gate + 12-point DoD as an executable check
- **Goal:** "go slow, one verified step" becomes mechanical.
- **Deliverables:** DoD checklist file; CI job running lint + contract + world.behavior + save.migrate + smoke on every commit; merge blocked on red.
- **Port/create:** `.ci/`, `DoD.md`.
- **DoD:** a trivial trial increment passes all 12 points and reverts in one commit; CI red if any suite fails or the surface is too broad.
- **Tests:** the full fast suite green on the trial increment (< 10s).

---

## Phase 1 — The Real-Agent Spine *(make-or-break)*

*Goal of the phase: ONE real agent, in the ONE fixed v7 starter room, sits at ONE working computer and does a REAL OpenRouter streaming call with REAL cost, surfaced truthfully on the kept canvas. BYOK-first, informed-consent per-action, jailed workspace.*

### 1.0 — BYOK key intake into OS keychain
- **Goal:** the user's own OpenRouter key is stored securely and never touches the renderer.
- **Deliverables:** keychain read/write in sidecar; a minimal "paste your key" intake; key validated by a cheap auth probe.
- **Port/create:** `sidecar/secrets.js`.
- **DoD:** key persists in OS keychain across restart; never logged; renderer never receives it; bad key fails with a clear message.
- **Tests:** `safety:redaction` (key absent from logs), keychain round-trip, auth-probe pass/fail.

### 1.1 — OpenRouter provider adapter (recorded-fixture testable)
- **Goal:** a single real model→stream call works and is mockable for CI.
- **Deliverables:** `sidecar/providers/openrouter.js` — chat call, token stream, usage. Record/replay fixture layer at the adapter boundary.
- **Port/create:** new provider module + `fixtures/`.
- **DoD:** a live call streams tokens and returns final usage; CI runs the same path from a recorded fixture with zero spend.
- **Tests:** `contract:agent.token/agent.run.*`, `replayFixture(basic_call)`, live smoke (gated, budgeted).

### 1.2 — RunJob lifecycle + real `task`/`deliverable` events
- **Goal:** a real run emits the same v7 event names the frontend already listens for.
- **Deliverables:** `RunJob` state machine (start→stream→end), emits `task`, `agent.token`, `deliverable` on completion, all contract-validated.
- **Port/create:** `sidecar/run.js`; bridge re-emits onto U.bus.
- **DoD:** a real run drives the v7 agent visuals (paths to seat, `b.working` flips, deliverable floater) with no frontend code change.
- **Tests:** integration `run.start→token→deliverable`; `agents.js` `onDeliverable` fires with correct `{room,agentId}`.

### 1.3 — Real cost accounting + reconciliation
- **Goal:** real credits spent are tracked truthfully, not estimated-and-forgotten.
- **Deliverables:** `agent.cost` event from reconciled final usage (not streamed estimate); a truthful ledger.
- **Port/create:** `sidecar/ledger.js`.
- **DoD:** post-run cost equals provider-reported usage; streamed estimate is reconciled to final; ledger survives restart.
- **Tests:** `agent.cost` reconciliation (estimate vs final), `idempotency:no-double-charge`, ledger round-trip.

### 1.4 — Capability gate (single-room, object-presence)
- **Goal:** the agent may call a tool only if the granting object (the computer) is physically in its room.
- **Deliverables:** `canAgentUse(org, agent, need)` at the tool-dispatch seam (the v7 `INTENTS` router position); `AgentOrg` derived from the one-room fixture.
- **Port/create:** `org/derive.js`, `sidecar/capGate.js`.
- **DoD:** with the computer present the model call runs; remove it and the next run is denied with `capdenied{need}`; no decorative grant ever shown that the sidecar didn't authorize.
- **Tests:** `org/derive` unit (in-room union, out-of-room grants nothing), gate allow/deny, `contract:capdenied`.

### 1.5 — Informed-consent per-action prompt + jailed workspace
- **Goal:** safety defaults — every real action prompts once unless Full Access; files are jailed per-agent.
- **Deliverables:** `permission.prompt`/response over the contract; per-agent jailed workspace dir; per-agent `fullAccess` escalation toggle (off by default).
- **Port/create:** `sidecar/permissions.js`, jailed-fs wrapper.
- **DoD:** a non-fullAccess action prompts exactly once per action; fullAccess skips it; file writes cannot escape the jail; a cancelled prompt fires NO paid action.
- **Tests:** `contract:permission/cancel`, jail-escape rejected, `safety:cancel-runs-nothing-paid`, prompt-fires-once.

### 1.6 — PROPTERM live session on the real computer
- **Goal:** clicking the computer opens the real streaming session, not a fake one.
- **Deliverables:** wire v7 `pw/pwl` PROPTERM window to the live `RunJob` stream.
- **Port/create:** edit `propterm.js`, `ui.js` (consume real stream).
- **DoD:** clicking the computer opens a terminal showing the real token stream + real cost; closing/reopening reattaches.
- **Tests:** integration `click→PROPTERM→live tokens`, `smoke:boot-render-clean`.

### 1.7 — Pull + scheduled triggers (single agent)
- **Goal:** the agent runs on user directive (pull) and optionally on a schedule.
- **Deliverables:** directive entry → `RunJob`; per-agent cron (`scheduled`), autonomy opt-in (off by default, D4).
- **Port/create:** `sidecar/triggers.js`.
- **DoD:** a typed directive starts a real run; a scheduled cron fires one at its time; autonomy stays off unless toggled.
- **Tests:** pull-starts-run, cron-fires-once, autonomy-default-off.

### 1.8 — Spine resilience: crash recovery + kill-switch
- **Goal:** a sidecar crash mid-run never double-charges or loses a deliverable; a kill-switch stops spend.
- **Deliverables:** durable RunJob recovery (v7 `shipQueue` idempotency pattern), kill-switch + spend-backpressure events.
- **Port/create:** `sidecar/recovery.js`.
- **DoD:** kill sidecar mid-run → reload → no double-charge, no lost deliverable; kill-switch halts all paid actions immediately.
- **Tests:** `resilience:crash-recovery`, `idempotency:no-double-charge`, kill-switch-halts-spend.

> **Phase-1 gate (the bet is proven):** a freshly-keyed user issues a directive, the agent paths to its computer, a REAL OpenRouter stream runs, REAL cost is reconciled and shown, and removing the computer truthfully revokes the capability — all on the unmodified v7 canvas.

---

## Phase 1.5 / 2 — Tauri Wrap + Onboarding / Character Creator

*Goal of the phase: move the proven spine into the Tauri desktop shell (sidecar owns secrets) and add the gamified first-run that teaches the entire grammar via the one-tap "place your first computer" beat.*

### 2.0 — Tauri shell wraps the browser app
- **Goal:** the app is a desktop window; the sidecar runs as the bundled Node host.
- **Deliverables:** Tauri project; sidecar spawned/owned by Tauri; webview loads the frontend; WS localhost wiring.
- **Port/create:** `src-tauri/`, sidecar packaging.
- **DoD:** double-click launches a desktop window with the working spine; sidecar lifecycle tied to the window; secrets stay in keychain.
- **Tests:** `smoke:boot-render-clean` in Tauri, sidecar-spawn/teardown, key-stays-in-keychain.

### 2.1 — SQLite persistence (stations + agent identities)
- **Goal:** durable, atomic, multi-slot saves replace the localStorage blob.
- **Deliverables:** `persistence/sqlite.js` — atomic save (WAL), multi-slot, rolling backups, checksum, debounced autosave; agent identities as rows.
- **Port/create:** `sidecar/db/sqlite.js`, wire to `SaveEnvelope`.
- **DoD:** kill-mid-save leaves prior good save intact; corrupt active row falls back to last backup; autosave coalesces a burst into one write; no scenario yields an unloadable station.
- **Tests:** `save.migrate` over SQLite, kill-mid-save fallback, corruption-recovery, autosave-debounce.

### 2.2 — Character creator (Terraria-style agent identity)
- **Goal:** the user creates an agent identity (name, persona, model creds via BYOK).
- **Deliverables:** diegetic creator UI; identity persisted as a DB row; model binding from the keychain key.
- **Port/create:** `ui/creator.js`, reuse `.term` card styling.
- **DoD:** a created agent boots into the starter room with its persona and a real model binding; persists across restart.
- **Tests:** identity round-trip, created-agent-runs-real-call, `smoke`.

### 2.3 — Onboarding: the one-tap "PLACE YOUR CORE" beat *(P1 builder slice)*
- **Goal:** the empty starter room withholds work until the user places the one computer — the tutorial that teaches placement→capability→real work.
- **Deliverables:** a 1-item tray (COMPUTER); ghost preview with snap + green/red validity (`canPlace`); `PlaceCommand` stamps the object, registers seat/work anchor + PROPTERM, marks dirty, re-bakes.
- **Port/create:** minimal `build-mode.js` (single object), `canPlace()`, `World.markDirty()` (3-line `baseCv=null,lightCv=null` hook in `render.js`).
- **DoD:** empty room → "PLACE YOUR CORE" → tap → computer appears → agent paths to seat and does a REAL run; reclaim revokes the capability and the agent stands; persists across reload.
- **Tests:** `place→agent.run.start→arrive(seat)→working`, reclaim-revokes-capability, `canPlace` (on-wall red, in-room green, strands-seat red), grid-checksum stable after place/reclaim.

### 2.4 — Onboarding flow + truthful first telemetry
- **Goal:** the first run feels guided and the screens show real state from the first second.
- **Deliverables:** staged onboarding sequence (key → create → place core → first directive → watch real work); "saved" indicator.
- **Port/create:** `ui/onboarding.js`.
- **DoD:** a brand-new user reaches a real streaming run in a guided flow with zero console errors; every shown number is real.
- **Tests:** end-to-end onboarding smoke, no-fake-telemetry assertion.

---

## Phase 3 — THE BUILDER *(first-class phase: mutable, data-driven, growing world)*

*Goal of the phase: replace v7's bake-once / fixed-buffer / camera-less / literal-furniture model with the canonical mutable `Station` document behind a closed Mutation API, a chunked renderer with a camera, versioned SQLite saves, and build mode — making the station layout the spatial diagram of the real agent org. This is "The Builder."*

### 3.0 — Read-only world model parity (single fixed chunk set)
- **Goal:** the new internal representation drives the existing world behind v7-identical accessors.
- **Deliverables:** `world/model.ts` + `world/chunks.ts` loading the v7 layout as seed; expose `roomAt/walkable/canStep/path/propAt/sitAt/randomSpotIn`.
- **Port/create:** new modules; port v7 `idx()`/grid math to chunk-local.
- **DoD:** for all tiles in v7 bounds, `model.walkable===MAP.walkable` and `model.roomAt===MAP.roomAt`; `validate_map` invariants green.
- **Tests:** byte-for-byte parity diff vs v7 MAP; ported `validate_map`.

### 3.1 — Incremental derive layer
- **Goal:** grids are surgically patched from dirty rects, never rebuilt wholesale.
- **Deliverables:** `world/derive.ts` — `applyDirtyTiles()` patches `floorOwner/zoneId/blockMask/objectId/sitTiles/doorSet`.
- **Port/create:** refactor v7 grid-fill loops from "fill once" to "fill these tiles."
- **DoD:** incremental grids equal a from-scratch full rebuild across 1000 fuzzed dirty rects; `doorSet`/`doorGraph` match.
- **Tests:** property test incremental-vs-full (fuzz 1000).

### 3.2 — Mutation API: placeObject / removeObject
- **Goal:** the simplest closed-mutation pair, validated, with patches.
- **Deliverables:** `world/mutations.ts` (object ops) emitting `worldChange` `WorldPatch{dirtyTiles,dirtyChunks,inverse}`.
- **Port/create:** new module + U.bus `worldChange` emission.
- **DoD:** place→remove round-trips to identical serialization; patch dirtyTiles exactly cover the footprint; invalid placement rejected with no mutation.
- **Tests:** round-trip, dirty-rect-exact, reject-on-blocked/void/wrong-kind, post-op full-rebuild comparison.

### 3.3 — Undo / redo over object commands
- **Goal:** native-feeling undo via recorded inverses through the Mutation API.
- **Deliverables:** `world/history.ts` — two stacks, drag-coalescing.
- **Port/create:** new module.
- **DoD:** random place/move/remove then undo-all → byte-identical `SaveDoc`; redo-all → post-sequence state; a paint-drag is one undo entry; stacks balanced.
- **Tests:** property `random-ops→N-undos==checkpoint`; coalescing-single-entry.

### 3.4 — Room + door mutations with validators
- **Goal:** add/remove/move/resize rooms and place doors/hallways without ever orphaning the spawn room or stranding a seat.
- **Deliverables:** `mutations.ts` (room/door ops) + `validate.ts` (overlap, connectivity, walkability, capability-legality); incremental `doorGraph`.
- **Port/create:** new modules; reuse v7 zone-rect shape.
- **DoD:** addRoom+placeDoor connects both rooms (doorGraph==path()); removeRoom that orphans spawn is rejected; moveRoom updates only old+new tiles; rejected commands no-op.
- **Tests:** connectivity==BFS reachability, orphan-reject, strand-seat-reject, moveRoom-tile-scope.

### 3.5 — Versioned serialization + migration chain
- **Goal:** the Station document is versioned and migratable; derived state rebuilt deterministically on load.
- **Deliverables:** `world/serialize.ts` (`toSaveDoc`/`fromSaveDoc`) + `migrations/` + checksum.
- **Port/create:** replaces `SIM.serialize/load` conceptually.
- **DoD:** serialize→fromSaveDoc→serialize stable; a hand-written v(N-1) fixture migrates and boots passing all invariants; truncated JSON caught by checksum.
- **Tests:** round-trip-stable, old-fixture-migrates, corrupt-detect.

### 3.6 — SQLite station persistence (builder-grade)
- **Goal:** the mutable station saves atomically with rolling backups, debounced on `worldChange.seq`.
- **Deliverables:** extend `persistence/sqlite.js` for the Station doc; multi-slot; corruption fallback.
- **Port/create:** wire autosave to seq advance.
- **DoD:** no save scenario yields an unloadable station; corruption always recovers to the most recent valid backup; autosave invisible and never blocks a frame.
- **Tests:** kill-mid-save, corruption-fallback, autosave-debounce.

### 3.7 — Identity camera + dpr-aware backing store
- **Goal:** insert the one coordinate transform with zero visual change.
- **Deliverables:** `Camera{wx,wy,zoom}`; `frame()` calls `Camera.apply(ctx,dpr)`; `toLocal`→`Camera.screenToWorld`; backing store = css*dpr.
- **Port/create:** new `Camera`; edit `render.js`.
- **DoD:** golden-image diff P3.7==v7 within AA tolerance at dpr 1 and 2; clicks/hovers still hit the right prop/agent; no controls exposed.
- **Tests:** screenToWorld/worldToScreen inverses, worldToTile matches `floor(p/T)`, render-hash unchanged.

### 3.8 — bakeRegion seam + Scene draw-list (still single-chunk)
- **Goal:** quarantine the bake-once obstacle behind a region entry point and cull the y-sort feed.
- **Deliverables:** `buildBase/buildLightMap`→`bakeRegion(rect,ctx)` (no globals); `frame()` uses `Scene.itemsInView`.
- **Port/create:** refactor `render.js` bake fns; new `Scene`.
- **DoD:** output pixel-identical; y-sort / work-tile / sitPy byte-for-byte same; `bakeRegion` idempotent.
- **Tests:** Scene-order==v7-inline, bake-twice-identical.

### 3.9 — Real chunk grid (CHUNK=24, apron, lazy bake, cull)
- **Goal:** shatter the monolithic buffer into per-chunk base+light canvases, baked lazily, culled to the viewport.
- **Deliverables:** `ChunkStore` with per-chunk base+light; `frame()` draws `visibleChunks`; light continuity via apron + neighbor source list.
- **Port/create:** `world/chunks.ts` + `render/chunkBaker.ts` (reuse all bake fns clipped to chunk+apron).
- **DoD:** a 4×-larger world draws only viewport chunks (drawImage count ≈ visible); no seam artifacts in floor/wall/light; pixel-diff vs v7 seed identical.
- **Tests:** chunk-of-tile math, visibleChunks==brute-force, seam-continuity, perf-flat-as-world-grows.

### 3.10 — Dirty re-bake wired to worldChange
- **Goal:** an edit re-bakes only its 1–4 chunks, never the whole station.
- **Deliverables:** `ChunkStore.markDirtyTiles` + subscriptions to `worldChange.dirtyChunks`; per-frame bake budget.
- **Port/create:** edit `chunkBaker.ts`.
- **DoD:** placing a prop re-bakes exactly its chunks (assert count); an edit in chunk A never alters chunk C pixels; big edits spread across frames stay 60fps.
- **Tests:** dirty-set-exact, cross-chunk-isolation, bake-budget-holds-fps.

### 3.11 — Camera controls (pan / snapped zoom / follow / clamp)
- **Goal:** the station is navigable and crisp.
- **Deliverables:** `InputController` drives Camera; drag/edge pan, integer-snapped zoom, double-click follow, clamp.
- **Port/create:** edit input layer.
- **DoD:** zoom stays pixel-crisp at each snap; pan smooth + clamped; follow centered without jitter; hit-testing correct at every zoom/pan.
- **Tests:** clamp ⊆ world, zoom-snap-ladder, screenToWorld-round-trip-after-pan+zoom.

### 3.12 — Build-mode REFIT overlay + tool state machine
- **Goal:** the diegetic full-screen build mode with PLACE/PAINT/ROUTE/MOVE/RECLAIM/UNDO.
- **Deliverables:** `BuildOverlay` (world-space, above lightmap): grid, ghost, validity tint, room outlines, hover; `RENDER.setMode('play'|'build')`.
- **Port/create:** expand `build-mode.js`.
- **DoD:** ghost snaps + tints green/red by validity even in an unlit new room; overlays align under any zoom/pan; play mode costs nothing.
- **Tests:** ghost-validity==walkable/footprint rules, overlay-alignment, zero-cost-when-off.

### 3.13 — PAINT + drag-to-draw room / hallway
- **Goal:** the user paints floors/walls and drags out new rooms and connecting hallways.
- **Deliverables:** `PaintCommand` (batched), `DrawRoomCommand`, `DrawHallCommand` (adds RouteEdge → doorSet → canStep).
- **Port/create:** mutations + commands.
- **DoD:** painting rebakes only touched chunks; a dragged hallway makes an agent able to path between rooms; reachability invariant holds after every draw.
- **Tests:** addRoom-no-overwrite, addRoute-makes-canStep-true-only-there, path-through-new-hallway, batched-paint-one-undo.

### 3.14 — Tier system (shabby → glorious as a parameter)
- **Goal:** room/object tier modulates wear/glow/lighting — no new sprites.
- **Deliverables:** `obj.tier`/`room.tier` read in `F{}` `wear()/glow()` + hull pass; `TierUpCommand` with a one-shot lightmap flare.
- **Port/create:** hooks in `sprites.js` + `render.js`.
- **DoD:** tier-0 visibly grimier/dimmer; tier-up brightens emissives WITHOUT swapping sprites; flare goes through the lightmap, not a repaint; geometry pixels identical across tiers.
- **Tests:** visual-regression geometry-identical-across-tiers, palette validators pass.

### 3.15 — Station economy (Salvage + Station XP from REAL outcomes)
- **Goal:** the build currency is minted only by real work shipped + real credits spent.
- **Deliverables:** `economy.js` subscribes to `deliverable`/`agent.run.end`; catalog gating; charge/refund on commands.
- **Port/create:** repoint v7 `sim.js` milestone-curve shape from fake revenue to real events.
- **DoD:** shipping a real deliverable increments Salvage + XP (floater); a game-minute tick mints NOTHING; unaffordable catalog entry shows a clear "need X salvage" state; XP uses reconciled final usage.
- **Tests:** mint-only-on-real-events, gating-below-level/cost, reconciled-not-estimate.

### 3.16 — LRU chunk eviction
- **Goal:** memory stays bounded as the station grows.
- **Deliverables:** LRU eviction of offscreen chunks past a budget; lazy re-bake on revisit.
- **Port/create:** edit `ChunkStore`.
- **DoD:** live-canvas count ≤ budget under a 200-chunk world; revisiting an evicted chunk re-bakes identically to its pre-eviction pixels.
- **Tests:** memory-bounded-200-chunks, evict-then-revisit-pixel-identical.

### 3.17 — Full headless builder fuzz surface
- **Goal:** hours of fuzzed edits + agent ticks gate every invariant continuously.
- **Deliverables:** `test/world.headless.ts` — random builder sessions interleaved with `WORLD.tick`.
- **Port/create:** successor to `test_world.js`.
- **DoD:** hours of fuzzing produce zero invariant violations (no agent on unwalkable tile, grids==full-rebuild, doorGraph==reachability, undo-to-empty works, saves round-trip stable); this gates CI for every world change.
- **Tests:** the fuzz harness itself.

---

## Phase 4 — Multi-Agent + Full Object→Tool Expansion

*Goal of the phase: scale the proven N=1 graph to N agents / N rooms with real handoffs and the full capability catalog — the same schema, only cardinality changes.*

### 4.0 — Second room + second agent (placement = team)
- **Goal:** a second agent in a second room derives its own capability set.
- **Deliverables:** multi-room `AgentOrg` derivation; `assignAgentToRoom`.
- **Port/create:** extend `org/derive.ts`, `mutations.ts`.
- **DoD:** dragging an agent's desk into a room sets its team and tools; each agent's capability = union of its room's grant-objects.
- **Tests:** per-agent capability union, reassign-changes-tools, validator-forbids-homeless-agent.

### 4.1 — Full object→capability catalog
- **Goal:** the complete tiered buildables map objects to shell/files/web/image/comms.
- **Deliverables:** `CatalogEntry` registry with `grants`, `unlockAt`, `cost`, `allowedRoomKinds`; diegetic tray with ghosted locked entries.
- **Port/create:** `catalog.js`; draw icons from `F{}` into offscreen canvases.
- **DoD:** placing each object type grants its capability in-room; locked entries shown as destiny silhouettes; deterministic merge rule when two objects grant the same capability with different config.
- **Tests:** per-type grant, gating, merge-rule-determinism.

### 4.2 — PipelineEdge + door-gated runnability
- **Goal:** a handoff A→B is runnable only if the door graph connects their rooms.
- **Deliverables:** `PipelineEdge`; `deriveAgentOrg` marks edges RUNNABLE via reachability; loud "severed" signal when a corridor is cut.
- **Port/create:** extend `org/derive.ts`.
- **DoD:** edge RUNNABLE only with a door path; removing the door flips it un-runnable with a legible UI reason.
- **Tests:** runnable-iff-doorpath, sever-flips-unrunnable, UI-reason-shown.

### 4.3 — Real handoff carry (artifact rides the corridor)
- **Goal:** a real deliverable is carried room-to-room and becomes the recipient's input.
- **Deliverables:** handoff router/carry sequencer; cross-room parcel along `RouteLane`; recipient runs on it.
- **Port/create:** generalize v7 `onDeliverable`/`parcels`/belt + plan-sequencer.
- **DoD:** a two-agent pipeline runs a real handoff end-to-end; the carry uses real path; severing connectivity disables it; no schema rewrite needed (N=2 of the same graph).
- **Tests:** handoff-end-to-end, carry-arrives-at-seat, route-event-drives-parcel.

### 4.4 — Scheduled cross-room triggers + per-room/per-edge policy
- **Goal:** scheduled jobs and routing policies operate across the org.
- **Deliverables:** per-room `trigger.cron`, per-edge handoff policy, autonomy per-agent.
- **Port/create:** extend `triggers.js`.
- **DoD:** a scheduled job fires a real run in the right room; routing policy gates handoffs; autonomy still opt-in.
- **Tests:** cron-fires-in-room, policy-gates-handoff, autonomy-default-off.

### 4.5 — Org validator gate (graph↔org invariants)
- **Goal:** no partial/invalid AgentOrg snapshot ever reaches the sidecar.
- **Deliverables:** headless org validator (every agent seated in a real room, every grant resolves, every edge runnable-or-flagged).
- **Port/create:** extend `validate_map`→org asserts.
- **DoD:** an invalid snapshot is rejected before the sidecar accepts it; CI exits non-zero on violation.
- **Tests:** seat-exists, grant-resolves, edge-runnable-or-flagged.

---

## Phase 5 — Managed Credits / Billing + Signed Packaging / Distribution

*Goal of the phase: add the managed $50/mo credits path alongside BYOK, then sign, package, and ship with safe auto-update.*

### 5.0 — Managed-credits path (alongside BYOK)
- **Goal:** users can spend managed credits instead of their own key.
- **Deliverables:** managed-credit balance, spend metering, backpressure when exhausted; BYOK remains the default.
- **Port/create:** `sidecar/billing.js`.
- **DoD:** a managed run debits the balance; exhaustion blocks further spend with a clear message; BYOK and managed are cleanly selectable per agent.
- **Tests:** debit-on-run, exhaustion-backpressure, byok-vs-managed-isolation.

### 5.1 — Spend caps + truthful billing telemetry
- **Goal:** the user always sees real spend and can cap it.
- **Deliverables:** per-agent/global spend caps, real-time spend HUD, hard kill at cap.
- **Port/create:** extend ledger + HUD.
- **DoD:** hitting a cap halts paid actions immediately; the HUD shows reconciled real spend, never an estimate-as-final.
- **Tests:** cap-halts-spend, HUD-shows-reconciled.

### 5.2 — Atomic auto-update with save-survival
- **Goal:** app updates never brick a customer's station.
- **Deliverables:** atomic-bundle auto-update (frontend+sidecar together); migration runs on first launch; pre-migration backup.
- **Port/create:** Tauri updater config + migration boot hook.
- **DoD:** an update opens the station exactly as left; a failed migration restores from backup; frontend and sidecar update atomically.
- **Tests:** update-preserves-station, failed-migration-restores, atomic-bundle.

### 5.3 — Code signing + notarization + installers
- **Goal:** trusted, installable signed builds per platform.
- **Deliverables:** signed/notarized installers; first-run security passes cleanly.
- **Port/create:** CI signing pipeline.
- **DoD:** installers are signed/notarized and launch without OS security warnings; sidecar binary is signed.
- **Tests:** signature-verify, notarization-check, clean-first-run smoke.

### 5.4 — Release smoke + visual baseline gate
- **Goal:** every release is verified end-to-end before ship.
- **Deliverables:** packaged-app smoke: boot → key → create → place core → real run → screenshot → zero console errors.
- **Port/create:** release CI job.
- **DoD:** the packaged build passes the full end-to-end smoke with a clean baseline; release blocked on red.
- **Tests:** packaged-end-to-end smoke, visual-baseline-diff.

---

## C. Critical-Path Note

The make-or-break sequence is **0.1 → 0.5 → 1.1 → 1.2 → 1.3 → 1.4** (contract → stub bridge → real adapter → real run events → real cost → capability gate). If that chain is green, the central bet — *real agent work re-emitted on the kept v7 U.bus, gated by physical object presence* — is proven, and every subsequent phase is additive on a seam that already works. The Builder (Phase 3) is deliberately deferred until after that proof, and its riskiest detail (replacing bake-once) is isolated behind the `bakeRegion`/`markDirty` seam introduced as a no-op in 2.3 and 3.8 before it carries real weight in 3.9–3.10.