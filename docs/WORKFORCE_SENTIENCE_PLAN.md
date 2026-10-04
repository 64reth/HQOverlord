# Tier B — Per-Agent Sentience (crew get the hero's inner life) — goal/loop contract

> Lane: `agent/crew-sentience` (worktree `C:\Users\<you>\gen-trees\crew-sentience`), forked from
> trunk `feat/harness-backend` @ 43feb43. Continues **WORLD-GAME's "eerie/idle" charter**. Builds
> directly on **Tier A (zone containment), already merged to trunk** (`aec480f`) — the cage exists; this
> tier makes the caged bodies actually *alive*. See `docs/WORKFORCE_ZONES_PLAN.md` (Tier A).
> **This lane does NOT merge to trunk** — it stops at "green + adversarially verified + ready" and
> hands to the orchestrator (the only merger). Cross-agent *awareness* is explicitly **Tier C, not
> here** — Tier B makes N minds that are alive and collision-safe; they still ignore each other.

## Why (confirmed against current trunk world.js)

The sentience engine is HERO-ONLY. `tick()` runs `tickNeeds` (line ~1581) + the idle ladder +
`decideIdle()` (~1666) → `maybeQuirk()` (~1441) for the single module-level `agent`. Crew bodies get
only `stepCrew()` → `crewWander()` (~862): caged-random-wander + dwell. No needs, no temperament, no
want-engine, no quirks. After Tier A they stay in their lane — but they are strollers, not minds.

## THE GOAL (definition of done — the standard the loop runs until it meets)

**Functional:**
- G1. Every PLACED, non-working crew body runs the **reusable core** of the sentience engine **within
  its zone**: needs (`rest/stim/social` drift), temperament (`makePersonality`), the want-engine
  (`decideIdle` picking goals by most-unmet drive), and quirks (`maybeQuirk`). Crew exhibit
  needs-driven + purposeful idle + rare quirks — not just wander.
- G2. Genuinely hero/singleton-coupled beats stay hero-only, **documented not silently dropped**:
  FIRST LIGHT awakening ritual, camera-coupled focus beats.
- G3. **N agents read as DISTINCT minds** — per-body temperament + phase offsets so a floor is not a
  synchronized swarm; eerie restraint preserved at scale (quirk rarity holds floor-wide).

**Hard INVARIANTS (breaking any one = NOT done):**
- J1. **HERO PARITY (the primary gate).** With one agent, hero behavior is observationally identical
  to pre-Tier-B. The `self` actor pointer DEFAULTS to the hero; the hero's engine run has
  `self === agent` throughout, so every read/write is byte-equivalent. The 8 sentience passes still
  work for the solo hero.
- J2. **NO CROSS-BODY STATE CORRUPTION (the headline risk).** No crew body ever reads or mutates
  another body's — or the hero's — state. **Zero leftover `agent.` references inside the generalized
  engine core**, AND zero over-eager renames (a hero-identity ref wrongly changed to `self.`). The
  verify-loop hunts BOTH directions explicitly.
- J3. **CONTAINMENT PRESERVED (Tier A still holds, now per-body).** Crew now run the same idle pickers
  the hero does; those pickers were caged to the *hero's* zone in Tier A — they must now cage to **each
  body's own zone** via the `self` body. No body ever targets a tile/prop outside its own zone.
- J4. **Summon always wins.** A task seizes any body above its idle/engine branches; the crew
  working-path (walk-to-seat) and summon precedence are unchanged.
- J5. **Determinism.** Only `U.irnd/U.chance/U.pick` (no `Math.random/Date.now/new Date`).
  `test/lint-determinism.js` green.
- J6. **No shared-contract edits + no new persistence.** Zero changes to `shared/events.js` /
  `shared/schema.js`. Crew sentience state (needs/fond/cooldowns) is **runtime-only**, like the hero's
  live idle state — it is NOT added to the save schema (resets on reload, which is correct and avoids
  the owned contract). If persistence is ever wanted, that is a separate request to the contract owner.
- J7. **Tight blast radius.** Primarily `frontend/app/world.js`; plus this plan doc. NO new modules are
  required (the engine already exists — we generalize it in place). Commit ONLY named files via
  pathspec — never `git add -A`. Never merge/push/rebase against trunk or another worktree.
- J8. **Green + adversarially verified before "done".** Full `npm run test:fast` exit 0 (incl. the
  determinism lint), and an adversarial review round returns ZERO confirmed defects, with explicit
  hunts for: leftover/over-eager `agent.`↔`self.` renames (J2), hero non-parity (J1), per-body
  containment leaks (J3), and N-body state collisions.

## VERIFICATION NOTE (honest about the limits)
There is no automated behavioral test for the canvas idle FSM, and the headless dev tab backgrounds
(rAF pauses, per the sentience roadmap), so tick-driven beats can't be reliably watched live. Hero
parity (J1) and the rename audit (J2) are therefore proven by **rigorous code-review reasoning + the
structural guarantee that `self` defaults to `agent`** (so the solo-hero path is unchanged by
construction), backed by `node --check` + full `test:fast` + the determinism lint. The verify-loop's
job is to make that reasoning airtight, not to wave at it.

## ARCHITECTURE (decided; scope-lock confirms exact anchors against the live file)

- **The "current actor" pointer.** Introduce a module-level `self`, defaulting to the hero `agent`.
  The tick loop points `self` at the hero for the hero's run, and **temporarily repoints `self` to each
  crew body** before running the extracted core, then restores `self = agent`. The restore is
  mandatory every iteration (a synchronous, single-threaded tick, so there is no re-entrancy if every
  per-body run restores before the next).
- **Scoped rename.** Rename `agent.` → `self.` **only inside the reusable engine functions**
  (`tickNeeds`, `decideIdle`, `maybeQuirk`, the `plan*` / `quirk*` target pickers, `wander`, `arrive`,
  and helpers they call that act on the current body). **Leave on `agent`** every genuine hero-identity
  reference: the module export, camera/focus, FIRST LIGHT (`firstwake`), and anything keyed to "the one
  the Commander is looking at." A missed rename (crew mutate hero) and an over-eager rename (hero beat
  driven by a crew body) are the two failure modes — both are hunted.
- **Crew body state init.** When a crew body is placed/spawned, initialize the full state shape the
  engine reads — `pers = makePersonality(id)`, `needs {rest,stim,social}`, the cooldown fields
  (`quirkCd`, `glanceCd`, `revisitCd`, `mournCd`, etc.), the `fond` map, a phase offset, and the
  goal/idle bookkeeping fields — mirroring the hero init (~line 358 / `makePersonality` ~373). Without
  this, a crew body running the engine reads `undefined` meters and behaves randomly.
- **Zone reuse.** Per-body containment reuses the Tier A `zoneFor(body)` / `Zones.*` already on trunk —
  the pickers already accept the current body; routing them through `self` makes the cage per-body.

## PHASES (strictly sequential — ONE writer on world.js; verify-loop after each)

- **B0 — Crew body state init (additive, lowest risk).** Give each placed crew body the full engine
  state shape (above). Do NOT call the engine yet — crew still run `crewWander`. ZERO behavior change.
  Gate + verify: hero parity (nothing changed for hero), no schema/persistence touched, green.
- **B1 — The `self` pointer + scoped rename (riskiest mechanical edit, ZERO behavior change).**
  Introduce `self` (defaults to `agent`); rename `agent.`→`self.` only inside the engine core; the hero
  tick runs with `self === agent`. Crew still don't call the engine. Because `self===agent` for the
  hero, behavior is unchanged — this phase is verified ENTIRELY on parity + the rename audit. **This is
  the most important verify-loop in the tier.**
- **B2 — Wire crew through the core.** In `stepCrew`, for each non-working placed crew body: set
  `self = b`, run the per-body engine tick (needs + `decideIdle` + the goal/movement handlers, caged to
  b's zone), restore `self = agent`. Crew now have the full inner life. `crewWander` becomes the wander
  fallback inside `decideIdle`. Gate + verify: per-body containment (J3), no cross-body corruption (J2),
  summon-wins per body (J4), crew seat/movement intact, green.
- **B3 — Distinctness + restraint tuning.** Phase offsets + per-temperament rhythm so N agents don't
  act in lockstep; a floor-wide quirk-rarity check so 8 agents don't all stare at once (eerie restraint
  at scale). Gate + verify: distinctness reasoning, restraint preserved, green.

## THE LOOP (the continuous goal system)

```
for each phase B in [B0, B1, B2, B3]:
    implement(B)                       # one sequential writer in the worktree, pathspec commit
    repeat:
        defects = adversarial_verify(B)    # N parallel skeptics, lenses tuned to THIS phase's risks
        gate    = run(node --check; npm run test:fast)
        if defects.confirmed == 0 and gate.green: cleanStreak++ else cleanStreak = 0; fix(...)
    until cleanStreak == 2              # two consecutive clean rounds before advancing
stop when: all phases meet standard (G1-G3 satisfied, J1-J8 hold)
final: readiness report; DO NOT merge to trunk; hand to orchestrator.
```

## ANTI-OVERLAP PROTOCOL
- All edits in this worktree/branch only; trunk + every other worktree untouched. The lane in
  `git worktree list` is the claim — no other session should start eerie/idle while this is live.
- Before handoff: `sync-agent-tree crew-sentience` (rebase onto current trunk — trunk advances often;
  expect to replay over newer commits), then re-run the gate, then orchestrator merge.
- Never edit `shared/events.js`/`shared/schema.js`; never `git add -A`; never self-merge.
