/* node test/understanding.test.js — the pure understanding engine (frontend/app/understanding.js).
   Locks the promises the north-star arc depends on: a cold dossier reads 0; evidence → confidence is
   saturating + monotonic; provenance weighs (Commander/pinned > study-observed); staleness DECAYS confidence
   (the drift signal) while a pinned belief never decays; north-star-critical dims (goals/ambition/pain) weigh
   the overall more; corroboration raises a dim; `weakest` names the highest weight×gap dim (the VOI question
   target) deterministically; `calibrating` flips below the floor; and identical state is byte-stable. Clock
   is injected — no Date.now anywhere. */
'use strict';
const A = require('./_assert.js');
const U = require('../frontend/app/understanding.js');
const D = require('../frontend/app/dossier.js');

const DAY = 24 * 60 * 60 * 1000;

/* ---------- cold read: an empty dossier understands nothing ---------- */
const cold = U.understanding(D.fresh(), { now: 1000 });
A.eq(cold.overall, 0, 'a cold dossier reads overall 0');
A.eq(cold.clarity, 0, 'clarity aliases overall');
A.eq(cold.blanks.length, 9, 'a cold dossier has all nine dimensions blank');
A.ok(cold.calibrating, 'a cold dossier is calibrating');
A.eq(cold.dims.goals.conf, 0, 'a blank dimension has 0 confidence');
A.ok(cold.dims.goals.blank, 'a blank dimension is flagged blank');
// weakest of a cold dossier is a highest-weight dim (goals, first in the deterministic weight-desc order)
A.eq(cold.weakest.dim, 'goals', 'weakest of a cold dossier is the highest-weight dim (deterministic tie-break)');

/* null / garbage input never throws, reads cold */
A.eq(U.understanding(null, {}).overall, 0, 'understanding(null) is a cold read, not a crash');
A.eq(U.understanding(undefined).overall, 0, 'understanding(undefined) with no opts is a cold read');

/* ---------- one authored belief lifts its dimension ---------- */
const d1 = D.fresh();
D.upsert(d1, 'goals', { text: 'ship the harness to a thousand builders', source: 'commander' }, 1000);
const r1 = U.understanding(d1, { now: 1000 });
A.ok(r1.dims.goals.conf > 0.4 && r1.dims.goals.conf < 0.6, 'one fresh authored belief ≈ 0.51 confidence (saturating, never a hard 1)');
A.ok(!r1.dims.goals.blank, 'a filled dimension is not blank');
A.ok(r1.overall > cold.overall, 'any belief raises overall understanding above cold');

/* more beliefs in a dimension raise its confidence (monotonic, diminishing) */
const d1b = D.fresh();
D.upsert(d1b, 'goals', { text: 'ship the harness to a thousand builders', source: 'commander' }, 1000);
D.upsert(d1b, 'goals', { text: 'get to a self-serve onboarding', source: 'commander' }, 1000);
const r1b = U.understanding(d1b, { now: 1000 });
A.ok(r1b.dims.goals.conf > r1.dims.goals.conf, 'a second belief raises the dimension confidence');
A.ok((r1b.dims.goals.conf - r1.dims.goals.conf) < r1.dims.goals.conf, 'the second belief adds less than the first (diminishing returns)');

/* ---------- provenance: a study-observed belief weighs less than an authored one ---------- */
const dAuthored = D.fresh();
D.upsert(dAuthored, 'pain', { text: 'writing standup notes by hand', source: 'commander' }, 1000);
const dObserved = D.fresh();
D.upsert(dObserved, 'pain', { text: 'writing standup notes by hand', source: 'study', observedAt: 1000 }, 1000);
const cAuthored = U.understanding(dAuthored, { now: 1000 }).dims.pain.conf;
const cObserved = U.understanding(dObserved, { now: 1000 }).dims.pain.conf;
A.ok(cAuthored > cObserved, 'a Commander-authored belief is more confident than the same belief merely observed');

/* ---------- staleness: confidence DECAYS as a belief ages (the drift signal) ----------
   NOTE: base timestamps must be POSITIVE — the engine treats t<=0 as "undated" (a hydrated legacy belief we
   can't date is never penalized; real beliefs always carry a Date.now() stamp). */
const T0 = 1000;
const dStale = D.fresh();
D.upsert(dStale, 'goals', { text: 'launch the newsletter', source: 'commander' }, T0);
const fresh0 = U.understanding(dStale, { now: T0 }).dims.goals.conf;
const aged60 = U.understanding(dStale, { now: T0 + 60 * DAY }).dims.goals.conf;
A.ok(aged60 < fresh0, 'an aged belief has decayed confidence (drift is structural, not luck)');
A.ok(Math.abs(U.freshness({ updatedAt: T0 }, T0 + 60 * DAY) - 0.5) < 1e-9, 'freshness halves at one 60-day half-life');

/* a PINNED belief is asserted-durable and never decays */
const dPinned = D.fresh();
D.upsert(dPinned, 'goals', { text: 'launch the newsletter', source: 'commander' }, T0);
D.setPinned(dPinned, 'goals', dPinned.dims.goals[0].id, true, T0);
const pinnedAged = U.understanding(dPinned, { now: 3650 * DAY }).dims.goals.conf;
A.ok(Math.abs(pinnedAged - fresh0) < 1e-9, 'a pinned belief does not decay with age');
A.eq(U.freshness({ pinned: true, updatedAt: 0 }, 9e15), 1, 'freshness of a pinned belief is always 1');
// an undated (legacy) belief is treated as fresh — unknown age is never evidence of staleness
A.eq(U.freshness({ updatedAt: 0, createdAt: 0 }, 9e15), 1, 'an undated belief is treated as fresh (never penalized)');

/* ---------- weighting: a north-star-critical dim moves overall more than a peripheral one ---------- */
const dGoal = D.fresh(); D.upsert(dGoal, 'goals', { text: 'x ship the thing', source: 'commander' }, 1000);
const dStack = D.fresh(); D.upsert(dStack, 'stack', { text: 'typescript and node', source: 'commander' }, 1000);
const oGoal = U.understanding(dGoal, { now: 1000 }).overall;
const oStack = U.understanding(dStack, { now: 1000 }).overall;
A.ok(oGoal > oStack, 'the same-strength belief in goals lifts overall more than in stack (north-star weighting)');

/* ---------- corroboration (P2 hook) raises a dimension without a new belief ---------- */
const dCorr = D.fresh();
D.upsert(dCorr, 'ambition', { text: 'build a following', source: 'study', observedAt: 1000 }, 1000);
const base = U.understanding(dCorr, { now: 1000 }).dims.ambition.conf;
const corrd = U.understanding(dCorr, { now: 1000, corroboration: { ambition: 3 } }).dims.ambition.conf;
A.ok(corrd > base, 'corroboration from real work raises a dimension confidence (implicit signal, no new belief)');

/* SIGNED corroboration (R2): counter-evidence (a 👎 rating) LOWERS a dimension, floored at zero ---------- */
const counter = U.understanding(dCorr, { now: 1000, corroboration: { ambition: -1 } }).dims.ambition.conf;
A.ok(counter < base, 'negative corroboration (counter-evidence) lowers a dimension confidence');
const floored = U.understanding(dCorr, { now: 1000, corroboration: { ambition: -99 } }).dims.ambition;
A.eq(floored.conf, 0, 'counter-evidence floors at 0 — never negative certainty');
A.eq(floored.evidence, 0, 'dim evidence itself floors at 0');
// counter-evidence re-aims the VOI target: heavy 👎 on style makes style the weakest among same-weight dims
const dRe = D.fresh();
for (const k of U.DIM_KEYS) D.upsert(dRe, k, { text: 'k ' + k, source: 'commander' }, 1000);
const reAim = U.understanding(dRe, { now: 1000, corroboration: { style: -3 } });
A.eq(reAim.weakest.dim, 'goals', 'weight still dominates the VOI target: a half-known goals (w3) outranks even a fully-drained style (w1)');
const dRe2 = D.fresh();
for (const k of U.DIM_KEYS) { D.upsert(dRe2, k, { text: 'k ' + k, source: 'commander' }, 1000); D.upsert(dRe2, k, { text: 'k2 ' + k, source: 'commander' }, 1000); }
D.upsert(dRe2, 'goals', { text: 'k3', source: 'commander' }, 1000); D.upsert(dRe2, 'ambition', { text: 'k3', source: 'commander' }, 1000); D.upsert(dRe2, 'pain', { text: 'k3', source: 'commander' }, 1000);
const before2 = U.understanding(dRe2, { now: 1000 });
const after2 = U.understanding(dRe2, { now: 1000, corroboration: { style: -2 } });
A.ok(after2.dims.style.conf < before2.dims.style.conf, 'a 👎-drained style dim reads lower than before');
A.ok(after2.overall < before2.overall, 'counter-evidence honestly lowers the overall read');

/* ---------- weakest = the value-of-information target (highest weight × remaining gap) ---------- */
// fill every dim EXCEPT pain and standing_orders; pain (weight 2) must beat standing_orders (weight 1).
const dVOI = D.fresh();
for (const k of ['goals', 'ambition', 'identity', 'stack', 'style']) D.upsert(dVOI, k, { text: 'k ' + k, source: 'commander' }, 1000);
const voi = U.understanding(dVOI, { now: 1000 });
A.eq(voi.weakest.dim, 'pain', 'weakest targets the highest-weight still-weak dim (pain > standing_orders)');
A.ok(voi.blanks.indexOf('pain') >= 0 && voi.blanks.indexOf('standing_orders') >= 0, 'blanks lists every empty dimension');

/* ---------- calibrating flips off once understanding is well-grounded ---------- */
const dWarm = D.fresh();
for (const k of U.DIM_KEYS) {
  D.upsert(dWarm, k, { text: 'a solid belief about ' + k, source: 'commander' }, 1000);
  D.setPinned(dWarm, k, dWarm.dims[k][0].id, true, 1000);   // pinned+authored across all dims → high, stable
}
const warm = U.understanding(dWarm, { now: 1000 });
A.ok(!warm.calibrating, 'a dossier with a pinned authored belief in every dimension is no longer calibrating');
A.ok(warm.overall > cold.overall && warm.overall < 1, 'a warm dossier reads high but never a fabricated 1');

/* ---------- determinism: identical state → byte-identical read ---------- */
A.eq(JSON.stringify(U.understanding(dWarm, { now: 1000 })), JSON.stringify(warm), 'understanding is deterministic for identical state');

/* workSamples passthrough is honest (null when unknown, floored int when supplied) */
A.eq(U.understanding(D.fresh(), {}).workSamples, null, 'workSamples is null when not supplied (never guessed)');
A.eq(U.understanding(D.fresh(), { workSamples: 7.9 }).workSamples, 7, 'workSamples passes through as a floored count');

/* ---------- V3 §6: readiness — the ONE shared recommendation gate ---------- */
{
  // cold station: every requirement unmet, honestly named.
  const cold = U.readiness(D.fresh());
  A.eq(cold.ready, false, 'a cold station is not ready');
  A.eq(cold.reasons, ['no-direction', 'no-person', 'too-thin'], 'a cold gate names every unmet requirement');

  // the blitz case: seed-weight beliefs everywhere (canned chips / doc copies) — breadth exists, grounding doesn't.
  const blitz = D.fresh();
  D.upsert(blitz, 'goals', { text: 'canned purpose', weight: 'seed' }, 1);
  D.upsert(blitz, 'pain', { text: 'canned pain', weight: 'seed' }, 2);
  D.upsert(blitz, 'ambition', { text: 'canned ambition', weight: 'seed' }, 3);
  const b = U.readiness(blitz);
  A.eq(b.ready, false, 'seed-only beliefs NEVER open the gate (the blitzed-onboarding poison)');
  A.eq(b.grounded.goals, 0, 'a seed belief counts zero grounded evidence');
  A.eq(b.familiarity, 0, 'seed field occupancy contributes no readiness breadth');

  // the earned case: direction (goals|ambition) + person (pain|identity) + breadth ≥ floor.
  const warm = D.fresh();
  D.upsert(warm, 'ambition', { text: 'wants to ship the channel', source: 'onboarding', weight: 'stated' }, 1);
  D.upsert(warm, 'identity', { text: 'runs a one-person shop', source: 'onboarding', weight: 'stated' }, 2);
  A.eq(U.readiness(warm).ready, false, 'two grounded dims but breadth below the floor → still not ready');
  D.upsert(warm, 'stack', { text: 'lives in premiere + sheets', source: 'onboarding', weight: 'synth' }, 3);
  const w = U.readiness(warm);
  A.eq(w.ready, true, 'grounded direction + grounded person + breadth ≥ floor opens the gate');
  A.eq(w.reasons, [], 'an open gate carries no reasons');
  A.eq(w.grounded.ambition, 1, 'grounded counts are honest per-dim telemetry');

  // legacy inference mirrors dossier.js weightOf (the two engines stay independently loadable).
  A.eq(U.beliefWeightOf({ text: 'x' }), 'stated', 'legacy record without weight infers stated');
  A.eq(U.beliefWeightOf({ text: 'x', source: 'study' }), 'observed', 'legacy study record infers observed');
  A.eq(U.beliefWeightOf({ text: 'x', weight: 'seed' }), 'seed', 'a declared seed stays seed');
}

A.report('understanding.test');
