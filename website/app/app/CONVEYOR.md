# Conveyor system — contract

Directional conveyor belts you lay like a path, with boxes that flow along them. Companion to
`BUILDER.md` / `PROPS.md`. Built on the props infrastructure; additive (no `shared/` change).

## Data model (worldmodel.js)

Belts are a first-class keyed layer (NOT props) — a conveyor is a graph, and transport needs
O(1) topology lookups:

```js
doc.belts = { "12,7": "E", "13,7": "E", "13,8": "S", ... }   // "x,y" (WORLD tile) -> dir
```

- `dir` ∈ `E|W|N|S` — the flow direction OUT of that tile. 1×1 tiles.
- Belts are **walkable** — they never enter `blockedTiles`. A belt is floor machinery; boxes
  ride above it. This keeps pathfinding robust across a factory floor.

Mutations (snapshot undo/redo): `setBelt(x,y,dir)`, `removeBelt(x,y)`, `placeBeltRun(a,b)` (lays a
straight run from a→b, direction = the drag axis). Validation: each tile must sit on a deck
(`roomAt != null`) and not on a *blocking* prop. Reads: `belts()` (→ `[{x,y,dir}]`),
`beltAt(x,y)` (→ dir|null). `projectGeometry()` emits `belts` in the LOCAL frame; belts serialize
inside `doc`; `migrate()` is total (drops malformed keys/dirs).

## Runtime (conveyor.js) — `Conveyor.create()`

A self-contained transport sim + renderer. Frame-agnostic: it's handed a belt map in whatever
tile frame the caller draws in (build.js = world coords, world.js = local coords), so one
factory powers both REFIT preview and the live world, each with its own box state.

- `tick(dtMs, nowMs, beltMap)` — advance boxes. Boxes are **never auto-spawned**: a box exists only
  for a real work-item dropped via `enqueueAt` (see *Work-item pipeline*). A box advances `progress`
  along its tile's dir; at `progress>=1` it steps to the next tile and adopts THAT tile's dir
  (corners), or sinks (fade) at an open end — firing `onDeliver` if it carries a payload.
  Deterministic — no RNG, no wall-clock (nowMs is injected).
- `enqueueAt(x,y,payload)` — place a real work-item box at a source tile; `dropWorkitem(id)` —
  early-sink a riding box whose run was superseded (it never delivers); `Conveyor.create({onDeliver})`
  — `onDeliver(box,x,y)` fires once when a payload box rides off the end.
- `drawBelts(ctx, nowMs, TILE, beltMap, liveSet?)` — each tile: rails on the cross-axis, tread chevrons
  scrolling in the flow direction (ported from v7 `F.beltH`, generalized to 4 dirs + 1 tile),
  drive-LED. Direction is legible at a glance. `liveSet` (from `Pipeline.liveTiles(plan)`) marks the
  tiles on a complete INTAKE→bound-BAY route: those render ENERGIZED (marching treads/chevron, blinking
  LED); the rest render COLD (frozen treads, no chevron, dark LED, dimmed) so an incomplete chain is
  visibly not running. Omitted → every tile draws live (legacy behavior).
- `drawBoxes(ctx, nowMs, TILE)` — riding crates with contact shadows; a short sink-fade at the end.

Belts draw at floor level (over the bake, under the lightmap); boxes just above, y-sorted with
agents/props.

## Builder (build.js)

`BELT` tool (key 7): **drag to lay a run** — flow follows the dominant drag axis (drag east → `E`
belts, drag up → `N`, …). Ghost previews the run + a flow arrow, green/red via validation.
RECLAIM removes belt tiles. Belts stay **quiet** until a real work-item rides them (no decorative flow).

## Cargo, motion & belt craft (polish pass)

The boxes encode the station's SEMANTIC COLOR ECONOMY — each box hashes deterministically (by id)
to a cargo type, weighted so loud colours stay rare: **utility/steel 34% · production/amber 30% ·
data/cyan 16% · command/red 13% · money/gold 7%**. All share one 2.5D `cargoChassis` (lit top face
+ shaded front face + leading-edge rim light keyed to travel dir); data is a flatter cassette and
money is stacked bullion (silhouette breaks for instant read). Per-box variety is `U.hash(''+id)`;
the only `nowMs` uses are the amber LED, command strobe, data read-head, and gold sheen — blooms
gate behind `globalAlpha>0.6` so fading boxes skip them.

**Motion** (`boxMotion`, translate-only — no `ctx.scale`): hash-phased ride bob, lean into travel,
bob-coupled contact shadow, spawn-pop (easeOutBack lift + alpha ramp via `t0`), a corner jolt on
heading change (`turn0`), and a sink that falls into the chute (slide in dir + fade + shrink shadow).

**Sim**: min-gap backpressure — a box never advances within `MIN_GAP` (0.82 tile) of the box ahead
(the occupancy index is kept LIVE across tile crossings, so two lanes converging on one tile in the same
tick can't both claim it — the second holds at its lane head), so work-items queue behind a stalled
one. Equal progress on one tile counts as blocked, broken by box id, so a tie can't ride as a pile.
Backpressure reaches **into the queue**: `enqueueAt` items wait in `pending` until their source tile has
`MIN_GAP` of clear room, then are born — a burst (a channel flurry, a cron fan-out) forms a visible line
instead of one stack of crates drawn on top of each other, and a busy source never stalls another's lane.
A source therefore emits at the belt's real capacity (~2 crates/sec); `pending` is capped at `MAX_PENDING`
(240, oldest shed) for the same reason `MAX_BOXES` exists. There is **no auto-spawn** — belts carry only
real work.

**Belt tiles** (`drawBelts` classifies each tile from the belt map): source = amber feeder hatch
(the belt's start, where an INTAKE feeds it); sink = dark chute mouth + lip shadow; corner = an elbow glyph bending
flow toward the exit; straight = axis-aware treads + a **dim-neutral** marching chevron (NOT an
economy accent — keeps cyan/green meaningful) + a small drive LED.

## Status

- **Stage 4a/4b (done):** directional belts + semantic cargo art + motion juice + min-gap
  backpressure; place/reclaim/undo/persist; REFIT + live world; deterministic sim; tests.
- **Work-item pipeline (done — Stages 1–2):** belts are the wiring of the agent work-pipeline. A
  real inbound message (Telegram) becomes a payload box via `enqueueAt`, rides the player-laid belts
  to the agent's desk, and fires `onDeliver`; a superseded run's box drops off the belt
  (`dropWorkitem`). The decorative auto-spawn was **removed** — every crate now means real work.
  Additive events: `workitem.placed/delivered/superseded`, `queue.status`. Plan:
  `docs/CONVEYOR_PIPELINE_PLAN.md`.
- **Junctions (done):** SPLITTER round-robins across its out-lanes; FILTER routes by the work-item's
  content tag (`routes[tag] || def`, never dropping); MERGER is a **lane funnel** — several lanes
  converge, every crate rides straight on. A merger has no config and combines nothing: the harness
  dispatches each work-item independently, so K crates in must be K crates out or the floor is lying.
  (It once buffered K and absorbed K−1 for a map-reduce barrier the server never performed — removed
  2026-07-26.) Real batching would need a defined reply target for a run merged from several chats;
  that is an open product question, not a belt feature.
- **Work lines / agentic graphs (done — 2026-07-27):** a dock's OUTPUT is the next dock's INPUT. Until this
  landed the floor was a *dispatcher*: it picked ONE agent per inbound message, the bay consumed the crate, and
  every bay drawn downstream of it was scenery — `INTAKE → researcher → writer → OUTBOX` ran only the
  researcher. `compileRoutingPlan` now also emits `chains { agentId → { tile, next[], outbox, deadEnd } }`, and
  `chainNext(plan, agentId, ctx, pick)` walks the belts from a dock's SHIP tile to the next dock, mirroring
  crate physics exactly: a FILTER downstream of a dock branches on the **output's** tag (route the result by
  what it turned out to be), a SPLIT round-robins, and **one output crate is one downstream run** (K in, K out).
  `sidecar/routing/chain.js` executes it for channel messages (all four hubs), scheduled routines
  (`cron-driver` `advanceChain`) and Run Now; an in-app COMMS turn is owned by the BROWSER, so `chat.js`
  drives the same hops itself against `GET /api/routing/chain`. All four surfaces run the same line.
  The reply that leaves the station is the LAST stage's.
  - **The handoff prompt lives in `pipeline.js`** — the pure module the sidecar executor and the browser BOTH
    load. Two copies of that string would let one floor produce different runs on different surfaces.
  - **Every stage is attributed to the agent that produced it.** `row()` takes `opts.who` and a work-line turn
    persists its `agentId`; stamping stage two's work with the entry dock's name is a fabricated turn, the same
    law that stopped the hub writing a downstream reply into the entry dock's transcript.
  - **A stream can hold several run rows.** Hops share the routine's `cron-<runId>` stream so the session shows
    the whole line — so anything deriving a session's title/agent must pick the row whose runId the stream is
    NAMED after, never whichever it reads first (that titled routines with the internal handoff prompt).
  - **A DOCK NEVER EATS ITS OWN OUTPUT.** A lane running along a dock's edge touches several ring tiles; the
    handoff rides through all of them and is consumed only by a foreign dock. Compiler and engine hold the
    same rule, which is what makes a self-loop structurally impossible rather than merely unlikely.
  - **`CHAIN_CYCLE` is a BLOCKING error**, and it is invisible to `detectCycle`: A shipping into B's dock and
    B shipping into A's are two separate lanes with no belt cycle anywhere — the loop exists only across the
    docks (consume here, respawn there), and it is an infinite chain of PAID runs.
  - **A CHAIN NEVER GATES THE REPLY.** Hop cap (6), chain spend cap ($2), a failed/empty stage, E-STOP — every
    stop delivers the last good output plus an honest note naming where the line stopped. Same law as
    "no belt → work still runs": a broken stage 3 must not swallow stage 2's answer.
  - The line runs INSIDE the hub's inflight record, so E-STOP and a superseding message reach the downstream
    stages; and `visited` refuses to run an agent twice even if the plan is re-posted mid-chain.
  - Legibility: dock→dock lanes render ENERGIZED (they carry real crates), `BAY_NOT_FED` no longer shames a
    stage-two dock (it is fed by an agent, not by a door), and a non-terminal stage no longer ALSO ships a
    crate at the OUTBOX — its product *is* the handoff.
- **Later:** RPG economy.
