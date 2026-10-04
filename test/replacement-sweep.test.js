#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'replacement-sweep.mjs');

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function writeJson(file, value, bom) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (bom ? '\ufeff' : '') + JSON.stringify(value, null, 2));
}
function cleanEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.STARNET_T0_CLEAN_EVIDENCE;
  delete env.STARNET_T3_WORKLOAD_EVIDENCE;
  delete env.STARNET_T4_UPDATE_PROOF;
  delete env.STARNET_REPLACEMENT_SWEEP_T0_EVIDENCE;
  delete env.STARNET_REPLACEMENT_SWEEP_T3_EVIDENCE;
  delete env.STARNET_REPLACEMENT_SWEEP_T4_EVIDENCE;
  Object.assign(env, extra || {});
  return env;
}
function run(args, env) {
  return spawnSync(process.execPath, [script].concat(args || []), {
    cwd: ROOT,
    encoding: 'utf8',
    env: cleanEnv(env)
  });
}
function baseProof(schema, installer) {
  return {
    schema,
    generatedAt: '2026-06-28T00:00:00.000Z',
    installer: { sha256: installer.sha256, bytes: installer.bytes }
  };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replacement-sweep-'));
try {
  const installer = path.join(tmp, 'StarNet_0.1.0_x64-setup.exe');
  fs.writeFileSync(installer, 'fake installer');
  const installerInfo = { sha256: hashFile(installer), bytes: fs.statSync(installer).size };
  const dogfood = path.join(tmp, '.dogfood');

  const t0Proof = path.join(dogfood, 't0', 'clean-install-proof.json');
  const t3Proof = path.join(dogfood, 't3', 'installed-workload-proof.json');
  const t4Proof = path.join(dogfood, 't4', 'update-delivery-proof.json');
  writeJson(t0Proof, Object.assign(baseProof('starnet.clean-install-proof.v1', installerInfo), {
    cleanMachine: true,
    install: { succeeded: true },
    launch: { succeeded: true }
  }), true);
  writeJson(t3Proof, Object.assign(baseProof('starnet.t3-installed-workload-proof.v1', installerInfo), {
    installedApp: { source: 'nsis-installed', launched: true, usableHarness: true },
    workload: { completed: true, liveProvider: true, paidSmoke: { succeeded: true, spendUsd: 0.01 } }
  }));
  writeJson(t4Proof, Object.assign(baseProof('starnet.t4-update-delivery-proof.v1', installerInfo), {
    update: { mode: 'manual-nsis-reinstall', launchedBefore: true, launchedAfter: true },
    state: { unchanged: true, backupBeforeMigrate: true, failurePreservesOriginal: true },
    workload: { completed: true }
  }));

  {
    const out = path.join(tmp, 'dry-out');
    const latest = path.join(tmp, 'dry-latest');
    const res = run(['--dry-run'], {
      STARNET_REPLACEMENT_SWEEP_INSTALLER_EXE: installer,
      STARNET_REPLACEMENT_SWEEP_DOGFOOD_DIR: dogfood,
      STARNET_REPLACEMENT_SWEEP_DIR: out,
      STARNET_REPLACEMENT_SWEEP_LATEST_DIR: latest
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 'replacement-sweep-status.json'), 'utf8'));
    assert.equal(status.schema, 'starnet.replacement-sweep-status.v1');
    assert.equal(status.verdict, 'green');
    assert.equal(status.replacementSweepReady, true);
    assert.equal(status.dryRun, true);
    assert.equal(status.proofs.t0.path, t0Proof);
    assert.equal(status.proofs.t3.path, t3Proof);
    assert.equal(status.proofs.t4.path, t4Proof);
    assert.ok(fs.existsSync(path.join(latest, 'replacement-sweep-status.json')), 'latest status should be copied');
  }

  {
    const out = path.join(tmp, 'missing-out');
    const res = run(['--dry-run'], {
      STARNET_REPLACEMENT_SWEEP_INSTALLER_EXE: installer,
      STARNET_REPLACEMENT_SWEEP_DOGFOOD_DIR: path.join(tmp, 'empty-dogfood'),
      STARNET_REPLACEMENT_SWEEP_DIR: out,
      STARNET_REPLACEMENT_SWEEP_LATEST_DIR: path.join(tmp, 'missing-latest')
    });
    assert.equal(res.status, 2, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 'replacement-sweep-status.json'), 'utf8'));
    assert.equal(status.verdict, 'blocked');
    assert.equal(status.replacementSweepReady, false);
    assert.equal(status.nextAction.id, 't0-proof-import');
  }

  {
    const out = path.join(tmp, 'override-out');
    const bad = path.join(dogfood, 'bad-t3.json');
    writeJson(bad, baseProof('starnet.t3-installed-workload-proof.v1', { sha256: '0'.repeat(64), bytes: installerInfo.bytes }));
    const res = run(['--dry-run'], {
      STARNET_REPLACEMENT_SWEEP_INSTALLER_EXE: installer,
      STARNET_REPLACEMENT_SWEEP_DOGFOOD_DIR: dogfood,
      STARNET_REPLACEMENT_SWEEP_T3_EVIDENCE: bad,
      STARNET_REPLACEMENT_SWEEP_DIR: out,
      STARNET_REPLACEMENT_SWEEP_LATEST_DIR: path.join(tmp, 'override-latest')
    });
    assert.equal(res.status, 2, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 'replacement-sweep-status.json'), 'utf8'));
    assert.equal(status.results.find(r => r.id === 't3-proof-import').status, 'blocked');
    assert.match(status.results.find(r => r.id === 't3-proof-import').reason, /hash does not match/);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('replacement-sweep.test: OK (19 assertions)');
