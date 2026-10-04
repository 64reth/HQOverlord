# GROWTH LOOP — making "the agent grows with you" TRUE

Date: 2026-07-02. Owner: Fable (orchestrator). Implementation: Opus 4.8 lanes, worktree protocol per CLAUDE.md.

## Why this exists (audit verdict, 4-lens, code-cited)

A 4-agent truth audit of trunk (2026-07-02) checked the claim "agents get smarter, study the
user, autonomy improves, quests follow goals." Verdict by pillar:

| Pillar | Status | The gap |
|---|---|---|
| Memory persists + recalls | **REAL** | Notebook/trust/decay/dedup all wired into runOnce (sidecar/index.js:3264-3295, context.js:183-222). Nothing to fix here. |
| Studies the user | **PARTIAL** | Dossier = one-time intake form. Interview/curiosity fire and persist, block injected into every prompt (app.js:146, sidecar/index.js:625) — but ZERO learning from actual work. No transcript mining, no goal refresh/obsoletion. Ratings never write the dossier (autopilotstore.js:114 only biases archetype picks). Code says Phase A only (dossierstore.js:9). |
| Gets smarter over time | **PARTIAL/MISLEADING** | The user gets better understood; the agent itself doesn't grow. Feedback only reshuffles memory ranking (context.js:211 `score += 0.3*trust`). |
| Autonomy improves | **MISSING** | Zero code path from performance to Initiative/Reach. Dial is user-set only (autonomy.js:91-97, stationui.js:2327). Autopilot's cold/warm/hot tier gates THIS idle cycle only, never persists an earned escalation (autopilot.js:105-119). XP/level explicitly "describe, never gate" (xp.js:1-14) — level has no mechanical consumer. |
| Quests follow goals | **PARTIAL→MISSING** | Sources are honest (real work/gaps/dossier blanks). Pitch/suggestions REQUIRE goals known (pitch.js:35) and gate on familiarity GROWTH (suggeststore.js:106) — good. But goals are flat belief strings; NO decomposition, NO progression/arc, NO progress meter; quest completion fires SFX+toast and feeds back NOTHING (queststatestore.js:54-65). |

One-line diagnosis: **every store exists and is honest; the connective tissue is missing.**
Nothing turns work → understanding, understanding → direction, or track record → trust.

## Design laws (locked, from Andrew's prior decisions)

1. **Consent, not silent escalation.** Autonomy is EARNED as an OFFER the Commander accepts
   with one tap (matches memory-overhaul decision "always-confirm-but-rarer" + Stage B
   grant model). Never silently raise the dial.
2. **Ask budget is driven by work, not clock.** All new proactive asks ride the existing
   single post-run beat slot. New priority order:
   `turn-in → arc-step → autonomy-offer → suggestion → seed → curiosity`. One ask per task,
   session caps kept.
3. **Honest telemetry.** Every earned thing shows provenance ("earned free-range 2026-07-02
   after 45 trusted runs"). No fake progress.
4. **Additive-only** to shared/events.js / shared/schema.js — new events must be REQUESTED
   from the cortex-memory owner, never edited directly. Proposed new events:
   `goal.created`, `goal.step.done`, `goal.progress`, `study.proposal`, `autonomy.offer`,
   `autonomy.earned`, `autonomy.demoted`.
5. **Pure engine + store wiring + test** per house style; `npm run test:fast` green before merge.
6. **Reuse, don't rebuild:** reflect.js salience gate + aux-model call, mint.js skeleton
   detector, confidence EWMA (xp.js:174), beat arbitration, turn-in consent UI.

## Tiers (build order — sequential merges, one worktree each)

### Tier 1 — STUDY ENGINE (work → understanding)
The dossier's missing Phase B. After salient runs (reuse reflect.js gate + cooldown), an aux
call reads the run's directive/transcript slice + existing dossier block and proposes
**dossier belief updates** tagged by dimension: observed goals, new pain, stack facts, style
("prefers terse answers"), plus **drift/obsoletion** ("goal X looks shipped — retire it?").
- Proposals route through the SAME turn-in consent beat (Keep/Edit/Discard), with the
  memory-overhaul negative-state rules: discard = permanent denylist, ignore 2x = stop.
- Ratings write back: N consecutive 👍 on an archetype mints a style/taste belief proposal.
- New: `frontend/app/study.js` (pure) + `studystore.js` (wiring) + sidecar hook next to the
  reflect call (sidecar/index.js:3353-3367 area). Test: study.test.js.
- Dossier beliefs gain `observedAt`/`source:'study'` provenance; panel shows it.

### Tier 2 — GOAL MODEL + QUEST ARCS (understanding → direction)
Upgrade goals from flat strings to a structured, persisted goal tree.
- `frontend/app/goals.js` (pure) + `goalstore.js`: goal {id, text, status, milestones[3-5]
  {id, text, status, questRef, evidence}, progress}. Persisted in save envelope + sidecar
  mirror like dossier.
- Seeding: when a goal belief exists, agent decomposes it (LLM, reuse pitch directive path)
  into milestones and presents ONE confirm beat ("here's the path I see — good?"). Edited/
  confirmed tree persists. Re-decomposition offered only when Study Engine detects drift.
- Quest projection (quests.js build()) gains an ARC source: the next open milestone of the
  active goal surfaces as a quest. Completing its work quest → milestone done → progress
  advances → NEXT step quest surfaces (real chaining, not one-shot).
- Quest completion finally feeds back: arc-step done writes evidence to the goal node,
  bumps Study Engine salience, and suggestion gating can use goal-progress (not just
  familiarity growth).
- QUEST LOG UI: goal header with progress meter; steps grouped under it. Honest: progress
  = milestones done / total, nothing synthetic.

### Tier 3 — EARNED AUTONOMY (track record → trust)
Give level and confidence mechanical teeth via consent-gated offers.
- `frontend/app/trust.js` (pure): rolling track record from existing counters + confidence
  EWMA (success rate, positive-feedback streak, runs at current rung). Thresholds mint an
  **autonomy offer** (one-tap beat): raise Initiative one rung, or pre-bless a GRANTABLE
  (cabinet:write) — never past the user's stated ceiling, never reach-out.
- Accept → AutonomyStore/permgrants updated WITH provenance record; dial UI shows an
  "EARNED" badge + history. Decline/ignore obeys negative-state rules.
- Demotion: sustained negative feedback / failed-run streak lowers the earned rung back
  (with a notice) — trust is bidirectional, matching trust-decay philosophy.
- Level's first real consumer: offers can only fire at level thresholds (e.g. L3 first
  initiative offer, L5 grant offers). XP keeps its "describe" purity — the OFFER is gated,
  the capability still needs Commander consent.

### Tier 4 — BALANCE PASS (the "perfect balance" ask)
- Beat arbitration extended to the 6-way priority above; global anti-nag audit (one ask per
  task end-to-end across ALL engines — write a chained test proving no double-beat).
- Pacing sanity: Study proposals capped (per-day), arc steps never nag (they sit in QUEST
  LOG, only the confirm beats speak), autonomy offers rare by construction (thresholds).
- Attended soak checklist + a headless script asserting beat-slot exclusivity.

## Merge gates
Each tier: Opus builds in its own worktree (agent/growth-t1 …), adversarial review sweep,
`npm run test:fast` green, Fable merges to feat/harness-backend, next tier branches after.
