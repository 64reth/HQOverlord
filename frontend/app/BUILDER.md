# Station Builder — foundation contract

The diegetic **REFIT** build mode: the Commander toggles it from the dock, then places rooms,
runs corridors, paints decks, and lays out their own station — rendered with v7's procedural art.
This file is the contract the three new modules share. It implements the **"Structure + polish"**
slice of `BUILDER_AND_WORLD_FOUNDATION.md` (the bible); read that for the long-range vision.

## Modules (split by purity — see the bible §8.1)

| File | Role | Purity |
|---|---|---|
| `app/worldmodel.js` | The canonical, mutable, serializable **Station** document + the **Mutation API** + `projectGeometry()`. The single source of truth. | **Pure** — no DOM, no ambient clock/RNG. Headless-tested by `test/worldmodel.test.js`. |
| `app/stationbake.js` | Generalizes v7's `world.js`/`render.js` bake (floors/walls/hull/light) from one room to **N rooms+corridors**, from a projected geometry. | DOM/canvas IO. Reads, never writes the model. |
| `app/build.js` | The full-screen REFIT overlay: camera, grid, toolbar, ghost preview, persistence. | DOM/IO + interaction. |

## Data flow (one direction)

```
Build (tools)  --mutations-->  WorldModel  --projectGeometry()-->  geometry
                                   |                                   |
                                   | onChange(patch)            StationBake.bake(geometry)
                                   v                                   v
                              App.persist() -> SaveDoc.station    { baseCv, lightCv, flickers }
                                                                       |
                                                          Build draws base -> grid -> light -> ghost
```

- **Every edit goes through the Mutation API** (`addRoom`, `placeHallway`, `moveRoom`, `removeRoom`,
  `setFloor`, `paintTiles`, `renameRoom`, `undo`, `redo`). Each returns `{ ok, error?, msg?, id? }`,
  validates fully before applying, and emits a patch to `onChange` subscribers. A rejected command
  never half-mutates.
- **Reads for ghosts** use `canPlaceRoom(rects, kind, ignoreId)` / `canPlaceHallway(rects, ignoreId)` —
  no mutation, returns the same `{ ok, error, msg }` so the overlay can tint green/red with a reason.
- The station persists through the existing **v2 `SaveDoc.station`** field (rides through `Save.write`/
  `load` untouched — no `save.js` change needed). `app.js` constructs it in `enterGame()` and serializes
  it in `persist()`.

## The projected-geometry contract (what the bake consumes)

`station.projectGeometry()` returns the v7 `MAP`-shaped object, shifted into a non-negative **local**
frame (the model itself uses signed, unbounded world-tile coords so the station can grow any direction):

```
{ TILE, COLS, ROWS, W, H,           // canvas size; H carries +14px hull headroom
  origin:{tx,ty},                    // world->local offset (localTile = worldTile - origin)
  allRects:[{z,x1,y1,x2,y2}],        // every footprint rect (local, inclusive), z = room id
  zones:{ id:{x1,y1,x2,y2} },        // per-room bounding rect (for labels)
  ROOM_IDS:[...], isCorridor(z),     // room vs corridor split
  chamfers:[[x,y,kind]],             // void-exposed room corners to round
  windows:[], doorDefs:[[x1,y1,x2,y2]], zoneGrid, idx(x,y), canStep(x1,y1,x2,y2),
  walkable(lx,ly,extra?), path(sx,sy,tx,ty,extra?), blockedTiles,  // BFS nav for the live agent
  baseColorOf(id,lx,ly),             // per-tile floor base colour (room style or paint override)
  nameOf(id), kindOf(id), matOf(id), // matOf = effective deck material (override, else kind default)
  FLOOR_STYLES, FLOOR_MATERIALS }
```

Doors are **auto-derived**: any two orthogonally-adjacent different-zone tiles become an open
threshold, so abutting rooms/corridors connect with no manual door tool. `walkable`/`path` power the
live agent: a tile is walkable if it's in a zone, not a rounded-corner (chamfer) tile, and not in the
caller's `extra` blocked set (furniture/desks live in the renderer, passed per query); `path` is a BFS
that crosses zone seams only where `canStep` allows (same zone or a door).

Validation error codes: `OVERLAP`, `TOO_SMALL`, `TOO_SHORT`, `TOO_FAR`, `BAD_STYLE`, `BAD_MAT`, `SPAWN_ROOM`, `NOT_FOUND`, `NO_RECT`, `NOTHING` (undo/redo).

## Extending

- **New floor style (HUE)** → add to `WorldModel.FLOOR_STYLES` (`{ base, label }`). It appears in the SURFACE palette's COLOUR row automatically.
- **New floor material (RECIPE)** → add to `WorldModel.FLOOR_MATERIALS` (`{ label, pitch, suggest }`) + `MAT_ORDER`, then give it a painter in `stationbake.js` (`deck*` + a `paintDeck` branch). It appears in the SURFACE palette's MATERIAL row automatically, previewed through `StationBake.sampleMaterial` — i.e. by the real bake.
- **New room kind** → add to `WorldModel.ROOM_KINDS` + `KIND_ORDER` (give it a `floor` hue and a `mat` material). It appears in the ROOM palette automatically.
- **New tool** → add to `TOOLS` in `build.js` and a `commit*` branch.

### The two floor axes

The deck is **hue × material**, deliberately orthogonal (`stationbake.js` §floor passes):

- `room.floorStyle` (+ per-tile `floorPaint` overrides) → the base **colour**.
- `room.floorMat` → the **recipe** drawn in that colour. `null` means "inherit `ROOM_KINDS[kind].mat`",
  which is what keeps every station built before the material axis existed rendering pixel-identical —
  `setMaterial`/`setDeck` normalize a kind-default choice back to `null` so it never serializes.

Every material derives its marks from the tile's own base via `U.shade`, so the two compose freely.
`setDeck(id, {style, mat})` lays both in ONE undo slot (what a REFIT room-click commits); `setFloor` /
`setMaterial` move a single axis. Material recipes must key every mark on **bake-pixel coords**
(`X`,`Y`) or world tile coords — never on position within the surface — or chunk↔monolithic pixel
parity breaks; `test/stationbake.materials.test.js` guards exactly that.

## Deliberately deferred (next passes — each is additive on this foundation)

- **Furniture / object → capability placement** (the v7 `F{}` table is the catalog; `object.place` /
  `object.reclaim` events are already in `shared/events.js`).
- **~~Making the built station the LIVE world~~ — DONE.** `app/world.js` now renders the player-built
  station (multi-room) via `StationBake` under a pan/zoom camera, and the agent walks it room-to-room
  through doors via `geo.path()`, re-baking live on REFIT edits. (Furniture/object placement is still ahead.)
- **Chunked / incremental bake** (the bible §5.2) — DONE for REFIT. `StationBake.bakeIncremental`
  renders bounded 384px chunks, maps `WorldPatch.dirtyRects` to dirty chunks, and reuses untouched
  chunk canvases while preserving the legacy `StationBake.bake()` path for callers that still need a
  monolithic canvas. Large-station callers can pass `{ visibleRect, maxRetainedChunks }` to render
  only visible chunks on cold start and evict old non-visible chunks while always keeping the current
  dirty and visible chunks. `StationBake.drawBase/drawLight(..., visibleRect)` culls chunk composites
  to the current viewport. REFIT now passes its live camera viewport into bake/draw, caps retained
  chunks, and fills newly exposed chunks incrementally when panning instead of rebaking the station.
- **Discrete door placement**, **Salvage/XP economy + tiers**, **PixelLab hi-tier art**.

## Ownership / coordination

Owns: `worldmodel.js`, `stationbake.js`, `build.js`, `BUILDER.md`, `test/worldmodel.test.js`, and small
additive hooks in `index.html` / `app.js` / `css/app.css` / `package.json`. Does **not** touch the
cortex-owned `shared/events.js` / `shared/schema.js`, and keeps edits to the camera-owned
`world.js` / `render.js` at zero.
