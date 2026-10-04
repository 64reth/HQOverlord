# RPG Layer Design

_The role-play / gamification / "addictiveness" layer for the StarNet real-agent harness (2026-06-13). Output of a 6-lens parallel design pass + synthesis. Sits on top of the already-locked builder, object→capability, Salvage/XP economy, and truthful-telemetry foundation (see `BUILDER_AND_WORLD_FOUNDATION.md`, `docs/design-proposals.md`). This document plans the agent-as-character, quest, engagement, loot, and core-verb mechanics that those docs deliberately left untouched._

> **Clarification (andro, 2026-06-14): this is a general-purpose agent sandbox (OpenClaw / ref-class), NOT a themed narrative game. There is NO lore.** The RPG is the management UI, gamified — every mechanic is a practical agent-ops feature you'd find in a boring agent harness, turned into a verb the user actually wants to use, and it must work for ANY use case. See the two clarifying laws and the feature→mechanic map below.

---

## The thesis

**The RPG layer is not a skin on the harness — it IS the harness's readout.**

The only honest move in this product is to make **every game number a pure reducer over the frozen `U.bus` event log**, and **every reward a REAL capability change the loop already enforces.**

- A **stat** is a reduction over `agent.run.end {reason,turns,usd}`, `agent.cost {model,tokens}`, `agent.tool_result {ok,isError}`, `deliverable {kind,room}`.
- A **level** is a higher real budget ceiling (`maxCostUsd`, `maxIters`) the loop reads.
- A **class / trait** is a real `context.js` system-prompt change that measurably alters behavior.
- **Loot** is the literal artifact file on disk.
- A **quest** is a predicate over real events — with no "mark complete" button.

The character the player bonds to **is a body of work the agent actually did for them.** "Issue a directive" becomes the slot-pull, and the dopamine is literally real productive work resolving — win or fizzle, never faked.

**The moat is the tooltip that drills any stat down to the exact run that earned it.** That single affordance converts skepticism into the attachment that retains. Everything else (ceremonies, streaks, dossiers, gear) is presentation over the same event log — **zero new economy**.

### Two clarifying laws (andro, 2026-06-14)

1. **No lore.** This is a sandbox, not a themed story. No fixed narrative, no imposed fiction, no "saga," no scripted arcs. RPG *mechanics* — yes; RPG *lore* — no. Any element whose only job is to tell a story is cut (see the cut list: the "StarNet Codex" saga and prescribed-campaign framing are removed). The setting is just the user's own workspace, rendered.
2. **General-purpose, always.** This is OpenClaw / the reference harness with a game for a face — a general agent sandbox the user drives for *whatever they want* (code, research, ops, content, a real company, anything). **No mechanic may assume a single domain.** The acceptance test for every feature: *is it a 1:1 wrapper around a real agent-ops action, and does it work for any task?* The RPG layer is the practical agent-management surface, gamified — the game IS the control panel.

---

## The RPG layer = the management UI, gamified

The product is OpenClaw/the reference harness — a general agent harness — wearing a game as its interface. There is nothing in the game the user can do that isn't a real agent-ops operation, and nothing about the agent-ops is locked to one domain. Every "boring" practical feature maps to one RPG verb:

| What you do in OpenClaw / the reference harness (the boring UI) | The same action, as an RPG mechanic | Stays general because |
|---|---|---|
| Create & configure an agent | The wake / forge ritual | any role, any model |
| Choose a model | Equip a weapon (Armory), real $ shown | every model is selectable |
| Grant tools & permissions | Place capability objects in the room (object→capability) | shell / web / files / image / comms / memory compose for anything |
| Give a task (type a prompt) | Cast an order (the Order Stone) | takes any natural-language task |
| Watch it stream / call tools | Walk-to-desk + the live terminal theater | identical for any work |
| Approve / deny a tool action | The authorize / Boss-Approval beat | any tool, any scope |
| See cost & token usage | Live meters + the Efficiency stat | any run |
| Set budgets & limits | Earned-trust tier + Focus Stances | any agent |
| Schedule recurring work | A standing order | any task |
| Delegate / multi-agent handoff | Station org layout + party / fireteam relay | any pipeline |
| Agent memory / context | The notebook object + the agent's record | any domain |
| Track what an agent is good at | The character sheet (stats + inferred class) | derived from whatever it actually did |
| Review & keep outputs | Loot drop → the Vault | any artifact type |
| Add an MCP server / new tool | A new buildable object in the catalog | any integration |
| Manage many agents | The station (rooms = teams) | any org shape |
| See what ran while away | The cold-boot recap | real events only |

If a proposed mechanic isn't in the left column (a real thing a general agent harness does) or can't be made domain-agnostic, it doesn't ship. That single rule keeps the game honest *and* keeps it a sandbox.

---

## The five systems

Six independent design lenses converged on five systems. Build the shared reducer **once**; render it many ways. (The sixth lens — narrative/lore — is **cut** per law 1; only its practical, non-fiction pieces survive, reframed as agent records below.)

### 1. The Agent Character Sheet
The core attachment object: a deterministic transform from the persisted run-log to a displayed identity, where level-ups hand out REAL powers.

- **The Ledger Sheet** — five derived stats, each drillable to the runs behind it:
  - `Reliability` = share of `agent.run.end` with `reason:'done'` vs error/refusal/budget/max_iters.
  - `Throughput` = lifetime deliverable count, **weighted by kind** (not raw count — anti-farming).
  - `Efficiency` = deliverables per real USD (Salvage minted per dollar).
  - `Precision` = `tool_result` ok-rate (1 − isError share).
  - `Depth` = median turns-to-done.
  - Cold-start: a `Calibrating` state + confidence shading until ~5 runs so early luck doesn't lie.
- **Agent Level = Earned-Trust Tier** — per-agent XP rides the *same* real outcomes that mint Salvage, but accrues per-agent. Each level raises real ceilings the loop enforces: `limits.maxCostUsd`, `limits.maxIters`, and autonomy/schedule **eligibility** (autonomy stays OFF by default even post-unlock). A budget raise requires **both** the level **and** a clean recent Reliability window — trust is revocable on regression.
- **Classes from proven behavior** — class (Researcher / Coder / Operator / Negotiator / Artist) is *inferred* as the argmax of real `agent.tool_call {name}` + `deliverable {kind}` histograms, awarded at a confidence threshold with a ceremony beat. The perk is a **real class-specific system-prompt preamble** (additive, never restrictive; re-derived on a rolling window).
- **The Agent Record (dossier)** — the gamified version of an agent's history/profile pane (a practical readout, **not backstory or fiction**): the role you gave it at wake (`buildSystemPrompt`), a line per real `deliverable`, runs grouped by outcome (`reason`), recent output. It's a management view of what the agent has actually done — useful for deciding what to assign it next — rendered as a CRT file rather than a spreadsheet row.
- **Traits & Scars** — one-time perks on verifiable milestones ("Frugal", "Clean Hands", "Marathoner") granting real micro-buffs; **scars** auto-applied on real failure streaks that tighten auto-trust until a clean-run streak heals them. Scars are temporary, always-healable, framed as the *agent's* record, and never block core use.
- **Proficiency XP per tool** — per-agent-per-tool mastery bars incremented on successful `agent.tool_result`; tiers unlock real operational upgrades **for read-only/idempotent scopes only** (mutating scopes always re-prompt). The tool object in the room tier-glows via the existing shabby→glorious palette.

### 2. Contracts & Campaigns (real work as self-verifying quests)
- **The Contract Object** — `{ goal, objectives[], reward, expiry }` where each objective is a typed predicate over the frozen vocab (deliverable-of-kind, run-`done`, spend-cap, tool-ok). A pure reducer folds events against open contracts; **there is deliberately no manual "complete" button** — completion is a function of telemetry. Reward rides the existing Salvage/XP mint, just attributed to the contract.
- **Objective / project board (the "Main Quest")** — whatever goal the user states (any domain, no prescribed storyline) becomes a top-level objective they can optionally decompose into a checklist of Contracts. This is the user's real to-do list, gamified — open-ended and editable, never a scripted narrative. Progress is gated on real deliverables; completing a chunk tiers up the relevant room. Think "project board with a quest skin," not "story campaign."
- **Contract Board** — rotating daily/weekly bounties **generated from your station's real telemetry** (failed runs to recover, tools that never returned ok, rooms with zero deliverables, lean-spend weeks). A mirror of actual state, framed as opportunities, never invented nags.
- **Turn-In Ritual / Boss Approval** — completion opens the **real artifact** (file/image/doc from the winning `deliverable`) plus the run's reconciled cost; Commander clicks `SHIP` (mint), `REDIRECT` (seed a new real run), or `REJECT`. Existence/quantity machine-verified; the human judges quality. (Same beat also handles `permission.prompt` as an "authorize action" card.)
- **Agent-Proposed Quests** — at `agent.run.end` an agent may emit a `proposal` deliverable (goal + objectives it commits to); it queues on the board as PENDING; one-click accept converts it to a live Contract and fires a pull-trigger run. Respects autonomy-OFF (propose-but-wait), max-pending cap, spend-cap objective.

### 3. The Core Verb Loop (the run lifecycle made tactile)
Where moment-to-moment dopamine is minted. The lifecycle (`start → token → tool_call → cost → end → deliverable`) is already a fully ordered stream — dressing it as **cast → watch → judge** is pure presentation.

- **The Order Stone** — a hotkey radial over the focused agent: type intent, see a **pre-flight `cost.estimate` (USD + tokens) + the `maxCostUsd` guard** before committing, confirm to fire a real `trigger:'directive'` run. Casting always shows the price tag; re-casting on a busy agent queues or interrupts (emits `run.cancel`) — never silently.
- **Live Run Theater + Open-Run Pull** — the desk prop-terminal becomes the run's HUD: token flicker (`agent.token`), tool glyphs lighting + flipping green/red on `agent.tool_result {ok,isError}` with real latency, a reconciled cost crawl. A strip that **pulses on real activity and completes only on `agent.run.end`** — it never lerps to 100%.
- **Boss Approval** — see system 2 (the deliverable review beat).
- **Focus Stance** — per-agent presets (Ship Fast / Be Careful / Go Cheap) that deterministically set real `{limits, model, scope, prompt-clause}`; their effects show up as real cost/iteration differences, not asserted flavor. Visible sigil over the agent.
- **Party Combo / Fireteams** — explicit opt-in relays where A's `deliverable` seeds B's directive run carrying A's real artifact; the v7 parcel travels the real hallway; a combo counter rises per successful link; a broken link (`error`/`refusal`/`REJECT`) ends it honestly. Hard chain-level cost cap. _(Depends on multi-agent delegation — P4.)_

### 4. Loot, Gear & Collection (the artifact IS the drop, the model IS the weapon)
- **The Armory** — the room's compute object = an equippable **weapon** whose rarity is real price/context (Haiku = Common, Sonnet = Rare, Opus 4.8 = Legendary), with **$/1M-tokens shown prominently** so "Legendary" visibly reads "expensive." Tools = artifacts reading real `capId/scope` from `CAP_REGISTRY`.
- **Loot Drops / The Vault** — on `deliverable` a v7-style loot item drops; the agent walks over and collects it into a Vault/gallery where images render as real thumbnails and every card **opens the real file on disk**. Rarity rides the *same* quality-bonus signal Salvage uses (size capped/normalized so padding earns nothing). The Vault is an auditable portfolio = the trophy case.
- **Crafting & Tempering** — a Forge spends Salvage (gated by Station Level) to **write a more-permissive grant row** into capability state — the upgrade IS a real capability expansion. **Every mutating/destructive escalation always hits default-deny consent regardless of progression.**
- **Achievements & Sets** — badges minted only on verifiable milestones, each citing source run ids (an honest portfolio). Sets group related loot. Criteria reward efficiency/diversity/shipping — never raw money burned.
- **Station Legacy / Prestige** — at real lifetime milestones, archive the station as a read-only Legacy snapshot (Vault + achievements + best gear intact) and start fresh with capability/cosmetic **heirlooms** (never fake stat boosts).

### 5. Retention Loops (honest cadence, no fake timers)
Highest dark-pattern risk → where the moat is won or lost.

- **Cold-Boot Brief ("While You Were Away")** — on return after time away, replay the buffered real event stream as a captain's log of what the crew actually shipped/spent/failed overnight. An empty night honestly reads "Station quiet — no scheduled runs fired." _(Depends on scheduled/autonomous runs producing real overnight work.)_
- **Shipping Streak** — a day counts **only** if ≥1 real `deliverable` fired that local day. No login credit. No streak-freeze purchase, ever. Idle days reset honestly. A quiet HUD flame + room lit/unlit cue, never a FOMO popup.
- **Milestone Ceremonies + Plaques** — rare real firsts/thresholds detonate full CRT juice and hang a **permanent plaque that deep-links to the run that earned it**. Routine wins get a calm tier (over-firing cheapens the high).
- **Honest Heads-Up Pings** — OS notifications fire **only** on real consequential events the user opted into per-class (`deliverable`, budget wall, `permission.prompt`, error/refusal), with a hard daily cap and a deep-link into the room. Re-engagement / "we miss you" pings are **forbidden by policy.**
- **One-More-Directive Hook** — on a win, a **single dismissible** suggestion for the obvious next real move (re-run with follow-up, hand to another room, promote to a schedule), each showing its cost estimate first. Never an auto-spend carousel.
- ~~The StarNet Codex~~ — **CUT (law 1: no lore).** A scripted "saga" is fiction with no real signal behind the prose. Its only honest residue — milestone *ceremonies* keyed to real aggregates — already lives in "Milestone Ceremonies + Plaques" above.

---

## Dark-pattern audit (the bright lines)

This product's whole moat is honesty. These are policy, not preferences:

| Surface | The bright line |
|---|---|
| Live progress bar | **Pulses on real signal density, never interpolates to 100%.** "Complete" is bound 1:1 to `agent.run.end`. Test: the bar cannot reach complete without a `run.end` in the recorded tape. |
| Streaks | Tick only on ≥1 real `deliverable` per local day. Login never advances it. **No streak-freeze ever.** Idle days reset. |
| Notifications | Echo only real consequential opted-in events. **Any re-engagement ping is forbidden.** |
| Crafting / proficiency auto-allow | Auto-allow read-only/idempotent scopes only. **Every destructive escalation always re-prompts at default-deny** regardless of level/Salvage/proficiency. Never grant a capability the room's objects don't actually provide. |
| Turn-in / Boss Approval | The artifact MUST be shown (can't accept blind). Log every accept/reject so rubber-stamping is visible. |
| Gear rarity | $/token shown prominently so "Legendary" reads "expensive." Celebrate cheap-model efficiency to counterbalance upsell pressure. |
| Rarity/stats from output size or raw count | Cap/normalize; weight by kind; gate on `reason:'done'`. Padding junk earns nothing. |
| Leveled auto-budget | Capped by Station Level too — **no single agent can outspend the station.** |
| Scars | Temporary, always-healable, the agent's record (not the Commander's), never block core use. |

---

## Roadmap (layered on the current spine)

Current built state: title → connect (BYOK) → one starter room → agent wakes/works on real streaming calls → COMMS chat → save/auto-resume.

- **RPG-0 — Deliverable primitive + stat reducer foundation.** Emit `deliverable` from real runs; the per-agent run-log (appended on `agent.run.end`); the pure Ledger stat reducer. The shared substrate for stats, contracts, dossiers, loot, ceremonies, and the Salvage mint. Pure transforms, unit-tested on the zero-spend replay provider. _Depends on: queued M3 (bus telemetry → World.setActivity); frozen events.js (done)._
- **RPG-1 — Core verb loop.** The Order Stone → Live Run Theater + Open-Run Pull → Boss Approval. Makes "issue a directive" the most satisfying verb using events that already flow. The demo that sells the product. _Depends on: RPG-0 + M3._
- **RPG-2 — Contracts & the character sheet.** The Contract Object, Agent Level = Earned-Trust Tier, Classes, the Living Dossier, Milestone Ceremonies. Where the loop gets sticky and identity forms. _Depends on: RPG-0 reducer + RPG-1 + Salvage/XP economy + loop.js limit guards._
- **RPG-3 — Builder-coupled loot & gear.** The Armory, Loot Drops/Vault, Crafting & Tempering, Achievements, Proficiency, Traits & Scars. Rides the builder phase + the expanded `CAP_REGISTRY` (shell/web/files = M5). _Depends on: THE BUILDER + CAP_REGISTRY expansion + RPG-2._
- **RPG-4 — Retention & meta-layer.** Objective/project board, Contract Board, Cold-Boot Brief, Shipping Streak, Honest Pings, Agent-Proposed Quests, Field Promotions, Focus Stance, Party Combo. _Depends on: scheduled/autonomous runs (D4) + multi-agent handoff (P4) + Tauri notifications + RPG-2/3._
- **RPG-5 — Social & prestige (experimental, defer).** Run Replay/Highlight Reel, Station Legacy/Prestige, opt-in leaderboards. _Depends on: a proven single-player loop + privacy/redaction layer + backend._

---

## The first build (highest leverage)

**Emit `deliverable` from real runs, then render the Boss-Approval turn-in beat for it.**

**Why.** `deliverable` is the keystone real signal the largest cluster of high-value features depend on (Contracts, Ledger stats, Vault loot, Ceremonies, Dossier Commendations, the Salvage mint, Shipping Streak) — yet **nothing in the codebase emits it today.** It is a frozen event in `shared/events.js:70` (`deliverable {id,agentId,room,kind,title}`) with no producer, and `sidecar/loop.js:147` ends a run with `end('done')` the moment the model stops calling tools, while detecting no artifact. Until this primitive exists, every downstream RPG feature is blocked. (Naming note: the frozen event is `deliverable`, not `deliverable.ready`.)

**Smallest test-backed slice.** In `sidecar/loop.js`, after a run ends `reason:'done'`, run a pure deliverable-detector over the final messages/tool-results (e.g. a `notebook.write`, a file/artifact reference) that, on match, emits a validated `deliverable {id,agentId,room,kind,title}`. Unit-test it end-to-end on the existing zero-spend replay provider: a scripted run that writes a note yields exactly one `deliverable` of the right kind; a chat-only run yields none. No new economy, no spend, deterministic via the injected clock/RNG.

**Maps to code.** `sidecar/loop.js` (emit after `end('done')`); `shared/events.js` `deliverable` schema (already frozen — no re-freeze); `sidecar/providers/replay.js` for the fixture; a new headless suite in `test/` via `npm run test:fast`. The frontend turn-in card later subscribes via the queued M3 telemetry layer and routes `frontend/app/world.js` `World.setActivity` to a "carry artifact to desk" beat reusing v7's parcel/handoff animation.

**The demo moment.** You type a directive ("save a note about our launch plan"); the agent walks to its desk and works on a real streaming call; when it finishes it stands, carries a glowing artifact card to the Commander's desk, and you click `SHIP` — Salvage + XP floaters pop, and a tooltip proves the reward traces to that exact real run. **The first time the game rewards you, it is provably telling the truth.**

---

## Cut list (tempting, wrong)

- Streak freezes / "spend to save your streak" — the most corrosive dark pattern; idle days must reset.
- Any re-engagement / "your station misses you" notification.
- A progress bar that lerps toward 100% — must pulse on real signal, complete only on `agent.run.end`.
- Auto-granting destructive capabilities (shell-execute, file-write always-allow) as a mastery/crafting reward.
- Fake/idle overnight progress to fill an empty Cold-Boot Brief — an empty night reads "Station quiet."
- Public leaderboards as an early feature (XL; needs backend + privacy-publish; defer to last).
- Any single agent's auto-budget exceeding a Station-Level cap.
- Rarity/stats from raw output size or raw deliverable count — normalize, cap, weight by kind, gate on `done`.
- Class as a restrictive lock — keep it advisory and additive.
- Fireteams / Party Combo before the real handoff plumbing (P4) exists.
- **Imposed lore / a fixed story arc (the "StarNet saga", scripted campaigns)** — this is a general-purpose sandbox, not a themed game; ship RPG mechanics, not fiction.
- **Any mechanic that assumes one use case** — every verb must work for code, research, ops, content, a real business, anything. If it only makes sense for "build an app," it's wrong.

---

_Source: 6-lens parallel design workflow (agent progression · quests · retention · narrative · loot/meta · core-verb translation) + scored synthesis, 2026-06-13. Grounded in and subordinate to the locked decisions in `BUILDER_AND_WORLD_FOUNDATION.md`._
