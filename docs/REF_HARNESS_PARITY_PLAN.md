# gen Harness — Replicate-Then-Surpass the reference harness: Memory, Cron, Harness

*Synthesis of an 11-agent comparative study (2026-06-16) of the local NousResearch the reference harness clone (`C:\Users\<you>\harness-ref`, MIT) vs our `gen` harness, across memory, cron, context-engineering, and capability surface. Every claim is anchored to source verified against `sidecar/`, `shared/`, and the plan docs. This is the decision document.*

---

## 1. Executive summary

- **We out-*design* the reference harness; we under-*build* it.** Across all three domains the architecture is sound and in places clearly superior (event-sourced provenance, a single proven run engine, deterministic pure-function scheduling math). But of the differentiating bets, most sit at 0–20% built. The design lead is real; the build lead is not yet.
- **One run engine already exists — that is the structural win.** `runOnce` (`index.js:395-513`) is the single host for browser, Telegram, and (soon) cron, and already exposes cron's exact `surface`/`trigger`/`runId`/`prompt` signature (`index.js:404-406`). the reference harness's prized "no second engine" invariant is ours for free. The plan's "hard blocker" to extract it is **stale**.
- **Memory — the single most important move:** make trust *computable*. The provenance/trust moat (our biggest advantage over the reference harness) currently rests on numbers nothing produces. Freeze `memory.used` + `memory.feedback` rungs and thread `runId` onto `capCtx` *first*, or the moat is hand-waving.
- **Cron — the single most important move:** build the tick driver + persisted store. The catch-up *math* already equals or beats the reference harness (`planTick`, tested), but nothing ever calls it. Store (`cron-store.js`) + 5 events + a `setInterval(60s)` driver with a self-healing lease is the entire critical path to "it fires."
- **Harness — the single most important move:** wire prompt caching. For a BYOK harness where the user pays per token, the absent cache-stable prefix is the biggest cost defect. `context.js` assembly is built but **dark**; route through it, freeze the prefix, add `applyCacheControl`. ~75% multi-turn input savings.
- **A surprising amount is "built but unwired."** Compaction (`context.js`), the error taxonomy (`errorClass.js`), prompt assembly (`context.js`), catch-up math (`cron.js`) are all written and tested but not consumed. Several of the highest-impact wins are *wiring*, not greenfield.
- **The contract discipline is the safety rail.** `shared/events.js` (SCHEMA_VERSION 1, validated + redacted) is owned by cortex-memory and additive-only. Every new capability hangs off an additive event — which is also exactly what keeps the gamified layer a pure projection (see §5).
- **Three holes the reference harness itself left open, which we should close on day one:** (1) no cumulative cron spend ledger → runaway-job cost; (2) no global budget pool across subagents; (3) no provenance on its built-in memory store. We inherit the fixes, not the flaws.

---

## 2. Memory: replicate-then-surpass

### 2.1 The replication target (reach the reference harness parity)

the reference harness's memory is four things we lack: a **user-profile surface**, an **auto-formation pass**, **bounded consolidation**, and **relevance-filtered + threat-scanned recall**. Today our recall is *strictly dumber than the reference harness substring* — it dumps the whole reversed notebook with zero query relevance (`index.js:500`) and re-scans nothing on the prompt path. That is a regression to fix, not just a feature to add.

**Storage layout — the MEMORY.md / USER.md analog.** Don't copy two files; we're JSON and event-sourced. Use **two scopes on one record type**:

- Grow the record at `notebook.js:35` from `{id,title,body,ts}` → the v2 shape:
  `{id, kind, scope, title, body, streamId?, sourceRunId, createdAt, lastUsedAt, useCount, trust, pinned}`
- `kind ∈ {profile, learned, note}`, `scope ∈ {user, agent, stream}`:
  - `profile` + `scope:user` = **USER.md analog** ("what I know about the user" — the surface we have *none* of today)
  - `learned` + `scope:agent` = **MEMORY.md analog**
  - `note` = scratch (existing notes migrate here)
- Keep the sibling-file jail (`WORKSPACES/<aid>.notebook.json`) — already better isolation than the reference harness's shared `~/.ref-harness/memories`.
- Add what the store lacks: **per-scope cap + dedup** on near-identical `title+body` (the reference harness dedups on load; we have nothing) and a **lossless migration with a one-shot `.bak`** (ref-style) plus a fixture test.

**Cache-safe recall injection — keep our advantage, do NOT copy the reference harness here.** the reference harness's fatal flaw is the frozen snapshot: a fact saved mid-session is invisible until *next* session. We inject recall as a post-prefix `system` note *before the newest user message* (`context.js:90`) — byte-stable cached prefix **and** fresh tail. Lock it in by splitting recall:

- **Core** — always-on (`kind∈{profile,learned}` or `pinned`), rendered once into the cached system-prefix region.
- **Working** — `rank()` top-K, query/stream-scoped, into the post-prefix `<recalled-memory>` fence (`context.js:90`).
- The "living delta" rides here: append facts written *this run* to the fence so a 30-second-old fact is usable now. This is the staleness window the reference harness structurally cannot close.

**Curation pass — consented, not unsupervised.** the reference harness auto-writes the user profile with no approval (its weakness #5). Ours:

- Post-run **reflection fn** (injected/replayable) reads the frozen `agent.*` run log → emits `memory.proposed` → **Keep/Edit/Discard** beat → approved facts become `memory.write`.
- Add the **consolidation/GC** the design lacks entirely: dedup, merge near-duplicates, decay unused low-trust records (`pinned` → never decayed), enforce per-scope cap. This is our bounded-growth guarantee (the reference harness gets it from char caps; we get it from explicit GC).
- Add the **conflict-resolution** story the design threw out without replacing: when a proposal contradicts an existing fact, surface both in the Edit step rather than silently double-writing.

### 2.2 The four ways we surpass the reference harness

1. **Provenance / trust / visibility (the moat).** `{sourceRunId, createdAt, lastUsedAt, useCount, trust, pinned}` as canonical fields + a Memory Core panel where any fact drills to the run that created it. the reference harness built provenance metadata then **discards it** on its built-in store (bare `§` strings). **Critical:** make trust *computable* — freeze `memory.used {agentId,runId,id}` (emitted when a record is actually surfaced into a prompt — `renderRecall` knows exactly which ids it included) and `memory.feedback {agentId,id,delta,reason}` (from Keep/Edit/Discard + pin/forget). Trust = a fold over `memory.write` (init) + `memory.used` (small +) + `memory.feedback` (signed) + decay-by-age. Asymmetric (`+0.05`/`−0.10`) is a fine default. *Without these two rungs the moat rests on numbers nothing produces — close this first.*
2. **Living core memory.** Frozen core prefix (cached) + append-only this-run delta on the post-cache fence. Beats the reference harness's staleness window outright.
3. **Auto-consolidation as a consented game beat.** Reflection → `memory.proposed` → Keep/Edit/Discard puts a human in the loop without consent fatigue, framed as RPG progression. the reference harness mutates unsupervised.
4. **Local zero-dep retrieval that beats provider-vector at our scale.** A pure `rank(records, query, {now})`: tokenize → idf → **BM25** + recency boost + trust boost + pin-to-top. Deterministic, unit-testable. Wire into the recall path to replace the whole-notebook dump. Add the **recall-boundary injection/exfil scan** inside `renderRecall` (design H5, absent today) so a poisoned tool/web-sourced note can't reach the `system` role.

### 2.3 Mapped to the M-mem.* sequence

| Phase | Milestone | Delivers |
|---|---|---|
| **Phase 0** | Clear 3 blockers (one short additive PR) | **B1** thread `runId` onto `capCtx` (`capGate.js:26-35`; add to `extra` at `index.js:436`) so `memory.write` can stamp `sourceRunId`. **B2** freeze `agent.compact`, `memory.proposed`, `memory.used`, `memory.feedback` with contract tests. **B3** make `scope`/`streamId` optional (default `streamId:null`) so M-mem.2 lands without waiting on Workstreams. |
| **M-mem.2** | Real store + provenance + producers | v2 record shape; lossless migration + `.bak` + fixture; `notebook.write` emits `memory.write` (not just `deliverable`) stamping `sourceRunId`; `notebook.forget`/edit → `memory.forget`; per-scope cap + dedup. |
| **M-mem.3** | BM25 recall + core/working split + injection scan | pure `rank()`; core→cached prefix, working→fence; emit `memory.used` per included record; recall-boundary scan. |
| **M-mem.4** | Compaction (clears the commit-blocker) | wire built-but-dark `compact()` into `loop.js:154-158` (today it `end('error')`s on overflow though `errorClass.js:38` already sets `shouldCompress`); import `makeContext` so `fit()` budget-trimming runs; emit `agent.compact`. |
| **M-mem.5** | Reflection → propose → consented turn-in | reflection fn over frozen run log → `memory.proposed` → Keep/Edit/Discard → `memory.write`; conflict surfacing; discards → negative `memory.feedback`. |
| **M-mem.6** | Memory Core panel | UI over `GET /api/notebook` (`index.js:771-786`) showing provenance/trust/useCount; pin/edit/forget emit rungs; every fact drillable to `sourceRunId`. |

---

## 3. Cron: beat the routines

### 3.1 Where we stand

`cron.js` is a pure, tested **schedule-math** module — and the *hard* parts are done or trivially reachable: single engine (`runOnce`), `trigger:'schedule'` already a frozen enum (`events.js:24-26`), determinism passing `lint-determinism.js`, and catch-up math that **equals or beats the reference harness** (period-scaled grace, O(1) fast-forward, advance-before-run, at-most-once-across-crash proven in tests). What's missing is **wiring and surface**: nothing ever calls `planTick`. A restart resumes nothing because there is no store and no tick.

### 3.2 The concrete plan

**Phase A — Make it fire (critical path).**

- **A1. `sidecar/cron-store.js` + `WORKSPACES/cron.jobs.json`** — reducer over the `CronJob` shape, envelope `{version:1, jobs:[...]}`, atomic temp+rename+fsync (copy `index.js:76-88`), single in-process write guard. *Done when: create → reload → `planTick` stable across restart.*
- **A2. Five additive `cron.*` rungs** (`cron.tick/fire/skipped/next/result`) — **request from the cortex-memory owner; never self-edit `events.js`.** `emitter.js` drops unregistered names, so no producer can exist until these land. *Done when: contract fixtures pass `test:fast`.*
- **A3. The tick driver** — `setInterval(60s)` → `planTick(jobs, Date.now())` → **persist `next[]` BEFORE launching `fire[]`** (the at-most-once invariant the test already proves). Add a **boot-resume reconcile tick** (the unbuilt half of catch-up). Add a **self-healing lease** `Map<jobId,startedAtMs>` that evicts + `abort()`s past `CRON_MAX_RUN_MS` (strictly better than the reference harness's bare in-flight `Set`). Env-gate (`SKYNET_CRON_ENABLED`). Fire = call `runOnce({surface:'autonomous', trigger:'schedule', ...})`. *Done when: an `every 1m` job fires once/min, survives restart without double-fire, killed-mid-run job is reclaimed.*

**Phase B — Surface results.**

- **B1. `sidecar/cron-deliver.js`** — strict `=== '[SILENT]'` suppression (copy the reference harness exactly), **always deliver failures**. Three sinks, all reusing frozen rungs: local deliverable file (`deliverable` + `GET /api/file`), in-app `notify` (server-side, reconciled on panel open), channel push (`adapter.send` + `channel.delivery`). Plus a **per-run `.md` output archive** under `WORKSPACES/cron/output/{jobId}/{ts}.md` with path-traversal guard — the audit trail the reference harness has and we lack. Emit `cron.result`.
- **B2. `/api/cron*` + `buildRoutines` in `stationui.js`** — CRUD + preview (`planTick` dry-run) + run-now (set `nextRunAt=now`). Panel reconciles unseen results into browser `notifs`.

**Phase C — Surpass (the two holes the reference harness flags itself).**

- **C1. Cumulative spend ledger — `WORKSPACES/cron.spend.json`.** Per-run caps don't bound a high-frequency job (`* * * * *` at $1/run ≈ $1,440/day). Day-keyed accumulator; on each `cron.result` add `spentUsd`; cross the ceiling → emit the **already-frozen** `budget.threshold{scope:'day'}` (`events.js:72`) and **auto-pause** cron fires until reset. the reference harness does not have this.
- **C2. Wake-gate parity — `{wake:false}` short-circuit.** Optional per-job cheap predicate; negative skips the expensive LLM fire → `cron.skipped{reason:'wake-gate'}`. Mirrors the reference harness's `{"wakeAgent":false}`.
- **C3. (Deferred) 5-field cron + IANA tz.** Only when time-of-day is genuinely demanded. Today no wall-clock schedule exists at all (`cron.js:98-101` flags 5-field `supported:false`), but v1 is DST-immune *by construction* (duration-anchored). Hand-roll the subset behind the kept next-fire-vs-`now` seam; add per-job `tz` + a spring-forward/fall-back test before flipping `supported:true`.

**Phase D — Memory + world integration (pure event consumers).**

- **D1.** Scheduled `runOnce` runs in its own session. Mirror the reference harness's `skip_memory=True` *default* but make it per-job opt-in (`writeMemory:true`) so a "daily journal" routine *can* persist. A **memory consumer** (not the scheduler) decides on `cron.result` whether to write a cortex entry tagged `source:'schedule'`+`jobId`.
- **D2.** The world renderer already listens to `agent.run.start{trigger}`. Because a fire passes `trigger:'schedule'`, a **world consumer** can render a scheduled wake with *zero* scheduler change. **Hard rule: `cron.js` and the tick driver must never import `world.js` or memory code** — if you reach for that import, emit a richer `cron.*` rung and consume it in the world layer instead.

**Build order:** A1 → A2 → A3 → B1 → B2 → C1 → (D1 ∥ D2) → C2 → C3(deferred).

---

## 4. Harness: the missing pieces (prioritized)

The loop itself (`loop.js:99-196`) is the strong part — deterministic, cap-gated, cost-honest. The gaps are *around* it: caching, compaction, budget governance. Each adoption below carries its one-line gamification mapping (all pure observers — see §5).

**Highest value (the dependency spine):**

1. **Prompt caching (M, highest cost value).** Build-once-per-session system prompt, byte-stable replay, date-only timestamp, inject volatile context into the user turn (we're one step away — recall fence already correct), `applyCacheControl` (`system_and_3` breakpoints) + sorted-key tool-arg serialization. Route assembly through the built-but-dark `context.js` (`index.js:493-494`). *→ Warm Cache heat gauge (uses existing `cachedTokens`).*
2. **Durable ledger `sidecar/ledger.js` (M).** Append-only `{runId,agentId,turns,usd,tokens,ts}`. Gates *both* budget and skills. *→ Logbook prop in the war-room.*
3. **Budget governance `makeBudget({perRun,perDay,global})` (S over ledger).** Emit `budget.threshold` at 80/100%; grace call; add the **global pool the reference harness lacks**. *→ Quartermaster fuel gauges; grace blink at 100%.*
4. **Compaction wiring (M).** `context.js` `shouldCompact`/`compact`/`fit` are built + tested, fully unwired. Trigger on **real prompt tokens** (we reconcile usage in `cost.js`), not estimates; fix the cold-catalog no-op. Cheap-prune pass *before* LLM summarization (hash-dedupe tool outputs, 1-line summaries, strip media); two tail anchors (last user + last assistant) + tool-pair-safe boundary; anti-thrash. *→ Memory Defrag beat; cache reheats after.*

**Near-free wins (do immediately):**

5. **Error-classifier consumer (S).** The taxonomy is built; `loop.js:154-155` throws `shouldCompress`/`shouldFallback` away. Consume them: `shouldCompress`→compaction, `shouldFallback`→model fallback. *→ Self-repair animation (sparks/model-chip swap).*
6. **Finish secret redaction (S).** ~40-vendor-key regex set, env-snapshot the on/off so the model can't disable it. *→ Secrets render as ████ on screens.*
7. **Delete dead `usage:{include:true}` (`openrouter.js:53`) (S).** Contradicts its own header; removes a documented lie.

**Safety before breadth:**

8. **Checkpoint manager / shadow-git (M).** Per-turn workdir snapshot, rollback to any turn, invisible to the model — direct antidote to CLAUDE.md's "silent data loss is THE failure mode," pairs perfectly with worktrees. *→ Save-crystal / time-rewind VFX.*
9. **File-safety rails (M).** Resolved-abs-path deny floor (currently TODO `index.js:106-107`) + cross-worktree soft guards. *→ Red forcefield on `.env`/`.git`.*
10. **`shell.exec` (M)** — only behind consent (live) + checkpoint (#8). Lands the reserved `terminal` capability. *→ Powered workbench; badge-in to run.*
11. **LSP lint-delta, tsserver only (L).** Surface only newly-introduced diagnostics after `fs.write`/`fs.edit`; git-workspace gated. *→ X-ray goggles.*

**The colony frontier (correctly later):**

12. **Make the loop re-entrant (gap #4, refactor).** Move `provider/cost/signal/wrapped-dispatch` off loop locals onto `capCtx`. Prereq for all multi-agent work.
13. **`delegate` tool (L)** using the existing `attenuate` ∩-rule; depth + concurrency bounds; parent sees only a summary; **shares the global budget pool**. *→ Spawn a helper crewmate with a visibly smaller keyring — the colony's signature moment.*
14. **Progressive tool disclosure (M)** — land *before* the tool count explodes past ~10% of context, not after. *→ Agent consults a "manual" prop.*
15. **Skills + background review (L)** — double-blocked on caching (#1) + ledger (#2). Port the "what NOT to capture" policy verbatim. *→ Skill-book leveling / ghost study clone.*
16. **Curator (M)** — only after skills exist. *→ Librarian tidying (archive, never burn).*

**Skip on principle:** remote execution backends (Modal/Daytona/SSH), enterprise messaging adapters (Feishu/DingTalk/etc.), the Tirith signed-binary scanner, Mixture-of-Agents, credential pool, toolset distributions, MCP *server*, skin/theme system.

---

## 5. Gamification firewall

**The single principle: the engine emits events; the world layer only *observes* them. The cosmetic layer never drives, gates, or mutates the engine.**

Concretely:

- **All state lives in core/sidecar.** Memory records, cron jobs, the ledger, budgets, checkpoints — every byte of truth is in `sidecar/` + `WORKSPACES/`, behind the capability gate. The world (`world.js`, `stationui.js`) holds *no* authoritative state.
- **The only interface is the frozen `shared/events.js` bus** (SCHEMA_VERSION 1, validated + redacted). Every new capability surfaces through an **additive** event (CLAUDE.md rule 4 — requested from the cortex-memory owner, never self-edited). If a feature needs a new beat, it adds a rung — it does not reach into the world.
- **Animations may never gate engine progress.** Events fire immediately; the cosmetic layer catches up asynchronously. The audio/voice work already learned this — a slow VFX must never stall a run. A scheduled fire emits `cron.fire` and `runOnce` proceeds whether or not the sprite has finished walking to its bay.
- **The hard import rule:** core modules (`cron.js`, the tick driver, `context.js`, `ledger.js`, the memory store) must never `import` `world.js` or UI code. The dependency arrow points one way only: world → events ← engine. If you find yourself importing the world into the engine, stop and emit a richer event instead.
- **This is why the design is safe to build aggressively.** Because every beat in §2–4 is a *pure projection of a real event*, none of the gamification can degrade the harness — and the harness can ship correctness without waiting on art. The frozen event bus is the firewall.

---

## 6. Recommended build order

One sequence across all three domains, grouped into waves. Sizes: **S** = days, **M** = ~1–2 weeks, **L** = multi-week / refactor.

### Wave 0 — Clear the blockers + free wins (do first, one short additive PR where possible)

1. **(S) Memory B1+B2+B3** — thread `runId` onto `capCtx`; freeze `agent.compact`, `memory.proposed`, `memory.used`, `memory.feedback`; make `scope`/`streamId` optional. *Unblocks the memory moat AND compaction.*
2. **(S) Harness #7** — delete dead `usage:{include:true}`.
3. **(S) Harness #5** — wire the error-classifier consumer (`shouldFallback`→fallback now; `shouldCompress`→stub until Wave 2).
4. **(S) Harness #6** — finish secret redaction + env-snapshot the toggle.

> **Blockers to clear before anything downstream:** Memory B1 (no `sourceRunId` without it → moat uncomputable), B2 (no producer can exist before its rung is frozen — `emitter.js` drops unregistered names), and the cron `cron.*` rungs (A2). All additive, all requested from the cortex-memory owner.

### Wave 1 — The cost + governance + longevity spine

5. **(M) Harness #1** — prompt caching: route assembly through `context.js`, freeze prefix, `applyCacheControl`. *Biggest cost win.*
6. **(M) Harness #2** — `sidecar/ledger.js`. *Gates budget + skills.*
7. **(S) Harness #3** — `makeBudget({perRun,perDay,global})` + `budget.threshold` + global pool.
8. **(M) Harness #4 / Memory M-mem.4** — wire compaction into the loop (cheap-prune first, then tail anchors, then anti-thrash). *Shared milestone: clears the `loop.js:154-158` commit-blocker.*

### Wave 2 — Memory replicate-then-surpass

9. **(M) M-mem.2** — v2 record + provenance + producers + migration/`.bak`/cap/dedup.
10. **(M) M-mem.3** — BM25 `rank()` + core/working split + `memory.used` emission + recall-boundary scan. *Fixes the recall regression and lands the retrieval moat.*
11. **(M) M-mem.5** — reflection → `memory.proposed` → Keep/Edit/Discard + GC/decay + conflict surfacing.
12. **(M) M-mem.6** — Memory Core panel (provenance/trust drill-down).

### Wave 3 — Cron fires and surfaces

13. **(M) Cron A1+A2+A3** — store + rungs + tick driver/lease/boot-resume. *It fires.*
14. **(M) Cron B1+B2** — delivery (`[SILENT]`, archive, 3 sinks) + `/api/cron*` + ROUTINES panel.
15. **(S) Cron C1** — cumulative spend ledger + auto-pause (the hole the reference harness left open).
16. **(S∥) Cron D1+D2** — memory + world consumers (pure event consumers, no scheduler change).
17. **(S) Cron C2** — wake-gate `{wake:false}` short-circuit.

### Wave 4 — Safety, then the colony frontier

18. **(M) Harness #8** — checkpoint manager (shadow-git). *Before shell.*
19. **(M) Harness #9** — file-safety rails (abs-path deny floor + cross-worktree guards).
20. **(M) Harness #10** — `shell.exec` behind consent + checkpoint.
21. **(L) Harness #11** — LSP lint-delta (tsserver).
22. **(L) Harness #12** — make the loop re-entrant. *Prereq for delegation.*
23. **(L) Harness #13** — `delegate` tool (attenuate ∩-rule, shared global budget).
    - Session 5 H6.3 checkpoint: `team.dispatch`, background dispatch, `team.resume`, and `team.spawn` now carry a worker `maxIters` cap of 10 by default, and empty/no-assistant/no-tool loop turns refund to the turn's starting count. Production `runOnce` consumption is held while `sidecar/index.js` is contended.
24. **(M) Harness #14** — progressive tool disclosure (before the tool count explodes).
25. **(L) Harness #15** — skills + background review.
26. **(M) Harness #16** — curator.
27. **(L, deferred) Cron C3** — 5-field cron + IANA tz, only when time-of-day is demanded.

**Rationale:** Wave 0 is small, additive, and unblocks everything. Wave 1 is the dependency spine — caching (cost), ledger (governance), compaction (longevity) gate nearly everything downstream. Memory (Wave 2) lands the headline differentiator and fixes a live security/quality regression. Cron (Wave 3) is mostly wiring onto a proven engine. Wave 4 makes autonomy *safe* (checkpoint + rails) before granting `shell`, then reaches the multi-agent colony payoff — correctly last.

---

## 7. Open decisions for andro

These need a human call before building the affected wave:

1. **Retrieval tier (Wave 2, M-mem.3).** Confirm **BM25 + recency + trust, zero-dep, in-process** is the target — not an embedded vector index. *Recommendation: yes, BM25.* It shapes the `rank()` module's contract.
2. **Where the USER.md analog lives.** Confirm **two scopes on one JSON record type** (not two literal files). Open sub-question: is `scope:user` profile **shared across all agents** or **per-agent**? (the reference harness is profile-scoped/shared.)
3. **Trust reducer constants.** Approve the asymmetric default (`+0.05` used / `−0.10` negative feedback) and the decay half-life.
4. **Are scheduled runs full in-world agent wakeups?** *Recommendation: yes* — a fire passes `trigger:'schedule'`, the agent visibly walks to its bay and wakes (reusing FIRST LIGHT). Independent of the engine — the firewall means either choice is a pure consumer decision.
5. **Default memory-write policy for cron runs.** Confirm **`skip_memory` by default, `writeMemory:true` opt-in per job**.
6. **Cron daily spend ceiling + whether auto-pause is hard or soft.** Pick the dollar ceiling for `budget.threshold{scope:'day'}`. *Recommendation: hard-pause with a one-click resume in the ROUTINES panel.*
7. **Global budget pool sizing (Wave 1, #3 / Wave 4, #13).** Set the colony-wide ceiling that subagents share.
8. **Checkpoint scope (Wave 4, #8).** Shadow-git of the **whole worktree** per mutating turn, or only files the agent touched? *Recommendation: whole-worktree content-addressed*, but confirm given disk cost across 7–10 simultaneous worktrees.

---

*Key files (all under `gen/`):* `sidecar/context.js` · `sidecar/loop.js` · `sidecar/index.js` · `sidecar/cron.js` · `sidecar/cost.js` · `sidecar/capability/capGate.js` · `sidecar/tools/builtin/notebook.js` · `sidecar/providers/openrouter.js` · `shared/events.js` (additive-only, cortex-memory owned) · NEW: `sidecar/ledger.js`, `sidecar/cron-store.js`, `sidecar/cron-deliver.js` · docs: `docs/MEMORY_AND_CONTEXT_PLAN.md`, `docs/HARNESS_ARCHITECTURE.md`, `docs/CONVEYOR_PIPELINE_PLAN.md`
