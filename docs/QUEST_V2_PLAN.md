# QUEST SYSTEM V2 — the harness-owned, agent-aware quest ledger

**Status:** SHIPPED — merged to trunk 2026-07-08 (41cd1d01), test:fast 274 + test:http green, real-provider
proven (haiku-4.5: grounded mint + capped second mint + attest held open until Commander confirm).
Open follow-up: additive `quest.new`/`quest.progress`/`quest.complete` events from the shared-contract owner.
**Why:** quests are the retention spine — the game's progression must be in sync with the Commander's
real-world progression (goals, aspirations, work to automate). The v1 system fails this in two ways:
completions celebrate unreliably (or silently), and every quest that isn't mechanically observable
(prop placed / run ended) is architecturally uncompletable — the agent cannot see or update quests at all.

## The v1 truth (verified 2026-07-08)

- Quests are a **frontend-only read projection** (frontend/app/quests.js + queststore.js + four generator
  stores). The sidecar has ZERO quest code. No `quest.*` events exist.
- Completion = polled status diff (queststate.js fold open→done) → celebrate() (SFX + toast + row flash +
  COMMS line). Three reliability holes: the 1s tick (stationui.js tick()) syncs only 2 of 4 stores
  (work/maint completions can sit undetected until the log opens, then backfill SILENTLY); the row flash
  is a no-op when the log is closed; the COMMS line shares a 3s coalesce window with level-up/trophy
  broadcasts and gets silently dropped.
- "User-based" quests are thin: dossier quests are a static per-dimension checklist; the "idea waiting"
  quest is a transient flag behind heavy gating; work quests mint only on an explicit "build it" and
  complete only via the bound run ending.
- The agent has no quest visibility: nothing in the system prompt, no tool. Asking an agent about a quest
  can never work in v1.

## Locked design laws (carried forward — do not violate)

1. **Truthful telemetry.** A quest never completes on an unproven claim. No claim button for the user;
   no self-serve completion for the agent.
2. **No XP from quests.** The payout is the real capability/outcome + celebration. XP flows only from
   rating real work (xp.js law).
3. **No gating.** The quest log reveals order of progress; it never locks anything.
4. **Dismiss = stop forever** (anti-nag). And v2 extends dismissibility to EVERY quest kind (GB-24).
5. **States, not events.** The frontend renders harness STATE. Phase 1 adds no `shared/events.js`
   entries; the ledger syncs by poll. `quest.new`/`quest.complete`/`quest.progress` contract events are a
   LATER additive request to the events owner (cortex-memory workstream) — flagged at merge, not edited here.

## The v2 architecture

### A. Backend quest ledger (sidecar/quest-store.js)

Station-wide durable store `_station.quests.json` under WORKSPACES, built on makeDurableJsonStore
(crash-safe, mutexed — the workshop-store.js idiom, pure + node-testable, caller-injected clock).

Quest record:

```
{
  id: 'q:<seq>',
  title, desc, reward,            // prose; reward names the REAL outcome, never points
  kind: 'generated' | 'work' | 'user',
  createdBy: 'agent:<agentId>' | 'system' | 'user',
  agentId,                        // owning agent (for prompt injection scoping), nullable = station-wide
  contract: { type: 'prop'|'run'|'fact'|'artifact'|'attest', key: <string> },
  steps: [ { key, label, done, note? } ],   // optional; empty = single implicit step
  status: 'open' | 'done' | 'dismissed',
  attest: null | { agentId, runId, evidence, at, confirmed: null },  // pending Commander confirm
  declineNote: null | { at, note },         // last declined attest — agent sees this next run
  createdAt, completedAt, dismissedAt
}
```

**THE CONTRACT RULE (the heart of v2):** a quest CANNOT be minted without a valid completion contract.
No contract → mint rejected. This permanently eliminates the "sits there forever, uncompletable" class.

Contract types and who flips them:
- `prop:<capability>` — completed by the harness when the capability goes live (existing station-gap signal).
- `run:<binding>` — completed when the bound run ends `done` (existing work-quest signal; non-done → stall).
- `fact:<dossier-dim|memory-key>` — completed when the dossier/cortex provably learns the key.
- `artifact:<check>` — completed when the named deliverable exists (workshop manifest truth).
- `attest` — the agent PROPOSES completion with evidence (via the quest tool); the Commander confirms
  with the existing rate-the-work beat. Agent claim alone NEVER completes. Confirm → done. Decline →
  attest cleared, declineNote stamped, quest stays open.

Store API (pure): mint (contract-enforced, title-deduped vs open + deniedTitles), tickStep, bindRun,
completeByContract(type,key) (mechanical sweeps), attest, confirmAttest(ok), dismiss (stamps deniedTitles),
list, openForAgent(agentId). Caps: ≤3 open `generated` quests per agent, backlog-style FIFO caps.

Routes (index.js, apiauth like siblings):
- `GET  /api/quests`                  — full ledger (frontend polls this on the existing 1s tick cadence)
- `POST /api/quests/mint`             — {title, desc?, reward?, contract, steps?, agentId?} (contract enforced)
- `POST /api/quests/update`           — {id, op:'tick'|'attest', stepKey?, evidence?}
- `POST /api/quests/confirm`          — {id, ok:bool, note?} (Commander only — the attest verdict)
- `POST /api/quests/dismiss`          — {id}

### B. Agent awareness

- **Prompt block:** `sidecar/questinject.js` (pure, the dossierinject.js idiom): folds the agent's open
  quests into the system prompt as a `STATION QUESTS` block — id, title, next open step, contract type,
  any declineNote. Wired everywhere the dossier block rides (browser-composed + server-composed cron runs).
  Empty ledger → byte-identical prompt (the no-op invariant).
- **Tool:** `sidecar/tools/builtin/quests.js` → `quest.update` (registry idiom of orchestration.js).
  Ops: `progress` (tick a named step, with a note) and `attest_complete` (evidence REQUIRED — sets the
  pending attest, never completes). Mechanical-contract quests (`prop`/`run`/`fact`/`artifact`) reject
  `attest_complete` — their completion stays machine-owned. Also op `mint` (for lane 5's generative
  minting) — same contract enforcement as the route.

### C. Frontend join (QUEST LOG v2)

- Ledger quests are fetched on the 1s tick and merged into the existing Quests.build projection (new
  splice input, absent-input → unchanged, matching the established additive pattern). They flow through
  the SAME queststate.js fold → the existing celebrate() path (sound/toast/COMMS) fires for them free.
- **Every row answers "what do I do next":** a `✓ completes when: <contract, in words>` line + live step
  progress. Kinds with a destination get a **GO** action (open recruit bay / agent / workshop queue).
- **Attest confirm beat:** a pending attest renders as the one-post-run-beat card family in COMMS —
  "⚑ <agent> reports this quest complete — <evidence>" with Confirm ✓ / Not yet. Verdict POSTs
  /api/quests/confirm. This reuses the decided-cards-must-vanish COMMS beat rules.
- **Dismiss everywhere** (GB-24): every kind gets the two-step arm/confirm dismiss; ledger dismissals go
  to the backend denylist; v1 kinds keep their per-store denylists.

### D. Reliability fixes (v1 celebration, still needed under v2)

1. The 1s tick syncs ALL FOUR v1 stores (add WorkQuestStore + MaintQuestStore) + the ledger fetch.
2. Quest COMMS lines get a short queue instead of being dropped by the 3s celebration coalesce
   (drain in order, still rate-limited — never silently lost).
3. Silent backfill (first-seen-already-done) still celebrates once if it happened this session
   (completedAt within the session's boot window) — never a missed completion for an away-completed quest;
   the persistent notify record is the receipt.

### E. Generative minting (the "harness learns you → new quests" story)

After reflection / on the existing post-run beat cadence (shares the one-beat arbiter — never stacks),
the agent — which already carries the dossier + contextpack in its prompt — mints up to N personalized
quests via `quest.update` op:`mint`, each FORCED to declare a contract (attest allowed). Guardrails:
≤3 open generated per agent, title-dedup vs open + denied, dismissed = permanent deniedTitles entry.
Grounding rule (contextpack law): a minted quest must cite which dossier/memory fact motivated it
(`groundedIn` field) — no generic busywork.

## Lanes

- **Lane 1 (frontend, independent):** reliability fixes D1–D3. Files: stationui.js, chat.js,
  queststatestore.js.
- **Lane 2 (backend, independent):** quest-store.js + routes + node tests (A).
- **Lane 3 (backend, after 2):** questinject.js + quest.update tool + prompt wiring (B).
- **Lane 4 (frontend, after 2, parallel with 3):** ledger merge + row legibility + GO + attest beat +
  dismiss-everywhere (C).
- **Lane 5 (after 3+4):** generative minting cadence + guardrails (E).
- **At merge:** request `quest.*` additive events from the events owner; wire celebrate() to them later.

Gate: `npm run test:fast` green + live-app proof per starnet-verify (mint→see row→attest→confirm→celebrate,
plus a work-quest completing with the log CLOSED and celebrating within 1s).
