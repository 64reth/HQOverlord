# the reference harness Integration Plan

> **StarNet** — a layered plan for borrowing ref-derived capabilities on top of the proven M1 sidecar harness. This document is the companion to `INCREMENTAL_ROADMAP.md` and obeys the same discipline: one-line goals, Deliverables/Port-create/Tests/DoD per step, the 12-point Definition-of-Done, one-commit-sized steps, critical-path-first. Every seam below was confirmed against the real files; every premature/redundant/hallucinated claim flagged by the adversarial verdicts has been dropped or corrected.

> _Source: `the upstream reference harness` (MIT), cloned to `C:\Users\<you>\harness-ref`. Pattern mine, not a port. Produced by a 9-layer parallel design + adversarial-verify pass against the real sidecar (2026-06-14)._

---

## 1. Preamble — what we are borrowing and the prime directive

the reference harness (`C:\Users\<you>\harness-ref`) is a mature, multi-provider, Python agent runtime. We are **mining it for patterns, not porting it.** The prime directive, in four clauses:

1. **It is a pattern mine, not a port.** We take the *shape* of an idea (a 3-state credential machine, a staged JSON-repair ladder, a four-tier consent gate) and re-derive the *smallest honest version* against our seams. We leave behind every ref-ecosystem artifact: the 30-field ProviderProfile dataclass, the 60+ shell DANGEROUS_PATTERNS table, the OAuth/Copilot/Bedrock auth variants, the plugin-directory discovery, the contextvars/threading machinery, the 270-line classification reconcilers, the prefix-museum summarizer prompts.

2. **Node, not Python.** Our loop is single-threaded async with real I/O concurrency. There is no GIL, no `threading.Lock`, no `ThreadPoolExecutor`, no `__cause__` chain-walking, no `dataclasses.replace`. A pending Promise + a `Map` is the whole concurrency mechanism. Module-level `Symbol`, not `object()` sentinels.

3. **Nothing violates the existing discipline.** Every new module is UMD, zero-dependency, headless-testable with injected deps, deterministic (no bare `Math.random`/`Date.now` — `lint-determinism.js` scans `shared/` + `sidecar/`, excluding only `sidecar/index.js`). Every cross-boundary signal goes through `shared/events.js` + `shared/emitter.js` first (a new schema rung *before* any producer). Every persisted shape is save-safe. One step = one revertable commit, ≤3 files, gating test first, fast suite green (`< ~10s`) before the next.

4. **Nothing jumps the critical path.** The roadmap's make-or-break sequence is `0.1 → 0.5 → 1.1 → 1.2 → 1.3 → 1.4` (proven green through M1.4) and the remaining Phase-1 spine is **1.0 keychain → 1.5 consent → 1.6 PROPTERM → 1.7 triggers → 1.8 recovery/kill-switch**. Of all the reference harness layers, exactly **one** sits *on* that named path: the consent broker (P1.5). Everything else is either spine-hardening that strengthens already-shipped M1 work, or it defers to the phase where its missing consumer (second provider, second agent, run-log, builder) actually exists.

---

## 2. Reconciliation with the roadmap

### Already handled — do NOT re-propose

The following are **built and integration-tested today**; no the reference harness layer may re-introduce them:

| Capability | Where | Note |
|---|---|---|
| The agentic loop (single messages-array while-loop, accumulate-by-index, JSON.parse-once-guarded, STOP-iff-zero-calls, append-assistant-before-execute, `assertPaired`) | `sidecar/loop.js` | Do NOT re-propose a loop. |
| Streaming provider seam + real OpenRouter adapter (SSE, transient-retry on 429/5xx, abort, key-independent `/models` warm, `supportsTools` gating) | `sidecar/providers/{provider,openrouter,replay}.js` | |
| Token/cost accounting **with reconciliation** (provider `usage.cost` wins, else catalog `priceOf`; `agent.cost` emitted `reconciled:true`) | `sidecar/cost.js` + `loop.js:134-140` | "truthful telemetry" requirement already met at the source. |
| Object=capability projection end-to-end (`CAP_REGISTRY` → `resolveTools` → `capGate`), removal-revokes-next-turn | `sidecar/capability/*` | |
| Host-side dispatch pipeline (parseError → unknown → capability gate → schema-validate → consent gate → timeout → run-once, never throws) | `sidecar/tools/registry.js:59-92` | |
| Four real builtin tools: `web_search`/`web_fetch` (full SSRF guard), `fs.*` (jailed), `notebook.*` (memory) | `sidecar/tools/builtin/*` | |
| `deliverable` **emission** from real runs (fs.* + notebook.write both emit validated `deliverable{kind}`) | `fs.js:25-30`, `notebook.js` | The "nothing emits deliverable" claim is **stale**. Do NOT propose a deliverable-detector. |
| Frozen, validated, redacting bus (`shared/events.js`, `shared/emitter.js`, `redact()` on every NDJSON line) | `shared/*` + `index.js:112` | |
| Per-run guardrails: `maxRepeat` loop-break, `maxToolBytes` budget, dotted→underscore wire-name map, `isTask` tool-capable pre-check | `index.js:30,154-174` | |
| Context primitives **built but unwired**: `systemPrompt`, `fit`, `shouldCompact`, `compact`, `estimateMessages`, `redact` | `sidecar/context.js` | An available, unused seam. |

### The layers

| # | the reference harness layer | Verdict | Decision | One-line why |
|---|---|---|---|---|
| L1 | **Consent broker** (four-tier: hardline floor + frozen bypass + session/permanent grants + default-deny) | adopt-now | **Adopt now (spine)** | This **is** roadmap P1.5; `index.js:134` is a permanent allow-all stub that bypasses default-deny on every `requiresConsent` tool shipped in M1.3b/M1.4. The one named-spine layer. |
| L2 | **Tool-call argument repair** (staged JSON-repair ladder before declaring a call failed) | defer | **Adopt now (spine-hardening), AFTER L1** | `loop.js:29` JSON.parse-once → `registry.js:61` discards a real intended action; local OpenRouter models (GLM/Kimi/Qwen) emit broken arg JSON today. Pure, cheap, no unmet deps — but must not displace P1.5. |
| L3 | **Error-classification taxonomy** (pure `classifyApiError` → action hints; honest `transient`) | defer | **Defer; pull the *producer half* forward opportunistically** | The pre-stream retry today burns paid attempts on never-succeed 402/400; fixing that is cheap and net-reduces spend. The consumer half's recoveries (`shouldFallback`/`shouldCompress`) have nothing to call yet. |
| L4 | **Context compaction** (wire dead `context.js` into the loop; 3 honesty guards + anti-thrash) | defer | **Defer to after P1.5; the `context.js`-wiring is its own spine step** | A too-long run today dies with **one** clean `agent.run.error` (OpenRouter 400, non-transient) — a robustness gap, not a runaway-wedge. Blocked by the cold-catalog `contextLimit===0` no-op. |
| L5 | **Declarative ProviderProfile + registry** | defer | **Defer to Phase 1.5/2 or 5.0** | A registry with one entry is indirection without a caller. Land it the commit *before* provider #2 exists, not now. |
| L6 | **Credential pool / key rotation** (3-state machine + fallback chain) | defer | **Defer to a multi-key phase that the roadmap does not yet contain** | One key, one model per run today; no keychain `source`, no consumer. The now-safe sub-piece (no raw key at rest) is already met by `redact()`. |
| L7 | **File-safety + SSRF "always-blocked floor"** | defer | **Skip the rewrite; do the ~1-line metadata-host delta only** | The flagship symlink-TOCTOU threat is **not reachable** (no fs tool can create a symlink; EPERM on the Windows dev host). 5 of 6 metadata IPs are already blocked. |
| L8 | **Self-improving skill layer** (skill store + lifecycle reducer + review fork) | defer | **Defer to RPG-2/RPG-3** | A written skill is a cosmetic badge until `context.systemPrompt` is wired in; needs a run-log + loop completion hook that don't exist. |
| L9 | **Subagent delegation** (`delegate` tool + loop re-entrancy) | defer | **Defer to Phase 4; the re-entrancy plumbing (D0) is optional seam-hardening** | N=1 single room means there is no agent to delegate *to*; the door-gated authority layer and real consent don't exist yet. |

---

## 3. The build sequence

### Group A — Harden-the-spine-now (strengthens shipped M1 work; rides the Phase-1 spine)

These three land in priority order. **L1 (consent) first — it is a live safety hole and the named P1.5 deliverable.** Then L2 and the L3 producer-half as opportunistic correctness hardening that does not displace 1.6/1.7/1.8.

---

#### L1 — Informed-consent broker (roadmap P1.5)

**Goal.** Replace the allow-all consent stub with a real four-tier broker — unconditional hardline deny-list floor, import-frozen bypass, session-scoped + persisted approval state, default-deny on mutation — so `requiresConsent` tools actually gate.

**Seam.** `tools/registry.js:76` (`if (tool.requiresConsent && ctx.consent) … await ctx.consent(call, tool)`), fed via `makeCapCtx(resolved, {consent})` (`capGate.js:26`) and injected at `index.js:134`. The broker is a pure drop-in for the `consent` function — **zero pipeline edits**; `registry.js:79` already synthesizes the paired isError 'denied' result on `!allow`.

**Dependencies.** `resolve.js` already emits `approvalRules[tool]={requiresConsent,scope,network}` (`:40`); `permission.prompt`/`permission.response`/`capdenied` already frozen (`events.js:51-57`) — **no re-freeze**. The live UI round-trip needs the WS bridge (deferred to M6).

**Risk.** low.

**Conflict-resolutions.**
- *Determinism:* `capCtx` carries **neither runId nor callId** (confirmed `capGate.js:27-34`). Derive `promptId = sessionKey(=runId, injected into the broker closure) + ':' + call.id`. Never read the wall clock inside the broker.
- *Frozen bypass:* read `bypassPermissions` **once at sidecar boot** into a `const` (mirror the reference harness `_YOLO_MODE_FROZEN`); the broker must never re-read `process.env`/settings inside `consent()`.
- *Default-deny on mutation:* `always`/smart-approve may only ever cover read-only/idempotent scopes; write/execute/network always re-evaluate. Smart auto-approve is **omitted** this phase.
- *Tool-id pairing:* a denied/timed-out consent still yields exactly one isError result via the existing `registry.js:79` path — untouched.
- *Save-safe:* the permanent allowlist is a new persisted shape — ship `{version:1, allow:[...]}`, tolerate missing/corrupt (load → empty, fail-closed), store **only** danger-class keys (`capId+scope`), never args/paths/keys. Lives beside the notebook store (sibling of the fs jail).
- *Hardline scope (corrected):* the only currently-reachable `requiresConsent` tools are `fs.write/append/edit` + `notebook.write`. The broker receives **relative** `call.args.path` *before* `resolveInside` runs, and the fs jail already rejects `..`/absolute/drive-letter (`fs.js:47`). Per `HARNESS_ARCHITECTURE.md:233-239`, the deny-list floor belongs as a **dispatch step after `resolveInside`** (where it can see the resolved abs path), not folded into the consent function. Scope the hardline table to what is reachable now (`.env`/`.git` *inside* jail; the notebook + allowlist files) and mark shell.exec/raw-path protection as forward-looking.

**Steps.**

- **P1.5a — Pure broker (no UI).**
  - *Deliverables:* NEW `sidecar/permissions.js` exporting `makeConsentBroker({bypass, hardline?, sessionKey, grantsSession, grantsPermanent, persist?, surface}) -> consent(call,tool) -> {allow,reason,scope}`. Ladder in fixed order: (1) **HARDLINE** tiny injected path/cap table, checked first, unreachable past any flag, returns an anti-retry reason ("do this yourself outside the agent; do not retry or rephrase"); (2) **BYPASS** if frozen `bypass` and not hardline; (3) **CACHE** `dangerKey = tool.capability + ':' + scope`, allow if in `grantsPermanent` ∪ `grantsSession[sessionKey]`; (4) **RESOLVE** — no live prompt yet: read-only (`scope==='read' && !network`) auto-allow; mutating under `surface==='autonomous'` → default-DENY with the "silence is not consent" reason. `'session'` adds to `grantsSession`; `'always'` adds to `grantsPermanent` + `persist()`.
  - *Port/create:* `permissions.js`, `permissions.test.js`, `package.json`.
  - *Tests:* `permissions.test.js` — hardline denies a write to the notebook/allowlist file **even with `bypass=true`** (floor-before-bypass); read auto-allows; un-granted mutation under `autonomous` returns `{allow:false}` with anti-retry reason; a `'session'` grant lets the same `dangerKey` through next call but a **different** `sessionKey` still denies (session-scoped, not process-global); `'always'` calls `persist()` once and survives a fresh broker rebuilt from the persisted set; a thrown `persist()` degrades to deny.
  - *DoD:* broker pure (injected bypass/grants/persist, clock-free), headless, deterministic; gating test green; fast suite `<~10s`; one commit, ≤3 files.

- **P1.5b — Wire in as `ctx.consent`.**
  - *Deliverables:* `index.js` reads `const BYPASS_FROZEN = isTruthy(process.env.SKYNET_FULL_ACCESS)` once at boot; loads `WORKSPACES/permissions.allow.json` into a Set (tolerate missing/corrupt); adds an atomic `persist()` (temp+rename, sibling of the notebook store). In `handleRun`, build the broker (`sessionKey:runId`, `surface:'autonomous'`) and pass `consent: broker` into `makeCapCtx` instead of the stub at `:134`. `grantsSession` is a module-level `Map<runId,Set>` cleaned on run end.
  - *Port/create:* `index.js`, `harness.integration.test.js`.
  - *Tests:* **Reconcile the existing fixture first** — `harness.integration.test.js` currently writes `report.md` (a `requiresConsent` fs_write) and asserts the mission completes with no capdenied. Under `bypass:false` that flips to denied. Resolve by injecting `bypass:true` (Full-Access surface) **or** seeding `grantsPermanent` with `fs.write`'s `dangerKey` for the legacy mission, and add a *new* scripted un-granted write that returns an isError 'denied' (pairing held, body never ran, run recovers).
  - *DoD:* `index.js` stays the only ambient-IO module; bypass frozen at boot; allowlist save-safe; double-run byte-identical; fast suite green; one commit, ≤3 files.

- **P1.5c — (DEFER to M6 / WS bridge) Live diegetic prompt.** `surface==='interactive'` emits `permission.prompt{promptId, agentId, tool, scope, argsSummary}` (run `argsSummary` through `redact`/summarize before emit) and returns a Promise registered in `Map<promptId, resolve>`; a `permission.response{decision}` resolves it; a per-prompt timeout resolves to `{allow:false, reason:'timed out — silence is not consent'}` so pairing always holds. Just a Promise + Map — no threading/queue machinery. Until the bridge lands, `surface` stays `'autonomous'` (the correct safe floor).

- **P1.5d — (DEFER, optional) Smart cheap-aux auto-approve.** A 4th tier reusing `classify.js`/aux-model: a single temp-0 max-16-token APPROVE/DENY/ESCALATE classify, **gated to `scope==='read' && !network` only**, fail-toward-prompt on any error. Off by default. Never on the critical correctness path; never auto-allows a destructive scope.

---

#### L2 — Tool-call argument repair (spine-hardening; AFTER L1)

**Goal (scoped to arg-repair only).** Recover mechanically-broken tool-call argument JSON from non-Anthropic models *before* declaring a call failed, turning a discarded-action failure into a visible, repaired call.

> **Dropped from the original design:** the outbound surrogate-scrub half. `JSON.stringify` does **not** crash on lone surrogates — it escapes them to `\udXXX` and the wire body stays valid (empirically disproved). That "fix" targets a non-bug; defer any inbound-validation concern until a real OpenRouter 400 is observed.

**Seam.** `loop.js` `parseCall` (`:27-31`) does `JSON.parse` once; on failure `registry.js:61` short-circuits the whole call to an isError result. **Hoist the repair into the loop body at `loop.js:143`** (where `emit`/`agentId`/`runId` are in scope) rather than changing `parseCall`'s signature — `parseCall` has no test and is referenced only inside `loop.js`, so leave it pure and repair `tc.args` around the map call.

**Dependencies.** The streaming accumulator (`openrouter.js:83-94` → `loop.js:121-122`) and the `registry.js:61` short-circuit both already exist. A new event rung must be added before emitting.

**Risk.** low.

**Conflict-resolutions.**
- *Frozen contract:* `tool.args.repaired` is **not** in `events.js`; `emitter.js` would drop+log it and `lint-emits.js` would flag the literal `emit`. Add the rung first. Truncate `before`/`after` to 80 chars; `redact()` at the bus scrubs any echoed key.
- *Determinism:* repair is pure string/regex/count passes; the delimiter-balance loop has a **hard iteration cap (~50)** so a pathological payload cannot spin.
- *Tool-id pairing:* repair only rewrites the args string — never the call id or count. The `{}`-degrade makes the call *succeed with no args* only when `JSON.parse('{}')` succeeds; it does **not** bypass `schema.validate` at `registry.js:72`, so a tool whose schema requires args still correctly errors. Document this: `{}`-degrade is recovery-of-intent, not a validation bypass.

**Steps.**

- **L2.S1 — Pure repair module (no wiring).**
  - *Deliverables:* NEW `sidecar/providers/sanitize.js` exporting `repairToolCallArguments(raw, name) -> string` with the staged passes: (0) trim; empty/`'None'` → `'{}'`; (1) tolerant control-char-escape then parse+reserialize to canonicalize; (2) strip trailing commas `/,\s*([}\]])/g`; (3) COUNT-based delimiter balance (append-missing, then bounded-50 strip-excess); (4) in-string control-char (`<0x20`) → `\uXXXX` scanner respecting backslash escapes; (5) last-resort `'{}'`. Use a small `make(reason, overrides)` helper, **not** the reference harness's `result_fn` plumbing. No `__cause__` walk, no SDK-class sniffing.
  - *Port/create:* `sanitize.js`, `sanitize.test.js`, `package.json`.
  - *Tests:* `sanitize.test.js` — trailing-comma, unclosed-brace, unclosed-bracket, literal `None`, empty→`{}`, tab/newline-in-string, excess-closers, and a pathological deep-unbalanced payload that terminates under the 50-iter cap. Each pass returns valid parseable JSON.
  - *DoD:* pure; `lint-determinism` green; one commit, 2 files + package.json; nothing wired, revertable.

- **L2.S2 — Freeze the event, then wire repair into the loop.**
  - *Deliverables:* `shared/events.js` adds `'tool.args.repaired': obj(['agentId','runId','callId','name'], {agentId:str, runId:str, callId:str, name:str, before:str, after:str})`. `loop.js:143` repairs `tc.args` before/around the `parseCall` map; on success rewrite `argsRaw` (so `assistantTurn` at `:36` replays valid JSON) and `emit('tool.args.repaired', …)`; on continued failure keep `parseError`.
  - *Port/create:* `events.js`, `loop.js`, `loop.replay.test.js` (+ `contract.test.js` fixtures).
  - *Tests:* a replay fixture whose `tool_args` fragments accumulate to broken JSON → the loop emits `agent.tool_call` + exactly one `tool.args.repaired`, `tool_calls[0].function.arguments` is now valid, dispatch runs the tool (not isError), `assertPaired` holds, double-run byte-identical. An unrepairable-args fixture still becomes a single isError result. `contract.test.js` gets one valid + one invalid `tool.args.repaired` fixture; `lint-emits.js` green.
  - *DoD:* fast suite green; ≤3 files; revertable.

---

#### L3 — Error-classification (producer half now; consumer half deferred)

**Goal.** Replace the pre-stream `err.transient` bit with a pure classifier so the retry loop stops burning paid attempts on never-succeed failures (402/400/refusal), and make `agent.run.error.transient` classifier-derived instead of hardcoded `false`.

> **Corrected framing:** the frontend does **not** read `transient` (`harness.js` reads only `payload.message`; zero readers of `transient` in `frontend/`). So the consumer half is *forward-correctness for a future contract/telemetry consumer*, not a user-visible fix. The two action hints `shouldFallback`/`shouldCompress` have **no recovery to call yet** (single model per run; `context.js` unwired) — record them inert, do not branch.

**Seam.** Producer: `openrouter.js:185` (`if (err.transient && attempt < RETRY_DELAYS.length)` → classify). Consumer: `loop.js:126-129` catch (set `transient` from the classifier). Note both sites classify the **same** error (producer for retry with only `{model}`, consumer for transient with the full opts bag) — assert both; the producer's `context_overflow` path is permanently dead (no `approxTokens`), which is fine.

**Risk.** low. **Defer rationale:** off the named critical path; do the producer half if cheap, but **1.5 consent is higher-priority** and must not be displaced.

**Conflict-resolutions.**
- *Determinism:* classifier is pure `(err, opts)`; no clock/rng. `RETRY_DELAYS` stay fixed/no-jitter.
- *Cold-catalog guard (corrected):* `provider.contextLimit(model)` returns **0** until the async `/models` warm completes (`openrouter.js:148-149`). Apply the `approxTokens > 0.4*contextLimit` context-overflow ratio **only when `contextLimit > 0`**, else fall to `format_error` — otherwise every bare-400 mis-classifies as context_overflow early in process life.
- *Frozen contract:* do **not** add a `reason` field to `agent.run.error` (frozen, would be dropped). Fold the reason into the human `message` string; a structured `reason` enum is a deliberate later schema-rung step.
- *Module name:* use `sidecar/providers/errorClass.js` / `test/errorclass.test.js` — `classify.js` is taken (`frontend/app/classify.js`).
- *Guards-before-spend:* the classifier is read **inside** the existing post-failure catch; making 402/400 stop retrying only *reduces* spend.

**Steps.**

- **L3.S1 — Pure classifier + truth table (no wiring).** NEW `sidecar/providers/errorClass.js` `classifyApiError(err, {provider, model, approxTokens, contextLimit, numMessages}) -> {reason, retryable, shouldRotateCredential, shouldFallback, shouldCompress, statusCode, message}`. ~9 reasons (`auth, billing, rate_limit, overloaded, server_error, timeout, context_overflow, model_not_found, content_policy_blocked, format_error, unknown`). Priority pipeline: content/policy first → HTTP-status → structured error-code → message-pattern → timeout/transport → unknown→retryable. Port the 402/usage-limit split (402 = billing *unless* body says "resets at"/"retry after" → rate_limit) and the metadata.raw unwrap. `test/errorclass.test.js` truth table (pure; no fetch/fs/clock). DoD: 2 files + package.json; lint-determinism green; isolated.
- **L3.S2 — Producer seam.** `openrouter.js` requires `errorClass`; replace the `:185` gate with `const c = classifyApiError(err, {model: body.model}); if (c.retryable && attempt < RETRY_DELAYS.length)`. Extend `provider.openrouter.test.js`: 402 fails fast (`calls===1`), 502 still retries (`calls===2`). DoD: provider tests green; double-run byte-identical; ≤2 files.
- **L3.S3 — Consumer seam (honest transient).** `loop.js:126-129` sets `transient: c.retryable`, `message: c.message || …`; `approxTokens`/`contextLimit` arrive as **new injected fields** on the loop options bag — `loop.js` stays pure. `index.js` computes them (inline `ceil(JSON.length/4)` for `approxTokens` — do **not** pull `makeContext` wiring into a resilience commit; `contextLimit = provider.contextLimit(model)`). Record `shouldFallback`/`shouldCompress` with a one-line "extension point" comment; still `end('error')`. Extend `loop.replay.test.js` with a hand-rolled **throwing** provider (the replay provider yields fixtures and cannot throw — this needs a new helper): 429→`transient:true`, 402→`false`, malformed-400→`false`. DoD: ≤3 files; replay double-run byte-identical.

---

### Group B — Layers that ride along with a roadmap phase

These attach where a future phase's prerequisite seam lands. They are written so they are **adopt-now the moment that substrate exists**, not before.

---

#### L4 — Context compaction (rides the `context.js`-wiring spine step, after P1.5)

**Goal.** Wire the already-built `context.js` into the loop so a long run auto-compacts on real `prompt_tokens` instead of dying on an OpenRouter 400; harden `compact()` with three honesty guards (token-budget tail, tool-group alignment, newest-user survival) + anti-thrash backoff + orphan-tool-id stub.

**Seam (corrected).** Insert the compaction block **after `loop.js:163`** (end of the tool-execution branch, where `messages` is fully paired *and* raw `usage` is still in scope) — **not** at `:140` where the current assistant turn and its tool results have not yet been appended. The `done` branch (`:147`) returns before any next call and needs no compaction.

**Dependencies.** The **`context.js`→`index.js` wiring is its own isolated spine step** (it is the missing context-window-overflow handling; `index.js` imports only `redact` at `:25` and assembles `[{role:system},...messages]` inline at `:189-190`). An injected one-shot summarizer (a `provider.stream` call wrapped as a dependency, preserving determinism). A new `agent.compact` event rung.

**Risk.** med. **Defer rationale:** not a today-wedge (a too-long run dies with one clean `agent.run.error`, bounded by `maxIters:16` + `maxCostUsd:1.00`); must sit behind P1.5.

**Conflict-resolutions.**
- *Cold-catalog no-op:* `shouldCompact` returns false when `contextLimit===0` (`context.js:96`). The wiring step must either block the run until catalog warm or pass a static per-model floor; document the 0 case.
- *Determinism:* the summarizer is **injected** (`o.summarize`), never a bare provider call inside the loop; tests inject a deterministic fake; short fixtures inject none, so the replay suite stays byte-identical.
- *Tool-id pairing:* `alignBoundaryBackward` (never cut inside a tool_call/tool_result group) + `sanitizeToolPairs` (stub any tool message whose matching assistant tool_call was summarized away). **Mandatory** — `assertPaired` would otherwise throw next turn.
- *Frozen contract:* add `agent.compact` rung first.
- *Resilience:* a thrown summarizer → keep the un-compacted tail and continue. No wedge, no double-charge.

**Steps.** (each ≤3 source files, gating test first)
- **L4.S0 — (separate spine step, owned by the spine) Wire `makeContext().systemPrompt`/`fit`/`shouldCompact`/`compact` into `index.js`'s run path**, replacing the inline assembly at `:189-190`. Golden: the un-skilled/short run path is byte-identical.
- **L4.S1 — `agent.compact` rung** in `events.js` (`{agentId, runId, beforeTokens, afterMsgs, savingsPct, summarized}`) + valid/invalid `contract.test.js` fixtures. No producer yet.
- **L4.S2 — Harden `compact()`** (still pure): replace the fixed `keepTail` slice with the token-budgeted tail walk + the three guards + the orphan stub + an `_ineffectiveCount` anti-thrash counter (stop after 2 passes saving `<10%`).
- **L4.S3 — Wire into the loop after `:163`** with the injected summarizer + resilience catch; emit `agent.compact`. Both `o.ctx` and `o.summarize` default undefined → block inert → existing tests byte-identical.

> **Drop (the reference harness accretion):** the prefix-museum jailbreak-hardening, `should_defer_preflight_to_real_usage`, the ~180-line static-fallback builder, the pluggable-ContextEngine ABC. Single-provider OpenRouter needs none of it.
>
> **Drop the `IterationBudget` refactor** — it is a near-zero-value rewrite of the existing `turns`/`maxIters` counter (`loop.js:104,111`), its `refund()` is speculative dead code (no P4 delegation consumer), and it churns the `agent.run.end` payload that `contract.test.js` asserts.

---

#### L5 — Declarative ProviderProfile + registry (rides Phase 1.5/2 model-picker or Phase 5.0)

**Goal.** Turn the three OpenRouter-specific lines in `openrouter.js` into a declarative `ProviderProfile` + a tiny registry, so provider #2 is a data record, not a forked file — without touching `loop.js`/`cost.js`/the event contract.

**Seam.** `makeOpenRouterProvider` call sites at `index.js:137` (per-run) and `:85` (catalog warmer), behind the `LLMProvider` contract. The entire provider-specific surface is: `BASE` (`openrouter.js:18`), the request body's extra fields (`:53`), and the `'HTTP-Referer'`/`'X-Title':'STARNET'` headers (`:170`).

**Risk.** low. **Defer rationale:** a registry with one entry is indirection without a caller. Land `P-prof.1`+`P-prof.2` the commit **before** provider #2; gate `P-prof.3` on that second provider existing.

**Conflict-resolutions (corrected — these are load-bearing).**
- **Resolve the `usage:{include:true}` contradiction first.** `openrouter.js:53` *does* send `usage:{include:true}` while the header comment (`:7-9`) says it does NOT. Decide which is correct **before** freezing it into a profile default; do not "preserve the exact current wire" blindly, and do not add a test that locks in a body the author already flagged as a dead no-op.
- **Keep `baseUrl` and `referer` injectable.** `openrouter.js` threads `opts.baseUrl` (`:49`) and `opts.referer` (`:50`) per-instance. A static `profile.defaultHeaders`/`baseUrl` must still let the index.js edge override both, or it regresses the injection seam. Add a test driving a custom `baseUrl`+`referer` through the profile path (the existing test never exercises them).
- **Move `CATALOG`/`CATALOG_PROMISE` out of module scope.** They are module-level globals (`openrouter.js:23-24`). Generalizing `loadCatalog` "verbatim" into a shared `chatCompletions.js` would make provider A and provider B collide on one global catalog → wrong `priceOf`/`supportsTools`. A second provider **requires per-profile catalog state** — this contradicts the "byte-identical, verbatim extraction" framing and must be fixed in `P-prof.1`.
- *Determinism:* the `OMIT` sentinel is a JS `Symbol` (not Python's `object()`); hooks are pure.

**Steps.** `P-prof.1` extract `makeChatCompletionsProvider(profile, {fetch,key})` (per-profile catalog state, injectable baseUrl/referer), keep `openrouter.js` as a 3-line shim so no caller breaks; the unchanged `provider.openrouter.test.js` is the regression lock. `P-prof.2` add `profiles.js` (`OMIT` Symbol, bundled openrouter profile, `{register, get, list}` with alias resolution + last-writer-wins) + `providers.registry.test.js`. **`P-prof.3` (LAND ONLY WITH PROVIDER #2):** rewire `index.js:137`/`:85` to `registry.get(providerName)||registry.get('openrouter')`, add one real second profile as pure data, prove generality with `providers.secondprofile.test.js`.

> **Note on the Phase-5 framing:** managed-credits is a **`priceOf`/key-source swap** at `index.js` (`makeCostEngine({priceOf})`), most likely the *same* OpenRouter wire — it does **not** necessarily introduce a second OpenAI-compatible profile. The only honest second consumer is a genuinely different-wire direct provider (P1.5/2 model-picker or P4 tool expansion).
>
> **Drop:** plugin-dir discovery, the 30-field dataclass, `auth_type` variants, per-model string-sniffing.

---

#### L9 — Subagent delegation (rides Phase 4; D0 is optional seam-hardening)

**Goal.** A `delegate` builtin that spawns context-isolated child runs (fresh messages, own runId, attenuated toolset, blocklist-stripped) via a recursive `runAgentLoop`, returning only each child's summary, depth-capped at 1 — under the Phase-4 org-graph authority, not beside it.

**Seam.** `runAgentLoop` is fully injectable (`loop.js:75`). `attenuate(resolved, allowedSubset)` (`capGate.js:21`) **is** the reference harness intersect-with-parent rule (monotonic ∩). The real gap: the loop passes `capCtx` as the dispatch `ctx`, but `provider`/`cost`/`signal`/`model`/the **host-wrapped** dispatch live as loop locals, so a tool physically cannot re-enter the loop today.

**Risk.** med. **Defer rationale:** with N=1 in one hardcoded `office` room (`index.js:127-132`) there is no agent to delegate *to*; the door-gated authority (P4.2) and real consent (P1.5) don't exist; a child loop calling `registry.dispatch` directly would lose `maxRepeat`/`maxToolBytes`/wire-name translation (which live in the **`index.js:158-174` wrapper**, not `registry.dispatch`).

**Steps.**
- **D0 (optional seam-hardening, adopt-now-able): make the loop provably re-entrant.** `loop.js` `executeCalls` builds the dispatch ctx as `Object.assign({}, capCtx, {provider, cost, signal, model, parentRunId: runId, parentAgentId: agentId, dispatch, _delegateDepth: capCtx._delegateDepth||0})`; `index.js` threads its **wrapped** dispatch into capCtx so a child reuses the guards. `loop.reentrant.test.js` must assert the child received the **wrapped** dispatch (prove a guard fires for the child — `ctx.dispatch` present alone is insufficient, raw `registry.dispatch` would also satisfy it). ≤3 files (`loop.js`, `index.js`, the test).
- **D1 (DEFER to P4.0): the `delegate` builtin** behind a CAP_REGISTRY `coordinator` row (object=capability gated, never ambient), depth-gated, budget-bounded (shared remaining-budget into child limits), blocklist-strips `delegate` + every `requiresConsent` tool, child `runId = ${parentRunId}.sa${index}` (deterministic, **not** `crypto.randomUUID`), returns only `{results:[{summary,status,...}]}`. No new event names — child telemetry rides existing `agent.*` under a child runId.

> **Drop:** `ThreadPoolExecutor`/initializer, the build-on-main-thread global-cache juggling, the `execute_code`/RPC machinery, credential-resolution cruft, `max_spawn_depth>1`, the staleness monitor + timeout diagnostic dump, JSON-string task recovery.

---

### Group C — Deferred / optional

| Layer | Defer to | The un-defer trigger |
|---|---|---|
| **L6 — Credential pool + fallback chain** | a multi-key phase the roadmap **does not yet contain** (P1.0 keychain stores **one** key; P5.0 is a different credential *path*, not multiple keys per provider). Cross-provider chain → P4.1/P5.0 (the first ordered `{provider,model}` config). | An intake that lets a user supply **>1 key per provider**. The now-safe sub-piece (no raw key at rest/in logs) is **already met** by `redact()` (`context.js:31-37`); the on-disk pool file (if ever built) is **not** crossed by the bus, so it must store fingerprints-only **by construction**, plus a versioned migration + a cooldown-timer determinism test (reload under an injected frozen clock → byte-identical). |
| **L7 — File-safety + SSRF floor** | **mostly skip.** | The flagship symlink-TOCTOU is **not reachable** (no fs tool creates symlinks; EPERM on the Windows dev host, so the gating test no-ops on the only CI host). 5 of 6 metadata targets are **already blocked** by `web.js`. The **only** genuinely-new delta worth doing now: add bare `metadata.goog` (and `metadata.google.internal` belt-and-suspenders) to the blockedName list in `web.js assertSafeUrl`, plus one test — a one-line change, **not** a `urlSafety.js`/`fileSafety.js` extraction. Do **not** add `realpath` to the hot `resolveInside` path (false-rejects on Windows drive-letter/8.3/`\\?\` casing unless `base` is also canonicalized; changes just-shipped behavior). |
| **L8 — Self-improving skill layer** | **RPG-2** (classes = real `context.systemPrompt` change), gated on **RPG-0** (run-log/`sidecar/ledger.js`). | (1) `context.systemPrompt` wired into `index.js`'s run path (the L4.S0 step) — until then a written skill is a cosmetic badge, the exact antipattern the RPG doc forbids; (2) a loop **completion hook** (`loop.js` `end()`); (3) a durable run-log; (4) a **cumulative spend cap** before any auto-spawned paid review fork (today `maxCostUsd` is per-run only). The periodic curator is an explicit user **Forge** verb, not the reference harness's hidden 7-day cron. Do **not** pull the pure store/lifecycle modules forward — as unused code they ship dead against the build-order rule; land them **with** their first consumer. Note: the "Forge" in `rpg-layer-design.md:98` writes a *capability grant row*, a different mechanic from skill curation — re-target this away from RPG-3. |

---

## 4. The first five commits (dependency-ordered, smallest-first, each independently shippable + test-gated)

Each is one revertable commit, ≤3 files, gating test written first, fast suite green before the next.

1. **`permissions.js` pure consent broker (L1 / P1.5a).** The four-tier ladder as a pure, injected-dep module + `permissions.test.js`. No wiring. *Why first:* it is the one named-spine deliverable (P1.5) and closes a live default-deny safety hole (`index.js:134` allow-all). Files: `sidecar/permissions.js`, `test/permissions.test.js`, `package.json`.

2. **Wire the broker as `ctx.consent` (L1 / P1.5b).** Frozen `BYPASS` const at boot, save-safe allowlist load/persist, swap the stub at `index.js:134`; reconcile the existing `harness.integration.test.js` mission (seed the grant or use Full-Access surface) and add a default-deny assertion. Files: `sidecar/index.js`, `test/harness.integration.test.js` (+ allowlist file shape). *Depends on commit 1.*

3. **`sanitize.js` pure arg-repair module (L2.S1).** The staged JSON-repair ladder + `sanitize.test.js`, bounded 50-iter loop, no wiring. *Independent of 1–2; safe to land after the consent spine is green.* Files: `sidecar/providers/sanitize.js`, `test/sanitize.test.js`, `package.json`.

4. **Freeze `tool.args.repaired` + wire repair into the loop (L2.S2).** Add the event rung + `contract.test.js` fixtures, hoist repair into `loop.js:143` (rewrite `argsRaw` on success, emit once). Files: `shared/events.js`, `sidecar/loop.js`, `test/loop.replay.test.js`. *Depends on commit 3.*

5. **`errorClass.js` pure classifier + truth table (L3.S1).** The ~9-reason classifier with the cold-catalog `contextLimit>0` guard + `errorclass.test.js`, fully isolated (no wiring). *Independent; sets up the cheap producer-half win (L3.S2) and honest-transient (L3.S3) as follow-ons that must not displace 1.6/1.7/1.8.* Files: `sidecar/providers/errorClass.js`, `test/errorclass.test.js`, `package.json`.

> Commits 1–2 are the spine (P1.5). Commits 3–5 are spine-hardening that strengthens shipped M1 work without jumping ahead of 1.6 PROPTERM / 1.7 triggers / 1.8 recovery. Nothing here touches `loop.js`'s while-loop structure, `cost.js`, the capability projection, or the frozen events beyond additive rungs.

---

## 5. Explicitly NOT doing / antipatterns avoided

**Whole layers dropped or radically descoped (with the disproven premise):**
- **No fs-jail `realpath`/symlink-TOCTOU rewrite.** No fs tool can create a symlink (`fs.write` is `fsp.writeFile`); the threat is unreachable and the gating test no-ops on the Windows dev host. Adding `realpath` to `resolveInside` would false-reject legitimate Windows paths.
- **No outbound surrogate scrub.** `JSON.stringify` escapes lone surrogates to `\udXXX`; the wire body stays valid. It "fixes" a non-bug.
- **No provider registry, no credential pool, no delegate tool, no skill layer built now** — each lacks its consumer (provider #2, a second key, a second agent, a wired system prompt + run-log). They are recorded as ready-to-pull, seam-confirmed, and gated on the substrate that justifies them.
- **No `IterationBudget` refactor** — speculative generality with dead `refund()` and `agent.run.end` payload churn.

**ref-isms left in the mine:**
- Plugin-directory discovery, the 30-field `ProviderProfile` dataclass, `auth_type`/OAuth/Copilot/Bedrock variants, per-model string-sniffing.
- The 60+ shell `DANGEROUS_PATTERNS` table (we gate **structured tool calls by capability+scope**, not regex over command strings).
- `contextvars` + `threading.Lock` + `Event`-queue concurrency, `__cause__`/`__context__` chain-walking, `isinstance`/SDK-class frozensets, `ThreadPoolExecutor`, fcntl/msvcrt locking — Node is single-threaded async; a Promise + `Map` is the whole mechanism.
- The 270-line classification reconcilers, the ~250-line prefix-museum summarizer prompts, the static-fallback summary builder + cooldowns, the pluggable-ContextEngine ABC, the non-ASCII codec family, deep recursive nested-structure surrogate walkers.
- Python-isms: `OMIT = object()` (→ JS `Symbol`), `dataclasses.replace`, `field(default_factory=...)`, `result_fn` closure plumbing, lazy in-function imports.

**Contract corrections honored (do not regress these in implementation):**
- Resolve the `usage:{include:true}` code-vs-comment contradiction (`openrouter.js:53` vs `:7-9`) before freezing it into any profile default.
- Move `CATALOG`/`CATALOG_PROMISE` to per-profile state before any second-provider work.
- `capCtx` carries neither `runId` nor `callId` — derive `promptId` from the broker closure's `sessionKey` + `call.id`.
- The deny-list floor belongs as a dispatch step **after** `resolveInside` (per `HARNESS_ARCHITECTURE.md:233-239`), not folded into the consent function.
- The frontend reads `payload.message`, not `transient` — `agent.run.error.transient` honesty is forward-correctness, not a user-visible fix.
- Every new event (`tool.args.repaired`, `agent.compact`, any future `skill.*`/`provider.credential.*`) gets a `shared/events.js` rung **before** its first `emit`, or `emitter.js` drops it and `lint-emits.js` fails.
