#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');

const ROOT = resolve(__dirname, '..');
const timeoutScript = join(ROOT, 'scripts', 'timeout.mjs');

function run(args, timeout = 5000) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout
  });
}

{
  const result = run([
    timeoutScript,
    '--timeout=5000',
    '--label=timeout-success-test',
    '--',
    process.execPath,
    '-e',
    'console.log("timeout-ok")'
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /timeout-ok/);
}

{
  const started = Date.now();
  const result = run([
    timeoutScript,
    '--timeout=1000',
    '--label=timeout-hang-test',
    '--',
    process.execPath,
    '-e',
    'setInterval(() => {}, 1000)'
  ], 6000);
  const elapsed = Date.now() - started;
  assert.equal(result.status, 124, result.stderr || result.stdout);
  assert.ok(elapsed < 5000, 'timeout wrapper should terminate quickly; elapsed=' + elapsed);
  assert.match(result.stderr + result.stdout, /exceeded 1000ms/);
}

console.log('timeout.test: OK (6 assertions)');
