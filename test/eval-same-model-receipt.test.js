/* node test/eval-same-model-receipt.test.js — three same-model attempts are fail-closed, bound, and signed. */
'use strict';
const A = require('./_assert.js');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'starnet-same-model-receipt-'));
try {
  const contract = JSON.parse(readFileSync(join(root, 'scripts/eval/contracts/v0.9.0.json'), 'utf8'));
  const executableSha = createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
  const manifest = (name, version, commit, tree) => ({ subject: {
    name, version, commit, dirty: false, sourceTree: { algorithm: 'git-tree', value: tree },
    executable: { path: process.execPath, bytes: readFileSync(process.execPath).length, sha256: executableSha },
    platform: { platform: process.platform, arch: process.arch }, provenance: { verified: true }
  } });
  const subjectFile = join(temp, 'subject.json'), referenceFile = join(temp, 'reference.json');
  writeFileSync(subjectFile, JSON.stringify(manifest('StarNet', '0.8.5', 'a'.repeat(40), 'b'.repeat(40))));
  writeFileSync(referenceFile, JSON.stringify(manifest('Hermes Agent', contract.reference.version, contract.reference.commit, contract.reference.sourceTree)));
  const probe = index => ({
    schemaVersion: 'starnet.eval.same-model-probe.v1', generatedAt: new Date().toISOString(),
    prompt: 'Return exactly PARITY-PROBE-731 and no other text.', comparisonModel: 'gpt-5.6-luna', sameModel: true, pass: true,
    starnet: { ok: true, status: 200, model: 'gpt-5.6-luna', provider: 'openai-codex', text: 'PARITY-PROBE-731', bootMs: 100 + index, firstTokenMs: 200 + index, totalMs: 300 + index, usage: { total_tokens: 400 + index } },
    hermes: { ok: true, exitCode: 0, model: 'gpt-5.6-luna', provider: 'openai-codex', text: 'PARITY-PROBE-731', firstOutputMs: 500 + index, totalMs: 600 + index, usage: { total_tokens: 700 + index } }
  });
  const probeFiles = [1, 2, 3].map(index => { const file = join(temp, `probe-${index}.json`); writeFileSync(file, JSON.stringify(probe(index))); return file; });
  const privateKey = join(temp, 'private.pem'), publicKey = join(temp, 'public.pem'), receiptFile = join(temp, 'receipt.json');
  const keygen = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'keygen', '--private', privateKey, '--public', publicKey], { cwd: root, encoding: 'utf8' });
  A.eq(keygen.status, 0, 'test receipt key is generated');
  const args = ['scripts/eval/same-model-receipt.mjs', '--probes', probeFiles.join(','), '--subject-manifest', subjectFile,
    '--reference-manifest', referenceFile, '--contract', 'scripts/eval/contracts/v0.9.0.json', '--signing-key', privateKey, '--receipt', receiptFile];
  const green = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  A.eq(green.status, 0, 'three exact same-model attempts produce a green receipt' + (green.stderr ? `: ${green.stderr.trim()}` : ''));
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  A.ok(receipt.result.pass && receipt.candidateBound && receipt.referenceBound, 'receipt is green and binds both executable identities');
  A.eq(receipt.result.measurements.starnet.firstOutputMs.median, 202, 'receipt reports the StarNet median');
  A.eq(receipt.result.measurements.reference.totalMs.median, 602, 'receipt reports the reference median');
  A.eq(receipt.evidence.probes.length, 3, 'receipt hashes every raw probe');
  const verify = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'verify-receipt', '--receipt', receiptFile], { cwd: root, encoding: 'utf8' });
  A.eq(verify.status, 0, 'green receipt signature verifies');

  const mismatched = probe(3); mismatched.hermes.model = 'gpt-5.6-sol'; mismatched.sameModel = false; mismatched.pass = false;
  writeFileSync(probeFiles[2], JSON.stringify(mismatched));
  const red = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  A.eq(red.status, 1, 'one model mismatch produces a red receipt');
  const redReceipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  A.ok(!redReceipt.result.pass && redReceipt.result.checks.some(row => row.id === 'same-explicit-model' && !row.pass), 'red receipt names the model mismatch');
  const verifyRed = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'verify-receipt', '--receipt', receiptFile], { cwd: root, encoding: 'utf8' });
  A.eq(verifyRed.status, 0, 'red evidence remains signed and tamper-evident');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
A.report('eval-same-model-receipt.test');
