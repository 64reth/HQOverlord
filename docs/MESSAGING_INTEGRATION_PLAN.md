# Messaging-Platform Integration Plan

> **StarNet** — a layered plan for letting a user **DM their agent from a messaging app** (Telegram first, Discord later) and get a streamed reply, exactly like messaging the reference harness/OpenClaw. This is the companion to `REF_HARNESS_INTEGRATION_PLAN.md` and `INCREMENTAL_ROADMAP.md` and obeys the same discipline: one-line goals, Deliverables/Port-create/Tests/DoD per step, the Definition-of-Done, one-commit-sized steps, critical-path-first. Every seam below was confirmed against the real files; every premature/redundant/hallucinated claim flagged by the adversarial verdicts has been dropped or corrected.

> _Source: `the upstream reference harness` (MIT), cloned to `C:\Users\<you>\harness-ref`, platform subsystem (`gateway/platforms/base.py` + `platform_registry.py` + `platforms/telegram.py` + the `run.py` ingest→run→reply bridge). **Pattern mine, not a port.** Produced by a parallel architecture-map + adversarial-verify pass against the real sidecar (2026-06-14). Prefer the dossier's `corrected` statements over any reader claim they contradict._

---

## 0. BUILD STATUS (2026-06-14) — MVP shipped (C1–C5), tested + live-smoke-verified

The Telegram-first MVP is **implemented and green** (26 test files + 2 lints). Locked decisions: full tools in chat, autonomous-consent now / buttons later, one agent per chat (`tg_<chatId>`), DM-first.

| Commit | What | Files |
|---|---|---|
| C1 | generic transport-agnostic channel adapter (poll/offset/admission/onInbound/send/backoff) | `sidecar/channels/adapter.js` + `test/channels.adapter.test.js` |
| C2 | Telegram concrete adapter + Bot API `fetch` transport (long-poll `getUpdates`/`sendMessage`) | `sidecar/channels/telegram.js`, `telegram.transport.js` + `test/channels.telegram.test.js` |
| C3 | `channel.inbound` / `channel.delivery` / `channel.connect` event rungs | `shared/events.js` + `test/contract.test.js` |
| C4 | `runOnce` extracted from `handleRun` (behavior-preserving) + save-safe per-chat history/chatmap store | `sidecar/index.js`, `sidecar/channels/store.js` + `test/channels.store.test.js` |
| C5 | hub bridge (inbound→runOnce→chunked reply, autonomous, one-run-per-chat) + connect/disconnect/status endpoints + secrets-at-rest + **in-app Messaging panel** | `sidecar/channels/hub.js`, `sidecar/index.js`, `frontend/index.html`, `frontend/app/stationui.js` + `test/channels.hub.test.js` |

**Delta vs. the plan below (§3.5):** the bot token is **not** an env var — it is entered in a **MESSAGING tab in the bottom bar** (token from Telegram's @BotFather). On connect, the browser hands the sidecar `{ token, key, model }` (the app's existing OpenRouter key+model); the sidecar persists them in a **protected sibling file** `WORKSPACES/channels/secrets.json` (outside the fs jail, never on the bus, never returned by `/status`) so polling survives a restart with no browser open. New endpoints: `POST /api/channels/telegram/connect|disconnect`, `GET …/status`. Env (`SKYNET_TELEGRAM_TOKEN` + `SKYNET_OPENROUTER_KEY` + `SKYNET_DEFAULT_MODEL`) remains a headless-deploy fallback. **C6 SHIPPED 2026-07-24** — interactive consent over a Telegram inline keyboard, plus the multiple-choice keyboard §3 had left in the mine. Per-chat opt-in via `/approvals` (**default OFF**, so an un-opted chat still default-denies a headless write and continues, exactly as described below). Live-proven on real Telegram: the run paused at `fs.write`, the keyboard rendered, the tap resumed it, and the file landed on disk. Contrary to the §3 note, **no `shared/events.js` rung was needed** — `brief.ask` already is the clarify tool, and a tap re-enters as an ordinary inbound message carrying the option's own text. See `MESSAGING_POLISH_BACKLOG.md` for the full status block.

---

## 1. Preamble — what we are borrowing and the prime directive

the reference harness attaches an agent to *any* messaging platform through **one abstract class** (`BasePlatformAdapter(ABC)`, `gateway/platforms/base.py:1796`) that owns a transport connection and translates the wire format into two normalized dataclasses — inbound `MessageEvent` (`base.py:1416`) and outbound `SendResult` (`base.py:1545`). The gateway is transport-agnostic: it injects callbacks (`set_message_handler`, `base.py:2234`) and never imports a Telegram/Discord SDK. The agent run is reached through `handle_message → _process_message_background → _message_handler(event)` (`base.py:3919 → 4138 → 4184`), bound to `GatewayRunner._handle_message` (`run.py:6398`) via `run.py:4894`. The reply streams back through `GatewayStreamConsumer` editing one live message (`stream_consumer.py:79`), chunked at the Telegram 4096-UTF16 limit (`telegram.py:349, 2656`).

We are **mining this for patterns, not porting it.** The prime directive, in four clauses:

1. **It is a pattern mine, not a port.** We take the *shape* of an idea (a transport-agnostic adapter contract; two normalized message structs; one injected bridge callback; a default-deny admission gate; one live message edited in place) and re-derive the *smallest honest version* against our seams. We leave behind every ref-ecosystem artifact: the 20-platform `PlatformRegistry` + `PlatformEntry` dataclass, `Platform._missing_` dynamic-enum minting, plugin-dir discovery + `register(ctx)`, the 16-step `ADDING_A_PLATFORM` checklist, PTB's Application/Updater lifecycle, the `TelegramFallbackTransport`/DoH IP discovery, MarkdownV2 escaping, forum-topic plumbing, the media-delivery path-validation security matrix, webhook crypto, `contextvars`/`ThreadPoolExecutor`, and the per-token process-lock + 409-conflict reconnect ladder.

2. **Node, not Python.** Our loop is single-threaded async with real I/O concurrency. There is no `ABC`/`@abstractmethod`, no `@dataclass.to_dict`, no `asyncio.create_task` stream-loop juggling, no `httpx` pool tuning. A long-poll `async` loop + a `Map` is the whole transport mechanism; a TS-style duck-typed interface + plain objects replace the ABC + dataclasses; `fetch`/`undici` replaces `python-telegram-bot`. **No new dependency** — Telegram's Bot API is plain HTTPS JSON (`getUpdates`/`sendMessage`/`editMessageText`/`answerCallbackQuery`), reachable with the same `globalThis.fetch` the sidecar already uses.

3. **Nothing violates the existing discipline.** Every new module is UMD, zero-dependency, headless-testable with injected deps (an injected `transport` so no test ever hits the network), deterministic (no bare `Math.random`/`Date.now`; `lint-determinism.js` scans `shared/` + `sidecar/`, excluding only `sidecar/index.js`). **Every cross-boundary signal goes through `shared/events.js` + `shared/emitter.js` first — a new schema rung *before* any producer**, or `emitter.js` drops it and `lint-emits.js` fails. Every persisted shape (per-chat history, chat→agent map) is save-safe (versioned, atomic temp+rename, tolerate missing/corrupt → fail-closed). One step = one revertable commit, ≤3 files, gating test first, fast suite green (`< ~10s`) before the next.

4. **Nothing jumps the critical path.** The reply contract already exists: the assistant's user-facing text is recoverable **today** by concatenating `agent.token` deltas (`loop.js:146`; the canonical reassembly is `harness.js:91` `full += payload.delta`). There is **no** `agent.message`/`agent.reply` event and we add none — the token-concatenation contract suffices with zero schema change to the reply path. The genuinely-new signals are the *channel lifecycle* rungs (inbound/delivery/connect), which get their `shared/events.js` entry first. The MVP rides the **existing** `handleRun` pipeline and the **existing** consent machinery (`promptConsent`/`pendingByRun`/`POST /api/consent` already shipped in P1.5c) — it forks neither the loop nor the event contract.

---

## 2. Reconciliation — what already exists and must NOT be re-proposed

The following are **built and integration-tested today**; no part of this plan may re-introduce or re-fork them:

| Capability | Where | Note for the messaging adapter |
|---|---|---|
| The sole run-driving ingress: `POST /api/run` body `{ key, model, system, messages, agentId, isTask }` → streamed, validated, **redacted** NDJSON of frozen `agent.*` events | `index.js:111,134-291` | The adapter reuses this contract. It is the *only* production caller of `runAgentLoop` (`index.js:273`). |
| The reply contract: assistant prose = ordered `agent.token{delta}` deltas; **no** dedicated message event exists | `loop.js:146`; reassembly `harness.js:91,112-113` + `chat.js:148` | Buffer deltas keyed by `runId`; on `agent.run.end` send the joined buffer. **Do NOT propose an `agent.message` event.** |
| Run lifecycle + error events: `agent.run.start{runId,model}`, `agent.run.end{reason}`, `agent.run.error{message,transient}`, `capdenied{need,reason}` | `loop.js:121,125,157,134`; `events.js:24-55` | `agent.run.start.runId` is what the adapter needs for cancel/consent; `agent.run.end.reason ∈ done\|max_iters\|budget\|cancelled\|error\|refusal` tells it whether the reply is complete or truncated. |
| The four-tier consent broker (HARDLINE floor → frozen BYPASS → session/permanent/blanket CACHE → RESOLVE) as a pure, injected-dep function | `permissions.js` (`makeConsentBroker`) | Reuse verbatim. It already supports `surface:'interactive'` + an injected `prompt(call,tool)` and `grant(decision,...)` with `once\|session\|always\|full\|deny`. |
| The **live consent channel**: `promptConsent` emits `permission.prompt` down the stream, returns a Promise resolved via `POST /api/consent {runId,promptId,decision}`, auto-denies on abort or after `CONSENT_TIMEOUT_MS=120000` (fail-closed) | `index.js:159-181,296-305`; `pendingByRun` Map `index.js:99` | The adapter's inline-keyboard round-trip targets **this exact** answer path — it does not build a parallel one. |
| Frozen, validated, redacting bus; per-run guardrails (`maxIters:16`, `maxCostUsd:1.00`, `maxRepeat:3`, `maxToolBytes`); dotted→underscore wire-name map; `isTask` tool-capable pre-check; abort on disconnect via `AbortController` in `runs` Map | `shared/*`; `index.js:31,42,152,231-253` | Apply **unchanged** to messaging-originated runs — the caps still bind. |
| Per-agent durable stores keyed by `agentId`: notebook (`WORKSPACES/<aid>.notebook.json`) + permanent allowlist (`WORKSPACES/permissions.allow.json`), both atomic temp+rename, save-safe, siblings of the fs jail | `index.js:52-98` | `agentId` must match `/^[A-Za-z0-9_-]{1,40}$/`. The chat→agent map + per-chat history live as **new siblings** of these stores, same save-safe shape. |
| `index.js` is the **ONLY** ambient-I/O module (http/fs/fetch/`process.env`) | `index.js:1-6` | Adding a Telegram long-poll means the transport's ambient I/O is **owned by `index.js`** (it instantiates the adapter and injects `fetch`); the adapter module itself stays pure/injected. This preserves the invariant rather than widening it. |

**What does NOT exist** (and is therefore genuinely new, requiring a rung-first or a new module):
- **No inbound/trigger event.** `shared/events.js` is outbound telemetry only; `agent.run.start.trigger ∈ directive|schedule|event` merely *labels* why a run began (`events.js:24-25`). A messaging inbound is a brand-new trigger source layered on top of `handleRun`.
- **No server-side conversation memory.** The run path is stateless; the caller supplies the full `messages` array each call (`index.js:138`). Browser history lives only in localStorage, single-agent (`chat.js`/`app.js`/`save.js`). The adapter **must own its own durable per-chat transcript** and replay it as `messages`.
- **No Telegram/Discord adapter, no `sidecar/channels/`.** Grep for `telegram` across `gen/` returns zero files — this is net-new.
- **No bot token / OpenRouter-key / per-chat-model store on the server.** `key` + `model` arrive per-request from browser localStorage; the sidecar holds neither. A messaging run must source them itself (env / config file frozen at boot).

---

## 3. The design

### 3.0 Shape, end to end

```
Telegram getUpdates ──► ChannelAdapter (sidecar/channels/telegram.js)
   (long-poll, plain fetch)        │  normalize → InboundMessage {chatId, text, userId, messageId}
                                    │  admission gate (allowed-chats) — DMs pass, groups whitelisted
                                    ▼
                         ChannelHub (sidecar/channels/hub.js)
                            • chatId → agentId (sanitized, deterministic)
                            • load durable per-chat history (sidecar/channels/store)
                            • one-run-per-chat lock + abort-on-new-message
                                    │  build { key, model, system, messages, agentId, isTask }
                                    ▼
                         handleRun pipeline  (index.js — UNCHANGED contract)
                            • runAgentLoop → frozen agent.* events on an in-process emit sink
                                    │  buffer agent.token by runId; watch agent.run.end / .error
                                    ▼
                         ChannelAdapter.send(chatId, text)  →  Telegram sendMessage
                            • chunk to ≤4096; send-on-complete (MVP)
                            • persist user+assistant turns to durable history
```

The adapter never imports the loop, the provider, or the broker. The **hub** is the analogue of the reference harness's `_message_handler` bridge: the one seam where a normalized inbound message drives the existing run host.

### 3.1 The generic CHANNEL-ADAPTER abstraction (re-derived from the reference harness `base.py`)

the reference harness's irreducible contract (dossier `contract` + the *confirmed* "exactly four abstract methods" verdict) is `connect/disconnect/send/get_chat_info`, with the entire inbound pipeline concrete in the base, and inbound reduced to `build_source → MessageEvent → handle_message`. We collapse the base-pipeline into **our** hub (the reference harness's base owns auth/session/debounce; we keep a *simple* version in the hub) and keep the adapter to the irreducible transport surface.

**Node module:** `sidecar/channels/adapter.js` — not an ABC, a **duck-typed factory contract** (a plain object). A concrete adapter is `make<X>Adapter({ transport, token, allowedChats, onInbound, clock }) → adapter` where:

```
adapter.connect()                 -> Promise<void>   // start the inbound loop; resolves once listening
adapter.disconnect()              -> Promise<void>   // stop the loop, abort in-flight transport calls
adapter.send(chatId, text, opts?) -> Promise<{ ok, messageId?, error?, retryable? }>   // ONE message; chunking is the hub's job, see 3.3
adapter.chatInfo(chatId)          -> { type: 'dm'|'group', id }    // minimal identity (the reference harness get_chat_info → {name,type})
adapter.name                      -> 'telegram'                    // capability/identity tag
adapter.MAX_MESSAGE_LENGTH        -> 4096                          // declared limit; the hub chunks to it
```

Inbound is **push, not pull from the contract's view**: the adapter owns its transport loop and calls the injected `onInbound(msg)` with a normalized `InboundMessage` (our `MessageEvent` analogue, a plain object, no class):

```
InboundMessage = { chatId: string, chatType: 'dm'|'group', userId: string, userName?: string,
                   text: string, messageId: string, ts: number }   // ts from injected clock, never Date.now() inside the module
```

`onInbound` is the single bridge — the adapter has **zero knowledge** of the loop/provider/agent (the *confirmed* runtime-agnostic half of the reference harness's "one callback" claim). Per the dossier's **corrected** verdict, the reference harness actually injects *five* callbacks (`set_message_handler` + fatal-error/session-store/busy/topic-recovery); we deliberately keep **one** (`onInbound`) for the MVP and fold fatal-error/health into the adapter's own return values and a single `onStatus` optional hook — there is no second gateway instance to coordinate, no session store on the adapter side, no busy-mode UX.

**The outbound result** is our `SendResult`: `{ ok, messageId?, error?, retryable? }` — `retryable:true` lets the hub do one bounded resend (the reference harness's `_send_with_retry`), not the elaborate base auto-retry.

**Transport injection (testability + determinism).** The adapter takes a `transport` object: `{ getUpdates({offset,timeout,signal}), sendMessage({chatId,text}), editMessageText(...), answerCallbackQuery(...) }`. The **real** transport (`sidecar/channels/telegram.transport.js`) is a thin `fetch` wrapper over `https://api.telegram.org/bot<token>/<method>` and is the **only** part that touches the network — `index.js` constructs it (ambient-I/O stays at the edge); tests inject a **fake transport** that yields scripted updates and records sends. This mirrors how `loop.js` injects `provider`/`emit` and the replay tests inject a fake provider.

**A second adapter (Discord) later** drops in with the *same* contract: `sidecar/channels/discord.js` exports `makeDiscordAdapter({transport,...})`, `MAX_MESSAGE_LENGTH=2000`, a gateway-websocket or REST-poll transport, and the same `onInbound`/`send` shape. The hub, the history store, and the bridge are **platform-agnostic** — they consume `InboundMessage` and call `adapter.send`, exactly as the reference harness's gateway consumes `MessageEvent`/`SendResult` for ntfy/IRC/Discord identically. **No registry, no `PlatformEntry`, no `Platform` enum, no `register(ctx)`** — with one or two bundled adapters we instantiate directly (dossier `drop`: "with exactly one adapter, skip the registry"). The selection is a one-line `const adapter = makeTelegramAdapter(...)` (later a `{ telegram: makeTelegramAdapter, discord: makeDiscordAdapter }[name]` lookup) in `index.js`.

### 3.2 The INGRESS → RUN bridge (decision + justification)

**Decision: call the in-process run host directly — NOT a `/api/run` HTTP loopback.**

Justification:
- `handleRun` is reachable in-process; the loop is fully injected/pure (`loop.js:99`) and `index.js` already constructs every dependency (registry, tools, station, broker, provider, cost). A loopback POST would (a) re-serialize the body, (b) lose the in-process `emit` sink (forcing NDJSON re-parsing the adapter would only re-concatenate), (c) need a second port/auth story, and (d) duplicate the abort wiring. the reference harness itself calls the runner **in-process** (`adapter.handle_message → _message_handler` is a direct `await`, `base.py:4184`), not over HTTP — the loopback would be a Node-ism with no the reference harness analogue and net negative.
- The **smallest honest** refactor: extract the *core* of `handleRun` (everything from "tools registered fresh" through `runAgentLoop`, `index.js:185-281`) into a reusable `runOnce({ key, model, system, messages, agentId, isTask, emit, signal })` that both the HTTP route **and** the hub call. The HTTP route keeps its NDJSON `emit` sink (`index.js:156`); the hub passes an **in-process `emit`** that feeds the reply-assembler (3.3) and is still validated by `makeEmitter` (so messaging runs get the same frozen-event guarantees). This is the one structural change; it is byte-identical for the existing browser path (the route's behavior is unchanged — it now calls the shared `runOnce`).

**What the bridge must supply to `runOnce` / the existing `handleRun` body** (the exact fields `index.js:138` destructures):
- `key` — the OpenRouter key, from the **boot-frozen config** (3.5), not localStorage.
- `model` — per-chat model from the chat→agent record, falling back to a boot-frozen default model.
- `system` — the agent's system prompt. The hub supplies it (the browser builds persona+task-classification client-side in `chat.js`; the hub must do the equivalent). MVP: a fixed persona string from config, optionally per-agent.
- `messages` — the durable per-chat transcript (3.4) with the new user turn appended. **The hub owns this; the sidecar is stateless.**
- `agentId` — the deterministic chat→agentId mapping (3.4), validated against `/^[A-Za-z0-9_-]{1,40}$/`.
- `isTask` — the hub's task-vs-talk decision (mirror `chat.js`'s `Classify.isTaskDirective`, ported as a pure helper or a simple heuristic for MVP). Tools only run when `isTask=true`; the `supportsTools` pre-check (`index.js:221`) still applies.

The bridge reuses `runOnce`'s existing station/tools/broker/provider/cost assembly **verbatim** — the messaging run is "just another caller of `handleRun`," exactly as the dossier's gen-seam claim states.

### 3.3 The RUN → REPLY path

**Which event carries the reply:** `agent.token` only (the dossier `reply_event`: "there is NO dedicated assistant-message event"). The hub registers an in-process `emit` that:
- on `agent.run.start` → capture `runId` (needed for cancel/consent), record it on the chat's run-lock.
- on `agent.token` → `buf[runId] += payload.delta`.
- on `agent.run.error` → set `errMsg = payload.message` (surface instead of text).
- on `capdenied` → set `errMsg = 'no ' + need + ' — ' + reason` (mirror `harness.js:103`).
- on `agent.run.end` → the turn is over; deliver `errMsg || buf[runId]`, render `reason` if not `'done'` (e.g. `max_iters` → append "(reached step limit — reply *continue* to keep going)", mirroring the browser's `chat.js:163-168`), persist the assistant turn, release the run-lock.

This is the **exact** reassembly `harness.js:75-114` performs, moved server-side into the hub — no NDJSON parsing needed because the emit is in-process.

**Chunking (Telegram 4096-char limit).** The hub splits the final reply into `≤ adapter.MAX_MESSAGE_LENGTH` chunks and calls `adapter.send` per chunk in order. Split on the last newline/space before the limit (never mid-codepoint; JS strings are UTF-16 so the count matches Telegram's UTF-16 limit — dossier `drop`: "JS strings are already UTF-16," so no `utf16_len` port). On `send` failure with `retryable:true`, one bounded resend; on hard failure, stop and log (the user already has earlier chunks). **Drop** the reference harness's `_edit_overflow_split` threaded-continuation + all-or-not-complete partial-overflow contract — that is streaming-edit machinery we are not building for the MVP.

**Stream-edit vs send-on-complete:** **send-on-complete for the MVP.** Justification: editing one live message (the reference harness's throttled `GatewayStreamConsumer → edit_message`) requires per-delta rate-limited `editMessageText` calls, an `edit_interval` throttle, and overflow-split handling — a large surface for marginal UX on a single-user harness. Send-on-complete is one `sendMessage` (chunked), trivially correct, and matches the fact that our reply is already fully buffered at `agent.run.end`. **Optional progress** (deferred): surface `agent.tool_call`/`agent.tool_result` as a lightweight "🔧 web_search…" status edit on a single placeholder message, so a long task isn't silent — this is the natural stream-edit upgrade and is recorded as an extension point, not built now.

### 3.4 Per-chat IDENTITY + DURABLE HISTORY

**chatId → agentId.** A deterministic, sanitized map. Telegram numeric `chat_id` is already `/^[A-Za-z0-9_-]{1,40}$/`-safe; we use `agentId = 'tg_' + chatId` (prefix namespaces it away from the browser's literal `'agent'`, preventing notebook/workspace/allowlist collisions). **One agent per chat** is the MVP default — each chat gets its own notebook, fs jail (`WORKSPACES/tg_<chatId>/`), permission allowlist scope, and persona. The chat→agent record (model, system/persona override, displayName) lives in a save-safe store so the mapping is stable and inspectable; a username, if ever used as an id, is sanitized (`replace(/[^A-Za-z0-9_-]/g,'_').slice(0,40)`).

**Durable history** (the sidecar is stateless; the adapter owns memory — dossier: "the Telegram adapter MUST implement its own per-chat durable history store"):
- **Module:** `sidecar/channels/store.js` — `makeChannelStore({ fs, root, clock })` exposing `loadHistory(agentId) -> messages[]`, `appendTurn(agentId, role, content)`, `loadChatMap()/saveChatRecord(chatId, rec)`. Same atomic temp+rename + tolerate-missing/corrupt-→-empty discipline as `notebookStore` (`index.js:57-68`).
- **Where it lives:** **siblings of the notebook store**, under `WORKSPACES/channels/`:
  - `WORKSPACES/channels/<agentId>.history.json` — `{ version:1, messages:[{role,content,ts}] }`. Stored **outside** the agent's fs jail (`WORKSPACES/<agentId>/`) so the agent's own `fs.*` tools can neither read nor corrupt its conversation history (the same containment property the notebook already has).
  - `WORKSPACES/channels/chatmap.json` — `{ version:1, chats:{ "<chatId>": { agentId, model, persona, displayName, lastSeen } } }`.
- **Save-safe shape:** versioned; on load, a missing file → `[]`/`{}`, a corrupt file → `[]`/`{}` (fail-closed, never throw). On `appendTurn`, trim to a bounded tail (e.g. last N turns / M chars) so the file and the replayed `messages` stay within budget — the sidecar's `context.js` compaction is unwired, so the hub does a simple head-drop (keep newest, never split a tool_call/tool_result pair — but the messaging path is chat-shaped, so for MVP turns are plain user/assistant strings, no tool pairs to protect in the *stored* history).
- **Replay:** on each inbound, `loadHistory(agentId)` → append the new `{role:'user'}` turn → pass as `messages`. On `agent.run.end`, `appendTurn(agentId,'user',text)` + `appendTurn(agentId,'assistant',reply)`.

### 3.5 SECRETS + CONFIG (frozen at boot, never crossing the redacting bus)

Three secrets, all **frozen at boot in `index.js`** (the only ambient-I/O module), mirroring `FULL_ACCESS`/`SKYNET_FULL_ACCESS` (`index.js:73`) and the keychain pattern:

| Secret | Source | Residence |
|---|---|---|
| Telegram **bot token** | `process.env.SKYNET_TELEGRAM_TOKEN` (frozen `const` at boot) | Passed only into the **transport** constructor in `index.js`; embedded in the Bot API URL path. **Never** placed on a U.bus event; never passed to the loop/provider. |
| OpenRouter **key** | `process.env.SKYNET_OPENROUTER_KEY` (frozen at boot) **or** a boot-loaded config file `WORKSPACES/channels/config.json` | Threaded into `runOnce`'s provider+web-tools exactly as the browser's `key` is (`index.js:187,216`). One global key for all chats in the MVP (per-chat BYOK via a `/setkey` command is a deferred decision, §10). |
| Per-chat **model** | `chatmap.json` record, falling back to `process.env.SKYNET_DEFAULT_MODEL` (frozen at boot) | Supplied as `model` to `runOnce`. |

**Bus safety:** the bot token and OpenRouter key never appear in any emitted event. `redact()` already scrubs key-shaped strings on every NDJSON line (`index.js:156`), but the messaging emit is in-process and the secrets are simply never put on payloads — defense in depth, not reliance on redaction. The token is **not** a frozen-bus value; it is host config, like the keychain (dossier: "where does the Telegram BOT token live (env, not the frozen bus)").

If neither the token nor a default model is configured at boot, the channel subsystem **stays off** (no `adapter.connect()`), and the existing browser path is entirely unaffected — the messaging feature is opt-in via env.

### 3.6 The CONSENT-SURFACE problem (load-bearing)

A headless messaging chat has **no browser** to answer `permission.prompt`. The reachable `requiresConsent` tools are `fs.write/append/edit` + `notebook.write` (dossier; `REF_HARNESS_INTEGRATION_PLAN.md:82`). The broker (`permissions.js`) gives three honest options, and the *confirmed* + *corrected* verdicts pin down exactly how each behaves:

- **(a) Autonomous default-deny on mutation** — build the run with `surface:'autonomous'` (no `prompt`). An ungranted mutation returns `{allow:false, reason:SILENCE}` synchronously (`permissions.js:92`) — the write fails cleanly, the run continues, no 120s stall. Reads/non-network auto-allow. Pre-seed `grantsPermanent` (the existing `permissions.allow.json`) with `fs.write`/`notebook.write` danger keys for chats the user trusts, so blessed writes pass with no human. **This is the safe floor and the MVP default.**
- **(b) Telegram inline-keyboard consent round-trip** — build with `surface:'interactive'` + a messaging-specific `prompt(call,tool)` that: emits `permission.prompt` (telemetry), sends a Telegram message with an inline keyboard (Approve / Always / Full / Deny), and returns a Promise. The user's button tap arrives as a `callback_query` on `getUpdates`; the adapter routes it to the **existing** `POST /api/consent {runId,promptId,decision}` answer path (or, in-process, directly calls the stored `pending` finisher in `pendingByRun`, `index.js:99,296-305`). The 120s `CONSENT_TIMEOUT_MS` window (`index.js:32,178`) still bounds it → silence auto-denies, fail-closed. This mirrors `promptConsent` **exactly** (`index.js:159-181`) — the adapter owns the *display* and the *button → decision* hop, the sidecar owns the *pause/resolve*.

**Decision: ship (a) as the MVP, design for (b) as a bounded follow-on.** Justification: (a) is zero new pause/resolve machinery, never stalls, and the broker's `surface:'autonomous'` branch is already the correct, *confirmed* fail-closed posture (`index.js:210` comment: "Scheduled/autonomous runs … would pass `surface:'autonomous'` to fail closed"). (b) is strictly additive — the broker, the `permission.prompt` rung, the `pendingByRun` map, and `handleConsent` already exist; (b) only adds the Telegram-side keyboard render + `callback_query` parse. Critically, the *corrected* verdict warns: under a **literally** autonomous surface the broker returns at `permissions.js:92` *before* the prompt branch — so (b) requires `surface:'interactive'`, not `'autonomous'` + a channel. The hub passes `surface` per-chat (autonomous by default; interactive only if the chat opted into button-consent), and **always** keeps the hardline floor below both (`hardlineFloor`, `index.js:102-107`).

This is the messaging analogue of `REF_HARNESS_INTEGRATION_PLAN.md`'s L1 consent care: same broker, same "silence is not consent," same frozen-bypass floor — re-derived for a surface with no browser.

### 3.7 NEW EVENT RUNGS in `shared/events.js` (BEFORE any producer)

A messaging inbound and its delivery are genuinely new cross-boundary signals; `emitter.js` drops any unregistered name and `lint-emits.js` flags the literal `emit`. We add **three** rungs *first* (additive, no re-freeze of the reply path):

```
'channel.inbound':  obj(['channel','chatId','agentId'],
                        { channel:str, chatId:str, agentId:str, userId:str, kind:{enum:['dm','group']} })
'channel.delivery': obj(['channel','chatId','runId','ok'],
                        { channel:str, chatId:str, runId:str, ok:bool, chunks:int, reason:str })
'channel.connect':  obj(['channel','state'],
                        { channel:str, state:{enum:['up','down','error']}, detail:str })
```

- `channel.inbound` — emitted by the hub when a message is admitted and mapped to an agent (the trigger-source telemetry that `agent.run.start.trigger` only *labels*). Drives the station HUD "incoming DM" cue.
- `channel.delivery` — emitted after the reply is sent (chunk count, ok/why) so the HUD/log shows outbound delivery and failures.
- `channel.connect` — adapter health (poll up / network down / fatal token error), the in-memory health-state analogue of the reference harness's runtime status file (dossier `drop`: "replace with in-memory health state").

Each rung lands with **valid + invalid `contract.test.js` fixtures** in the same commit, *before* its first producer — the discipline `REF_HARNESS_INTEGRATION_PLAN.md:284` mandates. The reply itself needs **no** new rung (`agent.token` already carries it). `redact()` runs on every payload; `chatId`/`userId` are not secrets but are run through it for free.

### 3.8 CONCURRENCY / SAFETY

- **One run per chat at a time.** The hub keeps `Map<agentId, { runId, abort }>`. A new inbound while a run is in flight **aborts the old run** (`abort()` → the loop's `signal.aborted` guard returns `cancelled`, `loop.js:129`) and starts fresh with the latest message — the natural "user sent a follow-up" semantics. (Alternative: queue/reject; abort-on-new is the MVP choice, matching how a person expects a chat to behave. §10.) The browser implicitly serializes via a `busy` flag (`chat.js`); the hub makes that explicit per chat.
- **Existing caps still bind.** `maxIters:16`, `maxCostUsd:1.00`, `maxRepeat:3`, `maxToolBytes` (`index.js:31`) apply unchanged — the messaging run goes through the same `runOnce`. No new budget surface.
- **No long-lived connection-close signal.** A browser tab close aborts via `req.on('close')` (`index.js:152`); a poll-based adapter has none. The hub's run-lock + abort-on-new-message + the loop's own caps are the kill paths. A Telegram `/cancel` command maps to `abort()` on the chat's current `runId` (the in-process analogue of `POST /api/cancel`).
- **Poller resilience (re-derived minimal).** The transport's `getUpdates` uses long-poll (`timeout:50`), tracks `offset = last update_id + 1` (so each update is processed once, `drop_pending_updates` equivalent: start from the latest offset on boot), and wraps the loop in a bounded exponential backoff (e.g. 1→2→5→15s, cap 30s) on network error, emitting `channel.connect{state:'down'|'up'}`. **Drop** the per-token process lock, the 409-conflict ladder, `TelegramFallbackTransport`/DoH IPs, the get_me heartbeat probe (dossier `drop`: "a single-instance MVP needs only basic retry"). A 401/invalid-token is fatal → `channel.connect{state:'error'}`, stop polling, leave the browser path running.
- **Rate limits.** Reuse the existing module-level search throttle pattern (`throttleSearch`, `index.js:333-345`) shape for outbound `sendMessage` if needed; Telegram's per-chat send limit is generous for single-user, so MVP sends directly and only backs off on an explicit `429 retry_after`.
- **Determinism.** The adapter/hub/store take an injected `clock`; no bare `Date.now()`/`Math.random()` inside the modules (those live only in `index.js`, the lint-excluded edge). The `crypto.randomUUID` for any internal id stays in `index.js`, not the pure modules.

---

## 4. Drop section — the reference harness/Python accretion left in the mine

Mined for shape, **not** ported:

- **The `PlatformRegistry` + `PlatformEntry` dataclass + `Platform` enum `_missing_` minting + `register(ctx)` + plugin-dir discovery** (`platform_registry.py`, `config.py:136-199`, `ADDING_A_PLATFORM.md`). These exist so ~20 self-registering plugins coexist and override built-ins. With one (later two) bundled adapter we instantiate directly — no manifest scan, no `is_registered` fork, no last-writer-wins table. (Dossier: "skip the registry and the PlatformEntry dataclass; pass capability/config values directly to the adapter constructor.")
- **The 16-step built-in checklist** (`toolsets.py`, `PLATFORM_HINTS`, cron platform_map, `status.py`, setup wizard, `redact.py` per-platform entries, `channel_directory`). Our equivalent is "instantiate adapter + inject `onInbound` + `connect`."
- **`python-telegram-bot` Application/Updater/builder/handler lifecycle** (`telegram.py:1834-2126`). Replaced by a plain `fetch` long-poll loop. No PTB, no SDK.
- **`TelegramFallbackTransport` + DoH IP discovery + seed IPs + SNI preservation** (`telegram_network.py`). Pure censored-network resilience; the MVP hits `api.telegram.org` directly.
- **Webhook mode + `TELEGRAM_WEBHOOK_SECRET` crypto + `start_webhook` listen server** (`telegram.py:1994-2024`). Long-poll is the *confirmed* default and needs no inbound HTTP listener, no public URL, no secret-token forgery guard. (Webhook is a deferred decision, §10.)
- **MarkdownV2 escaping / `_strip_mdv2` / `(i/N)` suffix escaping / rich-message fast path / native draft streaming** (`telegram.py:2188,2553`; dossier `drop`). MVP sends **plain text**.
- **Stream-edit-one-message + `_edit_overflow_split` threaded continuations + all-or-not-complete partial-overflow `SendResult`** (`stream_consumer.py`, `telegram.py:2656,2823`). MVP is send-on-complete + simple chunking.
- **Forum/DM topics, `message_thread_id` routing, `_setup_dm_topics`, `allowed_topics`, `ignored_threads`** (`telegram.py`). Plain chats only.
- **Text-batch debounce/aggregation of client-side splits + media-group album buffering** (`_enqueue_text_event`/`_flush_text_batch`). Process each update directly.
- **The per-token process lock + 409-conflict reconnect ladder + get_me heartbeat probe** (`telegram.py:1410,1284,1365`). Single instance → basic backoff only.
- **The media-delivery path-validation security subsystem** (`base.py:1028-1103`, strict/recency/denylist modes, symlink resolution) and **sticker/voice/video/document/image** send + `extract_media`/`extract_images`. MVP is **text in, text out**. (Our fs tools already write deliverables to the workspace; the user opens them via `/api/file`.)
- **The callback-query interactive surface beyond consent** (model picker, clarify, gmail triage, exec-approval buttons). We use exactly one keyboard pattern — the consent round-trip (§3.6b), deferred.
- **Pairing-store DM admission** (salted SHA-256 codes, lockout, rate limits; `pairing.py`). The MVP uses a simple `allowedChats` allowlist + the boot-frozen token as the trust boundary (only people the bot owner DMs/whitelists). Code-pairing is a deferred decision, §10.
- **`contextvars` session-identity plumbing + `os.environ` dual-write** (`session_context.py`) and the **794KB `run.py` god-file + mixin decomposition**. Re-derived as the small `hub.js` + `store.js`; identity is a plain per-request context object.
- **`build_session_key` deterministic `agent:main:{platform}:{chat_type}:{chat_id}` + `SessionStore` SQLite transcript** (`session.py:617,889`). Our analogue is the flat `agentId = 'tg_'+chatId` + the JSON history file — the same "chat → stable id → replayed history" *shape*, no SQLite (roadmap 2.1, unbuilt).

---

## 5. The first six commits (dependency-ordered, smallest-first, each independently shippable + test-gated)

Each is one revertable commit, ≤3 files, gating test written first, fast suite green (`<~10s`) before the next. The pattern matches `REF_HARNESS_INTEGRATION_PLAN.md §4`: start with a **pure, no-wiring** adapter-contract + fake-transport test, then the real transport, then the bridge, then identity/history, then consent.

**Commit 1 — `channels/adapter.js` pure contract + a generic adapter built on an injected transport (no network, no wiring).**
- *Goal:* the platform-agnostic adapter shape — `connect`/`disconnect`/`send`/`chatInfo`/`name`/`MAX_MESSAGE_LENGTH` + the `onInbound(InboundMessage)` push bridge — driven entirely by an injected `transport`, so a **fake transport** proves the inbound→normalize→`onInbound` and `send` paths with zero I/O.
- *Port/create:* `sidecar/channels/adapter.js` (a `makeChannelAdapter` factory that owns the poll loop + offset tracking + normalize + admission gate, parameterized by transport-method names so Telegram/Discord reuse it), `test/channels.adapter.test.js`, `package.json`.
- *Tests:* fake transport yields scripted `getUpdates` batches → adapter calls `onInbound` once per text update with a correctly normalized `InboundMessage` (chatId/chatType/userId/text/messageId/ts-from-injected-clock); a group update **not** in `allowedChats` is dropped while a DM passes (mirrors the reference harness `_should_process_message` — DMs always allowed); `send('c',longText)` is **not** chunked here (chunking is the hub) but returns the transport's `{ok,messageId}`; `disconnect()` stops the loop and no further `onInbound` fires; offset advances so a redelivered update is processed once.
- *DoD:* pure (injected transport + clock, no `fetch`/`fs`/clock-reads), `lint-determinism` green, headless, deterministic; nothing wired; one commit, ≤3 files; revertable.

**Commit 2 — Telegram concrete adapter + real `fetch` transport (still no run wiring).**
- *Goal:* a `makeTelegramAdapter` that configures the generic adapter with Telegram's method names + `MAX_MESSAGE_LENGTH=4096`, plus the real Bot API `fetch` transport — the only network-touching piece.
- *Port/create:* `sidecar/channels/telegram.js` (thin config over `makeChannelAdapter`), `sidecar/channels/telegram.transport.js` (`getUpdates`/`sendMessage` over `https://api.telegram.org/bot<token>/<method>`, long-poll `timeout`, abort via injected `signal`), `test/channels.telegram.test.js`.
- *Tests:* with an **injected fake `fetch`**, the transport builds the correct URL + JSON body for `sendMessage`, parses a real-shaped `getUpdates` response into normalized updates, advances `offset = max(update_id)+1`, and surfaces a `401` as a fatal `{ok:false}` (token error) vs a network throw as `retryable`. No real network in the test.
- *DoD:* transport's only ambient I/O is the injected `fetch` (so the test injects a fake; `index.js` will inject `globalThis.fetch`); adapter still pure; one commit, ≤3 files; revertable.

**Commit 3 — `channel.*` event rungs (schema first, no producer).**
- *Goal:* freeze `channel.inbound` / `channel.delivery` / `channel.connect` in `shared/events.js` **before** any emit, so producers in later commits are lint-clean.
- *Port/create:* `shared/events.js` (three additive entries, §3.7), `test/contract.test.js` (valid + invalid fixture per rung).
- *Tests:* each new event validates a good payload and rejects a bad one (missing required / bad enum); `lint-emits.js` stays green; existing frozen events untouched (no re-freeze).
- *DoD:* additive only; fast suite green; one commit, ≤2 files; revertable.

**Commit 4 — `runOnce` extraction + `channels/store.js` durable history/chatmap (no adapter wiring yet).**
- *Goal:* the two substrate pieces the bridge needs — (a) factor the run core out of `handleRun` into a reusable `runOnce({key,model,system,messages,agentId,isTask,emit,signal})` that the existing HTTP route now calls (byte-identical for the browser), and (b) the save-safe per-chat history + chatmap store.
- *Port/create:* `sidecar/index.js` (extract `runOnce`; the `/api/run` route becomes a thin caller with its NDJSON emit), `sidecar/channels/store.js` (`makeChannelStore({fs,root,clock})` → `loadHistory`/`appendTurn`/`loadChatMap`/`saveChatRecord`, atomic temp+rename, versioned, tolerate-corrupt), `test/channels.store.test.js`.
- *Tests:* the **existing** `harness.integration.test.js` still passes unchanged (proves `runOnce` extraction is behavior-preserving for the browser path); `store` round-trips a history append, returns `[]` on missing/corrupt, trims to the bounded tail, and keeps history **outside** the agent's fs jail; chatmap saves/loads a record by chatId.
- *DoD:* browser path byte-identical (the regression lock is the existing integration test); store pure-ish (injected `fs`+`clock`); `index.js` stays the only ambient-IO module; one commit, ≤3 files; revertable.

**Commit 5 — `channels/hub.js` bridge: inbound → `runOnce` → reply (autonomous consent, the MVP path).**
- *Goal:* the seam — wire `onInbound` to: map chatId→agentId, load+append history, build `{key,model,system,messages,agentId,isTask}` from boot-frozen config, call `runOnce` with an **in-process reply-assembling emit** (`surface:'autonomous'`), buffer `agent.token` by `runId`, deliver `errMsg||reply` chunked via `adapter.send` on `agent.run.end`, persist both turns, enforce one-run-per-chat with abort-on-new-message. Emit `channel.inbound`/`channel.delivery`. `index.js` instantiates the Telegram adapter+transport+hub **only when** `SKYNET_TELEGRAM_TOKEN` is set, leaving the browser path untouched otherwise.
- *Port/create:* `sidecar/channels/hub.js` (the bridge + reply-assembler + run-lock, all deps injected: `adapter`, `runOnce`, `store`, `config`, `clock`), `sidecar/index.js` (boot-frozen secrets §3.5; instantiate transport→adapter→hub→`connect()` behind the env gate), `test/channels.hub.test.js`.
- *Tests:* a fake adapter delivers an `InboundMessage`; the hub calls an **injected fake `runOnce`** that emits `agent.run.start`/`agent.token`×3/`agent.run.end{done}` → the hub `send`s the concatenated reply (chunked to ≤4096), persists user+assistant turns, emits `channel.inbound` + `channel.delivery{ok:true}`; an `agent.run.error` path sends `payload.message` instead; a second inbound mid-run aborts the first (the first run's `signal.aborted` is observed) and serves the latest; a reply >4096 splits into ordered chunks; an ungranted-mutation run under `surface:'autonomous'` completes (write silently denied, run recovers, reply still delivered).
- *DoD:* hub pure (no I/O — adapter/runOnce/store/clock injected); messaging run obeys `maxIters`/`maxCostUsd`; secrets never on any emitted payload; browser path unaffected when the env gate is off; one commit, ≤3 files; revertable.

**Commit 6 — Interactive consent over Telegram inline keyboard (optional, additive).**
- *Goal:* the §3.6(b) round-trip — for chats opted into `surface:'interactive'`, the hub's injected `prompt(call,tool)` renders an Approve/Always/Full/Deny inline keyboard via `adapter.send` (with `reply_markup`), and a `callback_query` from `getUpdates` resolves the stored `pending` finisher (the **existing** `pendingByRun`/`handleConsent` path, `index.js:99,296-305`), within the 120s `CONSENT_TIMEOUT_MS` window → silence auto-denies.
- *Port/create:* `sidecar/channels/telegram.js` (parse `callback_query` updates → `{promptId,decision}`; `reply_markup` on send), `sidecar/channels/hub.js` (the interactive `prompt` + route the decision to the broker via the existing finisher), `test/channels.consent.test.js`.
- *Tests:* an interactive run hits an ungranted `fs.write` → the hub emits `permission.prompt` + the adapter `send`s a keyboard; a fake `callback_query{decision:'always'}` resolves the pause → the broker grants + persists, the write proceeds, the run completes; **no** answer within the window → auto-deny, the write is denied, the run still finishes (pairing held); a `'deny'` tap → denied isError result, run recovers.
- *DoD:* reuses the existing broker + `pendingByRun` + timeout (no parallel pause/resolve machinery); `surface:'interactive'` only for opted-in chats, autonomous floor otherwise; hardline floor below both; one commit, ≤3 files; revertable.

> Commits 1–3 are pure substrate (contract, transport, schema) — independently shippable, zero behavior change. Commit 4 is the behavior-preserving `runOnce` extraction + the store. Commit 5 is the live messaging MVP (autonomous consent). Commit 6 is the optional interactive-consent upgrade. Nothing touches `loop.js`'s while-loop, `cost.js`, the capability projection, the reply contract (`agent.token`), or the frozen events beyond the three additive `channel.*` rungs.

---

## 6. Open design decisions that need the user's call

1. **Consent surface default.** Ship autonomous default-deny (§3.6a, MVP) and treat interactive Telegram-keyboard consent (§3.6b, Commit 6) as opt-in per chat? Or make interactive the default for DMs (the bot owner is "the Commander watching")? Autonomous is the safe floor; interactive preserves the browser-parity UX at the cost of a 120s timeout risk.

2. **Identity → agentId granularity.** One agent **per chat** (`tg_<chatId>`, MVP — isolated notebook/workspace/persona per conversation) vs one per **user** (shared memory across that user's chats) vs a single shared `telegram` agent (all chats share memory/workspace — simplest, collision-prone). Per-chat is the proposed default.

3. **Bot token + key + model residence.** Confirm: bot token in `SKYNET_TELEGRAM_TOKEN` (env, boot-frozen); **one** global OpenRouter key (`SKYNET_OPENROUTER_KEY`) for all chats vs **per-user BYOK** via a `/setkey` command (adds a per-chat secret store, more surface). Per-chat model: default `SKYNET_DEFAULT_MODEL`, overridable via a `/model` command? (the reference harness has a model-picker; we'd add a tiny one.)

4. **Abort-on-new-message vs queue.** A new inbound while a run is streaming: **abort + restart with the latest** (MVP, natural chat feel) vs **queue** (answer each message in order) vs **reject** ("still working…"). Abort-on-new is proposed.

5. **Task-vs-talk classification.** Port `chat.js`'s `Classify.isTaskDirective` as a pure helper so the hub sets `isTask` (tools only run when true), or start with a simple heuristic (everything is a chat unless the message starts with a verb/`/task`)? Affects whether DMs can trigger web/file tools at all.

6. **Transport mode.** Long-poll `getUpdates` (MVP, no public URL, *confirmed* the reference harness default) — confirm we never need webhook (cloud auto-wake, requires a public HTTPS endpoint + secret-token, and conflicts with "the sidecar binds `127.0.0.1`," `index.js:124`). Webhook is dropped unless there's a hosting requirement.

7. **Reply delivery UX.** Send-on-complete (MVP) vs a single live-edited progress message (stream-edit, §3.3) vs tool-step status messages. Send-on-complete is proposed; live-edit is the recorded extension point.

8. **Group admission policy.** DMs always allowed (the reference harness parity); groups gated by an `allowedChats` allowlist (env `SKYNET_TELEGRAM_ALLOWED_CHATS`). Confirm groups are even in scope for the MVP, or DM-only first? DM-only is the smaller, safer first cut.

9. **History trim policy.** Bounded tail by turn count vs char budget; and whether to ever wire the unused `context.js` `compact()` into the messaging path (it's built-but-unwired, `context.js`) instead of a naive head-drop. Naive head-drop is proposed for the MVP.

10. **Pairing/trust.** Is the boot-frozen token + an `allowedChats` allowlist sufficient (anyone who can DM the bot and is whitelisted), or do we want code-pairing for unknown DMs (the reference harness `pairing.py` shape, descoped from the mine)? Allowlist-only is proposed.
