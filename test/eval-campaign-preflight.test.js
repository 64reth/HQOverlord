/* node test/eval-campaign-preflight.test.js — Wave B campaign must fail closed before provider spend. */
'use strict';
const A = require('./_assert.js');
const { createHash } = require('node:crypto');
const { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const root = resolve(__dirname, '..');
const executableSha = createHash('sha256').update(readFileSync(process.execPath)).digest('hex');
const temp = mkdtempSync(join(tmpdir(), 'starnet-campaign-preflight-'));
try {
  const credential = join(temp, 'tokens.json');
  const wrongExecutable = join(temp, 'wrong.exe');
  const candidateManifest = join(temp, 'candidate.json');
  const referenceManifest = join(temp, 'reference.json');
  const output = join(temp, 'preflight.json');
  writeFileSync(credential, '{}\n');
  writeFileSync(wrongExecutable, 'not the candidate');
  writeFileSync(candidateManifest, JSON.stringify({
    subject: {
      commit: 'a'.repeat(40), dirty: false,
      executable: { path: process.execPath, sha256: executableSha },
      provenance: { verified: true, kind: 'test-binding' }
    }
  }));
  writeFileSync(referenceManifest, JSON.stringify({
    subject: {
      name: 'Hermes Agent', version: '0.19.1', commit: 'cc4cab2f592e60a197e796506de9168f74baf3ea', dirty: false,
      sourceTree: { value: 'fcdc6093750ed0a3a556e20927799d7245ba65e4' },
      executable: { path: process.execPath, sha256: executableSha },
      provenance: { verified: true, kind: 'test-binding' }
    }
  }));

  const common = ['scripts/eval/campaign-preflight.mjs',
    '--contract', 'scripts/eval/contracts/v0.9.0.json',
    '--candidate-manifest', candidateManifest,
    '--reference-manifest', referenceManifest,
    '--fixtures', 'scripts/eval/fixtures/parity-v0.9.0.jsonl',
    '--tasks', 'scripts/eval/packs/parity-v0.9.0.jsonl',
    '--credential-envelope', credential,
    '--rotation-after', '2026-01-01T00:00:00.000Z',
    '--output', output];
  const run = installed => spawnSync(process.execPath, [...common, '--installed-executable', installed], { cwd: root, encoding: 'utf8' });

  const green = run(process.execPath);
  A.eq(green.status, 0, 'matching executable, frozen reference, complete fixtures, and fresh credential pass preflight');
  const greenReport = JSON.parse(readFileSync(output, 'utf8'));
  A.ok(greenReport.pass, 'green report records pass');
  A.eq(greenReport.plannedRowsPerHarness, 96, 'preflight freezes three attempts across all 32 scenarios');
  A.eq(greenReport.credentialMetadata.contentsRead, false, 'preflight records that credential contents were not read');
  A.ok(greenReport.checks.every(row => row.pass), 'every green preflight check is explicit');

  const mismatch = run(wrongExecutable);
  A.eq(mismatch.status, 1, 'an installed executable mismatch blocks the campaign');
  const mismatchReport = JSON.parse(readFileSync(output, 'utf8'));
  A.ok(!mismatchReport.pass && mismatchReport.checks.some(row => row.id === 'installed-candidate-match' && !row.pass),
    'mismatch report names the installed candidate binding failure');

  const old = new Date('2025-01-01T00:00:00.000Z');
  utimesSync(credential, old, old);
  const stale = run(process.execPath);
  A.eq(stale.status, 1, 'a stale credential envelope blocks the campaign');
  const staleReport = JSON.parse(readFileSync(output, 'utf8'));
  A.ok(!staleReport.pass && staleReport.checks.some(row => row.id === 'credential-rotated' && !row.pass),
    'stale report names the credential freshness failure');
  A.ok(!JSON.stringify(staleReport).includes('{}'), 'credential contents never enter the evidence report');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
A.report('eval-campaign-preflight.test');
