#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'phase5.mjs');

function withoutLiveKeyEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.SKYNET_OPENROUTER_KEY;
  delete env.STARNET_OPENROUTER_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.SKYNET_AUDIT_LIVE_PROVIDER;
  return env;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-runner-'));
try {
  const outDir = path.join(tmp, 'out');
  const latestDir = path.join(tmp, 'latest');
  const result = spawnSync(process.execPath, [script, '--live', '--require-ready'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: withoutLiveKeyEnv({
      STARNET_PHASE5_DIR: outDir,
      STARNET_PHASE5_LATEST_DIR: latestDir
    })
  });

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stdout, /BLOCKED 5\.2-live-provider-required/);
  assert.ok(!/ENOENT/.test(result.stderr + result.stdout), 'blocked live-key run should not crash while writing summary');

  const statusFile = path.join(outDir, 'phase5-status.json');
  const summaryFile = path.join(outDir, 'summary.md');
  const latestStatusFile = path.join(latestDir, 'phase5-status.json');
  assert.ok(fs.existsSync(statusFile), 'blocked run writes status evidence');
  assert.ok(fs.existsSync(summaryFile), 'blocked run writes markdown summary');
  assert.ok(fs.existsSync(latestStatusFile), 'blocked run refreshes latest evidence copy');

  const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
  assert.equal(status.verdict, 'blocked');
  assert.equal(status.liveKeyPresent, false);
  assert.equal(status.replacementReady, false);
  assert.equal(status.counts.blocked, 1);
  assert.match(fs.readFileSync(summaryFile, 'utf8'), /5\.2-live-provider-required/);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('phase5.runner.test: OK (10 assertions)');
