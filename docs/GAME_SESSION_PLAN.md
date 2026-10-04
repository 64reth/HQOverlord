# THE GAME SESSION — Gameplay Master Plan

> Working contract for the "Game" session (started 2026-07-01). Companion to
> `docs/GAME_WIRING_AUDIT_2026-07-01.md` (the gap evidence). This doc is the
> DESIGN + BUILD ORDER; the audit is the WHY. Re-grep before acting on any
> file:line — code moves.

---

## PART 1 — The goals of the gameplay (distilled from every locked decision)

These five goals are the test for every feature. If a proposal doesn't serve one,
cut it.

1. **A beginner reaches real value faster than any harness.**
   The game IS the onboarding. the reference harness makes you figure out what an agent is for;
   StarNet's station teaches by building. (Locked: easier-than-the reference harness moat.)

2. **The value flow is reversed.**
   The agent figures out the Commander — dossier → First Pitch → ongoing ideas →
   seeds. The user should never face a blank prompt wondering what agents are for.
   (Locked: First Pitch keystone, 2026-06-27.)

3. **Everything visible is true; everything true is visible.**
   First half is law today (desk trips fire on real tool use, HUD stats are honest
   counts). Second half is the debt the audit documented (~60% of real activity
   invisible). No fake timers, no invented progress, ever. (Locked: truthful
   telemetry; recurring "app lies" sin.)

4. **Building the station = building real capability.**
   Object=capability. Placing a dish literally grants web tools. The Factorio
   build-loop with real stakes: your factory layout is your permission system.
   (Locked: prop gates; sandbox/no-gating — props suggest, never block creativity.)

5. **The station is alive and pulls you back honestly.**
   Real async work means the return loop can be genuine: overnight routines
   produce real deliverables to collect; a blocked agent really is waiting for
   you. Eerie-not-cute. (Locked: autonomy layer; Clash-pride + Thronglets thesis.)

### The four nested loops (what "addictive" means here, concretely)

| Loop | Cadence | The pull | Status |
|---|---|---|---|
| **Watch** | minutes | give task → SEE the agent visibly work (walk, tool-props firing, progress) → deliverable rides the belt → rate it | half-built: walk is real, work is illegible |
| **Build** | session | quest suggests next capability gap → place prop / wire belt → agent can genuinely do more → new pitch uses it | props work; quests don't drive it |
| **Return** | daily | reopen app → digest + OUTBOX crates → collect/rate each → XP/confidence/memory all advance → new idea pitched | missing entirely |
| **Meta** | weekly | seeds accumulate → routines run the factory unattended → trophies/lifetime stats grow → station postcard to share | stats exist (now-only); no trophies, no share |

The genius constraint: **rating collected work is the "collect tap"** — one action
feeds XP (leveling is locked to feedback-on-real-work), confidence, and memory
turn-in at once. We never need fake rewards; the loops already interlock.

---

## PART 2 — The gameplay, layer by layer (ground up)

Each layer only consumes the layers below it. Build/fix in this order and nothing
gets confused.

### Layer 0 — TRUTH SUBSTRATE (events)
*One SSE stream + U.bus. Already sound. The rule going forward:*
**no visual without a signal; no signal without a visual.**
- Every event in `shared/events.js` must have a consumer or a documented
  "intentionally quiet" note (like checkpoint.created has).
- `shared/events.js` is OWNED by the cortex-memory workstream, additive-only.
  New events this plan needs (quest.*, digest.*, outbox.*) get REQUESTED from the
  owner, never edited directly.
- Dead contract entries (`object.place/reclaim`) either get emitted or annotated.

### Layer 1 — THE BODY (agent presence)
*The sprite is the model. Its behavior must be legible truth.*
- ✅ have: reactive desk trip, settle→work→stand, zones, gaze beats, nameplates.
- BUILD: per-tool prop activation (cabinet/dish/notebook/studio pulse from the
  already-arriving `agent.tool_call` — world.js:2771 handler extension);
  desk progress bar (t.prog/t.dur); token-driven screen flicker; error distress
  state; **blocked-awaiting-approval = agent walks to the airlock and WAITS**;
  empty-room honesty (dark screens + "I need a computer here").
- LATER: Meeseeks sprites for real sub-agent fan-out (backend merged already).

### Layer 2 — THE STATION (infrastructure = capability)
*The factory floor. Every functional prop maps to a real subsystem.*
- ✅ have: capability registry (computer/notebook/cabinet/dish/workbench/studio/
  jukebox/connector/orchestrator), conveyors with cost-scaled cargo, queue gauge.
- BUILD (new functional props — separate category from cosmetics, per the
  workstation-model decision):
  - **MISSION BOARD** — the quest log's body (Layer 4 lives here). Routines are
    pinned to it; agents walk to it to pin proposals (Layer 5).
  - **POWER METER** — budget/spend made physical; depletes as cost accrues,
    alarms at budget.threshold (currently audio-only).
  - **INBOX / COMMS console** — channel.inbound gets an unread badge + dish pulse.
  - **OUTBOX / delivery pallet** — where while-away deliverables physically stack.
  - **TROPHY CASE** — milestones made permanent and visible.
  - **ARCHIVE shelf** (later) — memory/skills made browsable in-world.
- RULE: cosmetic props stay ungated and free (sandbox law). Functional props are
  the only capability surface.

### Layer 3 — THE RELATIONSHIP (progression between user and agent)
*The agent figures YOU out; trust is earned with real feedback.*
- ✅ have: dossier/interview/curiosity, XP-from-feedback engine, confidence EWMA,
  turn-in beats, anti-nag beat slot (turn-in > rate > idea > curiosity).
- BUILD: standalone rate-the-work fallback (control must never starve);
  task-size-weighted XP (locked leveling-redesign TODO); confidence narrative
  beats ("I'm calibrating" at start, a warm moment at TRUSTED 85%); belief
  edit/delete UI; the memory/question overhaul Tier 1-3 (persisted
  asked/proposed/rejected state — already designed, locked 2026-06-29).
- LAW: XP mints ONLY from user feedback on built work. Quests/trophies never
  inflate XP. (Locked leveling redesign.)

### Layer 4 — THE QUESTS (direction) ← the flagged rebuild
*The quest log becomes the central "what's next" surface. Today it's a passive
projection; it becomes a GENERATIVE system fed by real signals.*

**The honest-quest contract (non-negotiable):**
1. A quest is a projection of a REAL gap or REAL opportunity — never invented
   busywork, never time-gated.
2. Completing a quest means the real thing actually happened (prop placed, belief
   saved, routine ran, feedback given). No "claim" buttons divorced from reality.
3. The reward IS the real consequence: capability unlocked, trophy entry, world
   change. Plus celebration (sound + flourish) — currently everything is silent.
4. Quests suggest, never block. The whole log is optional pull, not push; the
   beat slot remains the ONLY push channel (one ask per task, anti-nag).

**Quest taxonomy (generators → the six quest types):**
| Type | Generator (real signal) | Example | Exists today? |
|---|---|---|---|
| **Station quests** | `capdenied` + capability-gap detection: agent tried a tool its room can't grant | "NOVA reached for the web — place a DISH in her bay" | ❌ (capdenied is audio-only; the audit's silent-fail gap becomes a quest generator) |
| **Context quests** | blank dossier dims (+ memory-overhaul asked/rejected state) | "Tell the station your goals" | ✅ basic (7 dims, no state persistence) |
| **Work quests** | pitches/suggestions/seeds accepted → multi-step quest with real progress | "Build the morning-brief routine — 2 steps left" | 🟡 one vanishing "idea waiting" card |
| **Milestone quests** | Xp.milestones() | WORKHORSE: 25 tasks | ✅ but silent completion, no trophy case |
| **Maintenance quests** | slag post-mortems, budget.threshold, cron.skipped backlog, queue depth | "3 runs died on max_iters — split the task or raise the budget" | ❌ (slaglog diagnoses exist, go nowhere) |
| **Onboarding quests** | first-run kit-out tour glow-goals | "Place your first workstation" | ✅ (tutorial) — fold its goal-loop pattern into the same log |

**Quest UX:** MISSION BOARD prop (click → quest log), glow-driven targets (reuse
the kit-out tour's proven pattern — never hardcode prop labels, resolve from live
catalog), completion celebration (SFX + gold flourish + trophy-case entry where
applicable), and quest chaining (a completed station quest can surface the work
quest it unblocked: "the dish is live — want NOVA to build the price-watcher?").

### Layer 5 — THE LIVING STATION (return loop + autonomy embodiment)
*What happens between sessions, and how it greets you.*
- ✅ have: autonomy Initiative×Reach through B4 (real writes, undo, TG/Discord
  ping), cron engine, channels, autojobs proposals.
- BUILD: **while-you-were-away digest** (one beat, anti-nag, beat-slot compliant)
  + **OUTBOX crates** as the physical evidence (one crate per unattended run
  that produced work; click → review → rate = collect); cron SUCCESS visibility
  (only failures toast today); cron.skipped/tick surfaced on the MISSION BOARD
  (backlogged routine = visible jam, pure Factorio); channel arrivals badge the
  INBOX; autojob proposals get a body (agent pins a card to the MISSION BOARD
  instead of a settings toggle appearing).

### Layer 6 — PRIDE & SPECTACLE (the meta loop + GTM)
- ✅ have: honest floor HUD (now-only), cost-scaled cargo.
- BUILD: lifetime counters (tasks shipped, deliverables, routines run, streaks) —
  durable, station-level; TROPHY CASE rendering milestones; seed-reuse callouts
  ("the seed you saved ran 5× this week"); later: station postcard export /
  shareable clips (GTM: spectacle = growth engine; ship shareable by default).

---

## PART 3 — Build order (phases = worktree lanes)

Ground-up: each phase consumes only earlier phases. Protocol per CLAUDE.md:
one agent per worktree, additive-only on shared contract, `npm run test:fast`
green before merge, runtime-verify via dev-seed headless (workforce-zones
precedent).

Every phase is judged by a **MOVIE TEST**: one demoable scene that must feel
right end-to-end (proven via the headless screenshot harness), not a list of
merged wires. If a wire doesn't serve the phase's scene, it moves to a later
phase. Polish lives in coherence, not coverage.

### Phase G0 — "Watch one task happen" (Layer 0+1 cheap wires) — days
**Movie test:** a single directive, filmed start to finish, is legible and juicy —
walk to desk → per-tool prop fires → progress visible → completion celebration →
crate rides the belt. All existing events, no new contract entries:
1. Per-tool prop pulses (extend world.js:2771 filter past `mcp__*`).
2. Desk progress bar + token flicker.
3. capdenied + budget.threshold + channel.inbound get visuals (power meter can
   be HUD-first, prop later).
4. Empty-room honesty; run-error distress; cron-success toast; merge shimmer.

### Phase G1 — Quest engine rebuild (Layer 4) — SLICED, not big-bang
Runs as a lane PARALLEL to G2 after G0 merges.
- **G1a** — durable quest state (open/done/dismissed + timestamps; dismissed =
  never re-fires, per the ignore→stop-forever decision) + completion celebration
  on the EXISTING quests (SFX + flourish). Cheap, immediate feel-win.
  **Movie test:** finish a dossier quest → the log visibly celebrates.
- **G1b** — the killer generator: capdenied→station quest + MISSION BOARD prop +
  glow-targets. **Movie test:** agent reaches for the web in a dish-less room →
  a quest appears on the board → placing the dish completes it → agent retries
  and succeeds.
- **G1c** — remaining generators (slaglog→maintenance, pitch/seed→work
  multi-step, quest chaining) + fold milestone/dossier/onboarding into the log.
- Contract asks to events owner: `quest.new`, `quest.complete` (additive).
- Gate: quests.test.js extended; every generator unit-tested; no XP minting
  from quests (assert in test).

### Phase G2 — Return ritual (Layer 5 core) — PARALLEL lane to G1
Dependency check: OUTBOX + digest do NOT need the MISSION BOARD — retention is
too valuable to sequence behind the quest rebuild. (cron.skipped jam states are
the one piece that waits for G1b's board.)
1. While-away digest beat (fires once when unattended work exists since last
   session; queues behind beat slot rules).
2. OUTBOX prop + crate-per-run + click-to-review-to-rate collect flow.
3. Standalone rate-the-work fallback + task-size weighting (closes the locked
   leveling-redesign TODO).
**Movie test:** simulated overnight run in dev-seed → reopen → crates stacked on
the OUTBOX, digest beat fires once, rating a crate advances XP/confidence/memory.

### Phase G3 — Pride layer (Layer 6)
Trophy case prop, lifetime counters store, seed-reuse callouts, confidence
narrative beats, quest/idea/seed celebration SFX (audio.js additions).
**Movie test:** a milestone lands in the trophy case with sound; the station
shows lifetime tasks shipped.

### Phase G4 — Embodiment (Layer 1 deep)
Approval walk-and-wait (permission.prompt → sprite behavior), autojob
pin-to-board, Meeseeks sub-agent sprite layer (backend merged, frontend from
scratch). **Movie test:** an agent hits a permission gate → walks to the airlock
and waits → user approves → it returns to work.

### Phase G5 — Spectacle (later, GTM)
Station postcard export; clip capture. Not this session unless G0-G2 land fast.

### Sequencing rationale
G0 first because every later layer renders through those same signals — and G0
IS the spectacle foundation (legible floor = clippable floor). G1 and G2 then run
as PARALLEL worktree lanes (retention and direction are independent value
streams). G3/G4 parallelize once G1a merges.

### Deliberate cuts (this session)
Named so they don't silently vanish: model-identity on sprites (sprite doesn't
yet reflect WHICH model), ARCHIVE shelf (browsable in-world memory), marketplace.
**And one scope boundary:** beginner first-10-minutes / zero-to-value (the
strategic audit's #1 miss) is NOT this session — the quest onboarding fold-in
helps, but the day-1 experience deserves its own session immediately after
(day-2 return mechanics are worthless if day-1 doesn't land).

---

## PART 4 — Consistency laws (so nothing gets confused)

1. **XP law:** only user feedback on built work mints XP. Ever.
2. **Beat law:** one post-run ask, serialized (turn-in > rate > idea > seed >
   curiosity > digest joins this priority list — decide exact slot in G2).
3. **Honesty law:** no visual without a signal; no signal without a visual (or a
   documented quiet-by-design note).
4. **Sandbox law:** nothing creative is ever gated. Functional props gate tools;
   cosmetics are free; quests only suggest.
5. **Contract law:** shared/events.js + shared/schema.js additive-only, via owner.
6. **Anti-nag law:** dismissed = stop forever (quests, questions, proposals alike).
7. **Aesthetic law:** eerie-not-cute; VT323 + phosphor on canvas text; tiny
   nameplates never windows; bold effects not subtle (CRT lab values).
8. **Verification law:** nothing is "done" until seen running — headless
   screenshot or dev-seed runtime proof per feature.
