/* node test/understandingstore.test.js — the live wiring around the pure understanding engine
   (frontend/app/understandingstore.js). Stubs the sibling globals (DossierStore / ProfileStore /
   GoalStore+Goals / U.bus) and locks: the read composes overall confidence from live dossier beliefs;
   the active goal + real progress ride along (null when no goal); a clean HERO run recomputes and flags
   a RISE when understanding climbed (the pulse trigger); a non-done / non-hero run is ignored; and
   subscribers are notified immediately + on every refresh. Clock injected. */
'use strict';
const A = require('./_assert.js');

// ---- stub the browser globals the store reads (must exist BEFORE any method call; the IIFE reads them lazily) ----
global.Understanding = require('../frontend/app/understanding.js');

const dims = { goals: [], ambition: [], pain: [], identity: [], stack: [], style: [], standing_orders: [] };
global.DossierStore = { beliefs: (k) => dims[k] || [] };
function belief(text, source) { return { id: 'cd_x', text, source: source || 'commander', createdAt: 1000, updatedAt: 1000, pinned: false }; }

let samples = 3;
global.ProfileStore = { summary: () => ({ samples }) };

let activeGoal = null;
global.Goals = {
  progress: (g) => ({ done: g._done, total: g._total, pct: Math.round((g._done / g._total) * 100) }),
  nextMilestone: (g) => (g._next ? { text: g._next } : null)
};
global.GoalStore = { activeGoal: () => activeGoal };

// a tiny synchronous bus stub
const handlers = {};
global.U = { bus: { on: (name, fn) => { (handlers[name] = handlers[name] || []).push(fn); } } };
function emit(name, p) { for (const fn of (handlers[name] || [])) fn(p); }

// a tiny localStorage stub so the R2 corroboration persistence is locked by this test too
const lsMap = {};
global.localStorage = {
  getItem: (k) => (k in lsMap ? lsMap[k] : null),
  setItem: (k, v) => { lsMap[k] = String(v); },
  removeItem: (k) => { delete lsMap[k]; }
};

const { UnderstandingStore } = require('../frontend/app/understandingstore.js');

/* ---------- init: baseline read, no pulse on resume ---------- */
dims.goals = [belief('ship the harness to a thousand builders')];
UnderstandingStore.init({ now: () => 5000 });
let r = UnderstandingStore.read();
A.ok(r && r.overall > 0, 'the read composes a positive overall from a live dossier belief');
A.eq(r.rose, false, 'the baseline read on init never pulses (no rise on resume)');
A.eq(r.workSamples, 3, 'the work-observation count passes through from ProfileStore');
A.eq(r.goal, null, 'no active goal → goal is null (never a fabricated heading)');

/* ---------- a clean HERO run that sharpened understanding flags a RISE ---------- */
dims.ambition = [belief('launch the newsletter')];   // new belief → understanding climbs
emit('agent.run.end', { reason: 'done', agentId: 'agent' });
r = UnderstandingStore.read();
A.ok(r.rose, 'a clean hero run that raised understanding flags rose=true (the pulse trigger)');
const afterRise = r.overall;

/* a subsequent run with NO change does not pulse */
emit('agent.run.end', { reason: 'done', agentId: 'agent' });
r = UnderstandingStore.read();
A.eq(r.rose, false, 'a run that did not raise understanding does not pulse');
A.eq(r.overall, afterRise, 'overall is stable when nothing changed');

/* ---------- a non-hero / non-done run is ignored (no recompute) ---------- */
dims.pain = [belief('writing standup notes by hand')];   // change the world…
emit('agent.run.end', { reason: 'done', agentId: 'worker-2' });   // …but a summoned worker must not move the model
A.eq(UnderstandingStore.read().overall, afterRise, 'a summoned-worker run never recomputes the Commander model');
emit('agent.run.end', { reason: 'error', agentId: 'agent' });     // a failed hero run is not a clean signal
A.eq(UnderstandingStore.read().overall, afterRise, 'a non-done run never recomputes');
// a clean hero run now DOES fold the pain belief in
emit('agent.run.end', { reason: 'done', agentId: 'agent' });
A.ok(UnderstandingStore.read().overall > afterRise, 'the next clean hero run folds the intervening belief');

/* ---------- the active goal + REAL progress ride along ---------- */
activeGoal = { text: 'ship the harness to a thousand builders', _done: 2, _total: 5, _next: 'self-serve onboarding' };
r = UnderstandingStore.refresh(false);
A.eq(r.goal.text, 'ship the harness to a thousand builders', 'the read carries the active goal text');
A.eq(r.goal.done, 2, 'the read carries REAL milestone progress (done)');
A.eq(r.goal.total, 5, 'the read carries REAL milestone progress (total)');
A.eq(r.goal.next, 'self-serve onboarding', 'the read carries the next milestone');

/* ---------- subscribe: notified immediately + on refresh ---------- */
let got = null, calls = 0;
const unsub = UnderstandingStore.subscribe((u) => { got = u; calls++; });
A.ok(got && calls === 1, 'a subscriber is notified immediately with the current read');
UnderstandingStore.refresh(false);
A.eq(calls, 2, 'a subscriber is notified on every refresh');
unsub();
UnderstandingStore.refresh(false);
A.eq(calls, 2, 'an unsubscribed listener stops receiving reads');

/* ---------- R2: ratings feed the style-model confidence (signed, persisted, clamped) ---------- */
dims.style = [belief('terse, run-with-it', 'study')];
UnderstandingStore.refresh(false);
const styleBase = UnderstandingStore.read().dims.style.conf;
A.eq(UnderstandingStore.noteRating('great'), 1, 'a 👍 verdict adds +1 style corroboration');
A.ok(UnderstandingStore.read().dims.style.conf > styleBase, 'a 👍 raises the style-model confidence');
A.eq(UnderstandingStore.noteRating('ok'), null, 'a 👌 is a shrug, not evidence');
A.eq(UnderstandingStore.noteRating('miss'), 0, 'a 👎 subtracts (back to net 0)');
A.eq(UnderstandingStore.noteRating('miss'), -1, 'a second 👎 goes negative (counter-evidence)');
A.ok(UnderstandingStore.read().dims.style.conf < styleBase, 'net counter-evidence drags style confidence below its belief-only base');
// clamped: a pile of downvotes can drain, never pin the model at -∞
for (let i = 0; i < 20; i++) UnderstandingStore.noteRating('miss');
A.eq(UnderstandingStore.noteRating('miss'), -6, 'corroboration clamps at ±6');
// persisted: a reload (fresh require) rehydrates the signed count
A.ok(lsMap['starnet.understanding.v1'] && lsMap['starnet.understanding.v1'].indexOf('style') >= 0, 'corroboration persists to its own key');
delete require.cache[require.resolve('../frontend/app/understandingstore.js')];
const US2 = require('../frontend/app/understandingstore.js').UnderstandingStore;
US2.init({ now: () => 6000 });
A.ok(US2.read().dims.style.conf < styleBase, 'a reload rehydrates the drained style confidence (the doubt survives)');

/* R3 probes share the mechanism; reset() clears the learned corroboration */
A.eq(US2.noteProbe('ambition', true), 1, 'an accepted probe corroborates its aimed dimension');
A.eq(US2.noteProbe('ambition', false), 0, 'a declined probe is counter-evidence');
A.eq(US2.noteEvidence('nonsense', 1), null, 'an unknown dimension is rejected');
US2.reset();
A.eq(lsMap['starnet.understanding.v1'], undefined, 'reset clears the persisted corroboration (new-hero path)');

/* ---------- R3: probeTarget aims at a SAGGING north-star-critical belief ---------- */
const DAY = 24 * 60 * 60 * 1000;
US2.init({ now: () => 1000 + 90 * DAY });   // 90 days on: the t=1000 beliefs have decayed well below the 0.45 floor
dims.goals = [belief('ship the harness to a thousand builders')];
dims.ambition = []; dims.pain = []; dims.identity = []; dims.stack = []; dims.style = []; dims.standing_orders = [];
US2.refresh(false);
const pt = US2.probeTarget();
A.ok(pt && pt.dim === 'goals', 'probeTarget aims at the stale goals belief');
A.eq(pt.text, 'ship the harness to a thousand builders', 'probeTarget carries the belief text for the directive');
// the probe outcome moves the aimed dim (the full R3 loop in one line)
const sagged = US2.read().dims.goals.conf;
US2.noteProbe('goals', true);
A.ok(US2.read().dims.goals.conf > sagged, 'an accepted probe re-corroborates the sagging belief');
US2.reset();
// a FRESH belief is never probed
dims.goals = [{ id: 'cd_y', text: 'ship it', source: 'commander', createdAt: 1000 + 90 * DAY, updatedAt: 1000 + 90 * DAY, pinned: false }];
US2.refresh(false);
A.eq(US2.probeTarget(), null, 'a fresh well-grounded belief is never probed (no tic)');
// blank criticals are never probed (blanks belong to curiosity)
dims.goals = [];
US2.refresh(false);
A.eq(US2.probeTarget(), null, 'blank dims are never probed — curiosity owns blanks');

A.report('understandingstore.test');
