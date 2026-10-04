#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 't4-update-delivery.mjs');
const lint = path.join(ROOT, 'scripts', 'lint-evidence-secrets.mjs');
const BUCKETS = ['save', 'notebook', 'todo', 'channels', 'ledger', 'runs', 'transcript', 'update-settings'];

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.SKYNET_OPENROUTER_KEY;
  delete env.STARNET_OPENROUTER_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.SKYNET_AUDIT_LIVE_PROVIDER;
  delete env.STARNET_T4_REQUIRE_LIVE;
  return env;
}
function run(args, env) {
  return spawnSync(process.execPath, [script].concat(args || []), {
    cwd: ROOT,
    encoding: 'utf8',
    env: cleanEnv(env)
  });
}
function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
function writeJson(file, value, bom) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (bom ? '\ufeff' : '') + JSON.stringify(value, null, 2));
}
function stateHashes() {
  const before = {};
  const after = {};
  for (const bucket of BUCKETS) {
    const sha256 = hashText('state:' + bucket);
    before[bucket] = { sha256, bytes: 100 + bucket.length };
    after[bucket] = { sha256, bytes: 100 + bucket.length };
  }
  return { before, after };
}
function proof(hash, bytes, overrides) {
  const hashes = stateHashes();
  const doc = {
    schema: 'starnet.t4-update-delivery-proof.v1',
    generatedAt: new Date().toISOString(),
    sourceMachine: { os: 'Windows 11 Test VM', machineKind: 'windows-sandbox' },
    installer: { sha256: hash, bytes },
    update: {
      mode: 'manual-nsis-reinstall',
      previousVersion: '0.1.0',
      targetVersion: '0.1.0',
      existingInstallPath: 'C:\\Users\\test\\AppData\\Local\\Programs\\StarNet',
      updatedInstallPath: 'C:\\Users\\test\\AppData\\Local\\Programs\\StarNet',
      launchedBefore: true,
      launchedAfter: true,
      exitCode: 0,
      durationMs: 90000,
      timeoutMs: 600000
    },
    state: {
      protectedBuckets: BUCKETS.slice(),
      before: hashes.before,
      after: hashes.after,
      unchanged: true,
      backupBeforeMigrate: true,
      failurePreservesOriginal: true
    },
    workload: {
      completed: true,
      durationMs: 42000,
      timeoutMs: 600000,
      runIds: ['run-1'],
      transcriptIds: ['stream-1'],
      ledgerRows: [{ model: 'test/model', spendUsd: 0.01 }],
      modelNames: ['test/model'],
      toolCalls: ['fs_write', 'notebook_write', 'shell_exec'],
      artifactPaths: ['phase5-ref-workload.md'],
      liveProvider: true,
      paidSmoke: { succeeded: true, spendUsd: 0.01 }
    },
    notes: []
  };
  if (overrides) overrides(doc);
  return doc;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't4-update-delivery-'));
try {
  const installer = path.join(tmp, 'StarNet_0.1.0_x64-setup.exe');
  fs.writeFileSync(installer, 'fake installer');
  const hash = hashFile(installer);
  const bytes = fs.statSync(installer).size;

  {
    const out = path.join(tmp, 'blocked-out');
    const res = run(['--loop=2'], {
      STARNET_T4_INSTALLER_EXE: installer,
      STARNET_T4_UPDATE_DELIVERY_DIR: out,
      STARNET_T4_UPDATE_DELIVERY_LATEST_DIR: path.join(tmp, 'blocked-latest')
    });
    assert.equal(res.status, 2, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't4-update-delivery-status.json'), 'utf8'));
    assert.equal(status.verdict, 'blocked');
    assert.equal(status.updateDeliveryReady, false);
    assert.equal(status.nextAction.id, 't4.2-reinstall-over-state-proof');
    assert.equal(status.results.find(r => r.id === 't4.1-existing-state-fixture').status, 'pass');
  }

  {
    const bad = path.join(tmp, 'bad-proof.json');
    writeJson(bad, proof('00' + hash.slice(2), bytes));
    const out = path.join(tmp, 'red-out');
    const res = run(['--update-proof', bad], {
      STARNET_T4_INSTALLER_EXE: installer,
      STARNET_T4_UPDATE_DELIVERY_DIR: out,
      STARNET_T4_UPDATE_DELIVERY_LATEST_DIR: path.join(tmp, 'red-latest')
    });
    assert.equal(res.status, 1, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't4-update-delivery-status.json'), 'utf8'));
    assert.equal(status.verdict, 'red');
    assert.equal(status.nextAction.id, 't4.2-reinstall-over-state-proof');
  }

  {
    const good = path.join(tmp, 'good-proof.json');
    writeJson(good, proof(hash, bytes), true);
    const out = path.join(tmp, 'green-out');
    const latest = path.join(tmp, 'green-latest');
    const res = run(['--loop=2', '--update-proof=' + good], {
      STARNET_T4_INSTALLER_EXE: installer,
      STARNET_T4_UPDATE_DELIVERY_DIR: out,
      STARNET_T4_UPDATE_DELIVERY_LATEST_DIR: latest
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't4-update-delivery-status.json'), 'utf8'));
    assert.equal(status.schema, 'starnet.t4-update-delivery-status.v1');
    assert.equal(status.verdict, 'green');
    assert.equal(status.updateDeliveryReady, true);
    assert.equal(status.nextAction, null);
    assert.ok(status.results.every(r => r.status === 'pass'), 'all latest T4 steps should pass');
    assert.ok(fs.existsSync(path.join(latest, 't4-update-delivery-status.json')), 'latest status should be copied');
    assert.ok(fs.existsSync(path.join(out, 'imported-update-delivery-proof.json')), 'imported proof should be normalized');
    const lintRes = spawnSync(process.execPath, [lint, latest], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.equal(lintRes.status, 0, lintRes.stderr || lintRes.stdout);
  }

  {
    const noPaid = path.join(tmp, 'no-paid-proof.json');
    writeJson(noPaid, proof(hash, bytes, doc => {
      doc.workload.liveProvider = false;
      doc.workload.paidSmoke = { succeeded: false, spendUsd: 0 };
    }));
    const out = path.join(tmp, 'live-required-out');
    const res = run(['--require-live', '--update-proof', noPaid], {
      STARNET_T4_INSTALLER_EXE: installer,
      STARNET_T4_UPDATE_DELIVERY_DIR: out,
      STARNET_T4_UPDATE_DELIVERY_LATEST_DIR: path.join(tmp, 'live-required-latest')
    });
    assert.equal(res.status, 1, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't4-update-delivery-status.json'), 'utf8'));
    assert.equal(status.verdict, 'red');
    assert.equal(status.liveRequired, true);
    assert.equal(status.nextAction.id, 't4.4-post-update-installed-workload');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('t4-update-delivery.test: OK (22 assertions)');
