/* node test/procledger.test.js — the persistent child-PID ledger + boot orphan sweep (mouse-confinement
   incident, 2026-07-12). Locks the laws: every recorded child survives in the ledger FILE (a force-killed
   sidecar can't release anything), the next boot's sweep kills exactly the recorded-and-still-matching
   PIDs, and a recycled PID whose live command line no longer matches is NEVER killed. Pure fakes — no
   real processes, fast gate. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { makeProcLedger, _internals } = require('../sidecar/procledger.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-ledger-'));
  const file = path.join(dir, 'proc-ledger.json');
  const clock = { now: () => 1234 };

  // ---- 1. cmdMatches: token-wise reuse guard ----
  A.ok(_internals.cmdMatches('npm run dev', 'cmd.exe /d /s /c "npm run dev"'), 'shell:true child matches (tokens adjacent)');
  A.ok(_internals.cmdMatches('C:\\chrome.exe --user-data-dir=C:\\tmp\\sb-1', '"C:\\chrome.exe" --disable-gpu --headless=new --user-data-dir=C:\\tmp\\sb-1 about:blank'),
    'browser matches even with flags BETWEEN the recorded tokens');
  A.ok(!_internals.cmdMatches('C:\\chrome.exe --user-data-dir=C:\\tmp\\sb-1', '"C:\\chrome.exe" --user-data-dir=C:\\Users\\me\\profile'),
    'the user\'s OWN chrome (same exe, different profile) does NOT match');
  A.ok(!_internals.cmdMatches('npm run dev', 'C:\\Windows\\explorer.exe'), 'recycled PID with unrelated cmdline does NOT match');
  A.ok(!_internals.cmdMatches('', 'anything'), 'empty recorded cmd never matches');

  // ---- 2. record/release round-trips the FILE (what a force-kill leaves behind) ----
  const l1 = makeProcLedger({ fs, pathMod: path, file, clock, probe: async () => new Map(), killTree: async () => {} });
  l1.record({ pid: 101, cmd: 'npm run dev', kind: 'shell.bg' });
  l1.record({ pid: 102, cmd: 'chrome.exe --user-data-dir=X', kind: 'browser' });
  l1.record({ pid: 103, cmd: 'node server.js', kind: 'shell.bg' });
  l1.release(103);   // clean exit -> gone from the file
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  A.eq(onDisk.procs.length, 2, 'released pid left the file; recorded pids persist');
  A.ok(onDisk.procs.some(p => p.pid === 101) && onDisk.procs.some(p => p.pid === 102), 'both live pids on disk');

  // A terminal/background child is already alive when record() writes its restart-cleanup receipt. One transient
  // Windows rename race must not be swallowed: without a retry the next boot sees an empty ledger and leaves the
  // owned process orphaned even though the immediately repeated atomic replace would succeed.
  {
    const fileTransient = path.join(dir, 'transient-record.json');
    let renameCalls = 0;
    const flakyFs = Object.create(fs);
    flakyFs.renameSync = (from, to) => {
      renameCalls++;
      if (renameCalls === 1) throw Object.assign(new Error('transient EBUSY'), { code: 'EBUSY' });
      return fs.renameSync(from, to);
    };
    const first = makeProcLedger({ fs: flakyFs, pathMod: path, file: fileTransient, clock, probe: async () => new Map(), killTree: async () => {} });
    first.record({ pid: 4242, cmd: 'cmd.exe /c terminal-child', kind: 'terminal.pty' });
    A.eq(renameCalls, 2, 'a transient cleanup-receipt rename is retried exactly once');
    A.eq(JSON.parse(fs.readFileSync(fileTransient, 'utf8')).procs.map(p => p.pid), [4242],
      'the retry leaves the terminal cleanup receipt durable');
    const killedTransient = [];
    const afterRestart = makeProcLedger({
      fs, pathMod: path, file: fileTransient, clock,
      probe: async () => new Map([[4242, 'cmd.exe /c terminal-child']]),
      killTree: async pid => killedTransient.push(pid)
    });
    const swept = await afterRestart.sweep();
    A.eq(swept.examined, 1, 'the next boot sees the retried terminal receipt');
    A.eq(killedTransient, [4242], 'the next boot reaps the owned terminal child');
  }

  // ---- 3. next boot sweeps: kills the match, skips the recycled pid, drops the dead one ----
  const killed = [];
  const l2 = makeProcLedger({
    fs, pathMod: path, file, clock,
    probe: async (pids) => {
      A.eq(pids.slice().sort().join(','), '101,102', 'sweep probes exactly the recorded pids');
      // 101 still runs the same command; 102 was recycled by an unrelated process; (dead pids just absent)
      return new Map([[101, 'cmd.exe /d /s /c "npm run dev"'], [102, 'C:\\Windows\\System32\\svchost.exe']]);
    },
    killTree: async (pid) => killed.push(pid)
  });
  const s = await l2.sweep();
  A.eq(killed.join(','), '101', 'ONLY the still-matching orphan is killed');
  A.eq(s.killed, 1, 'summary counts the kill');
  A.eq(s.reused, 1, 'summary counts the recycled pid (not killed)');
  A.eq(s.examined, 2, 'summary examined everything recorded');
  const afterSweep = JSON.parse(fs.readFileSync(file, 'utf8'));
  A.eq(afterSweep.procs.length, 0, 'sweep clears the previous life\'s entries');

  // ---- 3b. creation-time guard: a matching cmdline is STILL not killed if the live process started after we
  //         recorded it (a recycled PID whose command coincidentally matches the user's own process) ----
  const killedT = [];
  const fileT = path.join(dir, 'ct.json');
  const lT1 = makeProcLedger({ fs, pathMod: path, file: fileT, clock: { now: () => 100000 }, probe: async () => new Map(), killTree: async () => {} });
  lT1.record({ pid: 700, cmd: 'npm run dev', kind: 'shell.bg' });   // recorded at t=100000
  const lT2 = makeProcLedger({
    fs, pathMod: path, file: fileT, clock: { now: () => 100000 },
    // same command, but the live process was created LONG AFTER we recorded (200000 >> 100000) -> recycled PID
    probe: async () => new Map([[700, { cmd: 'cmd.exe /d /s /c "npm run dev"', created: 200000 }]]),
    killTree: async (pid) => killedT.push(pid)
  });
  const sT = await lT2.sweep();
  A.eq(killedT.length, 0, 'a newer-than-recorded process is NOT killed even though its command matches');
  A.eq(sT.reused, 1, 'creation-time guard counts it as a recycled pid');
  // and the inverse: a process created BEFORE we recorded (our real orphan) IS killed
  const killedT2 = [];
  const fileT2 = path.join(dir, 'ct2.json');
  const lU1 = makeProcLedger({ fs, pathMod: path, file: fileT2, clock: { now: () => 100000 }, probe: async () => new Map(), killTree: async () => {} });
  lU1.record({ pid: 701, cmd: 'npm run dev', kind: 'shell.bg' });
  const lU2 = makeProcLedger({
    fs, pathMod: path, file: fileT2, clock: { now: () => 100000 },
    probe: async () => new Map([[701, { cmd: 'cmd.exe /d /s /c "npm run dev"', created: 99000 }]]),   // created before startedAt
    killTree: async (pid) => killedT2.push(pid)
  });
  await lU2.sweep();
  A.eq(killedT2.join(','), '701', 'our real orphan (created before we recorded it) IS reaped');

  // ---- 3c. exact OS identity: redact the secret-bearing argv on disk, then pin PID + creation time. The next
  //         boot must reap that exact child even though the redacted command cannot token-match the live argv.
  const secret = 'Bearer super-secret-value';
  const redacted = 'curl -H "Authorization: Bearer [REDACTED]" http://127.0.0.1';
  const realCmd = 'cmd.exe /d /s /c "curl -H \\"Authorization: ' + secret + '\\" http://127.0.0.1"';
  const fileS = path.join(dir, 'secret-identity.json');
  const lS1 = makeProcLedger({
    fs, pathMod: path, file: fileS, clock: { now: () => 300000 },
    probe: async () => new Map([[702, { cmd: realCmd, created: 299999 }]]),
    killTree: async () => {}
  });
  lS1.record({ pid: 702, cmd: redacted, kind: 'shell.bg' });
  await lS1.pinIdentity(702);
  const pinnedRaw = fs.readFileSync(fileS, 'utf8');
  A.ok(pinnedRaw.indexOf('super-secret-value') < 0, 'the exact orphan identity never persists plaintext argv secrets');
  const pinned = JSON.parse(pinnedRaw).procs[0];
  A.eq(pinned.created, 299999, 'record pins the exact OS process creation time after spawn');
  const killedS = [];
  const lS2 = makeProcLedger({
    fs, pathMod: path, file: fileS, clock: { now: () => 300000 },
    probe: async () => new Map([[702, { cmd: realCmd, created: 299999 }]]),
    killTree: async (pid) => killedS.push(pid)
  });
  await lS2.sweep();
  A.eq(killedS.join(','), '702', 'exact PID + creation identity reaps a secret-bearing orphan despite redacted cmd mismatch');

  // A matching PID and command with creation time even ONE millisecond newer is a recycled process. Never kill it.
  const fileR = path.join(dir, 'exact-reuse.json');
  const lR1 = makeProcLedger({
    fs, pathMod: path, file: fileR, clock: { now: () => 400000 },
    probe: async () => new Map([[703, { cmd: 'cmd.exe /c npm run dev', created: 399999 }]]),
    killTree: async () => {}
  });
  lR1.record({ pid: 703, cmd: 'npm run dev', kind: 'shell.bg' });
  await lR1.pinIdentity(703);
  const killedR = [];
  const lR2 = makeProcLedger({
    fs, pathMod: path, file: fileR, clock: { now: () => 400000 },
    probe: async () => new Map([[703, { cmd: 'cmd.exe /c npm run dev', created: 400000 }]]),
    killTree: async (pid) => killedR.push(pid)
  });
  const sR = await lR2.sweep();
  A.eq(killedR.length, 0, 'creation identity +1ms is PID reuse and is never killed');
  A.eq(sR.reused, 1, 'exact creation mismatch is reported as PID reuse');

  // ---- 4. sweep with an empty ledger is a no-op that never probes ----
  let probed = false;
  const l3 = makeProcLedger({ fs, pathMod: path, file, clock, probe: async () => { probed = true; return new Map(); }, killTree: async () => {} });
  const s3 = await l3.sweep();
  A.eq(s3.examined, 0, 'nothing recorded -> nothing examined');
  A.ok(!probed, 'no probe subprocess for an empty ledger');

  // ---- 5. probe failure kills NOTHING (safe default) ----
  const l4 = makeProcLedger({ fs, pathMod: path, file, clock, probe: async () => { throw new Error('boom'); }, killTree: async () => { throw new Error('must not be called'); } });
  l4.record({ pid: 555, cmd: 'x y z' });
  const l5 = makeProcLedger({ fs, pathMod: path, file, clock, probe: async () => { throw new Error('boom'); }, killTree: async () => { A.ok(false, 'killTree must not run on probe failure'); } });
  const s5 = await l5.sweep();
  A.eq(s5.killed, 0, 'probe failure -> zero kills');
  A.eq(s5.probeFailed, true, 'probe failure is reported distinctly (not laundered into every pid being gone)');
  A.eq(JSON.parse(fs.readFileSync(file, 'utf8')).procs.map(p => p.pid), [555], 'probe failure RETAINS the ownership receipt on disk for a later boot');
  A.eq(l5.list().map(p => p.pid), [555], 'probe failure also retains the receipt in memory');

  const killedRetry = [];
  const l5retry = makeProcLedger({
    fs, pathMod: path, file, clock,
    probe: async () => new Map([[555, 'cmd.exe /c x y z']]),
    killTree: async (pid) => killedRetry.push(pid)
  });
  const s5retry = await l5retry.sweep();
  A.eq(s5retry.probeFailed, false, 'a later successful probe resumes ordinary sweep semantics');
  A.eq(killedRetry, [555], 'the retained receipt is reaped on the next successful boot');
  A.eq(JSON.parse(fs.readFileSync(file, 'utf8')).procs.length, 0, 'only the successful retry consumes the receipt');

  // A transient tree-kill failure is equally inconclusive: retain the receipt so the NEXT boot retries.
  const fileK = path.join(dir, 'kill-retry.json');
  makeProcLedger({ fs, pathMod: path, file: fileK, clock, probe: async () => new Map(), killTree: async () => {} })
    .record({ pid: 556, cmd: 'node owned-server.js', kind: 'shell.bg' });
  const k1 = makeProcLedger({
    fs, pathMod: path, file: fileK, clock,
    probe: async () => new Map([[556, 'cmd.exe /c node owned-server.js']]),
    killTree: async () => { throw new Error('transient access denied'); }
  });
  const ks1 = await k1.sweep();
  A.eq(ks1.killFailed, 1, 'tree-kill failure is reported distinctly');
  A.eq(JSON.parse(fs.readFileSync(fileK, 'utf8')).procs.map(p => p.pid), [556], 'tree-kill failure RETAINS the ownership receipt on disk');
  const killedK = [];
  const k2 = makeProcLedger({
    fs, pathMod: path, file: fileK, clock,
    probe: async () => new Map([[556, 'cmd.exe /c node owned-server.js']]),
    killTree: async (pid) => killedK.push(pid)
  });
  const ks2 = await k2.sweep();
  A.eq(ks2.killed, 1, 'the next boot retries and reaps the retained orphan');
  A.eq(killedK, [556], 'the retry targets the original owned pid');
  A.eq(JSON.parse(fs.readFileSync(fileK, 'utf8')).procs.length, 0, 'only a successful tree kill consumes the receipt');

  // The real Windows adapter must surface taskkill rejection to sweep(); swallowing it would still erase the
  // receipt while claiming a kill. This stays injected so the fast gate never kills a host process.
  const winKill = _internals.makeKillTree((exe, args, opts, cb) => cb(new Error('taskkill denied')), true);
  let winKillRejected = false;
  try { await winKill(556); } catch (_) { winKillRejected = true; }
  A.ok(winKillRejected, 'Windows taskkill rejection reaches the durable retry path');

  // ---- 5b. managed Windows fallback: CIM denial still pins/reaps exact identities; unpinned stays retained ----
  {
    const calls = [];
    const probe = _internals.makeWin32Probe((exe, args, opts, cb) => {
      calls.push(args.join(' '));
      if (calls.length === 1) return cb(Object.assign(new Error('access denied'), { code: 5 }), '');
      cb(null, JSON.stringify({ ProcessId: 811, CreatedMs: 7001 }));
    });
    const got = await probe([811]);
    A.eq(got.get(811).created, 7001, 'Get-Process fallback preserves exact creation identity when CIM is denied');
    A.eq(got.get(811).identityOnly, true, 'fallback is explicitly marked identity-only');
    A.eq(calls.length, 2, 'CIM denial invokes exactly one safe fallback probe');

    const fileU = path.join(dir, 'identity-only-unpinned.json');
    const u1 = makeProcLedger({ fs, pathMod: path, file: fileU, clock, probe: async () => new Map(), killTree: async () => {} });
    u1.record({ pid: 812, cmd: 'node unique-server.js' });
    const u2 = makeProcLedger({ fs, pathMod: path, file: fileU, clock, probe: async () => new Map([[812, { cmd: '', created: 7002, identityOnly: true }]]), killTree: async () => A.ok(false, 'identity-only cannot kill an unpinned receipt') });
    const us = await u2.sweep();
    A.eq(us.uncertain, 1, 'an unpinned identity-only result is retained as uncertain');
    A.eq(JSON.parse(fs.readFileSync(fileU, 'utf8')).procs.length, 1, 'uncertain receipt remains durable for a later richer probe');
  }

  // ---- 6. bad pids are refused ----
  const l6 = makeProcLedger({ fs, pathMod: path, file: path.join(dir, 'l6.json'), clock, probe: async () => new Map(), killTree: async () => {} });
  A.eq(l6.record({ pid: 0, cmd: 'x' }), null, 'pid 0 refused');
  A.eq(l6.record({ pid: -4, cmd: 'x' }), null, 'negative pid refused');
  A.eq(l6.list().length, 0, 'nothing recorded from bad pids');

  // ---- 7. cap pressure evicts PROVABLY-DEAD receipts, never the long-lived dev server at the front ----
  // slice(-MAX) used to drop the EARLIEST receipts — exactly the hour-old dev server the boot sweep needs
  // after a force-kill — while keeping the tail's short-lived churn.
  {
    const file7 = path.join(dir, 'l7.json');
    // pid 1000 (the "dev server", recorded FIRST) is alive; pids 1001-1010 (early churn) are dead.
    // The probe canary (our own pid) always answers — a healthy probe proves absence means dead.
    const aliveSet = new Set([1000, Number(process.pid)]);
    for (let p = 1011; p <= 1105; p++) aliveSet.add(p);
    const l7 = makeProcLedger({
      fs, pathMod: path, file: file7, clock,
      probe: async (pids) => { const m = new Map(); for (const p of pids.map(Number)) if (aliveSet.has(p)) m.set(p, { cmd: 'x', created: 1 }); return m; },
      killTree: async () => {}
    });
    for (let p = 1000; p <= 1105; p++) l7.record({ pid: p, cmd: p === 1000 ? 'npm run dev' : 'quick task ' + p, kind: 'shell.bg' });
    await new Promise(r => setTimeout(r, 30));   // let the async pressure prune land
    const pids7 = l7.list().map(r => r.pid);
    A.ok(pids7.includes(1000), 'the oldest LIVE receipt (the dev server) survives cap pressure');
    A.ok(!pids7.includes(1001), 'a provably-dead early receipt is the one evicted');
    A.ok(pids7.length <= 101, 'the ledger stays near its cap after pruning (' + pids7.length + ')');

    // ALL-DEAD WINDOW STILL PRUNES (review pass): an empty candidate result used to read as "ambiguous"
    // and no-op forever — the normal steady state once the oldest window is all churn — so the ledger
    // climbed to the hard ceiling and front-dropped the very receipt the fix protects. The canary makes
    // absence provable. A probe that misses even the canary (broken) must still prune nothing.
    const file8 = path.join(dir, 'l8.json');
    let probeBroken = false;
    const l8 = makeProcLedger({
      fs, pathMod: path, file: file8, clock,
      probe: async (pids) => {
        const m = new Map();
        if (probeBroken) return m;                                  // broken: not even the canary answers
        for (const p of pids.map(Number)) if (p === Number(process.pid) || p === 2000) m.set(p, { cmd: 'x', created: 1 });
        return m;
      },
      killTree: async () => {}
    });
    l8.record({ pid: 2000, cmd: 'npm run dev', kind: 'shell.bg' });                 // the long-lived child (alive)
    for (let p = 2001; p <= 2110; p++) l8.record({ pid: p, cmd: 'churn ' + p, kind: 'shell.bg' });   // all dead
    await new Promise(r => setTimeout(r, 30));
    const pids8 = l8.list().map(r => r.pid);
    A.ok(pids8.includes(2000), 'the live dev server survives an ALL-DEAD candidate window');
    A.ok(pids8.length <= 101, 'the all-dead window pruned down to the cap (' + pids8.length + ') instead of no-opping to the hard ceiling');
    probeBroken = true;
    const before8 = l8.list().length;
    for (let p = 3000; p <= 3020; p++) l8.record({ pid: p, cmd: 'more ' + p, kind: 'shell.bg' });
    await new Promise(r => setTimeout(r, 30));
    A.ok(l8.list().length >= before8, 'a BROKEN probe (canary missing) prunes nothing — live receipts are never laundered into dead');
  }

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  A.report('procledger.test');
})().catch(e => { console.error(e); process.exit(1); });
