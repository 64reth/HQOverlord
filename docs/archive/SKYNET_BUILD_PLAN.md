# StarNet → Real: Build Plan for the Gamified AI-Agent Harness (`gen/`)

**Document owner:** andro · **Date:** 2026-06-13 · **Status:** Decisions locked, ready to execute Phase 0.

---

## 0. Locked Decisions (2026-06-13)

These four gate Phase 1 and are now committed. The remaining decisions (D2, D3, D7, D9–D15 in §10)
keep their recommended defaults unless changed, and can be settled by the end of Phase 2.

| # | Decision | Locked choice |
|---|---|---|
| **D1** | Billing at launch | **Hybrid, BYOK-first.** User supplies their own OpenRouter/Anthropic key, stored in the OS keychain, read only by the sidecar, zero markup, no backend. The $50/mo managed-credits "Station Pass" is a later flip-the-switch upgrade (Phase 4). |
| **D4** | When an agent runs | **Pull + scheduled.** Directive-driven by default; optional scheduled jobs; fully autonomous self-initiation is an explicit **per-agent toggle**, off by default. |
| **D5** | Tool scope / capabilities | **Full sandbox — the user decides.** No artificial capability ceiling: every capability type (model, shell, files, web, image, comms) is available and is enabled **by the user** through object placement + permission grants. This is a gamified harness — the user determines what their agent does. Build *order* still lands the model spine first (tools ride on top of the model loop), but the product target is full power, not a locked subset. |
| **D8** | World tech for v1 | **Existing room + runtime-placeable objects.** Reuse v7's fixed station; add a build/placement mode. Pan/zoom camera + multi-room deferred to Phase 3. |

**Safety posture implied by D5 (full sandbox, user-decides):** freedom by choice, not recklessness by
default. Shipped defaults stay **informed-consent**: per-action permission prompts + a jailed per-agent
workspace directory. A user who wants unrestricted power explicitly opts into a **"Full Access"** escalation
per agent/capability (this mirrors andro's own `bypassPermissions` stance for the dev instance). Non-expert
downloaders keep the guardrails until they deliberately lower them; the object→capability mapping remains the
visible, legible control surface either way. The sandbox itself is always **real** — "full access" widens
scope, it does not remove metering, the kill-switch, or spend backpressure.

> **Builder reframe (2026-06-13).** StarNet's core identity is now a **station builder** (Tuber-Simulator-style):
> spawn in one shabby room, expand outward, and the layout you draw *configures your real agent org*. This makes
> a **mutable, data-driven, scrollable world** the foundational rebuild, and adds **THE BUILDER** as a first-class
> phase after the Phase 1 spine. The §8 roadmap below is the original product-level sketch; it is now superseded
> by two companion documents that are the source of truth for execution:
> - **[BUILDER_AND_WORLD_FOUNDATION.md](BUILDER_AND_WORLD_FOUNDATION.md)** — the architectural bible (world model, Mutation API, save versioning, renderer, builder, station-as-workflow).
> - **[INCREMENTAL_ROADMAP.md](INCREMENTAL_ROADMAP.md)** — the granular, test-gated step-by-step build order.

---

## 1. Executive Summary

The product is a downloadable Windows desktop app that turns a pixel-art space station into a living dashboard for **real** AI agents: you create an agent like a Terraria character (pick a model, design a pixel avatar, name it), raise it through a gamified onboarding chat that writes its real system prompt, then watch it walk around a room and sit down at objects you place — and when it sits at a computer it is genuinely running a model, calling real tools, and spending real money you can watch tick up. Every number on screen is truthful: the typing animation means a model call is in flight, the cost meter reads real provider usage, and the deliverables are real files written to disk. Agents can only do what the room physically contains — placing a "computer" grants compute, a "terminal" grants shell, a "filing cabinet" grants disk — so the room layout *is* the permission system, visible and legible. The business model is a ref-style $50/mo credit subscription with Bring-Your-Own-Key as the launch default, surfaced in-game as a per-agent spend meter and a station-wide credit gauge.

**The single biggest technical bet:** that we can keep v7's entire vanilla-JS canvas world (renderer, tile map, movement/sit/work state machine, sprite recolor, prop-terminal, CRT theme) essentially **unchanged** as the frontend, and make it real solely by **replacing the fake `SIM` module with a thin event adapter that re-emits real agent-runtime events onto the exact same `U.bus` event vocabulary the frontend already listens for.** If that seam holds, we ship the look-and-feel of v7 with real agents behind it; if it doesn't, the rebuild balloons. Everything below is structured to validate that bet as early as Phase 1.

---

## 2. What We Keep From v7 vs What Is Genuinely New

### Keep — reused near-verbatim (the engine)

| Capability | v7 file(s) | What we reuse |
|---|---|---|
| Tile map, BFS pathfinding, walkability, zones | `js/map.js` | `path()`, `walkable()`, `canStep()`, `roomAt()`, `propAt()`, `randomSpotIn()`, `idx()` — the collision/routing core |
| Movement + sit + "work" state machine, plan sequencer | `js/agents.js` (WORLD) | `tick()` path integrator, `goTo()`/`arrive()`, `runPlan()` with `{go/face/sit/wait/do}` steps, `standNearFurn()`, `scanWorld()` awareness, `PERS` personality table |
| Canvas render loop | `js/render.js` | `frame()` y-sort painter loop, `buildBase()` bake pattern, `buildLightMap()` destination-out lightmap, `init()`/`toLocal()` hit-testing |
| Sprite recolor + animation | `js/assets.js` (SPRITES) | `filterFor()`/`tintFrames()` HSL recolor, `drawBody()` animation-track picker, manifest loader — **this is the avatar designer backend** |
| Procedural art fallback + furniture | `js/sprites.js` | `drawProcedural()` zero-asset agent, `drawOverlays()`, and the `F{}` furniture table (esp. `desk`/`desk2`/`pixelrig` = "computer" objects) |
| Prop-terminal windows | `js/propterm.js` | Window manager (`spawn`/`place`/`drag`/`rollup`/`close`), `streamHTML`/`feedHTML`, `fastTick` id-targeted DOM patching, FEED state machine `{lines,cur,target,pend,tok}`, `uplink`/`sendNote`/`runDirective`, the ASCII deliverable canvas engine |
| Pip-boy chrome + windows | `js/ui.js` | `el`/`$`, bottom-bar terminal windows, feedback queue UI, chat-input wiring, `openAgent()` dossier, `U.bus.on` render wiring |
| Helpers + event bus + SFX | `js/util.js` | `U.bus` pub/sub (the architecture's spine), `U.money`/`fmtClock`, `clamp`/`lerp`, WebAudio SFX synth — copy wholesale |
| Theme + CRT + boot UX | `css/style.css`, `index.html`, `js/main.js` | 4 theme skins + CRT pseudo-elements, `#boot` overlay + `bootSeq()` typewriter, `applySettings()`, the grid layout skeleton |
| Visual assets | `assets/sprites/minion/*` (35 frames), `assets/sprites/ultron/*` (20 frames), `manifest.json` | The base minion that recolors into any avatar; the "computer"/desk props |

### New — genuinely built from scratch

- **Desktop shell** (Tauri Rust core + WebView2) with code-signing, installer, auto-updater.
- **Agent host** (Node sidecar) — owns secrets, runs the real model→tool→stream loop, meters real usage.
- **WS bridge / `SIM` replacement** — the adapter that turns real host events into `U.bus` emits.
- **Provider adapters** — OpenRouter (default), direct Anthropic/OpenAI, local OpenClaw gateway.
- **Capability/tool registry + sandbox** — object→tool mapping, per-action permission prompts, jailed workspace dirs.
- **Cost & credits ledger** — real metered usage, reconciliation, subscription/BYOK fuel.
- **SQLite persistence + artifact store** — replaces the single localStorage JSON blob.
- **Mutable world model** — runtime add/move/remove objects, incremental `zoneGrid`/`blocked`/`sitTiles`/`pwGrid` updates + re-bake, a **camera** (pan/zoom).
- **Onboarding / character creator** ("Cradle Bay") + PixelLab avatar bridge.

### Discard outright (fake set-dressing)

`js/sim.js` execution model entirely: `minuteTick` progress timer, `generators()`, `rollQuality()`, `taskCost()`, `salesTick()`, `earn()`/revenue minting, `DATA.DAILY_SUBS` burn, `playerMessage()` regex intent router, the 17-agent `DATA.AGENTS` roster, the producer/consumer "insights→listings" economy. We **keep the *shape*** of the task lifecycle (todo→active→review→done) and the reload-safe `shipQueue` job-tracking pattern as design references, reimplemented against real calls.

---

## 3. Target Architecture

**Decisive stack choices** (no options): **Tauri** (not Electron). **Node.js sidecar** agent host (not in-process Rust, not in-webview). **OpenRouter** as default gateway, with direct Anthropic/OpenAI and local OpenClaw as adapters. **SQLite** for durable state (not localStorage). **WebSocket over localhost** for frontend↔host transport, carrying the **existing `U.bus` event schema**.

### Diagram-in-prose

```
┌──────────────────────────── TAURI SHELL (Rust core, WebView2) ────────────────────────────┐
│  · Window host · code-signed MSI/NSIS installer · signed auto-updater                       │
│  · OS keychain (Windows Credential Manager / stronghold) — secrets read ONLY by sidecar     │
│  · Spawns + supervises the Node sidecar; brokers file dialogs + app-data paths              │
│                                                                                              │
│   ┌─────────────── GAME FRONTEND (webview: v7 reused wholesale) ───────────────┐            │
│   │  render.js · map.js · agents.js(WORLD) · assets.js(SPRITES) · sprites.js     │            │
│   │  ui.js · propterm.js · util.js(U.bus,SFX) · style.css · index.html grid     │            │
│   │                                                                              │            │
│   │   ┌── WS BRIDGE (replaces SIM) ──┐   emits real events onto U.bus:           │            │
│   │   │  connects to sidecar;        │   agent.run.start / .token / .tool_call   │            │
│   │   │  translates host events →    │   agent.cost / .run.end / deliverable.ready│           │
│   │   │  U.bus.emit(...) ; forwards  │   directive / feedback / object.place      │           │
│   │   │  user actions back to host   │                                            │           │
│   │   └──────────────┬───────────────┘                                            │            │
│   └──────────────────│────────────────────────────────────────────────────────┘            │
│                      │ localhost WebSocket (random port, handshaked)                          │
│   ┌──────────────────▼──────────── AGENT HOST (Node sidecar) ──────────────────┐            │
│   │  SessionManager: per-agent live model connection, tool registry,            │            │
│   │    usage tally, deliverable buffer, async-job tracker (durable in SQLite)    │            │
│   │  CapabilityManager: object→tool grants; tool callable only while seated      │            │
│   │  PermissionBroker + Sandbox: default-deny prompts; jailed workspace dirs     │            │
│   │  CostEngine + RateCard: real usage → $; live estimate → reconcile to final   │            │
│   │  Provider adapters ──► OpenRouter (default) | Anthropic | OpenAI | OpenClaw   │            │
│   │  Persistence: SQLite (agents, placements, transcripts, ledger, jobs)         │            │
│   └─────────────────────────────────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
        │ (credits mode only)
        ▼
  gen-gateway (hosted proxy) ── holds upstream keys server-side, meters tokens,
                                applies markup, decrements credit ledger, Stripe billing
```

**Why Tauri:** ~3–10 MB installers vs Electron's ~85–150 MB (uses the WebView2 runtime already on Win10/11); first-class signed installer + auto-updater; the v7 frontend is plain canvas/IIFE with almost no DOM dependency, so it drops into the webview unchanged; lower RAM matters because we also run a Node host and possibly Docker.

**Why a Node sidecar (not Rust, not webview):** the entire agent ecosystem (Anthropic/OpenAI SDKs, OpenRouter, MCP clients, the user's existing OpenClaw setup) is JS/TS-native — reimplementing in Rust is wasted effort. Agents must live **outside** the webview because secrets and tool execution can never be renderer-reachable.

**Why WS carrying `U.bus` events:** v7 is already a pure event-bus architecture. If the bridge re-emits real events under the same names the frontend already subscribes to, WORLD/RENDER/PROPTERM need almost no change. WS (vs Tauri IPC) is natural for server→client token streaming and keeps the host portable.

**Why OpenRouter default:** the vision explicitly wants "GPT 5.5, Opus 4.8, Fable 5, any via OpenRouter." One key unlocks all slugs and returns normalized usage + per-call cost, which feeds the meter honestly. The user already runs OpenRouter locally.

> **Model-id note:** the in-fiction model names ("Opus 4.8", "Fable 5", "GPT 5.5") must map to **real, current** provider slugs at build time — do not hardcode the v7 fake `DATA.MODELS` ids. Resolve live model ids and per-token pricing from the provider (OpenRouter `/models`) at runtime into the `RateCard`. When wiring the Anthropic/Claude adapter specifically, verify current model ids, pricing, streaming-usage fields, and tool-use format against the live Claude API reference rather than memory.

---

## 4. The Core Abstraction: Room Objects → Agent Capabilities/Tools

A placed object is a **typed capability grant** and a **security boundary** in one. This is the product's central metaphor *and* its least-privilege model: an agent can call a tool **only while physically seated at an object that grants it**. No computer placed → no compute, period. Remove the object → revoke the capability. The room is the visible allow-list.

**Object schema** (runtime, replaces v7's static `furniture[]` literals):
```
ObjectInstance {
  id, type, tile{x,y}, footprint{w,h}, rot,
  seat?{tile,facing}, workAnchor?{tile,facing},
  grants:[toolId], sandbox{kind, scope}, spriteKey, ownerAgentId?
}
```

### Starter object → tool table

| Object (sprite) | Grants (real tools) | Sandbox / scope | Safety gate | Phase |
|---|---|---|---|---|
| **Computer / workstation** (`pixelrig`,`desk2`) | `model.chat` (run the agent's LLM), `agent.think` | Model call only — no host access | Always-on once seated; this is the baseline "is working" object | **P1** |
| **Terminal / console** (`desk`,`console`) | `shell.exec`, `code.run` | Docker/WSL2 container **or** restricted subprocess, jailed to `workspaces/<agentId>/`, no host mount, network allowlist, CPU/mem caps | Default-deny **per-action prompt** (allow once / session / always this agent / deny) | **P3** |
| **Filing cabinet** (`cabinet`) | `fs.read`, `fs.write`, `fs.list` | Confined to `workspaces/<agentId>/` only | Prompt on first write per session; reads within jail auto-allowed | **P3** |
| **Uplink / satellite dish** (`dish`) | `web.fetch`, `web.search` | Domain **allowlist**; no localhost/private-IP ranges | Prompt per new domain; treat fetched content as untrusted (prompt-injection surface) | **P3** |
| **Easel / render station** (`holotable`) | `image.generate` (PixelLab/image API) | API call; output written to jailed workspace | Cost-gated (counts against credits); no host access | **P3** |
| **Comms desk** (`djbooth`→repurpose) | `email.send`, `message.post` | Allowlisted recipients/endpoints only | Explicit per-recipient confirm; off by default | **P4 / aspirational** |
| **Mailbox / outbox** (`belt`) | `deliverable.publish` (save to disk + show in-game) | Local disk only by default | None for local save; publishing to external services (Printify/Medium/etc.) is **out of scope for v1** | **P3** |

**Non-negotiable safety defaults (shipped builds):**
- **Default-deny.** The dev `bypassPermissions: true` in `~/CLAUDE.md` is for *this* dev instance only and must **never** ship. Shipped default is prompt-on-first-use per capability.
- **Sandboxed workspace.** All shell/file ops confined to a per-agent directory; no arbitrary-path access without explicit escalation.
- **Object-gated tool set.** The agent runtime exposes to the model **only** the union of tools granted by objects the agent is currently seated at — enforced in the sidecar before any tool dispatch, not in the renderer.
- **Untrusted content.** Web-fetched content and deliverables are treated as prompt-injection vectors; they cannot silently widen capability.

---

## 5. Gamified Onboarding & Core Loop (Screen by Screen)

Onboarding is a **diegetic 6-screen ritual** ("CRADLE BAY"), never a settings form. It renders over the reused `#boot` CRT overlay layer, reusing `bootSeq()` typewriter, SFX, and the chat-input UI. The boot click-gate already solves the WebAudio autoplay unlock the wake-up sound needs.

| Screen | Name | What happens | Reuses |
|---|---|---|---|
| **S1** | **INTAKE** — model pick | Diegetic "core uplink" cards list real OpenRouter models with **real per-token pricing** and a one-line temperament blurb. Captures `{modelId, vendor, pricing}`. | `.term` card styling; `DATA.MODELS` *shape* (real ids/pricing, not fake ranges) |
| **S2** | **FORGE** — avatar design | Two tracks on one screen. **(A) INSTANT:** live hue/sat/bright + scale sliders over the recolored base minion (`filterFor`/`tintFrames` already does this, zero latency) — selected by default so the agent can wake immediately. **(B) FORGE:** PixelLab text-prompt generation that hot-swaps real frames in when ready (~2–5 min, async). | `assets.js` recolor engine verbatim; PixelLab MCP `create_character`/`animate_character` |
| **S3** | **DESIGNATION** — name | Single themed text input; validate uniqueness. | `.fb-note`/`#chat-input` styling |
| **S4** | **IGNITION** — wake-up | The "baby waking up" beat: fade/scale-in the avatar (reuse `@keyframes rt-power`), play SFX, then `WORLD.mkBody()` drops it onto the floor. **Must wake as the slider-recolored minion**; PixelLab avatar hot-swaps in later. | `#boot` overlay, `@keyframes`, SFX |
| **S5** | **PURPOSE** — interview | A **real** "midwife" orchestrator chat asks what the agent is for, in newborn framing. A `ConfigCompiler` turns the transcript into a structured `AgentConfig {role, goals[], allowedTools[], constraints[], tone}` and templates it into the **real system prompt**. The raw chat is stored as "first memories." | `#chat-input` + bubbles; `playerMessage()` entry point with body swapped for a real model call |
| **S6** | **COMMISSION** — review | Show the compiled system prompt, **editable** (so the gamified extraction is auditable, not a black box). Confirm → agent enters the room. | window chrome |

### The core loop (post-onboarding)

1. The new agent **wanders aimlessly** in an empty room — it has no computer, so it *literally cannot work*. This withholding is the tutorial: the empty room creates the desire to place an object.
2. The user opens **BUILD MODE**, drags a **COMPUTER** from the inventory tray, sees a ghost preview snapped to the tile grid with green/red validity (`walkable` + footprint-free), and places it. Placement registers a sit tile + facing + work anchor and incrementally updates `zoneGrid`/`blocked`/`sitTiles`/`pwGrid`, then re-bakes.
3. The user gives a **directive** (chat) or the agent has a scheduled job. A real task is dispatched.
4. The agent **paths to the computer, sits, and `b.working` flips true** — driven by a real model call in flight.
5. The user **clicks the agent** → the prop-terminal opens as a live session (real streamed tokens, real tool lines, real cost). Ambient $/hr chip floats over the agent's head; topbar shows live spend + credits remaining.
6. **Growth:** shipped work / credits spent earn Station XP → unlock buyable room modules and additional Cradle slots → recruit more agents through the same ritual. The full 17-agent StarNet station is the **ghosted "destiny" silhouette** the crew grows into.

---

## 6. How a Real Agent Run Maps to Movement + Live Terminal + Cost

This is the heart of "truthful telemetry" — every visual is bound to a real event.

```
USER DIRECTIVE / SCHEDULED JOB
   │  (game-time is DECOUPLED: real calls fire ONLY on real triggers, never per game-minute)
   ▼
host: SessionManager.dispatch(agentId, task)  ── creates durable RunJob (reload-safe)
   │
   ├─► WS: agent.run.start ──► U.bus.emit('agent.run.start')
   │        WORLD: plan a walk to the computer's workAnchor  →  goTo(seatTile)
   │
   ├─ agent arrives & sits ──► WORLD.arrive(): state='work', sitting=true
   │        (think() now PINS the body at the desk while a real call is open —
   │         treats an open call exactly like the old hasTask, so it never wanders mid-call)
   │
   ├─► model call opens ──► b.working = SessionManager.hasOpenCall(agentId)  [was !!SIM.taskId]
   │        drawBody picks the 'type'/'sit' track facing north; CRT screen lights (f.work)
   │        — the typing animation now LITERALLY means "a model call is in flight"
   │
   ├─► streaming tokens ──► agent.token deltas
   │        PROPTERM: a TYPEWRITER BUFFER drains real tokens at a steady ~7fps visual rate
   │        (decouples smooth typing from bursty network arrival); appends to a STABLE
   │        scrollback element (not the 1Hz innerHTML rebuild) so long transcripts don't thrash
   │
   ├─► tool_use start/result ──► agent.tool_call
   │        PROPTERM: real '▶ shell.exec {...}' / '◀ exit 0 (1.2s)' lines (was random pools)
   │        WORLD: act string = the real tool name (was authored narration)
   │
   ├─► usage deltas ──► agent.cost (LIVE ESTIMATE)
   │        CostEngine.price(usage, rateCard) → live $ estimate
   │        PROPTERM meters #ft (TOK)=real tokens, #fm (COST)=real $, #fx (CTX)=real ctx-used/window
   │        (replaces st.tok counter, estCost interpolation, ctxPct formula)
   │
   └─► agent.run.end ──► RECONCILE: overwrite ag.spent with provider's FINAL usage*rate
            (streaming deltas ≠ final billed usage — cache/thinking/tool tokens — so the
             committed ledger is the authoritative number, never the streamed estimate)
            WORLD: stand, clear act; deliverable written to disk, artifact ref stored
            CostHUD: decrement credits; topbar spend updates; dossier sparkline ticks
```

**The four named seams being rebound** (from the analyses):
- `agents.js:471` `hasTask = !!ag.taskId` → `SessionManager.hasOpenCall(agentId)`.
- `propterm.js` `nextLine()` (the #1 streaming seam) → consume a real per-agent event queue.
- `propterm.js` `estCost`/`ctxPct`/`st.tok` → real usage from the provider.
- `sim.js` `taskCost()`/`DATA.DAILY_SUBS` → `CostEngine` + `RateCard`.

---

## 7. Monetization & Safety Summary

**Billing — ship BYOK-first, credits-second (hybrid).** Both paths feed **one `CostEngine` and one in-game spend UI**; only the *source of the dollar number* and *who holds the upstream key* differ, so shipping BYOK first costs nothing toward the credits build.

- **BYOK (launch default):** user's OpenRouter/Anthropic key stored in OS keychain locally, real usage read straight off the provider response (markup = 0). Ships in weeks: zero proxy infra, zero upstream-key custody, zero payment/PCI/money-transmitter exposure. Makes "see how much it's costing you" trivially honest.
- **Credits ("Station Pass", $50/mo, opt-in):** all traffic routed through a thin hosted **gen-gateway** proxy that holds upstream keys server-side, authenticates the app with a short-lived per-account token, meters tokens, applies markup, decrements the ledger atomically, and streams back. **The desktop app never ships an upstream key.** Stripe-backed; credits non-refundable / non-cash / single-purpose / expiring to minimize stored-value regulatory exposure.
- **Cost honesty:** show a live streaming *estimate*, then **reconcile to the provider's final usage report** before committing to the ledger.

**Repurpose v7's existing billing surfaces** — `LEDGER` agent, `treasury_ledger` window, `BURNED` (`ag.spent`), `TOP BURNERS`, `DAILY LEDGER` — by swapping their data source from RNG to the real `CostEngine`. Add a **CREDITS REMAINING** gauge + low-balance warning to the topbar (repurposing the revenue/NET slot). Drop simulated revenue entirely: the economy becomes **credits-spent + deliverables-shipped**.

**Safety (mandatory, not optional):** object-gated capabilities + default-deny per-action prompts + sandboxed per-agent workspace + domain allowlist. Hard **spend backpressure** (concurrency cap, per-run/per-day budget guard, credit-balance gate before dispatch, retry-loop limit) replaces v7's cosmetic 5-job cap. Code-signed binary + signed auto-update channel are security-critical for a tool that executes real code. Transcripts local-only by default; explicit opt-in before anything leaves the device; secrets redacted from logs. Vendor the VT323 font locally (the CDN dependency breaks the offline promise).

---

## 8. Phased Roadmap

Each phase lists **deliverables**, **v7 files to port**, and a **definition of done (DoD)**. Phases are ordered to validate the central bet (Section 1) as early as possible — Phase 1 proves a real agent run drives the reused world before any onboarding or billing work.

### Phase 0 — Scaffold + reuse the v7 engine
**Goal:** the v7 station runs inside a Tauri webview talking to a Node sidecar over WS, still visually identical, with the fake `SIM` swapped for a stub adapter.
- **Deliverables:** Tauri project + WebView2 host; Node sidecar spawned/supervised by Tauri; localhost WS handshake (random port); v7 frontend dropped in unchanged; `SIM` replaced by a **stub WS bridge** that re-emits canned events onto `U.bus` (proves the seam); VT323 vendored locally; SQLite initialized in app-data dir.
- **Port from v7:** `util.js`, `map.js`, `agents.js`, `render.js`, `assets.js`, `sprites.js`, `ui.js`, `propterm.js`, `css/style.css`, `index.html`, `assets/sprites/*` — all near-verbatim. Replace only `sim.js` + `main.js` boot wiring.
- **DoD:** app launches as a signed-dev build, the station renders and animates, an agent walks/sits when the stub bridge emits a fake `agent.run.start`, and the webview never imports a secret. The "swap SIM for an event adapter" bet is demonstrated end-to-end with stub data.

### Phase 1 — One real agent, one room, one working computer, real streaming + cost
**Goal:** prove the whole truthful-telemetry chain with a single hardcoded agent and a single placed computer. **This is the make-or-break phase.**
- **Deliverables:** `SessionManager` runs a real OpenRouter model call for one agent on a user directive; `agent.run.start/.token/.tool_call/.cost/.run.end` flow over WS; `b.working` rebound to `hasOpenCall`; PROPTERM shows real streamed tokens via a **typewriter buffer** into a **stable scrollback**; real **TOK/COST/CTX** meters with **final-usage reconciliation**; one runtime-placeable COMPUTER object with incremental grid updates + re-bake; `CostEngine` + `RateCard` (BYOK, markup 0); durable `RunJob`; spend/concurrency backpressure; **game-time decoupled** (the `minuteTick` task generator is deleted, not rebound).
- **Port from v7:** `propterm.js` (`streamHTML`/`feedHTML`/`fastTick`, replace `nextLine`/`estCost`/`ctxPct`); `agents.js` (`goTo`/`arrive`, rebind `think()` `hasTask`); the `F.pixelrig`/`desk2` furniture art; `ui.js` `openAgent` dossier + `LEDGER`/`treasury_ledger` surfaces.
- **DoD:** the user types a directive, a single agent walks to a placed computer, sits, and a **real Opus/GPT call streams into the terminal** while a **real $ meter** climbs and reconciles to the provider's final bill on completion; a real deliverable file is written to disk and referenced. No fake numbers anywhere in the chain.

### Phase 2 — Onboarding / character creator
**Goal:** the user creates their first agent in-fiction; agents are dynamic, not a hardcoded roster.
- **Deliverables:** Cradle Bay S1–S6; live avatar recolor sliders; PixelLab FORGE track with hot-swap + generalized readiness gate (per-agent, not hardcoded `minion.rot.south`); `ConfigCompiler` (interview → editable real system prompt); first-run gate (no agent → onboarding, else boot); dynamic single-agent roster with **null-guards** for missing buddies/rooms/stations/belts (the journey planners assume the 17-agent station).
- **Port from v7:** `main.js` `#boot`/`bootSeq`; `assets.js` `filterFor`/`tintFrames`/`drawBody`; `ui.js` chat input; `@keyframes rt-power`.
- **DoD:** a brand-new user lands in Cradle Bay, picks a model, designs an avatar, names it, watches it wake, gives it purpose via real chat, edits the compiled prompt, and it drops into a room — then Phase-1's loop works for that user-created agent.

### Phase 3 — Object → tool expansion + multi-agent
**Goal:** the room becomes a real capability surface; multiple agents coexist.
- **Deliverables:** full BuildMode + inventory tray (place/move/pick-up, ghost preview, validity); `CapabilityManager` (object→tool grants, seated-only enforcement); `PermissionBroker` + sandbox (terminal→jailed shell, cabinet→jailed fs, uplink→allowlisted web, easel→image gen); **camera** (pan/zoom; `toLocal` inverts the transform); StationGrowth (XP→room modules + Cradle slots); multiple concurrent agents with per-agent session keying; reconciled flush semantics (a cancelled walk must **not** fire a real paid action or mark a deliverable shipped).
- **Port from v7:** `sprites.js` `F{}` furniture art for new objects; `map.js` zone model extended to runtime-addable modules; `agents.js` `scanWorld` for multi-agent ambience; XP/level/milestone engine from `sim.js` (rewards re-pointed to real capacity).
- **DoD:** a user places a terminal, an agent runs a **real sandboxed shell command** (after a permission prompt) and writes a file to its workspace; two agents work concurrently without racing; the camera pans a room larger than 936×674; placing/removing objects grants/revokes capabilities live.

### Phase 4 — Billing/credits + packaging/distribution
**Goal:** real recurring revenue and a shippable, auto-updating signed product.
- **Deliverables:** `gen-gateway` hosted proxy (server-side keys, metering, markup, atomic ledger, hard balance stop); Stripe Station Pass + top-ups; credits-mode CREDITS REMAINING gauge + low-balance/austerity warnings; account flow (credits only; BYOK needs none); code-signed MSI/NSIS installer; signed auto-update channel; first-run mode picker (BYOK vs Station Pass); privacy/ToS, markup disclosure, transcript opt-in.
- **Port from v7:** topbar revenue/NET slot → CREDITS; `earn()`/`S.costs` accounting seam → real credit decrement; `treasury_ledger` UI finalized.
- **DoD:** a user installs the signed app, subscribes, runs agents on managed credits with a live in-game gauge that matches their Stripe bill, and receives a signed auto-update — or chooses BYOK and runs with their own key, no account.

---

## 9. Proposed `gen/` Folder Structure

```
gen/
├─ src-tauri/                        # Rust desktop shell
│  ├─ src/main.rs                    # window host, sidecar supervisor, keychain broker
│  ├─ tauri.conf.json                # signing, updater, bundle (MSI/NSIS)
│  ├─ icons/
│  └─ Cargo.toml
│
├─ frontend/                         # the webview (v7 reused, near-verbatim)
│  ├─ index.html                     # ported grid + #boot/#cradle overlay layer
│  ├─ css/
│  │  ├─ style.css                   # ported theme + CRT
│  │  └─ fonts/VT323.woff2           # VENDORED (no CDN)
│  ├─ js/
│  │  ├─ util.js                     # ported: U.bus, SFX, helpers
│  │  ├─ map.js                      # ported + MUTABLE world API (add/move/remove, re-bake)
│  │  ├─ agents.js                   # ported WORLD; b.working ← hasOpenCall; null-guards
│  │  ├─ render.js                   # ported frame loop + CAMERA (pan/zoom)
│  │  ├─ assets.js                   # ported SPRITES recolor/anim (avatar designer backend)
│  │  ├─ sprites.js                  # ported F{} furniture + procedural fallback
│  │  ├─ ui.js                       # ported chrome; LEDGER/dossier repurposed
│  │  ├─ propterm.js                 # ported windows; nextLine→real events; meters→real usage
│  │  ├─ bridge.js                   # NEW — WS client; replaces SIM; emits real → U.bus
│  │  ├─ cradle.js                   # NEW — onboarding S1–S6 controller
│  │  ├─ build-mode.js               # NEW — placement UI, inventory, ghost preview
│  │  ├─ cost-hud.js                 # NEW — ambient chip, topbar credits, dossier
│  │  └─ boot.js                     # NEW — first-run gate + ported bootSeq
│  └─ assets/
│     ├─ sprites/{minion,ultron}/    # ported base frames + manifest.json
│     ├─ agents/<agentId>/           # per-user generated avatar frames + manifest
│     └─ furniture/                  # object sprites (or procedural via sprites.js)
│
├─ sidecar/                          # Node.js agent host (owns secrets)
│  ├─ index.js                       # WS server, sidecar lifecycle
│  ├─ session-manager.js             # real model→tool→stream loop; durable RunJobs
│  ├─ capability-manager.js          # object→tool grants; seated-only enforcement
│  ├─ permission-broker.js           # default-deny prompts; per-agent grants
│  ├─ sandbox/                       # jailed shell/fs (Docker/WSL2 or restricted subprocess)
│  ├─ providers/                     # openrouter.js, anthropic.js, openai.js, openclaw.js
│  ├─ cost-engine.js                 # usage→$, live estimate + final reconcile
│  ├─ rate-card.js                   # live per-model pricing (BYOK card / credits card)
│  ├─ config-compiler.js             # interview transcript → system prompt
│  ├─ pixellab-bridge.js             # PixelLab MCP → per-agent manifest
│  └─ db/                            # SQLite schema + migrations + artifact store
│     ├─ schema.sql
│     └─ workspaces/<agentId>/       # jailed per-agent file workspace
│
├─ gen-gateway/                      # hosted proxy (credits-mode only; deploy separately)
│  ├─ server.js                      # upstream keys, metering, markup, ledger
│  └─ billing/                       # Stripe, credit ledger
│
├─ shared/                           # types/event schema shared frontend↔sidecar
│  └─ events.js                      # U.bus / WS event vocabulary (single source of truth)
│
└─ package.json / README.md
```

---

## 10. Top Risks + Consolidated Open Product Decisions

### Top risks (with the mitigation already baked into the plan)
1. **Cost honesty is load-bearing** — streamed token deltas ≠ final billed usage (cache/thinking/tool tokens). *Mitigation:* live estimate during stream, reconcile to provider final before committing (Section 6).
2. **Sandbox escape / destructive tools** — a "terminal" granting shell is the highest-risk capability; Docker may be absent on consumer Windows. *Mitigation:* default-deny prompts + jailed workspace + allowlist; graceful "shell unavailable until WSL2 enabled" fallback so placing the object never silently runs unsandboxed.
3. **Runaway spend** — real async paid calls + game-time fan-out can burn credits fast. *Mitigation:* game-time fully decoupled from call cadence; hard concurrency/budget/balance gates; retry-loop limits.
4. **Secrets in a downloadable binary** — any embedded upstream key is extractable. *Mitigation:* BYOK key in OS keychain read only by sidecar; credits-mode keys server-side behind the proxy; never in client code or the save blob.
5. **Placement fights v7's bake-once world + no camera** — placing objects requires incremental `zoneGrid`/`blocked`/`sitTiles`/`pwGrid` updates + re-bake (no invalidate API today), and rooms can exceed the fixed 936×674 buffer. *Mitigation:* build the mutable-world API + camera in P1/P3 deliberately.
6. **Single-agent breaks fixed-17 assumptions** — stations/buddies/HERALD ceremonies/belts assume the full roster. *Mitigation:* null-guards + dynamic station allocation in P2.
7. **Streaming cadence + transcript growth** — bursty network vs smooth ~7fps typing; 1Hz innerHTML rebuild thrashes long transcripts. *Mitigation:* typewriter drain buffer + stable append-only scrollback (P1).
8. **PixelLab latency/palette** — async ~minutes, credit-billed; global hue-rotate distorts multi-color palettes. *Mitigation:* wake as recolored minion, hot-swap later; prefer generating final-colored avatars over hue-rotating.
9. **Regulatory (credits)** — prepaid stored-value can trigger money-transmitter rules. *Mitigation:* BYOK launch sidesteps it; credits non-refundable/non-cash/single-purpose/expiring; legal review before scaling.
10. **Code-signing / update channel** — an unsigned or hijackable updater is a supply-chain attack vector for a tool that runs real code. *Mitigation:* EV/OV cert + signed update manifests from day one of distribution.

### Open product decisions the user must make (deduped, decision-ready)

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| **D1** | **Billing at launch:** BYOK-first / credits-first / hybrid? | **Hybrid, BYOK default.** Fastest + zero key/billing/regulatory liability; credits is a flip-the-switch upgrade. | Whether you need any cloud backend for v1 (Phase 4 vs not). |
| **D2** | **Credit margin model:** margin from breakage, or a markup applied on every call? | **Markup on every call**, disclosed in-app. Sustainable; breakage-only is fragile. *(Rate redacted — pricing internals live in the private billing repo, not here.)* | Unit economics + in-game meter framing. |
| **D3** | **Credit policy:** rollover? refundable? | **Expire monthly, non-refundable, single-purpose.** Minimizes stored-value exposure. | Legal posture; UX goodwill tradeoff. |
| **D4** | **When does an agent actually run?** Pure-pull (directive only) / scheduled / autonomous self-initiation? | **Pull as the default; scheduled as opt-in; autonomy a per-agent toggle granted at onboarding.** Autonomy is the scariest for spend. | Trigger model in `SessionManager` (P1/P3). |
| **D5** | **Tool scope at v1:** model+image only, or also shell/fs/web? | **Computer (model) only in P1; terminal/cabinet/uplink in P3 behind prompts.** Staged by object placement. | Sandbox effort; safety surface. |
| **D6** | **Sandbox strictness:** workspace-dir-only, or broader behind prompts? | **Workspace-dir-only by default; broader access is explicit advanced-mode escalation.** | "Do real work on my computer" scope vs safety. |
| **D7** | **Multi-agent coordination:** real inter-agent messaging/orchestration, or independent workers with cosmetic org? | **Independent workers in v1; HERALD/ULTRON walk-choreography as flavor.** Real orchestration is a large scope jump — defer. | P3 scope. |
| **D8** | **Single-room vs multi-room for v1:** reuse fixed station + placeable objects, or full data-driven world + camera now? | **Placeable objects in the existing room for P1; camera + room modules in P3.** | P1 vs P3 size. |
| **D9** | **Deliverable destinations:** disk-only, or wire real publishing (Printify/Fiverr/Medium/YouTube)? | **Disk-only + show in-game for v1.** External publishing is aspirational set-dressing — out of scope. | P3 tool list. |
| **D10** | **Quality/review signal:** human approval only, or add a real LLM-judge eval? | **Human (Commander) approval only for v1.** An eval itself costs tokens — defer. | Feedback-gate behavior. |
| **D11** | **Keep any simulated economy for game-feel?** | **No — fully truthful (credits-spent + work-shipped).** Station-growth is the reward substitute for "money goes up." | Right-panel/treasury UI. |
| **D12** | **Avatar generation default:** PixelLab core for everyone, or premium/credit-gated with sliders free? | **Sliders free + default; PixelLab FORGE credit-gated.** Protects first-launch pacing + credit economics. | Onboarding pacing. |
| **D13** | **Orchestrator ("ULTRON") cost:** charged to user credits, bundled, or run on a cheap fixed model? | **Cheap fixed model, bundled into base** so directive-parsing doesn't surprise-bill the user. | Cost engine routing. |
| **D14** | **Who bears failed-call cost** (errors/timeouts/refusals still bill tokens)? | **Platform absorbs retries in credits-mode; BYOK users see real provider behavior.** | Trust + margin. |
| **D15** | **Platforms:** Windows-only at launch, or cross-platform? | **Windows-only at launch** (matches the user's environment). Defer mac/Linux signing/notarization. | Signing/sandbox effort. |

**Decisions to lock before Phase 1 starts:** D1, D4, D5, D8 (they shape the SessionManager trigger model, the v1 tool/object scope, and whether the camera is in scope). The rest can be settled by the end of Phase 2.