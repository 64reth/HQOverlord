# PLAN — Recommendation Quality Loop (value, not just relevance)

**Approved by Andrew 2026-08-04.** Lane: `agent/rec-quality`. Builds directly on the merged
recommendation spine (`9ffa23b6`, see `docs/PLAN_RECOMMENDATION_SPINE.md`). The spine
guarantees an offer is *grounded* (evidence-or-silence); this lane makes offers *valuable*:
strength-weighted grounding in, outcome-verified quality back.

## Product contract

1. **Evidence strength, not just existence (Q1).** A pain corroborated twice this week must
   outrank a one-off mention from three weeks ago. The scorer reads the strength the
   understanding engine already computes — never a fabricated certainty.
2. **Post-accept outcome closes the loop (Q2).** An accepted recommendation that spawns work
   is *tracked to its outcome*: the run's existing 👍/👎 rating and completion/abandonment
   credit or debit the channel (and dim/topic) that produced it. Channels that produce duds
   get structurally quieter; no hand tuning. Mirrors the earned-trust philosophy already
   applied to autonomy.
3. **Stale memory asks, never asserts (Q3).** A belief that is old and uncorroborated may not
   be *asserted* in an offer ("because you said X") — but it may be *asked about* ("still
   true that X?"). Confirm refreshes the belief (evidence write); deny retires/decays it.
   Stale memory becomes a source of good questions instead of bad recommendations.
4. **Truthful telemetry throughout.** Quality weights start neutral and move only on real,
   attributable outcomes. No decay-to-zero that silences a channel forever (floor it), no
   invented confidence, and nothing user-facing asserts a quality score.

## Ground truth to verify first (grep, don't trust)

- `frontend/app/recommend.js` — `score/pick/whyLine`, PRIORITY, SESSION_ASK_MAX. The scorer
  currently uses base priority + a VOI gap term for dim-targeted kinds.
- `frontend/app/understandingstore.js` — `read()` gives per-dim `{conf, weight, gap, blank,
  evidence}` + `overall`; `noteEvidence(dim, delta)` (clamp ±6), `noteProbe`, `noteRating`.
  `frontend/app/understanding.js` computes evidence = count × source-weight × recency-decay
  with signed corroboration — Q1's strength term should REUSE this read, not recompute.
- Candidate builders in `frontend/app/chat.js` (`recommendPass` region, ~4200-4460): each
  candidate is `{kind, dim?, why, fire}` — Q1/Q3 need the *belief* (or its timestamps/ref)
  carried on the candidate where available (study prop, arc belief, curiosity dim).
- `frontend/app/suggeststore.js` — already POSTs a ledger to `/api/recommendations`
  (`sidecar` route exists); check its shape before inventing a new one for Q2's attribution.
- Ratings: `rateWork` in `frontend/app/study.js` (WINDOWED source-locks — insertions must be
  tiny or land after BottleStore); run completion signals via `agent.run.end` payloads and
  WorkQuestStore. Routines: `routinenudgestore.js` / cron results; recipes: recipe run paths.
- Belief timestamps: dossier beliefs carry `observedAt/updatedAt/createdAt` (see
  `goalstore.js` hydrate and dossier.js) — Q3's staleness read.
- ⛔ shared/events.js|schema.js OWNED — no new bus events; use store calls + existing fetch
  routes only.

## Build slices (verify + commit each; pathspec adds; no agent trailers)

### Q1 — strength-weighted scoring (recommend.js + candidate plumbing)
- Candidates gain optional `strength` (0..1) supplied by their builder from real state:
  dim-bearing kinds derive it from `UnderstandingStore.read().dims[dim]` (conf × recency
  already folded into the engine's evidence math); study/arc candidates may refine with the
  cited belief's own corroboration/age when cheaply available.
- `Recommend.score` multiplies by `(0.5 + strength/2)` style damping (tunable constants,
  commented) so strength reorders *within* priority bands rather than letting a weak
  high-priority candidate be jumped arbitrarily — priority order remains the spine's law.
- Fail-open: absent store/dim → neutral strength, pure priority (never fabricated).
- Extend `test/recommend.test.js`: fresh-corroborated beats stale-one-off within a band;
  missing store = neutral; priority still wins across bands.

### Q2 — outcome attribution (the new loop)
- New small pure module + store (suggested: `frontend/app/recquality.js` +
  `recqualitystore.js`, localStorage-persisted, node-exportable, FIFO-capped): per-channel
  (and per-dim) EWMA quality in [floor..cap], floor ≥0.5 so no channel is ever silenced by
  quality alone, start 1.0 neutral.
- Attribution: when a spine offer is ACCEPTED and spawns work, stamp the spawned thing with
  `{recChannel, recDim, recId}` — runs (run meta), routines (routine def), recipe runs —
  through existing extension points only (run meta bag, store fields); NO shared-contract
  edits. Where a channel's accept doesn't spawn trackable work (curiosity answer, study
  keep), the accept itself is the outcome (small positive).
- Outcome folding: existing 👍/👎 (rateWork verdict path), work-quest completion, and
  routine kept-vs-deleted feed `RecQualityStore.noteOutcome(stamp, verdict)`. Declines
  already flow (keep them as mild negative). Abandonment (accepted routine never run within
  N days) = mild negative, only when provable from real state.
- `Recommend.score` multiplies by the channel quality weight (same damped style as Q1).
- Tests: EWMA math, floor/cap, attribution stamps survive persistence, quality actually
  reorders a mixed field, and a dud-channel quietening scenario.

### Q3 — staleness guard (ask, don't assert)
- A shared helper (in recquality.js): `staleness(belief)` from `updatedAt/observedAt` vs now
  + corroboration; threshold constants commented (suggest: stale = >21 days AND conf below
  ~0.55 for the dim).
- Candidate builders that *assert* a belief (study retire keeps its own flow; arc; suggest;
  routine when citing a pattern) consult it: stale → either transform into a RE-CONFIRM ask
  ("still true that …? — the card's consent becomes confirm/deny writing
  `noteEvidence(dim, ±)` and belief refresh/retire via existing store paths) or stand down
  this moment. The re-confirm rides the SAME spine slot and card grammar (eyebrow unchanged,
  proposal phrased as a question) — no new surfaces.
- A re-confirm is capped by the same session budget and per-channel caps; deny must not
  re-ask until the belief changes (fingerprint discipline like goalstore's offered set).
- Tests: stale assert blocked, fresh assert passes, re-confirm consent writes the right
  store effects, deny denylist honored.

### Q4 — docs + claims
- `docs/BRAIN.md` one-paragraph note; claims re-lock (code first, `--refresh-surface`
  applied, lock-only commit); `npm run sync:website` rides every source commit.

## Verification bar (starnet-verify)
- `npm run test:fast` green per slice (LOG not exit code; voice.button flake; 3221225773 =
  RAM). Live on a fresh-port worktree seed: a strength-reordered pick observable via
  wrapped `Recommend.pick` inputs; an accepted offer's stamp visible on the spawned run;
  a stale-belief re-confirm card rendering with confirm/deny writing evidence. Report
  honestly what was and wasn't observed live.

## Traps
- rateWork windowed source-locks (study.test) — tiny insertions only.
- Injected-store tests hide wiring bugs — prove at least one path on the real modules
  ([[injected-dependency-hides-wiring-bugs]] — this exact lane family already caught the
  arc firing deadlock that way).
- No `Date.now`/`Math.random` in sidecar logic (lint-determinism); frontend follows local
  idiom (Date.now is fine there).
- Trunk moves hourly — sync-rebase before merge; claims re-lock reads the COMMIT.
