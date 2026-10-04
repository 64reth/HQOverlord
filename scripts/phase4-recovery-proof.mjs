#!/usr/bin/env node
// phase4-recovery-proof.mjs - targeted automated failure/recovery proof for P4.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedCommand } from './lib/run-command.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.STARNET_PHASE4_RECOVERY_DIR || join(ROOT, '.dogfood', 'phase4-recovery-proof'));
const attendedFile = join(ROOT, '.dogfood', 'phase4-attended-evidence.json');
const nodeCmd = process.execPath;

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

const tests = [
  ['cancel-proof', 'test/halt.test.js'],
  ['budget-proof', 'test/budget.test.js'],
  ['checkpoint-proof', 'test/checkpoint.test.js'],
  ['consent-proof', 'test/consent.interactive.test.js'],
  ['shell-proof', 'test/shell.test.js'],
  ['verify-proof', 'test/verify.run.test.js'],
  ['patch-restore-proof', 'test/fs.patch.test.js']
];

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function evidenceTemplate() {
  return {
    generatedAt: new Date().toISOString(),
    operator: process.env.USERNAME || process.env.USER || 'andro',
    sameWorkTrial: { passed: false, screenshots: [], runIds: [], transcriptIds: [], artifactPaths: [], ledgerRows: [], notes: '' },
    soak: { freshPass: false, restartPass: false, transcriptPreserved: false, ledgerPreserved: false, artifactsPreserved: false, memoryPreserved: false, stationStatePreserved: false, notes: '' },
    failureRecovery: { cancelPassed: false, budgetPassed: false, deniedConsentPassed: false, toolErrorPassed: false, checkpointRestorePassed: false, notes: '' }
  };
}
function writeRecoveryEvidence(status) {
  if (status.verdict !== 'green') return;
  const byId = Object.fromEntries((status.results || []).map(r => [r.id, r]));
  const passed = id => !!(byId[id] && byId[id].status === 'pass');
  const ev = existsSync(attendedFile) ? readJson(attendedFile, evidenceTemplate()) : evidenceTemplate();
  ev.generatedAt = new Date().toISOString();
  ev.failureRecovery = {
    cancelPassed: passed('cancel-proof'),
    budgetPassed: passed('budget-proof'),
    deniedConsentPassed: passed('consent-proof'),
    toolErrorPassed: passed('shell-proof') && passed('verify-proof') && passed('patch-restore-proof'),
    checkpointRestorePassed: passed('checkpoint-proof') && passed('patch-restore-proof'),
    proofStatusFile: join(OUT, 'phase4-recovery-status.json'),
    proofLogs: (status.results || []).map(r => r.logFile),
    notes: 'Recorded from scripts/phase4-recovery-proof.mjs automated safety suite: cancel, budget, denied consent, shell/verify/fs tool errors, and checkpoint/patch restore all passed.'
  };
  writeJson(attendedFile, ev);
}

ensureDir(OUT);
const results = [];
for (const [id, testFile] of tests) {
  console.log('[phase4-recovery] ' + id + ' - ' + testFile);
  const result = await runBoundedCommand({
    cmd: nodeCmd,
    args: [testFile],
    cwd: ROOT,
    env: process.env,
    timeoutMs: 120000,
    label: 'phase4-recovery/' + id
  });
  const logFile = join(OUT, id + '.log');
  writeFileSync(logFile, result.output);
  const status = result.exitCode === 0 ? 'pass' : 'fail';
  results.push({ id, testFile, status, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, logFile });
  console.log('[phase4-recovery]   ' + status.toUpperCase() + ' exit=' + result.exitCode);
  if (status === 'fail') break;
}

const fail = results.filter(r => r.status === 'fail').length;
const json = {
  generatedAt: new Date().toISOString(),
  verdict: fail ? 'red' : 'green',
  counts: { pass: results.filter(r => r.status === 'pass').length, fail },
  results
};
writeFileSync(join(OUT, 'phase4-recovery-status.json'), JSON.stringify(json, null, 2));
writeRecoveryEvidence(json);
process.exit(fail ? 1 : 0);
