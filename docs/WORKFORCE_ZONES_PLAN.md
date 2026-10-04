# Workforce Zones + Per-Agent Sentience — build plan & goal/loop contract

> Lane: `agent/workforce-zones` (worktree `C:\Users\<you>\gen-trees\workforce-zones`), forked from
> trunk `feat/harness-backend`. This executes **WORLD-GAME's chartered "eerie/idle" task** (see
> `SESSIONS.md` — SUMMON-FIXES is merged/dead, the world.js pause is lifted, eerie/idle is the queued
> next task). Claiming it as a named worktree IS the anti-overlap signal in the live registry.
> **This lane does NOT merge to trunk** — it stops at "green + adversarially verified + ready" and
> hands off to the orchestrator (the only session that merges, per `ORCHESTRATION_PLAN.md`).

## Why (the problem, confirmed against current trunk world.js)

1. **The eerie sentience engine is HERO-ONLY.** `tick()` runs `tickNeeds` + the full idle ladder +
   `decideIdle()` → `maybeQuirk()` (stare/vigil/face-wall/needs/temperament/quirks) for the single
   module-level `agent`. Crew bodies get only `stepCrew()` → `crewWander()`: walk to a random
   reachable tile, dwell, repeat. No needs, no temperament, no quirks. BR-4 was "fixed" only to the
   floor ("summoned agents now move"), not hero-parity.
2. **Idle behavior has NO lane discipline.** Both the hero idle pickers AND `crewWander()` choose
   targets from the WHOLE reachable floor (`geo.allRects`, any walkable tile; only belts avoided).
   Agents drift out of their assigned area, lounge on couches across the station, and "explore" new
   props — breaking the visual legibility of "assigned agent → assigned station → work happens here."

Work routing is already correct and is **out of scope**: a tasked agent already walks only to its own
assigned workstation (`deskPropFor(agentId)` matches `prop.agentId`), and capability is per-room/bay.
We do not touch work routing.

## THE GOAL (definition of done — the "standard" the loop runs until it meets)

**Tier A — CONTAINMENT (must-have; the loop will not stop until this is bulletproof):**
- A1. No agent — hero or crew — ever targets a tile or prop **outside its own zone** during idle.
  This holds for every idle picker (wander, novelty/inspect/POI, lounge/prop, rounds, gaze, revisit,
  mourn, quirk movement) AND for `crewWander`.
- A2. An agent's **zone** = the room containing its assigned bay/workstation; if it sits on open floor
  with no enclosing room, a bounded **leash radius** around its workstation; if it is unassigned/
  unplaced, it has **no zone and does not roam** (stays dormant at spawn).
- A3. **Solo / single-agent stations are NOT regressed**: when one agent effectively owns the space,
  its zone is large and its existing rich behavior is unchanged. (Same rule, derived from the user's
  own layout — no "mode switch.")

**Tier B — PER-AGENT LIFE (stretch; attempted only after Tier A is green + verified):**
- B1. Every placed, non-working crew body runs the **reusable core** of the sentience engine
  (needs + temperament + the want-engine `decideIdle` + `maybeQuirk`) within its zone — so a floor of
  agents reads as many distinct living minds, not strollers.
- B2. Genuinely hero/singleton-coupled beats (FIRST LIGHT awakening ritual, camera-coupled focus
  beats) MAY remain hero-only; if so, that is documented, not silently dropped.

**Both tiers, always (hard INVARIANTS — breaking any one = not done):**
- I1. **Summon always wins.** A task (`activity==='task'`) seizes the body above every idle/zone
  branch, exactly as today. No zone guard may ever delay or block a summon.
- I2. **Hero parity.** With one agent, hero behavior is observationally identical to pre-change
  (the 8 sentience passes still work). Zone-caging only narrows target *selection*, never removes a
  beat for the solo hero whose zone is the whole station.
- I3. **Determinism preserved.** Only `U.irnd/U.chance/U.pick` (no `Math.random`/`Date.now`/
  `new Date`). `test/lint-determinism.js` stays green.
- I4. **No shared-contract edits.** Zero changes to `shared/events.js` or `shared/schema.js`. Zones
  are *derived*, never persisted, so the owned contract is untouched.
- I5. **Tight blast radius.** The only files this lane may change: `frontend/app/world.js`, a NEW pure
  module `frontend/app/zones.js`, its test `test/zones.test.js`, this plan doc, and **exactly ONE
  additive `<script src="app/zones.js">` line** in the loader (`frontend/index.html`, placed right
  before `world.js`, mirroring how `xp.js`/`ctxgauge.js` are loaded). `index.html` is a hotspot —
  the change is a single additive line, flagged for the orchestrator to sequence at merge. Commit
  ONLY these via pathspec — never `git add -A`. Touch no other lane's files.
- I6. **Green + verified before "done".** Full `npm run test:fast` exit 0, new `zones` unit tests
  pass, and an adversarial review round returns ZERO confirmed defects.
  - **I5↔I6 resolution (the `package.json` hotspot — decided, like the `index.html` line).** The
    `test:fast` script is a hardcoded `node test/<name>.test.js` chain with **no auto-discovery**, and
    `package.json` is deliberately **outside** I5's blast radius — so this lane does NOT edit it.
    Therefore `test/zones.test.js` is gated by a **separate explicit invocation** that the loop's
    gate command MUST run alongside `npm run test:fast`, namely:
    `node --check frontend/app/world.js && (node --check frontend/app/zones.js) && node test/zones.test.js && npm run test:fast`.
    Running `node test/zones.test.js` here is what makes I6 ("new zones unit tests pass AS PART OF
    green") true today without touching `package.json`. **Orchestrator handoff:** at integration the
    orchestrator should fold the new test into the standing suite by appending the single additive
    line `&& node test/zones.test.js` to the `test:fast` chain in `package.json` (right after
    `node test/ctxgauge.test.js`, mirroring `xp`/`ctxgauge`), flagged exactly like the `index.html`
    additive line — until then the explicit invocation above keeps the test load-bearing in the gate.

## ARCHITECTURE (decided; scope-lock confirms exact anchors against the live file)

- **Zone primitive = a new PURE module `frontend/app/zones.js`** (UMD, mirrors `xp.js`/`ctxgauge.js`).
  Pure functions over already-available data — no DOM, no globals:
  - `computeZone({ rects, props, agentId, anchorTile, leashR })` → `{kind:'room', rect}` |
    `{kind:'leash', cx, cy, r}` | `null`.
  - `inZone(zone, tx, ty)` → bool; `zoneClampPickable(zone, candidates)` helper.
  world.js calls these with the room rects + props it already holds; all geometry math lives in the
  pure module so it is unit-tested headlessly (`test/zones.test.js`).
- **Engine generalization = the "current actor" pointer pattern** (lower-diff, lower-risk than
  threading a `self` param through dozens of signatures). Introduce a module-level `self` that the
  tick loop points at the hero by default and **temporarily repoints to each crew body** before
  running the extracted core, then restores. Rename `agent.` → `self.` **only inside the reusable
  engine functions** (`tickNeeds`, `decideIdle`, `maybeQuirk`, the `plan*`/`quirk*` target pickers,
  `wander`, `arrive`). Leave genuinely hero-identity refs (exports, camera focus, FIRST LIGHT) on
  `agent`. A missed rename = crew mutating hero state → this is the #1 regression risk and the primary
  thing the adversarial pass hunts.
- **Crew body state init**: when a crew body is placed, initialize the full state shape the engine
  reads (`pers = makePersonality(id)`, needs `{rest,stim,social}`, cooldown fields, `fond` map, phase
  offset) — mirroring the hero's init. Scope-lock locates the hero init to copy it faithfully.

## PHASES (strictly sequential — ONE writer on world.js at a time; verify gate after each)

- **P0 — Zone primitive (zero behavior change).** Build `zones.js` + `test/zones.test.js`
  (room-anchored, leash-fallback, unassigned→null, solo→large zone). Wire the script tag. Gate:
  `node --check`, new tests pass, `test:fast` still green. SAFE, isolated, builds confidence first.
- **P1 — Cage the HERO idle pickers** through `inZone`. Every idle target picker filters candidates to
  the hero's zone; a picker with no in-zone candidate falls through to in-place beats (stand-still /
  look-around / fidget). Solo hero zone = whole station ⇒ no regression. Gate + adversarial verify.
- **P2 — Cage `crewWander`** to the crew body's zone (same primitive). **After P2, Tier A is
  delivered** — the user-visible lane-discipline pain is solved for hero and crew. Gate + verify.
- **P3 — Generalize the reusable engine core to crew** via the `self` pointer + crew state init, so
  crew have needs/temperament/quirks in-zone (Tier B). Highest risk → last, heaviest verification. If
  P3 cannot land cleanly within standard, the lane STILL ships A (P0–P2) green+verified and P3 is
  handed off as a cleanly-scoped follow-up rather than a half-broken god-file refactor.

## THE LOOP (the continuous goal system)

```
for each phase P in [P0, P1, P2, P3]:
    implement(P)                       # one sequential writer in the worktree, pathspec commit
    repeat:
        defects = adversarial_verify(P)    # N parallel skeptics hunt regressions + invariant breaks
        gate    = run(node --check; npm run test:fast)
        if defects.confirmed == 0 and gate.green: break   # phase meets standard
        fix(defects, gate)                                 # sequential fix, re-commit
    # loop-until-dry: require the phase to pass TWO consecutive clean verify rounds before advancing
stop when: Tier A green+verified AND (Tier B green+verified OR Tier B cleanly deferred with a note)
final: write a readiness report; DO NOT merge to trunk; hand to orchestrator.
```

## ANTI-OVERLAP PROTOCOL (respecting other sessions)
- All edits happen in this worktree/branch only; trunk and every other worktree are never touched.
- `git worktree list` shows `agent/workforce-zones` — that is the claim; no other session should start
  eerie/idle while this lane is live.
- Before handoff: `sync-agent-tree workforce-zones` (rebase onto current trunk) so any conflict
  surfaces HERE, not on the shared trunk. Re-run the gate after the rebase.
- Never edit `shared/events.js`/`shared/schema.js`; never `git add -A`; never merge to trunk.
