# Dogfood shift log

Dated entry per dogfood shift (`loops/dogfood.md`). One agent USES StarNet like a real user and
files every anomaly. Verdict line = did the station survive being used? Silence is
indistinguishable from a dead session — an entry is written every shift, clean or not.

**Provider legend:** `real` = live provider key (the coverage that matters — model behaviour,
cost, long-turn timeouts). `mock` = in-process mock OpenRouter (proves seams only: dispatch
wiring, taskboard truth, restart durability). A `mock` shift NEVER counts as real-provider
coverage.

---

## 2026-07-07T23:38Z · trunk e01831ab (agent/dogfood) · provider: mock
- **proof shift** — abbreviated, run to prove `loops/dogfood.md` is executable, not aspirational.
  Driver: `dogfood-proof.mjs` (scratchpad), in-process mock OpenRouter on a random port →
  real `sidecar/index.js` on **:8970** with the golden seed workspace (`SKYNET_DEV=1` +
  `SKYNET_FULL_ACCESS=1`). Verified via HTTP/DOM truth reads, no screenshots (canvas gotcha).
- steps: recruit ✓ · assign ✓ · watch ✓ · interrupt (halt) ✓ · dispatch skipped · open skipped · channel skipped · restart ✓ · diagnostics ✓
  - **recruit** — `POST /api/roster` (hero + new agent `dogtest`) → `200 {ok:true,count:2}`.
  - **assign** — `POST /api/run` (`agentId:dogtest`, `isTask:true`) → `200`, streamed NDJSON.
  - **watch** — first byte 1 ms; events `agent.run.start` → `agent.token` → `agent.run.end`.
  - **interrupt** — `POST /api/halt` fired mid-run @ 541 ms; the run truthfully ended
    `reason:"cancelled"` after only 3 tokens (the UI/stream did NOT claim it finished — this is
    the truthful-telemetry contract holding under interruption).
  - **restart** — sidecar SIGKILL'd + relaunched on the same workspace; recruited agent
    `dogtest` survived (`agent.roster.json` on disk = `["agent","dogtest"]`); the cancelled-run
    record persisted into `/api/diagnostics` after restart (`lastRun status:"cancelled"` — the
    EL-6 diag-persistence fix confirmed live).
  - **diagnostics** — reported the real build (`app 0.3.0`, `mode browser`, `agentCount 2`,
    `keyPresent true`, `errors []`); `mode browser` / real version are correct for npm-start
    (the `version:unknown` bug is a packaged-desktop-only origin case, not seen here).
- anomalies filed: none (clean seam shift).
- evidence: `scratchpad/dogfood-evidence/` — `run-stream.ndjson` (the cancelled run),
  `diagnostics-after.txt` (state survived restart), `results.json`, `shift-log.txt`.
- verdict: **SURVIVED being used (seams) — 0 anomalies · mock.** Proves the loop is runnable
  end to end. NOT real-provider coverage: model behaviour, token/cost accuracy, long-turn
  (>5 min) timeout decay, cross-provider dispatch 400s (EL-6), and channel-secret durability
  (EL-5) still need a `real` shift with a live key — and a soak shift on the INSTALLED exe.
