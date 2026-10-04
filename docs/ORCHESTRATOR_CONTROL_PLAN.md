# Orchestrator control lane (`agent/orchestrator-control`)

Goal: agents that (a) **understand StarNet** so they can help a stuck Commander, and (b) let the
**orchestrator actually control StarNet live** — summon/equip crew and hand them work, exactly as
the Commander would. Locked decisions: APPROVAL-mode-gated authority; orchestrator/lead-only actuates;
all agents get the knowledge.

## Shipped (committed on this branch, green on `test:fast` + `test:http`)

- **M1 — Operator manual.** `sidecar/manual.js` (pure, deterministic) injected into every *interactive*
  system prompt right before `<capabilities_ground_truth>` (which it defers to, so it never over-promises).
  Navigation + object=capability map (real CAP_LABEL vocabulary) + APPROVAL mode + troubleshooting.
  Test: `test/manual.test.js`.
- **M2 — `team.summon` round-trip.** The lead calls `team.summon` → backend emits `crew.summon.request`
  on the run stream (added additively to `shared/events.js`) → the browser runs the real Recruitment-Bay
  `summonAgent()` → POSTs `/api/summon/ack` with the new agentId → the tool resolves. Modeled exactly on
  the consent prompt (`ctx.summon` closure in `handleRun`, abort/timeout/finally backstops). `requiresConsent`
  gives the APPROVAL beat for free. `App.summonForRequest` awaits the roster push before acking (no dispatch race).
- **M3 — Usable + proven.** Lead's `[ORCHESTRATION]` prompt now always surfaces `team.summon` (+ lists crew
  for `team.dispatch`); APPROVAL confirm reads "summon a new agent onto the crew". `test/e2e.summon.test.js`
  boots the REAL sidecar against a mock OpenRouter, makes the lead call `team.summon`, acts as the browser,
  and asserts the new id flows back into the model's next request. No real model/browser/spend.

- **M4 — Workers = same access as the orchestrator** (Andrew's call). CONSTRAINT (permissions.js:88-97): an
  *autonomous* run is hard-blocked from shell (exec lockout) and writes (silence-isn't-consent) unless Full
  Access. Fix: each delegated/summoned worker now SHARES the lead's consent broker (`runOnce`:
  `const consent = o.consent || makeConsentBroker(...)`) and is handed the `workbench`. Full-auto lead →
  workers act freely; APPROVAL lead → a worker's write/shell prompts the WATCHED lead; headless cron lead →
  workers inherit autonomous default-deny (no self-approved shell). Workers still don't get the orchestrator
  object (no nested re-delegation; depth stays 1). Proof: `test/e2e.worker-access.test.js` — a full-access
  lead's worker performs a consent-gated `fs.write` that lands on disk.

Branch is rebased onto trunk (absorbed the COMMS interrupt/inline-media work) and green on `test:fast` +
`test:http`. **Ready to merge.**

## Open

- **M5 — Equip-visual.** Show the summoned worker's capability props on its floor (object=capability truth).
  Touches `world.js`/`worldmodel.js` — the repo's most contended files (summon-fixes / world-game /
  workstation-ui are live there). **Coordinate with that lane; do not duplicate.**

## Coordination

- Backend-heavy by design: the round-trip touches `world.js` **zero** times; `app.js` only additively.
- `shared/events.js` is `cortex-memory`-owned, additive-only — `crew.summon.request` is a new key only
  (consistent with how other lanes extend it). Notify the owner on merge.
- Rebase (`sync-agent-tree.ps1 orchestrator-control`) before merging to trunk.
