#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 't3-release-smoke.mjs');
const lint = path.join(ROOT, 'scripts', 'lint-evidence-secrets.mjs');

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.SKYNET_OPENROUTER_KEY;
  delete env.STARNET_OPENROUTER_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.SKYNET_AUDIT_LIVE_PROVIDER;
  delete env.STARNET_T3_REQUIRE_LIVE;
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
function writeJson(file, value, bom) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, (bom ? '\ufeff' : '') + JSON.stringify(value, null, 2));
}
function t0Status(hash, bytes) {
  return {
    verdict: 'green',
    cleanInstallProofReady: true,
    results: [{ id: 't0.1-release-installer', artifacts: { installer: { sha256: hash, bytes } } }]
  };
}
function t2Status() {
  return { schema: 'starnet.t2-state-safety-status.v1', verdict: 'green', stateSafetyReady: true };
}
function proof(hash, bytes, overrides) {
  return Object.assign({
    schema: 'starnet.t3-installed-workload-proof.v1',
    generatedAt: new Date().toISOString(),
    sourceMachine: { os: 'Windows 11 Test VM', machineKind: 'windows-sandbox' },
    installer: { sha256: hash, bytes },
    installedApp: { source: 'nsis-installed', launched: true, usableHarness: true, observedWindowTitle: 'StarNet' },
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
  }, overrides || {});
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't3-release-smoke-'));
try {
  const installer = path.join(tmp, 'StarNet_0.1.0_x64-setup.exe');
  fs.writeFileSync(installer, 'fake installer');
  const hash = hashFile(installer);
  const bytes = fs.statSync(installer).size;
  const t0 = path.join(tmp, 't0-status.json');
  const t2 = path.join(tmp, 't2-status.json');
  writeJson(t0, t0Status(hash, bytes));
  writeJson(t2, t2Status());

  {
    const out = path.join(tmp, 'blocked-out');
    const res = run(['--loop=2'], {
      STARNET_T3_INSTALLER_EXE: installer,
      STARNET_T3_T0_STATUS: t0,
      STARNET_T3_T2_STATUS: t2,
      STARNET_T3_RELEASE_SMOKE_DIR: out,
      STARNET_T3_RELEASE_SMOKE_LATEST_DIR: path.join(tmp, 'blocked-latest')
    });
    assert.equal(res.status, 2, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't3-release-smoke-status.json'), 'utf8'));
    assert.equal(status.verdict, 'blocked');
    assert.equal(status.releaseSmokeReady, false);
    assert.equal(status.nextAction.id, 't3.4-installed-workload-proof');
  }

  {
    const bad = path.join(tmp, 'bad-proof.json');
    writeJson(bad, proof('00' + hash.slice(2), bytes));
    const out = path.join(tmp, 'red-out');
    const res = run(['--workload-evidence', bad], {
      STARNET_T3_INSTALLER_EXE: installer,
      STARNET_T3_T0_STATUS: t0,
      STARNET_T3_T2_STATUS: t2,
      STARNET_T3_RELEASE_SMOKE_DIR: out,
      STARNET_T3_RELEASE_SMOKE_LATEST_DIR: path.join(tmp, 'red-latest')
    });
    assert.equal(res.status, 1, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't3-release-smoke-status.json'), 'utf8'));
    assert.equal(status.verdict, 'red');
    assert.equal(status.nextAction.id, 't3.4-installed-workload-proof');
  }

  {
    const good = path.join(tmp, 'good-proof.json');
    writeJson(good, proof(hash, bytes), true);
    const out = path.join(tmp, 'green-out');
    const latest = path.join(tmp, 'green-latest');
    const res = run(['--loop=2', '--workload-evidence=' + good], {
      STARNET_T3_INSTALLER_EXE: installer,
      STARNET_T3_T0_STATUS: t0,
      STARNET_T3_T2_STATUS: t2,
      STARNET_T3_RELEASE_SMOKE_DIR: out,
      STARNET_T3_RELEASE_SMOKE_LATEST_DIR: latest
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't3-release-smoke-status.json'), 'utf8'));
    assert.equal(status.schema, 'starnet.t3-release-smoke-status.v1');
    assert.equal(status.verdict, 'green');
    assert.equal(status.releaseSmokeReady, true);
    assert.equal(status.nextAction, null);
    assert.ok(fs.existsSync(path.join(latest, 't3-release-smoke-status.json')), 'latest status should be copied');
    const lintRes = spawnSync(process.execPath, [lint, latest], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.equal(lintRes.status, 0, lintRes.stderr || lintRes.stdout);
  }

  {
    const noPaid = path.join(tmp, 'no-paid-proof.json');
    const doc = proof(hash, bytes);
    doc.workload.liveProvider = false;
    doc.workload.paidSmoke = { succeeded: false, spendUsd: 0 };
    writeJson(noPaid, doc);
    const out = path.join(tmp, 'live-required-out');
    const res = run(['--require-live', '--workload-evidence', noPaid], {
      STARNET_T3_INSTALLER_EXE: installer,
      STARNET_T3_T0_STATUS: t0,
      STARNET_T3_T2_STATUS: t2,
      STARNET_T3_RELEASE_SMOKE_DIR: out,
      STARNET_T3_RELEASE_SMOKE_LATEST_DIR: path.join(tmp, 'live-required-latest')
    });
    assert.equal(res.status, 1, res.stderr || res.stdout);
    const status = JSON.parse(fs.readFileSync(path.join(out, 't3-release-smoke-status.json'), 'utf8'));
    assert.equal(status.verdict, 'red');
    assert.equal(status.liveRequired, true);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('t3-release-smoke.test: OK (17 assertions)');
