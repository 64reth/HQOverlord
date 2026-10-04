# StarNet → ref-parity Loop (H1 → H6)

> The durable brain for the self-paced ref-parity loop. Source: the 2026-06-23 adversarially-verified
> StarNet-vs-the reference harnessAgent comparison (21-agent workflow `wf_f9c4308c-fd3`). 8 confirmed ON-MOAT gaps where
> the reference harness excels and StarNet lacks; 2 off-moat non-goals (OpenAI-compat server/REPL, mixture-of-agents) excluded.
> **Defining theme: most fixes are WIRING — StarNet already writes durable transcripts/telemetry/recall it never
> reads back. Consume what exists before building anything new. Smallest-leverage-first.**

## Operating protocol (obeyed every iteration — same discipline as the P0–P3 loop)

1. **Work in the worktree, never the integration tree.** All editing/committing in
   `C:\Users\<you>\gen-trees\hermes-parity` on branch `agent/hermes-parity`. Integration tree
   (trunk `feat/harness-backend`) is touched ONLY to merge.
2. **Green before merge.** `npm run test:fast` must pass in the worktree; for shell/channel items also `test:http`.
3. **Watched before DONE.** UI/loop-affecting items get a live `npm start` check on a free port.
4. **One revertable commit per item** (tight series ok). Conventional commits, end with
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
5. **Polish gate before advancing** — self-review the diff, fix real findings, re-gate.
6. **Shared contract additive-only.** `shared/events.js` is MEMORY-CORTEX-owned; new events (`shell.bg.exit`,
   `skill.*`) are ADDITIVE only — add + flag in the commit, never rename/remove. `loop.replay` must stay
   byte-identical for any loop.js change.
7. **Sync before merge** (`sync-agent-tree hermes-parity`) so conflicts surface in the worktree.
8. **Coordinate live collisions.** Before editing a FRONTEND file (esp. `world.js`, `stationui.js`,
   `app.js`), run `node scripts/board.mjs --files <path>` — `agent/workforce-zones` is live in world.js
   (eerie/idle) and `agent/onboarding-remaster` in app.js/voice.js. Don't race them.
9. **No infinite walls.** Gate red after a real fix attempt → set item BLOCKED with the reason, move to the
   next independent item, surface it loudly. Never fake-green.

## Per-iteration algorithm
1. Read this file. Pick the first item not DONE/not BLOCKED, lowest phase first (H1→H6, in listed order).
2. Advance ONE coherent step (TODO→build tests-first → implement+gate → POLISH self-review → VERIFY live+merge).
3. Update the item's STATUS + Notes; append a dated Progress Log line.
4. Phase complete → run a phase polish pass (full gate + live smoke of that phase's surfaces) → advance.
5. All phases DONE → write `LOOP COMPLETE` to the Progress Log and STOP (don't reschedule).

> **Baseline:** trunk green at `c0a5a13` (confirmed pre-loop). Start from current trunk.

---

## PHASE H1 — Bulletproof resume + agent recall (rank 1, highest leverage)  ·  STATUS: ✅ DONE (3/3)
> StarNet fsyncs a durable transcript (`transcriptstore.js`) + serves `GET /api/transcript`, but NOTHING reads
> it back: resume rides the frontend `activeWs.history` (rendered/truncatable), the transcript stores only
> title+final-text per run (no tool_calls/intermediate turns), and there's no agent recall over it.

### H1.1 — Persist EVERY turn to the transcript  ·  STATUS: ✅ DONE (trunk `563fe38`)
Append user + each assistant message (incl. tool_calls) + each tool result to `transcriptstore.js` in the run
handler, not just title+final text. Harden the append path with the `savestore.js` atomic temp+rename+fsync idiom.
- **Acceptance:** `test/transcript.test.js` (or new) proves a multi-turn run records user + assistant-with-tool_call
  + tool-result + final verbatim (not just the title). Gate green; redaction still applied.
- **Notes:** Recon (iter 1): current append is index.js:1751-1763 — only title (last user msg) + final assistant
  text. DESIGN: (a) extend `sidecar/transcriptstore.js` additively with optional `toolCalls` (redacted JSON
  string) + `toolCallId` fields ('tool'/'assistant' roles already allowed). (b) In `runOnce`, capture
  `inputLen = o.messages.length` BEFORE the loop; replace the title/replyText block with a loop over
  `result.messages` from `inputLen-1` (the triggering directive) to end, appending each user/assistant/tool turn
  (skip 'system' fences) with role+content(+toolCalls/toolCallId). No dup: prior history (idx < inputLen-1) was
  appended in earlier runs. NEXT TICK: write `test/transcript.test.js` cases first (multi-turn run records
  tool_call + tool-result verbatim), then implement, gate, commit. Baseline gate GREEN.

### H1.2 — Seed run context from the transcript on restart  ·  STATUS: ✅ DONE (trunk `cad8347`)
On a run whose `ws.history` is empty/short, seed loop context from `transcriptStore.history(streamId)` instead of
trusting only the per-request `messages` array.
- **Acceptance:** new `test/transcript-resume.test.js`: append a multi-turn run, construct a FRESH sidecar/run
  with EMPTY ws.history over the same io, assert the rebuilt context contains the prior tool_call/tool-result
  turns. `loop.replay` byte-identical when history is supplied normally.
- **Notes:**

### H1.3 — Agent-callable `recall_conversation` tool  ·  STATUS: ✅ DONE (trunk `2286251`)
A builtin that BM25/keyword-ranks transcript rows by `streamId` so the agent can query its own old dialogue
(reuse the `memcore.js`/`context.js` scorer; transcript rows, not the notebook).
- **Acceptance:** `test/recall.test.js`: seed 50 transcript turns, call the tool with a phrase from turn #3, assert
  that turn ranks first. Tool registered behind a capability (notebook/cabinet-adjacent). Gate green.
- **Notes:**

## PHASE H2 — Fix the stateless shell (rank 2)  ·  STATUS: ✅ DONE (2/2)
> `shell.exec` recomputes `cwd = join(ROOT, aid)` every call (shell.js:118), fresh spawn, no stdin/PTY, hard
> tree-kill ceiling. `cd app && npm install` then `npm test` silently runs from jail root; the agent can't keep a
> dev server running. STRICTLY local-first — NO docker/ssh/modal (off-moat).

### H2.1 — Persistent cwd/env per agent  ·  STATUS: ✅ DONE (trunk `cab24f8`) — cwd persisted; env deferred (cwd was the foot-gun)
Keep a per-agent `{cwd, env}` session in `makeShellTool`; recover final cwd via a `pwd`/`cd` marker, clamped by the
existing `escapesWorkspace()` floor (can never leave the jail); default next call's cwd to stored. `verify.run` shares it.
- **Acceptance:** `test/shell-session.test.js` (injected fake spawn): `cd sub` then `pwd` runs with cwd ending `/sub`;
  `cd ..` past jail root is refused and cwd stays pinned. Gate green.
- **Notes:**

### H2.2 — Background / long-running process mode  ·  STATUS: ✅ DONE (trunk `925cea5`)
> PT1 (this commit): `sidecar/shellbg.js` singleton manager (detached/unref spawn, ring buffer, per-agent cap,
> start/status/kill/killAll, injected onExit; a killed proc frees its slot) + additive `shell.bg.exit` event +
> contract fixture + shell-bg.test (25, fake spawn). Held off trunk until wired. PT2 (next): shell.js
> `background:true` branch + `shell.bg.status`/`shell.bg.kill` tools delegating to the manager; index.js
> module-level singleton `shellBg = makeShellBg({ onExit: e => chanEmit('shell.bg.exit', e) })` passed into
> makeShellTool per run + killAll on E-STOP/halt; workbench grants for the 2 new tools; capgate + harness
> toolset assertions. Then gate + merge.
Optional `background:true`: detached spawn (`child.unref`), returns a handle id immediately, streams to a ring
buffer, emits `shell.bg.exit` (ADDITIVE event — flag to MEMORY-CORTEX) on close; add `shell.bg.status`/`shell.bg.kill`;
cap concurrent bg procs; auto-reap on run end/signal abort.
- **Acceptance:** `test/shell-bg.test.js`: bg start returns a handle without blocking; status reports running; resolving
  the fake child fires `shell.bg.exit`. Gate green (+`test:http` if a route is added).
- **Notes:**

## PHASE H3 — Close the observability holes (rank 3)  ·  STATUS: ✅ DONE (3/3)
> `provider.fallback` is emitted with ZERO consumers (truthful-telemetry promise undercut); RUNS rows aren't
> joinable to transcripts (runstore stores no streamId); no aggregate usage view. All read-only over stored data.

### H3.1 — Consume `provider.fallback`  ·  STATUS: ✅ DONE (trunk `bfb5612`)
A `U.bus.on('provider.fallback')` handler (world.js) + a `floorstats.js` failover counter/badge + a LOGBOOK row, so a
model/credential switch is visible. **CHECK `board.mjs --files frontend/app/world.js` first (workforce-zones lane).**
- **Acceptance:** `test/observability.test.js`: emit `provider.fallback` through the floorstats fold → failover counter
  increments. Live: a forced failover shows in the HUD. Gate green.
- **Notes:**

### H3.2 — Join run → transcript  ·  STATUS: ✅ DONE (trunk `3403394`)
Thread the in-scope `streamId` into `runStore.record` (add the field in `runstore.js`); make `stationui.js` RUNS rows
clickable to open that run's transcript via `GET /api/transcript?streamId=`.
- **Acceptance:** `test/observability.test.js`: `runStore.record` persists `streamId`; a RUNS entry resolves to a
  non-empty transcript for that streamId. Gate green.
- **Notes:**

### H3.3 — `GET /api/insights` + LOGBOOK tab  ·  STATUS: ✅ DONE (trunk `99aefc3`)
Fold runstore + spend ledger into per-model spend, tool-usage ranking, runs-over-time; render a new LOGBOOK tab.
- **Acceptance:** `test/insights.test.js`: seed runstore+ledger across two models, assert per-model spend totals + a
  tool-usage ranking are correct. Read-only. Gate green.
- **Notes:**

## PHASE H4 — Agent-authored skills library (rank 4, genuinely new)  ·  STATUS: ✅ DONE (2/2, trunk `1ea91d5`)
> StarNet's thesis names "an owned compounding exportable library" as core, yet the only "skill" is a memory KIND
> (a one-line notebook fact); `notebook.js` even says "reusable procedures belong in a skill, not memory" with no
> such artifact. Mirror the notebook plumbing. Keep it a plain titled document (defer the reference harness YAML/hub install).

### H4.1 — `skillstore.js`  ·  STATUS: ✅ built (commit `bf035cd`, held for H4.2 merge)
Sibling of transcript/runstore (injected-io + fsync, jail-sibling) holding per-agent `{id, name, summary, body, updatedAt}`.
- **Acceptance:** `test/skills.test.js` (part 1): round-trips through a fresh instance over the same io (durable);
  same-name write edits in place (no dup). Gate green.
- **Notes:**

### H4.2 — `skill.write` / `skill.list` / `skill.view` tools  ·  STATUS: ✅ DONE (trunk `1ea91d5`)
write (create/edit), list (metadata only — name+summary, progressive disclosure), view (full body on demand), behind a
notebook-adjacent capability; optionally inject skill SUMMARIES (not bodies) into the system prompt. `skill.*` events
ADDITIVE (flag to MEMORY-CORTEX).
- **Acceptance:** `test/skills.test.js` (part 2): list returns name+summary but NOT body; view returns the body. Gate green.
- **Notes:**

## PHASE H5 — Context-compaction quality (rank 5)  ·  STATUS: ✅ DONE (2/2, trunk `e7f335a`)
> Summarizer emits single free prose (index.js:~1597); prior summaries STACK not merge; backoff is failure-only, not
> effectiveness-based (pays a summarizer call every over-threshold turn even when each fold removes 1–2 messages).

### H5.1 — Structured summary template  ·  STATUS: ✅ DONE (trunk `3d4fea4`)
Replace the free-prose system prompt with a fixed section template (Active Task / Goal / Completed Actions / Open
Questions / Remaining Work / Critical Context). Keep `planCompaction` tool-pairing-safety untouched.
- **Acceptance:** `test/compaction.test.js`: a fold's summary contains the required headers; `context.test.js`
  pairing-safety still green. Gate green.
- **Notes:**

### H5.2 — Iterative merge + savings anti-thrash  ·  STATUS: ✅ DONE (trunk `e7f335a`)
Detect a prior `<conversation_summary>` note and feed it as PREVIOUS SUMMARY → emit ONE merged note (fix the loop.js
concat ~192). Track bytes-removed/fold; after 2 consecutive <10%-savings folds, raise threshold / skip until context grows.
- **Acceptance:** `test/compaction.test.js`: after a 2nd fold exactly ONE summary note remains (merged); two <10%
  folds → 3rd is deferred. `loop.replay` byte-identical with no summarizer. Gate green.
- **Notes:**

## PHASE H6 — Reliability + reach follow-ons (ranks 6–8)  ·  STATUS: IN PROGRESS

### H6.1 — Honor Retry-After / reset_at + status-specific credential cooldown  ·  STATUS: ✅ DONE (trunk `43feb43`)
Extend `errorClass.js` to extract `retryAfterMs` from `Retry-After` headers + "resets in/at" body text; honor it
(capped ≤60s) in `openrouter.js`/`codex.js` retries; make `credpool.penalize(key, ttlMs?)` accept a status-specific TTL
(429→parsed reset or 1hr, 401→5min) passed from the rotate site.
- **Acceptance:** `test/retry-after.test.js`: a 429 body "retry after 20 sec" → `retryAfterMs===20000`; `Retry-After: 30`
  → 30000. `test/credpool-ttl.test.js`: a 429+reset cools to the reset window (not flat 5min); a 401 ~5min. Gate green.
- **Notes:**

### H6.2 — Light up Discord live + a channel registry  ·  STATUS: ✅ DONE (trunk `4fd10c7`)
- **Follow-on (minor, this lane's domain):** `channels/discord.js` `makeDiscordAdapter` does NOT forward
  `ownerUserId`/`onOwnerClaim` to `makeChannelAdapter` (only `allowedChats`), so a restored Discord owner re-claims
  on the first DM each restart (TOFU still safe). 2-line forward + persist; deferred to avoid scope creep.
Import `makeDiscordAdapter` + a `startDiscord()` mirroring `startTelegram` (connect/sync/disconnect/status + auto-start);
refactor the hardcoded wiring into a small `channelRegistry` of `{id, makeAdapter, transport}` so `startChannel(id)`
loops. Enterprise surfaces (slack/signal/matrix) OUT (off-moat). NOTE: the live Discord gateway WS still needs a bot
token to fully verify — registry + start wiring is testable now; live gateway = token-gated.
- **Acceptance:** `test/channels.registry.test.js`: a stub channel registered via the registry drives the SAME `runOnce`
  (owner-gate + normalize honored); registry includes a `discord` entry; existing `channels.discord.test.js` green. Gate green.
- **Notes:**

### H6.3 — Per-subagent iteration cap + no-op turn refund  ·  STATUS: TODO
Thread an optional `maxIters` through `orchestration.js` dispatch (alongside the per-worker USD cap) and honor `o.maxIters`
in the loop's limit construction so workers get a smaller iteration budget than the lead; refund a turn that produced no
tool call AND no assistant text (or a pure failover/compaction retry) with a hard floor.
- **Acceptance:** `test/iteration-budget.test.js`: a worker dispatched with maxIters=10 has loop limit 10 while the lead
  stays 40; a no-op turn is excluded from the effective count. `loop.replay` byte-identical. Gate green.
- **Notes:**

---

## Progress Log
- _(the loop appends one dated line per iteration here)_
- **2026-06-23 · iter 1 · H1.1 → BUILDING.** Loop established (self-paced) from the 21-agent ref-parity audit.
  Worktree `agent/hermes-parity` cut off trunk `a617cb8`; **baseline `test:fast` GREEN**. Reconned the transcript
  append (index.js:1751-1763, title+final only) + run-message assembly; designed the every-turn append
  (transcriptstore additive `toolCalls`/`toolCallId` + `result.messages.slice(inputLen-1)` loop). No code yet
  (recon+design). NEXT: write the transcript-completeness test first, then implement.
- **2026-06-23 · iter 2 · H1.1 DONE -> trunk `563fe38`.** Synced. Extended `transcriptstore.js` additively
  (redacted `toolCalls`/`toolCallId` + a pure `appendTurns(messages, fromIndex)` recording every user/assistant/
  tool turn, skipping system fences). `runOnce` captures the pre-loop boundary `_txStart` and appends the
  directive + `result.messages.slice(_txStart)` (no history dup). Tests-first: transcript.test 25->35,
  e2e.run.test 8->10 (live boot+stream proves the dialogue is captured back via GET /api/transcript). Gate green;
  additive/byte-identical. NEXT: H1.2 (seed run context from the transcript on restart).
- **2026-06-23 · iter 3 · H1.2 ✅ DONE → trunk `cad8347`.** Added pairing-safe `transcriptStore.reconstruct(streamId)`
  (rebuilds OpenAI-format messages incl. tool_calls/tool pairs, drops orphaned pairs at a truncated boundary).
  `runOnce` seeds `convo` from the transcript when a run names an explicit `streamId` and arrives with no prior
  history (best-effort, never overrides client history, global catch-all not auto-seeded). transcript.test 35→41;
  e2e.run.test 10→12 (LIVE: run B with empty history seeds run A's content back to the provider). Merge completed
  despite a mid-step classifier drop; trunk GREEN with H1.2 + concurrent workforce-zones merges integrated (no
  clobber). NEXT: H1.3 (agent-callable recall_conversation tool).
- **2026-06-23 · iter 4 · H1.3 ✅ DONE → trunk `2286251`. 🏁 PHASE H1 COMPLETE (3/3).** Added
  `transcriptStore.search()` (dependency-free BM25-ish, stream-scoped) + a `recall_conversation` builtin that
  joins the NOTEBOOK (memory) capability (read-only, no consent). New recall.js + recall.test.js (13: phrase→turn
  ranked #1 of 50, stream isolation, guards); wired into index.js + the memory grant; capgate + harness.integration
  toolset assertions updated to include it. Full gate green; clean boot. The H1 arc is whole: record every turn →
  seed on restart → recall on demand. **→ advancing to H2 (stateless shell: persistent cwd/env + background mode).**
- **2026-06-23 · iter 5 · H2.1 DONE -> trunk `cab24f8`.** Persistent per-agent shell cwd via a stdout marker
  (cwd + real exit code appended, parsed back, stripped from output, jail-CLAMPED so an out-of-jail cwd is never
  persisted; `cd ..` still refused). Local-first only. Pure helpers buildMarkedCmd/parseMarker/withinJail
  exported+tested; shell-session.test (16, fake spawn). Real-spawn shell.test still green -> validates the
  Windows %CD%/%ERRORLEVEL% marker on the actual platform. Env carry-over deferred. Gate green. NEXT: H2.2
  (background/long-running process mode).
- **2026-06-23 · iter 6 · H2.2 pt1 (commit `4a2b38c`, not merged).** Built `sidecar/shellbg.js` — singleton
  background-process manager (detached/unref spawn, output ring buffer, per-agent cap, start/status/kill/killAll,
  injected onExit; a killed proc frees its cap slot immediately — caught by the test). Added additive
  `shell.bg.exit` event + contract fixture. New shell-bg.test (25, fake-spawn lifecycle: start/stream/cap/exit/
  kill/killAll/agent-isolation). Full gate green. Held off trunk until pt2 wires it (no dangling event in trunk).
  NEXT: pt2 — wire into shell.js + index.js singleton (onExit→chanEmit) + workbench grants + toolset assertions, then merge.
- **2026-06-23 · iter 7 · H2.2 ✅ DONE → trunk `925cea5`. 🏁 PHASE H2 COMPLETE (2/2).** pt2 wired the manager:
  `shell.exec background:true` hands off to the singleton + returns a handle; new `shell.bg.status`/`shell.bg.kill`
  tools (workbench). index.js holds the module-level singleton (persists across runs) with `onExit→chanEmit('shell.bg.exit')`
  on the durable bus; E-STOP `handleHalt` now `killAll()`s bg procs. Workbench grants extended (presence-checked →
  no capgate break). shell-bg.test +5 (tools delegate). Full gate green; clean boot. Stateless-shell weakness
  fully closed: `cd` persists AND a dev server can run in the background. **→ advancing to H3 (observability: consume
  provider.fallback, join run→transcript, /api/insights).**
- **2026-06-23 · iter 8 · H3.1 ✅ DONE → trunk `bfb5612`.** board.mjs-checked world.js/floorstats.js (no live
  collision) before editing. `provider.fallback` had ZERO consumers → a mid-run failover was invisible. floorstats
  now folds it (failovers counter + lastFailover in snapshot); world.js routes the event to the fold + surfaces a
  LOGBOOK notify. Consume-side, no new event. floorstats.test 60→66; gate green; board re-checked clear before merge.
  NEXT: H3.2 (join run→transcript: streamId into runStore.record + clickable RUNS rows).
- **2026-06-23 · iter 9 · H3.2 ✅ DONE → trunk `3403394`.** runstore.record now stores `streamId` (threaded from
  runOnce); GET /api/runs surfaces it; a RUNS row in the LOGBOOK is clickable to lazily open that run's transcript
  inline (GET /api/transcript?stream=). board-checked stationui.js clear before+after. runstore.test +3,
  e2e.run.test +1 (a real run's RUNS row carries streamId — join proven end-to-end). Gate green. NEXT: H3.3
  (GET /api/insights: per-model spend + tool-usage ranking + runs-over-time, as a LOGBOOK tab).
- **2026-06-23 · iter 10 · H3.3 ✅ DONE → trunk `99aefc3`. 🏁 PHASE H3 COMPLETE (3/3).** New pure `insights.js`
  folds run history → overview (runs/spend/tokens/avg + honest null success%), per-model spend (runstore now
  records `model`), outcomes, per-agent, runs/spend-over-time. `GET /api/insights` (fail-open) + an INSIGHTS
  LOGBOOK tab. Tool-usage ranking deferred (tool calls aren't persisted — noted, not faked). insights.test (19);
  gate green; route boot-verified; board clear. **Observability holes closed.** **→ advancing to H4 (agent-authored
  skills library: skillstore.js + skill.write/list/view).**
- **2026-06-23 · iter 11 · H4.1 built (commit `bf035cd`, not merged).** `sidecar/skillstore.js` — per-agent
  named procedure documents (append-only+fsync, jail-sibling, redacted, edit-in-place last-write-wins, per-agent
  cap, list=metadata-only/view=full-body). skills.test (22: durability, edit-no-dup, cap, isolation, redaction).
  Gate green. Held off trunk until H4.2 wires the tools. NEXT: H4.2 — skill.write/list/view tools (memory-adjacent
  capability) + index.js singleton store + grants + toolset assertions + optional summary injection, then merge H4.
- **2026-06-23 · iter 12 · H4.2 ✅ DONE → trunk `1ea91d5`. 🏁 PHASE H4 COMPLETE (2/2).** `skills.js` tools
  (skill.write/list/view, memory capability) over the singleton skillStore (fsync skills.jsonl, jail sibling);
  memory grant + capgate/harness toolset assertions updated. skills.test 22→29. Gate green; clean boot. (Caught a
  shell-`&` cwd gotcha that backgrounded a `cd` so the first commit ran from the wrong dir — re-committed cleanly.)
  Summary-injection into the system prompt deferred (agent discovers via skill.list, like notebook.read). The one
  genuinely-NEW capability is in. **→ advancing to H5 (compaction quality: section template + iterative merge + savings anti-thrash).**
- **2026-06-23 · iter 13 · H5.1 ✅ DONE → trunk `3d4fea4`.** Replaced the free-prose summarizer prompt with a
  structured section template via new pure `context.compactionSummaryPrompt({prevSummary})` (also emits the
  MERGE-update variant H5.2 will use). Host-side (index.js summarize); loop.js untouched → loop.replay
  byte-identical. context.test +13; gate green. NEXT: H5.2 (iterative MERGE — one conversation_summary note, not
  stacked — + savings anti-thrash: defer after 2 consecutive <10%-savings folds; loop.js change, keep loop.replay identical).
- **2026-06-23 · iter 14 · H5.2 ✅ DONE → trunk `e7f335a`. 🏁 PHASE H5 COMPLETE (2/2).** loop.js maybeCompact now
  lifts any prior `<conversation_summary>` OUT of the working set, seeds the next fold with its text
  (`summarize(older, prevSummary)` → merge-update prompt), and rebuilds with EXACTLY ONE note (no more stacking).
  Savings anti-thrash: after 2 folds in a row freeing <10%, compaction switches off for the run. New compaction.test
  (8) drives both through the real loop; **loop.replay byte-identical (87 assertions)**; gate green. **Compaction
  quality now matches the reference harness.** NEXT: H6.1 — honor Retry-After/reset_at in errorClass + status-specific credpool cooldown.
- **2026-06-23 · iter 15 · H6.1 ✅ DONE → trunk `43feb43`.** End-to-end Retry-After honoring: errorClass now
  extracts `retryAfterMs` (header secs / "try again in Ns·Nm") + `resetAtMs` (HTTP-date / X-RateLimit-Reset epoch /
  "resets at <epoch>"), PURE/clockless; loop.js threads both through onFallback (no event change); index.js → TTL
  (relative direct, absolute−now); `credpool.penalize(key, ttlMs)` honors it, clamped to a 1h ceiling. errorclass.test
  +13, credpool.test +4; loop.replay byte-identical (87); clean boot. (Chose onFallback callback over a new
  provider.fallback field → zero shared-contract churn.) NEXT: H6.2 — Discord-live + a channel registry that drives the same runOnce.
- **2026-06-23 · iter 16 · H6.2 ✅ DONE → trunk `4fd10c7`.** New `channels/registry.js` (descriptors for
  telegram+discord + generic `wireChannel`) and index.js `startDiscord()` + auto-start, mirroring Telegram through
  ONE inbound→runOnce path. The shipped-but-unstarted Discord adapter is now reachable. channels.registry.test (17:
  registry lists both w/ the real discord factory; a stub drives the same runOnce + tied send-ref; discord wires
  into a startable adapter). Gate green; clean boot (no token → no spurious start); live WS gateway token-gated.
  (Caught + flagged a minor discord owner-forward gap; debugged an event-loop-starvation test hang → kept the
  registry-specific claims, leaned on channels.discord.test for the gateway e2e.) NEXT: H6.3 — per-subagent maxIters + no-op turn refund (last item).
