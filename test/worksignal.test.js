/* node test/worksignal.test.js — the pure capability-usage histogram (frontend/app/worksignal.js).
   Locks the adaptive-recruitment substrate: a tool fire folds a DECAYED weight into its capability lane + the
   run's interest tag into that lane's per-tag tally; RECENCY decay means a fresh lane outweighs a stale one; the
   vector is a normalized distribution (fabricates no usage when cold); 'calibrating' is honest below the sample
   floor (shared with profile.js); an unknown lane is DROPPED never coerced; hostile weights can't poison the read;
   and a malformed/old blob hydrates to a valid signal. Clock is injected — decay is deterministic. */
'use strict';
const A = require('./_assert.js');
const W = require('../frontend/app/worksignal.js');
const HL = W.HALF_LIFE_MS, N = W.CALIBRATING_N;

/* ---------- shape + observe ---------- */
let s = W.fresh();
A.eq(s, { v: 1, lanes: {}, total: 0 }, 'fresh() is an empty histogram');
W.observe(s, { lane: 'dish' }, 0);
A.eq(s.total, 1, 'observe bumps total');
A.eq(s.lanes.dish.n, 1, 'observe records a sample count');
A.ok(W.laneWeight(s, 'dish', 0) > 0, 'a single observed lane has weight');

/* an unknown lane is DROPPED (never coerced into a bucket) — a tool with its own floor story can't pollute the read */
const u = W.fresh(); W.observe(u, { lane: 'banana' }, 0);
A.eq(u.total, 0, 'an unknown lane is a no-op (dropped, not coerced)');
A.eq(Object.keys(u.lanes).length, 0, 'an unknown lane writes nothing');

/* ---------- per-lane task-tag volume ---------- */
const tg = W.fresh();
W.observe(tg, { lane: 'dish', tag: 'research' }, 0);
W.observe(tg, { lane: 'dish', tag: 'research' }, 0);
W.observe(tg, { lane: 'dish', tag: 'code' }, 0);
A.eq(W.laneTag(tg, 'dish', 0), 'research', 'laneTag reports the dominant interest tag observed in the lane');
A.eq(tg.lanes.dish.tags.research, 2, 'per-lane tag tally counts each tagged fire');
A.eq(W.laneTag(W.fresh(), 'dish', 0), null, 'an empty lane has no dominant tag (no fabrication)');
/* an unknown tag folds into general, never dropped or stored verbatim */
const ut = W.fresh(); W.observe(ut, { lane: 'cabinet', tag: 'banana' }, 0);
A.eq(ut.lanes.cabinet.tags.general, 1, 'an unknown interest tag folds into general');

/* ---------- recency: a fresh lane outweighs a stale one ---------- */
const r = W.fresh();
W.observe(r, { lane: 'cabinet' }, 0);      // stale (t=0)
W.observe(r, { lane: 'dish' }, HL);        // fresh (t=HL)
A.ok(W.laneWeight(r, 'dish', HL) > W.laneWeight(r, 'cabinet', HL), 'the more recent lane dominates (EWMA recency)');
A.eq(W.summary(r, HL).dominant, 'dish', 'summary.dominant reflects recency');

/* ---------- vector: a normalized distribution ---------- */
const nv = W.vector(r, HL);
let sum = 0; for (const k of W.LANES) sum += nv[k];
A.ok(Math.abs(sum - 1) < 1e-9, 'the capability vector is a normalized distribution');
A.eq(W.vector(W.fresh(), 0).dish, 0, 'an empty histogram has a zero vector (fabricates no usage)');
A.eq(W.summary(W.fresh(), 0).dominant, null, 'a blank signal has no dominant lane');

/* ---------- calibrating threshold (shared floor with profile.js) ---------- */
const c = W.fresh();
for (let k = 0; k < N - 1; k++) W.observe(c, { lane: 'dish' }, 0);
A.eq(W.summary(c, 0).calibrating, true, 'below the sample floor: calibrating');
W.observe(c, { lane: 'dish' }, 0);
A.eq(W.summary(c, 0).calibrating, false, 'at the sample floor: a known read');
A.eq(W.summary(c, 0).samples, N, 'the legacy primitive still counts each explicit observation');

/* ---------- normalized run fold: tool-loop length cannot dominate ---------- */
const runs = W.fresh();
W.observeRun(runs, { lanes: ['workbench', 'workbench', 'cabinet'], tag: 'code' }, 0);
A.eq(runs.total, 1, 'one completed run advances calibration exactly once');
A.eq(runs.lanes.workbench.n, 1, 'duplicate tool calls in a lane collapse to one lane observation');
A.eq(runs.lanes.workbench.w, 0.5, 'a multi-lane run shares one unit of weight across its lanes');
A.eq(runs.lanes.cabinet.w, 0.5, 'the other unique lane receives the other half');
A.eq(runs.lanes.workbench.tags.code, 1, 'tag volume counts runs, not tool calls');
W.observeRun(runs, { lanes: ['dish'], tag: 'research' }, 0);
A.eq(runs.total, 2, 'a second completed run adds one sample regardless of tool count');
const noLane = W.fresh(); W.observeRun(noLane, { lanes: ['banana'] }, 0);
A.eq(noLane.total, 0, 'a completed run with no mapped capability lane fabricates no signal');

/* ---------- weighted + hostile folds ---------- */
const wt = W.fresh(); W.observe(wt, { lane: 'dish', weight: 3 }, 0);
A.eq(wt.lanes.dish.w, 3, 'a weighted observation folds at its weight');
A.eq(wt.lanes.dish.n, 1, 'weight does not inflate the sample count');
const gw = W.fresh(); W.observe(gw, { lane: 'dish', weight: -5 }, 0); W.observe(gw, { lane: 'cabinet', weight: 'x' }, 0);
A.eq(gw.lanes.dish.w, 1, 'a negative weight folds as 1');
A.eq(gw.lanes.cabinet.w, 1, 'a non-numeric weight folds as 1');
const inf = W.fresh(); W.observe(inf, { lane: 'dish', weight: Infinity }, 0);
A.eq(inf.lanes.dish.w, 1, 'observe rejects a non-finite weight (folds as 1)');
A.ok(Number.isFinite(W.vector(inf, 0).dish), 'the vector stays finite after a hostile weight');

/* absolute EWMA decay: an existing weight halves over one half-life BEFORE the new fold (1*0.5 + 1 = 1.5) */
const dec = W.fresh(); W.observe(dec, { lane: 'dish' }, 0); W.observe(dec, { lane: 'dish' }, HL);
A.ok(Math.abs(dec.lanes.dish.w - 1.5) < 1e-9, 'a stored weight decays by half over one half-life before re-folding');

/* ---------- hydrate: defensive load of a (possibly malformed/old) blob ---------- */
A.eq(W.hydrate(null).total, 0, 'hydrate(null) -> a fresh signal');
const h = W.hydrate({ lanes: { dish: { w: 5, n: 3, t: 0, tags: { research: 2 } } }, total: 3 });
A.eq(h.total, 3, 'hydrate carries a valid total');
A.eq(h.lanes.dish.w, 5, 'hydrate carries valid lane weights');
A.eq(h.lanes.dish.tags.research, 2, 'hydrate carries the per-lane tag tally');
const bad = W.hydrate({ lanes: { dish: 'nope', evil: { w: -1 }, banana: { w: 2 } }, total: -5 });
A.eq(bad.total, 0, 'hydrate clamps a negative total to 0');
A.eq(Object.keys(bad.lanes).length, 0, 'hydrate drops malformed + unknown lane entries');
const infH = W.hydrate({ lanes: { dish: { w: Infinity, n: 1, t: 0 } } });
A.ok(!infH.lanes.dish, 'hydrate drops a non-finite weight');

/* round-trip: fresh -> observe -> serialize(JSON) -> hydrate preserves the model */
const rt = W.fresh(); W.observe(rt, { lane: 'dish', tag: 'research' }, 0); W.observe(rt, { lane: 'workbench', tag: 'code' }, 0);
const re = W.hydrate(JSON.parse(JSON.stringify(rt)));
A.eq(re.total, 2, 'round-trip preserves total');
A.eq(re.lanes.dish.w, rt.lanes.dish.w, 'round-trip preserves weights');
A.eq(re.lanes.workbench.tags.code, 1, 'round-trip preserves per-lane tags');

/* forget wipes the histogram entirely */
const f = W.forget();
A.eq(f.total, 0, 'forget zeroes the histogram');
A.eq(Object.keys(f.lanes).length, 0, 'forget clears every lane');

A.report('worksignal');
