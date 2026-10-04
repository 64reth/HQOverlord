/* node test/recquality.test.js — the recommendation QUALITY loop's pure half:
   evidence STRENGTH (Q1), the channel-quality EWMA arithmetic (Q2), belief STALENESS (Q3).
   Every read is fail-open: absent state reads NEUTRAL, never a fabricated number. */
'use strict';
const A = require('./_assert.js');
const RQ = require('../frontend/app/recquality.js');
const Recommend = require('../frontend/app/recommend.js');

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1780000000000;               // a fixed clock — this module never reads one of its own
const uRead = { dims: { goals: { weight: 3, conf: 0.8 }, pain: { weight: 2, conf: 0.2 }, style: { weight: 1, conf: 0.5 } } };

/* ── 1. dimStrength — the engine's OWN confidence, never a recomputation ── */
A.eq(RQ.dimStrength(uRead, 'goals'), 0.8, 'a dimension’s strength IS its understanding confidence');
A.eq(RQ.dimStrength(uRead, 'nope'), null, 'an unknown dimension reads NULL (neutral), never 0');
A.eq(RQ.dimStrength(null, 'goals'), null, 'no understanding read at all is neutral, never fabricated');
A.eq(RQ.dimStrength({ dims: { goals: {} } }, 'goals'), null, 'a dimension with no numeric confidence is neutral');

/* ── 2. countStrength — corroborated beats one-off, saturating ── */
A.ok(RQ.countStrength(3) > RQ.countStrength(1), 'three repeats are stronger evidence than one');
A.ok(RQ.countStrength(1) > 0.3 && RQ.countStrength(1) < 0.5, 'a single repeat is real but thin');
A.ok(RQ.countStrength(50) < 1 && RQ.countStrength(50) > 0.95, 'the count saturates, never reaching certainty');
A.eq(RQ.countStrength(0), null, 'no count is NO READING (neutral) — not strength zero');
A.eq(RQ.countStrength('x'), null, 'an unusable count is neutral');

/* ── 3. freshness / beliefStrength — decay mirrors understanding.js exactly ── */
A.eq(RQ.freshness({ updatedAt: NOW }, NOW), 1, 'a belief touched now is fully fresh');
A.eq(Math.round(RQ.freshness({ updatedAt: NOW - 60 * DAY }, NOW) * 100), 50, 'the 60-day half-life halves freshness');
A.eq(RQ.freshness({ pinned: true, updatedAt: NOW - 900 * DAY }, NOW), 1, 'a PINNED belief never decays (Commander-asserted durable)');
A.eq(RQ.freshness({}, NOW), 1, 'an undatable belief is treated as FRESH — unknown age is not evidence of staleness');
A.eq(RQ.freshness({ updatedAt: NOW - DAY }, null), 1, 'no clock → no decay (the clock is injected, never read here)');
A.ok(RQ.beliefStrength({ updatedAt: NOW - 90 * DAY }, NOW, uRead, 'goals') < RQ.beliefStrength({ updatedAt: NOW }, NOW, uRead, 'goals'),
  'a season-old belief is weaker evidence than a fresh one in the same dimension');
A.ok(RQ.beliefStrength({ updatedAt: NOW }, NOW, uRead, 'pain') < RQ.beliefStrength({ updatedAt: NOW }, NOW, uRead, 'goals'),
  'a fresh belief in a thinly-understood dimension is still only moderately strong');
A.eq(RQ.beliefStrength({ updatedAt: NOW }, NOW, null, 'goals'), 1, 'no understanding read → freshness alone is the reading');
A.eq(RQ.beliefStrength(null, NOW, uRead, 'goals'), null, 'no belief → no reading');
/* NEITHER READING MAY ZERO THE OTHER OUT (fixed after a live run, 2026-08-04): the dimension confidence is a
   lagging aggregate — a station can genuinely hold the goal belief the arc is citing while the goals dim still
   reads 0 — so a fresh, real citation must never be discounted to nothing by it. */
A.ok(RQ.beliefStrength({ updatedAt: NOW }, NOW, { dims: { goals: { conf: 0 } } }, 'goals') >= 0.5,
  'a FRESH belief in a dimension reading zero confidence is still half-strength, never zero');
A.ok(RQ.beliefStrength({ updatedAt: NOW - 900 * DAY }, NOW, uRead, 'goals') < 0.5,
  'and a long-dead belief is weak even in a well-understood dimension');

/* ── 4. STRENGTH REORDERS WITHIN A BAND, NEVER ACROSS ONE (the spine’s law is untouched) ── */
const fresh = { kind: 'seed', why: 'you keep asking me to “ship the digest” (4×)', strength: 0.95 };
const thin = { kind: 'seed', why: 'you keep asking me to “tidy the inbox”', strength: 0.1 };
A.ok(Recommend.score(fresh) > Recommend.score(thin), 'well-corroborated evidence outranks a one-off in the same band');
A.eq(Recommend.pick([thin, fresh]).why, fresh.why, 'and the strong candidate is the one that speaks');
A.eq(Recommend.score({ kind: 'seed', why: 'x' }), Recommend.score({ kind: 'seed', why: 'x', strength: 1 }),
  'a NEUTRAL (absent) strength scores identically to a maximal one — thin evidence is discounted, strong evidence is never inflated');
A.eq(Recommend.score({ kind: 'seed', why: 'x', strength: null }), Recommend.score({ kind: 'seed', why: 'x' }),
  'an explicit null strength is neutral (fail-open: a cold store never penalizes)');
A.ok(Recommend.score({ kind: 'seed', why: 'x', strength: 0 }) < Recommend.score({ kind: 'seed', why: 'x' }),
  'strength zero DISCOUNTS, and only discounts');
// the BAND law, true of the SUM of every modifier and not merely of each one
const strongLow = { kind: 'curiosity', why: 'a', dim: 'goals', strength: 1, quality: Recommend.QUALITY_CAP, streak: 99 };
const weakHigh = { kind: 'trust', why: 'b', strength: 0, quality: Recommend.QUALITY_FLOOR, declines: 99 };
A.ok(Recommend.score(weakHigh) >= Recommend.score(strongLow),
  'a maxed-out gentle candidate can never outscore a minimum-scoring turn-in');
A.eq(Recommend.pick([strongLow, weakHigh]).kind, 'trust', 'so the BAND still decides who speaks');
A.ok(Recommend.MOD_CAP * 2 < Recommend.BAND_GAP_MIN, 'the TOTAL modifier budget is bounded inside one band gap');
// …and INSIDE a band the same modifiers are decisive: strength alone reorders two gentle kinds
A.eq(Recommend.pick([{ kind: 'seed', why: 'a', strength: 0 }, { kind: 'routine', why: 'b', strength: 1 }]).kind, 'routine',
  'evidence strength reorders two channels of the same band (the whole point of measuring it)');

/* ── 5. THE OUTCOME LOOP’S ARITHMETIC (Q2) ── */
A.eq(RQ.Q_START, 1, 'a channel starts NEUTRAL — never presumed good or bad');
A.ok(RQ.Q_FLOOR >= 0.5, 'the floor is at least 0.5: quality alone can never silence a channel');
let w = RQ.Q_START;
for (let i = 0; i < 40; i++) w = RQ.fold(w, 'miss');
A.ok(Math.abs(w - RQ.Q_FLOOR) < 1e-4, 'an endlessly dud channel converges to the FLOOR — quieter, never mute');
A.ok(w > 0, 'and never to zero');
let up = RQ.Q_START;
for (let i = 0; i < 40; i++) up = RQ.fold(up, 'great');
A.ok(Math.abs(up - RQ.Q_CAP) < 1e-4, 'a consistently good channel converges to the bounded cap');
A.ok(RQ.fold(1, 'great') > 1 && RQ.fold(1, 'miss') < 1, 'one outcome moves the weight in the honest direction');
A.ok(RQ.fold(1, 'miss') > RQ.Q_FLOOR, 'one bad outcome is not a verdict (EWMA, not a switch)');
A.eq(RQ.fold(1, 'mystery'), 1, 'an unnamed verdict moves NOTHING — the loop only folds outcomes it can name');
A.eq(RQ.fold(1, null), 1, 'a missing verdict moves nothing');
A.eq(RQ.fold(99, 'great'), RQ.Q_CAP, 'a corrupted weight is clamped back into the honest band');
A.eq(RQ.fold(-99, 'great'), RQ.clampQuality(RQ.Q_FLOOR + RQ.Q_ALPHA * (RQ.Q_CAP - RQ.Q_FLOOR)), 'and so is a negative one');
A.eq(RQ.isOutcome('declined'), true, 'a decline is a real, named outcome');
A.ok(RQ.OUTCOME.miss < RQ.OUTCOME.declined && RQ.OUTCOME.declined < RQ.OUTCOME.deferred && RQ.OUTCOME.deferred < RQ.OUTCOME.great,
  'the outcome vocabulary is ordered: 👎 worse than a decline, worse than a "not now", worse than 👍');

/* a dud channel gets QUIETER but is never silenced by quality alone */
let dud = RQ.Q_START;
for (let i = 0; i < 10; i++) dud = RQ.fold(dud, 'miss');
const dudCand = { kind: 'seed', why: 'x', quality: dud };
const freshCand = { kind: 'seed', why: 'y' };
A.ok(Recommend.score(dudCand) < Recommend.score(freshCand), 'a channel that produced duds ranks below a neutral one');
A.ok(Recommend.pick([dudCand]) !== null, 'and still speaks when it is the only thing on the table (never silenced)');
A.eq(Recommend.score({ kind: 'seed', why: 'x', quality: null }), Recommend.score(freshCand), 'an unrated channel is neutral');
A.eq(Recommend.score({ kind: 'seed', why: 'x', quality: 0.0001 }), Recommend.score({ kind: 'seed', why: 'x', quality: RQ.Q_FLOOR }),
  'a corrupted persisted weight cannot push a channel below the floor');

/* ── 6. STALENESS (Q3): old AND under-confirmed — either alone is a false positive ── */
const old = { id: 'b1', text: 'ship the billing rewrite', updatedAt: NOW - 40 * DAY };
const recent = { id: 'b2', text: 'ship the billing rewrite', updatedAt: NOW - 2 * DAY };
const thinDim = { dims: { goals: { weight: 3, conf: 0.2 } } };
A.eq(RQ.staleness(old, NOW, thinDim, 'goals').stale, true, 'old AND under-confirmed reads STALE');
A.eq(RQ.staleness(recent, NOW, thinDim, 'goals').stale, false, 'a recent belief is never stale, however thin the dimension');
A.eq(RQ.staleness(old, NOW, uRead, 'goals').stale, false, 'an OLD belief in a well-corroborated dimension is not stale — age alone is not doubt');
A.eq(RQ.staleness({ id: 'p', text: 't', pinned: true, updatedAt: NOW - 900 * DAY }, NOW, thinDim, 'goals').stale, false,
  'a PINNED belief is never stale — the station does not second-guess what the Commander pinned');
A.eq(RQ.staleness({ id: 'u', text: 't' }, NOW, thinDim, 'goals').stale, false, 'an undatable belief is never stale (unknown age is not evidence)');
A.eq(RQ.staleness(old, null, thinDim, 'goals').stale, false, 'no clock → no staleness claim');
A.eq(RQ.staleness(old, NOW, null, 'goals').stale, false, 'no understanding read → no staleness claim (fail-open to neutral)');
A.eq(Math.round(RQ.staleness(old, NOW, thinDim, 'goals').ageDays), 40, 'the age it reports is the real one');
A.ok(RQ.STALE_DAYS >= 14, 'the staleness threshold is weeks, not days');

/* the re-confirm fingerprint: re-asks only when the belief itself changes (goalstore’s offered-set discipline) */
A.eq(RQ.beliefFingerprint('goals', old), RQ.beliefFingerprint('goals', { id: 'b1', text: 'Ship the BILLING rewrite!' }),
  'the fingerprint is stable across casing/punctuation — a denied question is not re-asked on a re-render');
A.ok(RQ.beliefFingerprint('goals', old) !== RQ.beliefFingerprint('goals', { id: 'b1', text: 'ship the invoicing rewrite' }),
  'an EDITED belief is a new question');
A.ok(RQ.beliefFingerprint('goals', old) !== RQ.beliefFingerprint('pain', old), 'the dimension is part of the identity');
A.eq(RQ.beliefFingerprint('goals', null), '', 'no belief, no fingerprint');

/* ── 6b. ABSENT STRENGTH IS A RELATIVE ADVANTAGE, SO EVERY CHANNEL WITH DATA MUST REPORT ONE (S5, 2026-08-04) ──
   The strength term is ONE-SIDED (it only subtracts), which means abstaining from it is not neutral in effect —
   a silent channel simply cannot be down-ranked for thin evidence. That is fine only if the abstainers genuinely
   have nothing to read. study (its dim's confidence) and trust (its offer's real satisfaction percentage) both
   did, and were staying quiet. */
{
  const chatSrcQ = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
  const A_ = A;
  A_.ok(Recommend.score({ kind: 'seed', why: 'x' }) > Recommend.score({ kind: 'seed', why: 'x', strength: 0.2 }),
    'a channel that reports thin evidence ranks BELOW one that reports none — silence is the relative advantage');
  A_.ok(/strength: recStrengthOfDim\(prop\.dim\)/.test(A_.fnBody(chatSrcQ, 'async function studyCandidate(')),
    'STUDY now reports the confidence of the dimension its proposal asserts about');
  A_.ok(/strength: recStrengthOfPercent\(pv\.confidence\)/.test(A_.fnBody(chatSrcQ, 'function trustCandidate(')),
    'TRUST now reports its offer’s own provenance confidence (the satisfaction % it already cites)');
  A_.eq(/strength:/.test(A_.fnBody(chatSrcQ, 'async function threadCandidate(')), false,
    'THREAD abstains — no dim to read a confidence from and no age to read a freshness from');
  A_.eq(/strength:/.test(A_.fnBody(chatSrcQ, 'function curiosityCandidate(')), false,
    'CURIOSITY abstains — a blank dim is a high-VALUE question, which the VOI term already scores');
  // the two new readers fail open exactly like their siblings: no reading is NEVER strength zero
  A_.eq(RQ.dimStrength(null, 'goals'), null, 'no understanding read → no dim strength (never a fabricated 0)');
  A_.eq(RQ.dimStrength(uRead, 'nosuchdim'), null, 'and an unknown dimension reads nothing either');
  const pctBody = A_.fnBody(chatSrcQ, 'function recStrengthOfPercent(');
  A_.ok(/if \(!Number\.isFinite\(n\) \|\| n <= 0\) return null;/.test(pctBody),
    'an absent/unreadable satisfaction percentage is NO reading — not the full thin-evidence penalty');
  A_.ok(/n > 100 \? 1 : n \/ 100/.test(pctBody), 'and a 0..100 percentage maps onto the 0..1 strength band, clamped');
}

/* ── 6c. THE SAME "a reading is a number or it is nothing" PREDICATE (2026-08-04) ──
   num() is the gate every read in this module passes through, and it used to DENYLIST the bad shapes — so `' '`,
   `[]` and `[0]` still reached Number() and came back a hard, finite 0. In dimStrength/staleness a hard 0 is
   CONFIDENCE ZERO, which marks a belief stale and asks the Commander to re-confirm it on a field the station
   merely failed to read. Mirrors recommend.js reading() exactly. */
for (const junk of [' ', '', '  \n', [], [0], [1], {}, false, true, null, undefined, NaN, 'abc']) {
  A.eq(RQ.dimStrength({ dims: { goals: { conf: junk } } }, 'goals'), null,
    'an unreadable confidence (' + JSON.stringify(junk) + ') is NO reading — never confidence zero');
  A.eq(RQ.staleness(old, NOW, { dims: { goals: { weight: 3, conf: junk } } }, 'goals').stale, false,
    '…so it never marks a belief stale (' + JSON.stringify(junk) + ')');
  A.eq(RQ.countStrength(junk), null, 'and an unreadable count is no reading either (' + JSON.stringify(junk) + ')');
}
A.eq(RQ.dimStrength({ dims: { goals: { conf: '0.4' } } }, 'goals'), 0.4, 'a number spelled as a string IS a reading');
A.eq(RQ.dimStrength({ dims: { goals: { conf: 0 } } }, 'goals'), 0, 'and a REAL zero still reads as zero');

/* ── 7. the module is pure ── */
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'recquality.js'), 'utf8');
A.eq(/\bdocument\b/.test(src), false, 'recquality.js touches no DOM');
A.eq(/\bfetch\s*\(|localStorage/.test(src), false, 'recquality.js performs no I/O and owns no storage');
A.eq(/\bsetTimeout\b|Date\.now|Math\.random/.test(src), false, 'recquality.js is clock-free and deterministic');

A.report('recquality.test');
