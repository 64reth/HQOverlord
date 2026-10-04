# HANDOFF — the IDLE LIFE lane (agent behaviour while not working)

Written 2026-08-08 by the outgoing session. Self-contained: everything you need is here or pointed
at. Read `docs/BRAIN.md` for project orientation and `CLAUDE.md` for the multi-agent protocol first;
the mandatory skills in `.claude/skills/` (start with `starnet-task-doctrine`) still apply to you.

**Status: built, gate-green, UNMERGED. It is a taste call and Andrew is the judge.**

- Branch `agent/idle-life`, worktree `C:\Users\andro\gen-trees\idle-life` (forked from
  `feat/harness-backend` at `666a2a2d`).
- `npm run test:fast` → **584/584 green** at HEAD. Claims surface re-locked (last: after the gesture
  removal). Website mirror synced (`npm run sync:website`).
- ⛔ A fresh worktree has **no `node_modules`** — `npm install` first.

## What the lane is for

Andrew's ask, verbatim at the start: make the agent read as *"a curious character / sentient being
living inside StarNet"* while **idle** — it should not stare at walls, it should be curious about
props, be able to leave its desk area, and appear to interact with other agents. **Working is
explicitly out of scope and untouched** ("when an agent is working is currently perfect").

Everything below is in `frontend/app/world.js` unless stated. That file is the idle engine; it is
~7k lines and heavily commented — the comments are the design record, read them before changing a
constant.

## What shipped (in commit order)

| Commit | What |
| --- | --- |
| `24870ec1` | W1 subject-facing · W2 per-prop beats · W3 roam radius |
| `28127df1` | W4 greet / turn-taking / wave, D3 social lane 5–8min → 90–150s |
| `7ec156a4` | reduce-motion gate |
| `76b48cfd` | soak instrument: encounter timeline + starvation guard |
| `dd753de5` | `social-border` source lock pinned to the property, not the literal |
| `4851c5ef` | **LF line-ending repair** (see traps) |
| `699a9024` | the LOUNGE round: entertainment drive, weighted choice, bar stools, spawn welcome |
| `ade33181` | **removed the gesture-as-interaction misuse** (Andrew's last call) |

### 1. Subject-facing (no more wall-stare)
`lookDirFrom` / `lookScore` / `lookDir` ray-march each cardinal and score what is in the line of
sight (another body > belt > prop > doorway > open depth); a wall at the nose scores ~0. The winner
is weighted-random. `planGazeOut` (which walked to the room EDGE and faced OUTWARD) became
`planVantage`; `quirkFaceWall` became `quirkDoorway`. Vigil/ponder/listen/lookAround/revisit and the
plain-stroll arrival all route through it.

### 2. Per-prop beats — `USE_BEAT`
Keyed by the catalog's `use.kind`: `dwell`, `fidget`, `track` (keep the eyes on an animated prop).
Applied in `arrive()`'s `'use'` branch and the `use` branch of `maybeGlance`. Habituation now decays
(`decayHabits`/`FORGET_MS`) — it only ever climbed, so after ~10 minutes every machine was
permanently "furniture" and ambient curiosity ran out of targets.

### 3. Roam — `frontend/app/zones.js`
Zone = station floor **∩** `ROAM_RADIUS` (14) around the body's stable desk/spawn anchor. Room plates
do not widen or clip that distance, and the same rule applies to solo and deskless placed bodies.
`geo.walkable` plus the existing pathfinder still reject walls and unreachable destinations; the
zone only owns the stable distance boundary. `test/zones.test.js` covers the exact edge behavior.

### 4. Social — greet, take turns, wave
`talkTurn`/`myTurn` (extracted PURE, `TALK-TURN-PURE`, locked by `test/talk-turn.test.js`) alternate
`b.speaking` between the two bodies of a huddle/border encounter off `socialBeat.startedAt`.
`maybeAcknowledge` = a look exchange when someone walks past. `greetNewcomer` (in `spawnAgent`)
sends somebody over to welcome a newly spawned body via the existing D3 huddle.

### 5. The LOUNGE round (Andrew's second pass — the most important part)
He tested it live and said it was **worse**, over-engineered, and that the agents ignored the couch,
TV, arcade and pinball he had placed. He was right, and the cause was a **gating bug that predates
this lane**: `planProp` — the only route to any leisure prop — hung off the **rest** drive, so an
agent only went near entertainment when TIRED. Idle downtime accumulates the **stim** (bored) drive,
which did caretaker laps and study beats. Measured on a replica of his own station: the hero used
**zero** leisure props in six minutes.

- `planPlay` — bored + something fun in reach → go play, ahead of the caretaker lap.
- The pick is **weighted** (`FUN_W`) over all fun props, with the couch/TV lounge as ONE candidate
  (`loungePair`). Routing through `planProp` instead put both bodies on the couch 58% of the time
  because `tryLounge` short-circuits. `self.lastFun` × 0.12 stops a body parking on one machine.
- `planRest` — tired still means the couch, unless it just got off that couch.
- `counterFace`/`stoolAt` — a body sent to a bar takes a free adjacent stool and sits **facing the
  counter** (back to camera), which is what sitting at a bar looks like.
- `planVantage` dialled from `idleAge>30s, p=0.35` to `idleAge>60s, p=0.12` — at the old rate it was
  the single most common thing the hero did (98 of 259 idle samples) and read as indecisive drifting.

### 6. The gesture removal (his latest call — READ THIS BEFORE "ADDING POLISH")
I had fired the sprite sets' one-shot `gesture` track at four moments (prop arrival, a loop at the
arcade so the body "worked" the machine, greeting/parting waves, a wave at passers-by). **That track
is an ARMS-UP STRETCH.** Andrew: *"the arcade machine animation makes 0 sense... it just walks up to
the machines and starts stretching."* All four call sites and the on-demand playback hook in
`frontend/js/assets.js` are gone. The ambient once-per-~90-minutes stretch is untouched.

**Consequence:** there is currently NO wave anywhere, so his "walk up to one another and wave" ask is
only half-delivered (they walk up, face each other and take turns; they do not wave).

## The open decision — new sprite art

A believable "playing the machine" pose and a real wave need **new frames**, not another flag.
Shape of the work, if he greenlights it:
- Sets ship per-direction tracks named `<set>.<track>.<dir>` (see `frontend/assets/sprites/<set>/` and
  `manifest.json`); `frontend/js/assets.js` resolves them by name in `drawBody` (`pick`/`pick8`).
  Adding `play_<dir>_<n>.png` / `wave_<dir>_<n>.png` and a branch in `drawBody` is the known shape.
- Inventory today: **38 sets**, 35 ship `gesture`, only **5** ship `talk`, 0 ship `drink`.
- The PixelLab MCP is connected (`mcp__pixellab__*`, incl. `animate_character`); ⛔ call
  `get_balance` FIRST (project law). Generating for all 38 skins is the cost question — the default
  set(s) may be enough.

## How to verify anything here — `dev/idlesoak.mjs`

Screenshots are useless (the canvas is rAF-driven and rAF never runs in the preview pane), and these
are all *statistics over minutes*. The instrument boots the real app in headless Chrome (rAF DOES
run there), lays a floor through the REFIT mutation API, and samples `World.bodies()`.

```bash
node dev/idlesoak.mjs --port 8955 --cdp 9355 --minutes 7 --crew 2 --kit lounge --out .lounge
```

- `--kit lounge` builds **Andrew's own layout** (one room: couch+tv, arcade, pinball, bar + stools
  placed against the bar). `--kit mixed` = two rooms + assorted kit (for roam/W3).
- `--pair` nudges two crew together so a rare encounter fires without waiting many minutes.
- The report (`<out>/report.json`) carries: per-body `facing` histogram + `blindPickWallPct` (the
  in-sample control: what a blind cardinal pick WOULD have scored on those same tiles), `visits` and
  `meanDwellSec` per prop kind, `seatSamples`/`seatFacingCounter`, `nextDoorSamples`, an
  `encounterTimeline`, and `samplesPerMin`.
- ⛔ It **refuses to grade a starved run** (`samplesPerMin < 25` → INCONCLUSIVE, exit 4). Believe that.
- `World.bodies()` was extended (read-only) with `facing`, `wallDirs`, `quirkKind`, `useKind`,
  `emote`, `talking`, `pose` (the track the body was LAST DRAWN in — render truth, recorded by
  `assets.js`), `socialKind`, `socialPhase`, `inHomeRoom`.

Last green run (7 min, lounge kit, 2 crew): hero visited arcade ×3 (23.5s mean), pinball ×2, couch,
bar stool ×2 (facing the counter in 37/45 seated samples); 0% nose-to-wall vs a 0.8–10.5% blind-pick
control; 0 containment breaks. That run PREDATES the gesture removal — the removal only deletes
animation calls, but if you want a clean receipt, re-run it.

## Traps this lane paid for (do not re-learn these)

1. ⛔⛔⛔ **Never edit a repo file through Python text mode on Windows.** `open(p,'w').write(s)`
   translates `\n` → `\r\n` and rewrites the whole file CRLF. Several tests here **execute code
   sliced out of `world.js` on a `\n` needle** (`channels.sse`, `social-border`, `chat-stare-throttle`,
   `talk-turn`) — the gate went red 525 steps in, in a subsystem this lane never touched.
2. ⛔⛔ **A starved live run is not a green run.** The same 6-minute soak collected 394 samples on a
   free box and 66 while other agents' gates ran — and the starved one reported zero wall-stares,
   zero encounters and zero prop use. Check `samplesPerMin`.
3. ⛔⛔ **Read what a beat's TARGET SELECTION optimises for before tuning probabilities.** The
   wall-stare was not randomness: `planGazeOut` walked to the room's outermost tile and faced
   *outward*, by construction.
4. ⛔⛔ **Widening a filter does not widen the sampling.** Every picker filters through `tileInZone`
   but each has its own candidate SOURCE; check both halves.
5. ⛔⛔ **Two bodies in one beat must read ONE clock.** Turn-taking keyed off each body's own arrival
   put both in "slot 0" and both talked at once.
6. ⛔⛔ **A source lock that pins an object literal character-for-character** fails on additions it was
   never guarding (`socialBeat = { ... }` in `social-border.test.js`).
7. ⛔ **A frontend edit owes a claims re-lock**, generated AFTER the code commit, committed on its
   own (`scripts/qa/product-perfect/claims.mjs --refresh-surface --candidate <sha>`), and a
   `npm run sync:website`.

## Suggested next moves

1. Have Andrew live-test the current HEAD (the lounge round + gesture removal) and take his read.
2. Decide the art question above; that is what unblocks "waving" and a true arcade interaction.
3. Only then consider merging. Ritual: `starnet-merge-ritual` skill, rebase onto trunk first, gate,
   then `git merge agent/idle-life` from the integration tree with a hand-written merge message.

Open, honestly stated: crew bodies still favour the couch heavily (one measured 9 of 12 visits);
the entertainment weighting is tuned by feel, not by a target distribution; and the roam radius has
never been exercised on a real multi-room station (Andrew's is one room).
