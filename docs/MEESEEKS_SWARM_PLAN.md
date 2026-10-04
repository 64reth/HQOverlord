# Meeseeks Swarm — ephemeral sub-agent visualization

**Status:** backend LANDED (`team.spawn`) · frontend sprite layer NEXT. Design captured 2026-06-24, resolved 2026-06-26.

## The idea

When the orchestrator delegates a swarm (fans out sub-agents at once), the station
*materializes* a crowd of ephemeral worker-sprites — Mr. Meeseeks from Rick and Morty.
They blink into existence, frantically do their one task, and **pop out of existence the
instant that task completes**. They are stuck in the station, existing, until done.

This is NOT a cosmetic flourish. It is a **live, honest dashboard of the orchestrator's
fan-out, dressed as Meeseeks.**

## Why it's the right metaphor (on-DNA)

- **Eerie, not cute.** Meeseeks exist in mild existential pain; their whole being is
  "complete the task so I can stop existing." A cute helper sprite would betray the moat —
  a Meeseeks-style ephemeral worker reinforces it. Spawned into suffering, the only exit is
  finishing real work.
- **Truthful telemetry for free.** A swarm visual is dangerous because it tempts faking the
  count for spectacle (the app-lies failure mode). Meeseeks dodge it: **one real sub-agent =
  one Meeseeks.** They pop in when the orchestrator *actually* spawns, pop out when that
  *specific* sub-agent *actually* returns. The population of the room literally *is* the
  live fan-out. No theater.
- **Reuses existing machinery.** Zone containment + walk-to-desk + per-agent sentience
  (workforce-zones Tier A/B/C, all shipped) already give ~70% of the mechanics.

## RESOLVED DESIGN (2026-06-26, Andrew-directed)

The identity question is settled: **a Meeseeks is a sub-agent the overseer clones from
itself** — anonymous, ephemeral, spawns in → does its one task → vanishes (the Claude-Code /
Codex "Task tool" concept). It is explicitly NOT a persistent roster agent:

- **Persistent agents** (created / summoned) = permanent profiles with bodies, desks, identity,
  XP. They exist until the Commander removes them. Delegating to them via `team.dispatch` is
  **not** a Meeseeks — they keep their own body and walk to their own desk.
- **Meeseeks** = an ephemeral self-clone spawned by `team.spawn`. No roster entry, no home,
  no persistence. The population of blue sprites literally IS the live sub-agent fan-out.

**Clone fidelity — ref-style configured worker, not a literal clone.** (Reference: the reference harness
`delegate_task` replaces the system prompt with a focused task, narrows the toolset, gives a
fresh budget + no shared memory.) Our `team.spawn` clone inherits the lead's OWN base system
prompt + model (so it *is* a copy of the overseer — honoring "clone of itself" visually), but
is narrowed: a fresh focused subtask as its only input, its own per-worker cost cap, the
WORKBENCH but **no orchestrator object**.

**Depth: FLAT (depth 1).** A clone never gets the orchestrator object, so `team.spawn` /
`team.dispatch` are never exposed to it — it structurally cannot spawn its own sub-agents.
(Same gating that already stops a delegated worker re-delegating.) No Meeseeks-box cascade —
by design, for cost safety. Could become a config knob later.

## Lifecycle (mapped to real events)

1. **Spawn** — overseer calls `team.spawn` → N ephemeral clones start → N `task{kind:'subagent'}`
   + `agent.run.start` events. N Meeseeks blink into existence (poof, blue, "POOF").
   Materialized, not pre-placed — which reads as eerie.
2. **Disperse** — each runs to a workstation or clusters at the task site. Reuses
   zone-containment + walk-to-desk. They are *contained* — cannot leave the station until
   done. That containment IS the "stuck existing" beat, already built.
3. **Frantic work** — animation tracks REAL signal (`agent.cost` / tool activity), NOT a loop
   timer. A loop-timer frenzy would lie about progress.
4. **Pop** — sub-agent returns (`task{status:'done'}` / `agent.run.end{reason:'done'}`) → that
   Meeseeks vanishes. The room empties as the work completes; swarm progress readable at a
   glance by how many remain.

## Decided design forks

- **Distress on long-running tasks — BUILD THIS.** Meeseeks degrade / get desperate the
  longer they're stuck. A visibly fraying Meeseeks = "this delegation is stalling, retrying,
  or burning iterations." Eerie AND useful — the best part of the metaphor.
- **Failure death ≠ success pop.** Success pops clean (relief). A sub-agent that errors out
  (`status:'error'` / `agent.run.error`) must cease *differently* — not a satisfying poof.
  Identical animations would hide failure behind a pleasing effect (a lie).

## Hard constraints (do NOT violate)

- **Ephemeral only.** Swarm Meeseeks must never become permanent residents — that collides
  with the persistent-agent identity model and the object=capability projection.
- **Never fake swarm size.** If the real fan-out is 3, show 3. No spectacle inflation.
- **Frenzy must be honest.** Animation intensity tied to real activity, not a timer.

## BACKEND — LANDED (`team.spawn`)

`sidecar/tools/builtin/orchestration.js` now has **`team.spawn`** (alongside `team.dispatch`):
the lead spawns N ephemeral self-clones in parallel, each routed through the durable subagent
registry (`subagents.start`). **Contract-free**: each clone emits the existing frozen
`agent.run.start/end/cost` (forwarded to the lead's bus for the floor) **and** a
`task{kind:'subagent', status}` record (the Meeseeks identity signal) — no `shared/events.js`
change. Foreground returns each clone's result; `background:true` returns durable handles
(listable / interruptible / resumable via the existing `team.subagents` / `team.interrupt` /
`team.resume`). The clone gets the lead's base `system` + `model`, the WORKBENCH, the lead's
consent broker, a per-worker cost cap, and a fresh `sub-*` agentId — but NOT the orchestrator
object (flat depth). Tested in `test/orchestration.test.js` (clone identity, ephemeral
non-roster id, flat depth, result flow, the visual feed, capability gate).

## FRONTEND — NEXT (the Meeseeks sprite layer)

Wire the visual against the events that now fire (no contract change needed):

1. **Materialize** — on `task{kind:'subagent', status:'running'}` (or a forwarded
   `agent.run.start` for an ephemeral `sub-*` agentId), poof a blue ephemeral sprite. NOT a
   persistent crew body.
2. **Frenzy** — animation intensity tracks real `agent.cost` / activity, never a loop timer.
3. **Pop** — on `task{status:'done'}` (or `agent.run.end{reason:'done'}`), clean vanish.
4. **Death ≠ pop** — on `status:'error'` / `agent.run.error`, cease *differently* (no
   satisfying poof).
5. **Distress** — degrade the longer a clone is stuck (readable "this delegation is stalling").

Reuse the existing crew-body template (`world.js spawnAgent`) but flag it `ephemeral:true` +
expire on completion; key the sprite off the subagent record id so one real sub-agent = one
Meeseeks, never a faked count. Note: confirm the subagent lifecycle events reach the browser's
event stream (the lead-bus forward covers the watched lead run; background workers may also need
the global/channels bridge) before building the sprites.
