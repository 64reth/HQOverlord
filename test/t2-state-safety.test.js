#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 't2-state-safety.mjs');
const lint = path.join(ROOT, 'scripts', 'lint-evidence-secrets.mjs');

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {})
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2-state-safety-'));
try {
  const out = path.join(tmp, 'out');
  const latest = path.join(tmp, 'latest');
  const res = runNode([script, '--loop=2'], {
    STARNET_T2_STATE_SAFETY_DIR: out,
    STARNET_T2_STATE_SAFETY_LATEST_DIR: latest
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);

  const status = JSON.parse(fs.readFileSync(path.join(out, 't2-state-safety-status.json'), 'utf8'));
  assert.equal(status.schema, 'starnet.t2-state-safety-status.v1');
  assert.equal(status.verdict, 'green');
  assert.equal(status.stateSafetyReady, true);
  assert.equal(status.steps.length, 4);
  assert.ok(status.steps.every(s => s.status === 'pass'), 'all T2 state-safety steps should pass');
  assert.equal(status.nextAction, null);
  assert.equal(status.steps.find(s => s.id === 't2.2-pre-migration-backup').evidence.backupKey, 'starnet.save.pre-migrate.backup');
  assert.equal(status.steps.find(s => s.id === 't2.4-reinstall-workspace-survival').evidence.staleWriteRejected, true);
  assert.ok(fs.existsSync(path.join(latest, 't2-state-safety-status.json')), 'latest status should be copied');
  assert.ok(fs.existsSync(path.join(latest, 'artifact-hashes.json')), 'latest hashes should be copied');

  const lintRes = runNode([lint, latest], {});
  assert.equal(lintRes.status, 0, lintRes.stderr || lintRes.stdout);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('t2-state-safety.test: OK (10 assertions)');
