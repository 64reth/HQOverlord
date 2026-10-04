# Settings & Customization Surface Gap Audit — 2026-07-01

**Question answered:** "StarNet feels shallow on customization/tuning/permissions vs the reference harness,
and is missing integration UI + small details. What exactly is missing, and what should we build?"

**Method:** code-level diff of the full user-facing configuration surface in both repos —
the reference harness reference clone (`C:\Users\<you>\harness-ref`, ~150+ config keys / 15 settings panels)
vs StarNet (`Desktop\gen`, ~140 controls across 14 terminal windows). Plan docs were NOT
trusted; every "backend exists" claim below was re-verified by grep on 2026-07-01.
This is a different layer than the prior the reference harness audits (engine parity H1–H6) — those compared
runtimes; this compares **knobs and UI affordances**.

**Headline finding:** the recurring StarNet theme holds again — **wiring, not architecture**.
The five biggest "missing" features already have complete backends with zero or partial UI.
StarNet's *count* of controls is close to the reference harness (~140 vs ~150); what's missing is
(a) surfacing engines we already built, (b) per-agent depth, and (c) the small-affordance
layer (test buttons, help text, import/export) that makes a settings surface feel deep.

---

## P0 — Wire what already exists (backend done, UI missing) — cheapest, biggest wins

| # | Feature | Backend (verified) | UI today | Build |
|---|---------|--------------------|----------|-------|
| 1 | **Generic MCP connector manager** | `sidecar/mcp/manager.js` + `client.js` + stdio/http transports | ~~CONNECTORS panel has **Spotify only**~~ **✅ SHIPPED 2026-07-02** (trunk `74ca901`) | **AUDIT DRIFT:** a generic MCP list/add/remove/refresh UI with tools preview already existed in `stationui.js buildConnectors` — the "Spotify only" claim was false. Real gaps (now built): stdio transport in the add form, custom http headers, per-connector timeout, EDIT flow, inline help, per-row RELOAD. Header/env values are redacted in every summary. |
| 2 | **Budget dials + spend meter** | USD caps enforced: perRun/perAgent/perDay/global (`sidecar/index.js:182-185`, `budget.js`, `ledger.jsonl`) | **✅ SHIPPED 2026-07-02** (`43f8d9c`) | SETTINGS → BUDGET: 4 caps + spent-today/lifetime off the real ledger; persisted `budget.json`, live-applied via `budget.setCaps`, env = default, saved 0 = no cap. DRIFT: "#11 re-home budget readout" had nothing to re-home — `/api/budget/status` had zero frontend consumers; this is the first budget UI. |
| 3 | **Fallback model chain** | Loop consumes `fallbackModels` — consumption is `loop.js:262-303` NOT index.js (file has a NUL byte; `grep -a`); triggers = overloaded/500/404 + auth/402/429 rotation (`errorClass.js:31-43`) | **✅ SHIPPED 2026-07-02** (`d72176f`) | SETTINGS → MODELS: ordered chain (add-from-catalog, reorder, 8 cap), persisted `fallback.json`, saved > env, saved-empty = explicit OFF, warn-not-refuse on unknown ids; runOnce seam so ALL entry paths honor it. DRIFT: failover surfacing (⤳ toast, floorstats) already existed. |
| 4 | **Discord channel card** | `channels/discord.js` + `discord.transport.js` written + tested; never started in `index.js` | **✅ SHIPPED 2026-07-02** (`9763ce8`) | DRIFT: adapter WAS already registered/auto-started (H6.2); real gap = no `/api/channels/discord/*` endpoints + no card. Both built (mirrors Telegram card; token never echoed). **HONEST LIMIT: send-only** — no WS gateway client, inbound inert; card discloses it. Follow-up chip filed for the gateway client. |
| 5 | **Standing-approvals ledger** | "always" answers to mid-run prompts persist as grants (`permgrants.js:5`) | **✅ SHIPPED 2026-07-02** (`0c7a3cb`) | DRIFT: non-curated grants were ALREADY listed with revoke; real gaps = no provenance, unreachable empty state, no destructive-confirm. Built: additive `meta.grantedAt` (legacy files load, render "granted earlier" — never fabricated), teaching empty state, arm-confirm revoke. Prompt/run provenance still NOT persisted (would need consent-flow changes — future). |

## P1 — Build (missing on both sides of the wire, on-moat)

| # | Feature | Why it matters |
|---|---------|----------------|
| 6 | **Per-agent model/provider/effort override** | Model is station-global today ("no per-run model override" is by design, but per-AGENT is not). Multi-agent crew is the core fantasy — cheap model for the scout, expensive for the lead — and it plays directly into leveling/XP. the reference harness has per-task auxiliary routing + delegation model overrides. Natural home: DOSSIER › CONFIG tab. |
| 7 | **Config export/import/reset-to-defaults** | None today. Cheap to build, huge "polished harness" signal, and it *feeds the marketplace GTM* — an exported station setup is a shareable recipe. the reference harness: top-level Export/Import/Reset buttons. |
| 8 | **Notification preferences** | NOTIFICATIONS panel is history-only. Add per-kind toggles, completion-sound picker, and a TEST button. the reference harness has all three; small-details feel. |
| 9 | **ADVANCED runtime knobs section** | Consent timeout, max iters, agent concurrency, cron tick/timezone are env-only (`STARNET_CONSENT_TIMEOUT_MS`, `STARNET_MAX_ITERS`, `STARNET_MAX_CONCURRENT_AGENTS`, `STARNET_CRON_TZ`). Beginners can't edit env vars — surface them in a collapsed ADVANCED block, persisted server-side, defaults untouched. |
| 10 | **Memory controls** | No user knob on memory at all (adaptive by design, but zero visibility = "app lies" risk). On/off + budget + a "what it knows / what it's been told not to ask" view. Dovetails with the LOCKED memory-question-overhaul plan — the denylist/asked-state being built there needs a UI home anyway. |

## P2 — The small-details polish sweep (do as ONE lane, checklist style)

The "we lack the small details" feeling is mostly this layer. the reference harness has each of these on
essentially every settings row; StarNet has them sporadically:

- [ ] **Test-connection button** on every provider key card (today: paste-and-pray for 13 BYOK providers; only Codex/Telegram give live status)
- [ ] Show/hide toggle on masked keys + copy-to-clipboard
- [ ] Per-field reset-to-default
- [ ] One-line inline help under every setting (the reference harness has field descriptions everywhere)
- [ ] Consistent saved/error toast on every settings change (some flash 💾, some silent)
- [ ] Consistent destructive-action confirm (cron delete has arm-confirm; key REMOVE and others don't)
- [ ] Timezone picker on the ROUTINES create form (env-only today, silently defaults)
- [ ] Deep-link/scroll-to-setting support (the reference harness: URL-param + flash highlight)

## Deliberately NOT copying (protect the beginner moat)

- 20+ channels, terminal backends (docker/ssh/modal/daytona), OpenRouter provider-routing
  depth, response-cache TTLs, prompt-caching knobs, human-delay pacing, tirith scanner,
  Honcho/Mem0 cloud memory, VS Code theme marketplace, personality presets (our 4 dossier
  markdown files are strictly richer).
- **Principle:** capability-via-placed-objects IS StarNet's permission allowlist. Do not
  flatten world mechanics into menus. Only pure numbers (budgets, timeouts) and pure
  integrations (MCP, channels) belong in SETTINGS; anything an object can gate stays an object.

## Product forks — Andrew decides (not silently built)

1. **Voice settings surface** — the reference harness ships 10+ TTS / 6 STT providers with full config UI.
   StarNet voice is design-DNA level with no config surface. Whole-subsystem scope decision.
2. **Real project-folder access** — the reference harness has cwd picker + env passthrough; StarNet jails
   workspaces by design. The beginner zero-to-value audit says real-work value eventually
   needs the user's real files. This is a sandbox-philosophy fork, not a settings gap.

## How we keep finding these (recurring process)

1. **This doc is the parity checklist** — re-run the two-sided enumeration after any major
   `git -C C:\Users\<you>\harness-ref pull` (their release notes → grep our surface).
2. The P2 layer is best caught by the **Beginner Run loop** (fresh-eyes walkthrough) + the
   UI visual harness — pattern-match "did I get feedback? could I test it? was there help text?"
   on every settings interaction.
3. Any new backend env var or engine feature MUST answer "where does the UI show/set this?"
   at merge time — the P0 list above exists because five engines merged without that question.

## Execution

Worktree `agent/settings-parity` per protocol. Suggested order: P0-1 (MCP manager) →
P0-2 (budgets) → P0-4 (Discord) → P0-3/5 → P1-7 (export/import) → P2 sweep → P1 rest.

**STATUS 2026-07-02: the ENTIRE P0 tier is shipped to trunk** (74ca901 → d72176f), each
slice gate-green + live-verified on the dev seed. Meta-lesson: all five audit rows were
DRIFTED (every feature was partially built already); the grep-first agent briefs caught it
each time — keep that briefing pattern for the P1/P2 lanes. Next up when the lane resumes:
P1-7 config export/import → P2 small-details sweep.
All additive; no `shared/events.js` changes anticipated except possibly `mcp.server.*`
status events — request from the cortex-memory owner if needed.
