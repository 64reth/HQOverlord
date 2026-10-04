# Builder Foundation — Pillar Designs

_Five parallel design tracks (2026-06-13): world model, builder UX, renderer/camera, station-as-workflow, engineering foundation. Raw material behind BUILDER_AND_WORLD_FOUNDATION.md._

## World-Model Architecture — the canonical, mutable, serializable Station model that the renderer, agents, builder, capabilities, and save files all sit on. Replaces v7's bake-once, fixed-buffer, camera-less, literal-furniture map.js.

The station becomes a single authoritative `Station` document — a sparse, chunked tile world with first-class `Room`, `Door`, and `ObjectInstance` entities — owned by one module behind a closed Mutation API. Every legal change goes through a command (`addRoom`, `paintFloor`, `placeObject`, …) that validates, applies, records an inverse for undo, and emits a typed `worldChange` patch carrying dirty rectangles. Derived indices (zoneGrid, walk/block, sitTiles, object-hit, door graph) are NEVER rebuilt wholesale; they are surgically patched from the same dirty rects, and the renderer's #1 enemy — the monolithic bake-once `baseCv` — is replaced by a per-chunk bake cache keyed by content-hash so only touched chunks re-bake. The model is the spatial source of truth for the user's real multi-agent org: rooms are capability zones, doors/hallways are routing edges, objects are agent capabilities. It is versioned, migration-ready, and atomically persisted to SQLite so it survives app updates and crashes. The hybrid choice — rect-anchored rooms whose authoritative truth is a per-tile `floorOwner` grid — is what keeps it from ever being painted into a corner: rectangles give cheap UX and validation, the tile grid gives unlimited free-form expansion.

**Decisions**

- **HYBRID room model: a Room is a logical entity with a `footprint` (set of rect parts) for UX/serialization, but the authoritative geometry is the per-tile `floorOwner: Int32Array (chunked)` mapping tile -> roomId. Free-tile painting edits the footprint as a rect-decomposition.** — Pure rect-rooms (v7's `zones{}`) make L-shapes, station-builder paint, and irregular growth impossible and are the thing we were told to kill. Pure free-tile loses the cheap 'which room is this / does this overlap' semantics agents and validation need. Anchoring truth in the tile grid while keeping a rect-decomposition cache gives both: O(1) `roomAt(tile)`, rect-fast overlap pre-checks, and unlimited shapes. The rect parts are derived/maintained, never the source of truth for collisions. _(alt: (a) Keep rect-only zones (v7) — rejected, cannot express the builder. (b) Pure bitmap/tilemap with no Room objects — rejected, loses team/zone semantics and makes capability-mapping and serialization verbose. (c) Polygon footprints — rejected, overkill vs tile grid, hard to validate walkability.)_
- **CHUNKED sparse world: 16x16-tile chunks in a hashmap `chunks: Map<"cx,cy", Chunk>`, each holding typed-array layers (floor, floorOwner, blockMask, objectId, zoneId). World is unbounded; chunks are created on demand and pruned when fully empty.** — v7's fixed `W=936 x H=674` single buffer is the hard ceiling on 'shabby -> glorious' expansion and forbids a camera. Chunks make the world conceptually infinite, make the bake cache naturally per-chunk (killing the bake-once problem), make dirty-region tracking trivial (a chunk is the unit of invalidation), and make a viewport/camera a pure read of 'which chunks intersect the view'. Typed arrays per layer keep per-tile reads as fast as v7's flat arrays. _(alt: (a) One expandable canvas that grows on demand — rejected, every grow is a full re-bake and a coordinate reflow, exactly v7's trap at larger scale. (b) Flat dynamic Int arrays resized on grow — rejected, resize = full copy + index shift, breaks all cached indices. (c) Quadtree — rejected, premature; fixed-size chunks give O(1) tile access which a quadtree can't.)_
- **WORLD COORDINATES are signed tile integers (tx,ty) with no fixed origin; pixel = tile*TILE. A `Viewport{camX,camY,zoom}` is a separate read-only concept layered on top. Foot-anchor math (`px=tx*T+T/2, py=ty*T+T-1`) is preserved verbatim so agents.js needs no change.** — Decouples the model from any buffer size and bakes in camera/pan/zoom support 'for later' without a migration. Keeping the exact foot-anchor formula means agents.js bodies (px,py,tile,path) port unchanged — we only swap what `MAP.walkable/canStep/path` read under the hood. _(alt: Origin-locked unsigned coords (v7) — rejected, expansion to the north/west would require renumbering every tile and every saved object.)_
- **CLOSED Mutation API + Command objects. The `Station` fields are not written directly by any caller; the only mutators are command functions that return a `MutationResult{ok, error?, patch?, inverse?}`. Each command produces (1) a validation verdict, (2) a forward apply, (3) a recorded inverse for undo, (4) a `WorldPatch` describing dirty tiles/chunks and entity deltas.** — This is the single most important anti-corner decision: with one chokepoint we can enforce every invariant (overlap, connectivity, walkability, capability legality), keep undo/redo correct by construction, and guarantee the renderer/agents never see a half-applied world. It also gives us a natural network/IPC boundary for the Tauri+sidecar split and a replayable audit log. _(alt: Direct field mutation with manual event emits (v7's implicit style) — rejected, every new feature risks forgetting to update a derived index or emit an event; impossible to add undo retroactively.)_
- **DERIVED indices are incrementally maintained, never rebuilt. Every command's `WorldPatch.dirtyTiles` drives surgical updates to: `zoneId` layer, `blockMask` layer, `sitTiles` set, `objectId` hit layer, and the `doorGraph` (rooms = nodes, doors/hallways = edges) which is updated by add/remove of door entities only.** — v7 rebuilds nothing at runtime because it bakes once — but that's why it can't change at runtime. The builder demands runtime edits, and a full rebuild of grids+graph on every furniture drag would jank. Patching only the touched tiles makes a place/move/remove O(footprint), not O(world). _(alt: Full recompute on each edit (simple) — rejected on perf and because it scales with station size, contradicting the 'grow large' goal. Lazy/dirty-flag recompute on read — rejected, agents path every tick and need O(1) reads.)_
- **PER-CHUNK BAKE CACHE replaces the monolithic `baseCv`. `render` keeps an LRU `Map<chunkKey, {canvas, hash}>`. A chunk re-bakes only when its content-hash (floor+wall+door+object-static contributions) changes, signalled by `worldChange` patches intersecting that chunk. Lighting bakes into a parallel per-chunk light cache.** — Directly defeats the stated #1 obstacle. We don't fight v7's bake-once; we shard it. Editing one room dirties ~1-4 chunks, re-bakes only those, and composites all visible chunk canvases in draw order. This is also what makes a large scrolling station affordable. _(alt: Keep one big buffer + a dirty-rect blit API on it — viable but rejected: resizing it on world-grow reintroduces the fixed-size trap and a full-buffer realloc; per-chunk caching gets growth for free.)_
- **SERIALIZATION: versioned JSON document `{schema:'starnet.station', version:N, ...}` stored in SQLite (one row per save slot in a `stations` table: id, version, json, updatedAt, plus an `assets` blob table). Saves are atomic (write to temp row / WAL, swap), with a rolling backup of the last K good saves and a checksum for corruption detection. A linear `migrations[]` chain upgrades vN -> vN+1 on load.** — Ships to paying customers; saves MUST survive app updates and crashes. SQLite gives us atomic transactions, WAL durability, and easy multi-slot/backup management that a bare JSON file can't. Storing the canonical doc as JSON inside SQLite keeps the model human-debuggable and trivially migratable while getting DB-grade durability. The version field + migration chain means an old save always boots on a new app. _(alt: (a) Single localStorage/JSON blob (v7) — rejected, no atomicity, no backups, corrupts on partial write, size-limited. (b) Fully normalized relational schema (rooms/objects as rows) — rejected for P1, premature; it complicates migrations and the model is small enough to hold as one document. Can normalize later behind the same Mutation API.)_
- **Validation is layered: cheap rect/AABB pre-checks reject obvious overlaps before touching tiles; tile-level checks enforce walkability and footprint legality; graph-level checks enforce connectivity (no room orphaned from the spawn room). Commands are transactional — validate fully, then apply, so a rejected command never half-mutates.** — Lets the builder give instant red/green placement feedback (rect check) while still guaranteeing deep invariants (a removed door can't strand an agent's only path). Transactional apply keeps the world always-valid, which the headless test surface then gates. _(alt: Apply-then-check-then-rollback — rejected, rollback is error-prone and can briefly emit invalid state to listeners.)_

**Data structures**

- // ---- Core constants (TILE preserved from v7; world is now unbounded) ----
const TILE = 12, CHUNK = 16; // 16x16 tiles per chunk; chunk pixel size = 192
const chunkKey = (cx, cy) => cx + ',' + cy;
const tileToChunk = (tx, ty) => [Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)];
- // ---- Station: the authoritative document ----
interface Station {
  schema: 'starnet.station';
  version: number;                 // save-format version, drives migrations
  id: string;                      // save-slot / station id
  meta: { name: string; createdAt: number; tier: number; spawnRoomId: string; };
  rooms: Record<RoomId, Room>;
  doors: Record<DoorId, Door>;     // doors AND hallway segments (kind discriminates)
  objects: Record<ObjId, ObjectInstance>;
  bounds: { minTx:number; minTy:number; maxTx:number; maxTy:number }; // derived AABB of all floor
  // NOTE: chunks/grids below are runtime-derived, NOT serialized verbatim —
  // they are rebuilt deterministically from rooms/doors/objects on load.
}
- // ---- Room: hybrid rect-footprint + tile-truth ----
interface Room {
  id: RoomId;
  name: string;
  kind: RoomKind;                  // 'bridge'|'research'|'factory'|'quarters'|'corridor'|... = capability zone type
  tier: number;                    // 0=shabby ... N=glorious; drives bake style
  footprint: Rect[];               // 1+ inclusive tile rects; union = the room (supports L/T shapes)
  floorStyle: FloorStyleId;        // paintable; per-tile overrides live in floorPaint
  wallStyle: WallStyleId;
  floorPaint?: Record<string,FloorStyleId>; // sparse 'tx,ty' overrides from the paint tool
  capabilities: CapabilityId[];    // zone-level caps granted to agents assigned here
  agentIds: AgentId[];             // which real agents are 'stationed' in this room
}
interface Rect { x1:number; y1:number; x2:number; y2:number; } // inclusive, like v7
- // ---- Door / Hallway: the routing edges of the org graph ----
interface Door {
  id: DoorId;
  kind: 'door' | 'hallway';        // door = 1-2 tile threshold; hallway = a thin corridor Room-lite
  a: RoomId; b: RoomId;            // the two zones it connects (b may be a hallway room)
  edges: [number,number,number,number][]; // adjacent tile pairs [x1,y1,x2,y2], same shape as v7 doorDefs
  open: boolean;                   // closed door = routing handoff gate (agents need permission)
  routePolicy?: RoutePolicyId;     // handoff/routing config this door represents
}
- // ---- ObjectInstance: furniture AND capability surface ----
interface ObjectInstance {
  id: ObjId;
  type: ObjTypeId;                 // key into the F{} draw-table + ObjectDef registry
  tx:number; ty:number; w:number; h:number; // footprint origin+size (tiles)
  dir: 0|1|2|3;                    // rotation (new vs v7's static literals)
  roomId: RoomId;                  // owning room (for capability scoping)
  flags: { blocking:boolean; sit:boolean; deco:boolean; work:boolean }; // from ObjectDef, overridable
  pw?: { panelId:string; label:string }; // interactive prop terminal (v7 pw/pwl)
  capability?: CapabilityId;       // THIS is the object->capability mapping (e.g. 'shell','web','image')
  stationFor?: AgentId;            // if this is an agent's workstation seat
  state?: Record<string,any>;      // runtime visual state (screen on/off, parcel count)
}
- // ---- ObjectDef registry (static, code-defined; objects reference by type) ----
interface ObjectDef {
  type: ObjTypeId; w:number; h:number;
  defaults: { blocking:boolean; sit:boolean; deco:boolean; work:boolean };
  draw: (ctx,inst)=>void;          // the F{} entry
  capability?: CapabilityId;       // default capability this object grants
  allowedRoomKinds?: RoomKind[];   // builder placement rule
}
- // ---- Chunk: runtime derived per-tile layers (typed arrays, never serialized) ----
interface Chunk {
  cx:number; cy:number;
  floor:      Uint16Array;  // floorStyle id per tile (0 = no floor / void)
  floorOwner: Int32Array;   // roomId-index per tile, -1 = void  (authoritative 'roomAt')
  zoneId:     Int32Array;   // == floorOwner but corridor/hallway tagged; mirrors v7 zoneGrid
  blockMask:  Uint8Array;   // 1 = impassable (wall/blocking object/chamfer) ; mirrors v7 blocked
  objectId:   Int32Array;   // ObjId-index occupying this tile for hit-test ; mirrors v7 pwGrid
  contentHash:number;       // bake-cache key: hash(floor+walls+doors+static objects)
  dirty:boolean;            // set by patches; renderer re-bakes lazily
}
- // ---- Derived global indices (incrementally maintained) ----
interface Derived {
  chunks: Map<string, Chunk>;
  sitTiles: Set<string>;           // 'tx,ty' -> sittable (v7 sitTiles)
  doorSet:  Set<string>;           // 'x1,y1>x2,y2' crossable edges (v7 doorSet)
  doorGraph: Map<RoomId, Set<RoomId>>; // connectivity graph for routing + orphan checks
  roomIndex: RoomId[];             // index<->roomId for the Int32 floorOwner arrays
  objIndex:  ObjId[];              // index<->objId for the Int32 objectId arrays
}
- // ---- WorldPatch: every mutation emits exactly one ----
interface WorldPatch {
  seq:number;                      // monotonic; lets renderer/agents detect missed patches
  ops: PatchOp[];                  // entity-level deltas: {kind:'room'|'door'|'object', op:'add'|'update'|'remove', id, before?, after?}
  dirtyTiles: Rect[];              // tile rects whose grids changed
  dirtyChunks: string[];           // chunk keys to invalidate/re-bake (derived from dirtyTiles)
  reindex: boolean;                // true if room/door graph topology changed (agents re-path)
}
- // ---- MutationResult ----
interface MutationResult { ok:boolean; error?:ValidationError; patch?:WorldPatch; inverse?:Command; }
type Command = { name:string; args:any }; // serializable -> enables replay + undo stack + sidecar IPC
- // ---- Save document on disk (SQLite row 'json' column) ----
// stations(id TEXT PK, version INT, json TEXT, checksum TEXT, updatedAt INT)
// station_backups(id TEXT, slot TEXT, version INT, json TEXT, savedAt INT) -- last K good saves
interface SaveDoc { schema:'starnet.station'; version:number; station:StationSerialized; }
// StationSerialized = Station minus derived (chunks/grids/indices); only rooms/doors/objects/meta.

**APIs / interfaces**

- // ---- Read surface (v7-compatible, so renderer/agents port unchanged) ----
- model.roomAt(tx,ty): RoomId|'corridor'|null
- model.walkable(tx,ty): boolean   // zoneId!=void && !blockMask
- model.canStep(x1,y1,x2,y2): boolean // same-zone OR doorSet.has(edge)
- model.path(sx,sy,tx,ty): {x,y}[]|null  // BFS over chunks, same return shape as v7
- model.propAt(tx,ty): ObjectInstance|null  // objectId layer + 1-tile-south overhang (v7 behavior)
- model.sitAt(tx,ty): boolean
- model.randomSpotIn(roomId, tries): {x,y}|null
- model.chunksInView(camX,camY,w,h,zoom): Chunk[]  // powers the future camera
- model.bounds(): {minTx,minTy,maxTx,maxTy}
- // ---- Mutation API (only legal writers; all return MutationResult) ----
- mut.addRoom({kind, footprint:Rect[], floorStyle, tier}): MutationResult
- mut.removeRoom(roomId): MutationResult   // rejected if it orphans the spawn room or a stationed seat
- mut.moveRoom(roomId, dTx, dTy): MutationResult
- mut.resizeRoom(roomId, newFootprint:Rect[]): MutationResult
- mut.paintFloor(roomId, tiles:Rect[]|('tx,ty')[], styleId): MutationResult
- mut.placeHallway({a:RoomId, b:RoomId, path:('tx,ty')[], width}): MutationResult
- mut.placeDoor({a, b, edges}): MutationResult / mut.setDoorOpen(doorId, open)
- mut.placeObject({type, tx, ty, dir, roomId}): MutationResult  // validates footprint void + room-kind legality
- mut.moveObject(objId, tx, ty, dir): MutationResult
- mut.rotateObject(objId, dir): MutationResult
- mut.removeObject(objId): MutationResult
- mut.assignAgentToRoom(agentId, roomId): MutationResult
- mut.setObjectCapability(objId, capabilityId): MutationResult  // the object->capability control surface
- // ---- History ----
- history.undo(): MutationResult / history.redo(): MutationResult / history.canUndo(): boolean
- // ---- Serialization & persistence ----
- serialize.toSaveDoc(station): SaveDoc
- serialize.fromSaveDoc(doc): Station   // runs migrations + rebuilds derived/chunks
- migrations.register(fromVersion, fn:(doc)=>doc)
- sqlite.save(slot, station): Promise<void>  // atomic, debounced, checksummed, rolls a backup
- sqlite.load(slot): Promise<Station>  // verifies checksum, falls back to last good backup on corruption
- sqlite.listSlots()/sqlite.backupsFor(slot)
- // ---- Events (on U.bus) ----
- emit 'worldChange' (patch:WorldPatch)   // NEW: renderer marks dirtyChunks, agents re-path if patch.reindex
- // + re-emits ALL existing v7 names unchanged: 'chat','sale','parcel','deliverable','task','stats','level','notify','objectives','party',...
- // renderer: bus.on('worldChange', p => { for(k of p.dirtyChunks) bakeCache.invalidate(k); })
- // agents:   bus.on('worldChange', p => { if(p.reindex) WORLD.repathAll(); })

**Components**

- **world/model.ts (Station store)** — Owns the canonical Station document + Derived indices. Provides read-only accessors (`roomAt`, `walkable`, `canStep`, `propAt`, `sitAt`, `chunkAt`) with v7-identical signatures so renderer/agents port unchanged. Holds the seq counter. No public setters. _(reuses: walkable/canStep/path/roomAt/propAt/randomSpotIn semantics and exact return shapes; idx() math generalized to chunk-local.)_
- **world/mutations.ts (Mutation API)** — The ONLY legal writers: addRoom/removeRoom/moveRoom/resizeRoom, paintFloor/paintWall, placeHallway/placeDoor/setDoorOpen, placeObject/moveObject/rotateObject/removeObject, assignAgentToRoom, setObjectCapability. Each validates, applies, builds inverse, returns MutationResult, emits worldChange. _(reuses: None directly — this is the net-new layer that replaces map.js's build-once literals.)_
- **world/validate.ts** — Layered validators: rectOverlap(footprint), tilesAreVoidOrOwned, walkabilityPreserved (no command may orphan the spawn room or strand a stationed seat), capabilityLegal (object allowed in room kind), connectivityIntact (doorGraph stays connected). Pure functions returning ValidationError|null. _(reuses: Mirrors the invariants asserted by validate_map.js (in-bounds, on-floor, no overlap, doors clear, stations sittable & reachable) but as preventive guards.)_
- **world/derive.ts (incremental indexer)** — Given a WorldPatch.dirtyTiles, surgically updates floorOwner/zoneId/blockMask/objectId/sitTiles/doorSet for only those tiles, and patches doorGraph on door add/remove. Recomputes affected chunk contentHashes. Never iterates the whole world. _(reuses: The grid-fill loops from map.js (zoneGrid/blocked/sitTiles/pwGrid construction) refactored from 'fill everything once' into 'fill these tiles'.)_
- **world/chunks.ts** — Sparse chunk allocation/eviction, chunk-local <-> world coordinate conversion, typed-array layer storage, and the 'which chunks intersect rect/viewport' query that powers both dirty-region bake and the future camera. _(reuses: Typed-array layer pattern (Uint8Array blocked, Array zoneGrid) — same idea, sharded into 16x16.)_
- **world/serialize.ts (+ migrations/)** — toSaveDoc(station) strips derived state; fromSaveDoc runs the migration chain v?->vCurrent then deterministically rebuilds all Derived indices and chunks. Owns the migrations[] registry and checksum. _(reuses: Replaces SIM.serialize/SIM.load (the single localStorage blob) with a versioned, migratable document.)_
- **persistence/sqlite.ts** — Atomic save (transaction + WAL), multi-slot, rolling backups, corruption detection (checksum mismatch -> fall back to last good backup). Debounced autosave triggered by worldChange seq advancing. _(reuses: None — net-new durability layer mandated by 'ships to customers'.)_
- **world/history.ts (undo/redo)** — Two stacks of Command inverses. undo() pops the last inverse, runs it through the Mutation API (so it too validates + emits a patch), pushes the re-inverse onto redo. Coalesces rapid same-target edits (e.g. a paint drag) into one undo entry. _(reuses: None — v7 has no undo; enabled by the Command/inverse design.)_
- **render/chunkBaker.ts** — Replaces buildBase/baseCv. Per-chunk bake cache keyed by contentHash; on worldChange, marks dirtyChunks; on draw, re-bakes only stale visible chunks and composites them. Parallel per-chunk lightmap cache replacing lightCv. _(reuses: All bake functions (bakeRoomFloor, bakeCorridorFloor, bakeWalls, bakeRoomLighting, bakeHullExtrusion, bakeEdgeAO) reused nearly verbatim, but scoped/clipped to a chunk rect instead of the whole W x H buffer.)_
- **world/bus.ts (event bridge)** — Emits the new `worldChange` event (carrying WorldPatch) on U.bus, plus keeps re-emitting v7's existing names so agents.js/ui.js/render.js listeners are untouched. This is the seam the StarNet bridge plugs real-agent events into. _(reuses: The entire U.bus emit/on contract and every existing event name (chat, sale, parcel, deliverable, task, stats, level, ...).)_
- **test/world.headless.ts** — Node, DOM-free harness that boots the model, fuzzes the Mutation API, and gates every invariant after each command and after save round-trips. _(reuses: Direct successor to validate_map.js + test_world.js; reuses their assertion catalog and the eval-load-headless pattern.)_

**Incremental steps**

- **1. Port the read-only model on a SINGLE fixed chunk set that reproduces v7's exact map, behind v7-identical accessors. No mutation, no chunks-on-demand yet — just prove the new internal representation drives the existing world.** — world/model.ts + chunks.ts that load the current v7 layout (as seed data) and expose roomAt/walkable/canStep/path/propAt/sitAt/randomSpotIn. · _DoD:_ Headless parity test: for all tiles in v7 bounds, model.walkable===MAP.walkable and model.roomAt===MAP.roomAt; validate_map invariants all green. · _tests:_ Re-run a port of validate_map.js against model.* instead of MAP.* — identical PASS (no overlaps, doors clear, all stations sittable & reachable). Diff every tile's walkable/zoneId against v7 MAP to prove byte-for-byte parity.
- **2. Add the incremental derive layer: a private applyDirtyTiles() that rebuilds floorOwner/zoneId/blockMask/objectId/sitTiles for a given tile rect, and prove it equals a full rebuild.** — world/derive.ts. · _DoD:_ Incremental-vs-full grids match exactly across fuzzing; doorSet/doorGraph match. · _tests:_ Property test: apply N random dirty rects via incremental path, then compare every grid to a from-scratch full rebuild — must be identical. Fuzz 1000 iterations.
- **3. Introduce the Mutation API with the simplest pair: placeObject / removeObject (no rooms yet). Each validates footprint, applies, builds inverse, emits a WorldPatch with dirtyTiles/dirtyChunks.** — world/mutations.ts (object ops) + WorldPatch emission on U.bus 'worldChange'. · _DoD:_ Object place/remove leaves grids consistent (re-run step-2 full-rebuild comparison after each op); invalid placements rejected with no mutation. · _tests:_ place then remove returns world to identical serialization (round-trip). Patch dirtyTiles exactly cover the footprint. Reject placing on a blocked/void tile or wrong room-kind.
- **4. Add undo/redo (history.ts) over the object commands using recorded inverses through the Mutation API.** — world/history.ts. · _DoD:_ Full undo restores byte-identical SaveDoc; redo restores forward state; stacks balanced. · _tests:_ Random sequence of place/move/remove, then undo-all -> world equals initial serialization; redo-all -> equals post-sequence serialization. Paint-drag coalescing yields one undo entry.
- **5. Add room + door mutations (addRoom/removeRoom/moveRoom/resizeRoom, placeDoor/placeHallway/setDoorOpen) with overlap + connectivity + walkability validators, maintaining doorGraph incrementally.** — mutations.ts (room/door ops) + validate.ts. · _DoD:_ After any accepted room/door command, doorGraph connectivity == BFS reachability; no command ever leaves an orphaned or unwalkable stationed seat; rejected commands no-op. · _tests:_ addRoom adjacent + placeDoor makes both rooms connected (doorGraph + path() agree). removeRoom that would orphan the spawn room is rejected. moveRoom updates floorOwner for old+new tiles only.
- **6. Versioned serialization + migration chain; rebuild derived state deterministically on load.** — serialize.ts + migrations/ + checksum. · _DoD:_ Save round-trip stable; an older-version fixture loads via migration and passes all model invariants. · _tests:_ serialize -> fromSaveDoc -> serialize is stable (successor to test_world.js round-trip). A hand-written v(N-1) fixture migrates and boots. Truncated/corrupt JSON is detected by checksum.
- **7. SQLite persistence: atomic save, multi-slot, rolling backups, corruption fallback, debounced autosave on worldChange.** — persistence/sqlite.ts wired to the worldChange seq. · _DoD:_ No save scenario yields an unloadable station; corruption always recovers to the most recent valid backup. · _tests:_ Kill-mid-save simulation (write to temp, crash before swap) leaves the previous good save intact. Corrupt the active row -> load falls back to last backup. Autosave debounce coalesces a burst of edits into one write.
- **8. Render chunk-bake cache replacing baseCv/lightCv; subscribe to worldChange.dirtyChunks; verify a runtime edit re-bakes only touched chunks.** — render/chunkBaker.ts. · _DoD:_ Composited render is pixel-identical to v7 for the seed map; a single edit triggers O(footprint) re-bakes, not a full rebuild. · _tests:_ Place one object -> exactly its 1-4 chunks marked dirty and re-baked; all other chunk canvases reused (assert bake-count). Pixel-diff a freshly chunk-composited frame against v7's monolithic baseCv for the seed layout -> identical.
- **9. Full headless world test surface that fuzzes the Mutation API for hours of simulated edits + agent ticks and gates every invariant continuously.** — test/world.headless.ts (successor to test_world.js). · _DoD:_ Hours of fuzzed edits + simulation produce zero invariant violations; this test gates CI for every world change. · _tests:_ Random builder sessions (add/move/remove rooms, paint, place/remove objects) interleaved with WORLD.tick; assert: no agent ever on an unwalkable tile, every accepted command keeps grids==full-rebuild, doorGraph==reachability, undo-to-empty works, save round-trips stay stable.

**Reuse from v7**

- The exact read-API signatures and semantics of walkable/canStep/path/roomAt/propAt/randomSpotIn — kept identical so agents.js (goTo/arrive/runPlan, foot anchors px=tx*T+T/2 py=ty*T+T-1) and the BFS-consuming code port with zero changes.
- TILE=12 and the tile-grid coordinate convention (inclusive Rect {x1,y1,x2,y2}) — the new footprint rects are v7 zone rects generalized to a set.
- Every bake function in render.js (bakeRoomFloor, bakeCorridorFloor, bakeWalls, bakeRoomLighting, bakeEdgeAO, bakeHullExtrusion, chamfer/spandrel corner logic) — reused near-verbatim, just clipped to a chunk rect instead of the full W x H buffer.
- The F{} procedural draw-table (~50 entries) and drawFurn's work-screen lighting — becomes the ObjectDef.draw registry; furniture[] literals become the seed set of ObjectInstances.
- The derived-grid construction loops (zoneGrid/blocked/sitTiles/pwGrid fills, doorSet building) — refactored from 'build once over everything' into the incremental applyDirtyTiles().
- The U.bus event contract and all existing event names — the bridge keeps emitting them; only the new 'worldChange' is added.
- doorDefs edge-pair format [x1,y1,x2,y2] and the doorSet 'x1,y1>x2,y2' key scheme — reused directly as Door.edges and the derived doorSet.
- The headless test methodology (eval-load modules without DOM, simulate ticks, assert invariants, save round-trip) from validate_map.js + test_world.js — the new test surface is their direct evolution.
- SIM.serialize/SIM.load as the conceptual seam that becomes serialize.toSaveDoc/fromSaveDoc (now versioned + SQLite-backed).
- stations{} (agent -> seat tile) concept — becomes ObjectInstance.stationFor / Room.agentIds, preserving the 'station tile must be sittable & reachable' invariant from validate_map.js.

**Rebuild**

- The fixed W=936 x H=674 single offscreen buffer and the camera-less assumption — replaced by an unbounded signed-tile coordinate space + sparse chunks + a separate Viewport, so the station can grow large and a camera/pan/zoom drops in later with no migration.
- The monolithic bake-once baseCv/lightCv with NO invalidation API — replaced by per-chunk content-hash bake caches that re-bake only dirty chunks. This is the explicit #1 obstacle and it is deleted.
- map.js's static module-scope literals (zones{}, furniture[], stations{}, the IIFE that builds all grids once at import) — replaced by a mutable Station document written only through the Mutation API; the literals survive only as seed data for a fresh station.
- The 'a room is just a labeled rectangle + baked decoration, no Room object' reality — replaced by a first-class Room entity (id, footprint set, kind, tier, capabilities, agentIds) that supports L/T shapes, paint, tiers, and agent assignment.
- Furniture as static, rotation-less literals — replaced by ObjectInstance with dir/rotation, room ownership, capability binding, and runtime state.
- The single localStorage JSON blob persistence — replaced by versioned SaveDoc in SQLite with atomic writes, rolling backups, checksums, and a migration chain (saves must survive app updates).
- Implicit, scattered mutation (whoever edits the map also remembers to rebuild grids) — replaced by one closed Mutation API that validates, emits patches, and records inverses, making undo/redo and incremental indexing correct by construction.
- Full-structure assumptions baked into validate_map.js (e.g. fixed ROOM_IDS, HUB ref tile) — generalized so validation works on an arbitrary, growing station.

**Polish (customer-grade)**

- Mutation rejections must produce specific, human-readable ValidationError codes (e.g. OVERLAP, ORPHANS_SPAWN, STRANDS_SEAT, WRONG_ROOM_KIND) so the builder can show a precise red-tile reason, not a generic 'invalid'.
- The 'shabby -> glorious' arc is driven by Room.tier feeding the bake style — tiers must be a clean enum with crisp per-tier floor/wall/lighting palettes, not ad-hoc flags, so upgrades feel like a deliberate visual leap.
- Bake parity with v7 is non-negotiable for trust: the seed station must render pixel-identical to v7 (gated by the step-8 pixel diff) so existing players perceive zero regression when the engine swaps underneath them.
- Autosave must be invisible and safe: debounced, atomic, never blocks a frame, never loses more than the last few seconds of edits, and surfaces a subtle 'saved' indicator — paying customers must trust their station is never lost.
- WorldPatch.seq lets us detect and self-heal a missed patch (renderer/agents can request a full resync) — wire this in from the start so a dropped event degrades to a re-bake, never to a desynced world.
- Undo/redo should feel native (Ctrl+Z/Ctrl+Y), be instant, and coalesce drags into single logical steps so a paint stroke isn't 200 undos.

**Risks**

- Incremental index drift: a subtle bug in applyDirtyTiles could desync floorOwner/blockMask/doorGraph from reality and silently break pathing. Mitigation: the headless test ALWAYS compares incremental grids against a full rebuild after every command; ship a dev-only assert that does this comparison on a sampled fraction of mutations in real runs.
- Chunk-bake seam artifacts: v7's hull/AO/lighting extends past room edges (e.g. WALLH=12px south extrusion, 7px hull pad) and will cross chunk boundaries; naive per-chunk clipping will clip these. Mitigation: bake each chunk with a bleed margin (render neighbors' contributions into an oversized chunk canvas, composite only the core), and pixel-diff against v7 in step 8 to catch seams.
- Connectivity validation cost on large stations: BFS-based orphan checks on every removeRoom/removeDoor could get expensive. Mitigation: maintain doorGraph incrementally and run cheap graph-reachability (not full tile BFS) for the common case; only fall back to tile BFS when the graph is ambiguous.
- Migration chain rot: as the schema evolves, an untested vN->vN+1 step can corrupt old customer saves. Mitigation: keep a fixture save per shipped version in the repo and gate CI on 'every old fixture migrates and passes all invariants'.
- Agents pathing during a mutation: a build edit mid-tick could strand an agent whose path crosses a just-removed tile. Mitigation: worldChange.reindex triggers WORLD.repathAll(); validators forbid removing a tile that is the ONLY path to a stationed/occupied seat; agents fall back to nearest walkable on patch.
- Undo coalescing correctness: merging a paint-drag into one undo entry can drop intermediate inverses and corrupt the stack. Mitigation: coalesce only contiguous same-command same-target ops and test undo-to-empty exhaustively in the fuzzer.
- Over-engineering for P1: D8 says P1 keeps ONE fixed starter room. Risk of building the full chunk/builder stack before the real-agent spine exists. Mitigation: steps 1-2 deliver the model behind v7-identical accessors so P1 ships on it with mutation dormant; the mutation/builder steps (3+) are the post-P1 builder phase and can land independently.

**Open questions**

- Hallways as first-class Rooms vs as wide Doors: a dragged hallway could be a thin corridor-kind Room (paintable, can hold objects) or a multi-tile Door edge. Which better matches the 'hallways = routing/handoffs' metaphor and the builder UX? Leaning corridor-Room for paintability, Door for pure routing — possibly both.
- Granularity of the object->capability mapping: is capability bound to the ObjectInstance, to its Room, or both (room grants a base set, objects add specifics)? This decides how legible the control surface is and how D5's 'Full Access' escalation maps spatially.
- Should runtime ObjectInstance.state (screen on/off, parcel counts) be serialized, or always derived from live agent-runtime events on load? Serializing risks stale visuals after an app update; deriving requires the bridge to re-emit on boot.
- Chunk size 16 vs 8 vs 32: 16 is a reasonable default but the right value depends on typical room size, bake cost per chunk, and how many chunks a screen shows at target zoom — needs a perf spike once real bake timings exist.
- Where exactly the model lives in the Tauri+sidecar split: is the authoritative Station in the Node sidecar (so saves/secrets/agent-runtime are co-located) with the renderer holding a read replica synced via worldChange patches over the WebSocket? That implies WorldPatch must be the wire format and the Mutation API may need to be RPC-callable.
- Multi-floor / vertical expansion: does 'grow large' ever mean stacked decks (z-levels)? If plausibly yes, RoomId/coordinates should reserve a floor/z dimension now to avoid a later migration, even if P1 ignores it.

---

## BUILD MODE & STATION-BUILDER PROGRESSION — the "shabby → glorious" Tuber-Simulator core: build-mode UX, the tiered buildables catalog, the truthful build economy, layout-as-workflow-config, and the onboarding tie-in. Grounded in v7's real map.js/render.js/sprites.js engine.

The station builder turns the locked object→capability metaphor into the product's primary verb: you don't fill out an agent config, you BUILD the room that grants it powers, and the room's visual quality is a truthful readout of how much real work the agent has shipped. Build mode is a diegetic "REFIT" overlay where the user paints floors, drags rooms/hallways, and drops furniture onto v7's existing 78×55 tile grid with ghost-preview snapping and valid/invalid tinting; each placement mutates the real MAP data structures (furniture[], zoneGrid, blocked, sitTiles, pwGrid) and forces a re-bake of the bake-once baseCv/lightCv. The "shabby → glorious" arc is NOT a fake skin tree — it is the same truthful-telemetry principle from v7's GOALS.md ("screens show real S state, never set dressing") applied to architecture: a room starts rusty/dim because the agent hasn't proven itself, and upgrades to pristine as it accumulates STATION XP earned from REAL shipped deliverables and REAL credits spent. The economy has exactly one fake-money-free currency loop — work shipped → XP → unlocks + a build resource ("Salvage") → spend to expand/upgrade — so building always means the agents really did something. The smallest shippable slice is a single one-tap "place your first computer" beat inside onboarding, which is also the tutorial that teaches the entire grammar.

**Decisions**

- **Build mode is a full-screen diegetic 'REFIT MODE' overlay toggled by a single dock button, NOT a side-panel editor. Entering dims the live sim (agents freeze/ghost), overlays the tile grid as faint phosphor lines, and swaps the bottom dock for an in-fiction toolbar (PLACE / PAINT / ROUTE / MOVE / RECLAIM / UNDO).** — v7's world is a fixed 936×674 buffer CSS-stretched with NO camera (confirmed in render.js init: cv.width=W). A modal full-screen overlay sidesteps the missing camera entirely for P1 — the whole station already fits on screen. A diegetic toolbar honors GOALS.md rule 5 ('no OS chrome, every surface speaks raw-FNV phosphor') and rule 10 ('fiction mirrors the real stack'); a generic editor would break the CRT fiction the product sells. _(alt: A persistent always-on inline editor (rejected: clutters the live dashboard, and dragging ghosts while agents path is a race-condition surface). A separate editor window (rejected: breaks immersion, doubles the render path).)_
- **Every placement/paint/route/reclaim action is a reversible Command object pushed to an undo/redo stack; applying a command mutates the real MAP structures (furniture[], zones, zoneGrid, blocked, sitTiles, pwGrid) and sets baseCv=null & lightCv=null to force render.js to re-bake on the next frame.** — render.js bakes the ENTIRE static environment once into baseCv/lightCv from MAP.allRects + MAP.furniture and has NO dirty-region/invalidation API (confirmed: 'if(!baseCv) buildBase()'). The cheapest correct integration is a coarse full-rebake gated behind a command apply — no surgical invalidation needed because a full rebake of a 936×674 buffer is <16ms and only fires on a discrete user action, never per-frame. Command pattern gives undo/redo for free and makes every mutation a single testable unit. _(alt: Incremental dirty-region baking (rejected for P1: large effort, the bake-once design has no seam for it, and rebake-on-action is already imperceptible). Direct mutation without commands (rejected: no undo, untestable, and a half-applied multi-grid update corrupts pathfinding).)_
- **The 'shabby → glorious' arc is implemented as a per-room and per-object 'tier' integer (0=rusty…3=pristine) consumed by the F{} draw functions and the buildBase hull pass, NOT as separate sprite assets. Tier modulates palette/wear/emissive intensity, not geometry.** — v7's F{} furniture table and buildBase already parametrize wear() and glow() intensity (e.g. F.desk2 underglow alpha scales with f.work). GOALS.md rule 7 is literally 'Approval is a floor — parametrize intensity so push-it-further is a tweak, not a rewrite' and rule 3 is 'Lit, not painted — mood changes go through the lightmap/accents, never repaints.' Adding an f.tier read inside the existing wear/glow calls makes the upgrade arc a one-parameter change per prop, reusing 100% of the existing pixel art. Generating 4× the sprites would violate the zero-asset procedural ethos in sprites.js. _(alt: Distinct hand-drawn sprites per tier (rejected: 4× art cost, breaks procedural reuse). A global post-process grunge filter (rejected: violates 'lit not painted', can't express per-room progress).)_
- **Build economy uses ONE earned resource, 'Salvage' (the build currency), minted ONLY by real outcomes: shipping a real deliverable and spending real credits. Salvage + a Station-Level gate (Station XP) together unlock and pay for expansion. No simulated revenue, ever.** — D11 is locked: 'No simulated economy — fully truthful (credits-spent + work-shipped). Station-growth is the reward substitute for money-goes-up.' Salvage is the honest analog of Tuber-Sim's 'Bux': it only exists because an agent really worked. This makes building a TROPHY CASE for real productivity, not a paywall. Station XP gates WHAT unlocks (tech-tree); Salvage gates HOW MUCH you can build right now (rate-limit), mirroring the dual XP/currency gating the user already half-built in sim.js (level + treasury). _(alt: Real-dollar purchases of build content (rejected: turns a creative tool into a microtransaction store, off-brand, and conflicts with BYOK honesty). Pure XP with no spendable resource (rejected: removes the satisfying 'save up and splurge' loop that makes Tuber-Sim addictive). Time-gated unlocks (rejected: fake idle-game timers contradict truthful telemetry).)_
- **Layout literally configures the real agent org: a ROOM is a named capability-zone whose contained objects define the union of tools its seated agents may call; a HALLWAY/DOOR placed between two rooms registers a real routing/handoff edge in the sidecar; placing an object in a room grants that capability to agents assigned there.** — The locked core abstraction (plan §4) is 'a placed object is a typed capability grant AND a security boundary.' map.js already models zones as capability-like regions and doorSet as the ONLY legal cross-zone edges (canStep enforces it) — so 'draw a hallway between rooms' is already 'authorize a handoff' in the existing pathfinding. This makes the spatial diagram the user draws BE the org chart and the permission allow-list, fulfilling the 'station layout = spatial diagram of your multi-agent org' mandate with the engine's own primitives. _(alt: A separate non-spatial workflow config UI (rejected: defeats the entire product thesis that building IS configuring). Purely cosmetic rooms (rejected: makes building meaningless, the explicit failure mode the prompt warns against).)_
- **P1 ships ONE build interaction — single-object placement from a 1-item tray (the COMPUTER) inside onboarding — before any paint/route/expand tooling. The full builder (paint, drag-rooms, hallways, tiers, catalog) is layered in P3 per the locked D8 phasing.** — PROCESS MANDATE: 'smallest shippable pieces, one step at a time, each test-backed.' D8 locks 'one fixed starter room for P1; full builder is its own phase after.' Placing one computer is the minimum that proves the placement→mutation→rebake→agent-can-now-work spine end-to-end, and it doubles as the onboarding tutorial (the empty room withholds work until you place the computer — plan §5 core-loop step 1). Everything else is additive on this proven seam. _(alt: Ship the whole builder at once (rejected: violates the incremental mandate, enormous untested surface). Ship build mode before the real-agent spine (rejected: D8 says prove the real-work spine first).)_

**Data structures**

- // ObjectInstance — replaces v7's static furniture[] literal. Superset of the v7 furn record so render.js's MAP.furniture loop + SPR.drawFurn(f,work) consume it unchanged.
ObjectInstance {
  id: string,            // stable uuid (for move/reclaim/persist)
  t: string,            // F{} draw key — REUSED verbatim: 'pixelrig'|'desk2'|'desk'|'console'|'cabinet'|'dish'|'holotable'|...
  x:int, y:int, w:int, h:int,   // tile rect — same fields v7 bake loops read
  rot: 0|90|180|270,    // NEW: footprint rotation (swaps w/h at 90/270; picks seat side)
  tier: 0|1|2|3,        // NEW: rusty→pristine; read by F{} wear()/glow() + buildBase hull pass
  sit?: bool, deco?: bool,      // v7 flags preserved (drive sitTiles vs blocked)
  seat?: {dx:int, dy:int, face:'north'|'south'|'east'|'west'},   // derived sit/work anchor offset within footprint
  pw?: string, pwl?: string,    // PROPTERM window id + label — UNCHANGED, opens the live session
  grants: string[],     // capability ids this object authorizes while seated: ['model.chat'] | ['shell.exec'] | ['fs.read','fs.write'] | ['web.fetch']
  catalogId: string,    // which catalog entry produced it (for tier-up + resale value)
  ownerAgentId?: string
}
- // CatalogEntry — the tiered, progressively-unlocked buildables inventory (drives the tray UI)
CatalogEntry {
  id: string, kind: 'object'|'floor'|'wall'|'room'|'hallway'|'decor',
  label: string, fKey: string,        // -> F{} draw fn (object/decor) or paint style id (floor/wall)
  footprint:{w:int,h:int}, rotatable: bool,
  grants: string[],                   // empty for pure decor/floor
  unlockAt:{ stationLevel:int, prereq?: string },   // tech-tree gate (Station XP)
  cost:{ salvage:int },               // build-resource price
  resaleSalvage:int,                  // RECLAIM refund (e.g. 60% of cost)
  tierUpCost:[null,{salvage:int},{salvage:int},{salvage:int}]  // price to push tier 0→1→2→3
}
- // RoomInstance — a placed capability-zone. Extends map.js zones{} (which today is a static zoneId->rect map).
RoomInstance {
  id: string, zoneId: string,         // written into MAP.zones + stamped into zoneGrid
  rect:{x1,y1,x2,y2},                 // inclusive tile rect, same shape as v7 zones
  kind: 'starter'|'compute'|'shell'|'data'|'web'|'comms'|'lounge',
  tier: 0|1|2|3,                      // room-level shabby→glorious (hull rim + floor palette)
  floorStyle: string, wallStyle: string,
  capabilities: string[],            // UNION of grants from objects inside (recomputed on any place/reclaim)
  assignedAgents: string[]           // agents whose tools = this room's capabilities
}
- // RouteEdge — a hallway/door = a real handoff authorization between two rooms.
RouteEdge { id, fromZone, toZone, doorTiles:[[x1,y1,x2,y2],...], handoff:'parcel'|'message'|'none' }
// applied by adding entries to MAP.doorDefs -> rebuilding doorSet so canStep() permits the crossing; the sidecar mirrors it as a routing edge in the agent org graph.
- // BuildCommand — every build action is a reversible command (undo/redo + testability).
BuildCommand {
  type:'place'|'move'|'reclaim'|'paint'|'rotate'|'drawRoom'|'drawHall'|'tierUp',
  apply(world): Patch,    // mutates furniture[]/zones/zoneGrid/blocked/sitTiles/pwGrid/doorDefs
  invert(): BuildCommand,
  cost:{salvage:int}      // charged on apply, refunded on undo
}
// CRITICAL: every apply()/invert() ends with World.markDirty() -> render sets baseCv=null,lightCv=null (no dirty-region API in v7; full rebake on next frame).
- // Economy ledger — truthful, no simulated money.
StationEconomy {
  xp:int, level:int,                 // Station XP from real outcomes -> tech-tree unlocks
  salvage:int,                       // spendable build resource
  // mint rules (ONLY real triggers, wired to the same bus events the real bridge emits):
  //   on 'deliverable.ready'      -> +XP(byKind) , +Salvage(base + qualityBonus)
  //   on 'agent.run.end' (real $) -> +XP proportional to real credits spent (work happened)
  //   NEVER on a game-minute tick (game-time is decoupled per plan §6)
}
- // Placement validation — reuses map.js walkability so build can't break pathfinding.
function canPlace(obj):{ok:bool, reason?} {
  // 1) all footprint tiles in-bounds & inside a room zone (zoneGrid[idx]!=null)
  // 2) no overlap with blocked[]/existing non-deco furniture
  // 3) for sit/work objects: the derived seat+stand tile is MAP.walkable AND a clear path still exists
  //    from the room door to the seat (run MAP.path() post-hypothetical-stamp; reject if it strands the seat)
  // 4) reachability invariant: placing must NOT disconnect any existing occupied seat (door-lane clear)
  // ghost tints GREEN if ok, RED + reason tooltip otherwise — mirrors v7's f.work green/standby red palette
}

**Components**

- **BuildMode (build-mode.js)** — Owns REFIT overlay lifecycle (enter/exit, freeze sim, draw grid), the active tool state machine (PLACE/PAINT/ROUTE/MOVE/RECLAIM), ghost-preview rendering with snap+rotate+valid/invalid tint, and emits BuildCommands. The single new top-level module. _(reuses: render.js toLocal() for pixel→tile hit-testing; the existing canvas + ctx; SPR.drawFurn called with a 50%-alpha ghost flag for previews; U.bus for tool events; SFX synth in util.js for place/deny clicks.)_
- **WorldMutator (extends map.js)** — The mutable-world API map.js lacks today: addObject/removeObject/moveObject/paintTile/addRoom/addRoute, each updating zoneGrid/blocked/sitTiles/pwGrid/doorDefs/doorSet coherently, then markDirty(). The single source of truth that keeps pathfinding valid after every edit. _(reuses: map.js idx(), walkable(), canStep(), path(), the exact grid-build loops from map.js lines 309-344 (refactored into reusable stamp/unstamp fns instead of one-shot IIFE init).)_
- **BakeInvalidator (tiny hook in render.js)** — Exposes World.markDirty() → sets baseCv=null & lightCv=null so the next frame() rebakes from the mutated MAP. The whole runtime-building unblock is ~3 lines. _(reuses: render.js buildBase()/buildLightMap() unchanged — they just re-read the now-mutated MAP.allRects/MAP.furniture.)_
- **Catalog (catalog.js)** — Static data table of CatalogEntry tiers + the unlock tech-tree; renders the diegetic inventory tray (locked entries shown as ghosted silhouettes = the 'destiny' the station grows into, per plan §5). _(reuses: The .term card styling from onboarding/ui.js; F{} keys as the icon source (draw each catalog icon by calling its F{} fn into a small offscreen canvas — zero new art).)_
- **StationEconomy (economy.js)** — Holds xp/level/salvage; subscribes to the REAL bus events (deliverable.ready, agent.run.end) to mint resources; exposes canAfford()/charge()/refund() to BuildCommands and unlock checks to Catalog. _(reuses: sim.js level/milestone curve SHAPE (re-pointed from fake revenue to real outcomes); U.money/fmtClock formatting; the topbar slot that showed NET (repurposed to SALVAGE + STATION LV).)_
- **TierController (hook in sprites.js + render.js)** — Threads obj.tier and room.tier into the existing wear()/glow()/palette calls so 'shabby→glorious' is a parameter, not new assets; drives the upgrade animation (a one-shot lightmap flare on tierUp). _(reuses: sprites.js wear()/glow()/U.shade() intensity params; render.js buildLightMap destination-out carve for the upgrade flare (honors 'lit not painted').)_
- **WorkflowGraph (sidecar mirror)** — Receives object.place / room.add / route.add over WS and maintains the real agent org graph: which agent has which tools (room capability union), which handoff edges exist. The bridge that makes layout = real config. _(reuses: Nothing visual — consumes the same WS bridge (bridge.js) that replaces SIM; the CapabilityManager from plan §4 is its enforcement arm.)_

**Incremental steps**

- **S0 — Refactor map.js grid-build into idempotent stamp/unstamp functions** — map.js exposes stampObject(f)/unstampObject(f)/stampZone(z,rect)/rebuildDoorSet() that perform the SAME mutations the current init IIFE does (lines 309-344), plus an exported markDirty hook stub. No behavior change at boot. · _DoD:_ node validate_map.js && node test_world.js still exit 0; booting produces byte-identical zoneGrid/blocked/sitTiles vs the old one-shot init (assert via a checksum test). · _tests:_ New unit test: stamp then unstamp a synthetic object returns grids to their pre-stamp checksum. Existing validators unchanged.
- **S1 — markDirty → rebake seam in render.js** — World.markDirty() sets baseCv=null,lightCv=null; a dev-only console hook moves an existing furniture record one tile and triggers markDirty. · _DoD:_ In preview, calling the hook visibly relocates the prop and the hull/lightmap rebake correctly with no artifacts; frame time stays <16ms on the rebake frame. · _tests:_ preview_eval asserts baseCv is re-created (identity changed) after markDirty; smoke that no stale shadow remains at the old tile.
- **S2 — canPlace() validator + ghost preview (read-only, no commit)** — BuildMode overlay (grid lines + frozen sim) with a single hardcoded COMPUTER ghost that follows the cursor, snaps to tiles, tints green/red via canPlace(), and rotates with R. Nothing is placed yet. · _DoD:_ Ghost tints red over walls/blocked/out-of-room and over door lanes; green only where a valid seat+stand+path exists; rotation swaps footprint and seat side correctly. · _tests:_ Unit tests for canPlace across: in-room-clear (ok), on-wall (reason=unwalkable), overlapping-furniture (reason=occupied), strands-seat (reason=blocked-path), blocks-door (reason=door-lane). Headless, no canvas.
- **S3 — PlaceCommand commit + the one-tap onboarding beat (P1 SLICE)** — Confirming the ghost runs PlaceCommand.apply(): stamps the COMPUTER into furniture[], registers sit/work anchor in sitTiles, sets pwGrid for its PROPTERM window, markDirty. Wired as the onboarding tutorial step: empty starter room → 'PLACE YOUR CORE' prompt → tap → computer appears → the agent can now path to it and (per plan §1) really work. · _DoD:_ A freshly-onboarded agent that literally cannot work (no computer) gains the ability the instant the computer is placed: it paths to the seat, sits facing north, b.working flips on a REAL model call, PROPTERM opens the live session. Reclaiming it revokes the capability and the agent stands. · _tests:_ Integration: place→agent.run.start dispatch→arrive(seat)→hasOpenCall true→drawBody picks 'type/sit' track. Reclaim→capability removed from WorkflowGraph→agent returns to idle. Persists across reload (SQLite).
- **S4 — Undo/redo stack + RECLAIM (sell-back)** — BuildCommand stack with Ctrl-Z/Y; RECLAIM tool removes an object and refunds resaleSalvage; every apply/invert charges/refunds and markDirty. · _DoD:_ Place→undo restores exact pre-state (grid checksums match S0 invariant); reclaim refunds correct Salvage; undo of a reclaim restores the object AND its grants. · _tests:_ Property test: any random sequence of place/move/reclaim followed by N undos returns grids+economy to the matching historical checkpoint.
- **S5 — StationEconomy: Salvage/XP minted from REAL outcomes + catalog gating** — economy.js subscribes to deliverable.ready and agent.run.end; tray shows owned vs locked (ghosted) catalog entries; placement is charged in Salvage and blocked if unaffordable or below unlock level. · _DoD:_ Shipping a real deliverable visibly increments Salvage + Station XP (floater over the agent per GOALS.md LOOP B); a fake game-minute tick mints NOTHING; an unaffordable catalog entry shows a clear 'need X salvage' state; never any simulated-revenue path. · _tests:_ Unit: mint rules fire ONLY on the two real events, never on a clock tick. Gating: canBuild() false below unlockAt.level or salvage<cost. Reconciliation: XP uses reconciled final usage, not streamed estimate.
- **S6 — Tier system: shabby→glorious as a parameter** — obj.tier + room.tier read inside F{} wear()/glow() and buildBase hull rim; a TIER-UP action spends Salvage to raise a room/object tier with a one-shot lightmap flare. · _DoD:_ A tier-0 'rusty' computer/room is visibly grimier+dimmer; tiering up to pristine brightens emissives and cleans wear WITHOUT swapping sprites; the upgrade flare goes through the lightmap, not a repaint. · _tests:_ Visual regression: same prop at tier 0 vs 3 differs only in palette/wear/glow channels (geometry pixels identical). validate_palette.js still passes (no brown, no oversat large fills).
- **S7 — PAINT (floor/wall styles) + drag-to-draw ROOM/HALLWAY (full builder, P3)** — PAINT tool sets floorStyle/wallStyle per zone (rebake reads it); drag-rectangle DrawRoomCommand adds a RoomInstance to MAP.zones; drag-line DrawHallCommand adds corridor tiles + a RouteEdge (doorDefs→doorSet→canStep) connecting two rooms. · _DoD:_ User paints a room's floor and it rebakes; drags out a new compute room; drags a hallway to an existing room and an agent can now path between them (canStep permits the new door); the new room's capability union is mirrored to the sidecar WorkflowGraph as a real org edge. · _tests:_ Unit: addRoom stamps zoneGrid without overwriting existing zones; addRoute makes canStep true across the new door and false elsewhere; path() finds a route through the new hallway. Reachability invariant holds after every draw.

**Reuse from v7**

- map.js: idx(), walkable(), canStep(), path(), zones/zoneGrid/blocked/sitTiles/pwGrid/doorDefs/doorSet — the exact structures build mode mutates; the grid-build loops (lines 309-344) become the stamp/unstamp primitives.
- render.js: buildBase()/buildLightMap() reused UNCHANGED (they re-read mutated MAP); frame() y-sort loop already iterates MAP.furniture so placed objects render with zero changes; toLocal() for cursor→tile hit-testing; the bake-once design becomes buildable via a 3-line markDirty hook.
- sprites.js: the entire F{} table (~50 procedural props) IS the buildables art — pixelrig/desk2/desk=computers, console=terminal, cabinet=filing, dish=uplink, holotable=easel; wear()/glow()/U.shade() intensity params become the tier knob; catalog icons drawn by calling F{} fns into offscreen canvases (zero new assets).
- agents.js: standNearFurn()/arrive()/goTo()/dirToward() already derive seat+facing+stand-tile from a furniture rect — placement reuses this verbatim to register a new object's work anchor; b.working/sitting/dir drive the 'is really working' visuals.
- ui.js / propterm.js: pw/pwl tags on placed objects open the existing PROPTERM live-session windows unchanged; the topbar NET slot is repurposed to SALVAGE + STATION LV; .term card styling for the catalog tray.
- sim.js: the level/milestone/XP-curve SHAPE and the reload-safe shipQueue job-tracking pattern (re-pointed from fake revenue to real deliverable.ready/agent.run.end events).
- GOALS.md design laws applied directly: rule 2 truthful-telemetry (room quality = real work shipped), rule 3 lit-not-painted (tier via lightmap/accents), rule 5 diegetic terminal (REFIT toolbar speaks phosphor), rule 7 parametrized intensity (tier as one param), rule 8 staged candidates (locked catalog entries shown as ghosted destiny silhouettes).
- util.js: U.bus (commands + mint events), SFX synth (place/deny/tier-up clicks), U.money/fmtClock/clamp/lerp — copied wholesale.

**Rebuild**

- The mutable-world API on map.js — today every grid is built once in an IIFE with no add/move/remove/re-stamp path; refactor into idempotent stamp/unstamp functions that keep zoneGrid/blocked/sitTiles/pwGrid/doorSet coherent after each edit (S0).
- The markDirty→rebake seam — render.js has NO invalidation API (bakes only when baseCv===null). Add World.markDirty() that nulls baseCv/lightCv on any committed build command (S1).
- BuildMode overlay + tool state machine + ghost preview with snap/rotate/multi-tile footprint/valid-invalid tinting — wholly new (build-mode.js).
- BuildCommand pattern with undo/redo and charge/refund — new; nothing in v7 is reversible.
- StationEconomy (Salvage + Station XP) minted ONLY from real deliverable.ready / agent.run.end events — replaces sim.js's fake earn()/revenue minting; mint-on-game-minute is explicitly deleted (game-time decoupled).
- The tiered Catalog + unlock tech-tree + diegetic inventory tray with ghosted locked entries — new data + UI.
- TierController — thread obj.tier/room.tier into existing wear/glow/palette calls; new tier-up command + lightmap upgrade flare.
- Drag-to-draw rooms/hallways and floor/wall PAINT, adding RoomInstances to MAP.zones and RouteEdges to doorDefs (P3) — new; v7 zones/doors are static literals.
- WorkflowGraph mirror in the sidecar — translate object/room/route placements into the real agent capability+handoff org graph (the 'layout = config' payoff).

**Risks**

- Full re-bake on every commit: a 936×674 buildBase+buildLightMap pass must stay <16ms or placement feels laggy. Mitigation: rebake only on discrete commit (never per-frame/drag — ghost preview is a cheap overlay, not a rebake); profile buildBase early; if slow, cache the hull layer separately from furniture so only the prop layer rebakes.
- Placement that strands a seat or blocks a door lane silently breaks pathfinding (agent can never reach its computer → never works → looks like the real-agent spine is broken). Mitigation: canPlace() runs a hypothetical MAP.path() from room door to the new seat and to every existing occupied seat; reject (red ghost) if any becomes unreachable. This is the single most important validator — covered by S2 tests.
- No camera in v7 (fixed 936×674 buffer) means drag-to-draw rooms can exceed the visible buffer. Mitigation: P1/S3 stays inside the existing room (D8); P3 room-drawing is clamped to the buffer until the camera ships, with the catalog gating expansion to the available space — building never produces off-screen, unreachable geometry.
- Tier-as-parameter could drift into 'painted' grunge that violates GOALS.md rule 3. Mitigation: tier MUST route through wear()/glow()/lightmap channels only; a visual-regression test asserts geometry pixels are identical across tiers (S6).
- Economy could feel grindy or, worse, tempt re-adding fake money to smooth the curve. Mitigation: D11 lock is non-negotiable — Salvage is generous early (first deliverable funds the first real expansion) and the locked catalog 'destiny silhouettes' provide aspiration without fake currency; tune the XP curve from sim.js's existing shape, not new fake sinks.
- Layout-as-config can desync from the sidecar's real capability enforcement (renderer shows a granted tool the sidecar didn't actually grant → a security-relevant lie). Mitigation: the sidecar WorkflowGraph is the source of truth; the renderer's room.capabilities is a projection it confirms via WS ack before showing the grant as active — enforcement stays server-side per plan §4.
- Undo/redo correctness across multi-grid mutations is fiddly (a place touches up to 5 grids + economy). Mitigation: Command.invert() is derived from the captured Patch, and the S0 checksum invariant + S4 property test (random ops then N undos == checkpoint) guard it.

**Open questions**

- Salvage tuning: exact mint rates (Salvage per deliverable, XP per real dollar spent) and the unlock-level curve — needs a balance pass once real deliverables flow in P1, and should reuse/replace sim.js's existing milestone numbers.
- Does tiering up cost ONLY Salvage, or also require a Station-Level gate (so you can't pristine-up a room before the station itself has progressed)? Recommend: both — level gates availability, Salvage pays — but confirm with the user.
- Room capability semantics for multi-object rooms: is a room's tool set the strict UNION of all contained objects (recommended, simplest, matches 'objects grant tools'), or can a room cap/deny a tool its objects provide? Affects WorkflowGraph design.
- Hallway handoff fidelity in v1: is a route edge purely a real authorization (agent A may hand off to agent B) with cosmetic parcel movement, or does v1 wire a real inter-agent message? Plan D7 leans 'independent workers + cosmetic org' for v1 — confirm hallways are authorization-only until real orchestration lands.
- Should the starter room itself be tier-upgradeable in P1, or is tiering strictly a P3+ feature? (P1 ships placement only per D8; recommend tier visuals exist but the tier-up ACTION unlocks in P3.)
- PixelLab tile/object generation: should higher catalog tiers eventually use PixelLab-generated pixel art instead of pure F{} recolors for a bigger 'glorious' payoff, and if so is that credit-gated like the avatar FORGE track (D12)?
- Multi-tile drag-paint performance: painting a large floor region issues many tile edits — batch into one PaintCommand+one rebake (recommended) vs per-tile; confirm batching is acceptable for undo granularity.

---

## Rendering Engine — Camera, Chunked/Dirty Bake, Dynamic Y-Sort, Build-Mode Overlay (evolving v7 render.js)

v7's renderer is a fixed 936x674 offscreen buffer (baseCv floors/walls/light + lightCv darkness) blitted whole each frame, CSS-stretched with image-rendering:pixelated and a screen-space CRT overlay; it has no camera, no culling, and no bake invalidation. The path to a growing, scrollable, player-built station is to insert ONE coordinate transform (a Camera) between world-space and the canvas, and to shatter the two bake-once buffers into a CHUNK GRID of per-chunk canvases that are baked lazily, culled to the viewport, and re-baked per-chunk on a world-mutation dirty signal — preserving the destination-out lightmap by baking it into a parallel per-chunk light canvas. CRUCIALLY for D8: Phase 1 ships v7's renderer almost verbatim (one fixed room, whole-buffer blit, no camera), but we pre-factor three seams NOW — a Camera object that is identity in P1, a Scene draw-list the frame loop already builds, and a bakeRegion(rect) entry point wrapping today's buildBase — so the builder phase adds chunking/camera without rewriting the renderer or touching gameplay code.

**Decisions**

- **Introduce a single Camera abstraction {wx, wy, zoom} with screenToWorld / worldToScreen / worldToTile, applied via ctx.setTransform at the top of frame(); NOT per-draw-call offsets.** — Every draw in render.js and sprites.js currently uses raw world px (e.g. b.px, f.x*T). A camera transform on the context means ZERO changes to the ~50-entry F{} draw table and drawAgent/drawFurn — they keep emitting world coords and the GPU/canvas matrix relocates them. Per-call offsetting would touch hundreds of fillRect sites and is the corner we must not paint ourselves into. _(alt: Per-draw +camX/+camY offsets (massive surface area, error-prone); CSS transform on the canvas element (breaks the pixelated mask/CRT alignment and gives no culling benefit).)_
- **Chunk the world into a grid of CHUNK=24 tiles (288px) square cells; each chunk owns a baseCv-style canvas AND a lightCv-style canvas, baked lazily on first visibility and re-baked when marked dirty.** — 24 tiles ≈ the size of one v7 room (rooms are 8-28 tiles wide), so a chunk re-bake on edit is ~1 room of work, matching the natural mutation granularity. 288px canvases keep per-chunk memory small (~330KB RGBA) so a large station of 200 chunks is bounded, and culling draws only the ~6-12 chunks under the viewport instead of one giant 936xN buffer. _(alt: Per-room bake (rooms are non-uniform and overlap pad regions — bake bleed across neighbors is hard to bound); one giant expandable buffer (re-bakes the whole station on every edit, blows memory and the frame budget that LOOP E is trying to protect).)_
- **Preserve the lightmap technique under chunking by giving each chunk a parallel light canvas baked with the SAME destination-out carve, but seed the per-chunk darkness from a world-space light source list (lampPos/doors/windows that overlap the chunk + a 1-chunk apron) so cross-chunk light spill is continuous.** — v7's lightCv is one global destination-out carve; naively chunking it would hard-edge light at chunk borders. By carving each chunk from a source list that includes sources within a bleed radius of the chunk's neighbors, a lamp near a seam lights both chunks identically. The vignette becomes a separate screen-space pass (it is viewport-relative, not world-relative). _(alt: Keep one global lightCv sized to the whole world (defeats culling, unbounded memory); skip per-chunk light and light in screen space per-frame (loses the baked-darkness signature and costs per-frame radial gradients — exactly LOOP E's named hotspot).)_
- **Replace MAP.furniture (static literal array) reads in the y-sort with a spatial query Scene.itemsInView(viewRect): furniture indexed into chunk buckets, agents always included (few of them), parcels included. Keep the existing items[].sort by y.** — Today render.js iterates ALL furniture + ALL bodies every frame and y-sorts the lot. For a large station that is the dominant CPU cost. Bucketing furniture by chunk lets us gather only props in visible chunks; agents stay in a flat list (Object.values(WORLD.bodies)) because they move and number in the tens. The painter y-sort algorithm itself is unchanged — it just receives a culled, smaller list. _(alt: Keep iterating all furniture (O(n) per frame, the thing we are trying to fix); a full scene-graph/quadtree (over-engineered for tile-bucketed props that rarely move).)_
- **Build-mode rendering is a dedicated overlay pass drawn AFTER lightCv and glows but in WORLD space (under the camera transform), gated by a renderMode flag; grid lines, placement ghost, validity tint, room outlines, hover highlight.** — Build affordances must align to world tiles and pan/zoom with the station, so they live under the camera transform — but they must sit above the lightmap (you need to see the ghost in a dark unlit new room). A single gated pass keeps the live/play frame path untouched (zero cost when not building). _(alt: Build overlay as DOM elements over the canvas (misaligns under zoom/pan and the pixelated stretch); baking ghosts into chunks (ghosts are transient, would thrash the dirty system).)_
- **D8 reconciliation: Phase 1 uses Camera in IDENTITY mode (zoom=1, centered, clamped to the single starter room) and a SINGLE chunk that is literally today's buildBase output — the renderer is v7's renderer with three thin seams pre-installed, not a rewrite.** — The brief's make-or-break P1 proves the real-agent-work spine, not the builder. Over-building a chunked camera renderer in P1 risks the spine and violates the go-slow mandate. But designing P1 with a hard-coded whole-buffer blit and raw toLocal would force a renderer rewrite later. The seams (Camera, Scene draw-list, bakeRegion) are cheap no-ops in P1 and become the extension points in the builder phase. _(alt: Full chunked/camera renderer in P1 (over-build, risks the spine, slow); pure verbatim v7 with no seams (paints the builder phase into a corner — exactly what the brief forbids).)_
- **Mouse hit-testing: replace toLocal's CSS-stretch inverse with camera.screenToWorld(clientX,clientY); keep WORLD.bodyAt / MAP.propAt operating in world/tile space unchanged.** — toLocal today only undoes object-fit:contain stretch (clientX → 0..W buffer). With a camera, the same function must additionally undo pan+zoom. Because bodyAt/propAt already take world px / tile coords, only the screen→world step changes — the downstream hit logic is reused verbatim. _(alt: Hit-test in screen space against transformed prop rects (recomputes every prop's screen rect per click, and breaks under the offscreen-bake model).)_

**APIs / interfaces**

- Camera.screenToWorld(sx,sy) -> {x,y} ; worldToScreen(wx,wy) -> {x,y} ; worldToTile(wx,wy) -> {tx,ty}
- Camera.viewRectWorld() -> {x,y,w,h} ; Camera.apply(ctx, dpr) ; Camera.clamp() ; Camera.followAgent(bodyOrNull)
- Camera.setViewport(cssW, cssH, dpr) // called on resize; sets canvas backing store to cssW*dpr
- ChunkStore.markDirtyTiles(tx1,ty1,tx2,ty2) // the invalidation entry point
- ChunkStore.visibleChunks(viewRectWorld) -> Chunk[] ; ChunkStore.ensureBaked(chunk)
- Scene.itemsInView(viewRect) -> {y,draw}[] (y-sorted) ; Scene.addProp(f) ; Scene.removeProp(f) ; Scene.rebucket()
- bakeChunkBase(chunk) ; bakeChunkLight(chunk) ; bakeRegion(worldRect) // P1 alias that bakes the single starter chunk
- RENDER.init(canvas, clickCb) // unchanged signature ; RENDER.frame(tMs) // unchanged signature ; RENDER.setMode('play'|'build')
- RENDER.setCamera(cam) // wires the shared Camera; P1 passes an identity camera
- Event names on U.bus (consumed): 'world:roomPlaced'{x1,y1,x2,y2}, 'world:tilePainted'{x,y}, 'world:propPlaced'(furn), 'world:propRemoved'(furn), 'world:roomUpgraded'{x1,y1,x2,y2}, 'world:resized'{worldW,worldH}
- Event names emitted (build affordances): 'build:ghostMove'{tx,ty,valid}, 'build:place'{kind,tx,ty}, 'cam:moved'{wx,wy,zoom} (drives 'hazard'->.cam-alert reuse)

**Components**

- **Camera** — Owns {wx,wy,zoom,viewport}. Provides screenToWorld/worldToScreen/worldToTile, viewRectWorld, apply(ctx) via setTransform, clamp() to world bounds, and followAgent(body). The single coordinate authority. Identity/centered in P1. _(reuses: New. Replaces the ad-hoc inverse-stretch math in toLocal().)_
- **ChunkStore + Chunk** — Grid of per-chunk base+light offscreen canvases. Lazy bake on first visibility, dirty re-bake on world-mutation events, LRU eviction of long-unseen chunks for bounded memory, visibleChunks() culling query. _(reuses: New container; each chunk's bake REUSES v7's buildBase/buildLightMap drawing code, clipped to the chunk box.)_
- **bakeChunkBase / bakeChunkLight (was buildBase / buildLightMap)** — Bake floors, hull, walls, corridor dressing, room lighting, hull extrusion, and the destination-out darkness for ONE chunk, in world coords translated into chunk-local space, clipped to chunk+APRON. _(reuses: Directly reuses bakeRoomFloor, bakeCorridorFloor, bakeWalls, bakeEdgeAO, bakeRoomLighting, bakeCorridorDressing, bakeHullExtrusion, eraseSpandrel, the CORNER/chamfer geometry, and the cut() radial carve — refactored to take (ctx, rects-subset) instead of reading globals.)_
- **Scene (draw-list + prop buckets)** — Buckets furniture by chunk; per frame gathers props in visible chunks + all agents + visible parcels, attaches sort-y, returns the y-sorted list. Maintains buckets on prop place/remove. _(reuses: Reuses the EXACT items[]/sort/work-tile/sitPy y-sort logic from frame() lines 807-839, just fed a culled list.)_
- **InputController (was toLocal + listeners)** — Translates pointer events through Camera.screenToWorld; drives pan (drag + edge-pan), zoom (wheel, snap-to-crisp), follow toggle. Dispatches hover/click to WORLD.bodyAt/MAP.propAt in world space. In build mode, computes hoverTile and ghost placement. _(reuses: Reuses the bodyAt/propAt hit calls and the click→onClick callback contract verbatim; only the screen→world conversion changes.)_
- **BuildOverlay** — World-space overlay pass: grid, room outlines, placement ghost, validity tint, hover highlight. Gated by buildMode; zero cost when off. _(reuses: Reuses drawPropHover's bracket/tag idiom and roundRect outline style from drawHazards for room outlines.)_
- **ScreenPasses (vignette/CRT/floaters/HUD)** — Post-camera screen-space passes. Vignette becomes viewport-relative (was world-baked into lightCv); floaters and name tags project via worldToScreen. _(reuses: Reuses the floaters and name-tag code; moves the vignette out of buildLightMap into a per-frame screen gradient (cheap, viewport-sized).)_

**Incremental steps**

- **P1.0 — Introduce an identity Camera + dpr-aware backing store, with the renderer otherwise UNCHANGED (still one whole-buffer blit of the single starter room).** — Camera object (wx=0,wy=0,zoom=fit,centered,clamped to the starter room); frame() calls Camera.apply(ctx,dpr) once; toLocal() replaced by Camera.screenToWorld. Canvas backing store = cssSize*devicePixelRatio. Visual output is pixel-identical to v7 today. · _DoD:_ Golden-image diff: P1.0 frame == v7 frame within AA tolerance at dpr=1 and dpr=2. Click on the starter-room console still opens the right PROPTERM; hover still highlights the right agent. No camera controls exposed yet. · _tests:_ Unit: screenToWorld/worldToScreen are inverses for random points & zooms. Unit: worldToTile matches Math.floor(p/T) used by propAt. Snapshot: render hash unchanged vs baseline.
- **P1.1 — Wrap the bake behind bakeRegion(rect) and a Scene draw-list, still single-chunk.** — buildBase/buildLightMap refactored to bakeRegion(worldRect) that takes a rect-subset and a target ctx (no global reads). frame() builds its item list via Scene.itemsInView(view) instead of the inline loop. One chunk == the whole starter room. · _DoD:_ Output still pixel-identical. The y-sort, work-tile, and sitPy behavior is byte-for-byte the same (occupied seats sort behind sitters; rugs sort low; parcels +6). · _tests:_ Unit: Scene.itemsInView returns the same sorted ids/order as v7's inline build for the starter room. Headless: bakeRegion is idempotent (bake twice -> identical canvas).
- **BUILD.1 — Real chunk grid: split bake into CHUNK=24 cells with APRON, lazy bake on visibility, cull draws to visibleChunks.** — ChunkStore with per-chunk base+light canvases; frame() iterates visibleChunks(view), ensureBaked, drawImage each. Light spill/extrusion continuous across seams via APRON + neighbor source list. · _DoD:_ A 4x-larger test world renders only the chunks under the viewport (assert drawImage count ≈ visible-chunk count, not total). No seam artifacts in floor/wall/light at chunk borders (visual diff across a seam == continuous). · _tests:_ Unit: chunk for a tile = (tx/CHUNK,ty/CHUNK). Unit: visibleChunks(view) set == brute-force rect-intersection set. Perf: frame time flat as world grows from 1 to 16 chunks (only ~9 visible).
- **BUILD.2 — Dirty re-bake wired to world-mutation events.** — ChunkStore.markDirtyTiles + U.bus subscriptions for world:roomPlaced/tilePainted/propPlaced/propRemoved/roomUpgraded. Edited chunk(s) + APRON ring re-bake on next frame; everything else untouched. · _DoD:_ Placing a prop re-bakes exactly the 1-4 affected chunks (assert dirty set). Painting a floor tile updates only its chunk. Upgrading a room (shabby->glorious) re-bakes that room's chunks and the look visibly improves with no full-station rebake. · _tests:_ Unit: markDirtyTiles over a rect flags exactly the overlapping+apron chunks. Integration: emit world:propPlaced -> next frame shows the prop, only its chunks re-baked (bake-count assertion). Regression: an edit in chunk A never alters chunk C's pixels.
- **BUILD.3 — Camera controls: drag-pan, edge-pan, integer-snapped zoom, follow-agent, clamp.** — InputController drives Camera; wheel zoom snapped to crisp scales; drag and edge pan; double-click agent -> followAgent; clamp keeps view in world bounds (centers axis when world < viewport). · _DoD:_ Zoom stays pixel-crisp (no shimmering) at each snap level; pan is smooth and clamped; follow keeps the agent centered without jitter; hit-testing stays correct at every zoom/pan (click the same prop after panning). · _tests:_ Unit: clamp() keeps viewRect ⊆ world for random cams. Unit: zoom snap maps wheel delta to the allowed scale ladder. Integration: screenToWorld after pan+zoom hits the same tile the user clicked (round-trip).
- **BUILD.4 — Build-mode overlay pass + LRU chunk eviction.** — RENDER.setMode('build') enables drawBuildOverlay (grid, ghost, validity tint, room outlines, hover tile). ChunkStore evicts offscreen chunks past an LRU/memory budget and re-bakes them lazily when revisited. · _DoD:_ Ghost snaps to tiles and tints green/red by validity in real time; grid/outlines align under any zoom/pan; switching to play mode costs nothing; memory stays bounded as the station grows (assert live-canvas count ≤ budget). · _tests:_ Unit: ghost validity matches MAP.walkable/footprint-overlap rules. Perf: memory bounded under a 200-chunk world (evicted chunks freed). Integration: revisiting an evicted chunk re-bakes it identically to its pre-eviction pixels.

**Reuse from v7**

- The ENTIRE bake drawing vocabulary is reused: bakeRoomFloor, bakeCorridorFloor, bakeCorridorDressing, bakeWalls, bakeEdgeAO, bakeRoomLighting, bakeHullExtrusion, eraseSpandrel/spandrelPath, the CORNER table + chamfer arcs, and the cut() destination-out radial carve. Chunking changes WHERE/WHEN they run, not WHAT they draw.
- The painter y-sort core (items[] with {y,draw}, the work-tile scan, the sitPy occupied-seat ordering, rug-low and parcel+6 offsets, items.sort) is reused verbatim — it just receives a culled list from Scene.
- sprites.js draw table is untouched: SPR.drawFurn/drawAgent/drawParcel keep emitting world coords; the camera transform relocates them, so the ~50-entry F{} pixel-art table and the agent renderer need ZERO changes.
- The hit-testing contract: WORLD.bodyAt(px,py) and MAP.propAt(tx,ty) operate in world/tile space and are reused as-is; only the screen→world conversion in front of them changes.
- The lightmap concept: per-chunk darkness fill + destination-out radial carve of lamps/doors/windows is the same technique, sourced from the same lampPos/doorDefs/windows data, just scoped per chunk with an apron.
- The click→callback wiring in RENDER.init (onClick(propKey, agentId, pos)) and main.js's handler (UI.openAgent / PROPTERM.open) is preserved — the camera is invisible to that contract.
- CSS layer reuse: image-rendering:pixelated stays; the CRT scan/vignette/mask overlays in #station-frame remain screen-space siblings of the canvas and need no change (the in-canvas vignette moves to a per-frame screen pass).
- Exterior anim (drawExteriorAnim: dish/nav/engine/leds/glints) and drawGlows/drawLabels/drawHazards reused, gaining a view-rect cull argument so offscreen leds/glows are skipped.

**Rebuild**

- toLocal() must be REBUILT: today it only inverts object-fit:contain stretch (clientX*(W/rect.width)); it must become Camera.screenToWorld that also inverts pan+zoom and accounts for devicePixelRatio.
- buildBase/buildLightMap must be REFACTORED from 'read all globals, bake the whole 936xN buffer once, never invalidate' into bakeRegion(rect, ctx) that bakes a clipped subset on demand — the single biggest structural change, and the brief's named #1 obstacle (bake-once, no dirty API).
- The in-lightmap vignette (buildLightMap lines ~330-334, sized to whole W/H) must move OUT of the bake into a screen-space per-frame pass, because it is viewport-relative not world-relative once a camera exists.
- The whole-buffer blit (ctx.drawImage(baseCv,0,0); ctx.drawImage(lightCv,0,0)) is REPLACED by per-visible-chunk drawImage under the camera transform.
- MAP must gain a mutable world model for the builder phase: today zones/blocked/zoneGrid/allRects/furniture are immutable literals built once. The builder needs add/remove room, paint tile, place/remove prop, and grow COLS/ROWS/W/H — emitting the world:* invalidation events. (Coordinate with the world-model/map engineer; the renderer only consumes the events.)
- The canvas backing store must be REBUILT to be dpr-aware and viewport-sized (cv.width = cssW*dpr) instead of the fixed cv.width=W; W=936 currently, which under a camera would force one fixed resolution.
- Star field: currently drawn in fixed world space (0..W). Under a scrollable camera it should move to a screen-space parallax layer so stars don't tile oddly as the world grows beyond 936px.
- frame()'s flat 'iterate ALL furniture + ALL bodies every frame' must be rebuilt into the culled Scene query — this is also the fix for LOOP E's named hotspot (159 props fully repainted at 60fps).

**Polish (customer-grade)**

- Pixel-crisp zoom: snap zoom to a scale ladder (e.g. 1, 1.5, 2, 3, 4) and round the camera translate to whole device pixels each frame so the baked chunks blit on integer boundaries — no sub-pixel shimmer, preserving the signature crisp pixel-art read.
- Seamless chunk borders: an APRON of 8px plus carving light from a neighbor-inclusive source list must make seams invisible; verify by panning a lamp across a border — the pool should not flicker or hard-edge.
- Smooth camera motion: ease pan/zoom and follow with a critically-damped lerp (no overshoot), and edge-pan with a dead-zone so the view doesn't drift when the cursor rests near an edge.
- Build-mode legibility (the core 'layout = your real org' surface): room outlines tinted by the room's DATA accent, ghost validity tint readable even in an unlit new room (overlay sits above lightCv), grid subtle enough not to fight the art (~0.12 alpha cyan), hover tile a crisp 1px white.
- Upgrade arc (shabby->glorious): a room upgrade should re-bake with richer floor decals/lighting and ideally a brief one-shot 'reveal' shimmer (reuse drawGlows' lighter pass) so the improvement reads as an event, honoring GOALS pattern 1 (movement is meaning) and 7 (intensity escalation).
- Truthful camera HUD: the cam-hud label/REC/altitude must reflect real camera state (follow target, zoom) rather than a static 'CAM-01' lie — wire 'cam:moved' so the overlay updates (GOALS pattern 2).
- Maintain the destination-out darkness mood under chunking: new rooms start dim and only light up as fixtures are placed, reinforcing the 'lit, not painted' discipline (GOALS pattern 3) and giving build progression a visible payoff.

**Risks**

- Chunk-seam continuity for the hull extrusion and destination-out light is the highest-risk detail: v7's bakeHullExtrusion stamps the WHOLE silhouette downward and the lightmap carves globally. Getting per-chunk apron + neighbor-source lists to produce seamless results across borders needs careful visual verification (BUILD.1 dod).
- devicePixelRatio + image-rendering:pixelated interaction: pixel-art crispness can shimmer if zoom is not snapped to a scale ladder aligned with dpr. Must snap zoom and round translate to whole device pixels (polish note).
- The CRT mask is a radial-gradient mask on the canvas ELEMENT (style.css:229). Under a camera the masked region is viewport-fixed, which is correct — but the cam-hud/cam-alert overlay assumes a fixed feed; panning/zooming may need the 'CAM-01 STATION OVERWATCH' framing to update or it reads as a lie (GOALS pattern 2: truthful telemetry).
- Memory: a large station with hundreds of chunks each holding base+light RGBA canvases can balloon. LRU eviction (BUILD.4) is essential; without it the builder phase OOMs on big stations.
- Re-bake cost spikes if an upgrade marks many chunks dirty in one frame. Need a per-frame bake budget (bake N chunks/frame, spread the rest) to protect the 60fps target during big edits.
- P1 over-fitting: if the single-room P1 hard-codes any 936x674 assumption (e.g. star count tied to W, vignette centered on W/2) those become latent bugs in the builder. The seams must be honored even where they look like no-ops.
- WORLD.bodyAt uses a fixed 12px pick radius in world px; at high zoom-out the clickable target shrinks on screen, at zoom-in it is fine. May need a screen-space-constant pick radius (convert 12 screen px to world px via /zoom).

**Open questions**

- What is the maximum intended station size (chunk count) for a paying customer's end-game? This sets the LRU/memory budget and whether OffscreenCanvas-in-worker baking is needed to keep bakes off the main thread.
- Does the builder allow non-rectangular rooms or only the rect+chamfer vocabulary v7 already bakes? Non-rect rooms would force the bake loops (which iterate r.x1..r.x2) to be generalized.
- Should the camera follow be a P1 feature (single agent, single room) for the 'watch your agent work' moment, or strictly builder-phase? It's cheap to enable in P1 with an identity-ish camera and may strengthen the spine demo.
- Is the lightmap's shift-night cycle (GOALS LOOP C) in scope? If so, per-chunk light needs a cheap night-multiply pass or a second light blit, which interacts with the chunk cache design.
- Who owns the mutable world model and emits world:* events — the map/world-model engineer? The renderer's dirty system is a pure consumer, but the event schema must be agreed (tile rects vs ids) before BUILD.2.
- Should stars/space be a true parallax layer (depth cue as you pan a large station) or stay a flat screen-space backdrop? Affects whether the camera exposes a parallax factor.

---

## Station-as-Org: Physical layout encodes and configures the real multi-agent workflow graph (rooms = capability-scoped teams, doors/belts = routing & handoffs, object placement = capability grants)

The station is not a skin over the agent org — it IS the agent org, stored as one source-of-truth graph. A Room is a capability-scoped team (an agent's available toolset = the union of the capability-objects placed in its current room, gated per D5's object->capability mapping), a Door/belt edge is an authorized handoff lane (agent A's deliverable physically rides to agent B as a real artifact, reusing v7's parcels/beltInfo), and where the user drags an agent's desk literally sets which team it works in and what it can do. We make this truthful by deriving runtime config FROM the spatial graph (no decorative lies, GOALS.md #2/#10): the Tauri frontend mutates a StationGraph, the Node sidecar consumes a derived, validated AgentOrg snapshot, and every capability call is checked against "is this object physically present in this agent's room?" before the model->tool loop runs it. v1 ships honest at 1 room / 1 agent / objects=that-agent's-tools; the SAME schema scales to N rooms / N agents / real handoff pipelines with zero rewrite because the only thing that changes is graph cardinality, not graph shape.

**Decisions**

- **Make the StationGraph (rooms, objects, agent placements, door/belt edges) the SINGLE source of truth; derive both the rendered world AND the runtime AgentOrg config from it.** — v7's #1 sin (and #1 risk per GOALS.md) is decorative lies — screens showing set-dressing instead of real S state. If layout and runtime config are two separate stores that must be kept in sync, they WILL drift and the metaphor dies. One graph, two pure projections (a render projection ~= today's MAP/furniture arrays; a runtime projection = AgentOrg) makes 'arranging the station configures the agent' a structural guarantee, not a feature we remember to wire. _(alt: Keep layout cosmetic and configure agents in a separate settings panel (rejected: that is exactly the 'decorative lie' the product is built to avoid). Or store config in the graph but let the sidecar read raw graph (rejected: sidecar must not parse tile geometry; it consumes a validated, denormalized snapshot).)_
- **An agent's capability set = the UNION of capability-granting objects in the room it is currently ASSIGNED to (home room), not the room it is physically standing in.** — D5 says the user decides what an agent can do and the object->capability map is the visible control surface. Tying capability to the agent's assigned desk-room (its 'station' in v7 terms) keeps capability stable and legible: you grant code+shell to an agent by placing a terminal in its room, full stop. Tying it to live physical position would mean an agent loses shell access mid-task by walking to the bar — incoherent and unconfigurable. _(alt: Capability follows live body position (rejected: non-deterministic, un-configurable, breaks during leisure/handoff walks). Per-agent capability lists divorced from rooms (rejected: that's a config panel, not a station — abandons the core metaphor).)_
- **A handoff (pipeline edge A->B) is only RUNNABLE if the door graph connects A's room to B's room; the deliverable is carried as a real artifact along that physical path, reusing v7's parcel/belt visuals.** — GOALS.md #1 'movement is meaning' and the brief both demand handoffs map to physical movement. v7 already has parcels[], beltInfo, and onDeliverable() hand-carrying work to HERALD — we generalize that one hardcoded route into a routed edge over the existing path()/canStep/doorSet graph. Connectivity gating makes the door graph load-bearing: cut a corridor and you sever a pipeline, which is a true, legible consequence. _(alt: Allow logical handoffs regardless of connectivity, animate a 'teleport' (rejected: decorative lie — the movement would not reflect a real constraint). Require a literal conveyor belt object for every handoff (deferred: belts are the v1 intra-factory visual; corridor hand-carry is the general case).)_
- **Gate capabilities at the existing directive-router seam (sim.js:566 INTENTS -> mkTask({agentId})), replaced in 'gen' by the sidecar's tool-dispatch layer. The bridge keeps emitting the SAME U.bus events the frontend already listens for.** — The brief's big bet is to keep v7's canvas/U.bus and replace fake sim.js with a real-runtime bridge re-emitting REAL events on the same names ('task','deliverable','intel','flagged','parcel','chat'). The capability check belongs exactly where the fake router today picks an agent and makes a task. The frontend never knows whether the event came from a sim or a real model call — that's the whole point of the bridge. _(alt: New event vocabulary for real runtime (rejected: forces a frontend rewrite, abandons the kept-canvas bet). Check capabilities inside the model loop only (insufficient: routing/handoff legality must be known before work starts, to show the user why an order can't run).)_
- **v1 = ONE fixed starter room, ONE agent, objects in that room = that agent's tools, ZERO inter-agent handoffs. Multi-agent orchestration (pipelines, routing, scheduled cross-room handoffs) is an explicit deferred phase.** — Locked decision D8: P1 keeps one fixed room to prove the real-agent-work spine first; the builder is its own phase after P1. Real inter-agent orchestration is the single biggest scope jump in the product (per the brief's own note). The schema below is designed so v1 is literally the N=1 case of the full graph — RoomId/AgentId/CapabilityGrant exist in v1, there's just one room and an empty PipelineEdge set. _(alt: Ship v1 with stubbed multi-agent (rejected: violates 'no decorative lies' and the slow/test-backed mandate — a fake pipeline is worse than no pipeline). Design v1 schema only for 1 agent and refactor later (rejected: paints us into a corner the process mandate forbids).)_

**Data structures**

- // ===== THE SINGLE SOURCE OF TRUTH (Tauri frontend owns, SQLite persists) =====
// StationGraph: everything spatial AND organizational lives here. Render projection
// and runtime AgentOrg projection are both PURE functions of this.
type StationGraph = {
  version: number;
  rooms: Record<RoomId, Room>;
  objects: Record<ObjectId, PlacedObject>;   // furniture instances, incl. capability-granting ones
  agents: Record<AgentId, AgentPlacement>;   // an agent's identity is in DB; its PLACEMENT is here
  edges: PipelineEdge[];                      // authorized handoff lanes (v1: empty array)
  doors: DoorEdge[];                          // derived-ish: which room boundaries are passable
};
- // A Room = a capability-scoped team zone. In v7 terms this is zones[zoneId] + its members.
type Room = {
  id: RoomId;
  rect: { x1:number; y1:number; x2:number; y2:number }; // inclusive tiles, exactly v7 zones{} shape
  name: string;
  trigger: { mode: 'pull' | 'scheduled'; cron?: string }; // D4: per-room run policy; default 'pull'
  // capabilitySet is DERIVED, never stored: union of CAPABILITY objects whose tile is in this rect
};
- // PlacedObject = a furniture instance. The subset with `grants` are the capability control surface (D5).
type PlacedObject = {
  id: ObjectId;
  type: string;            // v7 furniture 't' (e.g. 'terminal','desk2','comms_inbox','pixelrig')
  x:number; y:number; w:number; h:number;   // tile footprint, exactly v7 furniture shape
  grants?: Capability;     // present => this object grants a capability to its room's agents
  config?: Record<string,unknown>; // e.g. {shellScope:'jailed'|'full'}, {webAllowlist:[...]}
};
type Capability =
  | { kind:'model'; provider:'openrouter'; model:string }
  | { kind:'shell'; scope:'jailed'|'full' }
  | { kind:'files'; root:string }            // jailed per-agent workspace dir by default
  | { kind:'web';   allowlist?:string[] }
  | { kind:'image'; provider:string }
  | { kind:'comms'; channels:string[] };
- // AgentPlacement = where this agent lives (which team) + its escalation posture. Identity (name,
// persona, model creds) is a DB row; placement is graph state the user drags around.
type AgentPlacement = {
  agentId: AgentId;
  roomId: RoomId;          // assigned home room == v7 stations[] desk's room. Sets the TEAM.
  seatObjectId: ObjectId;  // the desk/chair it occupies (its v7 'station' tile)
  fullAccess: boolean;     // D5 escalation: true => skip per-action prompts for this agent
  autonomy: boolean;       // D4: per-agent autonomy opt-in, default false
};
- // PipelineEdge = an authorized handoff. 'A finishes a deliverable of kind K -> hand to B as B's input.'
// v1: edges == [] (no inter-agent work). The carry visual already exists (parcels/belt).
type PipelineEdge = {
  id: EdgeId;
  fromAgent: AgentId;
  toAgent: AgentId;
  whenKind: string;        // deliverable kind that triggers the handoff (v7 DATA.KINDS key)
  // RUNNABLE iff doorPathExists(fromRoom, toRoom) over DoorEdge graph (canStep/doorSet analog)
};
type DoorEdge = { a:RoomId; b:RoomId; tiles:[number,number][] }; // passable boundary, drives canStep
- // ===== DERIVED RUNTIME SNAPSHOT (sidecar consumes; sidecar NEVER reads tile geometry) =====
// Pure projection: deriveAgentOrg(StationGraph) -> AgentOrg. Re-derived on any graph mutation,
// validated by a headless gate (GOALS.md #9) before the sidecar accepts it.
type AgentOrg = {
  agents: Record<AgentId, {
    roomId: RoomId;
    capabilities: Capability[];       // == union of grants of CAPABILITY objects in roomId
    triggers: { pull:true; cron?:string };
    fullAccess: boolean; autonomy: boolean;
  }>;
  routes: Record<AgentId, { whenKind:string; to:AgentId; lane:RouteLane }[]>; // only RUNNABLE edges
};
type RouteLane = { path:{x:number;y:number}[]; via:'belt'|'corridor' }; // precomputed for the carry anim
- // ===== THE GATE the real model->tool loop runs on every tool call =====
function canAgentUse(org:AgentOrg, agentId:AgentId, need:Capability): 
  { ok:true } | { ok:false; reason:'no-object'; suggest:'place a '+string } {
  const caps = org.agents[agentId].capabilities;
  const has = caps.some(c => capMatches(c, need));
  if (!has) return { ok:false, reason:'no-object', suggest:'place a '+objectTypeFor(need)+' in '+org.agents[agentId].roomId };
  return { ok:true }; // then: per-action consent prompt unless fullAccess (D5)
}
- // ===== BRIDGE EVENTS: identical names to v7 U.bus, now emitted by REAL runtime =====
// task     {id, agentId, kind, title, status}        // a real run started
// deliverable {id, agentId, room, kind, title, flavor} // real artifact produced -> triggers carry
// intel    {agentId, dest}                            // A briefs B (existing planBriefing hook)
// flagged  {agentId}                                  // real run needs Commander review
// parcel   {room}                                     // carry visual tick (existing)
// chat     {from, txt}                                // real agent message
// NEW (additive, frontend-optional): 
// route    {edgeId, fromAgent, toAgent, lane}         // a handoff began; drives cross-room parcel
// capdenied{agentId, need}                            // blocked for missing object -> UI nudge

**Components**

- **StationGraph store (Tauri/frontend)** — Owns the single source-of-truth graph; every builder action (place room, drag desk, place object, draw door, connect pipeline) is a typed mutation against it; persists to SQLite and emits change events. _(reuses: Mirrors the SHAPE of MAP.zones{}, MAP.furniture[], MAP.stations{}, MAP.doorDefs[] — same rect/footprint/tile conventions, so the existing render bake loops over allRects/furniture port almost unchanged.)_
- **deriveAgentOrg() projector** — Pure function StationGraph -> AgentOrg: computes each agent's capability union from in-room grant-objects, resolves which PipelineEdges are RUNNABLE via door-path reachability, precomputes RouteLanes. No side effects; trivially testable. _(reuses: Reachability reuses MAP.canStep/doorSet/path() logic; RouteLane path reuses MAP.path(); capability-in-room uses the zoneGrid/roomAt tile->room lookup.)_
- **renderProjection() / world builder** — Pure function StationGraph -> the arrays the canvas bakes (zone rects, furniture list, agent seats, windows). Lets the existing offscreen baseCv/lightCv pipeline draw a USER-BUILT station. _(reuses: This IS v7's MAP/map.js data, but sourced from the graph instead of literals. buildBase, lightmap carve, drawFurn, propAt/pwGrid all consume its output unchanged.)_
- **Capability gate (sidecar)** — canAgentUse() check run before every real tool dispatch in the model->tool->stream loop; on fail emits 'capdenied' and (if not fullAccess) raises the per-action consent prompt. _(reuses: Slots in at the exact seam where v7's INTENTS router (sim.js:566) chose an agent and called mkTask — that decision point becomes 'can this agent's room do this?')_
- **Bridge (sidecar <-> frontend over localhost WS)** — Re-emits REAL runtime events onto v7 U.bus names ('task','deliverable','intel','flagged','parcel','chat') + additive 'route'/'capdenied'; pushes AgentOrg snapshots to sidecar on graph change. _(reuses: The entire frontend U.bus subscriber set (agents.js init() listeners for deliverable/flagged/intel/parcel/chat) keeps working verbatim — the kept-canvas bet.)_
- **Handoff router / carry sequencer** — On a real 'deliverable' that matches a RUNNABLE PipelineEdge, schedules the carry: spawns a cross-room parcel along the RouteLane and runs the body plan to walk it to the recipient. _(reuses: Generalizes onDeliverable()'s hardcoded belt->HERALD plan into an edge-driven plan; reuses beltInfo, the parcels[] ride loop, the plan-sequencer {go/face/do/wait} steps, and standNearTile.)_
- **Org validator (headless gate)** — Asserts graph<->org invariants before a snapshot is accepted: every agent has a seat in a real room, every CAPABILITY object resolves, every declared PipelineEdge is connectivity-RUNNABLE or is flagged un-runnable to the UI. Exits non-zero in CI. _(reuses: Extends validate_map.js (the GOALS.md #9 'stated rules harden into validators' discipline) with org-level asserts alongside its existing map asserts.)_

**Incremental steps**

- **Define StationGraph + AgentOrg types and the deriveAgentOrg() projector as a standalone, pure, headless module (no canvas, no sidecar).** — src/org/graph.ts + src/org/derive.ts with the full schema above; a fixture StationGraph for the v1 starter (1 room, 1 agent, 1 model-object + 1 terminal-object). · _DoD:_ deriveAgentOrg(v1Fixture) returns the expected single-agent capability set; 100% of derive branches covered; module imports nothing from canvas/sidecar. · _tests:_ Unit: derive() yields exactly the union of in-room grants; agent with no terminal has no shell cap; adding a terminal object to the room adds shell; out-of-room objects grant nothing. Snapshot-test the v1 fixture's AgentOrg.
- **Build renderProjection(StationGraph) and feed it into the existing v7 bake pipeline so the canvas draws the v1 starter room FROM the graph (not from map.js literals).** — A starter station rendered by the real bake (baseCv/lightCv) where zones/furniture/seat came from the graph fixture. · _DoD:_ node validate_map.js + test_world.js exit 0 on the projected map; preview shows the one starter room with the agent at its desk. · _tests:_ Golden-image / preview_eval smoke (GOALS.md cadence): the graph-driven starter renders pixel-identical to a hand-authored equivalent; validate_map-style asserts pass on the projected arrays (door lanes walkable, no furniture on windows).
- **Wire the capability gate into the sidecar's real model->tool loop: before any tool dispatch, canAgentUse(org, agent, need); on deny emit 'capdenied' and (unless fullAccess) raise the per-action consent prompt (D5).** — A real agent run that calls a tool ONLY if the granting object is in its room; a missing-object denial surfaces as a UI nudge ('place a terminal'). · _DoD:_ A real (or recorded) OpenRouter call runs end-to-end through the gate; denial path emits capdenied and blocks the tool; consent prompt fires exactly once per action when not fullAccess. · _tests:_ Integration with a mock tool: web call denied when no comms-object present, allowed after placing one; fullAccess=true skips the prompt; jailed-files root enforced. Assert the SAME U.bus event names reach a fake frontend listener.
- **Make the builder mutations live: dragging the agent's desk to a different (future) room, and placing/removing a capability object, re-derive AgentOrg and hot-push it to the sidecar — proving 'arrangement configures behavior' on the v1 single room (place terminal -> agent gains shell, visibly).** — In-app: place a terminal in the starter room and the agent's next run can use shell; remove it and the next run is denied — no settings panel touched. · _DoD:_ Round-trip (UI mutation -> derive -> validate -> sidecar -> gated behavior) is green and persisted across app restart via SQLite. · _tests:_ E2E: mutate graph -> validator passes -> sidecar receives new snapshot -> next tool dispatch reflects new capability. Validator rejects an agent whose seat object was deleted.
- **[DEFERRED PHASE — multi-agent] Introduce a SECOND room + second agent + one PipelineEdge, and the handoff carry: a real deliverable of the edge's kind is carried room-to-room along a door-connected RouteLane to the recipient, who then runs on it as input.** — Agent A (room 1) produces -> parcel rides the corridor/belt -> Agent B (room 2) receives and starts a real run; cutting the door between rooms makes the edge un-runnable and the UI says why. · _DoD:_ A two-agent pipeline runs a real handoff end-to-end; severing connectivity disables it with a legible reason; no rewrite of v1 schema was needed (N=2 case of the same graph). · _tests:_ deriveAgentOrg marks the edge RUNNABLE only when doorPath exists; removing the DoorEdge flips it un-runnable; carry plan reuses parcels/path and arrives at B's seat; 'route' event drives the cross-room parcel.

**Reuse from v7**

- MAP.zones{} rect shape, allRects[], chamfers[], furniture[] footprint convention — Room.rect and PlacedObject reuse these exactly so the existing offscreen bake loops port unchanged.
- MAP.pwGrid + propAt() prop->tile hit-testing — becomes the object->capability legibility surface (hover an object to see the capability it grants).
- MAP.doorSet / canStep() / path() / zoneGrid / roomAt() — the connectivity & reachability engine that decides whether a PipelineEdge is RUNNABLE and computes RouteLanes.
- MAP.stations{} agent-seat binding — becomes AgentPlacement.seatObjectId + roomId (an agent's desk IS its team membership).
- WORLD parcels[] + beltInfo + onDeliverable() carry plan + the {go/face/sit/wait/do} plan-sequencer + standNearTile — the handoff carry visual, generalized from the hardcoded HERALD route to any edge.
- U.bus event vocabulary ('task','deliverable','intel','flagged','parcel','chat','sale','stats') and ALL frontend subscribers in agents.js init() — kept verbatim; the real bridge emits the same names (the core kept-canvas bet).
- sim.js INTENTS router (the {agentId, kind} decision at line 566) — the exact seam where capability/room gating intercepts in the real sidecar.
- validate_map.js + test_world.js headless gates — extended with org<->graph invariants (GOALS.md #9 'rules harden into validators').
- DATA.ROOMS/DATA.AGENTS/DATA.KINDS metadata shape — the human-facing labels/icons for rooms, agents, and deliverable kinds carry over to the graph's display fields.

**Rebuild**

- sim.js fake economy/task simulation -> a real Node-sidecar model->tool->stream loop; mkTask/minuteTick progress become real run lifecycles emitting the same 'task'/'deliverable' events.
- map.js as hardcoded literals -> StationGraph as mutable, persisted source of truth with renderProjection() feeding the (otherwise reused) bake. The bake-once design must gain a re-bake-on-graph-change trigger (currently re-bakes only if baseCv is null — this is the #1 obstacle to runtime building and must be addressed when the builder phase lands, NOT in v1 which keeps one fixed room).
- The implicit, scattered 'which agent does what' (PERS table, stations{}, INTENTS agent field, room desc strings) -> one explicit AgentOrg derived from placement, so the org is editable by arrangement rather than buried in literals.
- Per-action safety: today nothing is gated -> per-action consent prompts + jailed workspace dirs + the fullAccess escalation (D5), enforced by the capability gate.
- Persistence: single localStorage JSON blob -> SQLite with the StationGraph + agent identities as first-class rows.

**Risks**

- Bake-once with NO dirty-region/invalidation API is the #1 obstacle to runtime building (per the brief). v1 sidesteps it (one fixed room), but the deferred builder phase MUST add re-bake-on-graph-change or incremental tile invalidation, or expansion will be unusably slow / stale. Flag this as the gating technical risk for the builder phase.
- Capability-by-assigned-room vs body-position can confuse users ('my agent is standing in the Dev Bay but can't code?'). Mitigate with a clear UI rule: capability follows the DESK, and movement (handoffs/leisure) never changes it. Must be taught in onboarding.
- PipelineEdge RUNNABLE-ness depends on the door graph; a user can silently break a pipeline by deleting a corridor. Without a loud, legible 'this pipeline is severed' signal this becomes a confusing dead workflow (violates 'no decorative lies').
- Scope creep into real orchestration: inter-agent handoff with real artifacts as real inputs is genuinely hard (artifact format contracts, partial failures, recipient capability mismatch). Keeping it strictly DEFERRED and shipping v1 as the honest N=1 case is the safe path — resist pressure to fake it.
- Deriving AgentOrg on every graph mutation must stay cheap and total; an un-validated or partially-derived snapshot reaching the sidecar could grant or deny the wrong real capability (a security-relevant correctness bug). The headless validator gate is non-negotiable before any snapshot is accepted.
- Frontend U.bus expects specific event payload shapes; the real bridge must match them precisely or subscribers (e.g. agents.js onDeliverable needing {room, agentId}) silently no-op. Needs a contract test asserting payload shape per event name.

**Open questions**

- Capability granularity: is one terminal object = full shell, or do distinct objects grant distinct shell scopes (jailed vs full)? The schema supports config.shellScope, but the v1 object catalog and its object->capability table need to be authored explicitly.
- When two objects in a room grant the SAME capability with DIFFERENT config (e.g. two terminals, one jailed one full), what wins — most permissive, most restrictive, or last-placed? Needs a deterministic merge rule in deriveAgentOrg.
- Should a room have a capability CEILING the user can't exceed, or is it pure union per D5 full-sandbox? (Brief says no artificial ceiling — confirm the only gate is object-presence + per-action consent, nothing room-type-locks a capability out.)
- For the deferred handoff phase: what is the artifact contract between producer kind and consumer input? (v7 deliverables are flavor strings; real handoffs need a typed payload the recipient agent can actually consume.)
- Scheduled triggers (D4) per-room vs per-agent vs per-edge: does cron live on Room.trigger, on AgentPlacement, or on PipelineEdge? Current schema puts pull/cron on Room and autonomy on AgentPlacement — confirm that division matches how users will think about scheduling work.
- Does removing an agent's seat object (or its room) need a 'homeless agent' safe state, or is it forbidden by the validator? Current design forbids it via validator — confirm that's the desired UX vs allowing a temporarily-unassigned agent bench.

---

## Foundation Discipline: Architecture Boundaries, Event-Schema Contract, Testing, Save Versioning/Migration, Resilience/Safety/Observability, and the Granular Test-Gated Build Cadence (the "Definition of Done" engine)

This pillar is the spine that makes every other pillar shippable: it converts the locked stack and Phase 0-4 plan into a discipline where nothing lands except as a tiny, individually-revertable, test-gated increment with a crisp Definition of Done. The load-bearing decision is to treat the U.bus/WebSocket vocabulary as a versioned, validated CONTRACT defined once in shared/events.js and enforced at BOTH ends, so the v7 frontend stays reused-verbatim while gaining a clean seam where fake SIM is replaced by a real event source. Around that contract we erect four pure/IO seams (world-model core / renderer / behavior / sidecar), each independently testable; a layered test pyramid that extends v7's exact headless precedent (test_world.js boots the IIFEs via eval with a stubbed U and asserts walkability + behavior-coverage + save-round-trip invariants; validate_map.js asserts layout invariants); a save-schema with an explicit integer version and a forward-only migration ladder from day one (v7 today has only an implicit v:1 localStorage blob — customers' stations and agent configs must survive every update); and resilience/secret-handling/observability appropriate to an app that spends real money and runs real code. The meta-cadence below is the product: a repeatable per-increment loop and a 12-point DoD checklist that makes "go slow, one small verified step, maximum polish" mechanical rather than aspirational.

**Decisions**

- **Define the entire U.bus/WS event vocabulary ONCE in shared/events.js as the single source of truth, with a frozen registry of event names + payload validators, imported unchanged by both the frontend bridge and the Node sidecar.** — v7 is already a pure event-bus architecture (U.bus.emit/on in util.js); the central bet is that the frontend keeps listening to the same names while the source changes from fake SIM to real sidecar. If the names/shapes live in two places they WILL drift across a localhost socket and produce silent, type-unsafe corruption. One frozen module, imported both sides, makes the contract auditable and diffable in code review. _(alt: Ad-hoc string literals in each file (status quo in v7 — fine for one in-process bus, fatal across a process boundary); a heavyweight IDL like protobuf/JSON-Schema codegen (correct long-term but over-tooled for a vanilla-JS reuse target and would fight the IIFE frontend).)_
- **Validate every event payload at the process boundary in BOTH directions: the sidecar validates before it sends, the bridge validates on receive before it touches U.bus.emit (and symmetrically for user->host commands). Validation failures are dropped + logged, never thrown into the render loop.** — The webview runs real-money, real-code telemetry; a malformed agent.cost or agent.token must never crash frame() or poison the ledger. U.bus.emit already swallows handler exceptions per-listener (util.js line 64) — we extend that same defensive posture to the wire. Boundary validation is also the cheapest contract test we can write. _(alt: Trust the wire (unacceptable for a shipped app spending money); validate only on receive (misses sidecar-side regressions that ship to customers).)_
- **Every save file carries an explicit integer schemaVersion at the TOP LEVEL, and load goes through a forward-only migration ladder migrate(blob): vN -> vN+1 -> ... -> current, with a one-shot pre-migration backup copy of the file.** — v7's save is a single localStorage JSON blob with only an internal S.v:1 and an idc id-counter (SIM.serialize/load) — no top-level version, no migration path. The moment we ship SQLite-backed stations + agent configs to paying customers, an app update that changes a shape will silently brick their built station. A versioned forward-only ladder with a backup is the minimum discipline that lets us evolve schemas without data-loss incidents. _(alt: Best-effort lazy defaulting (what v7 does today: 'if (!S.kindStats) S.kindStats={}' scattered in init — works for additive fields, fails for renames/restructures and is untestable); bidirectional migrations (unneeded complexity — we never downgrade a customer).)_
- **Adopt a fixed per-increment loop and a 12-point Definition-of-Done checklist as the unit of work; an increment is not 'done' until every box is checked, and the next increment does not start until the current one is committed green.** — The mandate is explicit: go slow, smallest shippable pieces, one at a time, each test-backed, maximum polish, hard to paint into a corner. That only holds if 'done' is mechanical, not a judgement call. A checklist converts the mandate into a gate a subagent or CI can enforce. _(alt: Phase-level DoD only (the plan already has these, but a phase is too coarse to be safe — a phase can hide a dozen risky leaps); trust-the-engineer (the thing the mandate explicitly distrusts).)_
- **Keep the four core layers split by PURITY, not by feature: (1) world-model core = pure, no DOM, no Date.now, no Math.random-without-injected-rng; (2) renderer = DOM/canvas IO only, reads the model; (3) behavior/WORLD = pure-ish given injected clock+rng; (4) sidecar = all secret/network/disk IO. The bridge + shared/events.js are the only things both worlds touch.** — v7 already accidentally proves this is testable: test_world.js boots map/sim/agents headlessly because they have no hard DOM dependency, only a stubbed U. We make that accidental property a DESIGN INVARIANT so the world-model and behavior layers stay unit-testable forever, and so the renderer's bake-once obstacle stays quarantined behind an explicit invalidate() seam rather than leaking timing assumptions into the model. _(alt: Layer by feature/room (couples pure logic to IO and destroys headless testability — the single most valuable property we inherited from v7).)_
- **Determinism is a first-class requirement: thread an injected clock (nowMs) and a seedable RNG through the world-model and behavior layers; ban bare Math.random()/Date.now() there. The sidecar's real-call layer is explicitly NON-deterministic and is tested with recorded fixtures/mocks instead.** — v7's headless test already injects tMs and steps SIM/WORLD by hand, but leans on Math.random via U.rnd; that makes coverage assertions flaky ('no pool sessions happened' can fail by luck). A seeded RNG turns the deterministic-sim harness into a reproducible regression oracle and lets us record-and-replay a real agent run as a fixture for contract tests without spending money. _(alt: Keep ambient randomness (flaky tests, irreproducible bug reports from customers); make the sidecar deterministic too (impossible — real model calls are non-deterministic; mock at the provider-adapter boundary instead).)_

**Data structures**

- see dataStructures field above (events registry, SaveEnvelope+migration ladder, Increment record, injected clock/rng) — repeated here only as pointer

**APIs / interfaces**

- shared/events.js: validate(name, payload) -> payload | throws; EVENTS registry (frozen); SCHEMA_VERSION:int
- bridge.js: BRIDGE.connect(port,token); BRIDGE.send(name,payload) (validates c2h then WS); internally on(WSmsg)=> validate(h2c) then U.bus.emit(name,payload)
- WorldModelCore: MAP.addObject(inst)->{ok,err}; MAP.moveObject(id,tile); MAP.removeObject(id) — each patches zoneGrid/blocked/sitTiles/pwGrid and returns whether a re-bake is needed
- render.js: RENDER.invalidate(opts?) (nulls baseCv/lightCv to force re-bake via existing if(!baseCv) gate); RENDER.toLocal(ev) extended for camera
- sidecar/db: loadSave(raw)->SaveEnvelope (runs migration ladder + backup + validate); saveSave(envelope)->raw; CURRENT_SCHEMA_VERSION
- TestHarness: bootHeadless({seed,clock}) -> {U,MAP,WORLD,SIM-or-bridgeStub}; assertInvariants(world); replayFixture(name) for recorded real runs
- determinism: WORLD.tick(dtMs, nowMs, rng); makeClock(); makeRng(seed) — injected, no ambient Math.random/Date.now in core/behavior

**Components**

- **shared/events.js (EventContract)** — The single frozen registry of event names + payload validators + SCHEMA_VERSION. Imported unchanged by the bridge and the sidecar. The diff surface for any wire change — a PR that touches it triggers the contract-test suite. _(reuses: Mirrors the v7 U.bus event names already in use (chat, task, sale, deliverable, parcel, flagged, intel, stats, level, day) so reused listeners in agents.js/render.js/ui.js bind without renaming; new agent.run.*/agent.cost/world.mutate.*/build.*/permission.* are added alongside.)_
- **bridge.js (BridgeAdapter)** — Replaces SIM as the event SOURCE. Owns the localhost WS client; validates inbound host events against the contract then re-emits onto U.bus under the same names; validates+forwards user actions (directive/build/permission/cancel) back to the host. The one file that converts 'real' into 'what the frontend already understands'. _(reuses: Emits onto the exact U.bus from util.js; keeps SIM.S-shaped read accessors where ui.js/agents.js read them, so the frontend can't tell the source changed.)_
- **WorldModelCore (map.js extracted-pure region)** — Pure tile/zone/walkability/path state + the NEW mutable API (addObject/moveObject/removeObject) that incrementally patches zoneGrid/blocked/sitTiles/pwGrid and signals the renderer to invalidate. No DOM, no clock, no RNG except injected. Fully unit-testable headlessly. _(reuses: path()/walkable()/canStep()/roomAt()/propAt()/randomSpotIn()/idx() verbatim; the furniture[]->grid build loop becomes the body of addObject().)_
- **Renderer invalidation seam (render.js)** — Isolate the bake-once obstacle behind an explicit invalidate() that nulls baseCv/lightCv so the existing 'if(!baseCv) buildBase()' gate (render.js:802) re-bakes on the next frame. Extend toLocal() (render.js:876) to invert a camera transform later without leaking camera state into the model. _(reuses: buildBase()/buildLightMap()/frame()/toLocal() kept; we add one null-and-rebake call site, not a new render path.)_
- **TestHarness (extends test_world.js / validate_map.js)** — The headless boot+invariant engine: loads the IIFEs via eval with a stubbed U, injects clock+seeded-rng, runs hours of deterministic world time, asserts walkability/no-strand/no-lost-deliverable/save-round-trip + behavior coverage; plus a NEW contract-suite that round-trips every event through validate(), and a record/replay fixture runner for real agent runs. _(reuses: test_world.js boot pattern, walkability + save-round-trip + coverage assertions; validate_map.js layout assertions (in-bounds, doors clear, stations sittable+reachable, every room has free floor) — extended to validate runtime-placed objects, not just static furniture[].)_
- **SaveMigrator (sidecar/db)** — Owns schemaVersion, the forward-only migration ladder, the one-shot pre-migration backup, and structural validation of a loaded save before it reaches game code. The discipline that keeps customer stations alive across updates. _(reuses: SIM.serialize/load shape + the idc id-counter restore; replaces the scattered lazy-default guards (if(!S.x)S.x={}) with explicit, tested migration steps.)_
- **Observability+Resilience spine (sidecar)** — Structured, redacted logging (secrets/keys/prompt-content never logged at info); error boundaries around every real call and every bus handler; durable RunJob recovery on sidecar restart; a kill-switch + spend backpressure surfaced as events. Defines what 'crash recovery' means per layer. _(reuses: U.bus.emit's per-handler try/catch (util.js:64) as the renderer-side error-boundary precedent; v7's reload-safe shipQueue/heraldHandoff idempotency pattern as the model for durable, never-lost real jobs.)_

**Incremental steps**

- **META-1: Stand up the contract + boundary validation BEFORE any real call. Create shared/events.js with the frozen registry and validate(); wire the stub bridge (Phase 0) to validate every emit/receive against it.** — shared/events.js + a contract-test suite that round-trips every registered event through validate() with one valid and one invalid fixture each. · _DoD:_ Both ends import the same module; an intentionally malformed payload is dropped+logged, never thrown; CI fails if any event name is emitted that isn't in the registry. This is the gate that makes the 'swap SIM for an event adapter' bet safe. · _tests:_ contract:* (per-event valid/invalid), plus a lint that greps for U.bus.emit('...') names not in EVENTS
- **META-2: Make the world-model + behavior layers deterministic. Inject clock+seeded-rng; ban bare Math.random/Date.now in map.js/agents.js core paths; convert test_world.js to seed-driven.** — makeClock/makeRng injected through WORLD.tick; test_world.js runs identical output across two runs of the same seed. · _DoD:_ Two consecutive harness runs with the same seed produce byte-identical coverage stats (no luck-based pass/fail); a deliberately wrong seed assertion fails loudly. · _tests:_ world.behavior (seeded, reproducible), determinism:double-run-equal
- **META-3: Establish the save-version ladder with a no-op v0->v1 migration and a backup-on-migrate, BEFORE the schema can change. Wrap v7's serialize/load in the SaveEnvelope.** — loadSave/saveSave with schemaVersion, MIGRATIONS map, pre-migration backup, structural validateSave. · _DoD:_ A legacy (versionless) v7 blob loads, gets a backup written, lands at CURRENT, and round-trips stably; a corrupt blob is rejected without crashing; every migration step has its own unit test. · _tests:_ save.migrate (legacy->current, corrupt-reject, round-trip-stable), one test per ladder rung
- **META-4: Define the per-increment loop as an executable checklist and a CI gate. Encode the 12-point DoD; make 'one increment = one revertable commit touching <=3 files' the rule.** — A DoD checklist file + a CI job that runs lint+contract+world.behavior+save.migrate on every commit and blocks merge on red. · _DoD:_ A trial increment (e.g. rebind one seam) passes all 12 points and is revertable in one commit; CI is red if any suite fails or if the increment touched too broad a surface. · _tests:_ the full fast suite must run green in CI on the trial increment
- **META-5: Add the resilience+observability spine as a gate, not an afterthought. Error boundaries around every real call + bus handler; structured redacted logging; durable RunJob recovery; kill-switch + spend backpressure events.** — A logging+redaction util, a RunJob recovery test (kill sidecar mid-run, reload, assert no double-charge / no lost deliverable), and a contract for permission.prompt/run.cancel. · _DoD:_ Secrets/prompt-content never appear in logs at info level (asserted by a redaction test); a sidecar crash mid-run recovers without re-billing or losing a deliverable (mirrors v7 shipQueue idempotency); a cancelled run fires NO paid action and marks nothing shipped. · _tests:_ resilience:crash-recovery, safety:redaction, contract:permission/cancel, idempotency:no-double-charge
- **META-6: Add the visual/smoke gate so 'maximum polish' is verifiable per increment, not just at phase end. A scripted launch + headless screenshot/console-clean check on the reused frontend.** — A smoke runner that boots the app, drives one stub or real run, screenshots, and asserts zero console errors + the station rendered. · _DoD:_ Every increment that touches the frontend produces a clean screenshot with no console errors and visually-unchanged baseline (unless the increment's intent is a visual change, in which case the baseline is updated deliberately). · _tests:_ smoke:boot-render-clean, visual:baseline-diff

**Reuse from v7**

- The U.bus pub/sub itself (util.js) — the architecture's spine; the contract wraps it, never replaces it
- test_world.js headless boot pattern (eval the IIFEs with a stubbed U, step SIM/WORLD by injected tMs) — becomes the world.behavior + contract harness base
- test_world.js invariant set: walkability-every-tick, no-strand-in-walk-state, save serialize->load->serialize stability, behavior-coverage counts, party round-trip — kept and extended to placed objects
- validate_map.js layout invariants (furniture in-bounds/on-floor/no-overlap, doors walkable, stations sittable+reachable-from-hub, every room has free floor) — extended from static furniture[] to runtime ObjectInstances
- SIM.serialize/load shape + the U._id/idc counter restore — wrapped in the versioned SaveEnvelope
- v7's reload-safe shipQueue + idempotent heraldHandoff (a deliverable is never lost across reload/party) — the exact pattern for durable, never-double-charged real RunJobs
- U.bus.emit's per-handler try/catch (util.js:64) — the renderer-side error-boundary precedent generalized to the wire
- The bake-once gate 'if(!baseCv) buildBase()' (render.js:802) — kept as-is, fronted by an explicit invalidate() rather than rewritten

**Rebuild**

- A formal event CONTRACT module (shared/events.js) + two-way boundary validation — v7 has only loose in-process string events; cross-process needs a frozen, validated registry
- Save schema VERSIONING + a forward-only migration ladder + pre-migration backup — v7 has only an implicit S.v:1 with scattered lazy-default guards; this is a from-scratch discipline
- Determinism injection (clock + seeded RNG) into world-model/behavior — v7 leans on ambient Math.random, which makes coverage tests luck-dependent; rebuild to seeded for reproducible gates
- A contract-test suite + record/replay fixtures for real agent runs (so we test the streaming/cost chain without spending money) — no precedent in v7 (its sim is fully fake)
- Structured, REDACTED logging + a redaction test — v7 logs freely to console with no secrets to protect; a real-secrets app needs redaction as a tested invariant
- Crash-recovery / durable-RunJob tests across a real process boundary — v7's reload safety is in-page only; rebuild for the sidecar restart case
- The CI gate + 12-point DoD checklist + 'one increment = one revertable commit' rule — process infrastructure that doesn't exist yet
- A smoke/visual baseline gate against the reused frontend — v7 has no automated visual check; needed to make per-increment 'polish' verifiable

**Polish (customer-grade)**

- 'Polished' for this pillar means the contract is so legible that a reviewer can read shared/events.js and know the entire frontend<->host vocabulary in one screen — no hunting through files for emit strings.
- The fast test suite must stay FAST (target <10s for lint+contract+world.behavior+save.migrate) or the per-increment gate gets skipped under pressure — speed is a polish requirement, not a nicety.
- Every error path is boring and recoverable: a dropped malformed event, a crashed sidecar, a cancelled run, a corrupt save — each has a tested, logged, no-data-loss outcome and the customer never sees a stack trace.
- The DoD checklist is short enough to actually run every time (12 points, each a yes/no), and CI enforces the non-judgement ones automatically so the human only judges the few that need taste.
- Redaction is invisible-but-provable: logs are useful for debugging yet a test guarantees no key/prompt/PII ever lands in them.
- Migrations are a non-event for customers: they update, their station opens exactly as they left it, and if anything went wrong the pre-migration backup makes it a restore, not a support ticket.

**Risks**

- Contract drift if anyone bypasses validate() and emits a raw U.bus event across the wire — mitigate with a lint that fails on emit names absent from the registry, and by making the bridge the ONLY code that crosses the socket
- Migration debt: an un-tested migration rung silently corrupts a customer's station — mitigate by requiring a unit test PER rung and a real legacy-blob fixture in the suite, plus the pre-migration backup as a last-resort recovery
- Determinism leaks: a single bare Math.random()/Date.now() in a core path reintroduces flaky tests — mitigate with a lint banning them outside the sidecar and the injected-rng signature
- Over-process paralysis: a 12-point DoD on truly trivial steps could slow delivery to a crawl — mitigate by keeping the fast suite genuinely fast (<~10s) and letting trivial increments batch within one commit while still passing all gates
- The bake-once re-bake on every placement could visibly stutter as the station grows (full 936x674 re-bake) — flagged here as a perf risk for the world/build pillar; the invalidate() seam at least localizes where a future dirty-region optimization plugs in
- Test/real divergence: recorded fixtures of real runs go stale as providers change streaming/usage formats — mitigate by periodically re-recording against the live provider and asserting the contract still validates the fresh capture
- Redaction gaps: a new log line leaks a key or prompt — mitigate by routing all logs through one redacting logger and asserting via the redaction test that known-secret patterns never appear

**Open questions**

- What exactly is the test boundary for a 'real agent run' in CI — recorded fixtures only (free, deterministic) plus a manually-triggered live smoke, or a tiny budgeted live call in CI? Recommend fixtures in CI + a gated live smoke to avoid spend and flakiness.
- Where does the save live for versioning purposes — is the migration ladder over the SQLite schema (DB migrations) AND over an exported station JSON, or only one canonical form? Recommend SQLite as source of truth with the JSON envelope as export/import, each versioned.
- Does the contract need runtime version negotiation between a newer frontend and an older sidecar (or vice-versa) during auto-update, or do we guarantee they update atomically as one bundle? Atomic bundle is simpler and recommended for v1.
- How strict is the visual baseline — pixel-diff (brittle on the CRT/star animation) or structural 'rendered + no console errors'? Recommend structural for the gate, manual pixel review for intentional polish changes.
- Should determinism extend to the behavior layer's social/idle RNG in production (seeded per-session for reproducible bug reports) or only in tests? Recommend seeded-per-session in production too, logged with the session, so customer bug reports are replayable.
- What is the minimum set of events that MUST be frozen before Phase 1 starts vs. which can be added incrementally — recommend freezing agent.run.*/agent.token/agent.cost/run.cancel first (the make-or-break chain) and adding world.mutate.*/build.*/permission.* as their pillars land.

---

