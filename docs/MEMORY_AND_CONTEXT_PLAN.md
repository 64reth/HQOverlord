# Cortex — Memory & Context Plan

> **StarNet** — the agent memory + context system. Companion to `REF_HARNESS_INTEGRATION_PLAN.md` and `INCREMENTAL_ROADMAP.md`; obeys the same discipline: one-line goals, Deliverables/Port-create/Tests/DoD per step, the 12-point Definition-of-Done, frozen event rung *before* any producer, one-commit-sized steps (≤3 source files, gating test first, `test:fast` green `<~10s` before the next), critical-path-first.
>
> _Source studied: `the upstream reference harness` (MIT) at `C:\Users\<you>\harness-ref`, mapped 2026-06-14. **Pattern mine, not a port** — we take the shape of an idea and re-derive the smallest honest version against our real seams._

---

## 1. Prime directive — why this exists and what it must obey

The harness's whole differentiator is **truthful, drill-to-the-run telemetry**. Memory is the place that is *most* tempting to fake (invented "confidence", silent writes, opaque recall) and therefore the place where being truthful is the biggest moat. Cortex is the agent's memory + context engine, and it obeys the existing laws without exception:

1. **Truthful telemetry.** Every memory stat (`trust`, `useCount`, `lastUsedAt`) is a **reduction over the real `agent.*` event log**, never an invented number. Every belief carries the `runId` that produced it; the UI can drill any fact to the run that earned it.
2. **No lore, general-purpose.** Memory is the practical agent-management substrate, not backstory. It must serve any use case (code / research / ops / content / business). "Cortex" is a functional name.
3. **Human stays in control.** Memory is **proposed, then approved** — never silently written (the user's locked choice). Manual saves stay available; auto-proposal is the under-saving safety net.
4. **Determinism + purity.** All scoring/rendering/compaction logic is pure UMD with injected deps (clock, summarizer) — no bare `Date.now`/`Math.random` in `shared/`+`sidecar/` (excluding `sidecar/index.js`); `lint-determinism.js` enforces it. The aux summarizer/consolidator is **injected** so the replay suite stays byte-identical.
5. **Frozen contract first.** Every new cross-boundary signal (`memory.recall`, `memory.write`, `memory.forget`, `memory.proposed`, `agent.compact`) gets a `shared/events.js` rung **before** its first `emit`, or `emitter.js` drops it and `lint-emits.js` fails.
6. **Save-safe.** Every persisted shape is versioned + tolerant of missing/corrupt (fail toward empty, never crash). Rides the `starnet.save` v2 (Workstreams) envelope.

---

## 2. What the reference harness actually does (the patterns worth mining)

Mapped from the real source. Stripped of accretion (6 providers, 4 of them stubs; HRR vector algebra; 270-line reconcilers; the prefix-museum summarizer prompts), the load-bearing ideas are four:

| # | the reference harness pattern | File | Take it? |
|---|---|---|---|
| H1 | **Tiny curated "always-on" memory** (`MEMORY.md` ~2200 char + `USER.md` ~1375 char) in the system prompt; everything else searchable via tool. | `tools/memory_tool.py` | **Yes** — core-memory block, char-capped. |
| H2 | **Frozen snapshot** of memory at session start for a byte-stable cacheable prefix. | `tools/memory_tool.py` | **Yes, improved** — freeze per *run*, add a living-delta tail (see Bet 1). |
| H3 | **Prefetch-as-injected-message** — per-turn recall wrapped in a `<memory-context>` fence injected right before the new user message, NOT in the system prompt (preserves cache). | `agent/memory_manager.py` | **Yes** — `<recalled-memory>` fence. |
| H4 | **Cache-aware compaction** — protect system + first-N + last-6; summarize the middle via a cheap aux model; prune old tool output first. | `agent/context_compressor.py` | **Yes** — this is our L4 step, wired into `loop.js`. |
| H5 | **Threat-scan memory at load** — entries scanned for injection/exfil patterns; poisoned ones blocked in the snapshot. | `tools/memory_tool.py` | **Yes** — recall-boundary scan (web/tool output → memory → prompt is a live injection vector). |

**the reference harness's weaknesses — our openings:**
- **Frozen snapshot is rigid** — the agent can't use what it learned *this* session until next session. (Bet 1 fixes this.)
- **Formation is 100% manual** — relies on the model remembering to call `memory(add)` / `skill_manage`; there is **no** auto-skill hook at all. Agents chronically under-save. (Bet 3 fixes this.)
- **Built-in retrieval is dumb substring** — good retrieval (FTS5, semantic) is locked behind heavy/cloud providers (Honcho/Holographic). (Bet 5 fixes this, zero-dep.)
- **Memory is invisible** — opaque markdown, no provenance, no trust, no UI. (Bet 2 — the moat.)

**Left in the mine (do NOT port):** the 6-provider plugin system, HRR/holographic vector algebra, the cloud Honcho dependency, `contextvars`/`ThreadPoolExecutor` concurrency, the multi-paragraph historical summary-prefix museum, YAML-frontmatter skill discovery/platform-gating machinery.

---

## 3. Locked decisions (2026-06-14)

Decided with andro after mapping the real the reference harness source:

- **D-mem.1 — Formation = auto-propose + approve.** A post-run reflection pass *proposes* facts/skills/profile-updates; the user one-clicks **Keep / Edit / Discard** (reuses the P1.5c consent UI + the RPG Boss-Approval beat). No silent writes. Manual `notebook.write` stays.
- **D-mem.2 — Scope = layered.** Agent-global **core** memory (user model + durable facts) is always-on; **working** memory is workstream-scoped but searchable across all streams. Maps onto the dormant `roomId`/workstream fields already in the Workstreams design.
- **D-mem.3 — First build = wire `context.js` + living core injection.** Activate the dead context engine; surface the agent's own memory in-prompt before anything else. (`M-mem.1` below.)
- **D-mem.4 — Retrieval = local lexical first (BM25-ish), zero-dep, deterministic.** Embeddings are an *optional later tier behind an object*, never a baseline dependency.

---

## 4. The five bets (how Cortex beats the reference harness)

**Bet 1 — "Living" core memory (fixes the reference harness's frozen-snapshot rigidity).** A small curated core block (`PROFILE` + `LEARNED`) lives in the *cached* system prefix, frozen **per run** so the cache stays warm across the loop's turns — **but** a tiny append-only "written-this-run" delta rides the `<recalled-memory>` fence after the cache boundary, so the agent can immediately use a fact it wrote 30 seconds ago. Cache stays warm on ~95% of the prompt. the reference harness structurally cannot do this.

**Bet 2 — Truthful, provenance-tracked, *visible* memory (the moat).** Every record carries `{sourceRunId, createdAt, lastUsedAt, useCount, trust, pinned}`. A "Memory Core" panel (reusing the `stationui.js` window system) shows every belief, its provenance + trust, and lets the user pin / edit / forget. Drill any fact → the run that earned it. No other harness surfaces this.

**Bet 3 — Auto-consolidation as a game beat (fixes under-saving).** A cheap *injected* post-run reflection fn reads the run's frozen event log and emits `memory.proposed` candidates → a **turn-in beat** (Keep/Edit/Discard). Solves under-saving, keeps the human in the loop, makes memory formation a *verb*. the reference harness has no auto-formation.

**Bet 4 — Memory depth = placeable capability.** Extend object=capability to cognition: **notebook** = raw scratch notes (today) → **archive/filing-cabinet** = searchable long-term store + retrieval → **cortex** = the auto-consolidation + reflection capability. Better memory becomes *visible, earned gear*.

**Bet 5 — Good local retrieval, zero-dep.** Replace substring with pure lexical ranking (BM25: tokenize, idf-weight, + recency/trust/pin boosts) — deterministic, headless-testable on the replay provider, no cloud, no embedding dep. Beats the reference harness's built-in substring *and* its cloud providers for the common case.

---

## 5. Architecture

### 5.1 Prompt anatomy (every run)

```
┌─ SYSTEM PREFIX  (frozen per run → prompt-cache stays warm) ──────────┐
│  <identity> / <capabilities> / <rules>      ← context.systemPrompt   │
│  <core-memory>                                                       │
│    PROFILE:  durable user model        (global, char-capped)         │
│    LEARNED:  agent's durable facts     (global, char-capped)         │
│  </core-memory>                                                      │
├─ …conversation history (fit() trims oldest, never a tool pair) ──────┤
│  <recalled-memory>   ← injected just before the newest user message  │
│    • living deltas:  facts written THIS run (cache-safe, post-prefix) │
│    • working recall: top-K for this message (BM25 + recency/trust/pin)│
│      active workstream ∪ global ∪ cross-stream hits                   │
│  </recalled-memory>                                                   │
└─ newest user message ────────────────────────────────────────────────┘
   ARCHIVE (not in prompt): everything, reachable via memory.search tool
```

### 5.2 Memory record (one shape)

```js
{ id,                                   // 'mem_<n>' (deterministic, per-agent counter)
  kind: 'profile' | 'fact' | 'skill' | 'note',
  content,                              // the text; 'note' also keeps a title
  scope: 'global' | 'stream',
  streamId: null | '<workstreamId>',    // null when scope==='global'
  sourceRunId,                          // the run that produced/last-touched it (provenance)
  createdAt, lastUsedAt,                // ms (injected clock)
  useCount,                             // bumped when a recalled record is actually used in a run
  trust,                               // 0..1; moves on helpful/unhelpful feedback (a reduction, not invented)
  pinned }                              // user-pinned → always recalled, never decayed
```

`note` is the current notebook shape (`{id,title,body,ts}`) widened to this; the M-mem.2 migration maps old notes → `{kind:'note', scope:'global'}`.

### 5.3 Scope semantics (D-mem.2)

- `scope:'global'` → core (PROFILE/LEARNED) + cross-cutting notes; always eligible for recall.
- `scope:'stream'` + `streamId` → working memory tied to a Workstream.
- **Recall set** = active-stream records (boosted) ∪ global ∪ top cross-stream search hits (down-weighted). Core memory is always in the prefix regardless of stream.

### 5.4 Formation flow (D-mem.1)

```
run ends → reflect(eventLog, summarize)  [injected, cheap, deterministic-tested]
        → memory.proposed[]  (kind, content, scope, why, sourceRunId)
        → turn-in beat: Keep / Edit / Discard   (consent UI + Boss-Approval)
        → Keep → memory.write → store           (manual notebook.write also still writes)
```

### 5.5 Retrieval (D-mem.4)

Pure `rank(records, query, {now})`: tokenize query + record, BM25-style idf over the per-agent record set, then multiply by boosts — `recency` (exponential on `now - lastUsedAt`), `trust`, `pinned` (hard top), `sameStream`. No `Math.random`; `now` injected. Returns top-K within a char budget. Embeddings = optional later tier behind the `cortex` object, never required.

### 5.6 Guardrails (H5)

- **Recall-boundary injection scan**: before memory text enters the prompt, scan for injection/exfil patterns (sibling of `redact()`); poisoned entries are replaced with a `[blocked]` placeholder in the *recall render only* (the stored original stays inspectable/deletable in the Memory Core panel).
- **`redact()`** already scrubs key-shaped secrets on everything bound for logs/persistence; memory writes go through it.
- **Consent**: `memory.write` is `requiresConsent` (it already is on `notebook.write`); auto-proposals never auto-write.

### 5.7 Event rungs (freeze before producer)

| Event | Payload | Lands in |
|---|---|---|
| `memory.recall` | `{agentId, runId, count:int, chars:int}` | M-mem.1a |
| `memory.write` | `{agentId, runId, id, kind, scope}` | M-mem.2 |
| `memory.forget` | `{agentId, id, reason}` | M-mem.2 |
| `memory.proposed` | `{agentId, runId, id, kind}` | M-mem.5 |
| `agent.compact` | `{agentId, runId, beforeTokens:int, afterMsgs:int, savingsPct:num}` | M-mem.4 |

Stats/trust ride the **existing** `agent.*` log (reductions), so no per-belief event spam.

---

## 6. Build sequence (smallest-first, test-gated)

Each step: frozen rung first, pure UMD + injected deps, gating test first, ≤3 source files, `test:fast` green before the next. `context.test.js` / `contract.test.js` / `harness.integration.test.js` are already in the `test:fast` chain — steps reusing them need **no `package.json` edit**; a *new* test file must be appended to the chain.

### M-mem.1 — Wire `context.js` as the assembler + inject existing notes  ← **building now**
The smallest step that makes memory show up in the prompt. Split into three revertable sub-commits:

- **M-mem.1a — Freeze `memory.recall`.** `shared/events.js` rung + `contract.test.js` valid/invalid case. No producer. *Files:* `shared/events.js`, `test/contract.test.js`.
- **M-mem.1b — Pure recall render + inject (no wiring).** `context.js` gains `renderRecall(records, {limit}) -> {text,count,chars}` (char-capped, deterministic, `''` when empty) + `injectRecall(messages, text) -> messages'` (pure, non-mutating, splices a `<recalled-memory>` system note before the newest user message; **empty text → `messages.slice()`, byte-identical**). *Files:* `sidecar/context.js`, `test/context.test.js`.
- **M-mem.1c — Wire into the run path + emit.** `index.js` reads the agent's notebook notes (newest-first), `renderRecall` → `injectRecall` into `msgs`, `emit('memory.recall', …)` when non-empty. Empty notebook → no injection (the existing integration test, which uses an empty store, stays byte-identical). *Files:* `sidecar/index.js`, `test/harness.integration.test.js`.

**DoD:** agent sees its own notes without calling `notebook.read`; empty-memory run byte-identical to today; `context.js` stays pure; `test:fast` green.

### M-mem.2 — Real memory store + provenance + scope
Grow the notebook store into the §5.2 record shape (`scope`/`streamId`/`trust`/provenance); migrate old notes → `{kind:'note', scope:'global'}`; freeze `memory.write`/`memory.forget`; save-safe v2→ (rides the Workstreams `starnet.save` migration). Keep the frozen `notebook.*` tool seam additive.

### M-mem.3 — BM25 recall + core-memory block
Pure `rank()` module; split recall into **core** (always-on prefix block, char-capped, PROFILE/LEARNED) vs **working** (top-K, stream-scoped) + the living-delta tail (Bet 1).

### M-mem.4 — Compaction (the planned the reference harness L4)
Wire `shouldCompact`/`compact` into `loop.js` after the tool-execution branch, with the tool-pair guards (never cut inside a tool_call/result group) + anti-thrash + the injected summarizer; freeze `agent.compact`. A long run auto-compacts on real `prompt_tokens` instead of dying on a provider 400.

### M-mem.5 — Reflection → propose → turn-in
The injected post-run reflection fn → `memory.proposed` → the Keep/Edit/Discard beat (consent + Boss-Approval). Solves under-saving.

### M-mem.6 — Memory Core panel
The visible drill-to-the-run UI (Bet 2) over the real store: every belief, its provenance + trust, pin / edit / forget.

---

## 7. Reconciliation with the existing seams

- **`context.js` is built but dead** — `index.js:25` imports only `redact`; messages are assembled inline at `index.js:271`. M-mem.1 activates `assemble`/`fit`/`systemPrompt` + the new recall fns. This is the already-planned the reference harness **L4.S0** "wire `context.js`" step, pulled forward.
- **Notebook store** (`index.js:57`) is a per-agent JSON sibling of the fs jail (the agent can't corrupt its own memory via `fs.*`). M-mem.2 keeps that property and widens the value shape.
- **Frozen events** — only additive rungs (§5.7); nothing existing is re-shaped. `deliverable` still fires from `notebook.write` (do not regress).
- **Workstreams** — `streamId` on every record fills the dormant per-stream field; recall scoping is the first real consumer of the Workstreams model beyond the kanban.
- **Determinism** — ranking + render + compaction are pure; clock + summarizer + reflection model are injected; the replay suite stays byte-identical because empty/short paths inject nothing.

---

## 8. Explicitly NOT doing
- **No cloud memory provider** (Honcho), no embedding dependency at baseline, no HRR/holographic vector algebra.
- **No silent memory writes** — auto-proposal always routes through human Keep/Edit/Discard.
- **No 6-provider plugin abstraction / YAML-frontmatter skill discovery machinery** — a written skill is just a `kind:'skill'` record; gated on M-mem.5 + a wired system prompt (else it's a cosmetic badge, the antipattern the RPG doc forbids).
- **No new concurrency machinery** — a Promise + a `Map`, like the rest of the sidecar.
