# Task Brief v2 — surfacing the recommendation, honest fallback, recipe intake

Plan date: 2026-07-16 · branch `claude/starnet-context-extraction-a06d70`
Baseline: the Task Brief / intent-elicitation layer merged via `agent/briefing-reliability`
(store + policy + tools + mutation gate + COMMS chips + channel fallback + patterns).
Grep before building — every claim below was re-proven against trunk on the plan date.

## Why (the three findings this fixes)

1. **The recommendation is computed, stored, and never shown.** `brief.ask` demands
   `recommended` + `reason` (taskbrief-policy.js), the store persists them, and the COMMS
   chips (`offerTaskQuestion`, chat.js ~2588) render only question + bare options. The
   single highest-leverage part of a validated question — "I'd pick B, because X, one tap
   to accept" — is discarded.
2. **The raw-marker fallback fabricates validation.** When the model asks via the
   `TASK_QUESTION:` text marker instead of `brief_ask`, index.js (~7725) retro-stamps
   `dimension:'scope'`, `recommended: options[0]`, `discoverable:false`, canned reason.
   The fabricated `scope` dimension pollutes `patterns()` (binned by dimension), and a
   fake recommendation would now be SHOWN by fix #1 — so #2 must land with/before #1.
3. **No preconfiguration.** The doctrine is generic; nothing lets a task TYPE pre-declare
   its material decisions. Recipes already carry `params` (a launch-time intake form) and
   `recipeId` already rides `handleRun → runOnce → runStore` — the spine exists.

Plus (4) pattern bins over-generalize (dimension-only key), folded into Lane B.
(5) — the `clarifying → 'cancelled'` end-reason overload — is an owner request, not code
here (see Lane D).

## Ground-truth map (verified seams)

- Marker + doctrine: `frontend/app/fork.js` (`TaskIntent`, shared browser+node, SHIPPED).
- Store/policy/tools: `sidecar/taskbrief-store.js`, `taskbrief-policy.js`,
  `taskbrief-tools.js`; composer `sidecar/commander-context.js`.
- Run host wiring: `sidecar/index.js` ~6834 (taskKey), ~7011 (prepare), ~7400 (gate),
  ~7614 (directive), ~7714 (settle: parse marker → ask/complete), ~7733 (buffered end).
- COMMS: `frontend/app/chat.js` — `offerTaskQuestion` (~2588), run-end parse (~4982),
  `restoreTaskQuestion` (~843, already fetches the durable brief with recommended/reason).
- Channels: `sidecar/channels/hub.js` ~505 (numbered-list fallback).
- Recipes: `frontend/app/recipe-catalog/*.js` (pure data, UMD — requireable under node),
  `recipeId` whitelisted in handleRun (~6692).
- Settle order guarantees the store write lands BEFORE the buffered `agent.run.end` is
  emitted — so a client fetch of the brief after `done` always sees the question.

## Lane A — show the recommendation (UX payoff)

**A1 (sidecar, none-to-tiny):** none needed for data — the durable brief already carries
`recommended` + `reason` per question and `/api/task-briefs` already serves it.

**A2 (chat.js):** at run-end, when `TaskIntent.parse` hits, fetch the clarifying brief
(same call `restoreTaskQuestion` makes) and pass `recommended` + `reason` into
`offerTaskQuestion`. Falls back to marker-only data if the fetch fails (offline sidecar =
today's behavior, never a broken chip row). `restoreTaskQuestion` passes them too (it has
the brief in hand already).

**A3 (chat.js render):** `offerTaskQuestion` marks the recommended chip (distinct class,
e.g. `choice-suggested`, gold outline + `★` prefix — reuse existing choice/turnin
vocabulary, no new palette) and renders `reason` as a small sub-line under the question
row. Only when `recommended` is non-empty AND matches an option (post-Lane-B honesty:
marker-path questions have empty recommended and render exactly as today).

**A4 (hub.js):** channel fallback appends `suggested: <X> — <reason>` when the active
brief's pending question carries a real recommendation. Hub needs read access to the
brief: pass `taskBriefStore.active` in as an additive dep (hub already receives a deps
bag); key is `channel:<channel>:<chatId>` which hub constructs itself.

Frontend-law + verify: chips are DOM (not canvas) — verify via live DOM round-trip.

## Lane B — honest fallback + sharper patterns (correctness)

**B1 (store):** add an explicit relaxed entry path for marker-asked questions —
`store.ask(id, q, now, { source: 'marker' })` which bypasses `validateQuestion` but
stamps `dimension: ''`, `recommended: ''`, `reason: ''` (nothing fabricated). Question
budget still enforced (count-based, same as today’s newBlocker check). `normalizeQuestion`
already tolerates empty fields.

**B2 (index.js ~7725):** the settle path stops fabricating — call the relaxed path with
only what the marker actually said. Net behavior: marker questions still persist/restore/
route answers exactly as today; they just stop masquerading as validated.

**B3 (patterns):** bin key becomes `dimension + '::' + fingerprintQuestion(text)` (both,
not either) so (a) marker questions with empty dimension still bin by text, and (b) two
different audience questions with the same answer no longer merge. Threshold/count
semantics unchanged. This resets accumulated pattern bins — acceptable: patterns are
labelled weak, capped at 5, and re-earn within two repeats.

**B4 (tests):** taskintent.test.js — update the retro-stamp source-guards (they pin the
current fabrication strings), add: marker-path question persists with empty
dimension/recommended; patterns exclude/rebin correctly; A-lane guards (suggested chip
renders only with non-empty recommended; hub suggested line).

## Lane C — recipe intake (the preconfiguration lane)

**C1 (catalog schema, pure data, additive):** recipes may declare
```js
intake: [
  { dimension: 'audience',              // must be one of taskbrief-policy DIMENSIONS
    question: 'Who reads this?',        // optional launch-time phrasing
    options: ['operators','executives'],// optional preset chips
    recommended: 'operators',
    reason: 'changes density + nav' }
]
```
Start by authoring intake for ~6 flagship recipes (literature-review, feed-watch,
competitor-tracking, one creator, one ops, one dev) — enough to prove the loop, not a
catalog-wide sweep.

**C2 (launch-time preconfiguration — the flagship):** the recipe launch form renders
intake entries as one-tap chip rows alongside text params (recommended chip pre-marked;
"use your judgment" skip). Answers substitute into the task text like params do (append a
`Decisions: audience => operators` block to the composed task). Result: the question is
answered BEFORE the run starts — zero mid-run interruption, which is the actual
"preconfigured to ask the right question" vision.

**C3 (sidecar awareness):** require the catalog aggregator under node (UMD pattern,
same as fork.js), map `recipeId → intake`. When `o.recipeId` has intake, append a bounded
`<recipe_intake>` block to `taskContextBlock` via commander-context: the material
dimensions for this task type + presets, with the doctrine line "resolve THESE (from the
launch answers, dossier, or one question) before proceeding; default everything else."
So even when the user skips the launch chips, the mid-run question arrives pre-aimed at
the right dimension instead of model-improvised.

**C4 (tests):** catalog lint (intake dimensions ⊆ policy DIMENSIONS, recommended ∈
options), composer includes `<recipe_intake>` only when the recipe declares it, launch
answers reach the task text.

Scope guard: NO new body fields through handleRun (whitelist trap) — launch answers ride
inside the existing task text; sidecar intake mapping keys off the already-whitelisted
`recipeId`. No dossier writes. No gating (skip always available).

## Lane D — `clarifying` end-reason (owner request, not code)

The frozen contract maps a clarifying turn to `reason:'cancelled'` (buffered emit,
index.js ~7733). Correct fix is an additive `'clarifying'` reason in `shared/events.js` —
owned by the cortex-memory workstream. Action: file the request with the owner; do NOT
edit shared/. Until granted, the overload stays (it is tested and rendered honestly).
When granted: flip the buffered-emit mapping, teach chat.js/telemetry/quest sweeps the
new reason, update the contract-safety source-guards.

## Order, slices, gates

1. **B** first (B1→B4) — Lane A must never display a fabricated recommendation.
2. **A** (A2→A3→A4) — visible payoff; each slice live-verified before the next.
3. **C** (C1→C2→C3→C4) — independent of A/B except it reuses A3's suggested-chip render.
4. **D** — request filed anytime; code only after the owner ships the contract addition.

Per slice: smallest verifiable change → live verify → commit (pathspecs only) → next.
`npm run test:fast` green before merge; merge via starnet-merge-ritual.

## Verify plan (starnet-verify)

- Live: dev-seeded app (`npm start`), give a deliberately underspecified task on a fresh
  stream → observe ⌖ question with ★ suggested chip + reason sub-line; tap suggested →
  run continues and completes; DECISION line lands in `/api/task-briefs`.
- Restart mid-question → reload → chip re-presents WITH suggestion (restore path).
- Marker-path (kill the tool path in a dev run or fixture) → chip renders with NO
  suggested marking; stored question has empty dimension/recommended.
- Recipe: launch literature-review → intake chips at launch → answer → task text carries
  the decision; run does NOT re-ask it. Skip the chips → mid-run question (if any) names
  the declared dimension.
- Channel: hub fallback string includes the suggested line (unit + source-guard; live
  Slack pass only if a token is configured).
- Gate: `npm run test:fast` fully green.

## Traps (from MISTAKES.md + memory — will bite if ignored)

- **Shipped-surface change ⇒ committed W0 re-stamp** (chat.js, fork.js, recipes, css are
  shipped). Re-stamp IN-BRANCH, AFTER the content commits, never amend a stamp commit.
- taskintent.test.js **source-guards pin exact strings** in index.js/chat.js/hub.js —
  update guards in the same commit as the seam they pin.
- claims.json needle edits: utf-8 + LF + exact shipped-copy needles.
- `handleRun` whitelists body fields — do not add fields; ride recipeId + task text.
- fork.js is the shared browser+node module — keep UMD shape; marker format is frozen
  (parse compat both directions).
- Tools resolve `{ok:false}`, never reject.
- No static tags outside frontend/ (recipe intake stays pure data in the catalog).

## Explicitly out of scope

- Editing `shared/events.js` / `shared/schema.js` (owned; Lane D is a request).
- Catalog-wide intake authoring (flagship ~6 recipes only this pass).
- Any change to the two-question budget or the mutation gate semantics.
- Dossier writes from task answers (locked separation stays).
