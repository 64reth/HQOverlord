#!/usr/bin/env node
/* W0 gate: prove the proof chain itself before later product claims can advance. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const candidate = String(process.env.STARNET_PRODUCT_PERFECT_CANDIDATE_SHA || '').trim().toLowerCase();

function run(label, args, timeoutMs) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    console.error('[W0 FAIL] ' + label + ' — ' + (result.error ? result.error.message : 'exit ' + result.status));
    return false;
  }
  console.log('[W0 PASS] ' + label);
  return true;
}

if (!/^[0-9a-f]{40}$/.test(candidate)) {
  console.error('[W0 BLOCKED] controller did not provide an exact candidate SHA');
  process.exit(2);
}

const source = fs.readFileSync(path.join(ROOT, 'scripts', 'qa', 'installed-smoke.mjs'), 'utf8');
if (/git\s+rev-parse\s+HEAD/.test(source) || /gitHead\s*[:=]/.test(source)) {
  console.error('[W0 FAIL] installed smoke still derives tested-build identity from ambient Git HEAD');
  process.exit(1);
}

const deterministic = [
  ['product-perfect controller tests', ['test/qa-product-perfect.test.js'], 60000],
  ['finite advertised-claims tests', ['test/qa-product-perfect-claims.test.js'], 120000],
  ['build provenance taxonomy tests', ['test/qa-product-perfect-provenance.test.js'], 60000],
  ['installed desktop proof tests', ['test/qa-installed-smoke.test.js'], 60000],
  ['READY proof tests', ['test/qa-ready.test.js'], 60000],
  ['release provenance tests', ['test/release-train-provenance.test.js'], 60000],
  ['desktop-origin HTTP seam', ['test/sidecar.http.test.js'], 300000]
];
for (const [label, args, timeout] of deterministic) {
  if (!run(label, args, timeout)) process.exit(1);
}

if (!run('finite advertised-claims planning authority', ['scripts/qa/product-perfect/claims.mjs', '--planning'], 120000)) {
  process.exit(1);
}

console.log('[W0 PASS] claims planning and proof primitives are candidate-bound @ ' + candidate);
process.exit(0);
