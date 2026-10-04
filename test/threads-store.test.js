/* node test/threads-store.test.js — the durable THREAD LEDGER (NS-6).

   Proves: threads round-trip a fresh store (restart-safe), add is dedup'd BY FINGERPRINT (a reordered/padded
   restatement of a live idea never double-mints), the open→picked→delivered lifecycle transitions, and DECLINED
   IS PERMANENT — a declined idea (and a directly-denylisted turn-in discard) can NEVER be re-added, even under a
   fresh id (the "discard = never again" law). In-memory fs → deterministic, no disk (timestamps injected). */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const { makeThreadsStore, fingerprint } = require('../sidecar/threads-store.js');

function memFs() {
  const files = new Map();
  return {
    _files: files,
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, data) { files.set(String(f), String(data)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); },
    mkdirSync() {}, unlinkSync(f) { files.delete(String(f)); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => { fs.writeFileSync(file, data); };
function freshStore(fs) { return makeThreadsStore({ fs: fs || memFs(), path, workspaces: '/ws', writeDurable }); }

(async () => {
  // ---- 1. add → open thread, round-trips a fresh store (restart-safe persistence) ----
  {
    const fs = memFs();
    const s1 = freshStore(fs);
    const r = await s1.add({ id: 't1', title: 'Build a CSV cleaner', spec: 'i keep hand-cleaning CSVs', sourceRef: { runId: 'run_9' } }, 1000);
    A.ok(r.reason === 'added' && r.thread.state === 'open', 'add returns an open thread (reason:added)');
    A.eq(s1.openThreads().map(t => t.id), ['t1'], 'openThreads lists the new thread');
    const s2 = freshStore(fs);   // fresh instance, same disk
    A.eq(s2.list({ state: 'open' }).map(t => t.title), ['Build a CSV cleaner'], 'thread SURVIVES a fresh store (durable)');
    A.eq(s2.read().threads[0].sourceRef.runId, 'run_9', 'sourceRef provenance persisted');
  }

  // ---- 2. DEDUP BY FINGERPRINT: a reordered/padded restatement of a LIVE thread never double-mints ----
  {
    const s = freshStore();
    await s.add({ id: 'a1', title: 'Build a price watcher for GPUs' }, 1);
    const dup = await s.add({ id: 'a2', title: '  a  GPUs price   Build watcher for ' }, 2);   // same token-set, diff id
    A.ok(dup.reason === 'duplicate', 'a same-fingerprint add is refused as a duplicate');
    A.ok(dup.thread && dup.thread.id === 'a1', 'duplicate returns the EXISTING live thread');
    A.eq(s.list().map(t => t.id), ['a1'], 'the duplicate never enters the ledger');
    const diff = await s.add({ id: 'a3', title: 'Draft a launch email' }, 3);
    A.ok(diff.reason === 'added', 'a genuinely different idea still adds');
    A.eq(fingerprint('Build a price watcher for GPUs'), fingerprint('a GPUs price Build watcher for'), 'fingerprint is order/pad invariant');
  }

  // ---- 3. lifecycle: open → picked → delivered ----
  {
    const s = freshStore();
    await s.add({ id: 'l1', title: 'Prototype the onboarding tour' }, 1);
    const p = await s.pick('l1', 2);
    A.ok(p && p.state === 'picked' && p.updatedAt === 2, 'pick moves open→picked and stamps updatedAt');
    const d = await s.deliver('l1', 3);
    A.ok(d && d.state === 'delivered', 'deliver moves picked→delivered');
    A.eq(s.openThreads().length, 0, 'a delivered thread is no longer OPEN');
  }

  // ---- 4. DECLINED IS PERMANENT: a declined idea can never be re-added, even under a fresh id ----
  {
    const s = freshStore();
    await s.add({ id: 'd1', title: 'Write a weekly newsletter automation' }, 1);
    const dec = await s.decline('d1', 'not-interested', 5);
    A.ok(dec && dec.state === 'declined' && dec.declineReason === 'not-interested', 'decline sets state + reason');
    A.ok(s.isDeclined('Write a weekly newsletter automation') === true, 'the idea now reads as declined');
    // re-mint attempt under a NEW id + reordered words → must be refused (the discard = never again law)
    const re = await s.add({ id: 'd2', title: 'automation newsletter weekly Write a' }, 6);
    A.ok(re.reason === 'declined', 're-adding a declined idea (fresh id, reordered) is refused as declined');
    A.eq(s.openThreads().length, 0, 'a declined idea never re-enters as open');
    A.ok(s.knownFingerprints()[fingerprint('Write a weekly newsletter automation')] === 'declined', 'declined fingerprint is on the denylist');
  }

  // ---- 5. declineFingerprint: a turn-in DISCARD (proposal that never became a thread) is permanently suppressed ----
  {
    const s = freshStore();
    await s.declineFingerprint('Set up a Discord bot');
    A.ok(s.isDeclined('set up a discord BOT') === true, 'a directly-denylisted idea reads as declined');
    const blocked = await s.add({ id: 'x1', title: 'Discord bot set up a' }, 9);
    A.ok(blocked.reason === 'declined', 'a discarded-at-turn-in idea can never be minted as a thread later');
  }

  A.report('threads-store');
})();
