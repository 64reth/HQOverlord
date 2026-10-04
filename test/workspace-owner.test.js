/* node test/workspace-owner.test.js — process-wide ownership for StarNet's single-writer stores. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('./_assert.js');
const { makeWorkspaceOwner } = require('../sidecar/workspace-owner.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-owner-'));
const lockfile = path.join(root, '.starnet-workspace-owner.json');
try {
  const first = makeWorkspaceOwner({ fs, path, pid: 41001, now: () => 100, nonce: () => 'first', pidAlive: p => p === 41001 });
  const a = first.acquire(root);
  A.eq(a.ok, true, 'first sidecar owns a free workspace');
  A.eq(JSON.parse(fs.readFileSync(lockfile, 'utf8')).pid, 41001, 'claim identifies its holder');

  const second = makeWorkspaceOwner({ fs, path, pid: 41002, now: () => 200, nonce: () => 'second', pidAlive: p => p === 41001 });
  const blocked = second.acquire(root);
  A.eq(blocked.ok, false, 'a second live sidecar is refused');
  A.eq(blocked.code, 'WORKSPACE_BUSY', 'collision fails with the stable safety code');
  A.eq(blocked.holder.pid, 41001, 'collision names the current holder');

  A.eq(second.release(), false, 'a non-owner cannot release another process claim');
  A.eq(fs.existsSync(lockfile), true, 'the legitimate holder claim remains');
  A.eq(first.release(), true, 'the legitimate holder can release');
  A.eq(fs.existsSync(lockfile), false, 'clean release removes the claim');

  const crashed = makeWorkspaceOwner({ fs, path, pid: 41003, now: () => 300, nonce: () => 'crashed', pidAlive: () => false });
  A.eq(crashed.acquire(root).ok, true, 'a replacement holder can acquire');
  // Simulate an uncatchable desktop kill: no release. A subsequent process proves the PID dead and reclaims.
  const recovered = makeWorkspaceOwner({ fs, path, pid: 41004, now: () => 400,
    nonce: (() => { let n = 0; return () => 'recovery-' + (++n); })(), pidAlive: () => false });
  A.eq(recovered.acquire(root).ok, true, 'a provably dead holder is reclaimed immediately');
  A.eq(JSON.parse(fs.readFileSync(lockfile, 'utf8')).pid, 41004, 'recovery installs the successor claim');
  A.eq(crashed.release(), false, 'a stale process instance cannot unlink its successor claim');

  recovered.release();
  fs.writeFileSync(lockfile, '{not-json');
  const cautious = makeWorkspaceOwner({ fs, path, pid: 41005, now: () => 500, nonce: () => 'cautious', pidAlive: () => false });
  const malformed = cautious.acquire(root);
  A.eq(malformed.ok, false, 'a malformed holder claim is never guessed stale');
  A.eq(malformed.code, 'WORKSPACE_BUSY', 'unprovable ownership fails closed');

  // REBOOT RECLAIM (2026-08-22 macOS dead-end): PIDs restart at boot, so a crash + reboot leaves a stamp whose
  // PID now belongs to some unrelated LIVE process. kill(0) alone said "busy" forever. A claim stamped before
  // the current boot is provably dead regardless of who owns that PID today.
  fs.unlinkSync(lockfile);
  const BOOT = 10_000_000;
  const preReboot = makeWorkspaceOwner({ fs, path, pid: 41006, now: () => BOOT - 3_600_000, nonce: () => 'prereboot', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(preReboot.acquire(root).ok, true, 'pre-reboot holder claims (fixture)');
  const reused = makeWorkspaceOwner({ fs, path, pid: 41007, now: () => BOOT + 5_000, nonce: () => 'afterboot', pidAlive: () => true, bootedAt: () => BOOT });
  const afterBoot = reused.acquire(root);
  A.eq(afterBoot.ok, true, 'a claim stamped before this boot is reclaimed even though its PID is live (reused)');
  A.eq(JSON.parse(fs.readFileSync(lockfile, 'utf8')).pid, 41007, 'the post-boot sidecar owns the workspace');
  reused.release();

  // within one boot, a live PID is still busy — the boot rule never weakens the same-boot guarantee.
  const sameBootA = makeWorkspaceOwner({ fs, path, pid: 41008, now: () => BOOT + 10_000, nonce: () => 'sbA', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(sameBootA.acquire(root).ok, true, 'same-boot holder claims');
  const sameBootB = makeWorkspaceOwner({ fs, path, pid: 41009, now: () => BOOT + 20_000, nonce: () => 'sbB', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(sameBootB.acquire(root).code, 'WORKSPACE_BUSY', 'a live same-boot holder still blocks');
  // a holder stamped within the 60s slack after boot is NOT treated as pre-boot.
  sameBootA.release();
  const nearBoot = makeWorkspaceOwner({ fs, path, pid: 41010, now: () => BOOT - 30_000, nonce: () => 'near', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(nearBoot.acquire(root).ok, true, 'near-boot holder claims');
  A.eq(sameBootB.acquire(root).code, 'WORKSPACE_BUSY', 'a holder inside the boot slack is still busy (clock skew is not death)');
  nearBoot.release();

  // a torn/empty lock left by a crash mid-write: reclaimable only when the FILE predates boot.
  fs.writeFileSync(lockfile, '');
  const tornRecent = makeWorkspaceOwner({ fs, path, pid: 41011, now: () => BOOT + 30_000, nonce: () => 'torn1', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(tornRecent.acquire(root).code, 'WORKSPACE_BUSY', 'a torn lock written this boot stays busy (unprovable)');
  const farFuture = Date.now() + 365 * 24 * 3600 * 1000;   // "boot" after the file's real mtime ⇒ file predates boot
  const tornOld = makeWorkspaceOwner({ fs, path, pid: 41012, now: () => farFuture + 1000, nonce: () => 'torn2', pidAlive: () => true, bootedAt: () => farFuture });
  A.eq(tornOld.acquire(root).ok, true, 'a torn lock from before this boot is reclaimed');
  tornOld.release();

  // unknown boot time (0) ⇒ the rule is inert and only kill(0) decides (the factory default).
  const inertA = makeWorkspaceOwner({ fs, path, pid: 41013, now: () => 1, nonce: () => 'inA', pidAlive: () => true });
  A.eq(inertA.acquire(root).ok, true, 'inert-boot holder claims');
  const inertB = makeWorkspaceOwner({ fs, path, pid: 41014, now: () => Date.now(), nonce: () => 'inB', pidAlive: () => true });
  A.eq(inertB.acquire(root).code, 'WORKSPACE_BUSY', 'with no boot time a live PID is busy (no guessing)');
  inertA.release();

  // A handled write error is not a crash. Leaving the O_EXCL file behind would create a malformed same-boot
  // claim that no later sidecar can prove stale, permanently wedging the workspace until the next OS reboot.
  const failingFs = Object.create(fs);
  failingFs.writeSync = function (fd, raw) {
    fs.writeSync(fd, String(raw).slice(0, 1));
    const error = new Error('simulated owner stamp write failure'); error.code = 'EIO'; throw error;
  };
  const failedClaim = makeWorkspaceOwner({ fs: failingFs, path, pid: 41015, now: () => BOOT + 40_000,
    nonce: () => 'failed-write', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(failedClaim.acquire(root).code, 'WORKSPACE_OWNER_UNAVAILABLE', 'owner stamp write failure is reported');
  A.eq(fs.existsSync(lockfile), false, 'a handled owner stamp write failure removes its partial claim');
  const afterFailedWrite = makeWorkspaceOwner({ fs, path, pid: 41016, now: () => BOOT + 41_000,
    nonce: () => 'after-failed-write', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(afterFailedWrite.acquire(root).ok, true, 'the next sidecar can acquire without waiting for a reboot');
  afterFailedWrite.release();

  // Read-back is part of claim creation too. If it rejects after O_EXCL + fsync, this process still owns the
  // unaccepted file and must remove it; otherwise the malformed/unverifiable same-boot claim wedges the root.
  const unreadableFs = Object.create(fs);
  let rejectOwnerRead = true;
  unreadableFs.readFileSync = function (file, encoding) {
    if (rejectOwnerRead && path.resolve(String(file)) === path.resolve(lockfile)) {
      rejectOwnerRead = false;
      const error = new Error('simulated owner stamp read-back failure'); error.code = 'EIO'; throw error;
    }
    return fs.readFileSync(file, encoding);
  };
  const unreadableClaim = makeWorkspaceOwner({ fs: unreadableFs, path, pid: 41017, now: () => BOOT + 42_000,
    nonce: () => 'failed-readback', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(unreadableClaim.acquire(root).code, 'WORKSPACE_OWNER_UNAVAILABLE', 'owner stamp read-back failure is reported');
  A.eq(fs.existsSync(lockfile), false, 'a rejected owner stamp read-back removes its unaccepted claim');
  const afterFailedRead = makeWorkspaceOwner({ fs, path, pid: 41018, now: () => BOOT + 43_000,
    nonce: () => 'after-failed-readback', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(afterFailedRead.acquire(root).ok, true, 'the next sidecar can acquire after a read-back failure');
  afterFailedRead.release();

  const mismatchedFs = Object.create(fs);
  let mismatchOwnerRead = true;
  mismatchedFs.readFileSync = function (file, encoding) {
    const raw = fs.readFileSync(file, encoding);
    if (mismatchOwnerRead && path.resolve(String(file)) === path.resolve(lockfile)) {
      mismatchOwnerRead = false;
      return String(raw) + ' ';
    }
    return raw;
  };
  const mismatchedClaim = makeWorkspaceOwner({ fs: mismatchedFs, path, pid: 41019, now: () => BOOT + 44_000,
    nonce: () => 'mismatched-readback', pidAlive: () => true, bootedAt: () => BOOT });
  A.eq(mismatchedClaim.acquire(root).code, 'WORKSPACE_OWNER_UNAVAILABLE', 'owner stamp read-back mismatch is reported');
  A.eq(fs.existsSync(lockfile), false, 'a mismatched owner stamp removes its unaccepted claim');

  A.report('workspace-owner.test');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
