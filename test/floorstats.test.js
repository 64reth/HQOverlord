/* node test/floorstats.test.js — the FACTORY-FLOOR economy fold. Pure accumulator: REAL harness
   events (agent.cost / agent.run.end / workitem.delivered) → one render-agnostic floor snapshot
   (spend, yield, slag, cache%). The honesty rule under test mirrors ctxgauge: a metric with no
   samples reports known:false (the HUD shows "—"), never a fabricated number; and 'cancelled' — a
   human stop, not waste — never inflates the slag tally. */
'use strict';
const A = require('./_assert.js');
const FloorStats = require('../frontend/app/floorstats.js');

// ---- a fresh floor knows nothing: no fabricated yield/cache, clean, zero spend ----
const f = FloorStats.create();
let s = f.snapshot();
A.eq(s.spendUsd, 0, 'fresh: no spend');
A.eq(s.runs, 0, 'fresh: no decisive runs');
A.ok(s.yieldKnown === false, 'fresh: yield unknown (no samples)');
A.ok(s.cacheKnown === false, 'fresh: cache unknown (no tokens)');
A.ok(s.clean === true, 'fresh: clean (no slag)');

// ---- agent.cost folds RECONCILED spend + tokens + cached tokens (and sums across calls) ----
f.onEvent('agent.cost', { usd: 0.02, tokensIn: 1000, tokensOut: 300, cachedTokens: 400, reconciled: true });
f.onEvent('agent.cost', { usd: 0.03, tokensIn: 1000, tokensOut: 200, cachedTokens: 200 });
s = f.snapshot();
A.ok(Math.abs(s.spendUsd - 0.05) < 1e-9, 'spend sums across agent.cost events');
A.eq(s.tokensIn, 2000, 'tokensIn sums');
A.eq(s.cachedTokens, 600, 'cachedTokens sums');
A.ok(s.cacheKnown === true, 'cache known once tokens seen');
A.eq(s.cachePct, 30, 'cache% = 600/2000 = 30%');

// ---- agent.run.end: done banks a PRODUCT; the four waste reasons bank SLAG + its wasted $ ----
f.onEvent('agent.run.end', { reason: 'done', usd: 0.02 });
f.onEvent('agent.run.end', { reason: 'done', usd: 0.02 });
f.onEvent('agent.run.end', { reason: 'done', usd: 0.01 });
f.onEvent('agent.run.end', { reason: 'budget', usd: 0.10 });
s = f.snapshot();
A.eq(s.products, 3, 'three done runs -> 3 products');
A.eq(s.slag, 1, 'one budget run -> 1 slag');
A.ok(Math.abs(s.slagUsd - 0.10) < 1e-9, 'slag$ = the wasted run usd');
A.eq(s.runs, 4, 'decisive runs = products + slag');
A.ok(s.yieldKnown === true, 'yield known once a run decided');
A.eq(s.yieldPct, 75, 'yield% = 3/4 = 75%');
A.ok(s.clean === false, 'slag>0 -> not clean');

// ---- all four waste reasons count as slag; cancelled is NEUTRAL (never slag, never a run) ----
const g = FloorStats.create();
for (const r of ['max_iters', 'error', 'refusal']) g.onEvent('agent.run.end', { reason: r, usd: 0.01 });
g.onEvent('agent.run.end', { reason: 'cancelled', usd: 0.5 });
s = g.snapshot();
A.eq(s.slag, 3, 'max_iters + error + refusal = 3 slag');
A.eq(s.products, 0, 'no products');
A.eq(s.runs, 3, 'cancelled is not a decisive run');
A.ok(Math.abs(s.slagUsd - 0.03) < 1e-9, 'cancelled $ never enters slag$');

// ---- workitem.delivered increments throughput; unknown events are ignored (no throw, no change) ----
const h = FloorStats.create();
h.onEvent('workitem.delivered', { workitemId: 'w1' });
h.onEvent('workitem.delivered', { workitemId: 'w2' });
A.notThrows(() => h.onEvent('agent.token', { delta: 'x' }), 'unknown event ignored, no throw');
A.notThrows(() => h.onEvent('totally.made.up', null), 'unknown event w/ null payload ignored');
s = h.snapshot();
A.eq(s.delivered, 2, 'two deliveries counted');
A.eq(s.runs, 0, 'deliveries are not runs');

// ---- defensive coercion: garbage/missing fields never produce NaN ----
const j = FloorStats.create();
j.onEvent('agent.cost', { usd: 'nope', tokensIn: undefined, cachedTokens: null });
j.onEvent('agent.cost', {});
s = j.snapshot();
A.ok(isFinite(s.spendUsd) && s.spendUsd === 0, 'garbage usd -> 0, not NaN');
A.ok(isFinite(s.cachePct) && s.cachePct === 0, 'no tokens -> cache% 0, not NaN');
A.ok(s.cacheKnown === false, 'still unknown after junk');

// ---- THROUGHPUT + DWELL: real wall-clock event timestamps fold into items/min + time-on-line ----
const k = FloorStats.create();
let ss = k.snapshot(10000);
A.eq(ss.thruOutPerMin, 0, 'fresh: no throughput');
A.ok(ss.dwellKnown === false, 'fresh: dwell unknown');
// place w1 @ t=1000, deliver @ t=4000 -> dwell 3s; place w2 @ t=2000, deliver @ t=2500 -> dwell 0.5s
k.onEvent('workitem.placed', { workitemId: 'w1' }, 1000);
k.onEvent('workitem.placed', { workitemId: 'w2' }, 2000);
k.onEvent('workitem.delivered', { workitemId: 'w1' }, 4000);
k.onEvent('workitem.delivered', { workitemId: 'w2' }, 2500);
ss = k.snapshot(5000);
A.eq(ss.thruInPerMin, 2, 'two placements inside the 60s window');
A.eq(ss.thruOutPerMin, 2, 'two deliveries inside the window');
A.ok(ss.dwellKnown === true, 'dwell known after a paired delivery');
A.ok(Math.abs(ss.avgDwellSec - 1.75) < 1e-9, 'avg dwell = (3.0s + 0.5s)/2 = 1.75s');
// the window slides: anchored far past the events, the rate decays to 0 (no fabricated steady rate)
A.eq(k.snapshot(100000).thruOutPerMin, 0, 'throughput decays to 0 once events age out of the window');
// a delivery with no matching placement still counts for throughput but contributes no dwell
const m = FloorStats.create();
m.onEvent('workitem.delivered', { workitemId: 'orphan' }, 1000);
ss = m.snapshot(1000);
A.eq(ss.thruOutPerMin, 1, 'unpaired delivery still counts toward throughput');
A.ok(ss.dwellKnown === false, 'unpaired delivery contributes no dwell');
// untimed events (no nowMs, no ts) fold into totals but never corrupt the time window
const u = FloorStats.create();
u.onEvent('workitem.delivered', { workitemId: 'x' });
ss = u.snapshot();
A.eq(ss.delivered, 1, 'untimed delivery still tallied');
A.ok(isFinite(ss.thruOutPerMin), 'untimed -> throughput is a finite number');

// ---- QUEUE backlog: queue.status folds into a live total across queues; drains and clamps ----
const q = FloorStats.create();
A.eq(q.snapshot().queueDepth, 0, 'fresh: no backlog');
q.onEvent('queue.status', { queueId: 'a', depth: 2 });
q.onEvent('queue.status', { queueId: 'b', depth: 1 });
A.eq(q.snapshot().queueDepth, 3, 'backlog = sum across queues');
q.onEvent('queue.status', { queueId: 'a', depth: 0 });   // queue a drained
A.eq(q.snapshot().queueDepth, 1, 'a drained -> backlog drops to just b');
q.onEvent('queue.status', { queueId: 'a', depth: -5 });  // garbage depth clamps to 0, never negative
A.eq(q.snapshot().queueDepth, 1, 'negative depth clamps to 0');
A.notThrows(() => q.onEvent('queue.status', {}), 'queue.status with no queueId is ignored, no throw');
q.reset();
A.eq(q.snapshot().queueDepth, 0, 'reset clears the backlog');

// ---- costWeight: a run's REAL reconciled $ -> a clamped 0..1 product-crate mass + a coarse band ----
A.eq(FloorStats.costWeight(0).band, 'light', 'zero cost -> light pebble');
A.ok(FloorStats.costWeight(0).weight === 0.12, 'zero cost -> the floor weight');
A.ok(FloorStats.costWeight(-1).weight === 0.12, 'negative -> floor, not NaN');
A.ok(FloorStats.costWeight(NaN).band === 'light', 'NaN -> light, no throw');
A.eq(FloorStats.costWeight(0.005).band, 'light', '$0.005 -> light');
A.eq(FloorStats.costWeight(0.05).band, 'mid', '$0.05 -> mid');
A.eq(FloorStats.costWeight(0.4).band, 'heavy', '$0.40 -> heavy');
A.ok(FloorStats.costWeight(0.5).weight === 1, '$0.50 caps at full mass');
A.ok(FloorStats.costWeight(5).weight === 1, 'beyond the cap clamps to 1');
A.ok(FloorStats.costWeight(0.1).weight > FloorStats.costWeight(0.01).weight, 'monotonic: pricier run -> heavier crate');

// ---- reset wipes back to the fresh, knows-nothing state ----
f.reset();
s = f.snapshot();
A.eq(s.spendUsd, 0, 'reset clears spend');
A.eq(s.runs, 0, 'reset clears runs');
A.ok(s.yieldKnown === false && s.cacheKnown === false, 'reset returns to honest-unknown');
k.reset();
ss = k.snapshot(5000);
A.eq(ss.thruOutPerMin, 0, 'reset clears throughput');
A.ok(ss.dwellKnown === false, 'reset clears dwell');

// ---- (H3.1) provider.fallback folds into a visible failover counter + last-failover ----
{
  const ff = FloorStats.create();
  A.eq(ff.snapshot().failovers, 0, 'fresh: no failovers');
  A.ok(ff.snapshot().lastFailover === null, 'fresh: no last failover');
  ff.onEvent('provider.fallback', { fromModel: 'm1', toModel: 'm2', reason: 'rate_limit', rotate: true });
  ff.onEvent('provider.fallback', { fromModel: 'm2', toModel: 'm3', reason: 'overloaded', rotate: false });
  const fs = ff.snapshot();
  A.eq(fs.failovers, 2, 'failovers counted (a mid-run model/credential switch is now visible)');
  A.eq(fs.lastFailover.toModel, 'm3', 'the last failover target is recorded');
  A.eq(fs.lastFailover.reason, 'overloaded', 'the last failover reason is recorded');
  A.eq(fs.lastFailover.rotate, false, 'the last failover rotate flag is recorded');
}

A.report('floorstats.test');
