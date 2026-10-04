/* node test/profile.test.js — the pure user-affinity engine (frontend/app/profile.js).
   Locks the Phase-0 promises: observations build a decaying interest vector; the onboarding/specialty
   SEED gives an honest cold-start (first-seed-wins, fades as real data accrues); RECENCY decay means a
   fresh tag outweighs a stale one; score() ranks catalog items by match; 'calibrating' is honest below
   the sample floor; the learning flag gates folding; forget() wipes but keeps the choice; and a
   malformed/old persisted blob hydrates to a valid profile. Clock is injected — decay is deterministic. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/profile.js');
const HL = P.HALF_LIFE_MS, N = P.CALIBRATING_N;

/* ---------- shape + observe ---------- */
let p = P.fresh();
A.eq(p, { v: 1, tags: {}, seed: null, enabled: true, total: 0 }, 'fresh() is an empty, enabled profile');
P.observe(p, { tag: 'code' }, 0);
A.eq(p.total, 1, 'observe bumps total');
A.eq(p.tags.code.n, 1, 'observe records a sample count');
A.ok(P.affinity(p, 'code', 0) > 0, 'a single observed tag has affinity');

/* unknown tag folds into the catch-all "general" lane (never dropped) */
const u = P.fresh(); P.observe(u, { tag: 'banana' }, 0);
A.ok(!u.tags.banana, 'unknown tag is not stored verbatim');
A.eq(u.tags.general.n, 1, 'unknown tag folds into general');

/* ---------- recency: a fresh tag outweighs a stale one ---------- */
const r = P.fresh();
P.observe(r, { tag: 'research' }, 0);    // stale (t=0)
P.observe(r, { tag: 'code' }, HL);       // fresh (t=HL)
A.ok(P.affinity(r, 'code', HL) > P.affinity(r, 'research', HL), 'the more recent tag dominates (EWMA recency)');
A.eq(P.summary(r, HL).dominant, 'code', 'summary.dominant reflects recency');

/* ---------- score(): ranks catalog items by interest match ---------- */
A.ok(P.score(r, { code: 1 }, HL) > P.score(r, { research: 1 }, HL), 'a code-tagged item outscores a research one for a code-leaning user');
const blended = P.score(r, { code: 0.6, research: 0.4 }, HL);
A.ok(blended > 0 && blended <= 1, 'a blended item scores within [0,1]');

/* ---------- seed: honest cold-start ---------- */
const s = P.fresh();
A.eq(P.summary(s, 0).dominant, null, 'a blank profile has no dominant interest (no fabrication)');
P.seed(s, 'code');
A.eq(P.summary(s, 0).dominant, 'code', 'a seed gives a day-one dominant interest');
A.eq(P.summary(s, 0).calibrating, true, 'a seed-only profile is still calibrating (0 samples)');
P.seed(s, 'research');
A.eq(s.seed.tag, 'code', 'first seed wins — a later seed does not overwrite');

/* seed is ignored once real data exists (re-entering the game never clobbers learning) */
const s2 = P.fresh(); P.observe(s2, { tag: 'code' }, 0); P.seed(s2, 'research');
A.eq(s2.seed, null, 'seed is a no-op once observations have accrued');

/* the seed fades: with enough real RESEARCH usage, research overtakes a CODE seed */
const s3 = P.fresh(); P.seed(s3, 'code');
for (let k = 0; k < N + 2; k++) P.observe(s3, { tag: 'research' }, 0);
A.eq(P.summary(s3, 0).dominant, 'research', 'real usage overtakes a stale seed (seed scale fades to 0)');

/* ---------- calibrating threshold ---------- */
const c = P.fresh();
for (let k = 0; k < N - 1; k++) P.observe(c, { tag: 'code' }, 0);
A.eq(P.summary(c, 0).calibrating, true, 'below the sample floor: calibrating');
P.observe(c, { tag: 'code' }, 0);
A.eq(P.summary(c, 0).calibrating, false, 'at the sample floor: a known read');
A.eq(P.summary(c, 0).samples, N, 'samples counts every observation');

/* ---------- learning flag gates folding ---------- */
const e = P.fresh(); P.setEnabled(e, false); P.observe(e, { tag: 'code' }, 0);
A.eq(e.total, 0, 'observe is a no-op while learning is paused');
P.setEnabled(e, true); P.observe(e, { tag: 'code' }, 0);
A.eq(e.total, 1, 'observe resumes once re-enabled');

/* ---------- forget wipes learned data but keeps the on/off choice ---------- */
const f0 = P.fresh(); P.observe(f0, { tag: 'code' }, 0); P.seed(f0, 'code'); P.setEnabled(f0, false);
const f = P.forget(f0);
A.eq(f.total, 0, 'forget zeroes observations');
A.eq(f.seed, null, 'forget drops the seed');
A.eq(Object.keys(f.tags).length, 0, 'forget clears the histogram');
A.eq(f.enabled, false, 'forget preserves the learning on/off choice');

/* ---------- hydrate: defensive load of a (possibly malformed/old) blob ---------- */
A.eq(P.hydrate(null).total, 0, 'hydrate(null) -> a fresh profile');
A.eq(P.hydrate(undefined).enabled, true, 'hydrate of nothing is enabled by default');
const h = P.hydrate({ tags: { code: { w: 5, n: 3, t: 0 } }, total: 3, enabled: false, seed: { tag: 'code' } });
A.eq(h.total, 3, 'hydrate carries a valid total');
A.eq(h.enabled, false, 'hydrate carries the paused flag');
A.eq(h.tags.code.w, 5, 'hydrate carries valid tag weights');
A.eq(h.seed.tag, 'code', 'hydrate carries the seed');
const bad = P.hydrate({ tags: { code: 'nope', evil: { w: -1 } }, total: -5, seed: 'x' });
A.eq(bad.total, 0, 'hydrate clamps a negative total to 0');
A.eq(Object.keys(bad.tags).length, 0, 'hydrate drops malformed tag entries');
A.eq(bad.seed, null, 'hydrate drops a malformed seed');

/* round-trip: fresh -> observe -> serialize(JSON) -> hydrate preserves the model */
const rt = P.fresh(); P.observe(rt, { tag: 'code' }, 0); P.observe(rt, { tag: 'research' }, 0);
const re = P.hydrate(JSON.parse(JSON.stringify(rt)));
A.eq(re.total, 2, 'round-trip preserves total');
A.eq(re.tags.code.w, rt.tags.code.w, 'round-trip preserves weights');

/* ---------- review hardening (Phase-0 adversarial pass) ---------- */
// weighted observations (the SHIP_WEIGHT=3 path) fold at their weight without inflating the sample count
const w = P.fresh(); P.observe(w, { tag: 'code', weight: 3 }, 0);
A.eq(w.tags.code.w, 3, 'a weighted observation folds at its weight');
A.eq(w.tags.code.n, 1, 'weight does not inflate the sample count');
const ship = P.fresh(); P.observe(ship, { tag: 'research' }, 0); P.observe(ship, { tag: 'code', weight: 3 }, 0);
A.ok(P.affinity(ship, 'code', 0) > P.affinity(ship, 'research', 0), 'a shipped item (weight 3) outweighs a single message tag');
// a bad weight (<=0 or non-finite) folds as 1, never zeroing/negating a tag
const gw = P.fresh(); P.observe(gw, { tag: 'code', weight: -5 }, 0); P.observe(gw, { tag: 'general', weight: 'x' }, 0);
A.eq(gw.tags.code.w, 1, 'a negative weight folds as 1');
A.eq(gw.tags.general.w, 1, 'a non-numeric weight folds as 1');

// absolute EWMA decay: an existing weight halves over one half-life BEFORE the new fold (1*0.5 + 1 = 1.5)
const dec = P.fresh(); P.observe(dec, { tag: 'code' }, 0); P.observe(dec, { tag: 'code' }, HL);
A.ok(Math.abs(dec.tags.code.w - 1.5) < 1e-9, 'a stored weight decays by half over one half-life before re-folding');

// the interest vector is a normalized distribution (sums to ~1) whenever there is signal
const nv = P.vector(r, HL);
A.ok(Math.abs(nv.code + nv.research + nv.general - 1) < 1e-9, 'the interest vector is a normalized distribution');

// cold-start zero: an empty profile fabricates no preference
A.eq(P.score(P.fresh(), { code: 1 }, 0), 0, 'an empty profile scores every item 0');
A.eq(P.vector(P.fresh(), 0), { code: 0, research: 0, general: 0 }, 'an empty profile has a zero interest vector');

// Infinity/NaN weights are rejected at BOTH engine entry points — no non-finite value can poison the vector
const inf = P.hydrate({ tags: { code: { w: Infinity, n: 1, t: 0 } } });
A.ok(!inf.tags.code, 'hydrate drops a non-finite weight');
const infO = P.fresh(); P.observe(infO, { tag: 'code', weight: Infinity }, 0);
A.eq(infO.tags.code.w, 1, 'observe rejects a non-finite weight (folds as 1)');
A.ok(Number.isFinite(P.score(infO, { code: 1 }, 0)), 'the vector stays finite after a hostile weight');

// the learning-paused flag gates the SEED write path too (not just observe)
const sd = P.fresh(); P.setEnabled(sd, false); P.seed(sd, 'code');
A.eq(sd.seed, null, 'seed is a no-op while learning is paused');

// forget preserves an ENABLED profile's learning-on choice (not only the paused one)
A.eq(P.forget(P.fresh()).enabled, true, 'forget on an enabled profile keeps learning ON');
A.eq(P.forget({}).enabled, true, 'forget defaults a flagless profile to enabled');

/* ---------- familiarity: the honest "how well I know you" meter (0..1) ---------- */
const FN = P.FAMILIAR_N;
A.eq(P.summary(P.fresh(), 0).familiarity, 0, 'a fresh profile reads 0 familiarity');
const famFull = P.fresh(); for (let k = 0; k < FN; k++) P.observe(famFull, { tag: 'code' }, 0);
A.eq(P.summary(famFull, 0).familiarity, 1, 'familiarity reaches 1 at FAMILIAR_N samples');
const famOver = P.fresh(); for (let k = 0; k < FN + 10; k++) P.observe(famOver, { tag: 'code' }, 0);
A.eq(P.summary(famOver, 0).familiarity, 1, 'familiarity clamps at 1 past the ceiling');
const famHalf = P.fresh(); for (let k = 0; k < Math.floor(FN / 2); k++) P.observe(famHalf, { tag: 'code' }, 0);
const fh = P.summary(famHalf, 0).familiarity;
A.ok(fh > 0 && fh < 1, 'familiarity rises between 0 and the ceiling as samples accrue');
// a weighted (shipped) observation lifts the lane weight but NOT the sample count, so familiarity tracks samples honestly
const famW = P.fresh(); P.observe(famW, { tag: 'code', weight: 3 }, 0);
A.eq(P.summary(famW, 0).familiarity, 1 / FN, 'familiarity counts observations, not weight (one shipped item = one sample)');

/* ---------- explain(): the deterministic because-tag behind a recommendation ---------- */
A.eq(P.explain(P.fresh(), { code: 1 }, 0), null, 'a cold profile explains nothing (never fabricates a reason)');
const exC = P.fresh(); P.observe(exC, { tag: 'code' }, 0);
A.eq(P.explain(exC, { code: 1 }, 0), 'code', 'a code item for a code-leaning user is explained by code');
A.eq(P.explain(exC, { research: 1 }, 0), null, 'an item the user has no affinity for yields no reason (null), not a guess');
const exR = P.fresh(); for (let k = 0; k < 4; k++) P.observe(exR, { tag: 'research' }, 0); P.observe(exR, { tag: 'code' }, 0);
A.eq(P.explain(exR, { code: 0.5, research: 0.5 }, 0), 'research', 'a blended item is explained by the lane that dominates the user’s interest');
// a seed-only (cold) profile still yields a reason — day-one recommendations are honestly explainable
const exSeed = P.fresh(); P.seed(exSeed, 'research');
A.eq(P.explain(exSeed, { research: 1 }, 0), 'research', 'a seeded cold-start profile explains its day-one picks');

A.report('profile');
