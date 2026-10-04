/* node test/mint-ledger.test.js — the PURE mint-ledger dedup gate + per-agent ledger + boot sweep (W6).
   Proves the disease from docs/AWAY_WORKSHOP_PLAN.md is cured: an agent can't re-create a routine it already
   made (exact OR near-dup name), a deleted routine is never resurrected, the ledger is FIFO-capped and pure
   (input never mutated), the "you already maintain: …" summary reads plainly, and the boot sweep collapses an
   exact (agentId, name, prompt) triple keeping the OLDEST. Deterministic — `now` injected, no wall clock. */
'use strict';
const A = require('./_assert.js');
const M = require('../sidecar/mint-ledger.js');

// ---- 1. normName: lowercase, strip non-alnum, collapse whitespace ----
{
  A.eq(M.normName('  ULTRON  Daily Operating Loop '), 'ultron daily operating loop', 'normName collapses + lowercases');
  A.eq(M.normName('ULTRON daily operating loop'), M.normName('  Ultron   Daily  Operating   Loop  '), 'trivial restatements fingerprint identically');
  A.eq(M.normName(null), '', 'null -> empty');
}

// ---- 2. isDup: exact normalized match AND Jaccard near-dup; distinct names are NOT dups ----
{
  A.ok(M.isDup('ULTRON daily operating loop', 'ultron  daily  operating  loop'), 'exact-normalized names are dups');
  A.ok(M.isDup('ULTRON daily operating loop', 'ULTRON operating loop daily routine'), 'reordered/near names are dups (Jaccard)');
  A.ok(!M.isDup('morning market brief', 'evening code review'), 'unrelated names are NOT dups');
  A.ok(!M.isDup('', 'anything'), 'empty name never a dup');
}

// ---- 3. dupOf: the GATE returns the existing live job (exact or near), else null ----
{
  const live = [
    { id: 'a', name: 'Morning market brief', agentId: 'agent' },
    { id: 'b', name: 'ULTRON daily operating loop', agentId: 'agent' }
  ];
  A.eq(M.dupOf('ultron daily operating loop', live).id, 'b', 'exact dup -> existing job b');
  A.eq(M.dupOf('ULTRON operating loop daily', live).id, 'b', 'near dup -> existing job b');
  A.eq(M.dupOf('quarterly planning digest', live), null, 'a genuinely new name mints (no dup)');
  A.eq(M.ANTI_RETRY, 'this routine already exists — do not recreate it', 'plain-language anti-retry line');
}

// ---- 4. ledger record: append, dedupe-by-fp with recency, FIFO cap, purity ----
{
  let led = M.load(null);
  A.eq(led, [], 'null loads to empty ledger');
  led = M.record(led, { title: 'Morning market brief', kind: 'routine' }, { now: 100 });
  led = M.record(led, { title: 'ULTRON daily operating loop', kind: 'routine' }, { now: 200 });
  A.eq(led.length, 2, 'two distinct creations recorded');
  const before = JSON.stringify(led);
  const led2 = M.record(led, { title: '  ultron daily operating loop ', kind: 'routine' }, { now: 300 });
  A.eq(JSON.stringify(led), before, 'record does not mutate its input (purity)');
  A.eq(led2.length, 2, 're-recording the same fp does not grow the ledger');
  A.eq(led2[led2.length - 1].at, 300, 'the re-record moves the entry to the tail with the new timestamp');
}

// ---- 5. markDeclined + isDeclined: a deleted creation is sticky, never re-minted ----
{
  let led = M.record(M.load(null), { title: 'ULTRON daily operating loop' }, { now: 100 });
  A.ok(!M.isDeclined(led, 'ULTRON daily operating loop'), 'freshly created is not declined');
  led = M.markDeclined(led, 'ultron  daily operating loop', { now: 200 });
  A.ok(M.isDeclined(led, 'ULTRON daily operating loop'), 'after delete the name is declined (sticky, normalized match)');
  // recording a create for a declined fp must NOT flip it back to created (the gate/isDeclined stays the block).
  led = M.record(led, { title: 'ULTRON daily operating loop' }, { now: 300 });
  A.ok(M.isDeclined(led, 'ULTRON daily operating loop'), 'a declined verdict survives a later record attempt');
  // markDeclined on an unknown name appends a declined stub.
  const led2 = M.markDeclined(M.load(null), 'never seen before', { now: 400 });
  A.ok(M.isDeclined(led2, 'never seen before'), 'declining an unrecorded name appends a declined stub');
}

// ---- 6. FIFO cap: the ledger never grows past LEDGER_CAP ----
{
  let led = M.load(null);
  for (let i = 0; i < M.LEDGER_CAP + 25; i++) led = M.record(led, { title: 'routine number ' + i }, { now: i });
  A.eq(led.length, M.LEDGER_CAP, 'ledger is FIFO-capped at LEDGER_CAP');
  A.ok(!M.findByName(led, 'routine number 0'), 'the oldest entry was evicted');
  A.ok(!!M.findByName(led, 'routine number ' + (M.LEDGER_CAP + 24)), 'the newest entry is kept');
}

// ---- 7. summary: the plain "you already maintain: …" line, live entries newest-first, empty when none ----
{
  A.eq(M.summary(M.load(null)), '', 'empty ledger -> no summary');
  let led = M.record(M.load(null), { title: 'Morning market brief' }, { now: 100 });
  led = M.record(led, { title: 'Quarterly planning digest' }, { now: 200 });
  led = M.markDeclined(led, 'Morning market brief', { now: 300 });   // declined entries are NOT advertised
  const s = M.summary(led);
  A.ok(s.indexOf('Quarterly planning digest') >= 0, 'summary lists the live routine');
  A.ok(s.indexOf('Morning market brief') < 0, 'summary omits a declined routine');
  A.ok(s.indexOf('do not recreate them') >= 0, 'summary is plain-language anti-recreate');
}

// ---- 8. sweepDuplicates: collapse exact (agentId, name, prompt) triples, keep the OLDEST, log the rest ----
{
  const jobs = [
    { id: 'old', name: 'ULTRON daily operating loop', prompt: 'run the loop', agentId: 'agent', createdAt: '2026-07-03T10:00:00.000Z' },
    { id: 'new', name: 'ULTRON daily operating loop', prompt: 'run the loop', agentId: 'agent', createdAt: '2026-07-03T10:05:00.000Z' },
    { id: 'diff-prompt', name: 'ULTRON daily operating loop', prompt: 'a DIFFERENT instruction', agentId: 'agent', createdAt: '2026-07-03T10:06:00.000Z' },
    { id: 'diff-agent', name: 'ULTRON daily operating loop', prompt: 'run the loop', agentId: 'scout', createdAt: '2026-07-03T10:07:00.000Z' }
  ];
  const before = JSON.stringify(jobs);
  const res = M.sweepDuplicates(jobs);
  A.eq(JSON.stringify(jobs), before, 'sweep does not mutate its input');
  A.eq(res.removed.length, 1, 'exactly one exact-triple duplicate removed');
  A.eq(res.removed[0].id, 'new', 'the NEWER of the identical pair is the one removed (oldest kept)');
  A.ok(res.jobs.some(j => j.id === 'old'), 'the oldest identical job is kept');
  A.ok(res.jobs.some(j => j.id === 'diff-prompt'), 'a same-name job with a different prompt is NOT a dup');
  A.ok(res.jobs.some(j => j.id === 'diff-agent'), 'a same-name job for a different agent is NOT a dup');
  A.eq(res.jobs.length, 3, 'three distinct jobs remain');
  // original array order preserved among the kept.
  A.eq(res.jobs.map(j => j.id), ['old', 'diff-prompt', 'diff-agent'], 'kept jobs stay in original order');
}

// ---- 9. sweep no-op when there are no duplicates ----
{
  const jobs = [
    { id: 'a', name: 'one', prompt: 'p1', agentId: 'agent', createdAt: '2026-07-03T10:00:00.000Z' },
    { id: 'b', name: 'two', prompt: 'p2', agentId: 'agent', createdAt: '2026-07-03T10:01:00.000Z' }
  ];
  const res = M.sweepDuplicates(jobs);
  A.eq(res.removed.length, 0, 'no duplicates -> nothing removed');
  A.eq(res.jobs.length, 2, 'all jobs kept');
}

A.report('mint-ledger');
