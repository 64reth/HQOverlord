# Consistency loop — verdict → correction → skill → golden test

**STATUS 2026-08-22: all four slices BUILT on `agent/momentum-loop`, each live-proved on the mock-comms seed.**
- S1 `skills(review)`: ok/miss verdict arms the review (`sidecar/verdictreview.js`); `great` never; duplicate never.
- S3 `skills(turn-in)`: review-written versions are `ask` until approved (`skillstore.js` `writtenBy` + provenance
  ask); the COMMS skill aside carries use-it / discard / read-it-first.
- S2 `skills(review)`: 90s grace; chip = non-final, next typed message = final correction, fires the review in the
  Commander's words (`POST /api/growth/ratings/correction`); the correction run is stamped `correctionOf`.
- S4 `skills(goldens)`: `great` mints a golden per loaded skill (`sidecar/skills/goldens.js`, own file);
  `npm run eval:skills` drives goldens through the real run endpoint and reports per-skill pass RATES, naming
  the model — PLUMBING ONLY when a scripted model answered, never a fake consistency claim.
- Rule Andrew set: **a `great` verdict freezes, a `miss` rewrites.**
- NOT verified (needs a live key): that a real model actually writes/patches a skill from the verdict prompt, and a
  live `eval:skills` pass rate. Both are one keyed run away; the plumbing for each is proved.
- Deviations from the plan: no `skill.proposed` event was needed — the existing `deliverable` kind:skill event +
  the gate's `withheld/guardApprovable` annotation carried the card; goldens live in `skill-goldens.json`, not on
  the skill record; golden minting reads the output off the parked review packet (run rows only carry
  `deliveryText` for session-scoped runs). Goldens attach only to skills the run LOADED (preload / skill.view) or
  the review managed — an index-only match mints nothing (honest: no skill governed that run).

**Problem (Andrew, 2026-08-21):** the same task gives different output week to week. StarNet's thesis is
that it extracts what the user wants and how; today it captures that (dossier, verdicts) but never turns a
correction into a *tested, reusable procedure*. Hermes' answer is "correction → `skill_manage` write-back".
StarNet already has most of the machinery — the lane is to CONNECT it, not build it.

## What already exists (re-grepped 2026-08-22 — do not rebuild)

| Piece | Where | Status |
| --- | --- | --- |
| Runtime agent skills (md body, per-agent, fsync'd) | `sidecar/skillstore.js`, `workspaces/skills.jsonl` | built |
| Progressive disclosure (bm25 index per run, `skill.view` to load) | `sidecar/skills/runtime.js`, inject `index.js:15384` | built |
| **Background skill review** (aux-model pass after big runs: patch/create skills) | `sidecar/skillreview.js`, `index.js:2618` | built, **not approval-gated**, fires only on ≥4 tools / ≥8 turns / ≥5000 chars |
| Skill guard + Commander approval by body digest | `skills/guard.js`, `skills/gate.js`, `POST /api/agent-skills/allow` | built |
| Run output persisted (`deliveryPrompt` 4k, `deliveryText` 24k) | `sidecar/runstore.js:213` | built — the golden substrate |
| Offline eval over the REAL loop with a scripted provider | `scripts/eval/*`, `sidecar/providers/replay.js`, deterministic grader | built — nothing evaluates skills |
| Verdict follow-up (miss → dossier belief) | `frontend/app/verdictfollowup.js` | built 08-21 |
| Task archetype classifier (7 buckets) | `frontend/app/study.js:287` | built, coarse |

**The gaps, precisely:**
1. A rated `miss` is never an input to skill review — review triggers on run *size*, not on the Commander's verdict.
2. The Commander's correction (what they type right after a miss) is not captured as a correction at all.
3. Skill writes are unreviewed; memory writes have a turn-in card, skills don't.
4. No skill has a test. A skill edit can silently regress every task it governs.

## The lane — four slices, each shippable alone

### Slice 1 — Verdict-triggered skill review (sidecar)
`skillReview.shouldReviewRun` gains a second trigger: verdict ∈ {ok, miss} on a run that loaded or matched ≥1
skill (or any run ≥2 tools). The review prompt receives the verdict + the follow-up chip (from the belief
written by `verdictfollowup.js`) + `deliveryText`, and is told: *the Commander rated this short; patch the
governing skill so the next run does not repeat it; if no skill governs this task-class, create one.*
- Ratchet test: a `miss` verdict on a small run MUST fire the review (the fail-open lesson — prove it fires).
- Done = rate a mock run `miss` → `deliverable` event `skill.patched|skill.created` within the aux budget.

### Slice 2 — Correction capture (frontend + sidecar)
After a `miss`/`ok` verdict, the NEXT Commander message within N minutes on the same stream is tagged
`correctionOf: <runId>` on RUN_META and sent to the sidecar as run context (`/api/run` body field, additive).
The skill review for the original run waits for (or is re-armed by) this correction so the patch reflects the
Commander's own words, not only a chip. Free text beats the six chips — this is the Hermes move.
- Done = rate miss → type "shorter, bullets only" → the skill body gains that instruction (prove over the
  skills API), and the correction run itself is NOT re-reviewed (no loop).

### Slice 3 — Skill turn-in (approval) — mirror the memory card
Skill review writes land as `state: proposed` (additive enum value in skillstore), emit `skill.proposed`, and
the COMMS turn-in card (the same deck memory uses, `chat.js` memory beat) shows the diff with keep/edit/discard.
Accept → `active` + allow-by-digest; discard → archived + a `declined` mark the review must honor.
- Popup law holds: the card appears only when a skill actually changed, and the answer changes station state.
- Done = propose → card → keep → skill active in the next run's index; discard → never re-proposed.

### Slice 4 — Golden tests per skill (the consistency proof)
A skill may carry `goldens[]`: `{ directive, expect: { contains[], notContains[], maxChars?, shape? } }`.
Authoring is automatic: when a run governed by a skill is rated `great`, its `deliveryPrompt` + assertions
derived from the skill's instructions become a golden candidate (Commander confirms in the same turn-in card).
`scripts/eval/skills.mjs` runs every active skill's goldens through the REAL loop with the replay provider
(deterministic) and, when a key is present, optionally a live model N× with the deterministic grader — report
pass rate per skill. A proposed skill patch (slice 3) runs its goldens BEFORE the card, and the card shows
"3/3 goldens still pass" or "breaks 1 of 3" — the Commander never accepts a regression blind.
- Done = `npm run eval:skills` prints per-skill pass/fail; a patch that breaks a golden is flagged on the card.

## Order and scope
1 → 3 → 2 → 4. Slice 1 is a day; 3 is the trust gate that makes auto-writes safe; 2 is the Hermes parity
move; 4 is the actual answer to "consistency". Each slice: pure module + test in `fast.list`, live proof on
the mock-comms seed (`Chat.awayRate` mounts the real rate control; `POST /api/agent-skills` reads the result),
`sync:website`, claims re-lock. Shared contract (`shared/events.js`) needs one additive event
(`skill.proposed`) — request from the owner, do not edit.

## Laws this lane must honor
- Only claim what the harness can prove: the card cites the run, the verdict, the golden results.
- A background pass owes a test that proves it FIRES (08-17 reflection incident).
- Popup law: no card without a consequence.
- Skills = HOW, recipes = WHAT, routines = WHEN — a skill patch never changes a recipe's inputs.
