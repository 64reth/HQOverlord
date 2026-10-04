/* node test/checkpoint.test.js — the PURE snapshot-index reducer (execution-spine Commit 1).
   Proves record/prune/resolve are pure (input never mutated), injected-clock, and that the rollback-target
   math is right: undo-a-run restores the pre-run parent, rewind-to-turn finds the right snap, lineage is
   auto-threaded, prune keeps the most recent, and load is fail-closed. No wall-clock read. */
'use strict';
const A = require('./_assert.js');
const { makeClock } = require('../shared/clock-rng.js');
const cp = require('../sidecar/checkpoint.js');

const T0 = 1700000000000;

// ---- 1. makeSnapshot: normalize + reject a bad id ----
{
  const s = cp.makeSnapshot({ id: 'abc123', runId: 'r1', turn: 0, files: 2, bytes: 100 }, { now: T0 });
  A.eq(s.id, 'abc123', 'id carried');
  A.eq(s.ts, T0, 'ts = injected now');
  A.eq(s.parentId, null, 'no parent by default');
  const scoped = cp.makeSnapshot({ id: 'scope:abc123', scopeId: 'scope', workTree: '/project', gitCommit: 'abc123' }, { now: T0 });
  A.eq(scoped.scopeId, 'scope', 'external root scope is preserved');
  A.eq(scoped.workTree, '/project', 'external root identity is preserved');
  A.eq(scoped.gitCommit, 'abc123', 'underlying scoped git commit is preserved');
  A.throws(() => cp.makeSnapshot({ runId: 'r' }, { now: T0 }), 'missing id rejected');
  A.throws(() => cp.makeSnapshot({ id: 'bad id!' }, { now: T0 }), 'invalid id rejected');
}

// ---- 2. record: appends, auto-threads parentId to the prior head, does not mutate input ----
{
  const i0 = cp.toIndex([]);
  const i1 = cp.record(i0, { id: 's1', runId: 'r1', turn: 0 }, { now: T0 });
  A.eq(i1.snapshots.length, 1, 'first record appends');
  A.eq(i1.snapshots[0].parentId, null, 'first snapshot has no parent');
  const i2 = cp.record(i1, { id: 's2', runId: 'r1', turn: 1 }, { now: T0 + 1000 });
  A.eq(i2.snapshots.length, 2, 'second record appends');
  A.eq(i2.snapshots[1].parentId, 's1', 'parentId auto-threads to the prior head');
  A.eq(i0.snapshots.length, 0, 'input index untouched (purity)');
  A.ok(i2 !== i1, 'returns a new index');
}

// ---- 3. explicit parentId is respected (not overwritten by auto-thread) ----
{
  let i = cp.record(cp.toIndex([]), { id: 'root' }, { now: T0 });
  i = cp.record(i, { id: 'branch', parentId: 'root', runId: 'r2' }, { now: T0 + 1 });
  A.eq(cp.findById(i, 'branch').parentId, 'root', 'explicit parentId kept');
}

// ---- 4. prune keeps the most recent N ----
{
  let i = cp.toIndex([]);
  for (let n = 0; n < 5; n++) i = cp.record(i, { id: 's' + n, runId: 'r', turn: n }, { now: T0 + n });
  const p = cp.prune(i, 2);
  A.eq(p.snapshots.length, 2, 'prune to 2');
  A.eq(p.snapshots[0].id, 's3', 'keeps the most recent (oldest kept = s3)');
  A.eq(p.snapshots[1].id, 's4', 'newest kept = s4');
  // record with keep prunes inline
  const k = cp.record(i, { id: 's5', runId: 'r', turn: 5 }, { now: T0 + 5, keep: 3 });
  A.eq(k.snapshots.length, 3, 'record({keep}) prunes inline');
  A.eq(cp.latest(k).id, 's5', 'latest is the just-recorded snap');
}

// ---- 5. rollbackTargetForRun: undo a whole run -> restore the pre-run parent ----
{
  // run r1 makes s1 (on top of pre-existing base s0); run r2 makes s2,s3
  let i = cp.record(cp.toIndex([]), { id: 's0', runId: 'r0', turn: 0 }, { now: T0 });
  i = cp.record(i, { id: 's1', runId: 'r1', turn: 0 }, { now: T0 + 1 });   // parent auto = s0
  i = cp.record(i, { id: 's2', runId: 'r2', turn: 0 }, { now: T0 + 2 });   // parent auto = s1
  i = cp.record(i, { id: 's3', runId: 'r2', turn: 1 }, { now: T0 + 3 });   // parent auto = s2
  A.eq(cp.rollbackTargetForRun(i, 'r2'), 's1', 'undo r2 -> restore to its first snap parent (s1)');
  A.eq(cp.rollbackTargetForRun(i, 'r1'), 's0', 'undo r1 -> restore to s0');
  A.eq(cp.rollbackTargetForRun(i, 'r0'), null, 'undo the very first run -> nothing earlier to restore');
  A.eq(cp.rollbackTargetForRun(i, 'unknown'), null, 'unknown run -> null');
}

// ---- 6. resolveForTurn + firstOfRun ----
{
  let i = cp.record(cp.toIndex([]), { id: 'a', runId: 'r', turn: 0 }, { now: T0 });
  i = cp.record(i, { id: 'b', runId: 'r', turn: 1 }, { now: T0 + 1 });
  i = cp.record(i, { id: 'c', runId: 'r', turn: 2 }, { now: T0 + 2 });
  A.eq(cp.resolveForTurn(i, 'r', 1).id, 'b', 'rewind r to turn 1 -> b');
  A.eq(cp.firstOfRun(i, 'r').id, 'a', 'firstOfRun -> earliest snap of the run');
  A.eq(cp.resolveForTurn(i, 'r', 9), null, 'no such turn -> null');
}

// ---- 7. loadIndex: fail-closed + drop malformed + parse string + tolerate bare array ----
{
  A.eq(cp.loadIndex(null), { version: 1, snapshots: [] }, 'null -> empty (fail-closed)');
  A.eq(cp.loadIndex('not json'), { version: 1, snapshots: [] }, 'garbage string -> empty');
  const env = cp.loadIndex({ version: 1, snapshots: [{ id: 'ok' }, { id: 'bad id!' }, null, { noId: 1 }] });
  A.eq(env.snapshots.length, 1, 'malformed records dropped');
  A.eq(env.snapshots[0].id, 'ok', 'valid record survives');
  A.eq(cp.loadIndex([{ id: 'bare' }]).snapshots[0].id, 'bare', 'tolerates a bare array');
  A.eq(cp.loadIndex(JSON.stringify({ snapshots: [{ id: 'str' }] })).snapshots[0].id, 'str', 'parses a JSON string');
}

// ---- 8. determinism: same ops + same injected clock -> byte-identical index ----
{
  const build = () => {
    const c = makeClock(T0);
    let i = cp.toIndex([]);
    i = cp.record(i, { id: 'x', runId: 'r', turn: 0 }, { now: c.now() }); c.advance(1000);
    i = cp.record(i, { id: 'y', runId: 'r', turn: 1 }, { now: c.now() });
    return i;
  };
  A.eq(JSON.stringify(build()), JSON.stringify(build()), 'checkpoint index is byte-identical for identical inputs');
}

A.report('checkpoint');
