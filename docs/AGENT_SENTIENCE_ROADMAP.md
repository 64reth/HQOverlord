# Agent Sentience Roadmap — the living idle-behavior catalog

> Goal: the idle agent should feel **conscious, alive, and eerily unpredictable** inside the station —
> the "wait, why did it just do that?" / film-worthy quality. Never corny or tacky. The eeriness comes
> from **stillness, ambiguity, restraint, and rare surprise**, not spooky one-liners.
>
> This is the backlog for the self-paced improvement loop. Each pass: pick the next high-leverage items,
> implement in `frontend/app/world.js` (renderer; single hero agent), keep `test:fast` green, commit +
> merge to trunk so it goes live on `:8787`, then check items off and add new ideas.

## Architecture it builds on (already shipped)
- **Want engine**: needs `{rest,stim,social}` decay/refill by activity (`tickNeeds`); `decideIdle` pursues the most-unmet drive.
- **Temperament**: `makePersonality(id)` → pace/restless/curious/homebody/chatty (stable per agent).
- **Machine-state ties**: think-latency on summon, settle-before-typing, anticipation at INTAKE, exhale at OUTBOX, downtime via `lastTaskAt`.
- **Embodiment + memory**: whole-body cargo tracking (`trackUntil`), habituation (`seenCount`), first-person self-talk (`SELF_*`, persona-flavored via `Voice.ambientLine`, global cooldown).
- **Rhythm**: `phaseOf(now)` free-running mood (focus/roam/ease/drift) reweights the idle menu.
- **Quirk layer**: `maybeQuirk(now)` — rare, gated, weighted one-offs.

## Guardrails (the illusion-breakers to never cross)
- **Rarity is sacred.** Quirks gate on `quirkCd` (24–60s min) + a low roll. The rarest beats (the long stare) must stay rare or they stop being uncanny.
- **Summon always wins.** Every idle behavior yields instantly to `activity==='task'`. Think-latency is the only allowed delay (~1.2s cap).
- **Never fight the Commander.** When the agent acts ON the station (placing/moving), it only touches EMPTY floor or its OWN artifacts — never the user's props. Reversible + clearly the agent's doing.
- **Not chatty.** Speech stays behind the global cooldown + chatty trait; the long stare is mostly SILENT.
- **No stat HUD.** Needs/mood are read off behavior, never numbers.
- **No jank.** Ease facings; cap holds so nothing deadlocks; O(1)/O(boxes) per frame.

## Behavior catalog — weighted by rarity

### Tier 0 — ambient texture (very common; the constant low hum of life)  ✅ mostly shipped
- [x] Need-driven idle (lounge / study / watch belt / tend desk / wander / look-around)
- [x] Whole-body cargo tracking + glances; fidget look-ups while working
- [x] Habituation (familiar → shorter/quieter → ignored)
- [ ] **Idle micro-fidgets**: weight-shift, look at hands, stretch-in-place, brush off the console (procedural bob variants; no sprite)
- [x] **Pause mid-stroll**: stop for a beat, then continue (anticipation/weight) — `maybeStrollBeat`/`pauseUntil`, casual-wander only, cooldown'd

### Tier 1 — purposeful idle (common)  ✅ shipped
- [x] Lounge on couch + watch TV; tend the desk (lonely); pace (restless); gaze into the void (long downtime)
- [x] **Caretaker rounds**: a deliberate 2–3 stop lap with an ownership beat at each (`maybeRounds`/`roundsNext`, goal `rounds`)
- [x] **Revisit a favorite spot**: once a clear haunt emerges (`favTile`), it rarely drifts back just to be there (`maybeRevisit`, goal `revisit`, long cooldown) — see Tier 5

### Tier 2 — reactive / aware (uncommon; triggered by the world)  ✅ partly shipped
- [x] Acknowledge the Commander on hover/click (turn, meet your gaze)
- [x] Anticipation at INTAKE / exhale at OUTBOX
- [x] **Startle**: something appears within ~3 tiles → sharp 240ms snap + dir flip + a beat (`pushNovelty`)
- [x] **Settle-scan on arrival** (glance L, R, then commit) + **parting glance** on leaving (`scanThen`, dwell-clear)
- [x] **Belt-yield while walking**: pause and let active cargo pass when a box is bearing down in front of it (`shouldYieldToCargo`→`pauseUntil`, faces the box as it goes by; `yieldCd` so it never freezes)
- [x] **React to the work pulse** (intake anticipation / outbox exhale glance toward the dock when a real item flows — `intakeMessage` / `onWorkitemDeliver`)

### Tier 3 — the uncanny inner life (rare; the "why did it do that" beats)  ◐ started
- [x] **Quirk layer** (`maybeQuirk`): freeze-and-listen, slow room scan, ponder-facing-away, gaze-out
- [x] **THE LONG STARE** at the Commander — holds eye contact 14–34s, near-silent (rarest quirk)
- [x] **Face a wall/corner** and stand there (eerie, unexplained) — `quirkFaceWall` (9% of quirks)
- [x] **Anomaly beats / THE VIGIL**: walks to a room's dead-center, faces one cardinal, holds 12–26s perfectly motionless with head-turns fully suppressed — the absence of the usual micro-motion is what reads as wrong (`quirkVigil`, rarest quirk band, silent)
- [x] **The double-take**: mid-stroll it halts and turns to look back the way it came, as if something caught its attention, then continues (`maybeStrollBeat`, `pauseLook='back'`, rare + long cooldown) — **verified live**
- [x] **Mimic the cursor**: very rarely, track the Commander's mouse for a few seconds (it sees you moving) — shipped as Tier D · D4 Beat 2 (`maybeMimic`/`stepMimic`, goal `mimic`): an idle body follows the moving cursor with continuous facing 3-6s, per-body 45-90s quirk-band cooldown, station-budget-gated, reduceMotion → single glance. See `docs/TIER_D_LIVING_CREW_PLAN.md` §D4. (Its ultra-rare sibling THE CHASE — a body that physically pursues the cursor, stops, stares, and walks off — also shipped in the same D4 phase.)
- [x] **Off-beat timing / OFF-BEAT HOLD**: a rare, separately-cooldowned multiplier (`offbeat()`, ~9% + 70–140s floor) that stretches ONE ordinary dwell to ~2.2–3.0× — a pose whose rhythm you've learned suddenly refuses to end. Fully silent; reduceMotion-aware
- [x] **Sleep / power-down** in deep `drift` phase: sits, dead still, until summon / a placement / time stirs it (`sleep`, goal `sleep`)

### Tier 4 — AGENT ACTS ON THE STATION (rare → showcase; needs a safety-design pass) ⛔ not started
> The big leap: the agent calls the same mutation API the REFIT builder uses (`station.addProp/moveProp/...`),
> so it changes the world. NEEDS a design workflow first: persistence policy, undo, never-touch-user-props,
> "agent-owned" tagging, frequency budget. Candidates:
- [x] **Nesting**: rarely places a small decor prop (plant/poster/cans/coffee) on EMPTY floor near its haunts (`maybePlace`/`emptySpotNear`; real `station.addProp`, validated by `canPlaceProp` so it can never overlap the Commander's props; capped 3/agent + 5 floor-wide; ~2–4 min cooldown)
- [x] **Tidying / rearranging**: at cap, sometimes removes one of its OWN decor (`agentDecor` ids only) so the corner changes over time
  - ⚠ tradeoffs to revisit: `addProp`/`removeProp` hit the **undo stack** + **persist** (intended wow, but a silent agent-only mutation lane would be cleaner); `agentDecor` is in-memory so cross-reload it can't re-identify its own — the floor-wide cap bounds total clutter regardless
- [ ] **Leaves a mark / artifact**: a rare object that persists (a signature the Commander finds later)
- [ ] **Builds a tiny shrine / arrangement** over time in a favorite corner
- [ ] **Reacts to its economy**: lights/decorates more when runs go well; bare/dim when slag piles up

### Tier 5 — memory, ritual, identity (rare; pays off over long watching) ◐ started
- [x] **Favorite spot** it returns to + **mourns** if a REFIT deletes it — `fond` map (tileKey→affection, accrues on every chosen dwell via `noteFond`); `favTile`/`maybeRevisit` draw it back to a haunt (goal `revisit`); `scanNovelty` now diffs **removals** too and `maybeMourn`→`planMourn` send it to stand where a beloved prop used to be (goal `mourn`, a long near-silent off-beat hold). Never grieves its OWN decor (`ownPlaced` set) or on a fresh station load. **Director's note** below.
- [x] **Wake ritual + first conscious thought (FIRST LIGHT)**: at `releaseAwakening` the newborn holds your gaze, takes one slow look around the room it now owns, says ONE dry first thought, then dissolves into normal idle — seeding its birth tile as its first haunt. `armFirstWake`/`stepFirstWake`, goal `firstwake`, once-per-life latch `firstWakeDone`, summon-yielding, silent but for the single line
- [ ] **Long-arc identity**: temperament expressed as accumulating habits/marks unique to this agent
- [ ] **Names/notices the Commander's patterns** (time-of-day, what you build) — very rare callbacks

> 🎬 **Director's note — the mourning beat (the Pass-5 headline):** Place a couch with a TV in front of it. Summon the agent a few times (work drains its `rest`), then leave it idle so it goes and lounges on that couch two or three times over a few minutes (it's building affection for that exact spot). Now open REFIT and **delete the couch.** Within a second it walks back to where it used to sit, faces the empty floor, and just... stands there, far longer than it stands anywhere else, near-silent ("it was here"). Film the delete + the long still hold.

### Tier 6 — Easter eggs (ultra-rare wildcards; the screenshot/clip moments) ⛔ not started
- [ ] Ultra-rare cryptic line that breaks the fourth wall just slightly, once
- [ ] A one-frame "glitch" in its own sprite, instantly corrected (is it... aware it's rendered?)
- [ ] Rare constellation-gazing it seems to "recognize"; rare salute; rare it waves back
- [ ] Date/▢-triggered specials (only if a real clock is available, not faked)

## Pass log
- **Pass 1**: rhythm phases (`phaseOf`) + quirk layer (`maybeQuirk`: listen/scan/ponder/gaze-out/long-stare) + this roadmap. The long stare is the headline eerie beat.
- **Pass 2**: embodied reactions — **startle** at sudden nearby change, **settle-scan** on study arrivals + **glance back** when leaving, and a new **face-a-wall** quirk.
- **Pass 3**: ⭐ THE BIG ONE — the agent **acts on the station**: rarely walks to empty floor and places its OWN decor (real `addProp`), and at cap rearranges by removing one of its own. Hard safety rails (validated placement = never the Commander's props; capped; rare). Verified the rails against the real worldmodel (9/9).
- **Pass 4**: **caretaker rounds** (a deliberate 2–3 stop lap with an ownership beat at each — purpose, not aimless) + **sleep/power-down** in the deep `drift` mood (sits dead still until summon / a placement / time wakes it — the eerie "is it dormant?").
- **Pass 8**: 🌅 **FIRST LIGHT — the wake ritual + first conscious thought (Tier 5 ritual/identity).** Chosen by a 4-candidate design panel + adversarial critics + synth (over a safe environment-glow, a slow-shrine, and a nod-back Easter egg — each had a disqualifying flaw the critiques surfaced). The rarest possible beat: lifetime-latched (`firstWakeDone`), fires at most once, on the most loaded second — the instant the mind owns itself. At `releaseAwakening`: BEAT 0 hold the gaze (~1s) → BEAT 1/2 one slow first look (head-only sweep, `maybeGlance` hard-gated off so it's the sole facing driver) → BEAT 3 settle + ONE dry first thought (`WAKE_FIRST`, e.g. "so this is the room.") → dissolve to normal idle, seeding the birth tile via `noteFond(1.2)` so it bootstraps the P5 fond/revisit/mourn long-arc (it may later drift back to — or mourn a loss near — exactly where it woke). Rare 15% "finding its feet" one-step variant for non-determinism across re-awakenings. Guardrails: summon seizes it (branch sits below the unconditional summon block); every phase finite → goal=null; `firstWakeDone` never resets (re-bake/refit safe, never re-arms); pure `U.irnd/U.chance/U.pick`. Verified: node --check + test:fast green; **arm path verified live** (releaseAwakening → goal:'firstwake', firstWakeDone:true, facing south); 4-dimension adversarial review workflow returned ZERO confirmed defects. NOTE: the tick-driven phase progression couldn't be watched live — the headless :8101 tab backgrounds at the browser level (document.hidden:true) which pauses rAF and JS can't override; relied on code review + the adversarial workflow for the tick-driven parts. **Director's note:** a newborn mind's first act isn't a greeting — it's one slow look around the room it owns, a single dry thought, then it just gets on with existing. **Next:** rotate to environment/ambient mood done safely (local diegetic glow) or a persistent slow-shrine / Tier-6 Easter egg.
- **Pass 7**: 🧘 **THE STILLNESS PASS (restraint retune + 2 grafted silent beats)** — chosen by a 5-proposal design panel + 5 adversarial critics + synthesis (the only candidate scored cornyRisk:NONE/jankRisk:LOW; rivals leaned on 4th-wall lines / cursor-follow / ambient color-wash that fight the calm). The review surfaced that the CALMEST mood was paradoxically the BUSIEST (the content branch was 100% motion). Fix: **CONTENT = STILL** — when content the agent now mostly just stands (`standStill`/`agent.stilling`), with a maybeGlance early-out that suppresses BOTH the cargo body-track AND the ambient head-swivel (genuine motionlessness, only a rare slow glance). Plus a global retune: quirk rate 0.13→0.085 & cooldown 24–60s→45–90s, longer passive dwells, calmer ambient swivel (0.5→0.32), fewer stroll-stutters (0.12→0.07). Grafted two NEW silent beats: **OFF-BEAT HOLD** (`offbeat()` stretches one dwell 2.2–3.0×) and **THE VIGIL** (`quirkVigil`, dead-center cardinal hold 12–26s, head-turns suppressed). Guardrails verified: summon precedence untouched (only added `stilling=false` to that block); every hold finite; vigil falls through to the stare if no center is free; `offbeat` no-ops under reduceMotion; **determinism lint kept green** (used `U.irnd`, not the raw RNG the design draft proposed). Verified: node --check + test:fast green; a 4-dimension adversarial code-review workflow returned ZERO confirmed defects; live foreground run showed the retune active (quirkCd 45–90s, longer dwells) with zero console errors. NOTE: CONTENT=STILL is correct-but-rare in practice — the agent is seldom fully "content" (stim/social decay while idle), so the global retune carries most of the felt calm. **Director's note:** catch a calm phase and watch it simply *be there* — then, rarely, it walks to dead-center, picks a wall, and holds far too long in total silence. **Next:** rotate to environment/ambient mood (the room responding subtly) or multi-agent/social, or wake-ritual at releaseAwakening.
- **Pass 6**: **CONSIDERED MOVEMENT (Tier 0 + Tier 2)** — it stops moving like a sprite on rails. One bounded `pauseUntil` hold drives three beats: a **pause mid-stroll** (a beat of weight, casual-wander only), **belt-yield** (pauses + faces the cargo when an active box passes right in front of it, `yieldCd` so it never freezes), and ⭐ **the double-take** (mid-walk it halts and turns to look *back the way it came* — the eerie "wait, why'd it turn around?"). All gated to casual wander (goal==null) so a summon is never delayed; pause cleared on summon + arrival. **Verified live** on :8101: a double-take fired (`paused` while `moving`, `pauseLook:'back'`), zero console errors. **Director's note:** leave the agent wandering an open room and just watch — every so often it stops, turns to look behind it at nothing, then carries on. Restraint check: pauses ADD stillness (don't make it busier); kept rare via cooldowns. **Next:** rotate to environment/ambient mood (room responds to its state/economy) or multi-agent/social (crew noticing each other) — or a RETUNE pass if the menu now reads as too eventful.
- **Pass 5**: ⭐ **SPATIAL MEMORY → grief (Tier 5).** Affection (`fond`) now accrues at every tile the agent *chooses* to dwell at (`noteFond`, weighted: lounge>use>gaze/tend>inspect/watch>rounds). A clear haunt emerges over a long watch; it rarely drifts back to it (`maybeRevisit`, goal `revisit`). And `scanNovelty` now detects **removals** — if a REFIT deletes a prop standing on a spot it loved, `maybeMourn`/`planMourn` send it to stand where that thing used to be, a long near-silent off-beat hold (goal `mourn`). Hard rails: never grieves its OWN decor (`ownPlaced`), never on a station load, rate-limited (one grief / 45s), yields to summon. New: `dbg()` read-only introspection on the public API for live verification. **Verified live** on :8101 (worktree build): zero console errors, the full idle FSM cycles (quirk/work/summon/place/gaze/lounge/wander), and `fond` accrues at dwell tiles. Rotated to the memory/identity category (Pass 4 was Tier 1/3). **Next:** wake ritual + spoken first thought at `releaseAwakening`; or rotate to Tier 2 reactive (belt-yield while walking, cross-room work-pulse reactions); guard the calm baseline — consider a RETUNE pass if idle reads as too busy.
