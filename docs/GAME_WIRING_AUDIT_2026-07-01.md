# Harness↔Game Wiring Audit — 2026-07-01

> **AUDIT SNAPSHOT, not a plan.** Findings were verified against code on this date
> (branch `feat/harness-backend`). Re-grep before acting on any specific claim —
> file:line refs drift.

Four parallel lenses: event backbone, world simulation, gamification loops, and
harness-feature reach-through. Verdict up front:

**The sprite layer is truthful but mute, and the station renders *states*, not
*events* — and *sessions*, not *history*.** The desk-trip invariant (walk only on
real tool fire, commit 8b39836) is solid. But moment-to-moment activity (which
tool, how far along, token flow) is invisible, and the across-time story (what ran
overnight, cumulative pride) leaves zero floor evidence. Roughly 40% of real
harness telemetry reaches any UI at all; far less reaches the world.

---

## 1. What is genuinely wired (do not re-litigate)

| Wire | Evidence |
|---|---|
| Desk trip fires on REAL tool use, not message classification | `frontend/app/world.js:1836-1850` (activity='task' set reactively on tool fire) |
| Settle→work→stand-up state machine truthful, incl. conveyor-fetch beat for piped work | `world.js:1818`, `world.js:1838-1846` |
| MCP connector portals: live state poll (green/amber/red) + pulse when THEIR tool fires | `world.js:2757-2775`, `propsprites.js:3867-3992` — the object=capability gold standard |
| Workbench pulses on `shell.exec` / `verify.result` (green/red by outcome) | `world.js:2777-2778` |
| Capability gating is real: room objects → resolved tools | `sidecar/capability/registry.js:17-114`, `resolve.js:21-45` |
| XP→level-up loop end-to-end with celebration (SFX.level + gold ripple + toast) | `xpstore.js:59-71`, `world.js:2883-2891` |
| Floor HUD stats are honest (RUNS/YIELD/SLAG/CACHE/THRU/DWELL/QUEUE) + queue-depth gauge | `floorstats.js`, `world.js:2799-2812` |
| Conveyor product crates mass-scale with real run cost; slag crates = wasted spend | `conveyor.js:136-172` |
| Post-run beat slot is serialized, anti-nag (turn-in > rate > idea > curiosity) | `chat.js:1188-1195` |
| Adaptive procedural music reacts to runs/tools/errors/deliveries | `frontend/js/audio.js` |
| cron.fire / cron.result(failed) / memory.recall / checkpoint.restored → HUD toasts | `world.js:2750-2756` |

Transport: one SSE stream (`/api/channels/events`, sidecar chanBus → `world.js:2788-2791` → `U.bus`) plus per-run NDJSON for live chat streams. The plumbing is fine — the gaps below are almost all "event already arrives, nothing renders it."

---

## 2. Gap map

### A. Live work is illegible (the "watching the factory" gap)

1. **No per-tool prop activation.** `world.js:2771` receives EVERY `agent.tool_call` but only pulses `mcp__*` connector portals. `fs.*` (cabinet), `web_search`/`browser.*` (dish), `notebook.*`/`skill.*` (notebook), `image_*` (studio) fall through. Props glow on binary `f.work`, never on the tool actually running (`propsprites.js:709+`). **Cheapest, highest-leverage wire in the codebase** — extend the existing handler.
2. **No task progress at the desk.** `sim.js:696` accumulates `t.prog/t.dur`; only the task-list UI shows `[XX%]`. Desk render gets `{work: boolean}` only (`world.js:1956,1967`).
3. **Token flow unused by the world.** `agent.token` drives chat text (`harness.js:327`) and music intensity (`audio.js:189`) but no world visual — screen flicker/typing cadence is faked, not token-driven.
4. **Nothing differentiates thinking vs tool-running vs blocked.** Same glow throughout a run.
5. **Sub-agent fan-out invisible.** `team.spawn`/orchestration backend merged; zero sprites for spawned sub-agents (Meeseeks layer not started — known).
6. **agent.run.error is chat-only** (`loop.js:305,337,345` → chat panel). No sprite distress, no desk state.

### B. Governance/économy signals are audio-or-nothing

7. **budget.threshold → SFX.alarm only** (`budget.js:129` → `audio.js:208`). No power-meter prop, no HUD %, no spend burn visual. `billing.js` unwired (managed credits only).
8. **capdenied → sound + friendly error text** (`loop.js:246` → `audio.js:207`, `friendlyerror.js`). The run STOPS; the world shows nothing.
9. **cost.estimate orphaned** (`loop.js:273`) — no realtime per-run cost readout anywhere.
10. **Empty-room silent fail:** agent with no compute prop sits at desk, screens still light (`world.js:266-271` checks `agent.working`, never `hasCompute`); `resolve.js` returns `[]` silently. Agent should refuse to light up / complain "I need a computer here."

### C. Autonomy leaves no evidence (the return-loop gap)

11. **No "while you were away" recap** — confirmed twice independently. Autonomy/cron/autonotify run unattended; on return the floor is static, no digest beat, no changed world state, no deliverables stacked anywhere.
12. **cron.tick / cron.skipped orphaned** (`cron-driver.js:275,129,195,259,265`) — throttled/backlogged routines invisible; a repeatedly-skipped job leaves zero trail.
13. **cron success is silent** — `cron.result` only toasts on `failed` (`world.js:2751`); the win case (routine produced work) shows nothing.
14. **channel.inbound → SFX.msg only** (`hub.js:137` → `audio.js:211`). Telegram/Discord arrivals: no dish pulse, no inbox badge, no unread count.
15. **shell.bg.exit orphaned** (`index.js:772`) — long background work completes unannounced.
16. **Idle autonomy is an illusion.** Idle wander/pool/buddy visits are pure cosmetic rolls (`agents.js:498-541`); real autonomy lives only in cron + user-approved autojobs. An idle agent never visibly "figures out its own task."

### D. Reward moments are muted (the pride gap)

17. **Quest completion has no UX** — milestone toasts once (`xpstore.js:71`); quest log updates silently; no sound; no trophy case (milestones data exists at `xp.js:206-209`, consumed only by QuestStore).
18. **Confidence gauge is a phantom** — drives XP multipliers silently (`xp.js:93-97,154-157`); dossier-panel-only; no "I'm starting to understand you" narrative beat at calibration/85% TRUSTED.
19. **Seed loop closes in code, not narrative** — minted seed lands in recipes, gets used in pitches, Commander is never told "I built the seed you saved."
20. **No cumulative pride metrics** — no lifetime tasks shipped, no session recap; floor HUD is now-only.
21. **Rate-the-work fragile** — control embeds in turn-in card or standalone beat (`chat.js:489-495,536-539`); dismissing proposals can starve rating; no standalone fallback per run. Also still missing task-size weighting (known TODO).
22. **memory.write/feedback/forget = panel+chime only** — no notebook/archive prop animation; knowledge is invisible in-world.

### E. Needs-you moments have no body

23. **permission.prompt renders only in COMMS chat** (`index.js:1978` → `chat.js:387-435`). The agent is genuinely BLOCKED awaiting approval, but its sprite does nothing — no walk-to-airlock, no desk flash, no waiting pose. This is the single best honest "come back to the app" hook not taken.
24. **tool.args.repaired orphaned** (`loop.js:52`) — silent JSON repair; no audit trail surfaced.
25. **object.place / object.reclaim defined in `shared/events.js` but never emitted** — dead contract entries.
26. **Merger absorption silent** — K-1 crates vanish at junctions with no combine shimmer (`conveyor.js:245-284`).

---

## 3. Addictiveness design — mapping gaps to hooks

The Factorio pull is two loops StarNet currently half-has:
watching the factory RUN (legibility) and coming back to see what it DID (return).
Plus Clash-style collect rituals and monument pride. All can be built HONESTLY
(truthful telemetry, no fake timers) — the real work is genuinely async, so the
return loop is real, not manufactured.

1. **Legibility (watch it run):** per-tool prop activation + desk progress +
   token-driven screen flicker + Meeseeks. Also feeds the GTM spectacle thesis —
   a station that visibly works is clippable.
2. **Return ritual (morning collect):** while-away digest beat + physical OUTBOX
   crates stacked per overnight run. Reviewing/rating each = the "collect tap,"
   which ALSO feeds XP + confidence + memory turn-in — one ritual closes four
   loops. Cron successes must land here (gap 13).
3. **Needs-you pull (honest appointment mechanic):** approval-blocked agent walks
   to the airlock/door and WAITS (visible from notification → open app → someone
   is standing there). Eerie, honest, effective. Same body for capdenied and
   empty-room complaints.
4. **Optimization pull (the factory is never done):** surface SLAG post-mortems as
   actionable fix-your-factory prompts; budget as a power meter that depletes;
   cache % as smelter efficiency. Chaseable numbers with real dollar meaning.
5. **Monument pride:** trophy-case prop for milestones; lifetime counters
   (tasks shipped, deliverables, streaks); station postcard export.
6. **Escalating automation:** celebrate seed reuse ("the seed you saved ran 5×
   this week"); job-board/wall-clock prop makes routines feel like built
   infrastructure, not settings.

## 4. Recommended build order

- **P0 — cheap wires, existing events (days, one worktree lane):** extend
  `world.js:2771` handler to pulse cabinet/dish/notebook/studio by tool prefix;
  desk progress bar; budget power-meter prop + HUD %; channel inbound → dish pulse
  + inbox badge; cron.fire → job-board/clock prop pulse + cron success toast;
  empty-room dark screens + complaint; run-error desk flicker; merge shimmer.
- **P1 — return loop:** while-away digest beat (one per session, anti-nag,
  beat-slot compliant) + OUTBOX crates as physical evidence + standalone
  rate-the-work fallback so the collect ritual always completes.
- **P2 — pride & celebration:** trophy case, lifetime stats, quest-complete
  sound, seed-used callout, confidence narrative beats (calibrated / TRUSTED).
- **P3 — Meeseeks sprite layer** (backend already merged).
- **P4 — approval embodiment + idle-autonomy honesty:** blocked agent
  walks-and-waits; autojob proposals get a body (agent pins a proposal to the
  job board instead of a settings toggle).
