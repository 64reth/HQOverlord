/* node test/eval-soak-receipt.test.js — completed control soaks are validated and signed without promotion. */
'use strict';
const A = require('./_assert.js');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'starnet-soak-receipt-'));
try {
  const privateKey = join(temp, 'private.pem'), publicKey = join(temp, 'public.pem');
  const soakFile = join(temp, 'soak.json'), manifestFile = join(temp, 'manifest.json'), receiptFile = join(temp, 'receipt.json');
  const executableSha = createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
  const describe = 'v0.8.5-test';
  const keygen = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'keygen', '--private', privateKey, '--public', publicKey], { cwd: root, encoding: 'utf8' });
  A.eq(keygen.status, 0, 'test receipt key is generated');
  writeFileSync(manifestFile, JSON.stringify({ subject: {
    name: 'StarNet', version: '0.8.5', commit: 'a'.repeat(40), dirty: false,
    sourceTree: { value: 'b'.repeat(40) }, executable: { path: process.execPath, sha256: executableSha },
    platform: { platform: 'win32', arch: 'x64' },
    provenance: { verified: true, describe }
  } }));
  const samples = Array.from({ length: 4 }, (_, index) => ({
    at: new Date(Date.parse('2026-08-03T00:00:00.000Z') + index * 1000).toISOString(),
    ok: true, status: 200, version: describe, rssBytes: 100 + index, cpuSeconds: index, exited: false, error: ''
  }));
  const soak = {
    schemaVersion: 'starnet.eval.soak.v1', mode: 'provider-free-control-plane', qualifiesRelease: false,
    startedAt: '2026-08-03T00:00:00.000Z', plannedEndAt: '2026-08-03T00:00:03.600Z', endedAt: '2026-08-03T00:00:03.700Z',
    durationHours: 0.001, intervalSeconds: 1, interrupted: false, runtime: { describe }, samples,
    summary: { pass: true, completed: true, healthChecks: 4, healthFailures: 0, unexpectedExits: 0, rssBytes: { first: 100, last: 103, min: 100, max: 103 } },
    limitations: ['No provider credential or model run is used.']
  };
  writeFileSync(soakFile, JSON.stringify(soak));
  const args = ['scripts/eval/soak-receipt.mjs', '--soak', soakFile, '--manifest', manifestFile,
    '--contract', 'scripts/eval/contracts/v0.9.0.json', '--signing-key', privateKey, '--receipt', receiptFile];
  const green = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  A.eq(green.status, 0, 'complete healthy soak produces a green receipt');
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  A.ok(receipt.result.pass && receipt.candidateBound, 'receipt is green and candidate-bound');
  A.eq(receipt.result.qualifiesRelease, false, 'provider-free receipt cannot qualify the release');
  A.ok(receipt.limitations.some(row => /cannot replace installed provider-backed/.test(row)), 'receipt preserves the release limitation');
  const verify = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'verify-receipt', '--receipt', receiptFile], { cwd: root, encoding: 'utf8' });
  A.eq(verify.status, 0, 'green soak receipt signature verifies');

  soak.samples[2].ok = false; soak.summary.healthFailures = 1; soak.summary.pass = false;
  writeFileSync(soakFile, JSON.stringify(soak));
  const red = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  A.eq(red.status, 1, 'one failed sample produces a red receipt');
  const redReceipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  A.ok(!redReceipt.result.pass && redReceipt.result.checks.some(row => row.id === 'health' && !row.pass), 'red receipt names the health failure');
  const verifyRed = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'verify-receipt', '--receipt', receiptFile], { cwd: root, encoding: 'utf8' });
  A.eq(verifyRed.status, 0, 'red evidence is still signed and tamper-evident');

  soak.samples[2].ok = true; soak.summary.healthFailures = 0;
  soak.samples[3].at = soak.samples[2].at;
  soak.samples[3].cpuSeconds = 1;
  writeFileSync(soakFile, JSON.stringify(soak));
  const stalled = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  A.eq(stalled.status, 1, 'a stalled clock and regressing process observation produce a red receipt');
  const stalledReceipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  A.ok(stalledReceipt.result.checks.some(row => row.id === 'sampling-cadence' && !row.pass), 'red receipt names non-monotonic sampling');
  A.ok(stalledReceipt.result.checks.some(row => row.id === 'resource-continuity' && !row.pass), 'red receipt names regressing resource evidence');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
A.report('eval-soak-receipt.test');
