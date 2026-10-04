# PLAN — Recommendation Perfection Campaign (W3 → W1 → W2)

**Mandate (Andrew, 2026-08-05):** the recommendation system is StarNet's differentiator —
"the absolute best recommendations that use the context from memory… the most perfect
standard possible," across every recommendation surface. Builds on the merged spine
(`docs/PLAN_RECOMMENDATION_SPINE.md`) and quality loop (`docs/PLAN_REC_QUALITY_LOOP.md`).
Grounded in three file:line audits (2026-08-05, static reads of trunk).

## The two root causes (audit-verified)

1. **Two recommendation memories that never talk.** The durable cross-surface ledger
   (`sidecar/recommendation-ledger.js` — read by quests `index.js:5733`, scout `:4207`,
   night shift `:3932`, FOR YOU `recipes.js:807-817`, recruiter `recruiter.js:79-89`) and
   the browser quality EWMA (`frontend/app/recqualitystore.js` — read ONLY by `chat.js`).
   The spine never reads the ledger (zero `/api/recommendations`/`preferenceModel` refs in
   chat.js); the shelves never read quality. Only autojobstore/prospectstore/studystore/
   suggeststore write the ledger — the other 8 channels' declines die in localStorage.
2. **`internal:true` starves the generators.** `sidecar/index.js:10860`: internal aux runs
   skip `commanderEvidenceContext` (`commander-context.js:11-84` — topics WITH verbatim
   quotes, open threads, verdict patterns, recent activity, active goal, deferred
   dimensions), memory recall (`:12417`), and transcript (`:12404`). Ordinary task runs get
   all of it; every recommendation generator (suggest `suggeststore.js:180`, pitch
   `pitchstore.js:106/208`, goals `goalstore.js:181`, autojobs) gets only the static
   dossier block. The five gentle channels read exclusively browser-local state.

## W3 — TRUTH & CONSISTENCY (this lane, `agent/rec-perfect-w3`)

Small, surgical, each item independently verifiable. Kill every dishonest citation and
cross-surface inconsistency the audits confirmed.

1. **One goal matcher.** `recipes.js:686-703` (`goalKeywordHits` — word-wise + suffix set +
   stoplist + readable-text haystack) is the corrected one. Export it; replace the three
   divergent substring matchers: `marketplace.js:1252-1260` (`specGoalHits` — haystack still
   includes `Object.keys(s.tags)`, quotes substring artifacts as `"matches your goal:
   'general'"` at `:1302`), `recruiter.js:53-61` (no stoplist), `recipefit.js:218-221`.
   The merge note at `recipes.js:706-711` recorded this unification as intended.
2. **Autojobs grounding veto.** `autojobs.js:156` accepts any non-empty `GROUNDS:` —
   presence-only, so invented grounds become scheduled cron jobs shown as "the exact thing
   you know". Copy the real token-overlap veto from `autopilot.js:361` (`grounded()` over
   beliefs ∪ activity ∪ threads). No grounding → drop the draft.
3. **One card grammar on the shelves.** `whyGrammar()` (`marketplace.js:1223-1227`) exists
   and the two recruiter shelves bypass it (`:1349`, `:1368` render raw `it.why`); shelf
   headers use four different glyphs and never name the noticer (vs the COMMS
   `◈ <NAME> NOTICED`). Route both shelves through whyGrammar; unify headers to the
   `◈ <NAME> NOTICED` family (keep shelf-appropriate phrasing, one glyph).
4. **Quote the interest evidence.** `topicmatch.js:128-135` `reason()` renders
   "you keep working on X (seen N×)" while `match()` already carries up to 3 verbatim
   user quotes (`:106`, sourced from `sidecar/interests.js` whose own header LAW says
   downstream may only cite THIS evidence). When `top.evidence[0]` exists, render
   `because you said "<quote>"` (via `Recommend.whyLine` conventions). This upgrades FOR
   YOU + specialist shelf + gap shelf at once.
5. **Recruit strength stops being thrown away.** `recruiter.js:155` computes a real
   confidence, `recruiterstore.js:114` carries it, `chat.js:4825-4832` drops it. Pass it as
   the candidate's `strength` (0..1) — the spine already consumes it honestly.
6. **Honest FOR YOU header.** `marketplace.js:1450` prints the personalized `◈ FOR YOU`
   header even when every card came from `categorySpread` (`recipes.js:851-855`) — a
   cold-start spread asserts nothing about the user. Detect the spread fallback and show
   the honest "STARTING POINTS"-style header instead.
7. **Seed→routine dead end.** `seedstore.js` save → `Recipes.draft` → `cadence: null`
   (`recipes.js:424`); `routinenudgestore.js pick()` skips `!r.cadence` — an agent-authored
   seed can NEVER earn "you've launched this 8× — schedule it?". Fix: relax the pick gate to
   any recipe with ≥N real hand-launches (N=3, from the real launch counters), cadence
   suggestion derived honestly (e.g. from launch spacing if computable, else a sensible
   default the user confirms).
8. **Night shift consults the declined index.** `index.js:4536-4546` goes parseCandidates →
   scoreAndSelect → record with no `buildDeclinedIndex` read (5 other sites consult it).
   Insert the check before scoreAndSelect.
9. **Retryable fit caches.** `marketplace.js:1484,1500` — `.catch` assigns `[]` (truthy) so
   one transient `/api/projects` hiccup permanently kills the READY shelf this session; the
   SAME FILE documents this exact fix for skillCatalog at `:205-213`. Make failures
   retryable + invalidate on grant/connect.
10. **Prospect shown-row inflation.** `prospectstore.js:32,128-130` `recommendationIds` is
    in-memory → every reload re-mints `shown` ledger rows for the same shelf items,
    permanently depressing acceptanceRate. Persist the shown-fingerprint set (bounded FIFO).
11. **Exclusion lists into the prompts that dedup post-hoc.** `suggeststore.js:178` (pass
    recent+declined titles into the directive), `reflect.js` (pass existing memory gists —
    currently Jaccard-filtered only AFTER the paid call re-proposes known beliefs),
    `threadmine.js` (pass known fingerprints — already fetched at `index.js:2000`). Scout/
    questrefresh/prospect/autojobs already do this; these three burn paid calls without it.
12. **Suggest displayed-why honesty (the D1/D2 minimum).** Do NOT ship the full W2 evidence
    contract here, but stop the active dishonesty now: the nudge line renders
    `parsed.why` (free-form model prose) and `suggeststore.js:203` posts it to the ledger as
    `evidence[{type:'context', quote: parsed.why}]`. Minimum fix: the ledger entry's
    evidence must be typed honestly (model-authored rationale, NOT quote-typed evidence —
    e.g. type:'rationale', never `quote:`), and the displayed line keeps the model text but
    drops any framing implying the user said it. Full grounding contract lands in W2.

Each item: verify against current code first (lines may have drifted), smallest slice,
tests (unit + source-locks where the repo style demands), fast.list registration for any
new suite, sync:website riding every frontend commit, claims re-lock per frontend commit
batch. Gate green per slice.

## W1 — ONE MEMORY (next lane, `agent/rec-perfect-w1`)

- Every card decline/accept from EVERY surface → the ledger with `target`; `declinedTexts()`
  (`recommendation-ledger.js:243`) projects `.target` too; a shared declined read consulted
  by the shelves AND the spine candidates (fingerprint + target keyed).
- `preferenceModel` (`ProspectStore.preferenceModel()`, already fetched) into the spine as a
  bounded within-band term beside `quality` (`recommend.js:225`), and into `rankSpecs` +
  RecipeFit.
- ✕ decline affordance on curated-recruit / FOR YOU / READY cards (`marketplace.js:1593+`)
  with `declined` verdicts to the ledger.
- Session ask budget extended: the ~8 off-spine beats (pitch, quest ledger/refresh confirms,
  night report + nudge, away digest asks) spend `Recommend.asksBudget`.
- `expiresAt` sweep (ledger rows normalized but never expired); wire
  `recommendation-eval.js` to a route or CI script so the scorecard runs on real data.
- Cross-shelf dedup: recruiterShelf vs interestGapShelf can show the same class
  back-to-back (`marketplace.js:553-555`) — one dedup pass across the bay render.

## W2 — EVIDENCE EVERYWHERE (final lane, `agent/rec-perfect-w2`)

- The evidence pack reaches the generators: a route serving `commanderEvidenceInputs()`
  (`index.js:4416`) or an `evidence:true` internal-run flag that appends
  `commanderEvidenceContext` (still skipping recall-stat writes). Inject into
  `Pitch.buildDirective`, `Goals.buildDirective`, the suggest directive.
- The full suggest evidence contract: Q3 staleness guard on `probeTarget()` before prompt
  (`suggeststore.js:177` — pitch.js:126 currently injects a stale belief and forbids
  mentioning it); model must emit `EVIDENCE: <verbatim>` vetoed by token-overlap grounding
  (autopilot.js:361 pattern); display the GROUNDED quote via whyLine; ledger carries it as
  real quote-typed evidence.
- Goal next-milestone as a bounded within-band spine term (`goalAligned` candidates;
  `recUnderstanding().goal.next` already loaded at `understandingstore.js:61`) + milestone
  injected into pitch/goals directives.
- Parked for taste (needs live before/after with Andrew): profile affinity ×4 with a 3-tag
  vocabulary vs 24-topic interests capped at 3 (`recipes.js:829`, `profile.js:22`).

## Laws that bind every lane
Evidence-or-silence; "because you said" only for kind=verbatim (confirmed→"you confirmed";
directive→"from the task you gave me"); a mismatch of kind must EXCLUDE; check candidate
multiplicity before designing any scorer; truthful telemetry — never a fabricated weight or
certainty; shared/events.js|schema.js untouched; new suites into fast.list; frontend edits
owe claims re-lock (code first, regenerate, lock alone); sync:website rides every commit;
no Claude trailers; pathspec adds only.
