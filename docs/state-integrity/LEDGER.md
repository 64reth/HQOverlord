# State Integrity — living ledger

Backlog + status for the reset-on-transition hardening pass. One row per finding.
Status: **OPEN** → **FIXED** | **HELD** (ready, awaiting coordination on a hot file) |
**NEEDS-PRODUCT-CALL** | **WONTFIX** (with rationale).

Discovery: parallel read-only audit, 2026-06-23 (4 module clusters). 13 real leaks + 3
product-call borderlines. The founding crew bug is FIXED and shipped on trunk.

## Matrix (transition × stateful module)

✅ audited-clean · ⚠ leak-found · 🛠 fixed · — n/a

| module \ transition | WAKE | RESUME | DISCONNECT | NEW AGENT | SUMMON | REFIT |
|---|---|---|---|---|---|---|
| World: crew/listeners/firstWake | 🛠 | 🛠 | 🛠 | 🛠 | ✅ | ✅ |
| World: FloorStats/SlagLog | ⚠ W1 | ⚠ W1 | — | ⚠ W1 | — | — |
| World: Conveyor | ⚠ W2 | ✅ | — | ⚠ W2 | — | ⚠ W2 |
| World: chanQueues/serverLit | ⚠ W3 | ⚠ W3 | — | ⚠ W3 | — | — |
| World: xp/beat clocks | ⚠ W4 | ✅ | — | ⚠ W4 | — | — |
| World: connector poll | — | — | ⚠ N1 | — | — | — |
| World: channels SSE | — | — | ⚠ N2 | — | — | — |
| Voice: speak queue/watchdog | ⚠ C4 | ⚠ C4 | ✅ | ⚠ C4 | — | — |
| Voice: forcedSpeak | ⚠ C3 | ⚠ C3 | ✅ | ⚠ C3 | — | — |
| Chat: proposalRunsSeen/wiQDepth | ⚠ C2 | ⚠ C2 | ✅ | ⚠ C2 | — | — |
| Tutorial: finished latch | ✅ | ✅ | ✅ | ⚠ C1 | — | — |
| MintStore (starnet.mint.v1) | ⚠ S1 | ✅ | — | ⚠ S1 | — | — |
| CuriosityStore (.curiosity.v1) | ⚠ S2 | ✅ | — | ⚠ S2 | — | — |
| Marketplace ack / Build seen | — | — | — | ⚠ S3/S4 | — | — |
| Workstreams / Xp / Profile / Dossier | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| StationUI panels | ✅ | ✅ | ✅ | ✅ | — | — |
| Harness fetch / CloudSave / codexPoll | ✅ | ✅ | ✅ | ✅ | — | — |

## Findings (ranked)

| ID | Sev | Conf | Status | File | Leak (one line) |
|---|---|---|---|---|---|
| **W1** | Med | High | **FIXED** | world.js spawn | FloorStats economy (spend/slag/yield) + SlagLog not reset → new agent's HUD shows prior agent's numbers. Reset in `spawn()` (NOT loadStation — that also runs on refit). Verified live: spend 0.42 → 0. |
| **W2** | Med | High | **FIXED** | world.js spawn | Conveyor boxes not reset → prior agent's belt crates ride the new floor. `convey.reset()` now called in `spawn()`. |
| **N1** | Med | High | **FIXED** | world.js + app.js | Connector poll now held in `connPollTimer`; `pauseBridge()` (on disconnect) clears it, `resumeBridge()` (on entry) restarts it. Verified live: poll true → false → true. |
| **N2** | Med | High | **FIXED** | world.js + app.js | Channel `EventSource` now held in `chanES`; closed on disconnect, reopened on entry; `onerror` bails while paused. Verified live: es true → false → true. |
| **S1** | Med | High | **FIXED** | mintstore.js + app.js | New `MintStore.reset()` drops `starnet.mint.v1`; called from the NEW AGENT handler. Verified live: key present → NEW AGENT → null. |
| **V1** | High | High | **FIXED** | chat.js send | **Voice ownership (Commander rule):** only the orchestrator (hero) may speak; summoned/secondary agents must be silent. `willSpeak` now requires the active stream's agent be the orchestrator. |
| **C4** | Med | Med | **FIXED** | voice.js init | `Voice.init()` now calls `stopSpeaking()` → prior agent's TTS + watchdog interval are cut before the next agent takes the mic. |
| **W3** | Low | Med | **FIXED** | world.js spawn | `chanQueues` Map + `serverLit` Set never cleared → phantom backlog gauge / a body stuck "working". Cleared in `spawn()`. Verified live: queueDepth 7 → 0. |
| **W4** | Low | Med | **FIXED** | world.js spawn | `xpAgent` + one-shot beat clocks (levelUp/compact/slag/outbox) not reset → brief stale level chip / a beat replays one frame into the new agent. Reset in `spawn()`. |
| **S2** | Low | High | **FIXED** | curiositystore.js + app.js | New `CuriosityStore.reset()` drops `starnet.curiosity.v1`; called from the NEW AGENT handler. Verified live: key present → NEW AGENT → null. |
| **C1** | Low | Med | **FIXED** | tutorial.js | `finished` now reset in `firstCommand()` (symmetric with the saw-flags). |
| **N3** | Low | High | **FIXED** | world.js + app.js | Root cause resolved by N1/N2: the open-once bridge now has a paired pause(disconnect)/resume(entry); the once-guarded `U.bus.on` subscriptions stay put. |
| **C2** | Low | Low | **FIXED** | chat.js init | `proposalRunsSeen` + `wiQDepth` now cleared in `init()`. |
| **C3** | Low | Low | **FIXED** | voice.js init | `forcedSpeak` now reset in `Voice.init()` → the speaker-restore bookkeeping never carries across agents. |
| **S3** | Low | Med | **WONTFIX (intended)** | marketplace.js | Commander decided: consent is **per-user** (global). Already behaves that way — no change. |
| **S4** | Low | Med | **WONTFIX (intended)** | build.js | Commander decided: BUILD first-use guide is **per-user** (once-ever). Already behaves that way — no change. |
| **C5** | Low | Low | **WONTFIX (intended)** | tutorial.js | Commander decided: First-Command lesson is **per-user** (once-ever). Already behaves that way — no change. |

**Scope decision (Commander, 2026-06-23):** on NEW AGENT, *behavioral/learned* state resets
per-agent (S1 task-mining, S2 curiosity → fix by reset); *one-time UI/teaching/consent*
flags stay per-user (S3/S4/C5 → no change, already correct).

## Verified-clean (do not re-audit)

Workstreams.reset (full wipe), XpStore (explicit fresh fallback + `wired` guard),
ProfileStore/DossierStore (pendingX null on WAKE → fresh; first-seed keys off the fresh
slice), StationUI.enter/leave (closes terminal windows, clears runningAgents; once-guards),
Harness fetch-hardening (`__STARNET_FETCH_HARDENED__` guard), CloudSave.installUnloadFlush
(boot-once, not per-enterGame), codexPoll (cleared on every exit), World ResizeObserver
(disconnects before re-observe), audio.js (clears its interval; self-stopping oscillators),
`stars` (seeded once), Chat.abort (aborts every per-stream controller + stops convo),
onboarding/intake stop() (clear timers/flags), Tutorial bus handlers (gated by `active`).

## Iteration log

- **Iteration 1** (2026-06-23): W1+W2+W3+W4 — the World per-agent session state (FloorStats
  economy, SlagLog, Conveyor boxes, channel queue gauge / working-lights, XP chip + one-shot
  beats). Reset at the `spawn()` seam (NOT loadStation, which also runs on a same-agent REFIT
  where the economy must persist). Verified live on a seeded station: injected spend=$0.42 +
  queueDepth=7 into NOVA → NEW AGENT "KILO" → both read 0 (and crew 0). `test:fast` green.
  Refit-preservation guaranteed by construction (reset only in spawn, never in loadStation/rederive).
- **Iteration 2** (2026-06-23): Voice cluster — V1 (Commander rule: only the orchestrator speaks;
  summoned agents silent) gated at the single `chat.js` TTS seam; C4 (`Voice.init` now cuts the
  prior agent's in-flight speech + watchdog); C3 (`forcedSpeak` reset per agent). Also recorded
  the Commander's NEW-AGENT scope decision (S1/S2 reset per-agent; S3/S4/C5 stay per-user). `test:fast` green.
- **Iteration 3** (2026-06-23): N1/N2/N3 — the channel SSE stream + connector poll used to run forever
  after a disconnect (battery/network drain from the title screen). Hoisted the handles to module scope
  and added `World.pauseBridge()` (called from `disconnect()`) / `World.resumeBridge()` (called from
  `enterGame`). Verified live across the full lifecycle: in-game {es,poll}=on → disconnect=off →
  resume=on. `test:fast` green.
- **Iteration 4** (2026-06-23): final batch. S1/S2 — `MintStore.reset()` + `CuriosityStore.reset()` drop
  their self-persisted keys, called from the NEW AGENT handler (per the Commander's scope decision);
  verified live (keys present → NEW AGENT → both null). C1 — tutorial `finished` latch reset in
  `firstCommand()`. C2 — chat `proposalRunsSeen`/`wiQDepth` cleared in `init()`. S3/S4/C5 closed as
  WONTFIX (Commander: per-user, already correct). **All ledger rows now FIXED or resolved.** `test:fast` green.

## Status: COMPLETE

Every OPEN finding is FIXED; S3/S4/C5 are WONTFIX-by-decision (per-user, already correct). The
reset-on-transition invariant holds across wake/resume/disconnect/new-agent/summon/refit for every
module audited. Re-run the discovery sweep after major new stateful features land.
