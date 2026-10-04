# Summon Fixes — plan

Three bugs in the **multi-agent summon flow**, all traced to the live `frontend/app/` engine
(NOT the dead `frontend/js/` v7 sim, which only `v7-reference.html` loads).

## Architecture context (why these bugs exist)

`frontend/app/world.js` has a hard split:

- **`agent`** (the "hero", `world.js:52`) — the single active agent with the FULL state machine:
  `tick()` (`world.js:1300`), `wander()` (`world.js:614`), `decideIdle`, `nextWaypoint`, `arrive`.
  `tick()` early-returns on the hero alone (`world.js:1301`).
- **`crew`** (`world.js:53`) — every OTHER agent (summoned or bay-bound), described in the file's
  own header as *"LIGHT static figures... no pathing/AI — they just receive work and light up"*
  (`world.js:49-50`). Crew bodies are only **drawn** (`world.js:1444`), never **stepped**.

Summoned agents (`App.summonAgent`, `app.js:198`) become crew bodies via `World.spawnAgent`
(`world.js:1947`). That single design fact is the source of Bugs 2 and 3.

---

## Bug 1 / Phase 2 — The per-agent PC rule + summon guidance

### Clarified design (Commander, 2026-06-22)

> **Each agent MUST have its OWN dedicated PC.** Not its own *room* — multiple agents may share a
> room (e.g. 3–4 agents passing work between them). But every agent needs a distinct computer.
> Workflows run on **conveyors** an agent is assigned to; a conveyor may be customized to serve
> multiple agents. **Hovering a PC or a conveyor shows the name of the agent it's bound to**, so a
> shared room stays organized without one-room-per-agent.

This replaces today's **room-based** compute model with **per-PC binding**.

### What exists today (investigated)

- **Binding is already generic.** `assignPropAgent(propId, agentId)` (`worldmodel.js:630`) tags ANY
  prop with an agentId (validated `AID_RE`); `addProp` accepts `agentId`; `propsByAgent(agentId)`
  exists. The bay agent-picker (`build.js:371-408`) is the existing assignment UX to clone.
- **Compute is room-based.** `bayObjects(agentId)` (`worldmodel.js:683`) finds the agent's `bay`
  prop, takes its ROOM, and grants every cap-prop in that room (`CAP_PROP_MAP`, `worldmodel.js:56`).
  In a shared room, BOTH agents get every computer — the exact ambiguity to fix.
- **Routing is geometric, via bays.** `compileRoutingPlan` (`pipeline.js`) builds `bays[]` from
  `bay` props (each carries `agentId`); work rides belts to whichever bay tile it reaches
  (`resolveTarget`). Belts carry **no** agentId today. Sidecar `router.stationFor(agentId)`
  (`sidecar/routing/router.js:39`) feeds the bay's `objects` into the compute gate (`loop.js:177`).
- **Bay sprite already draws the bound agent's name** (`propsprites.js F.bay`). Build-mode hover
  (`build.js:1016`) draws only an outline — no agent label yet.

### Staged plan (de-risked; routing/sidecar untouched until 2b)

**Phase 2a — per-PC compute + hover + summon guidance (low risk, no routing changes):**
1. **Per-agent PC binding.** Add a computer-prop agent-picker (clone the bay picker) so a `computer`
   prop can carry an `agentId`. Change the **compute** determination so an agent has compute iff a
   computer prop is **bound to it** (reuse `propsByAgent`). Keep cabinet/dish/notebook/connector
   **room-based** (shared room resources) for now — only the PC (the compute gate) goes per-agent.
   Update the build-mode "NO COMPUTE" check (`build.js:998`) to the per-agent rule.
2. **Hover labels.** PC props (and belts) show the bound agent's name on hover — build mode first
   (extend `drawHover`, `build.js:1016`), then the live world.
3. **Summon guidance (the original Bug 1).** On `summonAgent`, after spawn: if the agent has no
   bound PC, replace the generic toast with *"AGENT ready — type to task it now. Give it its own
   computer (open REFIT) to run cost-isolated / take floor work."* + a **persistent marker** over
   the body that clears once a PC is bound. (Truthful: direct chat already runs on the default
   office — see the run-path note below — so the marker means "no dedicated PC yet," not "can't
   run".)

**Phase 2b — conveyor → agent assignment (later; touches routing + sidecar):**
- Tag belts with an optional `agentId`; hover shows it; a conveyor may list several agents.
- Decide whether the bound **PC becomes the routing endpoint** (absorbing the separate `bay`
  concept) or bays stay as the endpoint while PCs add compute. **OPEN — gates the rewrite.**

### Run-path truth (why the marker isn't "can't run")

`/api/run` sends no per-agent station (`harness.js:137`); the sidecar falls back to the **default
office, which includes a computer** (`index.js:1425-1443`). So a directly-chatted agent (hero or
summoned) runs regardless. The compute gate only bites on **bay/conveyor-routed** work
(`router.stationFor`). The PC rule makes the *floor* honest about who can take routed work.

---

## Bug 2 — Second agent vanishes after entering/exiting build mode  ✅ FIXED (Phase 1)

**Root cause.** `syncCrewFromPlan`'s early-return guard (`world.js:1900`):

```js
if (!routingPlan || !routingPlan.bays || !routingPlan.bays.length || !geo) { if (crew.length) crew = []; return; }
```

When there are **no bound bays**, it wiped the ENTIRE crew array — including summoned bodies. The
rest of the function carefully preserves summoned crew (`crew.filter(b => b.summoned)`,
`world.js:1910`), but this guard did not. A freshly summoned agent with no bay is exactly the
no-bays case. Toggling build fires a rederive (`station.onChange` → `geoDirty`, `world.js:211`),
which calls `syncCrewFromPlan` → the guard nuked the summoned body.

**Fix (applied).** Mirror the existing preservation in the guard:

```js
if (!routingPlan || !routingPlan.bays || !routingPlan.bays.length || !geo) { crew = crew.filter(b => b.summoned); return; }
```

**Verification.** `world.js` is a browser IIFE with no node coverage and `syncCrewFromPlan` is
private, so this is verified via (a) the existing `test:fast` gate staying green and (b) live
preview: summon an agent → toggle REFIT → confirm the body survives.

---

## Bug 3 — Summoned agent never moves / no idle wander

**Root cause.** By design: the entire movement+idle machine operates ONLY on the hero `agent`.
`tick()` early-returns on the hero (`world.js:1301`); crew bodies are never advanced. So a summoned
agent has no code path that moves it.

**Decision: Light wander only** (kept SEPARATE from the hero's rich leisure/prop/couch AI, to
respect the "crew = light bodies" boundary and avoid destabilizing the delicate hero code).

**Fix (Phase 3) — DONE (pending live visual).** Added a self-contained crew stepper
(`stepCrew`/`crewWander`/`crewNextWaypoint`, `world.js` after `beltUnion`), invoked from `tick()`
right after `tickNeeds`:
- Scoped to **summoned** bodies (`b.summoned`) — the explicit ask; a bay-bound body stays where
  work is delivered (and avoids the `syncCrewFromPlan` re-foot yank).
- When not `working` and `idleUntil` has elapsed, picks a random reachable tile (`geo.path`,
  belt-free where possible via `beltUnion()`) and walks it with the SAME integrator math the hero
  uses (`world.js:1335-1356`), advancing `pathPts`/`pathIdx`, then dwells 2.4–6.5s and repeats.
- A live run (`b.working`, lit by `setActivityFor`) clears the path and holds the working pose.
- Freshly summoned bodies hold a 1.4–3.2s materialize-dwell before the first stroll.

Verification: parse-clean, full `test:fast` green, boots with no console errors, the per-PC rule
runtime-verified. The walk itself needs a woken app (the static harness sits behind the BYOK
awakening gate) — verify live in a running instance.

---

## Bug 4 / Phase 2c — agents only interact with props assigned to THEM

**Report.** Placing a PC made the hero walk over and use it — the curiosity/novelty system treats
any freshly-placed prop as "go inspect it." For complex Factorio-style multi-agent floors, an agent
must only interact with props **assigned to it**; another agent's (or an unassigned) workstation /
capability prop must be ignored.

**Fix — DONE.** Added `isOwnableProp(t)` (a capability prop via `capForProp`, or a `bay`) +
`mayTouchProp(agentId, p)` (`world.js` after `propUse`). An OWNABLE prop is touchable only by its
assignee; leisure/decor stay shared; an UNASSIGNED capability prop is touchable by no one. Applied
at every hero prop-targeting site:
- `scanNovelty` — a not-mine/unclaimed capability prop is never queued as novelty (no walk, no
  startle glance).
- `planPOI` — the ambient "machines to inspect" list excludes not-mine capability props.
- `planInspect` — defensive re-check when popping the novelty queue.
- `maybeRounds` — the caretaker lap skips ownership beats at not-mine capability props.

Runtime-verified: hero ignores coder's PC, an unassigned PC, and writer's bay; still uses its own
PC; decor (plant) stays shared. Crew bodies don't target props (Phase 3 wander only), so the rule is
enforced wherever an agent actually chooses a prop.

## Sequencing

1. **Phase 1 — Bug 2 one-line guard fix + test gate green.** ← done, pending verification.
2. **Phase 2 — Bug 1 prop guidance** (toast + persistent marker).
3. **Phase 3 — Bug 3 light crew idle-wander.**

All work in the `agent/summon-fixes` worktree. `npm run test:fast` green + rebase onto trunk
before merging to `feat/harness-backend`, per `CLAUDE.md` harness protocol.
