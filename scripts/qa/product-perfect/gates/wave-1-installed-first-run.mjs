#!/usr/bin/env node
/* W1 gate — one installed first-user result plus installed transport truth.
 * The first-run runner cannot green W1 by itself: the disjoint link lane must provide a
 * candidate/artifact-bound receipt proving >40 seconds of healthy idle stays UP and an
 * actual connection loss transitions DOWN. */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { containsSecretMaterial, validateLinkReceipt } from '../../installed-first-run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');
const QA_INSTALLED = path.join(ROOT, 'qa', 'installed');
const candidateCommit = String(process.env.STARNET_PRODUCT_PERFECT_CANDIDATE_SHA || '').trim().toLowerCase();
const artifactPath = String(process.env.STARNET_FIRST_RUN_ARTIFACT || process.env.STARNET_SMOKE_ARTIFACT || '').trim();
const cdpPortInput = String(process.env.STARNET_FIRST_RUN_CDP_PORT || process.env.STARNET_SMOKE_CDP_PORT || '').trim();
const cdpPort = cdpPortInput ? Number(cdpPortInput) : 9333;

function runNode(label, args, timeoutMs, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT, env: Object.assign({}, process.env, extraEnv), encoding: 'utf8', windowsHide: true,
    timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    console.error('[W1 BLOCKED] ' + label + ' — ' + result.error.message);
    return 2;
  }
  if (result.status !== 0) {
    const blocked = Number(result.status) === 2;
    console.error('[W1 ' + (blocked ? 'BLOCKED' : 'FAIL') + '] ' + label + ' — exit ' + result.status);
    return blocked ? 2 : 1;
  }
  console.log('[W1 PASS] ' + label);
  return 0;
}

function treeOf(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) return '';
  const result = spawnSync('git', ['rev-parse', commit + '^{tree}'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  const value = String(result.stdout || '').trim().toLowerCase();
  return result.status === 0 && /^[0-9a-f]{40}$/.test(value) ? value : '';
}

function hashFile(file) {
  try {
    const resolved = path.resolve(file);
    const bytes = fs.readFileSync(resolved);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || bytes.length <= 0) return null;
    return { path: resolved, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  } catch (_) { return null; }
}

function candidateOwnedFile(relative) {
  relative = String(relative || '').replace(/\\/g, '/');
  const live = path.resolve(ROOT, relative);
  if (!relative || path.relative(ROOT, live).startsWith('..')) return null;
  let candidateBytes = null, liveBytes = null;
  try {
    const shown = spawnSync('git', ['show', candidateCommit + ':' + relative], { cwd: ROOT, encoding: null, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (shown.status === 0 && Buffer.isBuffer(shown.stdout) && shown.stdout.length) candidateBytes = shown.stdout;
    liveBytes = fs.readFileSync(live);
  } catch (_) {}
  if (!candidateBytes || !liveBytes || !candidateBytes.equals(liveBytes)) return null;
  return { path: relative, absolute: live, sha256: crypto.createHash('sha256').update(liveBytes).digest('hex') };
}

function insideInstalled(file) {
  const relative = path.relative(QA_INSTALLED, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const first = relative.split(/[\\/]/)[0];
  return /^smoke-/.test(first);   // the repo's existing ignored qa/installed runtime namespace
}

if (!/^[0-9a-f]{40}$/.test(candidateCommit)) {
  console.error('[W1 BLOCKED] controller did not provide an exact candidate SHA');
  process.exit(2);
}
if (!Number.isInteger(cdpPort) || cdpPort < 1 || cdpPort > 65535) {
  console.error('[W1 BLOCKED] installed CDP port must be an integer from 1 through 65535');
  process.exit(2);
}
const candidateTree = treeOf(candidateCommit);
if (!candidateTree) {
  console.error('[W1 BLOCKED] candidate source tree is unavailable');
  process.exit(2);
}
const artifact = hashFile(artifactPath);
if (!artifact) {
  console.error('[W1 BLOCKED] STARNET_FIRST_RUN_ARTIFACT must name the exact installed executable bytes');
  process.exit(2);
}
for (const authorityPath of [
  'scripts/qa/installed-first-run.mjs',
  'scripts/qa/product-perfect/gates/wave-1-installed-first-run.mjs',
  'test/qa-installed-first-run.test.js',
  'test/qa-beginner.test.js'
]) {
  if (!candidateOwnedFile(authorityPath)) {
    console.error('[W1 BLOCKED] installed first-run authority differs from exact candidate: ' + authorityPath);
    process.exit(2);
  }
}

for (const [label, args] of [
  ['installed first-run authority tests', ['test/qa-installed-first-run.test.js']],
  ['Beginner title/recovery tests', ['test/qa-beginner.test.js']]
]) {
  const status = runNode(label, args, 120000);
  if (status) process.exit(status);
}

const linkProbeInput = String(process.env.STARNET_W1_LINK_PROBE || '').trim().replace(/\\/g, '/');
const linkProbePath = linkProbeInput ? path.resolve(ROOT, linkProbeInput) : '';
const linkProbeRelative = linkProbePath ? path.relative(ROOT, linkProbePath).replace(/\\/g, '/') : '';
if (!linkProbePath || !/^scripts\/qa\/[A-Za-z0-9._\/-]+\.mjs$/.test(linkProbeRelative) || linkProbeRelative.startsWith('../')) {
  console.error('[W1 BLOCKED] STARNET_W1_LINK_PROBE must name the candidate-owned installed link probe under scripts/qa/');
  process.exit(2);
}
const probeOwned = candidateOwnedFile(linkProbeRelative);
if (!probeOwned) {
  console.error('[W1 BLOCKED] installed link probe bytes are absent from or differ from the exact candidate tree');
  process.exit(2);
}
const probe = { path: linkProbeRelative, sha256: probeOwned.sha256 };

const journey = runNode('installed fresh-user first-value journey', ['scripts/qa/installed-first-run.mjs'], 700000, {
  STARNET_FIRST_RUN_EXPECTED_ARTIFACT_SHA256: artifact.sha256,
  STARNET_FIRST_RUN_EXPECTED_ARTIFACT_SIZE: String(artifact.size),
  STARNET_FIRST_RUN_CDP_PORT: String(cdpPort),
  STARNET_SMOKE_CDP_PORT: String(cdpPort)
});
if (journey) process.exit(journey);

const challenge = 'w1-' + crypto.randomBytes(32).toString('hex');
const linkRunDir = path.join(QA_INSTALLED, 'smoke-' + new Date().toISOString().replace(/[:.]/g, '-') + '-link');
const linkReceiptPath = path.join(linkRunDir, 'receipt.json');
fs.mkdirSync(linkRunDir, { recursive: true });
const linkStartedAt = Date.now();
const probeEnv = {};
for (const name of [
  'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH',
  'PATH', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'COMSPEC',
  'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'
]) if (Object.prototype.hasOwnProperty.call(process.env, name)) probeEnv[name] = process.env[name];
const probeRun = spawnSync(process.execPath, [linkProbePath], {
  cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
  env: Object.assign(probeEnv, {
    STARNET_W1_LINK_CHALLENGE: challenge,
    STARNET_W1_LINK_OUTPUT: linkReceiptPath,
    STARNET_W1_LINK_PROBE_SHA256: probe.sha256,
    STARNET_PRODUCT_PERFECT_CANDIDATE_SHA: candidateCommit,
    STARNET_PRODUCT_PERFECT_CANDIDATE_TREE: candidateTree,
    STARNET_FIRST_RUN_ARTIFACT: artifact.path,
    STARNET_FIRST_RUN_CDP_PORT: String(cdpPort),
    STARNET_SMOKE_CDP_PORT: String(cdpPort)
  })
});
const linkEndedAt = Date.now();
if (probeRun.error || probeRun.status !== 0) {
  const blocked = probeRun.error || Number(probeRun.status) === 2;
  console.error('[W1 ' + (blocked ? 'BLOCKED' : 'FAIL') + '] candidate-owned installed link probe did not complete');
  process.exit(blocked ? 2 : 1);
}
let linkReceipt = null;
try { linkReceipt = JSON.parse(fs.readFileSync(linkReceiptPath, 'utf8')); }
catch (_) {
  console.error('[W1 BLOCKED] challenged installed link companion receipt is missing or unreadable');
  process.exit(2);
}
const rawEvidence = [];
const descriptors = Array.isArray(linkReceipt.evidence) ? linkReceipt.evidence : [];
for (const evidence of descriptors) {
  const file = path.resolve(ROOT, evidence.path);
  if (!insideInstalled(file)) {
    console.error('[W1 BLOCKED] link evidence escaped qa/installed/: ' + evidence.path);
    process.exit(2);
  }
  const actual = hashFile(file);
  if (!actual || actual.sha256 !== evidence.sha256 || actual.size !== evidence.size) {
    console.error('[W1 BLOCKED] link evidence bytes do not match receipt: ' + evidence.path);
    process.exit(2);
  }
  let bytes = null;
  try { bytes = fs.readFileSync(file); } catch (_) {}
  if (!bytes || containsSecretMaterial(bytes.toString('utf8'), [process.env.STARNET_FIRST_RUN_PROVIDER_SECRET])) {
    console.error('[W1 BLOCKED] link evidence contains secret-shaped material or is unreadable: ' + evidence.path);
    process.exit(2);
  }
  try { rawEvidence.push(JSON.parse(bytes.toString('utf8'))); }
  catch (_) {
    console.error('[W1 BLOCKED] link evidence is not machine-readable JSON: ' + evidence.path);
    process.exit(2);
  }
}
const linkVerdict = validateLinkReceipt(linkReceipt, {
  candidateCommit, candidateTree, artifact, challenge, probe,
  cdpPort,
  wallElapsedMs: linkEndedAt - linkStartedAt, gateStartedAt: linkStartedAt, gateEndedAt: linkEndedAt
}, rawEvidence);
if (!linkVerdict.ok) {
  console.error('[W1 BLOCKED] installed link companion receipt failed: ' + linkVerdict.errors.join(', '));
  process.exit(2);
}
console.log('[W1 PASS] installed link truth (>40s quiet UP; actual loss DOWN)');

const artifactAfterProofSequence = hashFile(artifact.path);
if (!artifactAfterProofSequence || artifactAfterProofSequence.sha256 !== artifact.sha256 || artifactAfterProofSequence.size !== artifact.size) {
  console.error('[W1 BLOCKED] installed artifact bytes changed during journey and link proof');
  process.exit(2);
}

console.log('[W1 PASS] exact installed candidate ' + candidateCommit + ' completed first value and transport truth');
process.exit(0);
