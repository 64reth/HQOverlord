/* node test/cron.durability.test.js — G4.2: durable + atomic cron persistence (no double-fire on crash).

   Proves the three load-bearing crash-safety properties of the cron job store, all headless with
   injected fs/clock — no real timer, no wall-clock read in the logic under test:

     · ATOMIC + DURABLE: the ACTUAL durable-write helper that index.js's saveCronJobs delegates to
       (sidecar/durable-write.js — NOT a re-implementation) fsyncs the TEMP file BEFORE renaming it
       over the real path, so a crash in the advance-before-run window can neither lose the rename
       nor leave a zero-length jobs file (-> double-fire). Asserted by spying every fs call in order:
       fsyncSync(tmpFd) MUST precede renameSync, and no zero-length file is ever observable at the
       real path. A per-pid + random tmp suffix avoids concurrent-writer tmp collisions. A POSIX
       directory fsync is best-effort after rename and never throws on Windows.

     · FAIL-CLOSED LOAD: a stale leftover `.tmp` next to the jobs file does NOT corrupt load, and a
       TRUNCATED/partial jobs file fails closed to the last good envelope — loadEnvelope tolerates
       garbage (cron-store.js:204-210) and the host's loadCronJobs only ever reads the real path.

     · CRASH-AT-FIRE-BOUNDARY (no double-fire across restart): the driver persists the ADVANCED
       nextRunAt via setJobs BEFORE launch (cron-driver.js advance-before-run). With the run left
       in-flight (runOnce never settles -> no markRun), a NEW driver constructed over the SAME
       persisted store at the SAME `now` fires ZERO jobs, and the on-disk (post-fsync) envelope
       round-trips to the advanced nextRunAt. */
'use strict';
const A = require('./_assert.js');
const os = require('node:os');
const realFs = require('node:fs');
const path = require('node:path');
const { makeClock } = require('../shared/clock-rng.js');
const cron = require('../sidecar/cron.js');
const cronStore = require('../sidecar/cron-store.js');
const { makeCronDriver } = require('../sidecar/cron-driver.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');
const { readJsonResilient, writeJsonResilient } = require('../sidecar/durable-store.js');

const T0 = 1700000000000;
const tmpRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'cron-dur-'));
const cleanup = [];
function tmpFile(name) { const f = path.join(tmpRoot, name); cleanup.push(f); return f; }

(function () {

  /* ---- 1. ATOMIC + DURABLE: fsyncSync(tmpFd) precedes renameSync; no zero-length file observable ----
     Spy a real-fs FACADE so the production helper runs its true code path (openSync/writeSync/fsyncSync/
     closeSync/renameSync), recording the ORDER of fs operations. We assert against the call log, never a
     re-implemented copy of the write logic. */
  {
    const real = realFs;
    const calls = [];          // ordered op log: { op, ... }
    const fdToPath = new Map(); // REAL fd -> the path it was opened on (to prove fsync targets the tmp fd)
    const target = tmpFile('jobs-atomic.json');

    const spyFs = {
      openSync(p, flags) { const fd = real.openSync(p, flags); fdToPath.set(fd, p); calls.push({ op: 'open', path: p, flags, fd }); return fd; },
      writeSync(fd, data) { calls.push({ op: 'write', fd, len: String(data).length }); return real.writeSync(fd, data); },
      fsyncSync(fd) { calls.push({ op: 'fsync', fd, tmp: fdToPath.get(fd) }); return real.fsyncSync(fd); },
      closeSync(fd) { calls.push({ op: 'close', fd }); return real.closeSync(fd); },
      renameSync(a, b) { calls.push({ op: 'rename', from: a, to: b }); return real.renameSync(a, b); }
      // (the helper also opens the containing DIRECTORY fd for the best-effort POSIX dir-fsync; on Windows
      //  openSync(dir) typically throws EISDIR/EPERM and the helper swallows it — that path is covered by test 3.)
    };

    const envelope = cronStore.toEnvelope([cronStore.makeJob({ id: 'j1', prompt: 'x', schedule: cron.parseSchedule('every 10m', T0) }, { id: 'j1', now: T0 })]);
    let threw = null;
    try { writeFileDurable({ fs: spyFs, path: path }, target, JSON.stringify(envelope)); } catch (e) { threw = e; }
    A.ok(!threw, 'writeFileDurable did not throw on the happy path' + (threw ? (' — ' + threw.message) : ''));

    // openSync was called with a flag that creates+truncates a tmp (the helper uses 'w'), and a fresh tmp suffix.
    const opens = calls.filter(c => c.op === 'open');
    A.ok(opens.length >= 1, 'openSync called for the temp write');
    const tmpOpen = opens[0];
    A.ok(/\.tmp$/.test(tmpOpen.path), 'wrote to a *.tmp temp path, not the real path — got ' + tmpOpen.path);
    A.ok(tmpOpen.path !== target, 'temp path is distinct from the real jobs path');

    const idxFsync = calls.findIndex(c => c.op === 'fsync' && c.tmp && /\.tmp$/.test(c.tmp));
    const idxRename = calls.findIndex(c => c.op === 'rename');
    A.ok(idxFsync !== -1, 'fsyncSync was called on the temp fd');
    A.ok(idxRename !== -1, 'renameSync was called');
    A.ok(idxFsync !== -1 && idxRename !== -1 && idxFsync < idxRename, 'fsyncSync(tmpFd) PRECEDES renameSync (durable before atomic) — fsync@' + idxFsync + ' rename@' + idxRename);

    // the fsync targeted the SAME fd that was opened on the tmp (not some other fd).
    const fsyncCall = idxFsync !== -1 ? calls[idxFsync] : null;
    A.ok(!!fsyncCall && fsyncCall.tmp === tmpOpen.path, 'fsync targeted the temp fd opened on the temp path');

    // rename moved the tmp ONTO the real path.
    const ren = idxRename !== -1 ? calls[idxRename] : null;
    A.ok(!!ren && ren.to === target, 'rename target is the real jobs path');
    A.ok(!!ren && /\.tmp$/.test(ren.from), 'rename source is the temp file');

    // The real path was never created at zero length: it only ever appears via the atomic rename of a fully
    // written+fsynced tmp. After the call it exists and is non-empty and round-trips.
    A.ok(real.existsSync(target), 'real jobs file exists after the durable write');
    const onDisk = real.readFileSync(target, 'utf8');
    A.ok(onDisk.length > 0, 'real jobs file is NON-empty (no zero-length window)');
    A.eq(cronStore.loadEnvelope(onDisk).jobs.length, 1, 'on-disk envelope round-trips to 1 job');
  }

  /* ---- 2. per-pid + random tmp suffix: two writes pick DISTINCT tmp names (no concurrent-writer collision) ---- */
  {
    const seen = new Set();
    const target = tmpFile('jobs-suffix.json');
    const spyFs = {
      openSync(p, flags) { seen.add(p); return realFs.openSync(p, flags); },
      writeSync(fd, d) { return realFs.writeSync(fd, d); },
      fsyncSync(fd) { return realFs.fsyncSync(fd); },
      closeSync(fd) { return realFs.closeSync(fd); },
      renameSync(a, b) { return realFs.renameSync(a, b); }
    };
    writeFileDurable({ fs: spyFs, path: path }, target, '{"version":1,"jobs":[]}');
    writeFileDurable({ fs: spyFs, path: path }, target, '{"version":1,"jobs":[]}');
    const tmps = [...seen].filter(p => /\.tmp$/.test(p));
    A.ok(tmps.length === 2, 'two distinct tmp paths used across two writes (per-pid+random suffix), got ' + tmps.length);
    tmps.forEach(t => A.ok(t.indexOf(String(process.pid)) !== -1, 'tmp suffix carries the pid — ' + t));
  }

  /* ---- 3. directory fsync is BEST-EFFORT: a throwing dir-open/fsync never fails the write (Windows-safe) ---- */
  {
    const target = tmpFile('jobs-dirfsync.json');
    let dirOpenAttempted = false;
    const spyFs = {
      openSync(p, flags) {
        // the helper opens the CONTAINING DIRECTORY (not a *.tmp) for the POSIX dir-fsync; simulate Windows EISDIR.
        if (!/\.tmp$/.test(p) && p === path.dirname(target)) { dirOpenAttempted = true; const e = new Error('EISDIR'); e.code = 'EISDIR'; throw e; }
        return realFs.openSync(p, flags);
      },
      writeSync(fd, d) { return realFs.writeSync(fd, d); },
      fsyncSync(fd) { return realFs.fsyncSync(fd); },
      closeSync(fd) { return realFs.closeSync(fd); },
      renameSync(a, b) { return realFs.renameSync(a, b); }
    };
    let threw = null;
    try { writeFileDurable({ fs: spyFs, path: path }, target, '{"version":1,"jobs":[]}'); } catch (e) { threw = e; }
    A.ok(!threw, 'a throwing directory fsync did NOT fail the write (best-effort, Windows-safe)' + (threw ? (' — ' + threw.message) : ''));
    A.ok(dirOpenAttempted, 'the helper DID attempt the POSIX directory fsync (best-effort)');
    A.ok(realFs.existsSync(target) && realFs.readFileSync(target, 'utf8').length > 0, 'the jobs file landed non-empty despite the dir-fsync failure');
  }

  /* ---- 3b. SHORT WRITES: loop until every byte lands; zero progress fails BEFORE rename. ---- */
  {
    const target = tmpFile('jobs-short-write.json');
    let writeCalls = 0;
    let renamed = false;
    const spyFs = {
      openSync(p, flags) { return realFs.openSync(p, flags); },
      writeSync(fd, buf, offset, length) {
        writeCalls++;
        const chunk = Math.min(3, length);
        return realFs.writeSync(fd, buf, offset, chunk);
      },
      fsyncSync(fd) { return realFs.fsyncSync(fd); },
      closeSync(fd) { return realFs.closeSync(fd); },
      renameSync(a, b) { renamed = true; return realFs.renameSync(a, b); }
    };
    const body = JSON.stringify({ version: 1, jobs: [], note: '☃ survives byte offsets' });
    writeFileDurable({ fs: spyFs, path: path }, target, body);
    A.ok(writeCalls > 1, 'partial writeSync progress is retried until the full buffer lands');
    A.eq(realFs.readFileSync(target, 'utf8'), body, 'short-write loop preserves the complete UTF-8 payload');

    const zeroTarget = tmpFile('jobs-zero-progress.json');
    renamed = false;
    const zeroFs = {
      openSync(p, flags) { return realFs.openSync(p, flags); },
      writeSync() { return 0; },
      fsyncSync(fd) { return realFs.fsyncSync(fd); },
      closeSync(fd) { return realFs.closeSync(fd); },
      renameSync() { renamed = true; }
    };
    let err = null;
    try { writeFileDurable({ fs: zeroFs, path: path }, zeroTarget, body); } catch (e) { err = e; }
    A.ok(err && err.code === 'ESHORTWRITE', 'zero-progress write fails loudly with ESHORTWRITE');
    A.eq(renamed, false, 'a zero-progress temp is never renamed over the authoritative file');
  }

  /* ---- 4. FAIL-CLOSED LOAD: a stale leftover .tmp does NOT corrupt load; a truncated jobs file fails closed.
     Mirror the host's loadCronJobs: read ONLY the real path string, hand it to cronStore.loadEnvelope. ---- */
  {
    const target = tmpFile('jobs-failclosed.json');
    const tmpLeftover = target + '.' + process.pid + '.tmp';
    cleanup.push(tmpLeftover);

    // write a GOOD envelope durably, then drop a corrupt leftover .tmp beside it (a crash mid-write artifact).
    const good = cronStore.toEnvelope([cronStore.makeJob({ id: 'keep', prompt: 'p', schedule: cron.parseSchedule('every 10m', T0) }, { id: 'keep', now: T0 })]);
    writeFileDurable({ fs: realFs, path: path }, target, JSON.stringify(good));
    realFs.writeFileSync(tmpLeftover, '{ "version": 1, "jobs": [ {"id":"GARBAGE');   // truncated junk

    // the host's load path (index.js loadCronJobs) reads ONLY the real file and tolerates garbage.
    const loadCron = (file) => { try { return cronStore.loadEnvelope(realFs.readFileSync(file, 'utf8')).jobs; } catch (_) { return []; } };
    const loaded = loadCron(target);
    A.eq(loaded.length, 1, 'a stale leftover .tmp does NOT corrupt load — the last good envelope (1 job) is returned');
    A.eq(loaded[0].id, 'keep', 'the loaded job is the last good one, not the .tmp garbage');

    // a TRUNCATED real jobs file fails closed to an empty store (never throws, never a half-parsed job).
    const truncated = tmpFile('jobs-truncated.json');
    realFs.writeFileSync(truncated, '{"version":1,"jobs":[{"id":"x","sched');   // cut mid-JSON
    A.eq(loadCron(truncated).length, 0, 'a truncated jobs file fails closed to an empty store (no double-fire from a half-record)');

    // an envelope whose jobs is not an array also fails closed (loadEnvelope guard).
    const notArray = tmpFile('jobs-notarray.json');
    realFs.writeFileSync(notArray, '{"version":1,"jobs":"oops"}');
    A.eq(loadCron(notArray).length, 0, 'a non-array jobs envelope fails closed');
  }

  /* ---- 4b. PROTECTED ROUTINE STORE: torn/corrupt main recovers from .bak instead of booting empty ---- */
  {
    const target = tmpFile('jobs-protected.json');
    const keep = cronStore.makeJob({ id: 'keep', prompt: 'p', schedule: cron.parseSchedule('every 10m', T0) }, { id: 'keep', now: T0 });
    const second = cronStore.makeJob({ id: 'second', prompt: 'q', schedule: cron.parseSchedule('every 30m', T0) }, { id: 'second', now: T0 });
    const third = cronStore.makeJob({ id: 'third', prompt: 'r', schedule: cron.parseSchedule('every 1h', T0) }, { id: 'third', now: T0 });
    const saveProtected = (jobs) => writeJsonResilient({ fs: realFs, path: path, writeDurable: writeFileDurable }, target, cronStore.toEnvelope(jobs));
    saveProtected([keep]);
    saveProtected([keep, second]);        // .bak = [keep]
    saveProtected([keep, second, third]); // .bak = [keep, second], main = [keep, second, third]

    realFs.writeFileSync(target, '');     // simulate a hard kill leaving the protected main zero-length
    const recovered = readJsonResilient({ fs: realFs }, target);
    A.eq(recovered.status, 'recovered', 'zero-length cron jobs main recovers from .bak');
    const jobs = cronStore.loadEnvelope(recovered.value).jobs;
    A.eq(jobs.length, 2, 'cron recovery returns the last-known-good routine set, not an empty schedule');
    A.eq(jobs.map(j => j.id), ['keep', 'second'], 'recovered routines match the .bak snapshot');

    saveProtected(jobs);
    const afterSave = readJsonResilient({ fs: realFs }, target);
    A.eq(afterSave.status, 'ok', 'saving after recovery restores a clean main file');
    A.eq(cronStore.loadEnvelope(afterSave.value).jobs.length, 2, 'post-recovery save preserves recovered routines');
  }

  /* ---- 5. CRASH-AT-FIRE-BOUNDARY: advance-before-run persisted durably -> a restart fires ZERO ----
     Drive the REAL cron driver with an injected clock + an injected runOnce that NEVER settles (the "crash"
     point is mid-run, before markRun). setJobs persists through the ACTUAL durable write to a real file.
     Then construct a NEW driver over the SAME persisted store at the SAME `now` and assert fire.length===0,
     and that the on-disk (post-fsync) envelope round-trips to the ADVANCED nextRunAt. ---- */
  {
    const jobsFile = tmpFile('jobs-fireboundary.json');
    const period = 10 * 60 * 1000;                       // 10m interval
    const dueAt = T0 + period;                            // armed one period out by makeJob
    const job = cronStore.makeJob({ id: 'iv', prompt: 'tick', agentId: 'cron_iv', schedule: cron.parseSchedule('every 10m', T0) }, { id: 'iv', now: T0 });
    A.eq(job.nextRunAt, new Date(dueAt).toISOString(), 'interval job armed at T0+period');

    // the host-side store mirror + durable persistence (mirrors index.js cronJobs + saveCronJobs).
    let store = [job];
    writeFileDurable({ fs: realFs, path: path }, jobsFile, JSON.stringify(cronStore.toEnvelope(store)));
    const persist = () => writeFileDurable({ fs: realFs, path: path }, jobsFile, JSON.stringify(cronStore.toEnvelope(store)));

    const fired = [];
    const clock = makeClock(dueAt);                      // exactly due
    // runOnce returns a promise that NEVER resolves -> the run is "in flight"; finishFire/markRun never runs.
    const never = new Promise(() => {});
    const mkDriver = () => makeCronDriver({
      getJobs: () => store,
      setJobs: (j) => { store = j; persist(); },         // ADVANCE-BEFORE-RUN persisted durably
      runOnce: () => never,
      emit: (name, payload) => { if (name === 'cron.fire') fired.push(payload); },
      newId: () => 'rid', newAbort: () => new AbortController(), now: () => clock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: 480000
    });

    const d1 = mkDriver();
    const r1 = d1.applyTick(clock.now());
    A.eq(r1.fired, 1, 'the due interval job fires exactly once on the first tick');
    A.eq(fired.length, 1, 'one cron.fire emitted');

    // the advance-before-run nextRunAt was persisted to disk BEFORE the (never-settling) run.
    const persistedJobs = cronStore.loadEnvelope(realFs.readFileSync(jobsFile, 'utf8')).jobs;
    A.eq(persistedJobs.length, 1, 'store persisted to disk');
    const advancedIso = persistedJobs[0].nextRunAt;
    A.ok(Date.parse(advancedIso) > dueAt, 'persisted nextRunAt was ADVANCED past the fired occurrence (' + advancedIso + ' > ' + new Date(dueAt).toISOString() + ')');
    A.eq(advancedIso, new Date(dueAt + period).toISOString(), 'advanced exactly one period (advance-before-run)');

    // CRASH-RESTART: a brand-new driver over the SAME persisted store, SAME now, run never settled -> ZERO fires.
    const restartStore = cronStore.loadEnvelope(realFs.readFileSync(jobsFile, 'utf8')).jobs;   // reload from disk
    const fired2 = [];
    const d2 = makeCronDriver({
      getJobs: () => restartStore,
      setJobs: (j) => { /* no-op for the assertion */ },
      runOnce: () => new Promise(() => {}),
      emit: (name, payload) => { if (name === 'cron.fire') fired2.push(payload); },
      newId: () => 'rid2', newAbort: () => new AbortController(), now: () => clock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: 480000
    });
    const r2 = d2.applyTick(clock.now());
    A.eq(r2.fired, 0, 'CRASH-RESTART at the SAME now fires ZERO — the advanced nextRunAt prevents a double-fire');
    A.eq(fired2.length, 0, 'no cron.fire on the restart tick');
  }

  // tidy up the temp dir (best-effort).
  try { for (const f of cleanup) { try { realFs.unlinkSync(f); } catch (_) {} } realFs.rmdirSync(tmpRoot, { recursive: true }); } catch (_) {}

  A.report('cron.durability');
})();
