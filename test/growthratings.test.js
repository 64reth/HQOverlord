/* node test/growthratings.test.js - durable work-rating source of truth. */
'use strict';
const A = require('./_assert.js');
const { makeGrowthRatings, deriveRating } = require('../sidecar/growthratings.js');

const derived = deriveRating(
  { runId: 'truth', agentId: 'agent', toolsOk: 6, usd: 0.4, artifacts: [{ kind: 'file' }] },
  [{ agentId: 'scribe', usd: 0.2 }, { agentId: 'scribe', usd: 0.1 }, { agentId: 'sub-temp', usd: 9 }], 'great');
A.eq(derived.entries[0].delta, 3, 'a great verdict has one fixed canonical value regardless tools, artifacts, or spend');
A.eq(derived.entries[0].size, 'large', 'server derives the durable task-size bucket');
A.eq(derived.entries.length, 2, 'durable child runs aggregate named crew and reject ephemeral clones');
A.eq(derived.entries[1].delta, 3, 'a durably observed named crew contributor receives equal verdict credit');
const cheap = deriveRating({ runId: 'cheap', agentId: 'agent', toolsOk: 0, usd: 0, artifacts: [] }, [{ agentId: 'scribe', usd: 0 }], 'great');
A.eq(cheap.entries.map(e => e.delta), [3, 3], 'zero-cost work and zero-cost named contribution cannot be valued below expensive work');

const disk = [];
let now = 100;
const store = makeGrowthRatings({ io: { readAll: () => disk.slice(), append: r => disk.push(r) }, clock: { now: () => now } });
const first = store.record({ runId: 'r1', verdict: 'great', entries: [
  { agentId: 'agent', id: 'work:r1', delta: 10, size: 'large' },
  { agentId: 'scribe', id: 'work:r1:scribe', delta: 4, size: 'medium' }
] });
A.eq(first.duplicate, false, 'first verdict is durably accepted');
A.eq(first.rating.entries.length, 2, 'canonical rating preserves proven crew attribution');
A.eq(first.rating.entries[0].reason, 'work_great', 'server derives the XP reason from the verdict');
A.eq(disk.length, 1, 'one accepted verdict appends one durable row');

now = 200;
const duplicate = store.record({ runId: 'r1', verdict: 'miss', entries: [{ agentId: 'agent', id: 'work:r1', delta: 1 }] });
A.eq(duplicate.duplicate, true, 'a later/conflicting verdict is idempotently rejected');
A.eq(duplicate.rating.verdict, 'great', 'the first acknowledged verdict remains canonical');
A.eq(disk.length, 1, 'a duplicate never appends a second row');
const nextGeneration = store.record({ epoch: 2, runId: 'r1', verdict: 'ok', entries: [{ agentId: 'agent', id: 'work:r1', delta: 1 }] });
A.eq(nextGeneration.duplicate, false, 'a newly created station generation does not inherit old verdict locks');
A.eq(store.list({ epoch: 2 }).length, 1, 'rating history is isolated to the current station generation');

A.ok(store.record({ runId: '', verdict: 'great', entries: [] }).error, 'invalid ratings fail closed');
now = 300;
store.record({ runId: 'r2', verdict: 'ok', entries: [{ agentId: 'agent', id: 'work:r2', delta: 3, size: 'bogus' }] });
A.eq(store.list({ since: 100 }).map(r => r.runId).join(','), 'r2', 'history filters strictly after its watermark');
A.eq(store.list({ through: 250 }).map(r => r.runId).join(','), 'r1', 'history freezes at a server snapshot horizon');
A.eq(store.list({ beforeRunId: 'r2' })[0].runId, 'r1', 'history cursor walks newest-first without overlap');

const reboot = makeGrowthRatings({ io: { readAll: () => disk.slice(), append: r => disk.push(r) }, clock: { now: () => 400 } });
A.eq(reboot.get('r1').verdict, 'great', 'restart rehydrates the canonical verdict');
A.eq(reboot.record({ runId: 'r1', verdict: 'ok', entries: [{ agentId: 'agent', id: 'work:r1', delta: 1 }] }).duplicate, true,
  'idempotency survives process restart');
const broken = makeGrowthRatings({ io: { readAll: () => [], append: () => { throw new Error('disk full'); } }, clock: { now: () => 500 } });
A.ok(broken.record({ runId: 'lost', verdict: 'great', entries: [{ agentId: 'agent', id: 'work:lost', delta: 1 }] }).error,
  'an fsync/append failure is never acknowledged');
A.eq(broken.count(), 0, 'a failed durable append cannot enter the in-memory source of truth');

let unreadableAppends = 0;
const unreadable = makeGrowthRatings({
  io: { readAll: () => { throw new Error('EBUSY'); }, append: () => { unreadableAppends++; } },
  clock: { now: () => 550 }
});
const refusedUnreadable = unreadable.record({ runId: 'unknown-history', verdict: 'great', entries: [{ agentId: 'agent', id: 'work:unknown-history', delta: 3 }] });
A.ok(refusedUnreadable.unavailable && refusedUnreadable.error, 'an unreadable canonical ledger refuses new rating authority');
A.eq(unreadableAppends, 0, 'an unreadable ledger cannot append a duplicate first-verdict claim');
A.throws(() => unreadable.list({}), 'an unreadable canonical ledger is unavailable, never an empty successful history');

const boundedDisk = [], bounded = makeGrowthRatings({ ramMax: 2, io: { readAll: () => boundedDisk.slice(), append: r => boundedDisk.push(r) }, clock: { now: () => ++now } });
for (const id of ['old', 'middle', 'new']) bounded.record({ runId: id, verdict: 'great', entries: [{ agentId: 'agent', id: 'work:' + id, delta: 3 }] });
A.eq(bounded.count(), 2, 'the served rating history window stays bounded in memory');
A.ok(bounded.record({ runId: 'old', verdict: 'miss', entries: [{ agentId: 'agent', id: 'work:old', delta: 3 }] }).duplicate,
  'an acknowledged verdict remains first-wins after its row leaves the served RAM window');
A.eq(boundedDisk.length, 3, 're-rating an evicted row cannot append duplicate XP authority');
A.report('growthratings.test');
