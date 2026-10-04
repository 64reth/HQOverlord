# Periphery Props — Design & Build Plan

> The placeable-prop families that give the station **real harness function** beyond decor —
> distinct from the conveyor system (which wires the work *pipeline*). This doc is the spec the
> parallel build agents execute against. Every signal named here is verified against the real
> files in `frontend/app` + `sidecar` on `feat/harness-backend`.
>
> Status: **DOORS / AIRLOCK ISOLATION — Phase 1 (frontend) in build** on `agent/doors`. The rest
> are specced, not started.

---

## 1. The 3-zone filter (the permanent rule)

Every capability belongs to **exactly one** zone, and that decides whether it is a prop at all:

- **THE COMPUTER** — an agent's *core work*: code, research, web, tool calls. Anything done *while
  working* lives here. (This is why "telescope = web search" was rejected — agents already do web
  and research at their computer.)
- **THE PERIPHERY (the floor)** — **PROPS**, and only props. What happens *around* the work:
  memory, isolation, runtime-state, input/output. A thing is a legit prop **only if all four
  hold**: (a) an agent walks up to / interacts with it, (b) its *placement* changes behaviour,
  (c) it is not core work, (d) it does not overlap the conveyor/pipeline.
- **THE COCKPIT** — operator HUD: what the human sets/reads globally (scheduling, budget, task
  authoring, notifications). Built as UI panels, not floor objects.

When unsure, run the four tests. Budget, schedule-cadence, and "is trunk green?" fail tests
(a)/(b) — they are UI, not props.

---

## 2. The three loved families

### 2.1 DOORS / AIRLOCK — worktree isolation `← Phase 1 in build`

**A walled room *is* an agent's worktree/branch; an airlock placed in it *is* the merge/isolation
state.** `closed` = unmerged private work (the agent is sealed in), `open` = merged/connected to
the central **trunk** hub, `jammed` = a merge conflict. This maps directly onto the project's #1
failure mode — 7–10 agents clobbering each other — and makes isolation *visible*.

**How it works (grounded):**
- Doors are already **auto-generated**: `worldmodel.js projectGeometry()` opens a threshold at
  every seam between two different zones (the `addDoor` loop), and `canStep()` gates the path BFS
  on `doorSet`. So **sealing a room = skip its boundary doors** → `canStep` is false across its
  edge → the room is unreachable, using the *existing* pathing with zero new movement code.
- The seal visual is **automatic**: `stationbake.js buildEdges()` sets `e.door` from `canStep`,
  and `bakeWalls()` renders a threshold only when `e.door` is true — so a sealed seam re-bakes as
  a solid wall for free. **No `stationbake.js` change is needed for v1.**
- Door state lives **on the airlock prop** (`prop.door`), exactly like a BAY carries `agentId` —
  no parallel registry to desync. `setDoorState(propId, state)` mirrors `assignPropAgent`.
- A `closed`/`jammed` airlock seals **its containing room**. `meta.trunkRoomId` (the integration
  hub) **never seals**, so the station can't be severed from its core.

**Interaction (REFIT mode):** PROP tool → ISOLATION category → AIRLOCK → click in a room to place
(defaults to `closed`, immediately sealing). Click an existing airlock to cycle
`open / closed / jammed` via a modal cloned from the bay picker. Close REFIT → the live world
re-projects and respects the seal.

**Files (Phase 1):** `worldmodel.js` (door state, `setDoorState`, `projectGeometry` seal gate,
`propsLocal.door`, `migrate` sanitise + `trunkRoomId`, `freshDoc`), `propsprites.js`
(`F.airlock` + CATALOG `isolation` entry + thread `door` in `draw()`), `build.js`
(`openDoorPicker` + `commitPropStamp` airlock case), `test/worldmodel.test.js`.

**Phase 2 (owner-gated, later):** a real git producer `sidecar/worktree.js` shelling `git -C`
for `worktree list` / ahead-behind / `git merge`, `POST /api/merge`, emitting additive events
`worktree.state {branch,agentId,room,isolation,aheadBy,behindBy}` and
`merge.result {branch,target,ok,conflict,conflictFiles?}`, consumed in `world.js`
`connectChannelBridge`. Branch identity derives from the room's bay `agentId`
(`branch = agent/<agentId>`). Merges are **operator-gated** (matches the harness protocol — no
auto-merge). The **Trunk Reactor** (a core prop on `meta.trunkRoomId`) is built in this workstream.

### 2.2 STATUS BAYS — three runtime-state destinations

A set of three agent-bound destination props an agent autonomously walks to when its real backend
state turns non-nominal: **CHARGING POD** (rate-limited / cooling), **MED-BAY**
(errored / retrying), **CRYO POD** (paused / blocked). Kept **distinct** (not one mode-switching
pod): the operator interactions differ (resume vs retry/cancel vs answer-consent), the art reads
differently, and placement differs.

**Wiring by name:** driven by real state via a `runtimeState` map + `setRuntimeState(agentId,state)`
(sibling to `setActivity`) and a forced-override branch in `world.js tick()` above the
`activity==='task'` summon block (commandeer the agent like a summon; block `decideIdle`).
- CRYO needs **no new event** — reads `permission.prompt` (the consent await-pause) and
  `workitem.superseded` (the one-run-per-chat abort), both already frozen.
- CHARGING / MED need the finer reason: `sidecar/loop.js` `classifyApiError()` computes
  `cls.reason` and **currently discards it** — the additive change is adding optional `reason` to
  `agent.run.error` (`rate_limit|overloaded|billing` → pod; transient `server_error|timeout|…`
  → med-bay). Return-to-nominal derives from `agent.run.start`.

**Vertical slice:** CHARGING POD only, driven client-side from the existing run-end mapping in
`chat.js` (no `events.js` change yet).

### 2.3 OUTPUT / SHIPPING — the Printer & the Loading Dock

A finished deliverable physically materialises as a grab-able artifact. A per-agent desk
**PRINTER** spits a page the instant the agent saves a file; click opens the **real file**. A
central **LOADING DOCK** near trunk is where merged work ships out.

**Wiring by name:** the `deliverable {id,agentId,room,kind,title}` event is produced for real by
`fs.write` (`sidecar/tools/builtin/fs.js emitDeliverable`) and `notebook.write`, and already
crosses the bus to `chat.js`. The printer subscribes the same way in `world.js`; on the event the
bound agent walks to its printer (a new `goal='print'` mirroring `planProp`) and `arrive()` spawns
the artifact via `station.addProp({t:'artifact',block:false})`. Clicking it opens the already-live
jailed route `GET /api/file?agent=&path=`. The dock's "shipped on merge" beat consumes the doors
`merge.result` signal.

**Build order:** printer first (rides a fully-live signal, ships today); dock lights up once the
doors Phase-2 merge event exists.

---

## 3. New props that survived adversarial critique (ranked)

1. **Consent Desk / Approval Bell** — agent walks *off* its computer and freezes in a "needs you"
   pose while a run is paused on consent. Rides `permission.prompt` → `permission.response`
   (already frozen, no new event). The decision UI stays in the cockpit modal; the prop makes
   "which agents are blocked on *you*, and for what" legible spatially.
2. **Trunk Reactor (Integration Core)** — the central core that *is* the integration branch; the
   node the doors point at. Wires to `meta.trunkRoomId`. **Build inside the DOORS workstream.**
3. **Out-Tray / Reply Capsule** — confirms a reply actually *reached* the human (delivered /
   bounced). Wires to `channel.delivery {channel,chatId,runId,ok,chunks,reason}` (emitted at
   `hub.js`, currently **zero frontend consumers**). Does what the conveyor outbox structurally
   can't — the belt ends at dispatch; a bounce happens downstream.
4. **Credential Vault + Sandbox Enclosure** (ship as **one** "capability props" pair) — the +/−
   poles of object=capability-by-placement. Vault **grants** a privileged tool to its room;
   Enclosure **constrains** it (no network, read-only fs, requiresConsent). Wires to a
   `CAP_PROP_MAP` + `CAP_REGISTRY` row re-resolved each turn by `resolveTools`.
5. **Muster Gate (spawn / trigger-source dock)** — the agent strides *in* on spawn through one of
   three lanes matching *how* it woke. Wires to `agent.run.start {trigger:directive|schedule|event}`.
6. **Heartbeat Pylon** (lowest-confidence keeper) — pulses with the token stream, flatlines red on
   a stall. Wires to `agent.token` cadence (stateless per-frame, no new event). Build only if stall
   detection isn't folded into the desk work-glow.

*Dropped as redundant/overlapping: Fan-Out Bullpen, Respawn Cradle (= med-bay), Power Bus
(= cockpit budget), Roster Beacon, Mail Slot, Filing Cabinet (= the server-rack memory prop),
Hand-Off Dropbox, Dependency Cable — and the original telescope = web search.*

---

## 4. Build sequence + parallelisation

Each item is a candidate `agent/<name>` worktree; **green-before-merge** + **sync-before-merge**
apply to all. `shared/events.js` + `schema.js` are additive-only and owned by the cortex-memory
workstream — batch all event changes into one request.

**Wave 0 — owner-gated contract changes (one PR, unblocks the rest):**
- `agent.run.error` → optional `reason` enum (values already in `errorClass.REASONS`). *(Status Bays)*
- New `worktree.state` + `merge.result` events. *(Doors Phase 2 + Dock)*
- Everything else (Consent Desk, Out-Tray, Capability Props, Muster Gate, Heartbeat, Printer,
  Doors Phase 1) rides **already-frozen** signals — no Wave 0 needed.

**Wave 1 — frontend-only vertical slices (parallel, zero backend dependency):**
- `agent/doors` — **Airlock Phase 1 (this branch)** + Trunk Reactor marker.
- `agent/printer` — rides the live `deliverable` event.
- `agent/status-bays` — CHARGING POD slice, client-side from `chat.js`.
- `agent/consent-desk` — rides frozen `permission.*`.

**Wave 2 — leans on Wave 0 / Wave 1:** Doors Phase 2 (git sidecar + merge), Status Bays MED+CRYO,
Out-Tray (`channel.delivery`), Capability Props (Vault+Enclosure).

**Wave 3 — optional:** Loading Dock (needs doors `merge.result`), Muster Gate, Heartbeat Pylon.

**Shared-file contention:** `frontend/app/world.js` is touched by almost everything (each
`connectChannelBridge` handler + each `planX`/`arrive`/`tick` branch) — stagger merges, keep
additions to *new* handler/`goal` blocks. `propsprites.js` (CATALOG + `F` fn) and `worldmodel.js`
(per-instance config) are additive and low-conflict if each agent appends.

---

## 5. Open decisions for the owner

1. **Doors v1 branch identity:** derive from the bay `agentId` (`branch = agent/<agentId>`, zero
   new model field — **recommended**) **or** add a persisted `room.branch` now?
2. **Merge trigger policy:** operator-only click (**recommended — the human gate the protocol
   intends**) **or** also an agent action? (Auto-merge-on-green is rejected.)
3. **Status-bay reason signal:** add optional `reason` to `agent.run.error` (**recommended**) **or**
   a separate `agent.state` event?
4. **Runtime-state authority:** derive client-side in `chat.js` (fast; recommended for the slice)
   **or** the sidecar owns it (correct before multi-channel ships)?
5. **Capability props:** ship Vault + Enclosure as one workstream (**recommended**) **or** two?
6. **Heartbeat Pylon:** distinct cadence/stall prop **or** fold stall-detection into the desk glow?
