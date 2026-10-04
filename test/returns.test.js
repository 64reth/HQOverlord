/* node test/returns.test.js — the RETURN RITUAL engine (G2 / Layer 5): which finished runs count as
   unattended work, the lastSeenAt heartbeat that defines "away", and the pending-crate ledger.
   The once-per-anything guarantees are PURE here: a fresh state digests nothing (no prior attendance),
   and a folded run is never re-listed (dismissed = gone, the anti-nag law). */
'use strict';
const A = require('./_assert.js');
const R = require('../frontend/app/returns.js');

const run = (o) => Object.assign({ runId: 'r1', agentId: 'agent', reason: 'done', turns: 3, tokens: 100, usd: 0.02, title: 'do the thing', ts: 2000 }, o || {});

// ---- hydrate: sane defaults from null / corrupt blobs ----
let s = R.hydrate(null);
A.eq(s.lastSeenAt, 0, 'fresh state starts unattended-never (lastSeenAt 0)');
A.eq(s.pending.length, 0, 'fresh state has no pending crates');
s = R.hydrate({ lastSeenAt: 'garbage', pending: 'nope', digested: [1, null, 'ok'] });
A.eq(s.lastSeenAt, 0, 'corrupt lastSeenAt sanitizes to 0');
A.eq(s.pending.length, 0, 'corrupt pending sanitizes to []');
A.eq(s.digested.join(','), 'ok', 'digested keeps only real string ids');

// ---- heartbeat: monotonic attendance stamp ----
s = R.heartbeat(R.hydrate(null), 5000);
A.eq(s.lastSeenAt, 5000, 'heartbeat stamps the attended moment');
A.eq(R.heartbeat(s, 4000).lastSeenAt, 5000, 'a stale tick can never move attendance backwards');

// ---- unattended: the digest filter ----
A.eq(R.unattended(R.hydrate(null), [run({ ts: 99999 })]).length, 0,
  'a FRESH state (first-ever session) digests NOTHING — no prior attendance means nothing was missed');
s = R.heartbeat(R.hydrate(null), 1000);
 A.eq(R.unattended(s, [run({ internal: true })]).length, 0, 'Internal recommendation reasoning is never presented as completed user work');
let rows = R.unattended(s, [run({ runId: 'a', ts: 2000 }), run({ runId: 'b', ts: 500 })]);
A.eq(rows.length, 1, 'only runs AFTER lastSeenAt are unattended');
A.eq(rows[0].runId, 'a', 'the attended-era run (ts 500 <= 1000) is excluded');
rows = R.unattended(s, [run({ runId: 'x', ts: 2000, reason: 'error' }), run({ runId: 'y', ts: 2000, reason: 'max_iters' }), run({ runId: 'z', ts: 2000 })]);
A.eq(rows.map(r => r.runId).join(','), 'z', 'only clean (done) runs digest — slag has its own post-mortem path');
A.eq(R.unattended(s, null).length, 0, 'a missing runs list is tolerated');
rows = R.unattended(s, [run({ runId: 'long', ts: 2000, title: '  x '.repeat(200) })]);
A.ok(rows[0].title.length <= 90, 'titles are whitespace-folded + capped');
// DIGEST_CAP is presentation-only: every eligible row is returned for durable crating.
const many = []; for (let i = 0; i < 20; i++) many.push(run({ runId: 'm' + i, ts: 3000 - i }));
A.eq(R.unattended(s, many).length, 20, 'the digest engine never truncates rateable rows at the visual cap');

// ---- the explicit away boundary (REGRESSION: caught live by the g2proof driver) ----
// The store heartbeats to "now" the moment the app opens, THEN composes the digest — so unattended()
// must honor an explicit sinceMs (the PREVIOUS session's stamp), not the already-advanced live one.
s = R.heartbeat(R.hydrate(null), 1000);   // previous session stamped 1000
const prevSeen = s.lastSeenAt;
s = R.heartbeat(s, 50000);                // app open: live state is now "attended at 50000"
A.eq(R.unattended(s, [run({ runId: 'ov', ts: 2000 })]).length, 0,
  'against the LIVE stamp the overnight run looks attended (the bug shape)');
rows = R.unattended(s, [run({ runId: 'ov', ts: 2000 })], prevSeen);
A.eq(rows.length, 1, 'the explicit previous-session boundary lists the overnight run');
A.eq(R.unattended(s, [run({ runId: 'ov', ts: 2000 })], 0).length, 0,
  'an explicit 0 boundary (first-ever session) still digests nothing');

// ---- fold: listed once, NEVER re-listed (the anti-nag law, pure form) ----
s = R.heartbeat(R.hydrate(null), 1000);
rows = R.unattended(s, [run({ runId: 'a', ts: 2000 })]);
s = R.fold(s, rows);
A.eq(R.pendingCount(s), 1, 'a folded row becomes a pending crate');
A.eq(R.unattended(s, [run({ runId: 'a', ts: 2000 })]).length, 0,
  'a digested run never re-lists — even before any new heartbeat (dismissed = gone)');
// round-trip through persistence keeps the guarantee
A.eq(R.unattended(R.hydrate(JSON.parse(JSON.stringify(s))), [run({ runId: 'a', ts: 2000 })]).length, 0,
  'the never-re-list guarantee survives a save/load round-trip (next session too)');

// ---- resolve: rating collects the crate ----
s = R.resolve(s, 'a');
A.eq(R.pendingCount(s), 0, 'rating a run clears its crate');
A.eq(R.unattended(s, [run({ runId: 'a', ts: 2000 })]).length, 0, 'a resolved run stays digested (never re-lists)');

// ---- pending ledger: FIFO + capped ----
s = R.heartbeat(R.hydrate(null), 1000);
for (let i = 0; i < R.PENDING_CAP + 5; i++) s = R.fold(s, [{ runId: 'p' + i, agentId: 'agent', title: 't', usd: 0, turns: 1, ts: 2000 + i }]);
A.eq(R.pendingCount(s), R.PENDING_CAP, 'the pending ledger is capped');
A.eq(R.oldestPending(s).runId, 'p5', 'the cap drops the OLDEST crates first (FIFO)');
A.eq(R.oldestPending(R.hydrate(null)), null, 'no pending -> null (the OUTBOX renders nothing)');

// ---- matchRoutines: best-effort cosmetic naming ----
rows = [{ runId: 'a', title: 'summarize my inbox', routine: '' }, { runId: 'b', title: 'other', routine: '' }];
R.matchRoutines(rows, [{ name: 'Morning brief', prompt: '  summarize   my inbox ' }]);
A.eq(rows[0].routine, 'Morning brief', 'a cron-fired run (title === job prompt) gets its routine name');
A.eq(rows[1].routine, '', 'an unmatched run keeps its honest title only');
A.eq(R.matchRoutines(rows, null), rows, 'missing jobs list is tolerated');

A.report('returns.test');
