#!/usr/bin/env node
'use strict';

// Fake-io unit test for scripts/release-ritual.mjs: step ORDER, every STOP condition, re-runnability,
// the gate-log verification (last line, never exit code; log must postdate HEAD), and the no-push law.

const A = require('./_assert.js');
const { runRitual, renderRitual, verifyGateLog, STEPS, parseRitualArgs } = require('../scripts/release-ritual.mjs');

const HEAD = 'c'.repeat(40);
const KEY = '/keys/starnet-updater.key';

/** A stateful fake repo. Mutating commands (bump, commit, tag) update the state like the real tools would. */
function fakeRepo(opts) {
  opts = opts || {};
  const st = {
    version: opts.version || '0.10.7',
    branch: opts.branch || 'feat/harness-backend',
    head: HEAD,
    subject: opts.subject || 'qa: record something',
    notes: opts.notes || '# StarNet v0.10.7\n\n- old notes\n',
    claimsPass: opts.claimsPass !== false,
    tags: Object.assign({}, opts.tags || {}),
    files: Object.assign({ [KEY]: 'secret', 'qa/product-perfect/claims.json': JSON.stringify({ releaseSurface: { old: true }, claims: [] }) }, opts.files || {}),
    ready: opts.ready !== false,
    commitTs: 1_700_000_000,
    bumpFails: !!opts.bumpFails
  };
  const calls = [];
  const writes = [];
  const pins = () => ({
    'package.json': JSON.stringify({ version: st.version }),
    'package-lock.json': JSON.stringify({ version: st.version, packages: { '': { version: st.version } } }),
    'src-tauri/tauri.conf.json': JSON.stringify({ version: st.version, plugins: { updater: { endpoints: ['https://github.com/acme/rel/releases/latest/download/latest.json'] } } }),
    'src-tauri/Cargo.toml': 'version = "' + st.version + '"\n',
    'src-tauri/Cargo.lock': 'name = "skynet-desktop"\nversion = "' + st.version + '"\n',
    'RELEASE_NOTES.md': st.notes
  });
  const io = {
    st, calls, writes,
    readText(p) { const all = Object.assign(pins(), st.files); return Object.prototype.hasOwnProperty.call(all, p) ? all[p] : null; },
    writeText(p, t) { writes.push(p); st.files[p] = t; },
    mkdirp() {},
    exists(p) { return this.readText(p) != null; },
    listDir() { return null; },
    stat(p) { return st.files[p + '#mtime'] ? { mtimeMs: st.files[p + '#mtime'] } : null; },
    exec(cmd, args) {
      const key = cmd + ' ' + args.join(' ');
      calls.push(key);
      const ok = (stdout) => ({ status: 0, stdout: stdout || '', stderr: '' });
      if (cmd === 'git') {
        const a = args.join(' ');
        if (a === 'rev-parse --abbrev-ref HEAD') return ok(st.branch + '\n');
        if (a === 'rev-parse HEAD') return ok(st.head + '\n');
        if (a === 'log -1 --format=%s') return ok(st.subject + '\n');
        if (a.startsWith('log -1 --format=%ct')) return ok(String(st.commitTs) + '\n');
        if (a === 'status --porcelain --untracked-files=normal') return ok('');
        if (a.startsWith('tag --list ')) { const t = args[2]; return ok(st.tags[t] ? t + '\n' : ''); }
        if (a.startsWith('rev-list -n 1 ')) { const t = args[3]; return st.tags[t] ? ok(st.tags[t] + '\n') : { status: 128, stdout: '', stderr: 'unknown revision' }; }
        if (a.startsWith('ls-remote')) return ok('');
        if (a.startsWith('rev-list --count')) return ok('0\n');
        if (a.startsWith('tag ')) { st.tags[args[1]] = st.head; return ok(''); }
        if (a.startsWith('commit -m ')) { st.subject = args[2]; st.head = st.head.replace(/^./, (c) => String.fromCharCode(c.charCodeAt(0) + 1)); st.commitTs += 60; return ok(''); }
        if (a.startsWith('push')) throw new Error('THE RITUAL MUST NEVER PUSH');
        return { status: 128, stdout: '', stderr: 'fixture: unknown git ' + a };
      }
      if (cmd === 'gh') return { status: 1, stdout: '', stderr: 'release not found' };
      if (key === 'node scripts/qa/product-perfect/claims.mjs') return st.claimsPass ? ok('PASS claims planning authority · 37 claims\n') : { status: 2, stdout: 'BLOCKED claims planning authority\n  - release surface bytes changed: RELEASE_NOTES.md\n', stderr: '' };
      if (key.startsWith('node scripts/qa/product-perfect/claims.mjs --refresh-surface --candidate ')) { st.claimsPass = true; return ok(JSON.stringify({ sourceCommit: args[3], files: [] })); }
      if (key === 'node scripts/sync-website-app.mjs --check') return ok('');
      if (key === 'node scripts/qa/ready.mjs --json') return ok(JSON.stringify({ ready: st.ready, reasons: st.ready ? [] : ['1. Green Guardian last cycle: RED'] }));
      if (key.startsWith('node scripts/release-bump.mjs ')) {
        if (st.bumpFails) return { status: 1, stdout: '', stderr: 'release-bump: new version is not strictly greater' };
        A.eq(args[2], '--no-tag', 'bump is invoked with --no-tag (the tag goes on the re-lock commit)');
        st.version = args[1]; st.notes = '# StarNet v' + args[1] + '\n\n- TODO: summarize what changed in this release.\n'; st.subject = 'release: v' + args[1]; st.claimsPass = false; st.head = 'd'.repeat(40); st.commitTs += 60;
        return ok('committed: release: v' + args[1] + '\n');
      }
      return { status: 127, stdout: '', stderr: 'fixture: no such command ' + key };
    },
    now() { return Date.parse('2026-08-21T12:00:00Z'); }
  };
  return io;
}

const ids = (r) => r.steps.map(s => s.id + ':' + s.status);
const CTX = { next: 'patch', keyFile: KEY };

// ── arg parsing ──
{
  const a = parseRitualArgs(['--next', 'patch', '--dry-run', '--gates-proven-by', 'a.log', '--gates-proven-by=b.log', '--allow-lane', '--require-http']);
  A.eq(a.next, 'patch', '--next'); A.ok(a.dryRun, '--dry-run'); A.eq(a.gatesProvenBy, ['a.log', 'b.log'], 'repeatable --gates-proven-by'); A.ok(a.allowLane && a.requireHttp, 'flags');
}

// ── STEPS order is the practiced ritual ──
A.eq([...STEPS], ['preflight', 'bump', 'notes', 'relock', 'gates', 'preflight-post', 'tag', 'push-stop'], 'step order locked');

// ── dry-run: prints every step, mutates nothing ──
{
  const io = fakeRepo();
  const r = runRitual(Object.assign({ dryRun: true }, CTX), io);
  A.eq(r.target, '0.10.8', 'dry-run derives --next patch');
  A.eq(r.steps.map(s => s.id), [...STEPS], 'dry-run walks all eight steps');
  A.eq(r.exitCode, 0, 'dry-run exits 0');
  A.eq(io.writes, [], 'dry-run writes nothing');
  A.eq(io.st.version, '0.10.7', 'dry-run does not bump');
  A.eq(Object.keys(io.st.tags), [], 'dry-run does not tag');
  A.ok(!io.calls.some(c => /release-bump|git commit|git tag v/.test(c)), 'dry-run spawns no mutating command');
  const text = renderRitual(r, { dryRun: true });
  A.ok(/DRY RUN/.test(text) && /would run: node scripts\/release-bump.mjs 0.10.8 --no-tag/.test(text), 'plan names the exact bump command');
  A.ok(/git push origin HEAD v0.10.8/.test(text), 'plan prints the push command');
  A.ok(/FIRES .github\/workflows\/release-train.yml/.test(text) && /--clobber/.test(text), 'plan warns what the push triggers + the clobber');
  A.ok(/t0-clean-install-proof/.test(text) && /g1-packaged-lifecycle/.test(text), 'plan lists T0 + G1 as owed after push');
}

// ── dry-run on a lane still shows the whole plan, with the merge stop named ──
{
  const r = runRitual(Object.assign({ dryRun: true }, CTX), fakeRepo({ branch: 'agent/foo' }));
  A.eq(r.steps.length, 8, 'lane dry-run shows all steps');
  A.ok(r.steps[0].lines.some(l => /would STOP here/.test(l)), 'lane preflight FAIL is shown as would-STOP');
  A.ok(r.steps[6].lines.some(l => /git merge agent\/foo -m "merge: cut v0.10.8"/.test(l)), 'lane tag step names the merge');
}

// ── stop 1: preflight red (NOT READY) stops before the bump ──
{
  const io = fakeRepo({ ready: false });
  const r = runRitual(CTX, io);
  A.eq(r.stoppedAt, 'preflight', 'stops at preflight');
  A.eq(r.exitCode, 2, 'stop exit code 2');
  A.eq(io.st.version, '0.10.7', 'nothing bumped on a red preflight');
  A.ok(!io.calls.some(c => /release-bump/.test(c)), 'bump never spawned');
}

// ── stop 1b: lane without --allow-lane stops at preflight ──
{
  const r = runRitual(CTX, fakeRepo({ branch: 'agent/foo' }));
  A.eq(r.stoppedAt, 'preflight', 'lane without --allow-lane stops');
}

// ── happy path on trunk: bump → notes STOP → (notes written) → relock → gates STOP → (log) → post preflight → tag → push-stop ──
{
  const io = fakeRepo();
  const r1 = runRitual(CTX, io);
  A.eq(io.st.version, '0.10.8', 'run 1 bumped');
  A.eq(io.st.subject, 'release: v0.10.8', 'run 1 produced the release commit');
  A.eq(r1.stoppedAt, 'notes', 'run 1 stops at notes (TODO scaffold)');
  A.ok(r1.steps.find(s => s.id === 'notes').lines.some(l => /--amend --no-edit/.test(l)), 'notes stop tells how to amend');
  A.eq(Object.keys(io.st.tags), [], 'no tag before notes');

  // operator writes the notes and amends (same HEAD subject)
  io.st.notes = '# StarNet v0.10.8\n\n- fixed the thing\n';
  const r2 = runRitual(CTX, io);
  A.eq(r2.target, '0.10.8', 'run 2 keeps the SAME target from HEAD subject (no double bump)');
  A.eq(io.st.version, '0.10.8', 'run 2 did not bump again');
  A.eq(ids(r2).slice(0, 4), ['preflight:skipped', 'bump:done', 'notes:done', 'relock:ran'], 'run 2: bump+notes done, relock ran');
  A.eq(io.st.subject, 'qa(claims): re-lock the release surface for v0.10.8', 'relock committed as its own commit');
  A.ok(io.writes.includes('qa/product-perfect/claims.json'), 'relock spliced claims.json');
  A.eq(r2.stoppedAt, 'gates', 'run 2 stops at gates');
  A.ok(r2.steps.find(s => s.id === 'gates').lines.some(l => /npm run test:fast 2>&1 \| tee gate-fast.log/.test(l)), 'gates stop prints the exact command');
  A.ok(r2.steps.find(s => s.id === 'gates').lines.some(l => /never the exit code/.test(l)), 'gates stop states the last-line law');
  A.eq(Object.keys(io.st.tags), [], 'no tag before gates');

  // a RED log is refused
  io.st.files['red.log'] = 'run-fast-tests: FAILED at step 3/654: node test/x.js (exit 1)\n';
  io.st.files['red.log#mtime'] = (io.st.commitTs + 100) * 1000;
  const r3 = runRitual(Object.assign({ gatesProvenBy: ['red.log'] }, CTX), io);
  A.eq(r3.stoppedAt, 'gates', 'red log still stops at gates');
  A.ok(r3.steps.find(s => s.id === 'gates').lines.some(l => /REJECTED red.log/.test(l)), 'red log rejected by name');

  // a green log that PREDATES the commit is refused
  io.st.files['old.log'] = 'run-fast-tests: OK — 654 step(s) green\n';
  io.st.files['old.log#mtime'] = (io.st.commitTs - 100) * 1000;
  const r4 = runRitual(Object.assign({ gatesProvenBy: ['old.log'] }, CTX), io);
  A.eq(r4.stoppedAt, 'gates', 'stale log still stops');
  A.ok(r4.steps.find(s => s.id === 'gates').lines.some(l => /predates HEAD/.test(l)), 'stale log reason');

  // a green log newer than HEAD is accepted → receipt written → tag
  io.st.files['gate-fast.log'] = 'lots of output\nrun-fast-tests: OK — 654 step(s) green\n';
  io.st.files['gate-fast.log#mtime'] = (io.st.commitTs + 100) * 1000;
  const r5 = runRitual(Object.assign({ gatesProvenBy: ['gate-fast.log'] }, CTX), io);
  const receiptPath = '.dogfood/gate-receipts/' + io.st.head + '.fast.json';
  A.ok(io.writes.includes(receiptPath), 'receipt written for HEAD');
  const receipt = JSON.parse(io.st.files[receiptPath]);
  A.eq([receipt.commit, receipt.gate, receipt.green, receipt.steps], [io.st.head, 'fast', true, 654], 'receipt content');
  A.eq(ids(r5), ['preflight:skipped', 'bump:done', 'notes:done', 'relock:done', 'gates:done', 'preflight-post:ran', 'tag:ran', 'push-stop:stopped'], 'run 5 completes through the tag and stops before push');
  A.eq(io.st.tags['v0.10.8'], io.st.head, 'tag placed on HEAD = the re-lock commit');
  A.eq(r5.exitCode, 0, 'complete ritual exits 0 (awaiting the human push)');
  A.ok(!io.calls.some(c => /git push/.test(c)), 'NEVER pushed');
  A.ok(renderRitual(r5, CTX).includes('git push origin HEAD v0.10.8'), 'push command printed for the human');

  // re-run after completion is idempotent: everything done, nothing re-tagged
  const before = io.calls.length;
  const r6 = runRitual(CTX, io);
  A.eq(ids(r6).filter(x => /tag/.test(x)), ['tag:done'], 're-run after completion: tag done, not re-created');
  A.ok(!io.calls.slice(before).some(c => /^git tag v/.test(c) || /git commit/.test(c)), 're-run is read-only');
}

// ── --require-http makes the http receipt mandatory ──
{
  const io = fakeRepo({ version: '0.10.8', subject: 'qa(claims): re-lock the release surface for v0.10.8', notes: '# StarNet v0.10.8\n\n- notes\n' });
  io.st.files['.dogfood/gate-receipts/' + HEAD + '.fast.json'] = JSON.stringify({ commit: HEAD, gate: 'fast', green: true, steps: 654, at: 'x' });
  const r = runRitual(Object.assign({ requireHttp: true }, CTX), io);
  A.eq(r.stoppedAt, 'gates', 'fast-only receipt stops when --require-http');
  const r2 = runRitual(CTX, io);
  A.eq(r2.steps.find(s => s.id === 'gates').status, 'done', 'without --require-http the fast receipt suffices (http noted as not required)');
}

// ── lane flow (--allow-lane): bump + relock happen, tag STOPs with the merge command ──
{
  const io = fakeRepo({ branch: 'agent/hotfix' });
  io.st.files['gate-fast.log'] = 'run-fast-tests: OK — 654 step(s) green\n';
  const lane = Object.assign({ allowLane: true }, CTX);
  runRitual(lane, io);                      // bump → notes stop
  io.st.notes = '# StarNet v0.10.8\n\n- hotfix\n';
  runRitual(lane, io);                      // relock → gates stop
  io.st.files['gate-fast.log#mtime'] = (io.st.commitTs + 10) * 1000;
  const r = runRitual(Object.assign({ gatesProvenBy: ['gate-fast.log'] }, lane), io);
  A.eq(r.stoppedAt, 'tag', 'lane stops at tag');
  A.eq(r.exitCode, 3, 'lane merge-stop exit code 3');
  A.eq(Object.keys(io.st.tags), [], 'lane never tags');
  A.ok(r.steps.find(s => s.id === 'tag').lines.some(l => /git merge agent\/hotfix -m "merge: cut v0.10.8"/.test(l)), 'merge command printed');
}

// ── tag collision at a different commit stops ──
{
  const io = fakeRepo({ version: '0.10.8', subject: 'qa(claims): re-lock the release surface for v0.10.8', notes: '# StarNet v0.10.8\n\n- n\n', tags: { 'v0.10.8': 'e'.repeat(40) } });
  io.st.files['.dogfood/gate-receipts/' + HEAD + '.fast.json'] = JSON.stringify({ commit: HEAD, gate: 'fast', green: true, steps: 1 });
  const r = runRitual({ version: '0.10.8', keyFile: KEY }, io);
  A.ok(['preflight-post', 'tag'].includes(r.stoppedAt), 'existing tag elsewhere stops before tagging (at ' + r.stoppedAt + ')');
  A.eq(io.st.tags['v0.10.8'], 'e'.repeat(40), 'tag not moved');
}

// ── bump failure stops ──
{
  const io = fakeRepo({ bumpFails: true });
  const r = runRitual(CTX, io);
  A.eq(r.stoppedAt, 'bump', 'release-bump non-zero stops at bump');
}

// ── verifyGateLog directly ──
{
  const io = fakeRepo();
  io.st.files['g.log'] = 'run-test-list: OK — 78 step(s) green\n'; io.st.files['g.log#mtime'] = (io.st.commitTs + 1) * 1000;
  const v = verifyGateLog(io, 'g.log', io.st.head);
  A.eq([v.ok, v.gate, v.steps], [true, 'http', 78], 'http log verified');
  A.ok(!verifyGateLog(io, 'missing.log', io.st.head).ok, 'missing log rejected');
}

A.report();
