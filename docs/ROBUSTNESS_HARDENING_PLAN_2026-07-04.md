# Robustness Hardening Plan — 2026-07-04

Source: five-agent verified audit of trunk `feat/harness-backend` (2026-07-04). Every item below
was verified against current code with quoted snippets — but per doctrine, **re-grep before
building each item**; trunk moves in hours.

Goal: close the four failure classes that hurt real users — **unstoppable/hung spend**,
**silent data loss**, **the app lying about state**, and **24/7 resource growth**.

## Lane map (worktrees, per CLAUDE.md protocol)

| Lane | Branch | Owns (files) | index.js contact |
|------|--------|--------------|------------------|
| P0 quick wins | `agent/harden-p0` | tiny diffs across several files | small, surgical |
| A providers | `agent/harden-provider` | `sidecar/providers/*`, `sidecar/loop.js`, `sidecar/fallbackchain.js`, `sidecar/credits.js` | none |
| B stores | `agent/harden-stores` | `sidecar/durable-store.js`, `savestore.js`, `checkpoint-store.js`, `skillstore.js`, `subagents.js`, `runstore.js`, `ledger.js`, `transcriptstore.js` | io adapters only (~30 lines) |
| C lifecycle | `agent/harden-lifecycle` | `sidecar/index.js` (halt/shutdown/cron sections), `cron-driver.js`, `cron-lock.js`, `workshop-store.js`, `shellbg.js`, `mcp/manager.js`, `mcp/transport.stdio.js` | HEAVY |
| D routes | `agent/harden-routes` | `sidecar/index.js` (router/readBody/loop-guard), `concurrency.js`, `channels/sse.js`, `tools/registry.js`, `tools/builtin/computer.js`, `tools/builtin/desktop.js` | HEAVY |
| E frontend | `agent/harden-frontend` | `frontend/app/world.js`, `chat.js`, `stationui.js`, `conveyor.js`, `frontend/js/util.js`, `main.js` | none |

**Sequencing rule:** C and D both gut-edit `sidecar/index.js`. Run **C first, merge, then D**
(D rebases via `sync-agent-tree.ps1` before starting real work). A, B, E run fully parallel
with them. P0 lands before everything.

`shared/events.js` / `shared/schema.js`: additive-only via the cortex-memory owner. Phase 3's
snapshot is an **HTTP endpoint**, not a new event, precisely to avoid touching the contract.
If TTL-degrade wants a new event (`link.state`), request it additively.

---

## Phase 0 — Quick wins (1 short lane, land first) `agent/harden-p0`

Small, independent, high-value diffs. One branch, one merge.

1. **includeUsage wire-up** — pass `includeUsage: true` for the openai-compatible adapter in
   `sidecar/providers/factory.js` (or flip adapter default). ~1 line.
   *Done =* run an agent on Groq/OpenAI: run card shows nonzero tokens/cost; ledger row nonzero.
2. **E-STOP covers Discord + cron leases** — `handleHalt` (index.js:4448): pass Discord hub
   inflight to `killAll`; add `cronDriver.abortAllLeases()` (iterate `leases`, `ac.abort()`).
   *Done =* start a cron "Run Now" + a Discord run, hit E-STOP, both end `cancelled` within 2s.
3. **rAF crash guard** — `world.js frame()`: schedule next frame FIRST (guarded by `running`),
   wrap body in try/catch; after 30 consecutive throws show a "RENDER FAULT" overlay
   (honest, not silent). Same for `redrawNow()`.
   *Done =* inject a throw in a draw pass via console; station keeps animating; fault overlay after sustained throws.
4. **Windows errno conflation** — `durable-store.js readOne` + `savestore.js readWrapper`:
   only `ENOENT` → `absent`; any other errno → new `'unreadable'` kind treated like
   `'corrupt'` (loud, refuse the from-empty write path).
   *Done =* unit test: lock the file (open with exclusive handle), `update()` throws/skips
   instead of writing empty; test:fast green.
5. **readBody UTF-8** — index.js:4985: collect Buffers, single decode (mirror `readBodyBuffer`).
   *Done =* unit test posting a body with a 4-byte emoji split across two chunks parses intact.
6. **Loop-guard false positive** — index.js:3959: sha1 the FULL argsRaw; count only errored
   results (match loop.js semantics).
   *Done =* test: 5 fs_write calls, same path, different long content — none blocked.

Gate: `npm run test:fast` + live checks above. Merge via starnet-merge-ritual.

---

## Phase 1 — Lane A: provider/API layer (parallel with C)

1. **Stream timeouts (the big one).** Every adapter: `AbortSignal.any([req.signal,
   AbortSignal.timeout(CONNECT_MS)])` on the POST; resettable idle watchdog (env-tunable,
   default 120s since last byte) around `reader.read()` that cancels the reader and throws a
   classified `timeout`. Also codex-auth fetches + TTS/STT dispatcher (`AbortSignal.timeout`).
   *Done =* mock a stalling SSE server (dev fixture): run errors with `timeout` class at ~120s,
   concurrency slot freed (a second agent's run admits immediately after).
2. **Mid-stream retry + fatal-path reconcile.** loop.js recovery block: bounded same-provider
   retry (reuse RETRY_DELAYS) when `cls.retryable && !cls.shouldFallback`; reconcile any
   received `usage` before `end('error')` on every fatal return.
   *Done =* kill the mock stream mid-generation once → run recovers and completes; ledger
   records tokens from a run that fails after partial usage arrived.
3. **finishReason surfaced.** loop.js: capture last done-event finishReason; `length` /
   `content_filter` end the run with a distinct reason (and are excluded from the
   `reason === 'done'` reflection/study/skill-review gate in index.js — coordinate: this one
   crosses into C's territory; make it a 5-line follow-up in C if conflict).
4. **Retry-After honored.** Attach `err.headers = res.headers` when building HTTP errors in all
   adapters; delay = `max(RETRY_DELAYS[attempt], cls.retryAfterMs || 0)` capped at 60s.
5. **Catalog re-warm.** If `CATALOG` empty at run admission, re-call `listModels()` once.
   *Done =* boot offline, go online, first run compacts/prices correctly.
6. **Credits drift.** `credits.js`: on debit/credit POST failure, roll back cache (or null it →
   fail-closed next admission) + emit `credits.drift` via existing event surface.

Gate: test:fast + the two mock-server live checks. Note in report which items were live-verified.

## Phase 2 — Lane C: lifecycle & crash recovery (index.js owner, runs while A/B/E run)

1. **Shutdown handler.** SIGINT/SIGTERM (+ Windows close path the Tauri sidecar uses):
   `bg.killAll(); connectorManager.close(); browser close; cronLock.release();
   telegram/discord disconnect`. Idempotent, 3s hard deadline then exit.
   *Done =* start a bg dev server via agent shell, Ctrl+C sidecar, port is free; no cron.lock left.
2. **Cron lock pid-check.** cron-lock.js: lockfile already stamps pid — at boot/acquire, if pid
   not alive (process.kill(pid,0) throws), break immediately. Log the not-acquired path.
   *Done =* kill -9 the sidecar mid-tick, restart: first tick fires within one interval, with a log line.
3. **Workshop zombie-claim reclaim.** `claimNext` (or boot sweep): a `buildingRunId` whose run
   is not live → clear it (mirror cron G4.5).
   *Done =* stamp a fake claim, restart, next shift claims the item.
4. **MCP death feedback.** transport exit/error callback → manager `setState('error')` +
   bounded reconnect backoff (or at minimum honest status).
   *Done =* kill the stdio child: panel flips to error within 5s; recovers on restart if reconnect built.
5. **Cron write contention.** `withCronWrite`/`setJobs`: async retry (`await setTimeout`), and
   on spin exhaustion re-read + merge by job id instead of unlocked blind persist.
6. **finishReason gate** follow-up from A3 if deferred.
7. **Steer-buffer cleanup** in cron/workshop run finallys (2 lines each).

## Phase 3 — Lane E: frontend truth (parallel from day 1)

1. **Link-down honesty (cheap, do first).** Track last-event timestamp + `chanES.readyState`;
   stale > 10s → dim queue gauges / run clocks, draw "LINK DOWN" telemetry marker.
   *Done =* kill sidecar with app open: marker appears ≤10s, gauges dim; restart: clears.
2. **Reconnect reconciliation (the real engineering item).** Backend half belongs to C/D owner:
   `GET /api/state/snapshot` returning active runs, pending permission prompts, queue depths,
   inflight tool glyphs (all already in memory server-side). Frontend: on `chanES.onopen`,
   fetch snapshot, rebuild `runStartByAgent`, crew `workUntil`, `serverLit`, `awaitPrompt`,
   `glyphByAgent`, `delegate*`; clear anything not in the snapshot.
   Plus **TTLs** on paired states as a second net (run clock with no event for 5m → degrade
   to unknown, not asserted-running).
   *Done =* start a run, kill+restart sidecar mid-run: clock/pose/approval state clears within
   one reconnect; no eternal RUN clock.
3. **ws.history cap** — chat.js: cap at N turns (match server compaction horizon), truncation
   marker; stop re-sending the full array (send capped window).
4. **`r.ok` gates** — stationui.js:967, :2448 (+ sweep every `fetch().then(r=>r.json())`):
   reject on !ok, render the existing sidecar-unreachable affordance.
5. **`U.bus.off()`** + panel-scoped unsubscribe on close.
6. Small sweep: conveyor `mbuf` clear on junction change; roster-change map sweep
   (heatByAgent/deskProg/xpByAgent/...); boot-seq null guards; spotify poll try/catch;
   `PropSprites` typeof guard at world.js:4608; API-base prefix consistency (routing/connectors
   vs `__STARNET_API__`).

## Phase 4 — Lane D: routes & event-loop hygiene (AFTER C merges)

1. **Central async route guard.** Wrap dispatch: `Promise.resolve(handler(req,res)).catch(e =>
   runRouteFailure(res, e, redact))`. Remove the empty-200 ad-hoc catches (permissions grant
   et al.) so failures are failure-shaped.
   *Done =* force a store throw in a memory-mutate route: client gets 500 JSON, process alive,
   no hung fetch.
2. **Same-agent run mutex.** In runOnce admission: in-flight runId per agent → refuse second
   with `transient:true` (client already retries transients) or queue. Keyed mutex exists in
   durable-store.js.
   *Done =* double-submit /api/run for one agent: second gets clean refusal; no git index.lock
   errors in checkpoint log.
3. **SSE backpressure.** sse.js: check `res.write()` return / `writableLength` > threshold →
   evict client.
4. **spawnSync → async execFile** in computer.js/desktop.js (same timeouts).
   *Done =* during a computer.use action, /api/health answers < 100ms.
5. **Tool timeout aborts work.** registry.js `withTimeout` threads an AbortController into ctx;
   orchestration/web/mcp honor it.
6. **413 before destroy** on oversized bodies; delete dead `/api/models/openrouter` branch;
   agentId regex on handleAutonomyWrite; `COPYFILE_EXCL` + overwrite flag on workshop keep.

## Phase 5 — Lane B: storage durability & growth (parallel, low conflict)

1. **savestore hardening** — route through `readJsonResilient`/`writeJsonResilient` + quarantine
   (the XP/identity file deserves what its siblings have).
2. **Checkpoint index durable + rebuildable** — `writeFileDurable` + `.bak`; on empty index with
   existing shadow repo, rebuild from `git log --format=%H`.
   *Done =* truncate index.json, restart: rollback list repopulates.
3. **skills.jsonl** — stop persisting on view (RAM counters, flush on real mutation);
   compaction pass keeping newest entry per (agentId,name); bounded boot read AFTER compaction
   exists (naive rotation would drop skills — do not rotate first). Same treatment for
   skillprefs.jsonl.
4. **RAM mirror trims** — runstore/ledger/transcript: splice on append past max served query
   limit (transcript: per-stream fairness cap).
5. **Shadow-git size ceiling** — past N MB, re-init repo from current tree (index only retains
   50 anyway) or `git gc --prune`.
6. **Durability odds and ends** — subagents.js durable write + warn; cron.armed.json via
   saveResilient + log-on-corrupt; runtime.knobs .bak fallback loader; ledger append-failure
   counter → recordDiagError after N consecutive.

## Deferred / decide-later (raise to Andrew, don't build silently)

- **Telegram offline-message drop**: product choice. Recommend the one-line "I was offline,
  N messages skipped" notice (keeps anti-stale-directive behavior, restores honesty).
- **uncaughtException swallow-and-continue**: needs a deliberate policy (keep serving vs
  fail-fast + supervisor). Tied to desktop-app supervision story.
- **Cross-process durable-store locking** (two-sidecar scenario): document single-process
  ownership as an invariant OR reuse makeCronLock. Decide which product reality we support.
- **Anthropic max_tokens 4096 default**: bump default or plumb per-run; cheap but touches
  output-length product expectations.

## Verification & merge protocol (every lane)

- Doctrine applies: re-grep the finding before building it; smallest verifiable slice; commit
  pathspecs only; live-app proof per the *Done =* line; `npm run test:fast` green; merge via
  `starnet-merge-ritual`; report what was and was NOT live-verified.
- New tests: prefer unit tests for the pure fixes (errno kinds, readBody decode, loop-guard
  sig, cron-lock pid) — they're regression armor for exactly the classes that recur.

## Suggested order of battle

1. `harden-p0` (day 1, merge same day)
2. `harden-provider` + `harden-lifecycle` + `harden-frontend` + `harden-stores` in parallel
3. `harden-routes` after lifecycle merges (index.js serialization)
4. Deferred items → Andrew decisions → follow-up slices
