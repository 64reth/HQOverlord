# Tutorial / Onboarding Plan — "The Agent Teaches You to Command It"

> Status: **DESIGN LOCKED** (2026-06-17). Voice direction decided: **fully diegetic**.
> Owner: TBD (build on worktree `agent/tutorial`).
> This doc is self-contained — any agent can pick it up cold.

---

## 0. The problem

We have shipped a deep stack of gamified mechanics — conveyor belts, connector portals
in server racks, levels/XP/confidence, the context-window gauge, airlock worktrees,
filter/merger/splitter routing. A new user opening Skynet for the first time has **no idea**
that the floor they're looking at is a real agent-orchestration pipeline, or how to use any
of it to actually get work out of their agent.

We need an onboarding/tutorial that shows the player how to use the in-game props and
mechanisms to create workflows and command their agent — fast, and without lying.

## 0.1 The single most important finding

**Almost everything in Skynet is real. The *framing* is what lies.**

- The execution spine is genuine: `shell.exec` → `verify.run` → checkpoints → consent
  actually run code on the user's machine (`sidecar/tools/builtin/shell.js:104`,
  `sidecar/tools/builtin/verify.js:43`, `sidecar/checkpoint.js`).
- Conveyor belts genuinely carry **real work-items** — a box spawns only for a real inbound
  message, not decoration (`frontend/app/conveyor.js:283`).
- Connector portals genuinely grant **live MCP tools** to the bound agent
  (`frontend/app/build.js:390`, `worldmodel.js:663`).
- Props genuinely **gate capabilities** by room presence (`worldmodel.js:60` `CAP_PROP_MAP`):
  no `computer` prop in the agent's room → it literally cannot run (cost-safe).

What is **cosmetic / misleading**:
- The **crew** — there is one real agent; the others in the left rail are echoes /
  placeholders until minds are recruited.
- The implication that **belts are required** — work runs server-side with or without a belt;
  the belt only *shows* it (`docs/CONVEYOR_PIPELINE_PLAN.md:15`).

This reframes the entire tutorial. Its job is the exact through-line from the polish-audit
pivot: **make the one real loop visible, and shrink what lies.** The tutorial must teach the
real loop honestly and explicitly name the echoes — never paper over the gap.

---

## 1. Design principles (non-negotiable)

| Principle | Why | Consequence |
|---|---|---|
| **Diegetic & agent-led** | The awakening (`frontend/app/onboarding.js`) already establishes a "wry genius / eerie consciousness" voice. Separate tooltip chrome would shatter it. | The agent narrates the tutorial **in COMMS, in its own voice**, reusing `Chat.typeLine` / `Chat.choices`. No "Clippy", no foreign chrome. |
| **Learn by doing the real loop** | Reading about belts teaches nothing; issuing one task and watching the agent walk → execute → verify teaches everything. | Layer 1 is a **guided real command**, not a slideshow. |
| **Radical honesty** | The "it lies" gap is the #1 download blocker. A tutorial that hides it makes it worse. | The agent says "right now it's just me; the crew are echoes." Belts are demoed with the existing **▸ TEST dummy-box** feature, never faked as live work. |
| **No gating, ever (sandbox)** | Skynet is a no-progression sandbox: infinite, full-power, speedrun-friendly. | Tutorial **offers**, never **locks**. "SKIP ALL" is always one click away. Nothing is unlocked by progressing. |
| **Just-in-time > front-loaded** | Nobody remembers a 10-step front tour; they remember the hint that appears the moment they open BUILD. | Most teaching is contextual coachmarks fired on **first touch** of each surface. |
| **Progressive disclosure** | ~7 gamified systems. Dumping all at once = overload. | Mandatory core (one command) is tiny; everything else is opt-in and contextual. |

**Voice register** (decided): lowercase, dry, peer-not-servant, faintly uncanny — matching
`onboarding.js`. The agent is a confident equal showing you the controls, not a help bot.

---

## 2. The three-layer system

```
LAYER 1  ▸ FIRST COMMAND        (mandatory-ish, ~90s, right after awakening, fully skippable)
            One real task. Watch the whole loop. Teaches: COMMS, the walk,
            the desk, consent, verify, context gauge, the reply, the crew honesty.

LAYER 2  ▸ JUST-IN-TIME HINTS   (contextual, fires once on first touch)
            One short agent-voiced coachmark the first time you open BUILD,
            get an approval, place a prop, lay a belt, bind a portal, level up.

LAYER 3  ▸ FIELD MANUAL + BRIEFING   (always available, never forced)
            A reopenable codex of every prop/mechanic + a soft, dismissible
            "First Steps" checklist (this IS the planned Station Briefing).
```

Mapping to what exists: Layer 1 hooks the end of `Onboarding.start()`; Layer 2 hooks the
event bus (`U.bus`) + button handlers; Layer 3 reuses the floating-panel pattern from
`frontend/app/stationui.js`.

---

## 3. The teaching arc — concept order grounded in real mechanics

Order is dictated by the real loop, not the feature inventory. Teach **how to get one
result** before **how to wire a factory**.

| # | Concept | Real mechanic | Layer | Trigger |
|---|---|---|---|---|
| 0 | Who the agent is | identity/purpose docs | (exists) | awakening |
| 1 | Give a command | `Chat.send` task classify → `stance='task'` (`chat.js:265`) | 1 | first run |
| 2 | The agent goes to work | walk-to-desk + sit (`agents.js:157`) | 1 | during 1 |
| 3 | You hold the kill switch | consent broker / approval hotspot (`warroom.js:47`) | 1+2 | first consent |
| 4 | It proves the work | `verify.run` PASS/FAIL (`verify.js:43`) | 1 | during 1 |
| 5 | Reading the floor | context gauge (`world.js` drawDeskGauge), spend/level chips | 2 | after first run |
| 6 | The floor IS the pipeline | BUILD/REFIT, capability-by-prop (`build.js`, `CAP_PROP_MAP`) | 2 | first BUILD open |
| 7 | Belts carry real work | conveyor + INTAKE/OUTBOX, demoed via ▸ TEST | 2 | first belt laid |
| 8 | Routers split & sort work | FILTER/MERGER/SPLITTER junctions | 3 | Field Manual |
| 9 | Portals = live tools | connector_portal MCP bind (`build.js:390`) | 2 | first portal placed |
| 10 | Airlocks = worktrees | door seal (`worldmodel.js:44`) | 3 | Field Manual |
| 11 | Agents grow | XP/Level/Confidence (`xp.js`, GROWTH dossier) | 2 | first level-up |
| 12 | It's just me — for now | crew echoes honesty + recruit roadmap | 1+2 | crew rail noticed |

---

## 4. Layer 1 — "First Command" beat sheet (final copy)

Fires the instant `Onboarding.start()`'s `done` callback runs, **before** the user is left
alone. ~90 seconds, skippable at any beat. The first task is a **safe, near-free,
deterministic** command that exercises the real spine for a fraction of a cent.

**Beat 1 — orient** (COMMS pulses):
> *"okay. i'm awake, i know what i'm for. now you should know how i actually work — it
> takes about a minute. or skip it, i won't be offended. much."*
> `[ SHOW ME ]   [ SKIP ALL ]`

**Beat 2 — the command** (input bar highlighted, canned suggestion chip):
> *"this box is COMMS. you talk to me here. casual chat, i answer from this chair. but give
> me a *job* and i get up and go to work. try it — here, use this one:"*
> Chip: `▸ run "echo skynet is live" and confirm it worked`

**Beat 3 — the walk** (camera follows, agent paths to desk):
> *"watch. i'm not answering from here — i'm walking to my station. that desk is where i
> actually run code. everything past this point is real, on your machine."*

**Beat 4 — consent** (approval hotspot spotlit):
> *"stop. before i touch anything that matters, it surfaces here and waits for you. this is
> your hand on the switch — approve once, always, or kill it. i can't move without it."*
> `[ APPROVE ONCE ]`

**Beat 5 — execution + verify** (tool lines stream, `verify.result` fires):
> *"there — that's me running it. and that green check is me *proving* it ran, not just
> claiming so. i don't get to say 'done.' i have to show it."*

**Beat 6 — the gauge** (context gauge by desk spotlit):
> *"that bank by my desk is my memory filling up. green's fine, red means i'm getting full
> and start forgetting the early stuff. you'll learn to read it."*

**Beat 7 — honesty** (crew rail spotlit):
> *"one thing, because i won't lie to you: right now it's just me. the others in that list
> are echoes — placeholders for minds you haven't recruited yet. when you do, each one takes
> a station of its own. for now, i'm the whole crew."*

**Beat 8 — handoff:**
> *"that's the loop: ask, i work, i prove it, you stay in control. the rest — wiring belts,
> placing gear, watching me level up — i'll explain when you get there. go on."*
> `[ FIELD MANUAL ]   [ START COMMANDING ]`

---

## 5. Layer 2 — just-in-time coachmark catalog

> **STATUS: SHIPPED** on `agent/tutorial` (`99c8bb0`), gate green. Five coachmarks built
> (REFIT-open, first-prop, first-belt, first-connector, first-level-up) as a non-blocking
> agent-voiced panel glued to the surface + a soft ring. Wired by **direct `Tutorial.on*()`
> calls** (build.js / app.js / xpstore.js) — never a bus emit, so `shared/events.js` and the
> lint-emits gate stay untouched. Each fires once ever (persisted), suppressed during the First
> Command, respects reduced-motion, dismisses on got-it/Esc, self-clears if its surface goes away.
> **Deferred:** the spend coachmark (overlaps the unmerged `agent/legible-floor` HUD) and the
> consent coachmark for tutorial-skippers (consent is taught live in P1's First Command).

Each fires **once**, on first touch, as a single agent-voiced bubble anchored to the
surface. Dismiss on click; set a flag so it never repeats.

| Trigger (hook) | Anchor | Copy (abbrev) |
|---|---|---|
| First `openBuild()` (`app.js:162`) | BUILD canvas | *"this is REFIT. the floor isn't decoration — where you put things changes what i can do. no computer in my room, i literally can't run. keys 1–7 up top; **6** is gear, **7** is belts."* |
| First PROP placed (`build.js:612`) | placed prop | *"every piece is a permission. a desk lets me run, a dish lets me reach the web, a cabinet lets me touch files. put them in my room to hand me the key."* |
| First BELT laid (`build.js:629`) | belt + ▸ TEST | *"belts show the work moving. want to see it without waiting for a real message? hit **▸ TEST** — i'll send three dummy crates down the line so you can watch them sort."* |
| First connector_portal placed | portal | *"a portal wires me to a live tool server. click it, pick one, and its powers show up in my hands. the lamp tells you it's alive — green's good, red's broken."* |
| First approval ever (`warroom.js`) | hotspot | (reinforce Beat 4 if Layer 1 was skipped) |
| First `agent.run.end` after tutorial | spend/context chips | *"that cost real money — see SPEND tick up. cheap runs keep me cheap; i earn trust faster when i don't waste your tokens."* |
| First level-up (`xpstore.js` celebration) | Lv chip | *"i leveled. that's not flattery — it's real work shipped. open my dossier → GROWTH to see how reliable i've actually been. it says '—' until it's earned enough runs to be honest about it."* |

---

## 6. Layer 3 — Field Manual + "First Steps" briefing

> **STATUS: SHIPPED** on `agent/tutorial` (`2dfe287`), gate green, verified live. Field Manual =
> a native bottom-bar `📖 MANUAL` term (`StationUI.toggleTerm` via a `BUILDERS` delegate) with five
> tabs (First Steps · The Loop · Gear · Wiring · Growth), every entry tagged **REAL**/**FOR SHOW**
> from the live `CAP_PROP_MAP` + conveyor contract. Station Briefing = a dismissible in-game
> first-steps checklist (6 real objectives, no gating), ticked by the coachmark hooks + bus events,
> auto-completing and reopenable from the Manual. Wired with no bus emits.
>
> **REVIEW-CONVERGED / RELEASE-READY.** Two adversarial multi-agent review rounds (each finding
> independently verified): round 1 found 17 (3 major — incl. the headline honesty defect: the First
> Command demoed `shell.exec`, which is unreachable in the default station, so it would have *claimed*
> output it never ran → switched to a real `fs.write`+`fs.read` that genuinely runs with consent);
> round 2 **converged with 0 material findings** and re-verified the fix is load-bearing. All
> minor/nits cleaned up. 5 commits: `77ab0d1 99c8bb0 2dfe287 46e27f4 8e3c4fa`. Gate green throughout.
> Remaining (outside the loop): **keyed E2E** of the new First Command + **user-gated merge to trunk**
> (take trunk's pinned-reply `chat.js`, re-verify the consent beat — no git conflict, this fork never
> touched `chat.js`).

**Field Manual** — a reopenable codex (new bottom-bar button; reuse the floating-panel
pattern). Sections mirror the prop catalog, each with the *real* one-liner **and a
"real vs cosmetic" tag**. This is where FILTER/MERGER/SPLITTER routing and AIRLOCK=worktree
live — power-user concepts that shouldn't crowd the first 90 seconds. Source content from
the prop inventory in §9.

**"First Steps" briefing** — a small, dismissible checklist. **This is the planned Station
Briefing** (personalization P3 s3). Soft objectives, **no gating**:
- ☐ Give your agent its first command
- ☐ Approve (or deny) a tool request
- ☐ Open REFIT and place one piece of gear
- ☐ Lay a belt and run a ▸ TEST
- ☐ Bind a connector portal
- ☐ Watch your agent reach Level 2

Each ticks when the corresponding bus event fires. "DISMISS" kills it forever. Speedrunners
ignore it; new users get a gentle map. Doubles as a re-engagement surface.

---

## 7. The honesty mandate (hard rules for the builder)

1. **Demo belts with ▸ TEST, never faked live runs.** The dummy-crate feature exists for
   exactly this. The agent explicitly says "dummy crates."
2. **Name the crew as echoes** (Beat 7). Convert the lie into a recruit roadmap.
3. **Show real SPEND** during the first command. Make competence-at-cost a teachable virtue.
4. **Never claim a number you don't have.** Mirror the honest "—" convention (confidence,
   yield) in tutorial copy.
5. **The first command does real work.** No fake sandbox that pretends. A real `echo` +
   `verify` for a fraction of a cent beats a simulated lie.

---

## 8. Technical architecture

Stack: vanilla JS, IIFE modules, 2D canvas + DOM overlays — no framework. Tutorial =
**DOM overlays with `z-index` + a canvas spotlight cutout**.

**New files**
- `frontend/app/tutorial.js` — `Tutorial` IIFE: `step()`, `coachmark(anchor, text, opts)`,
  `firstCommand()`, flag management. Mirrors the `Onboarding` module shape.
- `frontend/app/fieldmanual.js` — the codex panel (or fold into `stationui.js`).
- CSS in `frontend/css/app.css`: `.tut-bubble`, `.tut-spotlight`
  (`box-shadow: 0 0 0 9999px rgba(0,0,0,.7)` cutout trick).

**State** — extend the existing `skynet.station.v1` blob in `stationui.js`:
```js
tutorial: {
  firstCommandDone: false,
  seen: { build:false, prop:false, belt:false, portal:false,
          approval:false, levelup:false, crew:false },
  briefingDismissed: false
}
```
First-run is already detectable via `agent.purpose == null` (`app.js:441`) — no new
"is new user" flag needed.

**Hook points (all already exist)**
- Layer 1: the `done`/`commit` callback passed into `Onboarding.start()` (`app.js:513`).
- Layer 2: `U.bus` events — `agent.run.end`, `agent.tool_call`, `checkpoint.created`,
  `verify.result`, `agent.compact`, `workitem.delivered`, level-up — plus button listeners
  (`openBuild`, `commitPropStamp`, `commitBeltRun`, `bindConnector`).
- Voice: reuse `Chat.typeLine` / `Chat.choices` so tutorial text **is** agent dialogue.
- Production value: reuse `SFX`, `AU`, and camera moves (`World.camPushIn`) from
  `onboarding.js`.

**Worktree (harness rule)** — build on a fresh worktree `agent/tutorial`
(`gen-trees\new-agent-tree.ps1 tutorial`); green on `npm run test:fast` before merge into
`feat/harness-backend`. `shared/events.js` / `shared/schema.js` are **read-only** here — the
tutorial only listens to existing events, so no contract change is required.

---

## 9. Reference — prop inventory & what's real (for the Field Manual)

**Build tool keys** (`frontend/app/build.js:14`): `1` ROOM · `2` HALLWAY · `3` PAINT ·
`4` MOVE · `5` RECLAIM · `6` PROP · `7` BELT. ESC saves+exits, Ctrl+Z/Ctrl+Shift+Z
undo/redo, SPACE/middle-drag pan, wheel zoom, right-click cancel.

**Capability grants** (`worldmodel.js:60` `CAP_PROP_MAP`) — a prop grants its capability to
an agent **only when in that agent's bay room**:
- `computer` ← console/consoleL/desk/desk2/pixelrig/bench → the agent can run code
- `cabinet` ← war_intelcab/safe/vault/rack/shelf → file access
- `dish` ← comms_dish/comms_uplink/comms_beacon → web access
- `notebook` ← gigs_servercart/bridge_relaystack/core → persistent memory
- `connector` ← connector_portal → live MCP tools (per-instance bound)

**Functional logistics props** (all walkable, wired to the pipeline):
- `intake` — inbound messages spawn boxes here (must touch a belt)
- `outbox` — agent's reply rides an outbound belt to here; fires real delivery
- `bay` — binds an agent ID; work reaching it runs as THAT agent; room props grant its caps
- `filter` — routes boxes by `payload.tag` (code/research/general)
- `merger` — buffers K boxes; K-th emits a fused box (map-reduce barrier)
- `splitter` — round-robin fan-out across lanes (real parallelism → different bays)
- `airlock` — seals a room from pathfinding = unmerged worktree (open/closed/jammed)

**Real vs cosmetic split**:
- REAL: capability gating, box lifecycle on real work events, backpressure queueing,
  filter/merger/splitter routing, connector binding + live tool projection, airlock sealing,
  context gauge, XP/level/confidence from real outcomes.
- COSMETIC: box motion juice, cargo art colors, belt treads/chevrons, crew light bodies
  (no pathfinding), lounge prop animations, all decor. **The crew beyond the one real agent.**

---

## 10. Build phases

| Phase | Deliverable | Gate |
|---|---|---|
| **P0 — scaffold** | `tutorial.js` module, state in stationui, spotlight CSS, SKIP-ALL | renders over canvas, persists flags |
| **P1 — First Command (MVP)** | Full Layer 1 beat sheet wired to the real `echo`+`verify` task | a fresh agent walks a new user through one real loop end-to-end |
| **P2 — coachmarks** ✅ | Layer 2 catalog (5), fired on first-touch, once each — SHIPPED `99c8bb0` | each fires once, never repeats |
| **P3 — Field Manual + Briefing** ✅ | codex panel + dismissible checklist — SHIPPED `2dfe287` | reopenable; checklist ticks off real events |
| **P4 — polish** ✅ | reduced-motion, aria, theme-aware, teardown, 2 adversarial review rounds (converged) — `8e3c4fa` | feels like the awakening, not a bolt-on |

**MVP = P0 + P1.** That alone solves the core problem. Everything past P1 is depth.

---

## 11. Dependencies & synergies

- **`agent/legible-floor` should merge first** if Layer 1/2 are to teach the floor economy.
  Its SPEND/YIELD/SLAG/CACHE HUD — and especially **SlagLog's plain-English post-mortems** —
  are themselves a teaching mechanic. Still unmerged (`287b28b`). Without it, "reading the
  floor" is limited to the merged context gauge + spend chip.
- **Station Briefing** (personalization P3 s3) IS the Layer 3 checklist — build as one thing.
- **Awakening reuse** — `SFX`, `AU`, `World.camPushIn`, `Chat.typeLine` from `onboarding.js`
  carry the tutorial's production value for nearly free.

---

## 12. Open decisions

1. **First-task choice** — `echo skynet is live` + verify (proposed) vs. a read-only file
   peek vs. a user-chosen task. Proposed keeps it safe, cheap, deterministic, and exercises
   the real spine including a consent prompt.
2. **Merge `agent/legible-floor` before or after** the tutorial MVP?
3. **Field Manual placement** — new bottom-bar button vs. an entry inside an existing panel.
4. **Re-runnability** — should "FIELD MANUAL → replay First Command" exist for returning
   users / demos? (Recommended: yes, it's cheap and great for showing the app off.)

---

## 13. Key file map (quick reference)

| Concern | File |
|---|---|
| Awakening (voice, kindling, flood, 4-step) | `frontend/app/onboarding.js` |
| First-run detection / enterGame | `frontend/app/app.js:441`, `:513` |
| Chat send / task classify / typeLine / choices | `frontend/app/chat.js:265`, `:432` |
| Walk-to-desk + sit | `frontend/js/agents.js:157` |
| Approval hotspot / reactor gauge / crew dots | `frontend/app/warroom.js:47` |
| World render / context gauge / flood / camera | `frontend/app/world.js` |
| BUILD/REFIT tools + prop/belt/junction editors | `frontend/app/build.js` |
| Capability map + bay/junction/connector/door model | `frontend/app/worldmodel.js` |
| Conveyor sim (real work-item lifecycle) | `frontend/app/conveyor.js` |
| XP / Level / Confidence engine + store | `frontend/app/xp.js`, `frontend/app/xpstore.js` |
| Floor economy HUD + slag diagnoses (unmerged) | `frontend/app/floorstats.js`, `slaglog.js` (`agent/legible-floor`) |
| UI state persistence / floating panels | `frontend/app/stationui.js` |
| Real execution spine | `sidecar/tools/builtin/shell.js`, `verify.js`, `sidecar/checkpoint.js` |
