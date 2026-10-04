# Tier C v1 — Cross-Agent Awareness (gaze-only foundation) — goal/loop contract

> Lane: `agent/crew-awareness` (worktree `C:\Users\<you>\gen-trees\crew-awareness`), forked from
> trunk `feat/harness-backend` @ b452465 (which has the COMPLETE Tier B). Continues WORLD-GAME's
> "eerie/idle" charter. Builds on Tier A (zone containment) + Tier B (per-agent sentience via the
> `self` actor-pointer). **Deliberately a SMALL foundation** — Andrew's directive: build a basic
> awareness layer and add over time, because this exact logic is where bugs are bred. **The build does
> NOT self-merge** — it stops at "green + adversarially verified + ready"; merge is a separate explicit
> decision.

## The inviolable rule (the whole reason this is safe)
**Perceive across zones, ACT only within your own. GAZE / head-turn ONLY — no body ever takes a step
toward another.** Awareness reuses the EXISTING head-turn machinery (`setGlance`/`maybeGlance`), which
turns a body's head/facing WITHOUT moving it. Tier C adds only (a) a way to find a nearby body and
(b) two triggers that point an existing glance at it. No new movement, no pathfinding, no goals. The
moment an awareness behavior moves a body, containment (Tier A) is broken — that is the #1 thing the
verify-loop hunts.

## THE GOAL (definition of done — the standard the loop runs until it meets)

**Functional (two beats, both gaze-only):**
- C-Beat1 — **Summon glance.** When any body is summoned to a task, each OTHER body that is currently
  **idle** and within sight has a **50% chance** (`U.chance(0.5)`) to turn its head toward the summoned
  body for a brief beat, then resume. Rolled once per summon event (a short refractory prevents
  re-trigger every frame). Hero and crew both observe and both can be the subject.
- C-Beat2 — **Mutual idle glance.** When two bodies are **both idle** and near each other (small tile
  radius + sightline), occasionally (rarity-gated, **per-pair cooldown**) they turn to look at each
  other for a held beat, then break. Quiet, silent, "they noticed each other."

**Hard INVARIANTS (breaking any = NOT done):**
- K1. **GAZE-ONLY / NO MIGRATION (containment preserved).** No awareness behavior ever sets a path,
  target, or movement goal. It only calls the head-turn glance. Bodies never leave their zone for
  awareness. (Tier A still holds.)
- K2. **NO CROSS-BODY CORRUPTION + no regression.** An awareness behavior READS a neighbor's position
  only (px/py/tile) and mutates ONLY the glancing body's own glance state — never another body's. The
  new glance is ADDITIVE for hero and crew alike (the hero now also glances at neighbors — intended);
  no EXISTING beat is regressed. The `self` actor-pointer discipline from Tier B is preserved.
- K3. **SUMMON ALWAYS WINS.** A glance yields instantly to a task. A body that is itself summoned drops
  any glance immediately; awareness never delays or blocks work. (The summon-seize block stays above.)
- K4. **NO DEADLOCK, NO CASCADE.** The mutual glance is a BRIEF, cooldown'd beat that always ENDS — no
  sustained mutual lock. A glance never triggers another glance: C-Beat1 fires off the summon EVENT,
  C-Beat2 off both-idle proximity with a per-pair cooldown — never off observing another body's glance.
  No feedback loop, no O(N^2) per-frame blowup (the proximity scan is bounded + gated to idle cadence,
  not run every frame).
- K5. **DETERMINISM.** Only `U.chance`/`U.irnd`/`U.pick`/`U.hash` (the 50% is `U.chance(0.5)`; cooldowns
  via `U.irnd`). No `Math.random`/`Date.now`/`new Date`. `test/lint-determinism.js` green.
- K6. **No shared-contract edits + no persistence.** Zero changes to `shared/events.js`/
  `shared/schema.js`. Awareness state (glance, cooldowns) is runtime-only.
- K7. **Tight blast radius.** `frontend/app/world.js` only (+ this plan doc). No new modules. Pathspec
  commits; never `git add -A`; the build never merges/pushes/rebases against trunk.
- K8. **Green + adversarially verified.** `npm run test:fast` exit 0 (incl. determinism lint) and an
  adversarial round returns ZERO confirmed defects, with explicit hunts for: mutual-stare deadlock,
  glance cascade/feedback, any containment leak (movement), the busy/cute regression (glancing too
  often kills the eerie), determinism, and no-cross-body-mutation.

## VERIFICATION NOTE (honest limit)
As with Tier B, there is no automated behavioral test for the canvas idle FSM and the headless tab
pauses rendering. Correctness is proven by code-review reasoning (the glance reuses a no-move head-turn;
triggers are event/cooldown-gated) + `node --check` + full `test:fast` + the determinism lint. The
verify-loop makes that reasoning airtight.

## ARCHITECTURE (decided; scope-lock confirms exact anchors against the live file)
- **Reuse the existing glance system.** Scope-lock pins `setGlance`/`maybeGlance` (what they set; confirm
  they ONLY change facing/glance, never position/target/goal) and `dirToward(px,py,tx,ty)` (to face a
  neighbor's tile). Awareness = pointing that existing glance at a neighbor.
- **Neighbor finder.** A bounded helper `neighborsOf(body, radius)` scanning the hero `agent` + `crew[]`
  for OTHER bodies within `radius` tiles and a basic sightline of `body` — READ-ONLY (reads their
  px/py/tile only). N is small (hero + crew); an O(N) scan gated to the idle cadence is fine.
- **C-Beat1 trigger:** hook the summon transition (where a body's `activity`/state becomes a task —
  scope-lock pins `setActivityFor` and the hero summon path). On that event, for each idle in-sight
  OTHER body, roll `U.chance(0.5)` → `glanceAt(thatBody, summonedBody)` for a brief beat, with a short
  per-body refractory so it fires once per event, not every frame.
- **C-Beat2 trigger:** in the per-body idle path, when `self` is idle and a neighbor body is idle within
  radius+sightline, rarity-gate (`U.chance`) behind a **per-pair / per-body `neighborGlanceCd`** cooldown;
  point both bodies' glance at each other for a held beat, then let the normal glance timeout end it.
- **No movement anywhere** — `glanceAt` calls only `setGlance` (facing), never `setPathTo`/goal/target.

## PHASES (strictly sequential — ONE writer on world.js; verify-loop after each)
- **C0 — Plumbing (additive, ZERO behavior change).** Add `neighborsOf(body,radius)` (read-only) and
  `glanceAt(self, otherBody, dur)` (calls only setGlance toward the other's tile). Wire NOTHING to a
  trigger yet. Gate + verify: no behavior change, no movement introduced, determinism, blast radius.
- **C1 — C-Beat1 (summon glance).** On summon, idle in-sight bodies 50% glance at the summoned one.
  Gate + verify: K3 summon-wins, K1 no movement, K4 no cascade (fires off the event only), determinism.
- **C2 — C-Beat2 (mutual idle glance).** Both-idle nearby pair occasionally lock gaze, per-pair
  cooldown, ends cleanly. Gate + verify: K4 deadlock/cascade hunt, K1 no movement, K2 no cross-body
  mutation (each body sets only its own glance).
- **C3 — Restraint + failure-mode hardening.** Tune rarity/cooldowns so it's occasional and eerie, not
  busy; final anti-deadlock / anti-cascade / busy-cute audit. Gate + verify.

## THE LOOP (the continuous goal system)
```
for each phase C in [C0, C1, C2, C3]:
    implement(C)                       # one sequential writer, pathspec commit
    repeat: defects = adversarial_verify(C); gate = run(node --check; npm run test:fast)
            if defects==0 and gate.green: cleanStreak++ else cleanStreak=0; fix(...)
    until cleanStreak == 2
stop when all phases meet standard (both beats live, K1-K8 hold)
final: readiness report; DO NOT merge; hand off.
```

## ANTI-OVERLAP PROTOCOL
- Edits in this worktree/branch only; trunk + other worktrees untouched. The lane in `git worktree list`
  is the claim. Before handoff: `sync-agent-tree crew-awareness` (rebase onto trunk), re-gate, then merge.
- Never edit `shared/events.js`/`shared/schema.js`; never `git add -A`; the build never self-merges.
