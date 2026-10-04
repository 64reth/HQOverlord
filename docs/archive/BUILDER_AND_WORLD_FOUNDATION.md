# Builder & World Foundation

> The architectural bible for StarNet's station builder and mutable world. This document is decisive. Where the five pillar designs converged, it locks the consensus; where they disagreed, it picks a winner and says why. Everything downstream — renderer, agents, sidecar, save format, tests — builds on what is written here.

---

## 1. Overview

### The builder vision

StarNet is a **station builder** in the lineage of PewDiePie's *Tuber Simulator*: the user spawns into one shabby starter room with one agent and, over time, **expands and beautifies a space station** — placing rooms, dragging hallways, painting floors, dropping furniture, and upgrading from rusty to pristine. The twist that makes StarNet not just a toy: **the way you build the station literally configures your real multi-agent org.** A room is a capability-scoped team. A door or hallway is an authorized handoff lane. A placed object is a real capability grant (model, shell, files, web, image, comms). The spatial diagram the user draws *is* the workflow graph the sidecar executes against real model calls, real tools, and real cost.

The "shabby → glorious" arc is not a cosmetic skin tree. It is **truthful telemetry applied to architecture**: a room is dim and rusty because its agent hasn't proven itself, and becomes pristine as that agent ships *real* deliverables and spends *real* credits. Building is a trophy case for real productivity.

### The foundational thesis

**The station is a single authoritative, mutable, serializable data document — and everything else is a projection of it.**

v7's world is the opposite: a fixed `936×674` buffer baked once into `baseCv`/`lightCv` with no camera, no invalidation, and rooms/furniture as static module-scope literals. That design proves the *look* but forbids the *build*. We replace it with:

1. **One canonical `Station` document** — sparse, chunked, tile-truthful, owned behind a closed Mutation API.
2. **Two pure projections of it** — a *render projection* (what the canvas bakes) and a *runtime AgentOrg projection* (what the sidecar executes). Layout and config can never drift because they are the same source.
3. **Incremental everything** — derived indices and the bake cache are surgically patched from dirty rectangles, never rebuilt wholesale.
4. **Customer-grade durability** — versioned saves in SQLite with atomic writes, rolling backups, checksums, and a forward-only migration ladder.

The single most important anti-corner decision threaded through all of it: **every legal change goes through one chokepoint — a command that validates, applies, records an inverse for undo, and emits a typed patch carrying dirty rectangles.** One chokepoint is what makes invariants enforceable, undo correct by construction, incremental indexing possible, and the Tauri↔sidecar boundary a clean RPC seam.

---

## 2. The canonical World Model

### 2.1 Coordinate & growth strategy (locked)

- **TILE = 12px**, preserved verbatim from v7. The foot-anchor formula `px = tx*T + T/2, py = ty*T + T-1` is preserved **byte-for-byte** so `agents.js` (bodies, `goTo`/`arrive`/`runPlan`, path consumption) ports with **zero changes** — we only swap what `walkable`/`canStep`/`path` read underneath.
- **World coordinates are signed tile integers** `(tx, ty)` with **no fixed origin**. The world is unbounded; it can grow north/west without renumbering a single tile or saved object. Pixel = `tile * TILE`.
- **A `Viewport {camX, camY, zoom}` is a separate read-only concept** layered on top. The model never knows about the camera. This bakes in pan/zoom "for later" with no migration.
- **The world is sparse and chunked**: `CHUNK = 16` tiles per side (192px). Chunks live in a `Map<"cx,cy", Chunk>`, created on demand, pruned when empty.

```js
const TILE = 12, CHUNK = 16;              // chunk = 192px square
const chunkKey   = (cx, cy) => cx + ',' + cy;
const tileToChunk = (tx, ty) => [Math.floor(tx / CHUNK), Math.floor(ty / CHUNK)];
const idx        = (tx, ty) => {          // chunk-local flat index
  const lx = ((tx % CHUNK) + CHUNK) % CHUNK, ly = ((ty % CHUNK) + CHUNK) % CHUNK;
  return ly * CHUNK + lx;
};
```

> **Decision — chunk size = 16, not 24.** Two pillars disagreed (16 vs 24). We lock **16**. Rationale: 16 keeps a re-bake unit small (a dirty edit touches 1–4 chunks of ≤192px each, not a ~room-sized 288px tile), the bleed/apron margin is a smaller fraction of a smaller chunk, and `idx()` uses a power-of-two mask cheaply. The 24-arg ("a chunk ≈ a room") optimizes for the wrong thing — we want the *invalidation* unit small, not the *room* unit aligned. This is revisited only after real bake timings exist (see §10 open questions).

### 2.2 The `Station` document (authoritative, serialized)

```ts
interface Station {
  schema: 'starnet.station';
  version: number;                 // save-format version → drives migrations
  id: string;                      // save-slot / station id
  meta: { name: string; createdAt: number; tier: number; spawnRoomId: RoomId; };
  rooms:   Record<RoomId, Room>;
  doors:   Record<DoorId, Door>;   // doors AND hallway segments (kind discriminates)
  objects: Record<ObjId, ObjectInstance>;
  agents:  Record<AgentId, AgentPlacement>;   // PLACEMENT only; identity lives in its own DB rows
  edges:   PipelineEdge[];          // authorized handoff lanes (v1: [])
  bounds:  { minTx:number; minTy:number; maxTx:number; maxTy:number }; // derived AABB of all floor
  // chunks/grids/indices below are RUNTIME-DERIVED — never serialized; rebuilt deterministically on load.
}
```

Everything serialized is **logical** (rooms, doors, objects, agent placements, edges). Everything per-tile (chunks, grids, graphs) is **derived** and rebuilt on load. This keeps saves small, human-debuggable, and trivially migratable.

### 2.3 `Room` — the hybrid rect-footprint + tile-truth model (locked)

> **The single most important world-model decision.** A `Room` is a logical entity with a **rect footprint** for cheap UX/validation/serialization, but the **authoritative geometry is a per-tile `floorOwner` grid**. Free-tile painting edits the footprint as a rect-decomposition.

This is what keeps us out of the corner: **rectangles give O(1) overlap pre-checks and cheap serialization; the tile grid gives unlimited free-form L/T-shaped growth.** Pure rect-rooms (v7's `zones{}`) can't express the builder; pure bitmaps lose the team/zone semantics agents and capability-mapping need. We take both.

```ts
interface Room {
  id: RoomId;
  name: string;
  kind: RoomKind;                  // 'bridge'|'research'|'factory'|'quarters'|'corridor'|... = capability-zone type
  tier: number;                    // 0=shabby … N=glorious; drives bake style (NOT geometry)
  footprint: Rect[];               // 1+ inclusive tile rects; union = the room (supports L/T shapes)
  floorStyle: FloorStyleId;
  wallStyle:  WallStyleId;
  floorPaint?: Record<string, FloorStyleId>;  // sparse 'tx,ty' overrides from the paint tool
  capabilities: CapabilityId[];    // DERIVED at runtime from contained objects — see §7 (not hand-stored)
  trigger: { mode: 'pull' | 'scheduled'; cron?: string };  // D4: per-room run policy, default 'pull'
}
interface Rect { x1:number; y1:number; x2:number; y2:number; }  // inclusive, exactly v7 zone shape
```

> **`Room.capabilities` is derived, not authored.** Several pillars stored it; we lock it as a *projection* of the grant-objects physically inside the footprint (see §7.2). Storing it invites drift — the exact decorative-lie failure mode v7's GOALS.md forbids.

### 2.4 `Door` / `Hallway` — the routing edges (locked: hallways are first-class corridor-Rooms)

> **Open question resolved.** Two pillars debated "hallway = wide Door vs hallway = thin corridor-kind Room." We lock: **a hallway is a `Room` of `kind:'corridor'`** (paintable, can hold objects, has tiles), and a **`Door` is the thin threshold edge** connecting two rooms. A dragged hallway therefore creates a corridor-Room plus Doors at each end. This gives the builder paintability and the org graph clean edges.

```ts
interface Door {
  id: DoorId;
  kind: 'door' | 'threshold';      // door = openable gate; threshold = always-open seam (e.g. hallway mouth)
  a: RoomId; b: RoomId;            // the two zones it connects (b may be a corridor-Room)
  edges: [number,number,number,number][];  // adjacent tile pairs [x1,y1,x2,y2] — v7 doorDefs shape, reused verbatim
  open: boolean;                   // closed door = a routing handoff gate (agents need permission)
  routePolicy?: RoutePolicyId;
}
```

### 2.5 `ObjectInstance` — furniture AND capability surface (locked)

```ts
interface ObjectInstance {
  id: ObjId;
  type: ObjTypeId;                 // key into the F{} draw-table + ObjectDef registry
  tx:number; ty:number; w:number; h:number;  // footprint origin+size (tiles)
  dir: 0|1|2|3;                    // rotation (NEW vs v7's rotation-less literals)
  tier: 0|1|2|3;                   // rusty→pristine; read by F{} wear()/glow(), NOT a sprite swap
  roomId: RoomId;                  // owning room (capability scoping)
  flags: { blocking:boolean; sit:boolean; deco:boolean; work:boolean };  // from ObjectDef, overridable
  pw?: { panelId:string; label:string };     // interactive PROPTERM terminal (v7 pw/pwl) — opens live session
  capability?: Capability;         // THE object→capability mapping (model|shell|files|web|image|comms)
  stationFor?: AgentId;            // if this is an agent's workstation seat
  state?: Record<string, unknown>; // runtime visual state (screen on/off, parcel count)
  catalogId: string;               // which catalog entry produced it (tier-up + resale value)
}
```

```ts
// Static, code-defined registry. ObjectInstances reference defs by `type`. This IS the v7 F{} table promoted.
interface ObjectDef {
  type: ObjTypeId; w:number; h:number;
  defaults: { blocking:boolean; sit:boolean; deco:boolean; work:boolean };
  draw: (ctx, inst) => void;       // the F{} entry, now tier-aware
  capability?: Capability;         // default capability this object grants
  allowedRoomKinds?: RoomKind[];   // builder placement rule
}
```

### 2.6 Derived indices (runtime-only, incrementally maintained)

```ts
interface Chunk {
  cx:number; cy:number;
  floor:      Uint16Array;  // floorStyle id per tile (0 = void)
  floorOwner: Int32Array;   // roomId-index per tile, -1 = void  ← AUTHORITATIVE roomAt()
  zoneId:     Int32Array;   // == floorOwner but corridor-tagged; mirrors v7 zoneGrid
  blockMask:  Uint8Array;   // 1 = impassable (wall/blocking object/chamfer); mirrors v7 blocked
  objectId:   Int32Array;   // ObjId-index occupying tile for hit-test; mirrors v7 pwGrid
  contentHash:number;       // bake-cache key = hash(floor+walls+doors+static objects in chunk)
  dirty:boolean;
}

interface Derived {
  chunks:    Map<string, Chunk>;
  sitTiles:  Set<string>;            // 'tx,ty' → sittable (v7 sitTiles)
  doorSet:   Set<string>;            // 'x1,y1>x2,y2' crossable edges (v7 doorSet)
  doorGraph: Map<RoomId, Set<RoomId>>; // rooms = nodes, doors = edges → routing + orphan checks
  roomIndex: RoomId[];               // index↔roomId for the Int32 floorOwner arrays
  objIndex:  ObjId[];                // index↔objId for the Int32 objectId arrays
}
```

Typed arrays per layer keep per-tile reads exactly as fast as v7's flat arrays; sharding into chunks is the only change.

### 2.7 The invalidation / dirty model (locked)

**Nothing is ever rebuilt wholesale.** Every mutation emits exactly one patch:

```ts
interface WorldPatch {
  seq:number;                 // monotonic; lets renderer/agents detect a missed patch and resync
  ops: PatchOp[];             // entity deltas {kind:'room'|'door'|'object'|'agent', op:'add'|'update'|'remove', id, before?, after?}
  dirtyTiles: Rect[];         // tile rects whose grids changed
  dirtyChunks: string[];      // chunk keys to invalidate/re-bake (derived from dirtyTiles + apron)
  reindex: boolean;           // true if room/door topology changed → agents re-path
}
```

- `derive.ts` consumes `dirtyTiles` and **surgically patches only those tiles** in `floorOwner`/`zoneId`/`blockMask`/`objectId`/`sitTiles`. `doorGraph` is patched only on door add/remove.
- The renderer consumes `dirtyChunks` to re-bake only stale chunks (§5).
- Agents consume `reindex` to `repathAll()`.
- `seq` is the self-healing seam: a consumer that detects a gap (`patch.seq !== lastSeq + 1`) requests a full resync rather than running on a desynced world.

This is the formal answer to v7's "#1 obstacle": **we don't fight bake-once, we shard it and patch it.**

---

## 3. The Mutation API

### 3.1 The chokepoint contract

The `Station` fields are **never written directly by any caller.** The only mutators are command functions:

```ts
type Command = { name:string; args:any };   // serializable → enables replay, undo, and sidecar RPC
interface MutationResult { ok:boolean; error?:ValidationError; patch?:WorldPatch; inverse?:Command; }
```

Each command is **transactional**: it (1) validates fully, (2) applies, (3) records an inverse, (4) emits one `WorldPatch`. A rejected command **never half-mutates** — listeners never see an invalid world. Because commands are serializable, the same call works in-process (P1) and over the Tauri↔sidecar WebSocket (later) with no rewrite.

### 3.2 The full legal-edit surface

```ts
// Rooms
mut.addRoom({ kind, footprint:Rect[], floorStyle, wallStyle, tier }): MutationResult
mut.removeRoom(roomId): MutationResult        // rejected if it orphans spawn room or strands a stationed seat
mut.moveRoom(roomId, dTx, dTy): MutationResult
mut.resizeRoom(roomId, newFootprint:Rect[]): MutationResult

// Paint
mut.paintFloor(roomId, tiles:(Rect|string)[], styleId): MutationResult
mut.paintWall(roomId, tiles:(Rect|string)[], styleId): MutationResult

// Connectivity
mut.placeHallway({ a:RoomId, b:RoomId, path:string[], width }): MutationResult  // → corridor-Room + 2 Doors
mut.placeDoor({ a, b, edges }): MutationResult
mut.setDoorOpen(doorId, open:boolean): MutationResult

// Objects
mut.placeObject({ type, tx, ty, dir, roomId }): MutationResult  // validates void footprint + room-kind legality
mut.moveObject(objId, tx, ty, dir): MutationResult
mut.rotateObject(objId, dir): MutationResult
mut.removeObject(objId): MutationResult
mut.tierUpObject(objId): MutationResult         // spends Salvage; raises tier (visual only)
mut.tierUpRoom(roomId): MutationResult

// Org wiring (see §7)
mut.assignAgentToRoom(agentId, roomId, seatObjId): MutationResult
mut.setObjectCapability(objId, capability): MutationResult
mut.connectPipeline({ fromAgent, toAgent, whenKind }): MutationResult  // later phase
```

### 3.3 Layered validation (locked)

Validation is **preventive and layered** — cheap checks reject fast, deep checks guarantee invariants. Always validate-then-apply, never apply-then-rollback (rollback can briefly emit invalid state).

| Layer | Check | Error code |
|---|---|---|
| Rect / AABB | footprint overlaps another room/object | `OVERLAP` |
| Tile | all footprint tiles are void or owned-by-room | `OUT_OF_ROOM` |
| Tile | placement tile is walkable / not a wall | `UNWALKABLE` |
| Tile | sit/work object has a reachable seat+stand tile (hypothetical `path()` from a room door) | `STRANDS_SEAT` |
| Tile | placement doesn't block the only door lane | `BLOCKS_DOOR` |
| Graph | command doesn't orphan the spawn room or any occupied seat (reachability via `doorGraph`, falling back to tile-BFS only when ambiguous) | `ORPHANS_SPAWN` |
| Capability | object type allowed in this room kind | `WRONG_ROOM_KIND` |

Every rejection returns a **specific, human-readable code** so the builder paints a precise red-tile reason ("door lane blocked"), never a generic "invalid."

### 3.4 Undo / redo

```ts
history.undo(): MutationResult     // pops last inverse, runs it THROUGH the Mutation API (so it re-validates + emits a patch)
history.redo(): MutationResult
history.canUndo(): boolean
```

Two stacks of `Command` inverses. Because undo runs back through the same chokepoint, it is correct by construction. **Coalescing**: contiguous same-command same-target ops (a paint drag, a multi-tile floor stroke) merge into **one** undo entry, so Ctrl+Z reverts a whole stroke, not 200 tiles. Charge/refund (Salvage) rides on apply/invert so undo refunds and redo re-charges.

### 3.5 Events emitted

```js
// NEW — the one event the whole system adds:
emit('worldChange', patch /* WorldPatch */)
//   renderer: bus.on('worldChange', p => p.dirtyChunks.forEach(invalidateChunk))
//   agents:   bus.on('worldChange', p => { if (p.reindex) WORLD.repathAll(); })

// + ALL existing v7 U.bus names re-emitted UNCHANGED by the bridge:
//   'chat','task','deliverable','intel','flagged','parcel','sale','stats','level','day','notify','objectives','party',...
```

The frontend's existing subscribers bind without renaming. This is the kept-canvas bet made literal.

---

## 4. Serialization & save versioning

### 4.1 The save document

```ts
interface SaveDoc {
  schema: 'starnet.station';
  version: number;            // TOP-LEVEL integer — the thing v7 never had
  station: StationSerialized; // Station minus all derived (chunks/grids/indices)
}
```

`toSaveDoc(station)` strips derived state. `fromSaveDoc(doc)` runs the migration ladder `v? → vCurrent`, then **deterministically rebuilds all chunks and indices** from rooms/doors/objects. On-disk derived state is *never* trusted.

### 4.2 SQLite, not a JSON blob (locked — ships to paying customers)

```sql
stations        (id TEXT PK, version INT, json TEXT, checksum TEXT, updatedAt INT)
station_backups (id TEXT, slot TEXT, version INT, json TEXT, savedAt INT)  -- last K good saves
```

- **Atomic save**: transaction + WAL; write, fsync, swap. A kill-mid-save leaves the previous good row intact.
- **Rolling backups**: the last K good saves per slot.
- **Checksum corruption detection**: on load, a checksum mismatch falls back to the most recent valid backup.
- **Debounced autosave**: triggered by the `worldChange` `seq` advancing; coalesces a burst of edits into one write; never blocks a frame; surfaces a subtle "saved" indicator. *A paying customer must never lose more than the last few seconds of building.*

> Why SQLite over a bare JSON file: atomic transactions, WAL durability, and multi-slot/backup management a flat file can't give. Why keep the doc as JSON *inside* SQLite rather than a normalized schema: the model is small, stays human-debuggable, and migrates trivially. Normalization can come later **behind the same Mutation API** — the boundary doesn't move.

### 4.3 Forward-only migration ladder (locked)

```ts
migrations.register(fromVersion, (doc) => upgradedDoc);   // vN → vN+1, linear chain
```

- Every save carries a top-level integer `version`. Load walks `vN → vN+1 → … → current`.
- A **one-shot pre-migration backup** is written before any ladder runs — a botched migration is a *restore*, not a support ticket.
- **CI discipline (non-negotiable)**: a fixture save per shipped version lives in the repo; CI gates on *every old fixture migrates and passes all model invariants*. This is the single guard against migration-chain rot bricking customer stations on update.

> **Open question resolved.** SQLite is the canonical source of truth; the `SaveDoc` JSON is the export/import + migration envelope. Both carry the version; the ladder runs over the JSON envelope on load. Frontend and sidecar update **atomically as one bundle** — no runtime version negotiation in v1.

---

## 5. The renderer evolution

v7's renderer: one `936×674` `baseCv` (floors/walls/light) + `lightCv` (destination-out darkness), blitted whole each frame, CSS-stretched `image-rendering:pixelated`, with a screen-space CRT overlay. No camera, no culling, no invalidation. The evolution inserts **one coordinate transform** and **shatters the two buffers into a per-chunk cache** — while keeping the entire bake *vocabulary* and the `~50-entry F{}` draw table untouched.

### 5.1 The Camera (locked: a `ctx.setTransform` at the top of `frame()`)

```ts
Camera { wx, wy, zoom, viewport }
Camera.screenToWorld(sx,sy) / worldToScreen(wx,wy) / worldToTile(wx,wy)
Camera.viewRectWorld() / apply(ctx, dpr) / clamp() / followAgent(body)
Camera.setViewport(cssW, cssH, dpr)   // backing store = cssW*dpr (DPR-aware)
```

A single context transform means **zero changes to the F{} draw table and `drawFurn`/`drawAgent`** — they keep emitting world coords and the matrix relocates them. Per-draw offsetting (touching hundreds of `fillRect` sites) is the corner we refuse. CSS-transforming the canvas element is rejected (breaks the pixelated mask + CRT alignment, gives no culling).

### 5.2 Chunked / dirty bake (locked)

- Each chunk owns a **base canvas** and a parallel **light canvas**, baked **lazily on first visibility** and **re-baked only when its `contentHash` changes** (signalled by `worldChange.dirtyChunks`).
- The entire v7 bake vocabulary — `bakeRoomFloor`, `bakeCorridorFloor`, `bakeCorridorDressing`, `bakeWalls`, `bakeEdgeAO`, `bakeRoomLighting`, `bakeHullExtrusion`, `eraseSpandrel`, the CORNER/chamfer geometry, the `cut()` destination-out carve — is **reused near-verbatim, just clipped to a chunk rect + apron** instead of the full buffer.
- **Seam continuity (the highest-risk detail)**: v7's hull extrusion (`WALLH=12px` south) and lightmap carve cross chunk borders. Each chunk bakes with an **8px APRON** — it renders neighbors' contributions into an oversized canvas and composites only the core — and carves light from a **neighbor-inclusive source list** so a lamp near a seam lights both sides identically. Step-8 pixel-diffs against v7 catch any seam.
- The **vignette moves out of the bake** into a screen-space per-frame pass (it is viewport-relative, not world-relative once a camera exists). The CRT scan/mask stay screen-space.
- **LRU eviction** bounds memory on large stations; revisiting an evicted chunk re-bakes it identically. A **per-frame bake budget** (N chunks/frame, spread the rest) protects 60fps during big edits.

### 5.3 Viewport culling & dynamic y-sort

`Scene` buckets furniture by chunk. Per frame it gathers **props in visible chunks + all agents (a flat list — they're few and move) + visible parcels**, attaches `sort-y`, and runs **v7's exact painter y-sort verbatim** (occupied-seat ordering, rug-low, parcel +6 offsets). The sort algorithm is unchanged; it just receives a culled list. This is also the fix for v7's "iterate all furniture every frame" hotspot.

### 5.4 Phase 1 subset vs the full builder renderer (D8)

> **This is the D8 reconciliation, and it is load-bearing.** P1 ships **v7's renderer almost verbatim** — but with three thin seams pre-installed so the builder phase *adds* to the renderer rather than *rewriting* it.

| Seam | Phase 1 (make-or-break spine) | Builder phase |
|---|---|---|
| **Camera** | Identity: `zoom=fit`, centered, clamped to the single starter room. Output pixel-identical to v7. | Drag-pan, edge-pan, integer-snapped zoom, follow-agent, world-bounds clamp. |
| **Bake** | A single chunk that *is* today's `buildBase` output. `bakeRegion(rect)` wraps it. | Real `CHUNK=16` grid, lazy bake, dirty re-bake, apron seams, LRU. |
| **Scene** | `Scene.itemsInView` returns the same sorted list v7's inline loop did. | Chunk-bucketed cull over a large world. |

The seams are **cheap no-ops in P1** (gated by an identity camera and a single chunk) and become the extension points later. P1 must honor them *even where they look like no-ops* (e.g. star count and vignette must not hard-code `W/2`), or they become latent builder bugs. **Pixel parity with v7 is non-negotiable** — existing players must perceive zero regression when the engine swaps underneath them (gated by a golden-image diff at dpr=1 and dpr=2).

Hit-testing: v7's `toLocal` (CSS-stretch inverse) becomes `Camera.screenToWorld` (also inverts pan/zoom/DPR). `WORLD.bodyAt`/`MAP.propAt` stay in world/tile space, reused verbatim. At zoom-out the 12px pick radius is converted to a screen-constant via `/zoom`.

---

## 6. The builder experience

### 6.1 Build mode UX (locked: a diegetic full-screen "REFIT" overlay)

Build mode is a **full-screen in-fiction "REFIT MODE" overlay** toggled by a single dock button — **not** a side-panel editor. Entering: the live sim dims (agents freeze/ghost), the tile grid overlays as faint phosphor lines (~0.12 alpha cyan), and the bottom dock swaps for an in-fiction toolbar: **PLACE · PAINT · ROUTE · MOVE · RECLAIM · UNDO**.

- A modal overlay sidesteps the missing P1 camera entirely — the whole starter station already fits on screen.
- The diegetic toolbar honors v7's "no OS chrome, every surface speaks raw phosphor" law; a generic editor would break the CRT fiction the product sells.
- The **ghost preview** follows the cursor, snaps to tiles, rotates with `R`, and tints **green/red via `canPlace()`** with a reason tooltip on red — the same green-work / red-standby palette v7 already uses. The build overlay draws **above** the lightmap (so the ghost is visible in an unlit new room) but **under** the camera transform (so it pans/zooms with the world).

### 6.2 The buildables catalog & tiers

```ts
interface CatalogEntry {
  id: string; kind: 'object'|'floor'|'wall'|'room'|'hallway'|'decor';
  label: string; fKey: string;            // → F{} draw fn or paint style id
  footprint: { w:number; h:number }; rotatable: boolean;
  grants?: Capability;                    // capability this object authorizes (empty for pure decor/floor)
  unlockAt: { stationLevel:number; prereq?:string };  // tech-tree gate (Station XP)
  cost: { salvage:number };
  resaleSalvage: number;                  // RECLAIM refund (~60% of cost)
  tierUpCost: [null, {salvage:number}, {salvage:number}, {salvage:number}];
}
```

- **Zero new art.** Catalog icons are drawn by calling each entry's `F{}` function into a small offscreen canvas. The `~50-entry F{}` table *is* the buildables art (`pixelrig`/`desk2` = computers, `console` = terminal, `cabinet` = filing, `dish` = uplink, …).
- **Locked entries show as ghosted "destiny silhouettes"** — the station's future, visible as aspiration (honors v7's staged-candidate law).

### 6.3 The "shabby → glorious" arc (locked: tier is a *parameter*, not new sprites)

`obj.tier` and `room.tier` are integers `0..3` **read inside the existing `wear()` / `glow()` / palette calls** and the `buildBase` hull pass. Tier modulates palette/wear/emissive intensity — **never geometry**. Tiering up is a one-parameter change per prop, reusing 100% of the existing pixel art, and goes **through the lightmap** (a one-shot light flare on tier-up), honoring v7's "lit, not painted" law. A visual-regression test asserts geometry pixels are identical across tiers — only palette/wear/glow channels differ. Generating 4× sprites is rejected outright.

### 6.4 The economy that gates expansion (locked: ONE earned resource — "Salvage")

> **Recommended model, decisively.** A single earned build currency, **Salvage**, minted **only by real outcomes**, plus a **Station XP / Station Level** tech-tree gate. No simulated revenue, ever.

| Lever | What it is | What it gates |
|---|---|---|
| **Salvage** | Spendable build currency. Minted **only** on `deliverable.ready` (+base + quality bonus) and on `agent.run.end` proportional to **real credits spent**. | *How much* you can build right now (the "save up and splurge" loop). |
| **Station XP → Level** | Earned from the same real outcomes. | *What* unlocks (the tech-tree / catalog availability). |

- **Minting fires ONLY on the two real bus events** — never on a game-minute tick (game-time is decoupled). Shipping a real deliverable visibly increments Salvage + XP with a floater over the agent. This makes building a **truthful readout of real productivity**, the honest analog of Tuber-Sim's Bux.
- Tier-up **requires both**: Station Level gates *availability*, Salvage *pays*. (You can't pristine-up a room before the station itself has progressed.)
- **No real-dollar purchase of build content** — that would turn a creative tool into a microtransaction store and conflict with BYOK honesty. The locked "destiny silhouettes" provide aspiration without fake currency.

### 6.5 The P1 slice (D8): one tap

P1 ships **exactly one build interaction** — placing a single COMPUTER from a 1-item tray inside onboarding. The empty starter room **withholds work until you place the computer**; the instant you do, the agent paths to the seat, sits, `b.working` flips on a **real model call**, and PROPTERM opens the live session. This single beat proves the entire spine — *placement → mutation → re-bake → agent can now really work* — and doubles as the tutorial that teaches the whole grammar. Everything else (paint, drag-rooms, hallways, tiers, full catalog) is additive on this proven seam and lands in the post-P1 builder phase.

---

## 7. Station = Workflow

**The station is not a skin over the org — it IS the org.** The `StationGraph` (rooms, objects, agent placements, edges) is the single source of truth; the render projection and the runtime `AgentOrg` projection are both **pure functions of it**. Layout and config can never drift because they are the same document.

### 7.1 The mappings

| Spatial thing | Org thing |
|---|---|
| **Room** | A capability-scoped team zone. |
| **Object with a `capability`** | A real capability grant (model / shell / files / web / image / comms). |
| **Door / Hallway** | An authorized handoff lane between teams. |
| **Where you drag an agent's desk** | Which team it joins and what it can do. |

### 7.2 Capability = union of grant-objects in the agent's **assigned** room (locked)

> An agent's capability set = the **UNION of capability-granting objects in the room it is ASSIGNED to (its home desk-room)** — *not* the room it is physically standing in.

Capability follows the **desk**, not the body. You grant code+shell to an agent by placing a terminal in its room, full stop. Tying capability to live position would mean an agent loses shell access by walking to the lounge mid-task — incoherent and unconfigurable. This must be taught in onboarding ("capability follows the desk; movement never changes it").

```ts
type Capability =
  | { kind:'model'; provider:'openrouter'; model:string }
  | { kind:'shell'; scope:'jailed'|'full' }
  | { kind:'files'; root:string }            // jailed per-agent workspace dir by default
  | { kind:'web';   allowlist?:string[] }
  | { kind:'image'; provider:string }
  | { kind:'comms'; channels:string[] };

type AgentPlacement = {
  agentId: AgentId;
  roomId: RoomId;          // assigned home room == its v7 station-desk's room → sets the TEAM
  seatObjectId: ObjId;     // the desk/chair it occupies
  fullAccess: boolean;     // D5 escalation: skip per-action consent prompts for this agent
  autonomy: boolean;       // D4: per-agent autonomy opt-in, default false
};
```

### 7.3 The runtime projection & the gate

```ts
// Pure: deriveAgentOrg(StationGraph) -> AgentOrg. Re-derived on every mutation, validated before the sidecar accepts it.
type AgentOrg = {
  agents: Record<AgentId, { roomId; capabilities: Capability[]; triggers:{pull:true; cron?:string}; fullAccess; autonomy }>;
  routes: Record<AgentId, { whenKind:string; to:AgentId; lane:RouteLane }[]>;  // only RUNNABLE edges
};

// Run before EVERY real tool dispatch in the model→tool loop:
function canAgentUse(org, agentId, need): { ok:true } | { ok:false; reason:'no-object'; suggest:string } {
  const has = org.agents[agentId].capabilities.some(c => capMatches(c, need));
  return has ? { ok:true }
             : { ok:false, reason:'no-object', suggest:'place a '+objectTypeFor(need)+' in '+org.agents[agentId].roomId };
}
```

The gate slots in at the **exact seam** where v7's fake `INTENTS` router (`sim.js:566`) chose an agent and made a task — that decision point becomes "can this agent's room do this?" On deny it emits `capdenied` and (unless `fullAccess`) raises the per-action consent prompt. **The sidecar's `AgentOrg` is the source of truth; the renderer's `room.capabilities` is a projection it confirms via WS ack** before showing a grant as active — enforcement stays server-side.

### 7.4 Hallways as handoffs (parcels = deliverables)

A `PipelineEdge A→B` is **RUNNABLE only if the door graph connects A's room to B's room**. When a real `deliverable` of the edge's kind fires, it is **carried as a real artifact** along the `RouteLane` — generalizing v7's hardcoded `onDeliverable()` belt-to-HERALD plan into an edge-driven plan, reusing `parcels[]`, `beltInfo`, the `{go/face/sit/wait/do}` sequencer, and `standNearTile`. Cutting a corridor **severs the pipeline** — a true, legible consequence, surfaced loudly ("this pipeline is severed: connect a corridor"), never a decorative dead workflow.

### 7.5 v1-simple vs later-rich

| | v1 (the honest N=1 case) | Later (same schema, higher cardinality) |
|---|---|---|
| Rooms | 1 fixed starter room | N user-built rooms |
| Agents | 1 | N |
| Objects | = that agent's tools | per-team toolsets |
| Edges | `[]` (no inter-agent work) | real handoff pipelines with carry |

**v1 is literally the N=1 case of the full graph** — `RoomId`/`AgentId`/`Capability`/`PipelineEdge` all exist in v1, there's just one room and an empty edge set. Multi-agent orchestration is a deferred phase that needs **zero schema rewrite**, only cardinality. We **resist faking it** — a fake pipeline is worse than no pipeline.

---

## 8. Module boundaries & the event schema

### 8.1 The four layers, split by PURITY (not by feature)

| Layer | Purity contract |
|---|---|
| **World-model core** (`world/*`) | Pure. No DOM, no `Date.now`, no bare `Math.random` — injected clock + seedable RNG only. Fully headless-testable. |
| **Renderer** (`render/*`) | DOM/canvas IO only. Reads the model, never writes it. The bake-once obstacle stays quarantined behind an explicit `invalidate()`/dirty-chunk seam. |
| **Behavior / WORLD** (`agents.js`) | Pure-ish given injected clock + RNG. |
| **Sidecar** (`sidecar/*`) | All secret / network / disk IO. The only place real, non-deterministic calls live. |

The **bridge** + **`shared/events.js`** are the *only* things both worlds touch. This makes determinism a design invariant, not an accident — exactly the property `test_world.js` already proves v7 has by booting headlessly.

```
world/model.ts      — owns Station + Derived; read-only accessors (v7-identical signatures); the seq counter; NO setters
world/mutations.ts  — the ONLY legal writers (§3)
world/validate.ts   — layered preventive validators (§3.3)
world/derive.ts     — incremental indexer (dirtyTiles → surgical grid/graph patch)
world/chunks.ts     — sparse chunk alloc/evict + "which chunks intersect rect/view"
world/history.ts    — undo/redo over Command inverses
world/serialize.ts  — toSaveDoc/fromSaveDoc + migrations/ + checksum
world/bus.ts        — emits 'worldChange'; re-emits all v7 names
persistence/sqlite.ts — atomic save, slots, backups, corruption fallback, debounced autosave
render/chunkBaker.ts  — per-chunk content-hash bake cache (replaces baseCv/lightCv)
org/derive.ts         — deriveAgentOrg (pure StationGraph → AgentOrg)
shared/events.ts      — THE frozen event contract (single source of truth)
bridge.ts             — validates + re-emits real events onto U.bus; the SIM replacement
test/world.headless.ts — boots model, fuzzes Mutation API, gates every invariant
```

### 8.2 The event contract (single source of truth)

```ts
// shared/events.ts — frozen registry, imported UNCHANGED by both the bridge and the sidecar.
validate(name, payload): payload | throws;     // payload validator per event
EVENTS: frozen registry of names;              // a PR touching this triggers the contract suite
SCHEMA_VERSION: number;
```

- The event vocabulary is **defined once** and **validated at the process boundary in BOTH directions** — the sidecar validates before send, the bridge validates on receive before it touches `U.bus.emit`. Malformed payloads are **dropped + logged, never thrown** into the render loop (extending v7's per-handler try/catch posture to the wire).
- A **lint** fails CI on any `U.bus.emit('...')` name absent from the registry, so nobody bypasses the contract.
- The frozen-first set (the make-or-break chain): `agent.run.*`, `agent.token`, `agent.cost`, `run.cancel`. Then `world.mutate.*` / `worldChange`, `build.*`, `permission.*` as their pillars land.

### 8.3 Determinism (locked)

Inject `makeClock()` and `makeRng(seed)` through `WORLD.tick(dt, nowMs, rng)`; **ban bare `Math.random`/`Date.now`** in core/behavior (enforced by lint). The sidecar's real-call layer is explicitly non-deterministic and is tested with **recorded fixtures/replay**, not live spend. Seeded RNG turns the headless harness into a reproducible regression oracle; seeding per-session in production too makes customer bug reports replayable.

---

## 9. How this honors the locked decisions & v7 DNA

| Locked decision | How the foundation honors it |
|---|---|
| **D1 — hybrid BYOK billing** | Secrets live only in the sidecar (OS keychain); the model/renderer never see a key. Salvage/XP are earned-only — no fake economy, BYOK honesty preserved. Managed credits later change only the sidecar's billing adapter. |
| **D4 — pull + optional scheduled, autonomy opt-in off by default** | `Room.trigger {mode:'pull'\|'scheduled', cron?}` is per-room, default `pull`. `AgentPlacement.autonomy` is per-agent, default `false`. |
| **D5 — full sandbox, object→capability is the control surface** | `ObjectInstance.capability` + `setObjectCapability` make the placed object the *visible, legible* capability grant. No artificial ceiling — capability is the pure union of grant-objects. Safety defaults = per-action consent prompts + jailed per-agent `files.root`; `fullAccess` is the per-agent escalation that opts out of prompts. |
| **D8 — P1 keeps ONE fixed starter room; full builder is its own phase** | Steps 1–2 deliver the model behind **v7-identical accessors** with mutation **dormant**; the renderer ships v7 verbatim with three no-op seams. The Mutation/builder steps (3+) land independently, post-spine. We do not over-build the chunk/camera/builder stack before the real-agent spine exists. |

**v7 design DNA carried verbatim:**
- **Truthful telemetry** — room quality = real work shipped; capabilities = objects actually present; the sidecar (not the renderer) is the source of truth for grants. No decorative lies.
- **Movement is meaning** — handoffs are real carried artifacts along real paths; a severed corridor is a real broken pipeline.
- **Lit, not painted** — the shabby→glorious arc routes through the lightmap and wear/glow channels, never a repaint or a grunge filter.
- **Parametrized intensity** — tier is one integer feeding existing draw calls; push-it-further is a tweak, not a rewrite.
- **Rules harden into validators** — `validate_map.js`/`test_world.js` evolve into the headless world test surface that gates every invariant after every command and every save round-trip.

---

## 10. Top foundational risks + consolidated open decisions

### 10.1 Top foundational risks (with mitigations)

1. **Incremental index drift** — a bug in `applyDirtyTiles` silently desyncs `floorOwner`/`blockMask`/`doorGraph` and breaks pathing. *Mitigation:* the headless harness **always** compares incremental grids against a from-scratch full rebuild after every command (fuzz 1000+ iterations); ship a dev-only sampled assert in real runs.
2. **Chunk-seam artifacts** — hull extrusion + destination-out light cross chunk borders; naive clipping hard-edges them. *Mitigation:* 8px apron + neighbor-inclusive light source list; pixel-diff against v7 (pan a lamp across a seam — the pool must not flicker).
3. **Migration-chain rot** — an untested `vN→vN+1` corrupts a customer's station on update. *Mitigation:* a fixture save per shipped version + CI gate "every old fixture migrates and passes all invariants" + the pre-migration backup.
4. **Capability/enforcement desync** — the renderer shows a granted tool the sidecar didn't actually grant (a security-relevant lie). *Mitigation:* sidecar `AgentOrg` is source of truth; the renderer confirms via WS ack before showing a grant active; the headless org-validator gates every snapshot before the sidecar accepts it.
5. **Re-bake stutter on big edits** — a tier-up marking many chunks dirty in one frame. *Mitigation:* per-frame bake budget (N chunks/frame, spread the rest); LRU eviction bounds memory on large stations.
6. **Severed-pipeline confusion** — deleting a corridor silently kills a workflow. *Mitigation:* a loud, legible "pipeline severed" signal; validators forbid removing the *only* path to an occupied seat.
7. **Determinism leaks** — one bare `Math.random`/`Date.now` in a core path reintroduces flaky tests. *Mitigation:* lint banning them outside the sidecar; injected-rng signatures.
8. **Over-engineering for P1** — building the full chunk/camera/builder stack before the spine exists violates D8. *Mitigation:* the seams are no-ops in P1; the builder steps land independently.

### 10.2 Consolidated open product decisions (deduped — the user must weigh)

1. **Tauri/sidecar location of the authoritative model.** Recommended: the **sidecar owns the authoritative `Station`** (co-located with secrets/saves/agent-runtime); the renderer holds a **read replica synced via `worldChange` patches** over the WS. This makes `WorldPatch` the wire format and the Mutation API RPC-callable — confirm before BUILD-phase IPC lands.
2. **Multi-floor / z-levels.** ✅ **RESOLVED 2026-06-13 — single floor only.** The station is one floor plane; we do **not** carry a `floor`/`z` dimension. Coordinates stay 2D `(tx,ty)`. (If vertical decks are ever wanted, they'd require a save migration — accepted.)
3. **Same-capability merge rule.** When two objects in a room grant the same capability with different config (one jailed shell, one full), what wins — most-permissive, most-restrictive, or last-placed? *Recommend: most-restrictive by default* (safe), with an explicit per-object override. Needs a deterministic rule in `deriveAgentOrg`.
4. **Object `state` serialization.** Serialize runtime visual state (screen on/off, parcel counts) or always re-derive from live agent events on boot? *Recommend: do NOT serialize — re-derive*, so a fresh app version never shows stale visuals; the bridge re-emits on boot.
5. **Catalog art ceiling.** Do higher tiers eventually use PixelLab-generated pixel art for a bigger "glorious" payoff, credit-gated like the avatar FORGE track? *Recommend: F{} recolors for v1; PixelLab as an opt-in, credit-gated upgrade later.*
6. **Salvage/XP balance numbers.** Exact mint rates (Salvage per deliverable, XP per real dollar) and the unlock curve need a balance pass once real deliverables flow — reuse `sim.js`'s milestone *shape*, re-pointed to real outcomes.
7. **CI test boundary for a "real agent run."** Recommended: **recorded fixtures in CI** (free, deterministic) + a **gated manual live smoke** — avoid spend and flakiness in the automated gate.

---

*End of "Builder & World Foundation." This is the bible. Deviations from a locked decision (§2.1 chunk=16, §2.3 hybrid room, §2.4 hallway-as-corridor-Room, §6.4 single-Salvage economy, §7.2 capability-by-assigned-room) require an explicit architecture change, not an ad-hoc edit.*