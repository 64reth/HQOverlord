/* node test/pride.test.js — the LIFETIME STATION RECORD engine (G3a / Layer 6): durable pride counters.
   HONEST by construction: a counter with no real sample reports known:false (surface shows "—"), the
   founding instant is stamped ONCE and never moves (monotonic), and total agent-work minutes are the SUM of
   REAL run durations (start→end paired by runId, injected clock) — an unmatched end is never guessed. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/pride.js');

// ---- hydrate: sane defaults from null / corrupt blobs ----
let s = P.hydrate(null);
let snap = P.snapshot(s);
A.eq(snap.founded, false, 'a fresh station is not yet founded');
A.eq(snap.foundedAt, null, 'unfounded → foundedAt is null (surface formats its own date)');
A.eq(snap.tasksKnown, false, 'no task sample yet → tasks unknown ("—")');
A.eq(snap.deliverablesKnown, false, 'no deliverable sample yet → unknown');
A.eq(snap.routinesKnown, false, 'no routine sample yet → unknown');
A.eq(snap.workKnown, false, 'no work sample yet → unknown');
s = P.hydrate({ tasks: 'x', deliverables: -4, routines: 2.9, workMs: 'bad', foundedAt: 'nope', open: 'not-an-obj' });
snap = P.snapshot(s);
A.eq(snap.tasks, 0, 'corrupt tasks sanitizes to 0');
A.eq(snap.deliverables, 0, 'negative deliverables clamps to 0');
A.eq(snap.routines, 2, 'fractional routines floors');
A.eq(snap.founded, false, 'corrupt foundedAt → unfounded');

// ---- founding: stamped once, monotonic, only by a REAL event ----
s = P.hydrate(null);
s = P.fold(s, 'some.unknown.heartbeat', {}, 1000);
A.eq(P.snapshot(s).founded, false, 'an unknown/ambient event NEVER founds the station (no fake birthday)');
s = P.fold(s, 'agent.run.end', { reason: 'done', runId: 'r1' }, 5000);
A.eq(P.snapshot(s).foundedAt, 5000, 'the first REAL event stamps the founding instant');
s = P.fold(s, 'workitem.delivered', { workitemId: 'w1' }, 9000);
A.eq(P.snapshot(s).foundedAt, 5000, 'a later event never moves the founding instant (monotonic)');

// ---- tasks: only clean (done) runs count ----
s = P.hydrate(null);
s = P.fold(s, 'agent.run.end', { reason: 'done', runId: 'a' }, 1000);
s = P.fold(s, 'agent.run.end', { reason: 'error', runId: 'b' }, 2000);
s = P.fold(s, 'agent.run.end', { reason: 'max_iters', runId: 'c' }, 3000);
snap = P.snapshot(s);
A.eq(snap.tasks, 1, 'only a clean done run banks a lifetime task (slag never inflates the count)');
A.eq(snap.tasksKnown, true, 'a real done sample marks tasks known');

// ---- deliverables + routines: their own real events ----
s = P.hydrate(null);
s = P.fold(s, 'workitem.delivered', { workitemId: 'w1' }, 1000);
s = P.fold(s, 'workitem.delivered', { workitemId: 'w2' }, 2000);
s = P.fold(s, 'cron.fire', { jobId: 'j1', runId: 'r9' }, 3000);
snap = P.snapshot(s);
A.eq(snap.deliverables, 2, 'each workitem.delivered banks a lifetime deliverable');
A.eq(snap.deliverablesKnown, true, 'delivered marks deliverables known');
A.eq(snap.routines, 1, 'each cron.fire banks a lifetime routine fire');
A.eq(snap.routinesKnown, true, 'cron.fire marks routines known');

// ---- work minutes: SUM of REAL durations, paired start→end by runId; unmatched end guessed nothing ----
s = P.hydrate(null);
s = P.fold(s, 'agent.run.start', { runId: 'r1' }, 1000);
s = P.fold(s, 'agent.run.end', { reason: 'done', runId: 'r1' }, 1000 + 120000);   // 2 min
A.eq(P.snapshot(s).workMinutes, 2, 'a paired start→end contributes its REAL elapsed minutes');
A.eq(P.snapshot(s).workKnown, true, 'a real duration sample marks work known');
s = P.fold(s, 'agent.run.start', { runId: 'r2' }, 5000);
s = P.fold(s, 'agent.run.end', { reason: 'done', runId: 'r2' }, 5000 + 180000);   // +3 min
A.eq(P.snapshot(s).workMinutes, 5, 'durations SUM across runs (2 + 3 = 5)');
// an end with no matching start adds a task but no time (never guessed)
s = P.fold(s, 'agent.run.end', { reason: 'done', runId: 'orphan' }, 9999999);
A.eq(P.snapshot(s).workMinutes, 5, 'an unmatched end contributes ZERO work time — nothing is guessed');
A.eq(P.snapshot(s).tasks, 3, '…but the orphan end still counts as a completed task');

// ---- the in-flight ring is bounded (a start with no end can never leak unbounded) ----
s = P.hydrate(null);
for (let i = 0; i < P.OPEN_CAP + 50; i++) s = P.fold(s, 'agent.run.start', { runId: 'k' + i }, 1000 + i);
A.ok(Object.keys(P.hydrate(s).open).length <= P.OPEN_CAP, 'the in-flight start ring is capped (no unbounded leak)');

// ---- purity: fold returns a NEW object, never mutates the input ----
const before = P.hydrate(null);
const frozen = JSON.stringify(before);
P.fold(before, 'agent.run.end', { reason: 'done', runId: 'z' }, 1000);
A.eq(JSON.stringify(before), frozen, 'fold is pure — it never mutates the state passed in');

A.report('pride.test');
