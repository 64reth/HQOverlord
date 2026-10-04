# Telegram Channel — ref-Level Polish Backlog

> Companion to `MESSAGING_INTEGRATION_PLAN.md`. Produced by a parallel ref-vs-ours audit (60 agents, 53 candidate improvements verified against our real code, 2026-06-14). Every item below is **purely additive to our channel code** — **none requires a `shared/events.js`/`schema.js` change** (the existing `channel.inbound`/`channel.delivery`/`channel.connect` + frozen `permission.prompt`/`permission.response` rungs cover all of it), so **no cortex-memory contract request is needed**. Discipline unchanged: one-commit-sized, gating-test-first, fast suite green before merge.

## 1. Where we stand vs the reference harness

Our channel is a clean two-layer pipeline (fetch transport → transport-agnostic adapter → hub → runOnce) that already does the hard correctness things — offset-based dedup with no app-level seen-set, capped exponential reconnect backoff with fatal-vs-transient classification, single-flight polling with clean AbortController shutdown, `allowed_updates` narrowing, race-free one-run-per-chat supersede, durable per-chat transcripts outside the fs jail, atomic secret-at-rest, word/line-boundary chunking to 4096, and live agent-identity sync so a DM runs the **same** agent. The honest gap is **not** transport robustness — it's a few correctness/safety holes the reference harness closes by design (unconditional DM admission, offline-backlog replay on restart, a couple of dead-but-extracted fields), plus UX parity (typing indicator, control commands, bot-identity validation, formatted replies). the reference harness's heaviest machinery (live edit-streaming, MarkdownV2 table rewriting, pairing codes, DoH/proxy, pool draining, multi-tenant authz) is correctly **out of scope** for a single-user owner-only local harness.

## 2. Prioritized improvements

| Priority | Improvement | Why it matters | Files | Contract |
|---|---|---|---|---|
| **P0** | Owner-only DM admission (first-DM trust-on-first-use; default-deny others) | Today every DM is admitted (`adapter.js:73-76`) — a discoverable bot lets a stranger spend the OpenRouter key + read agent memory | `adapter.js`, `index.js`, (opt) `stationui.js` | additive (ownerId in `channelSecrets.telegram`) |
| **P0** | Drop-pending backlog on connect (`getUpdates({offset:-1})` confirm-and-discard) | Offset defaults to 0 (`adapter.js:79`) → reboot replays ~24h of buffered DMs and autonomously runs stale tasks | `adapter.js` | additive (connect path) |
| **P0** | 409-Conflict → fatal stop + proactive `deleteWebhook` before first poll | A 409 (two pollers / stale webhook on a reused token) is treated transient → backoff-loops forever showing "down", never receives a message | `telegram.transport.js`, `adapter.js` | additive (reuses `onStatus state:'error'`) |
| **P0** | Honor 429 `retry_after` before the one-shot resend | `retryAfter` is extracted (`telegram.transport.js:71`) but never read (`adapter.js:158`) — resend fires instantly into the open flood window and the chunk drops | `adapter.js` | additive (field already on SendResult) |
| **P1** | getMe eager token validation at connect (+ `@handle` in status) | `/connect` returns `connected:true` before any network call (`index.js`) — a bad token only dies seconds later on first poll | `telegram.transport.js`, `index.js`, `stationui.js` | additive (new transport method + status field) |
| **P1** | Typing indicator (`sendChatAction('typing')`) during runs | Runs take many seconds; the hub buffers and sends once at the end → pure silence | `telegram.transport.js`, `telegram.js`, `hub.js` | additive (needs injected timer for deterministic tests) |
| **P1** | `/stop` + `/new`(`/reset`,`/clear`) command interceptor | Owner has no Telegram-side way to abort without restarting, or wipe a stale transcript — control-plane actions an LLM turn can't do | `hub.js`, `store.js` (new `clearHistory`) | additive (reuses inflight Map) |
| **P1** | Static `/help` + one-time `setMyCommands` | `/help` today burns a model call; the blue "/" menu is empty | `hub.js`, `telegram.transport.js`, `index.js` | additive |
| **P1** | MarkdownV2 outbound formatting + per-chunk plain-text fallback | Replies go out plain (`hub.js:99`) → `**bold**`/`` `code` ``/`[links]` render literally | new `telegram.format.js`, `hub.js` | additive (transport already forwards `parse_mode`) |
| **P2** | Interactive consent inline keyboard (C6 / task #11) | `onCallback` is a noop (`hub.js:182`); ungranted writes silently default-deny — no phone approval | `hub.js`, `telegram.transport.js`, `index.js` | additive (existing `permission.*` rungs) |
| **P2** | `/model <slug>` text command | We switch models; validate against `provider.listModels()` + persist | `hub.js`, `index.js` | additive |
| **P2** | Client-side timeout on the SEND path only | A wedged sendMessage socket can stall `deliver()` forever | `telegram.transport.js` | additive |
| **P2** | Message reactions 👀→👍 (default-off flag) | "saw it / working / done" ack without chat spam | transport/adapter/hub/index | additive (`SKYNET_TELEGRAM_REACTIONS`) |
| **P2** | (i/N) multi-part indicator on chunked replies | A long split reply reads as parts, not truncated/duplicated | `hub.js` | additive |
| **P2** | `chmod 0600` on secrets.json | plaintext OR key + bot token; correct hygiene (no-op on Windows) | `index.js` | additive |
| **P2** | Surrogate-pair guard in `chunkText` hard-cut fallback | the no-whitespace hard cut can bisect an emoji/CJK char into a lone surrogate | `hub.js` | additive |
| **P2** | Wrap `dispatch()` body in try/catch | only `normalize()` is guarded (`adapter.js:88`); a throw from `admitted`/`onInbound` kills the detached loop | `adapter.js` | additive |
| **P2** | Strip `key`/`model` from `/sync` | `/sync` accepts a key patch the UI never sends; removing it keeps identity-sync strictly additive | `index.js` | additive/subtractive |

## 3. SKIP (left in the mine)

Live edit-streaming + edit throttle/`_edit_overflow_split` + draft streaming; MarkdownV2 table/spoiler/blockquote rewrite + separate HTML keyboard path; code-fence repair in the chunker (moot for plain text); DoH + fallback-IP transport + proxy auto-detection (censorship/scale); connection-pool drain / pool-size tuning / wedge heartbeat (httpx/PTB artifacts); full pid/argv/psutil single-instance lockfile (EADDRINUSE + 409-fatal cover the realistic double-launch); pairing codes / owner-admin tiers / per-scope slash allowlists / per-user rate-limit (multi-tenant — trust-on-first-use is the right-sized version); clarify inline keyboard (would need a **requested** new `shared/events.js` rung + a clarify tool/loop seam — free-text "which did you mean?" suffices); paginated model-picker keyboard; media in/out (photo/voice/document), edited-message reprocessing, group @mention gating; fsync-before-rename / RLock (already atomic; no Python-threads problem in single-threaded Node).

## STATUS — COMMAND PARITY SHIPPED (2026-07-25, both gates green, additive-only)

The P1 **`/stop` + `/new` interceptor** row above is now CLOSED, together with the wider gap it belonged to:
the desktop palette had 43 commands and a phone had 6, so the surface you reach for when you are *away from
the machine* — kill a runaway run, check what a routine spent — was the one that could not do it.

- **Control plane (only this hub can do it):** `/stop` aborts the run this chat has in flight (marks it
  superseded first, so the run's own teardown stays quiet), `/new` clears the transcript via the new
  `store.clearHistory` and REFUSES while a run is live, `/status` reports live state only (working/idle,
  bound agent, real stored turn count, approvals state) and never quotes a duration it cannot compute.
- **Shared registry (`slash:true` in the COMMANDS table):** `/usage /tools /routine /away` are executed by
  `runSlashForChannel` in `sidecar/index.js` — the SAME `slash.dispatch` + `slashActions.run` pair that
  `POST /api/slash/dispatch` uses, called in-process (no self-HTTP, no api token). So the answer on your
  phone is the answer the desktop prints, rather than a second implementation that drifts. `placed` is read
  from the routing plan's bay, so `/tools` answers for the room that agent actually occupies.
- Live-proven on `POST /api/dev/inbound` (a real `makeChannelHub`): `/tools`, `/routine` and `/away` replies
  are **byte-identical** to `/api/slash/dispatch`; `/usage` differs only by the agent id, which is the
  per-agent scoping working. `/routine add` from the channel minted a real cron job bound to the channel
  agent; `/new` cleared a real 3-turn transcript and left `{"version":1,"messages":[]}` on disk.
- **`/stop` LIVE-PROVEN 2026-07-25** at the provider socket: with a mock OpenRouter streaming one token
  per 500ms, a real channel run was opened (`/status` → "Working — 6s so far."), `/stop` replied "Stopped the
  run in progress.", and the mock recorded the upstream stream ABORTED after 11 tokens while `/status` went
  back to Idle. The abort reaches the model socket, not just the hub bookkeeping.
- **NOT wire-verified:** `setMyCommands` now publishes **12** entries (was 5). Telegram rejects that call
  *wholesale* if any single name/description is malformed. `test/channels.parity.test.js` enforces the
  documented grammar (`^[a-z0-9_]{1,32}$`, non-empty description ≤256) but only a real bot token proves the
  call. Re-run the logging-proxy walk before relying on the blue "/" menu.

## STATUS — C6 INLINE KEYBOARDS SHIPPED (2026-07-24, both gates green, additive-only)

The P2 "interactive consent inline keyboard" row above, **plus** the multiple-choice keyboard that §3 had left
in the mine, are now built. No `shared/events.js` change was needed after all — the §3 note that a clarify
keyboard "would need a new rung + a clarify tool/loop seam" turned out to be wrong on both counts: `brief.ask`
already IS the clarify tool, and a button tap re-enters through `processInbound` carrying the option's own text,
so it is literally the typed-answer path with no second code path and no new event.

- ✅ **New `channels/prompts.js`** — bounded (200, oldest-first) token→meaning registry + the `callback_data`
  codec (`q|c:<token>:<idx>`, ~13 bytes). The token indirection is what keeps a 4000-char option inside
  Telegram's 64-byte cap. Single-use pops; entries keyed by token, never resolved FIFO.
- ✅ **Multiple choice** — a `TASK_QUESTION` reply now ships an inline keyboard (full option text stays in the
  body, buttons carry a short numbered echo). A tap re-enters as the option's own text; a typed `2` coerces to
  the same canonical text (`coerceChoice`). A channel without button deps renders the old numbered list byte-identically.
- ✅ **Approve/deny** — **per-chat opt-in, default OFF** (`/approvals on|off`, persisted on the chat record).
  Opted-in chats run `surface:'interactive'` with a `prompt` closure; the HOST keeps the pause/resolve
  (`channelAskConsent`/`channelResolveConsent` over the real `consentwait.js`), the hub owns only the render and
  the button→decision hop. Deliberately a separate map from `pendingByRun` — the browser's card resolves by a
  runId it never has for a channel run, so sharing it would surface prompts the app cannot answer.
- ✅ **Command menu sync** — one `COMMANDS` table in `hub.js` now drives `parseCommand`, `/help`, AND
  `setMyCommands`, so Telegram's blue "/" menu can no longer drift from what the hub implements.
- ✅ **Transport** — `answerCallbackQuery` (mandatory: an unacked tap spins then errors client-side),
  `editMessageText` (stamp the decision, strip the spent keyboard), `setMyCommands`.

Two bugs found in the reference harness while mining it and deliberately NOT ported: its approval resolution
pops the session queue head, so with two concurrent prompts a tap on the second answers the first; and its four
callback-state dicts have no eviction, so an ignored keyboard leaks forever.

Tests: `test/channels.buttons.test.js` (registry/codec/coercion/menu + hub round-trips over the REAL
`consentwait.js`) and `test/channels.telegram.buttons.e2e.test.js` (the real sidecar process against a fake Bot
API: menu published, keyboard sent, tap → ack + edit + re-entry, double-tap starts nothing, non-owner tap
dropped, and an approved `fs.write` that actually lands on disk).

Still open from the table above: P1 MarkdownV2 formatting, P2 `/model` picker keyboard, reactions, `(i/N)`
indicator, outbound media.

## STATUS — all P0 SHIPPED (2026-06-14, suite green, additive-only)

- ✅ **P0-A** owner-only DM admission (trust-on-first-use) — `adapter.js` owner gate + `telegram.js`/`index.js` wiring + persisted `ownerId`; tests in `channels.adapter.test.js`.
- ✅ **P0-B** drop-pending backlog on connect — generic `adapter.connect()` opt-in (`dropPendingOnConnect`), ON by default in `telegram.js`; tests in `channels.adapter`/`channels.telegram`.
- ✅ **P0-C** 409→fatal (+ proactive `deleteWebhook` before first poll) — `telegram.transport.js` + `adapter.connect()`.
- ✅ **P0-D** honor 429 `retry_after` before the one-shot resend — `adapter.send()`.

P1 (getMe validation, typing indicator, `/stop`+`/new`+`/help`, MarkdownV2) and P2 remain. Deploy: restart the sidecar to load the P0 backend; the first DM after reconnect claims ownership.

## 4. Recommended first 3 commits

1. **`feat(channels): owner-only DM admission (first-DM trust-on-first-use)`** — P0-A. Close the open-key/open-memory door before anything else.
2. **`feat(channels): drop pending Telegram backlog on connect`** — P0-B. Stop stale-task replay on reboot.
3. **`fix(channels): 409 → fatal (+ deleteWebhook) and honor 429 retry_after`** — P0-C + P0-D bundled (both tiny, both in the transport/adapter error paths).

Each is one-commit-sized, gating-test-first, additive-only, suite green before merge.
