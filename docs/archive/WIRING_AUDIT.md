# StarNet — Feature Wiring Audit & Completion Plan

> **Generated 2026-06-20** by a 35-agent multi-domain audit (16 vertical-slice auditors +
> adversarial verifiers + synthesis). For each feature it traced the full vertical
> **UI control → sidecar route → engine work → contract event emitted → frontend listens/renders**
> and classified it WIRED / PARTIAL / COSMETIC / STUBBED / DEAD / MISSING with file:line evidence.
> High-severity "it's cosmetic/broken" claims were adversarially re-checked before being trusted.
> This is the **Axis-2 (polish/honesty) companion** to [PROJECT_STATE.md](PROJECT_STATE.md) (Axis-1 integration).

## Headline verdict

**The harness is far more genuinely wired than its "it lies" reputation suggested.** The core run
loop, multi-agent summon/dispatch, REFIT routing-as-permission-system, Cortex memory, Commander
dossier, the personalization moat, the safety spine, MCP connectors, save/checkpoint, **and even
voice** are all real, honest, end-to-end verticals. Nothing in the **safety, memory, or money**
paths is fabricated.

The gaps are **not scattered fakery** — they cluster into three patterns:

1. **ONE root architectural seam (the big one).** The **in-app COMMS directive** — the loop the
   user drives all day — never emits work-item / queue / run-broadcast events. Almost everything
   *visible on the floor* (conveyor belts, INTAKE jam, THRU/DWELL HUD columns, bay lighting, the
   routed-run economy fold, even the profile's heaviest learning signal) was wired **only to the
   Telegram channel path**. So for a default local user the most "alive" parts of the screen sit
   empty or fake while implying live work. **Fixing this one seam (P1) collapses ~5 of the 8
   biggest lies at once.**
2. **A tail of emit-but-never-consume events.** `cron.*`, `checkpoint.*`, `channel.connect`,
   `memory.recall`, `agent.reasoning`, `connector.state`, `permission.response` are emitted and
   SSE-broadcast but **no frontend listener renders them**. Pure consume-side wiring, mostly S-effort.
3. **Single-hero / Telegram-only assumptions** that break multi-agent honesty: outbound crate off
   the hero desk only, war-room crew dots off one global string, connector-portal pulse hero-only.

Plus three **stranded-on-branch absences**: the First-Command tutorial + coachmarks + Field Manual
(`agent/tutorial`), and the cron agent/provider picker (`agent/cron-agent-picker`).

## The 8 biggest lies (UI implies real; backend isn't) — worst first

| # | Lie | Root |
|---|-----|------|
| 1 | Belts / INTAKE jam / THRU-DWELL HUD only move for **Telegram** messages; the in-app task emits no `workitem.placed`/`queue.status`, so the pipeline the UI presents sits empty for the primary loop. | **P1** |
| 2 | Routed/cron runs never broadcast `agent.run.*`/`agent.cost`, so bay lighting + the economy fold for non-hero work run on a **cosmetic 4s timer + fabricated message-length "weight"** — contradicting the in-code claim that routed runs "arrive over the SSE bridge." | **P1** |
| 3 | **AIRLOCK "worktree isolation"** only seals the agent's *visual* pathing; there is **no sidecar consumer of door state** — a "SEALED" agent's real run/tools/caps are untouched, yet the prop promises real isolation. | **P6** |
| 4 | Profile's strongest learning signal (`workitem.delivered`, weight 3 — "shipped work folds heavier") **only fires on Telegram**; for the in-app user the heavy outcome-weighting is silently dead. | **P5** |
| 5 | Inbound **ORE crate mass is faked** from message-length (`preview.length/280`) and rides the same belt as a genuinely cost-driven PRODUCT crate — presented as peers. | **P4** |
| 6 | War-room **CREW dots pulse in lockstep** off ONE global `#chat-status` string + global pending-consent, ignoring the real per-agent run state `stationui.crewTick` already tracks. | **P3** (quick win) |
| 7 | **Concurrency**: UI lets you summon unlimited agents and dispatch advertises `parallel:true`, but the gate admits ≤ `MAX_CONCURRENT_AGENTS` (default 3, minus the lead's slot); excess workers silently "refused" — visible only in the model's tool result, not the summon UI. | **P4** |
| 8 | **REWIND** promises a snapshot "before every command / once this agent edits a file", but the general fs.write/edit checkpoint net is gated behind `SKYNET_CHECKPOINTS` (**default OFF**) — a default user who only edits files sees "NO RESTORE POINTS YET". | **P2** (quick win) |

## Wired & honest — DO NOT re-audit or "fix" (verified real end-to-end)

Core agent run loop (directive→stream→tool→cost-reconcile→run.end) · multi-provider (OpenRouter +
Codex OAuth) · run cancel + global HALT e-stop · cross-run budget pools + concurrency enforcement ·
**+SUMMON real concurrent agents** · **team.dispatch real isolated worker runs** + watchable floor
handoff · hero + crew render (crew bodies only exist for real bound/summoned agents) · Awakening
cinematic authoring real config docs · idle/awareness/eerie-look-up engines · **REFIT** place/route/
BAY→cap-isolation/FILTER/MERGER/INTAKE/connector_portal · ARCADE→game · COMMS chat→run→pinned reply ·
per-workstream concurrent run-state · **Telegram ingress** end-to-end · **Cortex memory** full loop
(recall fence → reflection proposes → Keep/Edit/Discard → commit/forget/trust + compaction) ·
**Commander dossier** built from real signals + injected into browser/worker/cron runs · **profile +
recipes + auto-mint** moat · **XP/Level/Confidence + ctx gauge + SPEND/YIELD/SLAG/CACHE** from real
reconciled events · durable save mirror + boot auto-resume · checkpoint rewind list+restore · backup
export/import + notebook restore · **MCP connector** live tools callable in a real run + portal live
state + bearer/SSRF guards · **safety spine** (e-stop aborts mid-stream, consent gates before the
tool runs, capability gate denies, autonomous exec-lockout, fs-jail, web_fetch SSRF guard, post-edit
verify) · **voice** full vertical (mic STT → run → neural TTS via /api/tts, per-persona voices,
hands-free loop, in-world speak/listen) · The Kindling + Awakening onboarding.

## Progress log

- **2026-06-20 — Quick-win batch ✅ MERGED to trunk** (`agent/wire-quick-wins`, merged via no-ff;
  gate green; verified live in preview). Closed: cron war-room pulse, checkpoint-restored toast,
  memory-recall chip, per-agent crew dots (new `StationUI.runningCount`), budget RESUME button, honest
  REWIND empty-state, live `channel.connect` health. Frontend-only; no contract/sidecar change. **Not
  pushed to origin.**
- **2026-06-20 — P1 keystone ✅ MERGED to trunk** (`agent/wire-inapp-loop`, two commits, no-ff;
  gate green; slice 1 live-verified). **Slice 1** (frontend): the in-app COMMS directive now emits its own
  `workitem.placed`/`queue.status`/`workitem.delivered` on U.bus → the conveyor, INTAKE jam, THRU/DWELL
  HUD and QUEUE reflect the primary loop, not just Telegram; `delivered` fires only on a clean finish
  (verified across success/error/max_iters), pairs DWELL by `workitemId`, and now grants the in-app
  ship-signal + "first task shipped" milestone (closes part of **P5**). **Slice 2** (sidecar): `runOnce`
  gains an opt-in `o.broadcast` flag (set only at the hub's routed/Telegram call site) that mirrors
  `agent.run.start/cost/end` to the floor over SSE — routed bays light + economy folds from real events.
  Double-render-safe: the hero `directive` run + manual/scheduled cron never set the flag. Closes the two
  root "biggest lies" (#1, #2). **Not pushed to origin.**
- **2026-06-20 — P4 ✅ MERGED to trunk** (`agent/wire-honest-mass`, no-ff; gate green; verified live).
  **Ore mass (lie #5):** the inbound ORE crate is now a uniform raw chunk (weight 0.3) — the message-length
  fake is gone; only the cost-driven green PRODUCT crate's size means real money (the inbound box is consumed
  at run START, before any cost exists, so it genuinely can't carry cost). **Concurrency ceiling (lie #7):**
  new `GET /api/limits` exposes the real `MAX_CONCURRENT_AGENTS`; the summon bay header now reads "· up to N
  run at once" (fetched once, gracefully omitted if unreachable) so a fan-out can't imply more parallelism
  than the gate delivers. **Not pushed to origin.**

- **2026-06-20 — P6 ✅ MERGED to trunk** (`agent/wire-airlock`, no-ff; gate green; verified live). Made the
  AIRLOCK honest (lie #3): the seal is real but SPATIAL (body-pathing containment) with no sidecar consumer,
  so a SEALED agent's run/tools/caps are unchanged. Rewrote the door-picker copy "WORKTREE ISOLATION" →
  "ROOM SEAL" + an explicit "doesn't change what the agent's run can do" disclaimer; kept the git-merge
  metaphor. Copy + comments only. **Real capability isolation (quarantine a sealed agent from routed
  dispatch) is a noted follow-up** (spawned as a background task).

  **🎉 ALL 8 of the biggest lies are now CLOSED** (#1,#2,#4 via P1; #6,#8 via quick-wins; #5,#7 via P4; #3 via
  P6). P2 + P5 effectively complete (subsumed). **The "shrink what lies" through-line is DONE.** Remaining
  pieces are value-add, not lies: **P7** (reviewable SLAG log + run-history panel), **P8/P9** (stranded
  branches: cron picker, tutorial), **P10** (durability + contract cleanup), plus follow-ups (P6 real
  isolation, P3 delegated/cron portal pulse). Pushed to origin at the all-lies-closed milestone (`f5caf16`).
- **2026-06-20 — P3 ✅ MERGED to trunk** (`agent/wire-multiagent-floor`, no-ff; gate green; verified live).
  Multi-agent floor: outbound PRODUCT/SLAG crates now ride off the PRODUCING agent's own bay (new
  `outboundBeltTile`; the hero path stays byte-identical), and the P1 broadcast tee also mirrors a routed
  run's `mcp__` tool call so a routed worker's MCP call pulses its connector portal. Delegated-worker + cron
  portal pulse left as follow-ups (COMMS-clutter / double-count tradeoffs). **P3 not yet pushed** (trunk also
  carries another agent's `media-skills` merge).

## Quick wins (S-effort, no contract change, high honesty payoff) — ✅ DONE (merged 2026-06-20)

These are mostly **consume-side listeners for events already live on the bus** — several do NOT
depend on P1 and can ship immediately:

- **Cron war-room pulse** — listen for `cron.fire/skipped/result/tick` in `world.js`
  `connectChannelBridge` (emit+SSE already real). *(independent)*
- **Per-agent crew dots** — read `#cs-<id>`/`runningAgents` from `stationui.crewTick` instead of the
  one global `#chat-status` string (real per-agent map already exists). *(independent)*
- **Checkpoint pulse/toast** — listen for `checkpoint.created/restored` (validated, emitted,
  SSE-broadcast, just dropped on arrival). *(independent)*
- **Honest REWIND** — default `SKYNET_CHECKPOINTS` on, or make the copy match shell-only default. *(independent)*
- **Budget RESUME button** — `safety.js` already polls `/api/budget/status`; `POST /api/budget/resume`
  is fully tested — wire one-click "keep going" so a soft cap stops dead-ending the user. *(independent)*
- **memory.recall chip** — surface "N memories recalled" in COMMS/HUD (event carries count/chars;
  only an audio bump consumes it today). *(independent)*
- **channel.connect health** — subscribe the Messaging panel to the live transport-health event
  instead of HTTP-polling. *(independent)*

## The plan — 10 pieces, dependency-ordered

Each piece is a coherent, mergeable chunk. Work each in its **own worktree** per
[AGENTS.md](AGENTS.md) (`gen-trees\new-agent-tree.ps1 <name>` → edit → `npm run test:fast` → merge).
Contract changes to `shared/events.js` must be **additive only** and requested from the owner.

### Wave A — the keystone
- **P1 · Make the in-app directive ride a belt & broadcast its run lifecycle** *(L, risk: SSE
  double-render of the hero NDJSON stream — tee server-initiated/routed runs without duplicating the
  hero's local stream; events already exist, stay additive).*
  Every in-app COMMS run (and routed/cron/crew run) emits `workitem.placed` at INTAKE/desk on send,
  `queue.status`, `agent.run.start/agent.cost/agent.run.end` over `sse.broadcast`, and
  `workitem.delivered` on reply. **Closes lies #1, #2 and unblocks P2/P3/P4/P5.** Branch: none.

### Wave B — ride on the keystone (consume-side honesty)
- **P2 · HUD honesty pass: render the events already on the bus** *(M, low risk).* Cron pulse,
  checkpoint pulse/toast, channel.connect health, memory.recall chip, and (post-P1) THRU/DWELL/INTAKE
  populate from real events. Bundles most quick wins. Branch: none.
- **P3 · Multi-agent floor honesty** *(M).* Per-agent crew dots; outbound PRODUCT/SLAG crate spawns
  at the *producing* agent's bay (not always hero desk); a worker/cron MCP call pulses *its* portal.
  Closes lie #6; needs P1's per-agent run/tool events on the bus. Branch: none.
- **P4 · Honest mass + concurrency** *(M).* Inbound ORE crate mass from a real per-box
  `cost.estimate→reconcile` recolor (or relabel as "request"); summon UI shows the
  `MAX_CONCURRENT_AGENTS` ceiling so "refused" workers are visible before dispatch. Closes lies #5, #7. Branch: none.
- **P5 · Strong-signal learning + budget recovery** *(S).* In-app task completion emits
  `workitem.delivered` (weight-3 ship signal fires for everyone, not just Telegram); ship the
  one-click budget RESUME control. Closes lie #4. Branch: none.

### Wave C — discrete trust/teaching surfaces (independent of P1)
- **P6 · Make AIRLOCK isolation real (or honest)** *(M, security boundary — do honest-copy first,
  real isolation as follow-up).* Either enforce an isolated fs-jail root / restricted cap set for a
  SEALED agent in the sidecar, or rewrite the prop copy to claim only the visual containment it
  delivers. Closes lie #3. Branch: none.
- **P7 · Reviewable history surfaces** *(M, read-only panels over existing routes/stores).* Render
  the Slag-Sink `recent()` ring as a reviewable SLAG LOG (per-crate post-mortem), and a
  run-history/autopsy panel that GETs `/api/runs`. Turns two write-only stores into teaching surfaces. Branch: none.

### Wave D — reuse stranded branches + cleanup tail
- **P8 · Land the cron agent picker + real per-job persona** *(L — reuse, don't rebuild).* Per-routine
  roster agent + provider/OAuth target + 5-field cron; at fire time load that agent's composed
  persona/model. Branch: **`agent/cron-agent-picker`** (reconcile vs current roster/dossier).
- **P9 · Land the First-Command tutorial + coachmarks + Field Manual** *(M — reuse).* After the
  Awakening finale, a new user gets the diegetic First Command, just-in-time coachmarks, Field Manual
  + Station Briefing. `tutorial.js/.css` exist on branch, just not loaded by trunk's `index.html`.
  Branch: **`agent/tutorial`** (needs keyed E2E + anchor reconcile).
- **P10 · Operational durability + contract cleanup** *(M, additive contract changes only).* Roster
  re-push on bare reconnect (so a sidecar restart doesn't silently break `team.dispatch`); reflection
  scopes kept memories to the run's `streamId` (not hardcoded global); resolve dead/stale contract
  entries (emit `permission.response` + add `full` to enum; wire-or-document `object.place/reclaim`,
  `agent.reasoning`, `connector.state`, `queue.status.nextAdvanceAt`); Telegram interactive-consent
  stub (`onCallback` noop). Branch: parts may be on `agent/oauth-telegram`.

## How this was built (regeneration)

3-phase Workflow `starnet-wiring-audit`: 16 domain auditors trace each vertical on trunk → adversarial
verifiers refute high-severity gap claims → synthesis merges into this backlog. Re-run by
re-invoking the saved workflow script. Full raw findings in the task output for run `wf_5c1c8a94-205`.
