# STARNET Harness — Architecture Reference

> Engineering reference for the agent-harness backend. The *roadmap* (what to build when) lives in
> `archive/INCREMENTAL_ROADMAP.md` (historical) and the approved plan; this doc is the *target shape* (modules, interfaces,
> the event contract, invariants) that every step builds toward. Keep it in sync as the code lands.

## 1. Purpose & the one bet

Turn the ~126-line one-shot BYOK streaming wrapper (`frontend/app/harness.js`) into a real agentic
harness: a `model → tool → result → loop` with capabilities, budget governance, context management,
cancellation, and **truthful telemetry**. The central bet: the kept v7 pixel canvas is driven **only**
by validated `U.bus` events the harness emits, so the world is never set-dressing — every token, tool
call, and dollar on screen corresponds to a real runtime transition.

## 2. The loadability rule (non-negotiable)

Every backend module is **CommonJS with dependency injection**. **No `fetch` / `localStorage` /
`window` / `Date.now` / `Math.random` at module scope or anywhere in backend logic.** All ambient
capability arrives through a factory:

```js
createHarness({ provider, bus, store, clock, rng, secrets, budget })
```

- Tests `require()` the module under plain `node` and pass **fakes** (replay provider, in-memory
  store, seeded rng, fixed clock).
- The browser builds the harness with `globalThis.fetch`, a `localStorage` store, a real clock, and a
  seeded rng; modules are exposed via a tiny UMD tail (`module.exports` under node, a global under the
  browser).
- The Node sidecar (M6) passes its own `fetch`/keychain-backed `secrets` — **same modules, same tests.**

Determinism: same seed + same fixture ⇒ **byte-identical** run output. This is what makes the headless
replay tests meaningful.

## 3. Module layout

```
shared/        pure, env-agnostic primitives
  schema.js      zero-dep JSON-schema-lite validator: validate(schema, value) -> {ok, errors[]}
  events.js      FROZEN EVENTS registry + validate(name, payload) + SCHEMA_VERSION   [THE CONTRACT]
  emitter.js     makeEmitter(bus, log): validate-then-emit; drops + logs malformed, NEVER throws
  clock-rng.js   makeClock(nowMs) -> {now()}  ·  makeRng(seed) -> {next(), int(a,b), pick(arr)}

sidecar/       harness logic (in-browser behind Harness now; Node sidecar at M6)
  harness.js     createHarness(...) -> PUBLIC SEAM (see §7)
  loop.js        runAgentLoop({messages, tools, provider, emit, limits, clock, signal, capCtx, dispatch})
  context.js     makeContext({contextLimit}): assemble / fit / shouldCompact / compact / redact
  cost.js        makeCostEngine({priceOf}): estimate(usage) / reconcile(finalUsage)
  budget.js      makeBudget({caps}): check(spent) / record(usd) / tripped() / kill()
  queue.js       makeRunQueue(): per-agent serial run queue + history/ledger lock        [M4]
  secrets.js     getKey / setKey / hasKey   (localStorage now; keychain-RPC at M6)
  providers/
    provider.js    interface doc (see §6)
    replay.js      makeReplayProvider(fixture) — identical interface, zero network/spend   [CI]
    openrouter.js  makeOpenRouterProvider({fetch, secrets, baseUrl}) — ONLY module that knows OR wire fmt
    catalog.js     /models -> {id, context_length, max_completion_tokens, pricing, supportsTools}
  tools/
    tool.js        makeTool({name, description, schema, scope, readOnly, capability, requiresConsent, run})
    registry.js    makeRegistry(): register / list(capSet) / wireFormat(tools) / dispatch(name, rawArgs, ctx)
    builtin/       notebook.js [M1] · fs.js [M5] · shell.js [M5] · web.js [M5]
  capability/
    registry.js    CAP_REGISTRY: objectType -> grant[]            (THE static map)
    resolve.js     resolveTools(agent, station) -> {tools[], approvalRules[], budgetCaps, networkCaps}
    capGate.js     canAgentUse(org, agentId, need) -> {ok} | {ok:false, code:'capdenied', need}
    permissions.js consent broker: prompt/response, decisions keyed by (agent, tool, scope), deny-list floor

bridge.js        [M6] WS client: sidecar event -> validate() -> U.bus.emit; forwards user actions back

frontend/app/
  harness.js     thin browser shim that builds createHarness(...) with browser deps — SAME public surface
  telemetry.js   [M3] subscribes to U.bus; drives World.setThinking/say + HUD from events ONLY

test/
  _assert.js     eq / throws / collectBus / replayProvider   (zero-dep, matches err()+process.exit convention)
  *.test.js      contract · loop.replay · tools · capgate · context · budget · save.migrate
```

Placement note: `shared/` and `sidecar/` live at the **gen/ root** (siblings of `frontend/` and
`test/`). Through M2, all of it is exercised headlessly under `node` (no browser). At M3 the browser
load path is wired (`harness.js` shim + `telemetry.js`); only then does the served frontend depend on
these modules.

## 4. The `U.bus` event contract

All cross-boundary event names live in `shared/events.js` with a payload schema. `validate(name,
payload)` runs at the bus boundary in **both** directions. Malformed payloads are **dropped + logged,
never thrown** — because `U.bus.emit` (`frontend/js/util.js:64`) wraps handlers in try/catch and only
`console.error`s, so a throw inside a handler is swallowed. **Therefore tests assert AFTER a run, never
inside a handler.** A CI lint greps `emit('…')` / `bus.emit('…')` and fails on any name absent from the
registry.

Frozen `agent.*` / capability / permission set (frozen all at once at Step 0.1 to avoid a re-freeze):

| Event | Payload | Render / gamify hook |
|---|---|---|
| `agent.run.start` | `{agentId, runId, trigger:'directive'\|'schedule'\|'event', model}` | `World.setThinking(true)`; "dispatch accepted" |
| `agent.reasoning` | `{agentId, runId, on:bool}` | real thinking signal → working look |
| `agent.token` | `{agentId, runId, delta:string}` | PROPTERM typewriter + `World.say` bubble |
| `agent.tool_call` | `{agentId, runId, callId, name, argsSummary}` | `▶ tool {…}` |
| `agent.tool_result` | `{agentId, runId, callId, ok:bool, ms, summary, isError:bool}` | `◀ 200 OK (NNNms)` |
| `cost.estimate` | `{agentId, runId, usd, tokens}` | live meters (marked estimate) |
| `agent.cost` | `{agentId, runId, usd, tokensIn, tokensOut, reasoningTokens, cachedTokens, model, reconciled:true}` | authoritative ledger + HUD + XP |
| `agent.run.end` | `{agentId, runId, reason:'done'\|'max_iters'\|'budget'\|'cancelled'\|'error', turns, usd}` | `setThinking(false)`; LEVEL floater |
| `agent.run.error` | `{agentId, runId, message, transient:bool}` | error + `notify` |
| `run.cancel` | `{runId}` | aborts in-flight |
| `capdenied` | `{agentId, need, reason}` | in-world "no compute placed" |
| `permission.prompt` | `{promptId, agentId, tool, scope, argsSummary}` | diegetic prompt at the object |
| `permission.response` | `{promptId, decision:'once'\|'session'\|'always'\|'deny'}` | — |
| `object.place` / `object.reclaim` | `{room, objectType, instanceId}` | triggers fresh `resolveTools` |
| `budget.threshold` | `{scope:'run'\|'day'\|'global', usd, cap}` | kill-switch HUD |

Reused v7 names (re-emitted from REAL transitions): `task`, `chat`, `deliverable`, `notify`, `stats`,
`level`, `objectives`. Retired (no real source of truth, kept valid but emitted only as optional
cosmetics off real completions): `sale`, `parcel`, `intel`, `flagged`, `hazard`, `party`, `day`.

**Emit discipline:** the loop/tools may not mutate observable state without an emit. N tokens ⇒ N
`agent.token`; M tool calls ⇒ M `agent.tool_call` + M `agent.tool_result`.

## 5. The agentic loop (`sidecar/loop.js`)

Single `messages`-array `while`-loop; the only mutable state is `messages`. Pure & deterministic given
injected `provider` / `emit` / `clock` / `signal`.

```
runAgentLoop({ messages, tools, provider, emit, limits, clock, signal, capCtx, dispatch }) -> {reason, messages}

loop:
  GUARDS (before any paid call, each returns a typed reason):
    signal.aborted                 -> end('cancelled')
    turns >= limits.maxIters       -> end('max_iters')        // ~10–12
    spentUsd >= limits.maxCostUsd  -> end('budget')           // from RECONCILED cost
    stuck (same tool+args xN)      -> end('error')
  STREAM one model call (emit agent.reasoning{on:true} … {on:false}):
    text delta     -> acc.text += delta; emit agent.token
    tool_start     -> acc.toolCalls[index] = {id, name, args:''}     // key by INDEX
    tool_args      -> acc.toolCalls[index].args += chunk             // STRING concat
    usage          -> emit cost.estimate
    done           -> finishReason
  RECONCILE: final = reconcile(usage); spentUsd += final.usd; emit agent.cost{reconciled:true}
             (ledger idempotent by runId — no double-charge on crash/recovery)
  APPEND assistant turn FIRST (text + parsed tool calls; guarded JSON.parse)
  STOP iff zero tool calls accumulated   // defends vs providers mis-reporting finish_reason:'stop'
  EXECUTE calls: read-only concurrent / mutating sequential; each wrapped with a PER-TOOL TIMEOUT.
    every throw / deny / timeout / cancel -> an isError tool_result. NEVER thrown out of the loop.
  HARD INVARIANT: requested call ids === answered result ids (exactly one result per id) BEFORE next call.
  append one tool_result per id; continue.
```

- **Cancellation:** `cancel(runId)` aborts an `AbortController` threaded loop → provider → fetch.
  Partial text is still appended; `agent.run.end{reason:'cancelled'}`.
- **Retry/rate-limit:** `withRetry` wraps **only** the provider call — exponential backoff on
  429/5xx/overloaded (cap ~5–8), honor `Retry-After`. Transient retried silently; fatal →
  `agent.run.error`.
- **Consent never deadlocks:** a pending `permission.prompt` PAUSES the RunJob (persist state, release
  the stream deliberately), default-deny on timeout, queue concurrent prompts; a denied/cancelled/
  timed-out tool id still gets a synthesized `isError` tool_result so the hard invariant holds.
- **Reasoning tokens:** request thinking params where supported; parse `reasoning` deltas distinctly
  from `content`; meter `reasoningTokens` separately (keeps cost honest); surface via `agent.reasoning`.

`chat()` is a single-turn convenience wrapper over `runAgentLoop` (tools=[]) so `chat.js`/`app.js` keep
working until M3.

## 6. Provider interface (the transport seam)

One narrow async-iterator interface; the loop & tools never change across providers.

```
LLMProvider.stream(req) -> AsyncIterable<HarnessEvent>
  HarnessEvent =
    | {type:'text',       delta}
    | {type:'tool_start', index, id, name}
    | {type:'tool_args',  index, chunk}     // argument STRING fragment
    | {type:'tool_done',  index}
    | {type:'usage',      usage}            // prompt_tokens, completion_tokens,
                                            //   prompt_tokens_details.cached_tokens, reasoning_tokens, cost
    | {type:'done',       finishReason}     // normalized: 'tool_calls'|'stop'|'length'|'content_filter'|'error'
LLMProvider.listModels()     -> [{id, context_length, max_completion_tokens, pricing, supportsTools}]
LLMProvider.contextLimit(id) -> number
LLMProvider.priceOf(id)      -> {in, out} | null
```

- `openrouter.js` is the ONLY module that knows the OpenRouter wire format (SSE framing: skip
  `:`-comment keep-alives, `[DONE]` sentinel, buffer partial reads; **index-keyed** tool-call
  accumulation; `usage:{include:true}`; `HTTP-Referer`/`X-Title`). `fetch` is injected.
- `catalog.js` reads `GET /models`, captures `context_length`, `max_completion_tokens`,
  `supported_parameters.includes('tools')`. Tool-enabled requests route only to tool-capable models.
  Generate a fallback tool-call id if a provider omits it.
- `replay.js` yields the same `HarnessEvent`s from a recorded fixture — zero network, zero spend.
- `setProv()` finally branches: `provider = byName(prov)`. An Anthropic-native adapter or a
  `TauriSidecarProvider` slots in behind the same `stream()`.

## 7. Public seam — `Harness` (frozen surface)

```
{ run, cancel, chat, totals, setTotals, resetTotals,
  listModels, priceOf, contextLimit,
  getKey, setKey, getModel, setModel, getProv, setProv }
```

Callers (`chat.js`, `app.js`) bind to this surface and **must not change** when the transport later
moves to the sidecar. The one caller-visible *semantic* change: `getKey()` is redefined to **"is a key
configured?"** (returns a masked sentinel / boolean, never the real secret) so the key never
round-trips to the renderer once the keychain lands. `app.js:72` (`el('in-key').value =
Harness.getKey()`) becomes a "key is set" UI state.

## 8. Tools & capabilities (object = capability)

A grant is a **policy triple**, not a boolean:
```
{ capId, tool, scope:'read'|'write'|'execute', paramConstraints, rateLimit, requiresConsent, network:false, dataHandling }
```

```
CAP_REGISTRY = {                              // static map; the builder UI edits rows, not code
  computer: COMPUTE-GATE — the precondition to spend a model turn at all (no computer in the assigned
            room ⇒ resolveTools context empty ⇒ run denied with capdenied)
  notebook: [ {tool:'notebook.write', scope:'write', requiresConsent:true,  network:false},     // M1
              {tool:'notebook.read',  scope:'read',  requiresConsent:false, network:false} ],
  cabinet:  [ {tool:'fs.read',  scope:'read',  jail:true}, {tool:'fs.write', scope:'write', jail:true, requiresConsent:true} ], // M5
  terminal: [ {tool:'shell.exec', scope:'execute', requiresConsent:true, network:false, jail:true} ], // M5 (Windows AppContainer/Job-Object)
  dish:     [ {tool:'web.fetch',  scope:'execute', requiresConsent:true, network:true, allowlist:[...]} ], // M5
}

resolveTools(agent, station) -> { tools[], approvalRules[], budgetCaps, networkCaps }   // pure, called FRESH every turn
  1. find the agent's ASSIGNED room (capability follows the desk, not the body tile)
  2. collect placed object instances in that room
  3. look each objectType up in CAP_REGISTRY, expand grants, apply paramConstraints, de-dupe
  4. append handoff tools transfer_to_<targetId> per handoffTarget (same list)   [M5]
  5. attach the consent/approval rule per tool
  // room.capabilities is DERIVED — never hand-stored.
```

**Dispatch pipeline (`tools/registry.js#dispatch`) — all host-side, BEFORE the model sees an
unauthorized tool:** `list(capSet)` builds the per-call `tools[]` → guarded `JSON.parse` of args →
schema-validate (invalid ⇒ `isError`, `run` **not** called) → `canAgentUse` (deny ⇒ emit `capdenied` +
synthesized result) → consent gate (auto-allow read/in-jail; prompt for execute/write/network/
out-of-jail; cancelled prompt ⇒ no paid action, denied result) → **deny-list floor** (keychain, app
data dir, save DB, `.git`/`.ssh`/`.env` — rejected **even under Full Access**) → `run(args, ctx)` once,
wrapped in try/catch with a per-tool timeout.

**Network egress is its own capability**, default-off for shell/fs. **Monotonic attenuation on
delegation:** a worker's effective tools = `resolveTools(worker)` ∩ supervisor-passed grant — never
the union. **N=1 today** is the same code path multi-agent uses; multi-agent is data growth.

## 9. Context / memory (`sidecar/context.js`)

- Capture per-model limits from `/models` `context_length` (never hardcode; BYOK spans 8K→1M).
- **Tiered, sectioned system prompt** — `<identity>` / `<capabilities>` (generated from resolved tools)
  / `<rules>` — **byte-frozen per session**; dynamic state injected as a LATE message, not spliced into
  the system string (keeps the prompt-cache prefix stable). Never interpolate `Date.now()` / turn count
  / lifetime tokens into the frozen string.
- **Running-summary + sliding-window compaction:** keep the last K≈6 turns raw; when live
  `usage.prompt_tokens` crosses ~65% of the model limit, fold older turns into a rolling summary placed
  after the frozen prefix, before the kept tail. Prefer raw > compaction > summarization.
- **Token accounting:** read real `usage.prompt_tokens`; track `cached_tokens` separately (proves
  prefix caching works).
- **Persistence:** persist `{system, summary, recentTail, longTerm}` (not the full transcript), scoped
  by `agentId` from day one. SQLite (`sessions`, `messages`, `memory` + FTS5) at sidecar time, swapped
  behind `store`. No vector DB until semantic recall is actually needed.

## 10. Budget / governance & resilience

- `makeBudget({caps:{perRun, perDay, global}})`: `check(spent)` before each model call against
  **reconciled** cost; `record(usd)`; `tripped()`; `kill()` → `run.cancel`s all in-flight +
  `budget.threshold`. A hard per-run cap is present from M1 (default for new users), not deferred.
- **Reconcile overwrites the estimate** (streamed deltas ≠ final billed usage); the committed ledger is
  authoritative and **idempotent by `runId`** (no double-charge on crash/recovery).
- Paid calls fire **only on real triggers** (directive/schedule). The v7 `minuteTick` task generator is
  **deleted, not rebound**; XP/Salvage mint only on `deliverable` and `agent.run.end` proportional to
  real credits spent, never on a game tick.
- Resilience: dropped malformed event, crashed sidecar, cancelled run, corrupt save — each logged, no
  data loss, no stack trace shown to the user.

## 11. Secrets seam (browser now → Tauri keychain later)

The seam stays at `Harness`; the public surface is byte-identical. `setKey(k)` stores (localStorage now;
later `invoke('harness_store_key', {key})` → OS keychain in Rust, injected into the sidecar process env
at spawn, read only there). `getKey()` returns "configured?" — never the real value. At M6 the
`chat()/run()` body swaps fetch → a Tauri command that streams SSE → Rust → a Tauri Channel → the
renderer callbacks; `cancel` maps to `harness_cancel`. Storage: Rust `keyring` crate (Windows
Credential Manager / macOS Keychain / Linux Secret Service) — **not** the deprecated Stronghold, **not**
the plaintext Store plugin. `redact()` strips key-shaped strings from persistence and logs.

## 12. Invariants checklist (every step must hold)

1. No bare `Math.random` / `Date.now` / `fetch` / `localStorage` in backend logic — injected only.
2. Same seed + same fixture ⇒ byte-identical run.
3. Every cross-boundary event is in `shared/events.js`, passes two-way `validate()`, and is covered by
   the emit-name lint.
4. Malformed event payloads are dropped + logged, never thrown into the render loop.
5. Requested tool-call ids === answered result ids (exactly one result per id) before the next model call.
6. Ledger is reconciled-final-usage, idempotent by `runId` — no double-charge, no lost deliverable.
7. The `Harness` public surface stays frozen for callers.
8. The v7 visual engine stays pixel-identical; the canvas is driven only via `World.setThinking/say`
   (now) and `U.bus` events (after M3).
