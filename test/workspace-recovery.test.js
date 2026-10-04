/* node test/workspace-recovery.test.js — stranded-root discovery, redaction and atomic activation. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Recovery = require('../sidecar/workspace-recovery.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-workspace-recovery-'));
const current = path.join(home, 'Library', 'Application Support', 'ai.skynet.harness', 'workspaces');
const legacyA = path.join(home, '.local', 'share', 'StarNet', 'workspaces');
const legacyB = path.join(home, '.local', 'share', 'Skynet', 'workspaces');

function save(name, updatedAt, marker) {
  return {
    version: 1, agentId: 'agent', updatedAt, savedAt: updatedAt,
    doc: {
      schema: 'starnet.save', version: 5, updatedAt,
      agent: { id: 'agent', name }, station: { rooms: [{ id: marker }], props: [] },
      workstreams: [{ id: 'general', history: [{ role: 'user', content: marker }] }]
    }
  };
}
function write(root, rel, value) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

try {
  write(current, '.migration-receipt.json', { version: 1, validated: true, files: [] });
  write(current, '.migrated', '1');
  write(legacyA, 'agent.save.json', save('NOVA', 1000, 'legacy-a'));
  write(legacyA, 'agent/report.md', 'source must stay byte-exact');
  write(legacyA, '.starnet-workspace-owner.json', JSON.stringify({ pid: 999999 }));

  const one = Recovery.inspectCandidates({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA, legacyB] });
  A.eq(one.recoverableCount, 1, 'one valid stranded station is recoverable');
  A.eq(one.automaticCandidateId, one.candidates[0].id, 'one valid root is an unambiguous automatic candidate');
  A.ok(one.candidates[0].displayRoot.startsWith('~'), 'candidate path redacts the user home');
  A.eq(one.candidates[0].stationName, 'NOVA', 'candidate names the station from the valid save envelope');
  A.eq(Recovery._internals.displayPath('D:\\Profiles\\StarNet\\workspaces', 'C:\\Users\\Ada', require('node:path').win32, 'win32'),
    '[local-data]/StarNet/workspaces', 'a custom data shelf outside the home is never disclosed as an absolute path');

  const report = Recovery.recoveryReport({ fs, path, platform: 'darwin', arch: 'x64', home, workspaceRoot: current, candidateRoots: [legacyA], inspection: one, publicLineage: { evidence: [] } });
  const reportRaw = JSON.stringify(report);
  A.eq(report.architecture, 'x64', 'report records Intel architecture truthfully');
  A.ok(reportRaw.indexOf(home) < 0, 'redacted report contains no absolute user-home path');
  A.ok(reportRaw.indexOf('legacy-a') < 0 && reportRaw.indexOf('source must stay') < 0, 'report contains no save or artifact contents');

  const sourceHash = Recovery._internals.sha256(fs.readFileSync(path.join(legacyA, 'agent.save.json')));
  const requested = Recovery.requestRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], inspection: one, candidateId: one.automaticCandidateId });
  A.eq(requested.ok, true, 'authenticated selection produces a pending recovery request');
  const applied = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], now: () => 2000 });
  A.eq(applied.applied, true, 'next pre-store boot activates the requested station');
  A.eq(JSON.parse(fs.readFileSync(path.join(current, 'agent.save.json'), 'utf8')).doc.agent.name, 'NOVA', 'selected station is active');
  A.eq(fs.readFileSync(path.join(current, 'agent', 'report.md'), 'utf8'), 'source must stay byte-exact', 'complete selected generation is active');
  A.eq(Recovery._internals.sha256(fs.readFileSync(path.join(legacyA, 'agent.save.json'))), sourceHash, 'legacy source remains byte-exact');
  A.eq(fs.existsSync(path.join(legacyA, '.starnet-workspace-owner.json')), true, 'source is not cleaned or mutated');
  A.eq(fs.existsSync(path.join(current, '.starnet-workspace-owner.json')), false, 'stale runtime ownership is not copied into the active generation');
  A.ok(fs.readdirSync(path.dirname(current)).some(name => name.startsWith('workspaces.recovery-rollback-')), 'prior current generation is retained as rollback');
  A.eq(Recovery.readRootCandidate(current, { fs, path }).stationName, 'NOVA', 'fresh store boot can read the recovered canonical save');
  fs.writeFileSync(Recovery._internals.lastResultFile(current, path), JSON.stringify({ ok: false, error: 'rename failed at ' + legacyA }));
  const redactedFailure = Recovery.recoveryReport({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA] });
  A.ok(!JSON.stringify(redactedFailure).includes(home), 'support report redacts absolute paths from recovery errors too');

  // Reset to an empty active root and prove two distinct valid stations require an explicit choice.
  fs.rmSync(current, { recursive: true, force: true });
  write(current, '.migrated', '1');
  write(legacyB, 'agent.save.json', save('ORION', 2000, 'legacy-b'));
  const conflict = Recovery.inspectCandidates({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA, legacyB] });
  A.eq(conflict.recoverableCount, 2, 'both valid station generations are shown');
  A.eq(conflict.distinctSaveCount, 2, 'different save bytes are identified as a real conflict');
  A.eq(conflict.automaticCandidateId, null, 'conflict has no automatic winner');
  const untouched = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA, legacyB], auto: true, scratchRoots: [] });
  A.eq(untouched.applied, false, 'automatic boot refuses to choose between stations');
  A.ok(!untouched.autoSkipped, 'with scratchRoots:[] the refusal is the CONFLICT rule, not the scratch guard');
  A.eq(fs.existsSync(path.join(current, 'agent.save.json')), false, 'conflict leaves active workspace empty and unmodified');

  const selectedB = conflict.candidates.find(row => row.stationName === 'ORION');
  Recovery.requestRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA, legacyB], inspection: conflict, candidateId: selectedB.id });
  const resolved = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA, legacyB], now: () => 3000 });
  A.eq(resolved.stationName, 'ORION', 'explicit conflict selection activates exactly the chosen station');
  A.eq(JSON.parse(fs.readFileSync(path.join(current, 'agent.save.json'), 'utf8')).doc.station.rooms[0].id, 'legacy-b', 'unselected station never contaminates the chosen generation');

  // An unreadable save remains visible for reporting but can never become a selectable request.
  fs.rmSync(current, { recursive: true, force: true });
  fs.rmSync(legacyA, { recursive: true, force: true });
  fs.rmSync(legacyB, { recursive: true, force: true });
  write(legacyA, 'agent.save.json', '{not json');
  const invalid = Recovery.inspectCandidates({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA] });
  A.eq(invalid.candidates[0].recoverable, false, 'invalid prior save is disclosed without claiming recoverability');
  A.throws(() => Recovery.requestRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], inspection: invalid, candidateId: invalid.candidates[0].id }), 'invalid candidate cannot be requested');

  // Concurrency: activation is serialized behind the PARENT-level recovery lock. A live holder
  // fails the second boot CLOSED (no mutation, request untouched); a provably-dead holder's lock
  // is broken and recovery proceeds.
  fs.rmSync(current, { recursive: true, force: true });
  fs.rmSync(legacyA, { recursive: true, force: true });
  write(current, '.migrated', '1');
  write(legacyA, 'agent.save.json', save('VEGA', 4000, 'legacy-lock'));
  const lockInspection = Recovery.inspectCandidates({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA] });
  Recovery.requestRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], inspection: lockInspection, candidateId: lockInspection.automaticCandidateId, now: () => 4500 });
  const lockfile = Recovery._internals.recoveryLockFile(current, path);
  A.ok(lockfile.indexOf(current + path.sep) < 0, 'recovery lock lives BESIDE the workspace root, never inside the directory recovery renames');
  fs.writeFileSync(lockfile, '999999:cafe');   // a concurrent holder's stamp
  const refused = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], now: () => 5000, lockPidAlive: () => true });
  A.eq(refused.lockUnavailable, true, 'a live-held recovery lock refuses a second activation');
  A.eq(refused.applied, false, 'refused activation applies nothing');
  A.eq(fs.existsSync(Recovery._internals.requestFile(current, path)), true, 'refused activation leaves the pending request untouched');
  A.eq(fs.existsSync(path.join(current, 'agent.save.json')), false, 'refused activation never mutates the active workspace');
  A.eq(fs.readFileSync(lockfile, 'utf8'), '999999:cafe', 'refused activation never steals the live holder\'s lock');
  fs.utimesSync(lockfile, 0, 0);
  const agedLiveRefused = Recovery.applyPendingRecovery({
    fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA],
    now: () => 9 * 60 * 1000, lockMaxRunMs: 8 * 60 * 1000, lockPidAlive: () => true
  });
  A.eq(agedLiveRefused.lockUnavailable, true, 'an aged recovery lock is NEVER stolen while its holder pid is still alive');
  A.eq(fs.readFileSync(lockfile, 'utf8'), '999999:cafe', 'the aged live holder keeps the exact parent-level lock stamp');
  A.eq(fs.existsSync(path.join(current, 'agent.save.json')), false, 'an aged live holder still blocks every workspace mutation');
  const reclaimed = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], now: () => 6000, lockPidAlive: () => false });
  A.eq(reclaimed.applied, true, 'a provably-dead holder\'s stale lock is broken and recovery proceeds');
  A.eq(JSON.parse(fs.readFileSync(path.join(current, 'agent.save.json'), 'utf8')).doc.agent.name, 'VEGA', 'stale-break activation lands the requested station');
  A.eq(fs.existsSync(lockfile), false, 'recovery lock is released after activation');

  // Size guard: a pathological source fails CLOSED with a clear error before it can be buffered.
  fs.rmSync(current, { recursive: true, force: true });
  fs.rmSync(legacyA, { recursive: true, force: true });
  write(current, '.migrated', '1');
  write(legacyA, 'agent.save.json', save('RIGEL', 7000, 'legacy-big'));
  write(legacyA, 'artifacts/huge.bin', 'x'.repeat(4096));
  const bigInspection = Recovery.inspectCandidates({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA] });
  Recovery.requestRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], inspection: bigInspection, candidateId: bigInspection.automaticCandidateId, now: () => 7500 });
  const tooBig = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], now: () => 8000, maxTotalBytes: 1024 });
  A.eq(tooBig.ok, false, 'over-limit aggregate recovery source fails closed');
  A.eq(tooBig.applied, false, 'over-limit source applies nothing');
  A.ok(/too large/.test(String(tooBig.error)), 'aggregate failure names the size limit: ' + tooBig.error);
  A.eq(fs.existsSync(path.join(current, 'agent.save.json')), false, 'over-limit source never mutates the active workspace');
  A.eq(fs.existsSync(Recovery._internals.requestFile(current, path)), false, 'failed over-limit request is retired, not retried forever');
  Recovery.requestRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], inspection: bigInspection, candidateId: bigInspection.automaticCandidateId, now: () => 8500 });
  const fileTooBig = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home, workspaceRoot: current, candidateRoots: [legacyA], now: () => 9000, maxFileBytes: 256 });
  A.eq(fileTooBig.ok, false, 'a single over-limit file fails the recovery closed');
  A.ok(/per-file/.test(String(fileTooBig.error)), 'per-file failure names the per-file limit: ' + fileTooBig.error);
  A.eq(fs.existsSync(path.join(current, 'agent.save.json')), false, 'per-file over-limit source never mutates the active workspace');

  // ---- SCRATCH-TARGET GUARD (2026-08-19/20 incident): auto recovery must never heal a REAL station INTO a temp
  // workspace. Real filesystem: a fake "real" home holding one unambiguous station + a target under os.tmpdir().
  const realHome = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-fake-real-home-'));
  const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-scratch-target-')) + path.sep + 'workspaces';
  try {
    const realRoot = path.join(realHome, '.local', 'share', 'StarNet', 'workspaces');
    write(realRoot, 'agent.save.json', save('ANDREWS-REAL-STATION', 5000, 'real-station'));
    write(realRoot, 'agent/secret-report.md', 'production bytes');
    const realBytes = fs.readFileSync(path.join(realRoot, 'agent.save.json'));
    // sanity: the fixture IS an unambiguous auto candidate (so a skip below is the guard, not a non-candidate)
    const probe = Recovery.inspectCandidates({ fs, path, platform: 'linux', home: realHome, workspaceRoot: tmpTarget, candidateRoots: [realRoot] });
    A.eq(probe.recoverableCount, 1, 'fixture: one unambiguous real station is visible to auto recovery');
    // (a) default guard: target under os.tmpdir() -> auto recovery SKIPS, nothing ingested, source untouched
    const warns = []; const origWarn = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    let skipped;
    try { skipped = Recovery.applyPendingRecovery({ fs, path, platform: 'linux', home: realHome, workspaceRoot: tmpTarget, candidateRoots: [realRoot], auto: true, now: () => 6000 }); }
    finally { console.warn = origWarn; }
    A.eq(skipped.applied, false, 'auto recovery into a tmpdir target does NOT apply');
    A.eq(skipped.autoSkipped, true, 'result names the skip explicitly (autoSkipped)');
    A.eq(skipped.code, 'AUTO_RECOVERY_TARGET_IS_SCRATCH', 'result carries the scratch code');
    A.eq(fs.existsSync(path.join(tmpTarget, 'agent.save.json')), false, 'the real station was NOT copied into the temp workspace');
    A.eq(fs.existsSync(path.join(tmpTarget, 'agent', 'secret-report.md')), false, 'no production artifact landed in the temp workspace');
    A.eq(fs.readdirSync(path.dirname(tmpTarget)).filter(n => /recovery-(stage|rollback)/.test(n)).length, 0, 'no stage/rollback generation was created');
    A.eq(fs.readFileSync(path.join(realRoot, 'agent.save.json')).equals(realBytes), true, 'real source byte-exact after the skip');
    A.ok(warns.some(w => /\[recovery\] auto station recovery SKIPPED/.test(w)), 'the skip is LOUD: a [recovery] warn line names it (not a silent no-op)');
    // (b) env-declared scratch root outside tmpdir is honored too
    const envScratch = fs.mkdtempSync(path.join(realHome, 'ci-scratch-'));
    const envTarget = path.join(envScratch, 'ws');
    const viaEnv = Recovery.applyPendingRecovery({ fs, path, platform: 'linux', home: realHome, workspaceRoot: envTarget, candidateRoots: [realRoot], auto: true, now: () => 6100,
      tmpdir: () => path.join(realHome, 'not-tmp'), env: { STARNET_SCRATCH_ROOT: envScratch } });
    A.eq(viaEnv.autoSkipped, true, 'STARNET_SCRATCH_ROOT declares a scratch root the guard honors');
    A.eq(fs.existsSync(path.join(envTarget, 'agent.save.json')), false, 'env-declared scratch target never ingests either');
    // (c) a NON-scratch target keeps the existing auto-heal behavior unchanged
    const realTarget = path.join(realHome, 'Library', 'Application Support', 'ai.skynet.harness', 'workspaces');
    const healed = Recovery.applyPendingRecovery({ fs, path, platform: 'darwin', home: realHome, workspaceRoot: realTarget, candidateRoots: [realRoot], auto: true, now: () => 6200,
      tmpdir: () => path.join(realHome, 'not-tmp'), env: {} });
    A.eq(healed.applied, true, 'a non-scratch target still auto-heals one unambiguous station');
    A.eq(JSON.parse(fs.readFileSync(path.join(realTarget, 'agent.save.json'), 'utf8')).doc.agent.name, 'ANDREWS-REAL-STATION', 'non-scratch auto-heal content intact');
    // (d) an EXPLICIT operator request into a tmpdir target is NOT blocked (the guard is auto-only)
    const explicitTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-explicit-target-')) + path.sep + 'workspaces';
    write(explicitTarget, '.migrated', '1');
    const insp = Recovery.inspectCandidates({ fs, path, platform: 'linux', home: realHome, workspaceRoot: explicitTarget, candidateRoots: [realRoot] });
    Recovery.requestRecovery({ fs, path, platform: 'linux', home: realHome, workspaceRoot: explicitTarget, candidateRoots: [realRoot], inspection: insp, candidateId: insp.automaticCandidateId });
    const explicit = Recovery.applyPendingRecovery({ fs, path, platform: 'linux', home: realHome, workspaceRoot: explicitTarget, candidateRoots: [realRoot], auto: true, now: () => 6300 });
    A.eq(explicit.applied, true, 'an explicit operator request still activates even when the target is under tmpdir');
    fs.rmSync(path.dirname(explicitTarget), { recursive: true, force: true });
    // (e) the predicate itself, cross-platform: case-insensitive on win32, prefix-safe (no /tmpx vs /tmp false positive)
    const w = require('node:path').win32;
    A.ok(Recovery.scratchTargetReason({ path: w, platform: 'win32', workspaceRoot: 'C:\\Users\\A\\AppData\\Local\\Temp\\starnet-x\\StarNet\\workspaces', tmpdir: () => 'c:\\users\\a\\appdata\\local\\temp', env: {} }), 'win32: case-insensitive prefix under tmpdir is scratch');
    A.eq(Recovery.scratchTargetReason({ path: w, platform: 'win32', workspaceRoot: 'C:\\Users\\A\\AppData\\Local\\StarNet\\workspaces', tmpdir: () => 'C:\\Users\\A\\AppData\\Local\\Temp', env: {} }), null, 'win32: the real LOCALAPPDATA root is NOT scratch');
    const px = require('node:path').posix;
    A.eq(Recovery.scratchTargetReason({ path: px, platform: 'linux', workspaceRoot: '/tmpx/ws', tmpdir: () => '/tmp', env: {} }), null, 'posix: /tmpx is not under /tmp (no string-prefix false positive)');
    A.ok(Recovery.scratchTargetReason({ path: px, platform: 'linux', workspaceRoot: '/tmp', tmpdir: () => '/tmp', env: {} }), 'posix: the tmpdir itself counts as scratch');
  } finally {
    fs.rmSync(realHome, { recursive: true, force: true });
    fs.rmSync(path.dirname(tmpTarget), { recursive: true, force: true });
  }

  A.report('workspace-recovery.test');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}
