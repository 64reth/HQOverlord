/* node test/stationquests.test.js — the PURE station-quest generator (frontend/app/stationquests.js).
   Locks the G1b contract: one entry per (agent, capability) — repeats NEVER duplicate; completion is the
   real gap closing (refresh flips done only when the injected granted() predicate says the floor grants it —
   placement, never a claim); dismissal = STOP FOREVER (survives hydrate, blocks re-record); the projection
   rides the shared Quests shape (kind 'station-gap', open-before-done); deterministic (injected clock). */
'use strict';
const A = require('./_assert.js');
const SQ = require('../frontend/app/stationquests.js');

/* ---------- defensive ---------- */
A.eq(SQ.project(null), [], 'project(null) → [] — never throws');
A.eq(SQ.openCount(null), 0, 'openCount(null) → 0');
A.eq(SQ.record(null, { agentId: 'a', cap: 'dish' }, 1), null, 'record on a null state is refused');
A.eq(SQ.refresh(null, () => true, 1), [], 'refresh on a null state closes nothing');
A.eq(SQ.dismiss(null, 'x', 1), false, 'dismiss on a null state is refused');

/* ---------- record: mint + dedup ---------- */
const s = SQ.fresh();
const g = { agentId: 'nova', cap: 'dish', capLabel: 'WEB', propLabel: 'DISH', agentLabel: 'NOVA' };
const id = SQ.record(s, g, 1000);
A.eq(id, 'sq:nova:dish', 'the gap id is the stable (agent, capability) key');
A.eq(SQ.openCount(s), 1, 'one open gap');
A.eq(SQ.record(s, g, 2000), id, 'a repeat of the same reach returns the same id');
A.eq(SQ.openCount(s), 1, 'repeats NEVER duplicate — still one gap');
A.eq(s.gaps[id].firstSeenAt, 1000, 'a repeat never resets firstSeenAt (history preserved)');
SQ.record(s, { agentId: 'nova', cap: 'studio', capLabel: 'IMAGES', propLabel: 'STUDIO', agentLabel: 'NOVA' }, 3000);
SQ.record(s, { agentId: 'rex', cap: 'dish', capLabel: 'WEB', propLabel: 'DISH', agentLabel: 'REX' }, 4000);
A.eq(SQ.openCount(s), 3, 'different (agent, cap) pairs each get their own gap');
A.eq(SQ.record(s, { agentId: '', cap: 'dish' }, 1), null, 'no agent → no gap');
A.eq(SQ.record(s, { agentId: 'a', cap: '' }, 1), null, 'no cap → no gap');

/* ---------- projection: the shared Quests shape, open-before-done, honest text ---------- */
let proj = SQ.project(s);
A.eq(proj.length, 3, 'projection carries all live gaps');
A.ok(proj.every(q => q.kind === 'station-gap'), 'kind is station-gap (one quest shape, never a parallel system)');
A.ok(proj.every(q => q.status === 'open'), 'all open before anything closes');
const novaDish = proj.find(q => q.id === 'sq:nova:dish');
A.ok(/NOVA reached for WEB/.test(novaDish.title) && /place a DISH/.test(novaDish.title), 'the title names the agent, the power, and the LIVE catalog prop label');
A.ok(proj.every(q => typeof q.reward === 'string' && q.reward.length > 0), 'every quest names a real reward');
A.ok(!proj.some(q => /\bXP\b|points|coins/i.test(q.reward)), 'no quest rewards a fake currency');

/* ---------- refresh: completion is the REAL gap closing (placement), never a claim ---------- */
let closed = SQ.refresh(s, e => false, 5000);
A.eq(closed.length, 0, 'nothing granted → nothing closes');
closed = SQ.refresh(s, e => e.agentId === 'nova' && e.cap === 'dish', 6000);
A.eq(closed.length, 1, 'the granted gap closes');
A.eq(closed[0].completedAt, 6000, 'completedAt is stamped with the injected clock');
A.eq(SQ.openCount(s), 2, 'open count drops');
closed = SQ.refresh(s, e => e.agentId === 'nova' && e.cap === 'dish', 7000);
A.eq(closed.length, 0, 'an already-closed gap never re-closes (exactly one open→done edge)');
proj = SQ.project(s);
A.eq(proj.find(q => q.id === 'sq:nova:dish').status, 'done', 'a closed gap projects as done');
const statuses = proj.map(q => q.status);
A.eq(statuses.indexOf('done') > statuses.lastIndexOf('open'), true, 'open before done in the projection');
A.eq(SQ.record(s, g, 8000), 'sq:nova:dish', 'recording a stale detection after closure is a label-only no-op');
A.eq(s.gaps['sq:nova:dish'].completedAt, 6000, '…the completion stands');

/* ---------- dismissal: stop forever ---------- */
A.eq(SQ.dismiss(s, 'sq:rex:dish', 9000), true, 'dismissing an open gap takes');
A.eq(SQ.dismiss(s, 'sq:rex:dish', 9100), false, 'a second dismiss is refused (idempotent)');
A.eq(SQ.isDismissed(s, 'sq:rex:dish'), true, 'isDismissed reads back');
A.eq(SQ.project(s).some(q => q.id === 'sq:rex:dish'), false, 'a dismissed gap NEVER re-renders');
A.eq(SQ.openCount(s), 1, 'a dismissed gap is not open');
A.eq(SQ.record(s, { agentId: 'rex', cap: 'dish', capLabel: 'WEB', propLabel: 'DISH' }, 9500), null, 'the same reach after dismissal NEVER re-mints (stop forever)');
closed = SQ.refresh(s, () => true, 9600);
A.eq(closed.some(e => e.agentId === 'rex'), false, 'a dismissed gap never closes/celebrates either');

/* ---------- hydrate: dismissal + completion survive; junk is dropped ---------- */
const s2 = SQ.hydrate(JSON.parse(JSON.stringify(s)));
A.eq(SQ.isDismissed(s2, 'sq:rex:dish'), true, 'dismissal survives a save/load round-trip');
A.eq(s2.gaps['sq:nova:dish'].completedAt, 6000, 'completion survives a round-trip');
A.eq(SQ.record(s2, { agentId: 'rex', cap: 'dish' }, 10000), null, 'post-reload, the dismissed gap still never re-mints');
const junk = SQ.hydrate({ gaps: { 'sq:x:y': { agentId: 'x', cap: 'y', firstSeenAt: 'NaN' }, 'ok': { agentId: 'a', cap: 'dish', firstSeenAt: 5 }, bad: null, worse: 42 } });
A.eq(Object.keys(junk.gaps).length, 1, 'entries with no finite firstSeenAt / non-objects are dropped');
A.ok(SQ.hydrate(null) && SQ.hydrate('garbage') && SQ.hydrate(7), 'hydrate is total over junk');

/* ---------- id sanitization: a hostile agentId can't break the key grammar ---------- */
const wild = SQ.record(SQ.fresh(), { agentId: 'we ird/EVIL:', cap: 'dish' }, 1);
A.ok(/^sq:[A-Za-z0-9_.\-]+:dish$/.test(wild), 'ids are sanitized to the safe grammar');

/* ---------- determinism ---------- */
A.eq(JSON.stringify(SQ.project(s)), JSON.stringify(SQ.project(s)), 'project is deterministic for the same state');

A.report('stationquests.test');
