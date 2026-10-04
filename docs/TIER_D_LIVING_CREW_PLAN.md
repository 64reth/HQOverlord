# Tier D — LIVING CREW (the cherry-on-top liveliness pass)

> Continues the eerie/idle charter: Tier A containment → Tier B self-pointer → Tier C gaze-only
> awareness → **Tier D: the crew acts like it lives here.** Four beats, all deterministic canvas
> behavior. **ZERO LLM calls, ZERO tokens** — this lane is pure engagement/Thronglets-feel; every
> token stays reserved for real work. Andrew's directive (2026-07-02): chat-stare, richer
> agent↔agent interaction, less-aimless idle, cursor glance/chase.
>
> Extends `docs/AGENT_SENTIENCE_ROADMAP.md` (the hero idle catalog — D4 checks off its unchecked
> "Mimic the cursor" item) and `docs/CREW_AWARENESS_PLAN.md` (Tier C — D3 is its designed growth).
> Same build discipline as Tier C: worktree lane, one writer on world.js, adversarial verify per
> phase, build does NOT self-merge.

## The live substrate (recon 2026-07-02 — anchors verified against trunk)

The live page loads `frontend/app/world.js` (+ `app/zones.js`) — **NOT** `frontend/js/agents.js`
(that file + `js/data.js` rosters are the v7 legacy sim; do not build there, do not copy its
patterns). What Tier D builds on, all in `frontend/app/world.js`:

- **Bodies**: hero `agent` + `crew[]` (world.js:56-67). Crew already get `pers: makePersonality(aid)`
  + seeded needs (world.js:3197-3199) and run `decideIdle` (world.js:1847) — the want engine is
  ALREADY shared. Some beats are hero-only by gate (e.g. shouldYieldToCargo reads `agent.target`,
  world.js:~1032; deep-lock; most of the quirk catalog) — D2 audits exactly which.
- **Gaze primitives**: `setGlance` / `maybeGlance` / `dirToward` (Tier C's no-move head-turn) +
  Tier C's `neighborsOf(body, radius)` / `glanceAt` (world.js:1352, 1424).
- **Commander presence**: `lastCursor = {wx, wy, t}` cached on mousemove (world.js:120-126, 570);
  cursor gaze-drift (world.js:1459-1465, 32% when fresh); hover rising-edge notice (world.js:572);
  deep-lock budget (~1/session). D4 extends this — it does not add a second cursor tracker.
- **Work-wins law**: summon/task seizes any body instantly (`activity==='task'` block sits above all
  idle branches). Chat replies already drive `World.setActivity('task')` from `frontend/app/chat.js`
  (walk-to-desk-and-type). Every Tier D beat yields to it, no exceptions.
- **Zone containment**: `Z.computeZone` / `Z.inZone` / `Z.clampPickable` (app/zones.js:119-149,
  tested in test/zones.test.js). Any Tier D movement target passes the zone clamp.

## Guardrails (inherited + new; breaking any = NOT done)

- **G1. ZERO TOKENS.** No model calls, no new bus round-trips to the harness. Pure client-side
  behavior off state the frontend already has.
- **G2. Work always wins.** Every beat yields instantly to summon/task. A chat-stare drops the
  moment the agent starts a reply run (it goes to its desk to type — that existing beat is kept).
- **G3. Containment holds.** No body ever leaves its zone for a Tier D behavior. Movement targets
  are zone-clamped; adjacent-zone social resolves to the border, never a crossing.
- **G4. No deadlock / no cascade / no pileup.** Every beat is finite (hard `until`), per-pair and
  per-station cooldowns, at most ONE social encounter and ONE cursor-chase live per station. A beat
  never triggers another beat.
- **G5. Rarity budgeted PER STATION, not per body.** N crew × per-body rates = a busy cute mess.
  Quirk/encounter/chase rolls draw from station-level budgets so a 6-agent floor stays as calm as a
  1-agent floor. Restraint is the aesthetic (Pass-7 law: stillness > motion).
- **G6. Determinism lint green.** `U.chance`/`U.irnd`/`U.pick`/`U.hash` only; cursor position is a
  user INPUT (allowed), never sample `Math.random`/`Date.now`.
- **G7. Blast radius**: `frontend/app/world.js` + one tiny announce hook in `frontend/app/chat.js`
  (D1) + this doc. No shared-contract edits, no persistence, pathspec commits only.
- **G8. Green + adversarially verified per phase** (`npm run test:fast` incl. determinism lint;
  adversarial round returns zero confirmed defects before the next phase starts).

## The four beats

### D1 — ATTENTIVE AUDIENCE (chat-stare) — ship first, highest feel-per-line
When the Commander is chatting with agent X, X gives you its full attention.
- **Bridge**: `chat.js` announces `World.setChatFocus(agentId)` on open / `setChatFocus(null)` on
  close (one call each; world.js owns all behavior). No other chat.js changes.
- **Behavior**: while chatFocus is on an idle body: it stops (reuse `standStill`/stilling), turns,
  and HOLDS on the Commander — facing south, drifting with `lastCursor` like the existing gaze-drift
  so it tracks you around the screen. Wander/quirks/social suppressed for that body while held.
- **The loop with typing**: when the agent starts its reply run, `setActivity('task')` seizes it as
  today — it breaks the stare, walks to its desk, types. When the run ends and chat is still open,
  it returns to the stare. Watching-you-type ↔ working-the-answer is the whole "it's really in
  there with me" beat.
- **Gates**: working-at-desk wins (no stare while `activity==='task'`); if the body can't see the
  "camera" nothing special — the stare is facing + stillness, always safe.

### D2 — CREW PARITY AUDIT (kill aimless walking for the whole cast)
The hero has an inner life; the crew mostly wanders. Close the gap.
- **Audit first**: enumerate every hero-only gate in the idle stack (quirk layer `maybeQuirk`,
  rounds, revisit/fond, off-beat hold, vigil, stroll-beats, sleep, belt-yield). Produce the list in
  this doc before extending anything.
- **Extend the safe set to crew**: quirks (listen/scan/ponder/face-wall), stroll-beats/double-take,
  off-beat hold, sleep-in-drift, caretaker rounds. Each crew body's temperament already differs via
  `makePersonality(aid)` — same catalog, different weights = persistent individual habits (the
  pacer, the corner-starer, the one who sleeps). Persistence is what reads as personality.
- **Keep hero-exclusive**: THE LONG STARE, deep-lock, FIRST LIGHT, mourning (the intimate
  Commander-relationship beats stay special to the hero).
- **Retune under G5**: station-level quirk budget replaces per-body rates before this merges.

### D3 — SOCIAL ENCOUNTERS (Tier C grows legs — movement-based, still safe)
Tier C proved perceive-across-zones/act-in-your-own with gaze. D3 adds bounded movement beats,
same invariants, per-pair long cooldowns, ONE live encounter station-wide:
- **The huddle**: two idle same-zone bodies converge to adjacent tiles, face each other, hold a
  silent beat (with the existing habituation-style variance), break, drift apart. No speech — the
  silence IS the eerie.
- **Watching a peer work**: an idle body walks to stand a couple tiles behind a WORKING body in its
  zone, faces the worker's desk, holds, leaves. (The Overseer-checks-your-work feel, for free, for
  everyone.)
- **The border meeting**: adjacent-zone idle pair each walk to the nearest tile of their shared
  zone edge, face each other ACROSS the line, hold, break. Containment isn't hidden — it's staged.
  This is the clip beat.
- **The half-follow**: an idle body notices a walking body pass (Tier C notice), follows its path
  2-4 tiles, loses interest, stops. Never completes the follow — the incompleteness is the point.
- Encounter *selection* runs at the existing idle cadence off `neighborsOf`; movement targets are
  zone-clamped; both parties released instantly on summon (either one — the other reads the
  departure via the existing parting-glance machinery).

### D4 — THE CURSOR IS A CREATURE (glance + THE CHASE)
Extends the existing Commander-presence stack; checks off the roadmap's "Mimic the cursor".
- **Crew cursor-drift**: give crew bodies a small share of the existing gaze-drift (hero keeps the
  larger share) — occasionally an idle crew member is just... watching your cursor.
- **Cursor-mimic (head-only)**: rare quirk-band beat — an idle body TRACKS the moving cursor with
  continuous facing updates for 3-6s (not one glance — a follow), then snaps away. Requires cursor
  freshness; ends immediately when the cursor goes stale.
- **THE CHASE (the headline)**: very rare (station-level cooldown, minutes; idle-only; never during
  chat focus; one chaser ever): an idle body breaks toward the cursor's world tile — zone-clamped —
  repathing at a low cadence (~1/s, so it lags you like a real pursuer), for 3-6 seconds. Then it
  just STOPS, stares at where the cursor was for a held beat, and walks away as if nothing
  happened. If the cursor leaves its zone mid-chase it halts at the border and stares out — the
  containment beat again. Rarity is sacred: at the designed rate most sessions see ZERO chases;
  that's what makes the one you see land.
- **reduceMotion**: chase no-ops; mimic falls back to a single glance.

## Phases (strictly sequential; verify-loop after each; D1 can ship alone)
- **D0 — scope-lock**: pin every anchor above against the live file; write the D2 hero-only-gate
  audit table into this doc; add the `setChatFocus` no-op plumbing (zero behavior change). Gate.
- **D1 — chat-stare.** Gate: G2 (reply run seizes correctly, returns after), no suppression leak
  (chatFocus null always restores idle), blast radius (chat.js = one announce).
- **D2 — crew parity + station-budget retune.** Gate: G5 crowd-calm hunt (max-crew floor soak),
  determinism, no hero-beat regression.
- **D3 — social encounters.** Gate: G3/G4 hunts — containment leak, convergence pileup, deadlock
  (both released on any seize), per-pair cooldown actually per-pair.
- **D4 — cursor mimic + chase.** Gate: chase zone-clamp, one-chaser lock, chat-focus exclusion,
  reduceMotion, rarity audit (soak: chases/hour within design).

## Verification (honest limits, same as Tier B/C)
No automated behavioral test drives the canvas FSM, and headless tabs pause rAF. Per phase:
`node --check` + full `npm run test:fast` (incl. determinism lint) + adversarial code-review round
with the G-hunts above + a live foreground `?dev` soak for the observable beats (D1 stare and D4
chase ARE observable on demand — open chat / move the mouse; record both). D2/D3 rates verified via
the `dbg()` read-only introspection pattern from Pass 5.

## Anti-overlap protocol
Lane worktree only (suggest `gen-trees\new-agent-tree.ps1 living-crew` → `agent/living-crew`);
world.js has ONE writer; never `git add -A`; never edit `shared/*`; build stops at
green+verified+ready — merge is a separate explicit decision from the integration tree.

---

## D0 — SCOPE-LOCK (verified against the live worktree files, 2026-07-02)

Fork point: trunk `feat/harness-backend` @ `95325fc`. All anchors below are REAL line numbers grepped
in `C:\Users\<you>\gen-trees\living-crew` at the time of D0 (they will drift as D1+ edits land — treat
as "was here at D0"). world.js is 3914 lines pre-edit; chat.js 1762; zones.js 203.

### Verified anchors (plan claim → live reality)

| Thing | Plan said | Live reality | Match? |
| --- | --- | --- | --- |
| hero `agent` + `crew[]` | :56-67 | `let agent = null` :61; `let crew = []` :67; `let self = agent` :66 | ✔ |
| `decideIdle` | :1847 | `function decideIdle(now)` :1847 | ✔ |
| `setGlance` | :1345 | `function setGlance(dir,ms,now)` :1345 | ✔ |
| `maybeGlance` | — | `function maybeGlance(now)` :1904 (operates on `agent` ONLY — hero head-anim layer; see note) | ✔ |
| `dirToward` | :176 | `const dirToward = (fx,fy,tx,ty) => ...` :176 | ✔ |
| `standStill`/`stilling` | — | `function standStill(now)` :1533 (sets `self.stilling=true`, `goal=null`, holds via `idleUntil`) | ✔ |
| `lastCursor` | :120-126,570 | `let lastCursor = {wx,wy,t:-1e9}` :124; set on mousemove :570 | ✔ |
| cursor gaze-drift | :1459-1465 | `ambientGazeDir(now)` :1462 (32% toward cursor when `<8000ms` fresh) | ✔ |
| summon/task seize | `activity==='task'` block above idle | hero: `tick()` :2042 `if (!awaitPrompt && activity==='task' && agent.goal!=='work')`; the idle re-decide branch :2103 sits BELOW it. crew: `stepCrew` :1080 `if (b.working) {...continue}` above `crewEngineStep` | ✔ |
| Tier C `neighborsOf`/`glanceAt` | :1352,1424 | `neighborsOf(body,radius)` :1358; `glanceAt(self_,otherBody,dur,now)` :1376 | ✔ (±6 lines) |
| `bodyForAgent` | — | `function bodyForAgent(aid)` :3243 — `'agent'`→hero, else `crew.find(b=>b.agentId===aid)` | ✔ |
| per-tick actor pointer | — | `self` repointed to each crew body in `stepCrew` :1089 then `self=agent` :1092; hero tick `self=agent` :1998 | ✔ |

### chat.js lifecycle (how a conversation binds to an agent)

- COMMS is a **persistent panel**, NOT a per-agent modal that opens/closes. `chat.js` `activeWs` (:31) is
  the on-screen stream; `load(ws)` (:325) is the **single rebind boundary** — it sets `activeWs = ws` and
  re-renders. It's called by app.js on: summon/create (:396,:430), stream switch (:1598), resume (:1603),
  and first-build launch (:1340). The agent id of the on-screen conversation is `activeWs.agentId || 'agent'`
  (the app-wide hero sentinel — hero's real `agent.id` IS the literal `'agent'`, app.js :1151).
- `World.setActivity('task')` is driven from chat.js `walkToDesk()` on the first real tool call of a run
  (:1487 `onToolCall → walkToDesk()`), and the run route arms it at :1421 (`setActivityFor(turnAgentId,'task')`).
  Run end → `'idle'`/`'talk'` at :1595-1596. **DISCOVERED DISCREPANCY vs plan §"The live substrate":** the plan
  says "Chat replies already drive `World.setActivity('task')`" as if on send — reality is REACTIVE (armed on
  the first tool call, not the message), per the desk-trip invariant note at world.js :2034-2040. This does not
  change D1 (the stare simply sits below `activity==='task'` regardless of when it arms).
- **No genuine close event exists** in this COMMS model (you're always in *some* conversation once the game
  starts). So D1's announce is: call `World.setChatFocus(activeWs.agentId || 'agent')` at the tail of `load(ws)`
  (covers open + every switch in one hook), and `World.setChatFocus(null)` when `load` resolves no stream
  (pre-game / no active ws). This is the cleanest single announce point and keeps chat.js blast radius to that
  one hook (G7). Documented here because it deviates from the plan's literal "open/close" framing.

### D2 hero-only-gate AUDIT TABLE (deliverable for the future D2 phase)

Method: a beat is **SHARED** if its body-state reads/writes go through the module `self` pointer (so
`stepCrew` running it with `self=b` acts on the crew body) AND it is reachable from `decideIdle`/`crewEngineStep`
/`nextWaypoint` (the crew-run paths). It is **HERO-ONLY** if it references `agent` directly, or is gated behind
`if (self === agent)`, or is only ever called from the hero `tick()`.

| Beat | Gate location | Hero-only? | Why |
| --- | --- | --- | --- |
| **quirk layer** `maybeQuirk` | :1656 (called from `decideIdle` :1856) | **NO — shared** | all `self.*`; crew-damped by floor governor `lastQuirkAt` (:1662). Sub-quirks listen/scan/ponder/faceWall/gazeOut/vigil/stare all `self`-based |
| **caretaker rounds** `maybeRounds`/`roundsNext` | :1781 / :1799 (from `decideIdle` :1878) | **NO — shared** | all `self.*`, zone-clamped via `zoneFor(self)` |
| **revisit (fond/haunt)** `maybeRevisit`/`favTile`/`noteFond` | :1824 / :1816 / :1809 (from `decideIdle` :1868) | **NO — shared** | all `self.fond` (per-body Map, seeded in crew literal :3205) |
| **mourning** `planMourn`/`maybeMourn` | :1837 / :1312 | **YES — hero-only** | `decideIdle` gates `if (self===agent){ if(pendingMourn && planMourn) }` :1852-1853; `pendingMourn` is a MODULE var fed only by the hero's `maybeMourn` (removal reflex). Plan keeps this hero-exclusive |
| **novelty inspect** `planInspect` | :1468 (from `decideIdle` :1854 + tick :2058) | **hero-only *reflex*, shared *mechanism*** | `decideIdle` gates the novelty-queue reflex `if(self===agent)`; `novelty[]` is a module queue the hero fills. `planInspect` itself is `self`-based but crew never have queued novelty |
| **off-beat hold** `offbeat` | :1540 (from `standStill` :1536) | **NO — shared** | `self.offbeatCd` per-body gate (:1542); reduceMotion-skipped |
| **vigil** `quirkVigil` | :1707 (via `maybeQuirk` :1672) | **NO — shared** | `self`-based, zone-clamped |
| **stroll-beats / double-take** `maybeStrollBeat` | :799 (from `nextWaypoint` :795 — a shared path) | **NO — shared** | `self.*`; the `activity!=='idle'` guard only applies `(self===agent)` so crew are unaffected by it |
| **sleep / power-down** `sleep` | :1771 (from `decideIdle` :1861) | **NO — shared** | all `self.*`; `phaseOf` drift is per-body-skewed (:1650) |
| **belt-yield** `shouldYieldToCargo` | :814 (from hero `tick` :2064 only) | **YES — hero-only** | reads `agent.target`/`agent.px` directly; only wired into the hero `tick` walk block. Crew `crewEngineStep` has no belt-yield |
| **deep-lock** (rare long look-up) | inside `maybeGlance` :1926 (`deepLocks` module var) | **YES — hero-only** | `maybeGlance` runs on `agent` only + `deepLocks` is a module budget |
| **cursor gaze-drift (ambient)** `ambientGazeDir` | :1462 | **shared *fn*, hero-only *as an idle head layer*** | `ambientGazeDir` is `self`-based and IS used by crew via `lookAround`/`standStill`. BUT the dedicated per-tick cursor drift lives inside `maybeGlance` (agent-only, :1919-1934) so crew get cursor-drift only at idle-decision moments, not continuously |
| **THE LOOK-UP** | `maybeGlance` :1914-1934 | **YES — hero-only** | `maybeGlance` on `agent`; `userReturnUntil`/`lastCursor`/`deepLocks` module state |
| **THE LONG STARE** `quirkStare` + its hold | :1722 (quirk) + `maybeGlance` hold :1961 | **stare ENTRY shared, HOLD hero-only** | `quirkStare` sets `self.goal='stare'` (crew CAN enter it via maybeQuirk); but the per-tick stare *hold* animation (:1961-1965) is in `maybeGlance` → `agent` only. Plan lists LONG STARE as hero-exclusive — to honor that in D2, gate `quirkStare` behind `self===agent` |
| **FIRST LIGHT** `stepFirstWake` | :1549 (from hero `tick` :2101, `agent.goal==='firstwake'`) | **YES — hero-only** | references `agent` directly; the birth ritual, wired only into the hero tick |
| **pace (antsy)** `pace` | :1608 (from `decideIdle` :1881) | **NO — shared** | `self`-based, zone-clamped |
| **gaze-out (contemplate void)** `planGazeOut` | :1618 (from `decideIdle` :1880 + `maybeQuirk` :1670) | **NO — shared** | `self`-based, own-zone-edge clamped |
| **mutual glance (Tier C)** `maybeMutualGlance` | :1441 (from `decideIdle` :1867) | **NO — shared** | already crew↔crew by design |
| **autonomous decor place** `maybePlace` | :1746 | **hero-only in practice** | uses module `agentDecor`/`placeCd`; the plan already removed autonomous placement from the idle menu (`decideIdle` comment :1857) |

**KEY D2 INSIGHT (for the future phase, not this lane):** the want-engine (`decideIdle` + most beats) is
ALREADY shared via `self`. The real hero/crew gap is the **head-animation layer**: `maybeGlance` runs on
`agent` only and is called only from the hero `tick()`. Crew get glances just at idle-decision moments (via
`lookAround`/`ambientGazeDir`) and Tier C. So "kill aimless crew walking" is mostly a RETUNE (station budget,
G5) + porting `maybeGlance`-class continuous facing to crew, NOT rebuilding the want-engine. The truly
hero-exclusive beats to KEEP special (per plan): mourning, belt-yield, deep-lock, THE LOOK-UP, FIRST LIGHT,
and (by intent) THE LONG STARE hold.

### D0 plumbing added (zero behavior change)
- `let chatFocusId = null;` module-local (world.js, near `lastCursor`/`userReturnUntil`).
- `function setChatFocus(agentId) { chatFocusId = agentId || null; }` + a `chatFocusBody()` resolver
  (`chatFocusId ? bodyForAgent(chatFocusId) : null`), exported on the public API. **No caller wired in D0.**
- No read of `chatFocusId` anywhere in D0 → provably zero behavior change (verified: `node --check` +
  full `test:fast` green).

## D1 — implementation notes (as built)
- **chat.js hook:** ONE announce at the tail of `load(ws)` (:325): `World.setChatFocus(activeWs.agentId || 'agent')`
  when a stream is resolved, else `World.setChatFocus(null)`. Covers open + every switch (the only rebind
  boundary); the persistent-panel COMMS model has no separate close (documented above). Blast radius = this
  one hook (G7).
- **world.js behavior:** a shared `chatStareHold(now)` runs for the focused body while it is genuinely idle
  (not walking, not working, not mid-goal, `activity!=='task'`): sets `stilling` (reusing the Pass-7
  CONTENT=STILL machinery), faces south, and drifts toward `lastCursor` when fresh (`<8000ms`) via the
  existing `dirToward` pattern — one tracker, no second cursor sampler. It is invoked:
  - from `decideIdle` as an **early-out** (before quirk/social/wander) so the focused body never *chooses* to
    wander while held; and
  - every tick as a **hold** in the hero `tick()` idle branch and in `crewEngineStep`, so the facing tracks the
    cursor continuously (crew have no `maybeGlance`, so the hold must drive facing directly — see D0 KEY INSIGHT).
- **Work always wins (G2):** the hold is only reachable while `activity!=='task'` and `goal==null` — it sits
  strictly BELOW the summon/task-seize block (unchanged). When a reply run arms `task`, the existing
  walk-to-desk beat runs untouched; when the run ends and focus is still set, the next idle tick resumes the stare.
- **Cleanup:** `setChatFocus(null)` (or focus moving to another id) needs no teardown — the previously-focused
  body's next `decideIdle` clears `stilling` on entry (:1848) and re-enters the normal menu. If the focused id
  doesn't resolve to a live body, `chatStareHold` no-ops.

### D1 WARMTH FIX (2026-07-02) — the stare must not follow the cursor FOREVER
- **The bug (live-reported by Andrew + confirmed in a headless soak):** COMMS is a PERSISTENT panel — it ALWAYS
  has an active stream — so `load(ws)` announces `setChatFocus(agentId)` at boot and NEVER clears it. The focused
  (usually hero) body was therefore in `stare-chat` for the entire session: it endlessly tracked the cursor and
  its whole idle life (quirks/social/chase/wander) was permanently suppressed. Andrew: "it will just endlessly
  follow the users mouse."
- **The fix — hold the stare only while the conversation is WARM.** A module-local `chatWarmUntil` deadline,
  unified behind **ONE shared predicate**: `chatHot(now) = chatFocusId != null && now < chatWarmUntil`.
  On each genuine engagement `warmChatFocus()` draws a **FRESH random window** into the deadline:
  `chatWarmUntil = fnow + U.irnd(CHAT_WARM_MIN, CHAT_WARM_MAX)`, `CHAT_WARM_MIN/MAX = 30000/90000` (30-90s).
  (RETUNED 2026-07-02 from a fixed 120s at Andrew's direction — "30 seconds to a minute and a half… Less
  predictable": a per-engagement random draw means the lose-interest moment can't be learned.) Engagement =
  `setChatFocus(id)` (a switch/open — non-null id only, so `setChatFocus(null)` never warms) and the tiny public
  `World.chatFocusPing()` (no-op when no focus is set).
- **Eligibility is keyed on HOT-focus, not focus (adversarial-review fix on the first cut):** COMMS focus never
  clears in practice, so any exclusion keyed on focus ALONE would permanently bar the focused body from a beat
  family even after warmth lapsed — the first cut fixed only `chatStareHold` and left the body half-restored
  (wander/quirks back; social/mimic/chase still barred forever). ALL five "held by the stare" call sites now key
  on the same `chatHot(now) && body === chatFocusBody()` condition: `chatStareHold`'s own gate, the
  `socialEligible` exclusion (D3 recruiting), the `cursorBeatEligible` exclusion (gates BOTH `maybeMimic` and
  `maybeChase`), `encounterBroken` (a live social beat), and `sweepChase` (a live chase). Semantics: while HOT,
  behavior is identical to the old always-focused behavior (excluded from beats, mid-beat seized); once COLD, the
  focused body is FULLY back in its idle life — eligible for social, mimic, THE CHASE, quirks, and wander.
- **The re-warm race (traced):** if the user types (re-warms) while the cold-focused body is MID-beat, it is not
  yanked mid-tick — `chatStareHold` bails on any `goal !== 'stare-chat'` (unchanged), so the transition always goes
  through the sanctioned teardown: a live social beat breaks via `encounterBroken → endEncounter` (both bodies
  released cleanly, slot freed), a live chase via `sweepChase → endChase` (lock freed, plan torn down) — both now
  keyed on hot, same-tick, exactly the old focus-seize semantics — and the short head-only mimic (3-6s, no sweep)
  simply finishes naturally. The stare then engages at the body's next idle decision.
- **Re-warm points (chat.js, pings only — the chosen design, NOT a world-side signal, to avoid double machinery):**
  a one-line `warmChat()` helper (`if (World.chatFocusPing) World.chatFocusPing()`) is called at the three genuine
  engagement moments: (a) the compose input's `input` handler (typing at the focused stream — O(1) timestamp write
  per keystroke, RNG-free), (b) `send()` past its busy-guard (sending a message), and (c) the run-lifecycle
  `finally` when the on-screen stream's run ends (the agent returns to the stare per the D1 loop → re-warm so it
  holds for a FRESH window after answering, instead of the reply-run wall-clock counting against warmth). Blast
  radius stays chat.js pings + world.js + this doc (G7).
- **Warmth-lapse self-heal (verified, no leak):** when warmth lapses, `chatStareHold` returns false; the last warm
  tick left `idleUntil = now + 400`, so within ~400ms the idle branch's terminal `now >= idleUntil` fires
  `decideIdle`, which clears `stilling` on entry and — with the stare cold — falls through to the normal want-engine
  (a picked beat, e.g. `standStill`, sets `goal = null`, overwriting `'stare-chat'`). No stuck stilling / suppressed
  wander. A focus SWITCH while warm: `setChatFocus(newId)` warms the NEW body; the OLD body lapses via the same
  self-heal on its next decision. `activity==='talk'` (voice) stays excluded as before.
- **Determinism:** warmth draws one `U.irnd` per ENGAGEMENT (a user-input boundary — the same class as the cursor
  itself), never per-frame; `chatHot` stays a pure RNG-free read. Determinism lint green.
- **Acceptance:** boot COMMS open + don't interact → the agent stares for 30-90s (a fresh draw each engagement, so
  the exact moment varies) then returns to its idle life (quirks/social/chase resume). Type or converse → the
  stare holds indefinitely while you keep engaging. Switch conversations → the focused agent warms.

### CURSOR-GLANCE BALANCE RETUNE (2026-07-02, same commit) — "not constantly following the mouse"
Andrew's second live observation: outside the stare, agents still flicked toward the mouse too often. Cause:
`ambientGazeDir`'s drift shares (hero 0.32 / crew 0.15) rolled on EVERY ambient glance (re-fired every ~4-11s via
the idle swivel / stilling shift / lookAround), and an actively-moving cursor is continuously fresh — so ~1/3 of
all hero glances pointed at the mouse. Fix, both levers: shares dropped to **0.12 / 0.06**, AND a per-body
`cursorGazeCd = U.irnd(20000, 45000)` armed on every cursor-directed ambient glance — at most one mouse-glance
per ~20-45s per body no matter how much the cursor moves. The deliberate follow moments are untouched and remain
the ONLY sustained tracking: the rare D4 cursor-mimic (45-90s cd + D2 budget) and the HOT chat-stare (now 30-90s
warmth-bounded). RNG note: the drift `U.chance` now rolls only when fresh AND off-cooldown (draw-order change is
benign — unseeded `U.*`, the standing D2 argument).

## D2 — implementation notes (as built)

### Half 1 — hero-only-beat extension: per-beat disposition
The D0 audit had already confirmed the **want-engine is shared** via the `self` pointer — quirks (listen/scan/
ponder/faceWall/gazeOut/vigil), caretaker rounds, revisit/fond, off-beat hold, sleep, pace, gaze-out, mutual-glance
and the stroll-beats are ALL already reachable by every summoned+placed crew body through `crewEngineStep`/`decideIdle`.
So the only OPEN candidates for D2 were the remaining hero-only beats. Each was verified against the live file (the
audit table is the map, the code is the truth) and disposed of as follows:

| Beat | Live gate (verified) | Disposition | Rationale |
| --- | --- | --- | --- |
| quirks (listen/scan/ponder/faceWall/gazeOut) | `maybeQuirk` :1703, all `self.*` | **already shared** | crew run it via `decideIdle`; only retuned under G5 (Half 2) |
| caretaker rounds, revisit, off-beat, sleep, pace, gaze-out, mutual-glance | all `self.*`, from crew paths | **already shared** | no change needed; revisit/off-beat now also G5-budgeted (Half 2) |
| stroll-beats / double-take | `maybeStrollBeat` :809, `self.*`; `activity` guard only applies to hero | **already shared** | crew already double-take; now G5-budgeted (Half 2) |
| **THE LOOK-UP** | inside `maybeGlance` :1969; references `agent` directly; called ONLY from hero `tick()` :2124; entangled with hero-only `deepLocks`/`userReturnUntil` | **SKIPPED (kept hero-only)** | NOT crew-wide today (verified: `lookCd` is a hero field; no `lastCrewLook`/crew look-up exists). Porting requires building the whole `maybeGlance`-class continuous-facing layer onto crew — exactly the larger, non-mechanical effort the D0 KEY INSIGHT flags, and the KEY INSIGHT lists THE LOOK-UP in the hero-exclusive keep set. Out of a mechanical-safe D2 extension. |
| **belt-yield** (`shouldYieldToCargo`) | :824, reads `agent.target`/`agent.px` directly; wired ONLY into the hero walk block (:2112); crew `crewEngineStep` has no belt-yield hook | **SKIPPED (hero-coupled)** | The `self`-rename looks mechanical, but the beat is hero-coupled in practice: belts run through the central concourse the hero occupies, while crew wander is zone-clamped to their assigned zones — a crew body rarely (if ever) paths across a live belt, so a ported check would be dead code where it can't fire and a pileup/stall risk where it could (a crew body freezing on a shared belt). Per brief: hero-coupled ⇒ document + skip rather than force. |
| **novelty-inspect reflex** (`planInspect`/`novelty[]`) | reflex gated `if(self===agent)` in `decideIdle`; `novelty[]` is a single MODULE queue filled only by the hero | **SKIPPED (queue doesn't generalize per-body)** | `novelty[]` is one shared queue, not per-body. Extending as-is → all crew inspect the same placed prop (swarm, violates G3/G5); making it per-body is a rebuild, out of D2 scope. |
| mourning, deep-lock, FIRST LIGHT, THE LONG STARE hold | hero-only by audit | **KEPT hero-exclusive** | design-intent per plan §D2 keep-list — untouched. |

**Net for Half 1:** zero new extensions were needed or safe — the safe set was already shared (D0's finding), and every
remaining hero-only beat is either design-intent-exclusive, hero-coupled, or a non-mechanical rebuild. The crew liveliness
gain in D2 therefore comes entirely from Half 2 (the retune that lets the already-shared beats run at a *calm* station rate).

### Half 2 — G5 station-level rarity budget (the retune; landed, then RE-TUNED after adversarial review)
- **Review finding (F1) that forced the retune:** the first cut (an 8s window with a x0.35 soft damp, mirroring the
  B3 quirk governor) was correct but **barely bound at scale** — the 8s damp shadow covers only ~5-18% of the 45-140s
  per-family cooldowns, so a Monte-Carlo of a 6-body floor showed only ~7% reduction (≈5.7x single-agent cadence,
  vs the G5 target). The claim "floors at ~1 agent's" was overstated and is retracted; the shipped design below is
  measured, and its honest worst case is **~2x single-agent**, not 1x.
- **Shape (a station-wide SHARED cooldown for crew rolls):** one module-local `crewBeatGateUntil` + two helpers —
  `armBeat(now)` sets `crewBeatGateUntil = now + U.irnd(45000, 90000)` (a window drawn on the order of the per-family
  cooldowns — deliberately the same range as `quirkCd`, no new magic numbers), and `crewBeatDamp(now)` returns `0`
  for a CREW body while `now < crewBeatGateUntil`, else `1` — and **always `1` for the hero** (the `self === agent`
  short-circuit runs BEFORE any gate-state read). Every fired beat (hero or crew) arms the gate, so the CREW's
  COLLECTIVE noticeable-beat rate is bounded at ~1 per 45-90s regardless of crew count, and hero beats keep the crew
  quiet in their shadow. This generalizes and subsumes the old per-quirk `lastQuirkAt` (removed — write-only after this).
- **Governed families (the noticeable beats only):** quirks (`maybeQuirk`, incl. vigil + long-stare entry), stroll
  double-takes + considered pauses (`maybeStrollBeat`), off-beat dwell-stretches (`offbeat`), and haunt revisits
  (`maybeRevisit`). Each **arms** the governor when it fires and hard-gates its own crew roll (`p *= crewBeatDamp(now)`,
  or an early skip for revisit which has no chance-roll). Ambient **texture** — glances, cursor facing-drift,
  mutual-glance, wander, needs — is deliberately NOT budgeted (per G5: only noticeable beats).
- **MEASURED CALIBRATION (Monte-Carlo, real constants: 2s idle re-rolls, p=0.085·(0.6+0.4·restless), 45-90s per-body
  quirkCd; 200 runs × 10min):**
  | Config | beats/10min | × N=1 |
  | --- | --- | --- |
  | N=1 (hero only) baseline | 6.9 | 1.00x |
  | 6 bodies, undamped | 41.8 | 6.06x |
  | 6 bodies, first-cut 8s/x0.35 damp | 39.3 | 5.70x (the F1 finding — barely binds) |
  | 6 bodies, **shipped gate 45-90s** | **12.5** | **1.81x** (hero 6.9 + crew collectively 5.6) |
  | 7 bodies, shipped gate 45-90s | 12.6 | 1.83x (crew-count-invariant: crew stays ~5.6) |
  Alternatives tried: 30-70s window → 2.17x (passes but less margin); 60-120s → 1.47x (quieter than needed).
  45-90s chosen: within the ~2-2.5x target with margin, and symmetric with the existing `quirkCd` range.
- **Why N=1 is a provable no-op:** `crewBeatDamp` short-circuits to `1` on `self === agent` before reading the gate.
  A single-agent floor never populates `crew[]`, so `self` is only ever `agent` → every multiplier is `* 1`
  (byte-identical in IEEE754) and the revisit skip (`1 < 1`) is never taken. `armBeat`'s writes (and its `U.irnd`
  draw) are inert in N=1 — `U.chance`/`U.irnd` are independent `Math.random` wrappers, not a seeded stream, so an
  extra draw cannot shift any other roll's outcome. **⇒ N=1 behaves EXACTLY as pre-D2, and the hero's rolls stay
  byte-identical at ANY crew count (J1 parity).**
- **No deadlock / no starvation:** the gate is a timestamp compared against the advancing U-driven frame clock —
  it always expires; a gated roll (`U.chance(0)`) fails BEFORE any per-body cooldown write, so skipped rolls never
  mutate `quirkCd`/`offbeatCd`/`pauseCd`/`revisitCd`; revisit's binary skip re-considers every idle tick once the
  window lapses. Crew families still fire — collectively ~1 per 45-90s, individually rotated by whoever rolls first.
- **Determinism (G6):** `now` is the U-driven frame clock; only `U.chance`/`U.irnd` + arithmetic used; no
  `Math.random`/`Date.now`/`new Date`. `lint-determinism` green.
- **Blast radius (G7):** `frontend/app/world.js` + this doc only. No chat.js, no shared/*, no new modules.
- **Verification:** `node --check` clean; full `npm run test:fast` green incl. `lint-determinism` + `lint-emits`.
  Behavioral rates are not headless-testable (rAF pauses; plan's honest-limits section) — verified by code review
  against the G-hunts (N=1 drift, non-summoned-body fire, deadlock, cross-body mutation, determinism) all clear.

## D3 — implementation notes (as built)

**All FOUR beats shipped** (huddle, watch-a-peer-work, half-follow, border meeting) — none skipped. Single
writer: `frontend/app/world.js` (+ this doc). All SILENT (no speech/bubbles). Commit: `tier-d D3: social
encounters …` (557dccb2) + the fall-through / one-sided-break fixes.

### The coordinator (assignment / stepping / release)
- **The slot (G4):** ONE module-local `socialBeat = null | { kind, aId, bId, until }`. `until` = `now +
  SOCIAL_HARD_MS` (25 s) is the whole-encounter HARD timeout. A **station-level sweep at the top of `tick()`**
  (`if (socialBeat && (now >= until || encounterBroken)) endEncounter`) frees the slot EVERY frame independent of
  any body's stepper — so even if BOTH participants get seized in the same tick (neither runs its own guard) the
  slot is never leaked. `socialPairCd` (Map, sorted `"idA|idB"` key) is the per-pair cooldown.
- **Assignment — `startEncounter(a,b,kind,now,planA,planB)`** is the SINGLE sanctioned cross-body write (K2): it
  assigns each body its OWN self-contained plan on `body.social` (`{ phase, tx, ty, faceTile, partnerId, kind, … }`),
  sets `goal='social'` on both, arms the slot + `armBeat(now)` (G5). Two-sided beats (huddle/border) go through it;
  the ONE-SIDED beats (watch/follow) inline-assign only the OBSERVER's plan (the passive subject keeps working /
  walking — that's the beat) and set the slot directly, still `if (socialBeat) return false` guarded.
- **Stepping — `stepSocial(now)`** runs per-tick for the current body (`self`) and mutates ONLY `self` (its plan +
  position/facing via the existing `setPathTo`/walk machinery) and reads the partner READ-ONLY (position only, via
  `bodyForAgent`). Phases: `walk` (path to the fixed target — `pl.started` distinguishes "not yet en route" from
  "arrived"; follow re-steps 2-4 tiles toward the moving partner, zone-clamped, then STOPS — never completes) →
  `hold` (stand, face partner/faceTile, until `pl.until` = `now + U.irnd(3-7 s)`) → `endEncounter`. Wired into BOTH
  loops (hero `tick()` and `crewEngineStep`) after the D1 chat-stare hook, BELOW the summon/`b.working` seize; a
  dedicated `goal==='social'` branch in each idle ladder stops the fall-through to `decideIdle` (which would stomp
  the hold with a wandering beat). `arrive()` gained a `goal==='social'` case so a reached waypoint stays on-goal.
- **Selection — `maybeSocial(now)`** is called from `decideIdle` at the existing idle cadence, on EVERY pass
  (hoisted out of the `top < 28` content branch 2026-07-02 — see SELECTION HOIST below) (K4 — off
  `neighborsOf`, never off observing another encounter). Order of gates: reduceMotion → no walking beats (degrade to
  Tier C glances); slot free; self eligible (`socialEligible`: idle + placed + not chat-focused + not already in a
  beat); **social LANE open** (`now >= socialGateUntil` — the dedicated 5-8min station cooldown, NOT the shared
  `crewBeatDamp` gate anymore — see the RATE RETUNE note below); **candidate exists** (a same-zone neighbor OR any
  other placed body) BEFORE the `U.chance(SOCIAL_SEL_ROLL)` roll — so a solo-hero floor never even rolls (N=1
  parity, hunt 6); then try watch→huddle→follow→border, first legal plan wins.
- **Release — `endEncounter(now)`** frees the slot, clears each body's own plan (`goal==='social'` → idle), and arms
  the per-pair cooldown. Idempotent. `encounterBroken(now)` (READ-ONLY) is the tear-down trigger: despawn, the
  observer losing its plan / being seized (working / hero `activity==='task'`), or EITHER body pulled into a
  chat-stare. Two-sided beats additionally require the partner to still hold its plan; one-sided beats tolerate the
  subject working/walking (that IS the beat).

### Border meeting (the shared-edge geometry)
Computed **directly from the two zone rects** — no `zones.js` API change. `zoneRect(zone)` yields the single rect
of a `'room'` zone (`'leash'`/`'multi'` zones can't express a clean shared edge → those pairs are simply NOT
border candidates, a documented skip, not a `zones.js` edit). `sharedEdge(ra,rb)` returns a vertical/horizontal
shared line iff the rects abut with an overlapping span; `borderTileFor(rect,edge,cur,walkableFn)` returns the
nearest walkable tile of that line INSIDE the given rect (the walkable test is INJECTED so the function is pure).
Each body walks to its OWN rect's edge tile — they meet ACROSS the line, never crossing (containment staged, not
hidden). **Automated coverage: `test/social-border.test.js`, chained into `test:fast` right after zones.test (the
established chain pattern)** — 23 assertions. world.js is a browser IIFE (un-requireable under node), so the test
extracts the marked `D3-PURE-GEOMETRY` block from the SOURCE and executes it — the shipped code, not a copy (the
same eval-the-engine-source spirit as `test/test_world.js`) — with `Zones.rectHas` as the containment oracle:
each body's target is inside its own rect ONLY; gaps yield no edge; partial overlaps span exactly; blocked edge
tiles are skipped; a fully-blocked edge yields null (the pair is skipped, nothing strands); plus a purity lint on
the extracted block and source locks on the live wiring. The two helpers are also exposed read-only on the World
API as `_dbgSocialGeom` for the in-browser DEV harness.

### Final tuning constants
`SOCIAL_SEL_ROLL = 0.08` (per idle re-decide, only when a candidate pair exists + the social LANE is open);
`SOCIAL_STATION_CD_MIN/MAX = 300000/480000` ms (the dedicated social LANE, **5-8 min** — the rate governor);
hold `U.irnd(3000, 7000)` ms; whole-encounter hard timeout `SOCIAL_HARD_MS = 25000` ms; per-pair cooldown
`U.irnd(180000, 360000)` ms (3-6 min); candidate radius 5 tiles; half-follow `U.irnd(2,4)` tiles.

### RATE RETUNE (2026-07-02) — social was starved; give it its own lane
- **The bug (observed + modeled):** at the shipped `SOCIAL_SEL_ROLL = 0.02`, social SELECTED *inside* the shared
  D2 quirk gate (`crewBeatDamp`). Two compounding causes at those constants: social's `0.02` per-re-decide roll
  competed against the quirk families' ~`0.085` effective for the SAME gate-open windows, AND every fired beat
  (usually a quirk, which rolls FIRST in `decideIdle`) re-armed the shared 45-90s gate — closing social's window.
  Net: social won only ~6% of station beats → ~1 encounter per 20-30 min on a 3-6 body floor (two 5-9 min soaks
  saw ZERO). The D3 intent ("one every few minutes at most") was unmet.
- **The lever chosen — a dedicated social station cooldown LANE** (mirrors THE CHASE's `chaseGateUntil`): social
  selection no longer consults `crewBeatDamp`; instead it gates on `now >= socialGateUntil`, a lane drawn `U.irnd(
  300000, 480000)` (5-8 min) at each fire. This DECOUPLES the encounter rate from the fragile quirk race — the rate
  is now governed by the lane cooldown, so it's *predictable and tunable to a target* regardless of quirk dynamics
  or pair scarcity. **Crucially, a fired encounter STILL arms the shared gate** (`armBeat`, factored with the lane
  draw into one `armSocialBudget(now)` helper called at ALL three fire sites — `startEncounter` for huddle/border,
  and the one-sided `planWatch`/`planFollow`), so quirks stay quiet in social's shadow and the **total** station
  beat rate is preserved (we re-slice the pie, not grow it — G5 honored). `SOCIAL_SEL_ROLL` raised `0.02→0.08` only
  so that, once the lane opens, an eligible pair is selected within a few idle re-decides (organic, not clockwork).
- **Validation — Monte-Carlo** (throwaway, not committed; the D2 pattern) with the real constants (2s idle
  re-decides; quirk families p≈0.085 per re-decide throttled by per-body 45-90s `quirkCd` + the shared gate; hero
  exempt from `crewBeatDamp`; single social slot busy `SOCIAL_HARD_MS`=25s; every noticeable beat arms the shared
  45-90s gate). 5000 runs × 60 min. Encounters/hr and TOTAL noticeable beats/hr, before vs after:

  | N | BEFORE enc/hr | AFTER enc/hr | BEFORE total/hr | AFTER total/hr | Δ total |
  | --- | --- | --- | --- | --- | --- |
  | 1 | 0.00 | 0.00 | 40.3 | 40.3 | **0.0% (byte-identical)** |
  | 3 | (starved) | ~9.9 | 75.8 | 73.3 | within budget |
  | 6 | (starved) | ~9.5 | 83.1 | 77.9 | **−6.2%** |

  **N=1 is a provable no-op:** a solo floor never has a candidate pair, so `maybeSocial` returns BEFORE any
  `U.chance` roll — zero extra RNG draws, and `armSocialBudget`'s `U.irnd` lane draw is never reached (fires only
  on a started encounter). Quirks 40.3/hr identical across every config ⇒ byte-parity at N=1 (matches the D2 J1
  property). **Pair-availability sensitivity:** the AFTER lane lands in **7.9-9.6 enc/hr across pairAvail 0.10-0.70**
  — robustly inside the 7-12/hr target band and saturating near the lane ceiling (~1 per ~6.3 min), because the
  lane cooldown (not the quirk race or partner scarcity) is the binding constraint. Total N=6 stays within ~6% of
  before (< the ~10% bar). **Alternatives tried:** 4-7min lane → ~11.1 enc/hr (top of band, Δ −5.0%); 4.5-7.5min →
  ~10.2 (Δ −5.7%). 5-8min chosen: mid-band with margin on both sides, symmetric with the per-pair 3-6min cooldown.
- **Honest rate:** a 3-6 body idle floor now sees roughly **one encounter every ~6 minutes** (~9.5/hr) — the D3
  "one every few minutes" intent, met. Still RARE (the lane + one-slot G4 + per-pair 3-6min cooldown all hold); an
  unattended / read-only / solo-hero floor sees ZERO (no pairs). Total station calm is unchanged (G5).

### SELECTION HOIST (2026-07-02, live-soak fix) — the retune was gated behind a branch that almost never runs
- **The bug (live differential probes + code):** ALL THREE Tier D selection hooks — `maybeChase`, `maybeSocial`,
  `maybeMimic` — were only reachable inside `decideIdle`'s `top < 28` CONTENT branch. Per the sentience roadmap's
  own Pass-7 note, contentment is *correct-but-rare in practice* (stim/social decay while idle), so the hooks were
  almost never CONSULTED: a 9-min 4-body post-retune watch saw 0 encounters; 150s+150s of continuous mousing saw 0
  chases (the hero cycled gaze/tend/quirk — need-driven passes, never content); the one chase ever observed fired
  7s after a fresh boot (the brief boot-time content window). The MC model assumed selection at every idle
  re-decide — what the code SHOULD do; the hoist makes the code match the model, so the tuned constants stand
  un-retuned.
- **The fix:** the three-line selection block (chase → social → mimic, order and comments kept) is HOISTED out of
  the content branch to run at **every** `decideIdle` pass. **Position: immediately after the sleep check, before
  the need-weights computation.** Why there: it preserves EVERY existing precedence relationship — chat-stare hold
  > hero reflexes (mourn / novelty-inspect / D5 board-post) > quirk > sleep > **chase > social > mimic** > the
  want-engine — which is exactly the relative order a content pass already had; the block merely becomes reachable
  on need-driven passes too. The `top < 28` branch keeps its CONTENT=STILL character (mutual-glance, revisit,
  stand/look/wander) minus those three lines (single consult site — grep-verified no duplicate remains).
- **Why all laws hold:** each `maybe*` is fully SELF-gated — the 8-15min chase station gate + cursor fresh+moving
  + one-chaser lock, the 5-8min social lane + single slot + per-pair cooldowns + candidate-existence, the mimic
  per-body 45-90s cooldown + cursor freshness + D2 station budget, and `goal==null` eligibility via `bodyIsIdle`
  (so a body holding ANY goal — including a cold `stare-chat` not yet re-decided — can never be grabbed). Hoisting
  only increases how often the hooks are *consulted*, never their *budgets*: the lanes/gates remain the rate
  governors, so the MC numbers (~9.5 enc/hr lane-bound; chase ceiling ~5.2/hr cooldown-bound; mimic quirk-band)
  are now the accurate live model. Total station calm is untouched (every fire still arms the shared gate).
- **RNG draw-order trace:** all three hooks are strictly gates-before-rolls (`maybeChase` has NO roll at all —
  RNG only on fire; `maybeSocial` returns before `U.chance` unless lane open + eligible + candidate; `maybeMimic`
  returns before its roll unless eligible + off-cooldown + cursor-fresh). On the previously-reachable CONTENT
  passes the draw order is unchanged (the need-weights computed between the old and new positions are RNG-free
  arithmetic). On need-driven passes the hooks are newly consulted, but on every quiet path (stale cursor, no
  pair, lanes closed, goal held) they no-op with ZERO draws — so an unattended / solo-hero (N=1) session stays
  byte-identical to pre-hoist. (`U.*` are independent `Math.random` wrappers, not a seeded stream, so the new
  draws on active paths cannot shift any other roll's semantics — the same argument as D2/D3.)

### The 7 self-review hunts — how each was cleared
1. **Social target outside the mover's zone** — every plan builder clamps via `tileInZone(zoneFor(mover))`
   (huddle via `nearestWalkableInZone`, watch/follow per-candidate, border double-checked belt-and-suspenders); the
   follow re-clamps each incremental step. Border bodies each target their OWN rect's edge tile (geometry test proves
   containment). CLEAR.
2. **Rendezvous deadlock (partner summoned/despawned/chat-focused mid-beat)** — the survivor frees within one tick
   via `encounterBroken` (checked both by the per-body guard AND the station-level sweep) → `endEncounter` frees the
   slot AND clears the survivor's plan. The hard `until` is the final backstop. CLEAR.
3. **Slot leaking / double-occupied** — the station sweep makes it un-leakable (frees even if both seize same tick);
   `startEncounter` + both one-sided builders early-return on `socialBeat`, and bodies are stepped sequentially in a
   frame (crew then hero), so no two encounters arm in one tick. CLEAR.
4. **An encounter starting during another** — every entry path guards `if (socialBeat) return false`; `maybeSocial`
   guards it first. Selection is off `neighborsOf` at idle cadence, never off observing an encounter (K4). CLEAR.
5. **Cross-body mid-tick mutation** — `startEncounter`/`endEncounter` are the ONLY functions that write a partner,
   and they are the explicit initiation/teardown coordinators (not per-tick stepping). `stepSocial` writes only
   `self` and reads the partner's position READ-ONLY. CLEAR.
6. **N=1 floor (no partner ever exists)** — `maybeSocial` returns BEFORE the `U.chance` roll when no other placed
   body exists, so a solo-hero floor consumes zero extra RNG (U.* are independent `Math.random` wrappers → a skipped
   draw shifts nothing); byte-identical to pre-D3. CLEAR.
7. **Summon latency** — the hero summon-seize block (sets `goal='summon'`) and the crew `b.working` seize both sit
   ABOVE the social step; the social branch is gated on `activity==='idle'` / `!b.working`. A summoned participant's
   task walk starts THIS tick (the seize block runs the same frame the sweep frees the slot). CLEAR.

### Residual risks / unverifiable
- **Live feel** (does an encounter read as eerie-and-alive vs busy?) is not headless-testable (rAF pauses; the
  plan's honest-limits section). Rates/timings are code-review + geometry-test verified; a foreground `?dev`
  multi-crew soak (2+ summoned crew sharing a floor) is the only way to SEE the beats — expected, deferred to an
  attended check.
- **Border meeting requires two `'room'`-zone bodies with abutting rects.** A solo hero (`'multi'` zone) or a
  leashed deskless crew body never border-meets — by design (documented skip), not a bug.
- **Known limit — mid-encounter zone shrink (reviewer note 2):** huddle/watch/border targets are zone-clamped at
  PLAN time only; a REFIT that shrinks a zone mid-encounter isn't re-checked step-by-step for those three beats
  (the half-follow DOES re-clamp each incremental step). This is the same clamp-at-pick model as the entire
  existing idle stack (wander/rounds/gaze-out all clamp when the target is chosen), so it is not a D3 regression —
  and any stale walk is bounded by the 25 s whole-encounter hard cap. Recorded, not fixed: fixing it here would
  mean a new per-step containment layer the rest of the idle stack doesn't have.

## D4 — implementation notes (as built) — THE CURSOR IS A CREATURE

**All three beats shipped** (crew cursor-drift, cursor-mimic, THE CHASE). Single writer: `frontend/app/world.js`
(+ this doc + the roadmap check-off). No chat.js edits. Commit `tier-d D4: the cursor is a creature …` (19c4c692)
+ the cross-phase-sweep fixes. Builds on the EXISTING Commander-presence stack (`lastCursor`) — no second cursor
tracker; the only new input signal is `cursorMoveT` (a real-displacement stamp for "actively moving", distinct from
`lastCursor.t` = mere presence).

### Beat 1 — crew cursor-drift (ambient, common)
`ambientGazeDir(now)` split: hero keeps `0.32`, CREW get `0.15` (`self === agent ? 0.32 : 0.15`). This is the ONE
spot crew ambient facing is randomized (via `lookAround`/`standStill`), so it never fights a held goal, a glance, a
chat-stare, or work facing (none route through here). **Ambient texture → NOT gated by the D2 station budget (G5's
ambient exemption).** N=1: `self` is only ever `agent` → `0.32`, byte-identical to pre-D4.

### Beat 2 — cursor-mimic (`maybeMimic`/`stepMimic`/`endMimic`, goal `mimic`)
An idle body TRACKS the moving cursor with continuously-updated facing (a follow, not one glance). Rides the goal/hold
machinery, not a new state family. Head-only — no movement. Gates: `cursorBeatEligible` (idle+placed+goal==null+not
chat-focused+not social/chase); per-body `mimicCd` in the quirk band `U.irnd(45000,90000)`; cursor FRESH at start
(`<8s`); `crewBeatDamp` (station budget) + `armBeat` on fire. `stepMimic` ends early if the cursor goes stale
mid-beat (snap-away only on a natural time-up). Duration `U.irnd(3000,6000)`. reduceMotion → degrade to a single
glance toward you (still arms the cooldown + budget). Suppressed during chat-focus (D1) / any held goal (the
`goal==null` gate) — a live social/chase body already has a goal so it's excluded.

### Beat 3 — THE CHASE (`maybeChase`/`stepChase`/`endChase`/`sweepChase`, goal `chase`) — the headline
One chaser station-wide (`chaseId`, module-level like the D3 social slot), **mutually exclusive with a live social
beat** (`maybeChase` bails on `socialBeat`; `maybeSocial` bails on `chaseId` — the one-noticeable-thing-at-a-time
discipline in both directions). Only ever CONSIDERED when: `now >= chaseGateUntil` (the LONG station cooldown), the
D2 station gate is open (`crewBeatDamp`), body idle+`goal==null`, cursor FRESH **and actively MOVING**
(`cursorMoveT` within 1.5 s — recent real displacement, not mere presence). On fire it draws the next
`chaseGateUntil = now + U.irnd(480000, 900000)` (8-15 min) immediately, so nothing re-rolls for minutes.
**Mechanics:** `stepChase` repaths toward the cursor's CURRENT tile at a low cadence (`CHASE_REPATH_MS = 1000` → it
LAGS the cursor like a real pursuer), **re-clamping to the chaser's zone at EVERY repath** (the cursor moves — a
one-time clamp isn't enough); pursuit `U.irnd(3000,6000)`; then STOP + face where the cursor was + hold
`U.irnd(2000,4000)` + release. **Cursor leaves the zone mid-chase** → clamp to the nearest in-zone walkable tile
(`nearestWalkableInZone`, the border) and stare out across the boundary (the containment beat again). **Cursor stale
mid-chase** → immediate stop + stare + release. Absolute whole-beat cap `CHASE_HARD_MS = 15000`. **Summon/despawn/
chat-focus seizes instantly:** `sweepChase` runs every tick at the top of the hero `tick()` (independent of the
chaser's own stepper, mirroring the D3 slot sweep) and frees the lock + tears the plan down the same tick; plus
per-body clears in the hero summon block and `seizeFromIdle` (crew). reduceMotion → no chase (the mimic already gave
the single glance).

### Final tuning constants
`ambientGazeDir` crew share `0.15` (hero `0.32`); `MIMIC_MIN/MAX_MS = 3000/6000`, `MIMIC_CD_MIN/MAX = 45000/90000`,
`MIMIC_SEL_ROLL = 0.03`; `CHASE_MIN/MAX_MS = 3000/6000`, `CHASE_STARE_MIN/MAX = 2000/4000`, `CHASE_HARD_MS = 15000`,
`CHASE_REPATH_MS = 1000`, `CHASE_GATE_MIN/MAX = 480000/900000`; shared `CURSOR_FRESH_MS = 8000`,
`CURSOR_MOVING_MS = 1500`.

### RARITY HONESTY (computed at the shipped constants)
- **THE CHASE.** Governed purely by the 8-15 min station cooldown (avg 11.5 min) — `maybeChase` has NO probability
  roll; it fires on the first eligible re-decide after the gate lapses. **Ceiling (user moves the mouse continuously
  the whole hour): ~5.2 chases/hour** (one per ~11.6 min). **Realistic:** the cursor is fresh+MOVING only a fraction
  of a session, and when the gate lapses during a quiet stretch the next chase WAITS for the cursor to next move —
  so ~2.4/hour if actively moused ~30 % of the time, ~0.9/hour at ~10 %, and **0 in any unattended / read-only /
  quiet session.** Most sessions see zero chases — that is the design, and it's what makes the one you see land.
- **CURSOR-MIMIC.** Per body, gated by the 45-90 s quirk-band cooldown + a `p=0.03` roll per ~2 s idle re-decide
  while the cursor is fresh. **Ceiling (cursor fresh continuously): ~26 mimics/hour/body** (≈ once per 2.2 min).
  N=1 (hero only) = same. **Realistic** (cursor fresh ~20 % of a session): ~5/hour. N=6: the hero is undamped; the
  CREW's collective mimic rate is bounded by the shared 45-90 s station beat gate (`armBeat`), NOT 6×, and shares
  that budget with quirks/social — so a 6-body floor stays calm (crew-count-invariant, same G5 property D2 measured).
- **Selection cadence note (2026-07-02):** these rates were computed assuming the hooks are consulted at every
  idle re-decide — which only became TRUE with the SELECTION HOIST (see the D3 section): pre-hoist, chase/mimic
  selection sat inside the rare `top < 28` content branch and the observed live rate was ~zero. Post-hoist the
  hooks run on every `decideIdle` pass, so the ceilings/realistic figures above are the accurate live model.

### The 6 self-review hunts — how each was cleared
1. **Chase target outside zone at ANY repath tick.** `stepChase` re-derives `zoneFor(self)` and re-tests
   `tileInZone` on EVERY repath; out-of-zone → clamp to the border via `nearestWalkableInZone` + stare-out. Stronger
   than the clamp-at-pick model the rest of the idle stack uses (which clamps once). CLEAR.
2. **chase/social/chat-stare/mimic mutual exclusion.** Every hold-family entry gates on `goal==null` (via
   `bodyIsIdle`/`cursorBeatEligible`/`socialEligible`) so no body is ever in two holds; the two STATION-level
   "noticeable" slots are cross-guarded BOTH ways (`maybeChase`↔`socialBeat`, `maybeSocial`↔`chaseId`) so only one
   is ever live; bodies step sequentially (crew then hero) so no two arm in one tick; `chatStareHold` bails on any
   non-`stare-chat` goal (won't yank a chaser/mimicker), and `cursorBeatEligible` excludes the chat-focused body.
   Fixed during the sweep: added the `maybeSocial → chaseId` guard (was one-directional). CLEAR.
3. **Stuck chase state** (cursor stale / body summoned mid-walk / path fail). `CHASE_HARD_MS = 15000` absolute cap;
   `sweepChase` frees on seize/despawn/chat-focus same-tick independent of the stepper; a failed `setPathTo` just
   stands a beat and retries, bounded by `endAt` (≤6 s) → stare → end. CLEAR.
4. **N=1 hero-only floor.** Beat 1 is a provable crew-only no-op (`self===agent → 0.32`, byte-identical). Beats 2+3
   both function for the lone hero (`crewBeatDamp` returns 1 for the hero → the gate is open; the hero IS the only
   body and MAY chase, by design). When the cursor is stale (the common unattended case) both beats early-return
   BEFORE any `U.chance`, so quiet-session idle life consumes zero extra RNG. CLEAR.
5. **Determinism (G6).** All beat logic uses `U.irnd`/`U.chance`/`U.pick` + the `now` frame clock. The only new raw
   call is `performance.now()`/`Math.hypot` inside the mousemove HANDLER (cursor displacement = user input, allowed;
   `lastCursor` already used `performance.now()` there pre-D4). `lint-determinism` green. CLEAR.
6. **No regression to the existing hero cursor gaze-drift / deep-lock.** `ambientGazeDir` hero share unchanged
   (`0.32`); THE LOOK-UP + deep-lock live in `maybeGlance`, untouched. `maybeGlance` now bails early for
   `goal==='mimic'/'chase'` (fixed during the sweep — else its cargo-body-track could hijack the cursor-follow
   facing), so stepMimic/stepChase is the SOLE facing driver during those beats. CLEAR.

### Cross-phase sweep (pre-merge review of the whole lane: chat-stare vs social vs mimic vs chase vs the D2 gate)
Read the full D3+D4 world.js diff hunting for two "one live thing" slots engaging one body and for non-mutually-
exclusive hold families. **Findings + fixes:**
- **F1 (fixed): social↔chase mutual exclusion was one-directional.** `maybeChase` bailed on a live `socialBeat`, but
  `maybeSocial` did NOT bail on a live `chaseId` — so a hero social beat could arm while a crew chase was live (two
  station-level noticeable things at once, violating the one-at-a-time discipline). Added `if (chaseId != null)
  return false` to `maybeSocial`. Now cross-guarded both ways.
- **F2 (fixed): `maybeGlance` could hijack the mimic/chase facing.** During goal `mimic`/`chase` the hero's
  `maybeGlance` (which runs before the steppers each tick) fell through to its cargo-body-track branch and could set
  `agent.glance`/`agent.dir`, fighting the cursor-follow. Added a `goal==='mimic'/'chase'` early-return to
  `maybeGlance` (mirrors the existing `sleep`/`firstwake` guards) so the D4 steppers own the facing.
- **Verified clean (no fix needed):** chat-focus moving onto a mid-chase body breaks the chase via `sweepChase`
  (chat-focus check) → the body then holds the stare next tick; the D2 `armBeat` gate is shared by mimic+chase+
  social+quirks so a 6-body floor's collective noticeable rate stays bounded (G5); every hold family is `goal`-keyed
  and every entry requires `goal==null`, so the FSM can only ever be in one; summon precedence (the seize block sits
  ABOVE all D4 stepping, and the steppers gate on `activity==='idle'`/`!b.working`) is intact.

### Verification (honest limits — same as Tier B/C/D3)
`node --check` clean; full `npm run test:fast` green incl. `lint-determinism` + `lint-emits` + `social-border.test`.
Behavioral canvas beats are NOT headless-testable (rAF pauses in a backgrounded tab — the plan's honest-limits
section); the mimic + chase ARE observable on demand in a foreground `?dev` soak (move the mouse; the chase needs a
fresh+moving cursor after the 8-15 min gate — force-testable by temporarily shrinking `CHASE_GATE_MIN` in a local
build). `dbg()` now exposes `social`/`chase`/`chaseGateIn`/`cursorFresh`/`cursorMoving` for the in-browser harness.
**Residual/unverifiable:** the live FEEL (does the chase read as eerie-and-alive vs silly?) and the tick-driven
phase progressions are code-review + rate-model verified only; an attended foreground multi-crew soak is the sole
way to SEE the beats — deferred to an attended check.

## D5 — THE OVERSEER OVERSEES (additive; hero-only role-shaped movement) — implementation notes (as built)

> Andrew's ask: the main agent should read as the station's OVERSEER — role-shaped movement that makes the floor
> feel like an organization, not a fish tank. Zero tokens (G1), deterministic (G6), work-always-wins (G2),
> containment inviolable (G3). Single writer: `frontend/app/world.js` (+ this doc). No chat.js, no shared/*, no new
> bus wire, no persistence. Commit `tier-d D5: THE OVERSEER OVERSEES …` (+ the hunt-3 hard-until hardening).

### What "the Overseer" resolved to (ground truth, grepped 2026-07-02)
There is **no separate overseer concept in-world** — grep of `frontend/app/world.js` finds none. The OVERSEER is a
UI/identity concept (app.js: "CREATE YOUR OVERSEER", the first agent runs the station and recruits the rest). In the
canvas, the **HERO body `agent` (its `agent.id` is the literal `'agent'`) IS the Overseer** — the Commander's main
agent. So every D5 beat is on the HERO body only (gated `self === agent` where the shared want-engine could otherwise
run it on crew), and rides existing hero machinery. **Zero crew behavior change.**

### Reused machinery (scope-locked, no new pathing/clamping)
- **`maybeRounds`/`roundsNext`** (caretaker rounds, Tier 1) — goal `'rounds'`, own cooldown `roundsCd` (60-130 s,
  OUTSIDE the D2 noticeable-beat budget), arrive gives a 1.5-3 s ownership hold (`studyUntil`). Beat 1 re-flavors
  its stops; its budget/cooldown model is UNCHANGED (verified: rounds is not gated by `crewBeatDamp`).
- **The D3 watch-a-peer stand-point** (`planWatch`'s "behind the worker" geometry) — beat 1's `supStandBehind`
  reuses the same candidate ring (`[2,3,1]` tiles along the observer→worker vector + the 4 cardinals), each
  `tileInZone`+`walkable` checked, facing via `dirToward`.
- **`missionPinCounts(now)` → `mpOpen`** — the frontend-visible task/mission QUEUE count, projected from
  `QuestStore.view()`/`QuestStateStore.visible()` and cached at 1 Hz. **This is state the frontend ALREADY holds for
  the board render — no new fetch, no new `U.bus.on`, no bus round-trip (G1 honored).** This is why beats 2+3 SHIPPED
  rather than being skipped (self-review hunt 4).
- **`boardAnchorTile()`** — the MISSION BOARD's approach tile via the shared `PropAnchor` law (already used by the
  autojob pin beat). Beat 2 models its goal `'post'` directly on the existing `maybePinProposal`/goal `'pin'` beat.
- **`armBeat`** (D2 station budget) — beat 2 ARMS it on fire (a noticeable beat: crew beats quiet in its 45-90 s
  shadow). It is **NOT itself budget-gated**: `crewBeatDamp` returns 1 for the hero unconditionally (the J1-parity
  short-circuit) and the board-post is hero-only, so a damp guard would be provably inert — the first cut carried
  one; the adversarial review flagged it and it was removed. Beat 2's rarity comes from its own 2-4 min `postCd`.
- **`zoneFor(self)` + `tileInZone`** (Tier A containment) — every new target clamped at pick, as the whole idle
  stack already does. Hero zone kind may be `'room'`/`'leash'`/`'multi'`; with crew present the hero can be caged to
  its own room, so beats 1+2 both re-check `tileInZone(zoneFor(agent), …)` and never reach outside.

### The three role-beats (all hero-only, all within the hero's zone)
1. **Inspection rounds** (beat 1) — in `maybeRounds`, a `self === agent` block scans `crew` for bodies `b.working`
   whose tile is `tileInZone` the hero's zone, and appends a `{ sup: supStandBehind(hero, b) }` stop (a ready
   `{tx,ty,face}` behind the worker, facing it). The stop rides the normal shuffle/pick + queue. On arrival the
   `'rounds'` case gives the **same brief 1.5-3 s hold** (a supervisor's GLANCE — deliberately shorter than the D3
   watch's 3-7 s STUDY) with an over-the-shoulder line (`SELF_SUPERVISE`) instead of the ownership beat, keyed off
   `self.roundsSup`. **No working crew in-zone (incl. every N=1 floor) ⇒ the block appends nothing, draws no RNG,
   and rounds are byte-identical to trunk.** It does NOT touch the D3 `socialBeat` slot (single-body, no partner
   state) and does NOT consult `crewBeatDamp` (rounds are a Tier-1 beat already outside that budget — kept so).
2. **Mission-board post** (beat 2) — `maybeBoardPost(now)`, called from `decideIdle` under the `self === agent`
   reflex block, goal `'post'`. Gates, in order (all pre-RNG): `now < postCd` →
   `missionPinCounts(now)[0] <= 0` (queue empty ⇒ nothing to survey) → board absent/no approach → **approach tile
   outside the hero's zone ⇒ no-op** (containment; no reach, no exception) → `setPathTo` fails ⇒ skip. Only AFTER the
   queue is confirmed non-empty does it draw RNG (`U.irnd` for `postCd`, `armBeat` — armed on fire, quieting crew
   beats in its shadow; see the `armBeat` bullet above for why there is no damp GATE). Walks to the board, faces it,
   **holds 3-6 s (a real queue survey)** via `studyUntil`, then the `'post'` dwell-release branch drifts back to
   idle. 2-4 min per-hero cooldown. **HARD UNTIL (hunt 3):** `maybeBoardPost` also sets `studyUntil = now + 12000`
   as a walk-cap so a board deleted/refit mid-walk (path cleared, arrive never fires) can never strand the goal —
   the dwell-release frees it by the ceiling even without an arrival; `arrive()` overwrites it with the real hold.
3. **Queue-aware idle bias** (beat 3) — in `decideIdle`'s bored/restless branch, the caretaker-lap chance leans
   `0.3 → 0.45` (×1.5, never absolute) **only when `self === agent` AND the queue is non-empty**. The multiplier is
   derived from the cached `missionPinCounts` (NO RNG), so the `U.chance` DRAW COUNT is unchanged — a no-queue floor
   keeps the exact `0.3` (byte-identical) and crew always use `0.3`. Rounds visit desks/belts/props (the
   work-adjacent points), so a busy station gets an overseer that hovers near the work — a WEIGHT shift, no new
   movement machinery.

### Constants
Beat 1: supervisor stand ring `[2,3,1]` tiles + 4 cardinals (from `planWatch`); hold reuses the rounds `U.irnd(1500,
3000)`. Beat 2: `postCd = U.irnd(120000, 240000)` (2-4 min); survey hold `U.irnd(3000, 6000)` (3-6 s); walk-cap
`studyUntil = now + 12000`. Beat 3: rounds bias `0.45` (queue non-empty) vs the existing `0.3`.

### Mutual exclusion / work-wins
Every beat is goal-keyed. Beat 2's goal `'post'` and beat 1's `'rounds'` require `goal == null` at entry (decideIdle
only runs on a genuinely idle body) and are BELOW the summon-seize block, which overwrites `goal → 'summon'` and
re-paths to the desk the moment `activity==='task'` arms — so **work always wins with no extra teardown** (same as
the pre-existing `'rounds'`/`'pin'` beats). Beat 2 is single-body and not a station slot, so it needs no
`socialBeat`/`chaseId` check beyond its own `goal == null`; it never runs under chat focus (D1's `chatStareHold`
early-out in decideIdle) or during a live social/mimic/chase (those hold `goal != null`).

### The 6 self-review hunts — how each cleared
1. **Crew byte-parity (zero crew-side diff).** Beat 1's worker scan is `if (self === agent)`; `roundsNext`'s
   `self.roundsSup = !!s.sup` is `false` for crew (undefined `sup`) and only read by arrive's ternary → `SELF_ROUNDS`
   (identical). Beat 2 is only ever called under `self === agent`. Beat 3's bias is `0.3` for crew. CLEAR.
2. **No-queue-no-crew hero byte-parity (RNG order).** Beat 1: empty/no-working-crew loop appends nothing, draws no
   RNG → identical stops/shuffle/pick. Beat 2: returns at the `missionPinCounts[0] <= 0` gate BEFORE any `U.*` draw
   (the cd + cached-queue reads are RNG-free). Beat 3: no-queue → `0.3`, identical `U.chance` draw.
   ⇒ a floor with no queue and no crew is byte-identical to trunk. CLEAR.
3. **Board-post stuck state** (board deleted/refit mid-walk). `'post'` is in the geometry-refit goal-drop list
   (alongside `'rounds'`/its siblings), so a REFIT releases it the same frame; the self-heal drops a pathless walker
   to idle; the `'post'` dwell-release frees the goal, and the `studyUntil = now + 12000` HARD UNTIL backstops even if
   arrive never fires. An unreachable board is caught by `setPathTo` returning false (goal never set). CLEAR.
4. **Queue state from EXISTING frontend state only.** `missionPinCounts` reads the QuestStore projection already
   computed for the board render (cached 1 Hz). No new fetch/bus subscription added anywhere → beats 2+3 shipped
   (not skipped). CLEAR.
5. **Containment on every new target.** `supStandBehind` checks `tileInZone`+`walkable` on every candidate (worker
   itself pre-checked in-zone); `maybeBoardPost` explicitly checks `tileInZone(zoneFor(agent), tile)` before pathing;
   beat 3 reuses already-clamped rounds. CLEAR.
6. **Work-seize precedence untouched.** The summon-seize block is unchanged and above all idle stepping; it clears
   `'post'`/`'rounds'`; decideIdle (beats 2+3) only runs on `activity==='idle'`. CLEAR.

### Verification (honest limits — same as D1-D4)
`node --check` clean; full `npm run test:fast` green incl. `lint-determinism` + `lint-emits` + `zones.test` +
`social-border.test`. **Residual/unverifiable:** the canvas FSM is not headless-testable (rAF pauses in a
backgrounded tab — the plan's honest-limits section); the role-beats are code-review + RNG-order verified. Seeing
them (the supervisor glance behind a working crew body; the board survey when the queue fills; the idle drift toward
the work) needs an attended foreground `?dev` soak with ≥1 summoned+working crew body sharing the hero's zone AND a
non-empty quest queue — deferred to an attended check.
