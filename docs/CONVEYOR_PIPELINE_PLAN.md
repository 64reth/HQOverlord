# Conveyor → Agent Work-Pipeline — Design & Implementation Plan

> **One-liner:** The conveyor belt becomes the *literal wiring of the agent work-pipeline*. A real
> inbound message becomes a box that spawns at a placeable **SOURCE**, rides the belts **you** laid to
> an agent's **INTAKE BAY** (the desk), is consumed the moment that agent's `runOnce` begins, and —
> on the way out — the agent's reply/file/memory-write rides an **OUTBOUND** belt to a **SINK** that
> delivers it. Where you route belts *is* the orchestration topology the backend honors.

This doc is the product of a grounded multi-agent pass over the real codebase (conveyor engine, props/builder,
channels ingress, agent-execution + the frozen event contract, and the frontend renderer). Every task below
points at a real file and extension point.

---

## 0. Core principle: the belt is a *truthful visualization*, never a gate

The single rule that keeps this honest and safe:

> **Real work always processes server-side. The belt only ever *shows* it.**
> If no INTAKE prop or belt path exists, the message still runs — the world just shows no crate.

This is what separates this feature from the existing `parcels` array in `agents.js`, which the codebase
itself flags as **"COSMETIC ONLY."** We are not building prettier cosmetics — we are binding the box's
lifecycle to events that already fire (`agent.run.start`, `agent.cost`, `agent.run.end`, `channel.delivery`),
so the simulation can never lie about what the agents are actually doing.

---

## 1. The expanded vision (three angles, merged)

The design pass attacked this from three directions. The canonical feature **merges all three**: Angle A is
the spine, Angle B is the mid-game, Angle C is the meta-game.

### Angle A — *The box IS the message* (the honest spine)
The conveyor is the physical embodiment of a message queue that **already exists in code**: `hub.js` keeps an
`inflight` Map = "one run per chat; a new message aborts the old." That *is* a depth-1 queue with a supersede
policy. The belt makes that invisible state visible:

- A box's payload is the **literal `InboundMessage`** (chatId, userId, text preview, messageId, agentId).
- **Delivery to the desk == run-start.** The crate slotting into the desk and the screen flickering to life
  are the same conceptual moment.
- **Backpressure is real, not faked:** a second DM mid-run stacks a box at the bay; when the hub supersedes
  the prior run (its actual behavior), the superseded box visibly drops off the belt.

### Angle B — *The station floor IS the orchestration DAG* (the factory mid-game)
The belt graph you draw becomes the routing topology the backend obeys. Junctions are placeable machines:

- **Splitter** (1→N): round-robin or least-loaded balance one work stream across multiple agents = **real
  parallelism you draw, not a number you edit.** N out-lanes → N concurrent `runOnce` calls on different agents.
- **Merger** (N→1): pass-through fan-in is nearly free (belt topology already merges); an **aggregator-barrier**
  variant holds until K payloads arrive then fuses them into one box — **map-reduce you can watch**, with a
  counting LED ("1 of 3… 2 of 3… *clunk*").
- **Filter** (content router): routes each box by its classifier tag to the matching lane (`code`→coder bay,
  `research`→researcher bay), with a default overflow chute for no-match. Pairing a lane with a
  **`capGate.attenuate`'d bay** makes an untrusted-work lane *physically unable* to reach dangerous tools — a
  security sandbox you can see on the floor.
- **Belt tiers / priority lanes:** mk1→mk3 belts change `SPEED` (= how fast that lane is polled/served). A gold
  express lane for the Commander's direct orders; bot chatter trundles on rusty mk1.
- **Backpressure as queue depth:** make boxes *occupy* their tile so a jam's physical **length IS the live
  queue depth** for that agent. No dashboard — you just *see* the overwhelmed agent and clear it by laying a
  bypass belt or adding a parallel bay.
- **Belt-graph → DAG compiler:** the quiet keystone — a pure function that compiles `{sources, lanes, junctions,
  bays}` from the floor and validates it (orphan source, dead-end bay, infinite cycle → **red ghosts in REFIT
  before anything runs**). This is the analogue of `resolveTools(agentId, station)` but for *routing*.

### Angle C — *Spend → Yield economy* (the honest RPG meta-game)
Treat OpenRouter spend as the **only** real constrained resource; everything else is a transformation of it.
**Every XP number is minted from the same reconciled `agent.cost` delta as the dollar ledger**, so the
progression bar and the bank statement can *never* silently disagree (the `workstreams.js` "truthful telemetry"
invariant).

- **Tokens-as-ore:** the box's size/glow scales with estimated tokens (a `haiku` run is a pebble, a reasoning
  `opus` run is a glowing boulder); it **recolors on reconcile** (green = under-estimate, amber = on, red =
  blew past).
- **Cached tokens as refined ore — the Smelter:** the cost engine already tracks `cachedTokens` separately
  (~10× cheaper). Model prompt-cache stability as a buildable **SMELTER** with a heat gauge: keep your system
  prompt + memory fence stable → smelter runs hot → throughput up; thrash your prompt → it goes cold and $/yield
  craters. Turns an invisible technical optimization into a machine with a temperature dial.
- **Yield vs Slag:** `agent.run.end.reason` decides the output box. `done` + a deliverable → a green **PRODUCT**
  crate that banks XP. `budget`/`max_iters`/`error`/`refusal` → a red-hot **SLAG** box onto a waste belt.
- **The Slag Sink as a teaching loop** *(the standout novel mechanic)*: every wasted-spend run becomes a
  **hoverable post-mortem** pointing at a real, fixable cause — *"max_iters: agent looped 10× re-reading the
  same file — give it a cabinet with `fs.list`"* / *"budget: smelter is cold, your prompt is churning."* The
  factory "optimize the line" instinct gets pointed at the genuinely valuable skill: **operating real agents
  cheaply and well.**
- **Yield Ratio** (product-$ / spent-$) is the station's one headline number — replacing v7's fake-revenue
  scoreboard. You chase usefulness-per-real-dollar.
- **Tech tree = the capability registry, made buildable:** `CAP_REGISTRY` grants gated by station tier + XP.
  Tier-1 cabinet = `fs.read`; tier-2 unlocks `fs.write` (with consent); tier-3 raises the per-run file budget.
  Every unlock is a **real** capability escalation.
- **Contracts / Quests:** an inbound DM/directive/cron trigger arrives as an **Order** with a deliverable, a
  soft deadline (wall-clock), and a **budget envelope** (the `maxCostUsd` cap the loop already enforces).
  Coming in *under budget* is the big reward multiplier — thrift as the "no-damage run." Standing contracts =
  cron schedules paying an XP annuity for a reliably-running recurring job.
- **Honest prestige:** "commission a new station" wipes the layout but banks a permanent yield multiplier — you
  prestige when you've learned to run agents so efficiently a leaner build out-yields your sprawling old one.

---

## 2. Critical-path realities (read before scheduling)

| Reality | Evidence | Consequence |
|---|---|---|
| **The conveyor system is UNMERGED.** | `conveyor.js` is not tracked on `feat/harness-backend`; it lives on `agent/conveyor` (head `06cec93`). | **Hard prerequisite — Stage 0.** Merge it to trunk first, in its own worktree, resolving any `world.js`/`worldmodel.js` conflicts with the `d9358a8` props merge *there*, not on the shared trunk. |
| **`shared/events.js` is additive-only & owner-gated** (cortex-memory). | CLAUDE.md rule 4. | New events are **requested**, never self-edited from our worktree. |
| **`test/lint-emits.js` fails the build** on any `emit('new.event')` literal not yet in the registry. | File confirmed present. | Until the request is granted, drive the browser via a **dynamic** `emit(name, payload)` form (the linter only catches string literals) or a temporary unvalidated `U.bus` name; switch to the validated literal on grant. |
| **The SSE bridge is the one genuinely new wire — and it's already reserved.** | `sidecar/index.js:139`: *"a future SSE bridge can forward it to the station HUD"*; `chanBus` is console-only at `:141`. | Stage 1 builds exactly that bridge. Purely additive (new endpoint + new `EventSource`, zero change to `/api/run`). |
| **Strict determinism contract.** | `conveyor.js` is RNG-free / wall-clock-free (`clock-rng.test.js`, `lint-determinism.js` gates). | All new sim code derives from injected `nowMs`/`dtMs` + event data. Junction routing must be a pure function of payload + a **tick-start snapshot** of queue depths. |

---

## 3. Additive data-model changes

### 3a. Events to REQUEST from the cortex-memory owner (exact stanzas)
> File the request with these verbatim. They validate against the existing zero-dep `schema.js`
> (`obj`/`str`/`int`/`num`) — **no `schema.js` change needed.** Old replays ignore unknown names.

| Event | Stanza | Stage |
|---|---|---|
| `workitem.placed` | `obj(['workitemId','queueId'], { workitemId:str, queueId:str, agentId:str, kind:str, preview:str, queueDepth:int, ts:num })` | 1 |
| `workitem.delivered` | `obj(['workitemId','finalQueueId'], { workitemId:str, finalQueueId:str, agentId:str, box:str, ms:num, ts:num })` | 1/3 |
| `queue.status` | `obj(['queueId'], { queueId:str, depth:int, maxCapacity:int, nextAdvanceAt:num })` | 1/2 |
| `workitem.advanced` | `obj(['workitemId','queueId'], { workitemId:str, queueId:str, toQueueId:str, ms:num, ts:num })` | 4 (junctions) |
| `xp.minted` | `obj(['agentId','runId','xp'], { agentId:str, runId:str, xp:num, source:str, fromUsd:num })` | 6 |
| `station.tier` | `obj(['tier'], { tier:int, from:int })` | 6 |

### 3b. Changes owned by THIS workstream (not the shared contract)
- **`doc.belts[*]` tier** *(Stage 4+, optional)* — make a belt value `"dir"` → `"dir@tier"` so `SPEED` can be
  per-tile. `migrate()` already drops malformed keys; legacy `"E"` parses as tier-1. Backward-compatible.
- **`CAP_REGISTRY` grant `tier` + `unlockReq`** *(Stage 6)* — additive fields gating *placement* in REFIT.
  `resolveTools` is structurally unchanged. Pre-economy saves default `tier:0`/`unlockReq:{}`.
- **`propsprites.js` CATALOG entries** under `cat:'logistics'`, all `blocks:false` (must be walkable — the
  model only blocks for `p.block !== false`): `intake`, `outbox`, `splitter`, `merger`, `filter`, `wastesink`.
  Each needs an `F.<id>(x,y,w,h,f)` procedural 12px draw fn. Props stay inert `{id,t,x,y,w,h,block}`; the
  source/sink/junction **semantics live entirely in the caller** (world.js sim binding + the belt-graph
  compiler), so the model and its validators are untouched and old saves load unchanged.

---

## 4. Staged implementation

> All feature work in **one** worktree: `gen-trees\new-agent-tree.ps1 workpipe` →
> `C:\Users\<you>\gen-trees\workpipe` on `agent/workpipe`. Commit only your own files with explicit pathspecs.
> Rebase onto trunk (`sync-agent-tree.ps1 workpipe`) before merging; `npm run test:fast` must be green.

### Stage 0 — Land the prerequisite + open the contract request
- **Merge `agent/conveyor` (`06cec93`) to trunk** in its own worktree: rebase onto trunk, resolve
  `world.js`/`worldmodel.js` conflicts with `d9358a8`, `npm run test:fast`, then merge. Brings `conveyor.js`,
  the `worldmodel` belts layer, the BELT tool (key 7), `world.js` wiring, `CONVEYOR.md`, `test/conveyor.test.js`.
- **Create `agent/workpipe`** off the now-conveyor-bearing trunk.
- **File the events request** (§3a, Stages 1–3 set) with the exact `obj(...)` stanzas.
- **Acceptance:** conveyor on trunk + `test:fast` green; `agent/workpipe` exists; request filed.

### Stage 1 — Smallest honest end-to-end: inbox belt carrying a real Telegram message  *(effort: M)*
DM the bot → one real box spawns at INTAKE → rides your belts → reaches the desk as the run becomes visible →
queue depth is visible. Inbound-only, Telegram-only, no junctions.

| File | Change |
|---|---|
| `frontend/app/conveyor.js` | Add `Conveyor.create({onDeliver, backpressure})`. Add `convey.enqueueAt(x,y,payload)` pushing one box with `bx.payload` set (bypasses hash auto-spawn). In `tick()` open-end branch (~`:233`), call `onDeliver(bx,bx.x,bx.y)` **before** sink when `bx.payload`. In `drawBoxes` (~`:321`) draw a small amber `TG` glyph over the crate when `bx.payload`. All timing deterministic. |
| `frontend/app/propsprites.js` | `CATALOG` entry `{id:'intake', label:'INTAKE', cat:'logistics', w:2, h:2, animated:true, blocks:false}` + `F.intake(x,y,w,h,f)` art that glows on `f.work`. |
| `frontend/app/build.js` | `renderPalette()` gains a `'logistics'` category branch (mirror the `'prop'` case ~`:177-201`) under the existing PROP tool (key 6). **No new tool key.** |
| `sidecar/index.js` | Replace console-only `chanBus` (`:141`) with a fan-out to a Set of SSE streams (keep the log). Add `GET /api/channels/events` (`text/event-stream`) registering `res`, removing on `close`/`aborted` (mirror the `/api/run` finally cleanup). Wrap the `onInbound` injection (`:179`) so **before** `hub.onInbound` it computes the agentId with hub's **exact** logic (`sec.agentId \|\| agentIdFor(chatId)`), bumps a per-agent depth counter, derives `workitemId` via `crypto.randomUUID()`, and emits `workitem.placed` + `queue.status`. |
| `frontend/app/world.js` | `intakeMessage(payload)` resolves the INTAKE tile from `projectGeometry` and calls `convey.enqueueAt(...)`; bind it to `U.bus 'workitem.placed'`. Pass `onDeliver` into the existing `Conveyor.create()` (~`:335`): flip agent to working + `say('received: '+preview)`, match box→run by `workitemId`. Add `drawQueueDepth(now)` after the lightmap (~`:351`). |
| `frontend/app/stationui.js` *(or world init)* | Open `new EventSource('/api/channels/events')`; re-emit each event onto `U.bus`. Reconnect with backoff; close on teardown. |
| `test/conveyor.test.js` | `enqueueAt` places exactly one payload box at the source; it reaches the open-end sink and `onDeliver` fires once with the payload; ambient hash throughput on a plain belt is **unchanged** when `backpressure` is off (regression guard). |

**Acceptance:** A DM produces exactly one box at INTAKE that rides to the desk; the agent visibly "receives"
it as `agent.run.start` streams; the depth HUD increments on a second mid-run DM. No INTAKE/belt → reply still
arrives, no crate. `test:fast` green.

### Stage 2 — Visible backpressure + supersede drop  *(effort: M)*
A second message mid-run stacks/holds a box; when the hub supersedes the prior run, its box drops off the belt.

| File | Change |
|---|---|
| `frontend/app/conveyor.js` | Per-instance `backpressure:true` that holds a new box at the source while the next tile is occupied (reuse existing `MIN_GAP`; do **not** touch ambient belts). Add an API to early-sink the box matching a `workitemId`. |
| `sidecar/index.js` | On supersede (new inbound for an already-inflight agentId), emit `queue.status` with the lowered depth + the active `workitemId`. |
| `frontend/app/world.js` | When `queue.status`'s active `workitemId` no longer includes a riding box, early-sink it (drop animation). `drawQueueDepth` shows `depth>1` stacking. |
| `test/conveyor.test.js` | With `backpressure:true`, two boxes don't overlap and the second holds; early-sink removes exactly that box. |

**Acceptance:** Spamming stacks crates (gauge climbs); each supersede drops exactly the superseded box; ambient
belts provably unchanged. `test:fast` green.

### Stage 3 — Outbound belt + SINK delivery  *(effort: M)*
Close the loop: the agent's output rides an OUTBOUND belt from the desk to an OUTBOX sink that delivers it,
appearing as the reply is actually sent.

| File | Change |
|---|---|
| `sidecar/channels/hub.js` | At the `deliver()` send loop (~`:94-104`) and on a successful memory/file deliverable, emit `workitem.delivered` **after** the real send succeeds (additive; no change to send/abort flow). **Reuse the inbound `workitemId`** so the round trip is one tracked item. |
| `frontend/app/propsprites.js` | `{id:'outbox', label:'OUTBOX', cat:'logistics', ...}` + `F.outbox` (chute that flashes on delivery). |
| `frontend/app/world.js` | On outbound `workitem.delivered`, enqueue a box at the desk that rides the OUTBOUND belt to OUTBOX; sink plays a delivery flash. No outbound belt → no box (server already sent). |
| `frontend/app/build.js` | Logistics palette gains OUTBOX. |
| `test/channels.hub.test.js` | `workitem.delivered` emitted only after a successful send, **not** on superseded/aborted runs (mirrors the assistant-turn-only-on-success invariant); outbound `workitemId` matches inbound. |

**Acceptance:** A completed run sends the reply **and** shows an outbound box riding to OUTBOX, keyed to the
same `workitemId`. Failed/superseded runs emit no delivered box. `test:fast` green.

### Stage 4 — Routing topology: splitter / merger / filter junctions  *(effort: XL)*
| File | Change |
|---|---|
| `frontend/app/conveyor.js` | Junction override map `tile → {kind, policy, lanes}` passed into `tick()`. At a junction, pick an out-neighbor by policy (splitter round-robin/least-loaded from a tick-start snapshot; filter matches `bx.payload.tag` with default overflow; aggregator buffers until K then emits one combined box). Emit `workitem.advanced` per decision. **Pure functions of payload + start-of-tick depth snapshot.** |
| `frontend/app/propsprites.js` | CATALOG + `F` fns for `splitter`/`merger`/`filter` (LED-on-transit). |
| `frontend/app/worldmodel.js` | **No semantic change** — junctions are inert props. Add pure `compileBeltGraph(geo)` beside `projectGeometry` producing `{sources, lanes, junctions, bays}` with validation (orphan/dead-bay/cycle). Surface as build.js red ghosts. |
| `sidecar/index.js` *(or new `sidecar/pipeline.js`)* | When a junction routes to a bay bound to a different agentId, fire `runOnce` for **that** agent (reusing the exact `runOnce` + capability projection). **Critical seam:** distinguish *next-item-in-a-queue* (must WAIT via backpressure) from *newer-message-in-a-chat* (supersedes) — or the second work item is silently dropped. |
| `test/conveyor.test.js` | Round-robin splitter distributes N evenly; filter routes by tag w/ overflow; aggregator emits exactly one box at K; two identical event sequences → identical trajectories (replay-stable). |

**Acceptance:** Splitter fans one stream across multiple bays (parallel real runs); filter sorts by classifier
tag with a visible overflow lane; aggregator fuses K→1. Same-bay second item queues (no drop). Deterministic.
`test:fast` green.

### Stage 5 — Belt-graph compiler + Foreman HUD  *(effort: L)*
| File | Change |
|---|---|
| `frontend/app/worldmodel.js` | Promote `compileBeltGraph` to the single source of truth for both the tick and sidecar routing; add per-belt tier parsing (`dir@tier`), defaulting tier-1 for legacy keys via `migrate()`. |
| `frontend/app/conveyor.js` | Per-tile tier drives `SPEED`; least-loaded splitter & priority merger drain-order read snapshotted depth so the station self-balances around a slow/expensive agent. |
| `frontend/app/world.js` | `drawThroughputHUD(now)` (boxes/min in-out, avg dwell, deepest-jam lane highlighted) at the after-lightmap seam. |
| `frontend/app/stationui.js` | `agBrief()` stat grid (~`:199-214`) gains queue-depth (avg/peak) + throughput (items/min) cells from `World.getMetrics()`. |
| `test/conveyor.test.js` | Higher-tier belt moves a box in fewer ticks; throughput numbers derive only from box lifecycle events (no wall-clock). |

**Acceptance:** The compiled graph governs routing; orphan/cycle/dead-bay layouts light red before running; a
jam's length tracks real pending-work; HUD names the bottleneck lane. `test:fast` green.

### Stage 6 — RPG economy + progression  *(effort: L)*
| File | Change |
|---|---|
| `frontend/app/economy.js` **(NEW)** | Pure, zero-dep, node+browser (mirror `workstreams.js`). Subscribe to `agent.cost` (reconciled), `agent.run.end.reason`, `deliverable`, `memory.write`; fold into per-agent XP/stats, station tier (`doc.meta.tier`, already exists, defaults 0), yield ratio, slag tally. **Every XP entry derives from the same reconciled usd delta as the dollar ledger** (asserted in tests). Emit `xp.minted` + `station.tier`. |
| `frontend/app/world.js` | Recolor riding box on reconcile (green/amber/red); route budget/max_iters/error runs as red slag to a WASTE SINK with a hoverable post-mortem (templated from `reason` + which tools were/weren't in the room + cache ratio). |
| `sidecar/capability registry` | Additive `tier` + `unlockReq` on grants; `resolveTools` unchanged. |
| `frontend/app/build.js` | Logistics palette gains WASTE SINK; capability/belt-upgrade nodes gate on station tier + XP. |
| `frontend/data.js` milestones/perks | Repurpose v7 fake-revenue milestones in place with **real** predicates (first successful run, cache-hit >50%, 10 orders under budget, a zero-slag station-day). |
| `test/economy.test.js` **(NEW, add to `test:fast`)** | XP-source == cost-source; yield ratio = `Σ(productUsd)/Σ(spentUsd)` from reconciled deltas; slag classification matches `agent.run.end.reason`; old `meta.tier=0` saves unlock-gate correctly. |

**Acceptance:** A $0.04 run rides as an ore box → green deliverable worth XP; a $2 `max_iters` loop rolls into
the waste sink with a fixable post-mortem; agent levels + station tier rise only from reconciled spend; tech
tree gates by tier. `economy.test.js` + `test:fast` green.

---

## 5. Test plan

All new tests are **headless** (no DOM/canvas), matching the `conveyor.test.js` pattern (pure model + injected-time sim). Extend `npm run test:fast`:

1. **`test/conveyor.test.js`** — enqueue/delivery/payload; backpressure hold + early-sink by `workitemId`;
   **ambient throughput unchanged when backpressure off** (key regression guard); junction cases (even split,
   tag filter + overflow, K-aggregate, replay-stability); per-tier speed.
2. **`test/channels.hub.test.js`** — `workitem.delivered` only after a successful send, not on superseded runs;
   inbound/outbound `workitemId` match.
3. **SSE fan-out unit test** — a registered fake `res` receives a written event line; `close`/`aborted` removes
   it (no leaked Set entry).
4. **`test/economy.test.js`** (Stage 6) — XP-source == cost-source; yield ratio; slag classification; old-save
   unlock gating.
5. **Determinism is double-guarded** by `test/clock-rng.test.js` + `test/lint-determinism.js` (no `Math.random`,
   no direct `performance.now`). `test/lint-emits.js` fails on any pre-grant literal emit of a new event — a
   green `lint-emits` is the signal the contract request landed.
6. **Manual smoke** (not in the gate): connect the bot, DM it, watch the box ride INTAKE→desk + depth HUD; spam
   to see stacking + supersede drop; complete a run to see the outbound box ride to OUTBOX.

---

## 6. Risk register

| Risk | Mitigation |
|---|---|
| **`agent/conveyor` unmerged** — entire belt model/engine/tests live only there (`06cec93`); may conflict with the `d9358a8` props merge. | Stage 0: rebase onto trunk in its **own** worktree, resolve there, `test:fast`, then merge. Don't start `workpipe` until trunk carries conveyor. |
| **`events.js` owner-gated + `lint-emits` fails on un-registered literals.** | File the request early; until granted, drive the browser via dynamic `emit(name, payload)` or a temp `U.bus` name; switch to literals on grant. |
| **Client box-ride vs network-dependent run-start desync.** | Decouple via `workitemId` matching; hold the "received" bubble until the first `agent.token`; if the box arrives first it still completes its ride. |
| **Determinism** — `enqueueAt` + junctions are event-driven; least-loaded/backpressure read live state. | `workitemId` from server `crypto.randomUUID`; every routing decision a pure fn of payload + a tick-START depth snapshot; order boxes by arrival event; stable iteration order. |
| **Single-flight vs real concurrency** — splitter→same bay must QUEUE, not supersede. | Stage 4 critical seam: the bay-busy gate distinguishes next-item-in-queue (wait) from newer-message-in-chat (supersede). Dedicated test. |
| **Cost/abuse blow-up** — every delivered box fires a paid `runOnce`; a cycle = infinite paid work. | `MAX_BOXES` caps cargo but not spend → add a station-level admission + budget gate (`budget.threshold` exists); the compiler's **cycle detection is a safety feature**, not just UX. |
| **SSE memory leak** — one long-lived response per tab. | Remove from the Set on `close`/`aborted` exactly like the `/api/run` finally block; unit-test removal. |
| **Per-chat vs shared agentId** — HUD could count the wrong queue. | Compute `queueId`/`agentId` at the intercept with byte-identical logic to `hub.js`. |
| **Custom-station gaps** — `sitTiles`/`beltInfo` hardcoded from v7 `map.js`. | Stage 4/5 compiler closes the belt→agent binding seam; Stage 1 uses the known desk/seat so it works on the foundation immediately. |
| **Scope honesty** — Stage 4/5 are XL/L and carry most of the load; Stage 1 is only M. | Ship Stage 1 payload plumbing solid before any junction work, or you get pretty belts routing nothing (the cosmetic-parcels trap). |
| **Economy over-gamification** could nudge burning *more* real dollars for dopamine. | Keep yield-ratio + slag sink front-and-center so the rewarded behavior is spending **less** for more; never mint XP from estimates (reconciled `agent.cost` only). |

---

## 7. The shortest path to "wow"

If you want one demo that proves the whole thesis: **Stage 0 + Stage 1.** Connect the bot, place an INTAKE bay,
drag a belt from it to your agent's desk, and DM the bot — a crate carrying your actual message rides the line
you built and the agent lights up as it arrives. That single thread (Telegram → box → real run) is the proof;
every later stage is additive on top of it.
