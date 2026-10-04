#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { validateReceipt } from './lib/update-continuity.mjs';

const args = process.argv.slice(2);
function values(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name && args[i + 1]) out.push(args[++i]);
  return out;
}
function value(name, fallback = '') { return values(name)[0] || fallback; }
function fail(message) { console.error('release-promotion-gate: ' + message); process.exit(1); }
function hash(file) { return createHash('sha256').update(readFileSync(file)).digest('hex'); }
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name); const stat = statSync(file);
    if (stat.isDirectory()) walk(file, out); else out.push(file);
  }
  return out;
}

const receiptFiles = values('--receipt');
const dist = resolve(value('--dist', 'dist'));
const version = value('--version');
const minSoakHours = Number(value('--min-soak-hours', '24'));
const outFile = resolve(value('--out', 'release/promotion-verdict.json'));
if (!version) fail('--version is required');
if (receiptFiles.length < 2) fail('two --receipt files are required (latest-to-next and n-minus-one-to-next)');
if (!Number.isFinite(minSoakHours) || minSoakHours < 0) fail('--min-soak-hours must be non-negative');

const artifacts = walk(dist);
const accepted = [];
for (const file of receiptFiles) {
  let receipt;
  try { receipt = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch (error) { fail('unreadable receipt: ' + error.message); }
  const verdict = validateReceipt(receipt);
  if (!verdict.ok) fail(basename(file) + ' is invalid: ' + verdict.errors.join(', '));
  if (receipt.versions.target !== version || receipt.versions.after !== version) fail(basename(file) + ' proves a different version');
  const ageHours = (Date.now() - Date.parse(receipt.generatedAt)) / 3600000;
  if (!Number.isFinite(ageHours) || ageHours < minSoakHours) fail(basename(file) + ' has only ' + ageHours.toFixed(2) + ' soak hours; require ' + minSoakHours);
  const matches = artifacts.filter(candidate => basename(candidate) === receipt.installer.artifact);
  if (matches.length !== 1) fail('exact installer ' + receipt.installer.artifact + ' is not unique in ' + dist);
  if (hash(matches[0]) !== receipt.installer.artifactSha256) fail('installer hash differs from canary receipt for ' + receipt.installer.artifact);
  const projection = receipt.state && receipt.state.projection;
  const serialized = JSON.stringify(projection || {});
  if (!/CANARY NOVA/.test(serialized) || !/update-continuity/.test(serialized)) fail('receipt is not the privacy-safe synthetic canary fixture');
  accepted.push({ path: receipt.path, generatedAt: receipt.generatedAt, installer: receipt.installer.artifact, sha256: receipt.installer.artifactSha256, stateFingerprint: receipt.state.afterFingerprint, soakHours: +ageHours.toFixed(2) });
}
for (const required of ['latest-to-next', 'n-minus-one-to-next']) {
  if (!accepted.some(row => row.path === required)) fail('missing required update path: ' + required);
}

const result = { schema: 'starnet.release-promotion-verdict.v1', generatedAt: new Date().toISOString(), version, minSoakHours, privacy: 'synthetic-canary-only', receipts: accepted, ok: true };
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
console.log('release-promotion-gate: PASS ' + version + ' (' + accepted.map(row => row.path).join(', ') + ')');
console.log('verdict: ' + outFile);
