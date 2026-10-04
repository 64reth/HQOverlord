/* node test/autonomy-ledger.test.js — NS-0 durable AUTONOMY DECISION LEDGER (sidecar/autonomy-ledger.js).

   Proves the pure store with an injected in-memory io + fake clock (no real fs, no wall clock):
     · record() stamps ts, clamps the source/kind vocab, keeps optional fields only when present, appends to io
     · list() is newest-first, capped, and filterable by source/kind
     · a boot load re-hydrates from io.readAll() (durability round-trip at the store level)
     · fail-open: a throwing io.append never crashes record(); a garbage boot load -> empty ledger
     · sanitization: an oversized/nested/secret-bearing detail bag is bounded to primitives at the boundary */
'use strict';
const A = require('./_assert.js');
const { makeAutonomyLedger } = require('../sidecar/autonomy-ledger.js');

// an in-memory io mirroring the host's fsync'd append: readAll() re-hydrates, append() records the row.
function memIo(seed) {
  const rows = (seed || []).slice();
  return { rows, readAll() { return rows.slice(); }, append(e) { rows.push(e); } };
}

(function () {

  // ---- 1. record stamps ts + clamps vocab + persists to io ----
  {
    const io = memIo();
    const led = makeAutonomyLedger({ io, clock: { now: () => 1000 } });
    const e = led.record({ source: 'cron', kind: 'fire', jobId: 'j1', agentId: 'a1', runId: 'r1', binding: 'schedule', reason: 'due' });
    A.eq(e.ts, 1000, 'ts stamped from the injected clock when absent');
    A.eq(e.source, 'cron', 'known source kept');
    A.eq(e.kind, 'fire', 'known kind kept');
    A.eq(e.jobId, 'j1', 'jobId kept');
    A.eq(io.rows.length, 1, 'the row was appended to io (durable)');
    A.eq(io.rows[0].runId, 'r1', 'the appended row carries the runId');
  }

  // ---- 2. unknown source/kind are clamped (never dropped — a real decision is never lost) ----
  {
    const led = makeAutonomyLedger({ io: memIo(), clock: { now: () => 0 } });
    const e = led.record({ source: 'martian', kind: 'teleport' });
    A.eq(e.source, 'other', 'an unknown source clamps to other');
    A.eq(e.kind, 'note', 'an unknown kind clamps to note');
  }

  // ---- 3. optional fields are omitted when absent (compact rows) ----
  {
    const led = makeAutonomyLedger({ io: memIo(), clock: { now: () => 0 } });
    const e = led.record({ source: 'cron', kind: 'skip', jobId: 'j', reason: 'no-capability', binding: 'no-capability' });
    A.ok(!('runId' in e), 'runId omitted when not given');
    A.ok(!('agentId' in e), 'agentId omitted when not given');
    A.eq(e.reason, 'no-capability', 'reason kept');
    A.eq(e.binding, 'no-capability', 'binding kept');
  }

  // ---- 4. list is newest-first, capped, filterable ----
  {
    const led = makeAutonomyLedger({ io: memIo(), clock: { now: () => 0 } });
    led.record({ ts: 1, source: 'cron', kind: 'fire', jobId: 'a' });
    led.record({ ts: 2, source: 'cron', kind: 'skip', jobId: 'b', reason: 'at-capacity' });
    led.record({ ts: 3, source: 'nightshift', kind: 'defer', jobId: 'c' });
    const all = led.list();
    A.eq(all.length, 3, 'all three listed');
    A.eq(all[0].jobId, 'c', 'newest-first (last recorded is first)');
    A.eq(led.list({ limit: 1 })[0].jobId, 'c', 'limit honored');
    A.eq(led.list({ source: 'cron' }).length, 2, 'source filter');
    A.eq(led.list({ kind: 'defer' }).length, 1, 'kind filter');
    A.eq(led.list({ source: 'cron', kind: 'fire' })[0].jobId, 'a', 'combined source+kind filter');
  }

  // ---- 5. boot re-hydration from io.readAll (durability round-trip at the store level) ----
  {
    const io = memIo([{ ts: 5, source: 'cron', kind: 'fire', jobId: 'seed' }]);
    const led = makeAutonomyLedger({ io, clock: { now: () => 0 } });
    A.eq(led.count(), 1, 'the seeded on-disk row was loaded at boot');
    A.eq(led.list()[0].jobId, 'seed', 'the seeded decision is served');
    led.record({ ts: 6, source: 'cron', kind: 'skip', jobId: 'new' });
    A.eq(led.count(), 2, 'a new record joins the loaded history');
  }

  // ---- 6. fail-open: a throwing append never crashes record; garbage boot load -> empty ----
  {
    const throwIo = { readAll() { return []; }, append() { throw new Error('disk full'); } };
    const led = makeAutonomyLedger({ io: throwIo, clock: { now: () => 0 } });
    A.notThrows(() => led.record({ source: 'cron', kind: 'fire' }), 'a throwing append does not crash record');
    A.eq(led.count(), 1, 'the RAM mirror still answers even when the disk append failed');

    const garbageIo = { readAll() { return 'not-an-array'; }, append() {} };
    const led2 = makeAutonomyLedger({ io: garbageIo, clock: { now: () => 0 } });
    A.eq(led2.count(), 0, 'a garbage boot load fails open to an empty ledger');
  }

  // ---- 7. detail bag is sanitized to bounded primitives (no nested blobs / functions) ----
  {
    const led = makeAutonomyLedger({ io: memIo(), clock: { now: () => 0 } });
    const e = led.record({ source: 'cron', kind: 'fire', detail: { count: 3, note: 'x'.repeat(500), nested: { a: 1 }, fn: () => {} } });
    A.eq(e.detail.count, 3, 'a primitive detail value is kept');
    A.eq(e.detail.note.length, 260, 'an oversized string detail is truncated');
    A.ok(!('nested' in e.detail), 'a nested object detail is dropped (primitives only)');
    A.ok(!('fn' in e.detail), 'a function detail is dropped');
  }

  // ---- 8. ram mirror is bounded (a 24/7 process cannot grow it without limit) ----
  {
    const led = makeAutonomyLedger({ io: { readAll() { return []; }, append() {} }, clock: { now: () => 0 }, ramMax: 5 });
    for (let i = 0; i < 20; i++) led.record({ ts: i, source: 'cron', kind: 'fire', jobId: 'j' + i });
    A.eq(led.count(), 5, 'the RAM mirror is capped at ramMax');
    A.eq(led.list()[0].jobId, 'j19', 'the newest rows are retained');
  }

  A.report('autonomy-ledger');
})();
