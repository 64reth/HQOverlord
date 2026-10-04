#!/usr/bin/env node
// t3-release-smoke.mjs - installed-app release smoke proof gate.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasLiveProviderKey } from './lib/provider-env.mjs';
import { findCurrentNsisInstaller } from './lib/release-installer.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_T3_LOOPS || 3) || 3) : 1;
const REQUIRE_LIVE = argSet.has('--require-live') || truthy(process.env.STARNET_T3_REQUIRE_LIVE) || hasLiveProviderKey();
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace(/Z$/, '') + '-' + process.pid;
const OUT = resolve(process.env.STARNET_T3_RELEASE_SMOKE_DIR || join(ROOT, '.dogfood', 't3-release-smoke-' + STAMP));
const LATEST = resolve(process.env.STARNET_T3_RELEASE_SMOKE_LATEST_DIR || join(ROOT, '.dogfood', 't3-release-smoke-latest'));
const MAX_WORKLOAD_MS = Math.max(1000, Number(process.env.STARNET_T3_WORKLOAD_TIMEOUT_MS || 600000) || 600000);
const INSTALLED_SOURCES = new Set(['nsis-installed', 'windows-sandbox-installed', 'clean-vm-installed', 'physical-windows-installed']);
const TERMINAL_TOOLS = ['shell_exec', 'verify_run'];
const REQUIRED_TOOLS = ['fs_write', 'notebook_write'];

function truthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1 || String(v || '').toLowerCase() === 'yes';
}
function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function stripJsonBom(text) { return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function readJson(file, fallback = null) {
  try { return JSON.parse(stripJsonBom(readFileSync(file, 'utf8'))); } catch (_) { return fallback; }
}
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function sha256(file) {
  const h = createHash('sha256');
  h.update(readFileSync(file));
  return h.digest('hex');
}
function fileInfo(file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return null;
  const st = statSync(file);
  return { path: resolve(file), bytes: st.size, sha256: sha256(file), mtime: st.mtime.toISOString() };
}
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'fail') return 'FAIL';
  if (status === 'blocked') return 'BLOCKED';
  if (status === 'accepted-deferral') return 'ACCEPTED';
  return 'SKIP';
}
function copyLatest() {
  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    const src = join(OUT, name);
    if (statSync(src).isFile()) copyFileSync(src, join(LATEST, name));
  }
}
function argValue(name) {
  const eq = rawArgs.find(a => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const idx = rawArgs.indexOf(name);
  return idx >= 0 ? rawArgs[idx + 1] : '';
}
function tauriVersion() {
  const conf = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'), {});
  return conf && conf.version || '';
}
function installerPath() {
  const raw = process.env.STARNET_T3_INSTALLER_EXE || process.env.STARNET_T0_INSTALLER_EXE || '';
  if (raw) return resolve(raw);
  return findCurrentNsisInstaller(ROOT);
}
function t0StatusPath() {
  return resolve(process.env.STARNET_T3_T0_STATUS || join(ROOT, '.dogfood', 't0-clean-install-latest', 't0-clean-install-status.json'));
}
function t2StatusPath() {
  return resolve(process.env.STARNET_T3_T2_STATUS || join(ROOT, '.dogfood', 't2-state-safety-latest', 't2-state-safety-status.json'));
}
function workloadEvidencePath() {
  const raw = process.env.STARNET_T3_WORKLOAD_EVIDENCE || argValue('--workload-evidence') || '';
  return raw ? resolve(raw) : '';
}
function step(id, phase, title, status, reason, extra = {}) {
  return Object.assign({ id, phase, title, status, required: true, reason }, extra);
}
function hasItems(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => String(x == null ? '' : x).trim());
}
function hasLedgerRows(v) {
  return Array.isArray(v) && v.length > 0 && v.every(row => row && typeof row === 'object' && String(row.model || '').trim());
}
function hasTool(toolCalls, name) {
  return Array.isArray(toolCalls) && toolCalls.includes(name);
}
function hasAnyTool(toolCalls, names) {
  return names.some(name => hasTool(toolCalls, name));
}
function checkPlan(loop) {
  const file = join(ROOT, 'docs', 'STARNET_T3_RELEASE_SMOKE.md');
  const text = readText(file).toLowerCase();
  const required = ['installed-app', 'release smoke', 'starnet.t3-installed-workload-proof.v1', 'dev-server proof does not count', 'timeout'];
  const missing = required.filter(term => text.indexOf(term) < 0);
  return step('t3.0-loop-spec', 'T3.0', 'T3 release-smoke loop is documented', existsSync(file) && !missing.length ? 'pass' : 'fail', missing.length ? 'Missing terms: ' + missing.join(', ') : 'T3 release-smoke spec exists.', { loop, evidenceFile: file });
}
function checkInstaller(loop) {
  const info = fileInfo(installerPath());
  return step('t3.1-release-installer', 'T3.1', 'Current packaged installer is discoverable and hash-recorded', info ? 'pass' : 'blocked', info ? 'NSIS installer found; hash recorded.' : 'Build the desktop installer first with npm.cmd run phase5:surface or npm.cmd run desktop:build.', { loop, artifacts: { installer: info, version: tauriVersion() } });
}
function t0InstallerHash(t0) {
  const results = t0 && (t0.results || []);
  for (const r of results) {
    const got = r && r.artifacts && r.artifacts.installer;
    if (got && got.sha256) return { sha256: String(got.sha256).toLowerCase(), bytes: Number(got.bytes || 0) };
  }
  return null;
}
function checkT0(loop, installerInfo) {
  const file = t0StatusPath();
  const status = readJson(file);
  if (!status) return step('t3.2-clean-install-proof', 'T3.2', 'T0 clean-machine proof is green for the current installer', 'blocked', 'T0 latest status is missing or unreadable.', { loop, evidenceFile: file });
  if (status.cleanInstallProofReady !== true || status.verdict !== 'green') return step('t3.2-clean-install-proof', 'T3.2', 'T0 clean-machine proof is green for the current installer', 'blocked', 'T0 is not green yet.', { loop, evidenceFile: file, t0: { verdict: status.verdict, cleanInstallProofReady: !!status.cleanInstallProofReady } });
  const t0Hash = t0InstallerHash(status);
  const hashOk = !installerInfo || !t0Hash || (t0Hash.sha256 === String(installerInfo.sha256).toLowerCase() && (!t0Hash.bytes || t0Hash.bytes === installerInfo.bytes));
  return step('t3.2-clean-install-proof', 'T3.2', 'T0 clean-machine proof is green for the current installer', hashOk ? 'pass' : 'fail', hashOk ? 'T0 clean-machine proof matches the current installer.' : 'T0 proof installer hash/bytes do not match the current installer.', { loop, evidenceFile: file, t0: { verdict: status.verdict, cleanInstallProofReady: !!status.cleanInstallProofReady, installer: t0Hash } });
}
function checkT2(loop) {
  const file = t2StatusPath();
  const status = readJson(file);
  if (!status) return step('t3.3-state-safety-proof', 'T3.3', 'T2 state-safety proof is green', 'blocked', 'T2 latest status is missing or unreadable.', { loop, evidenceFile: file });
  const ok = status.stateSafetyReady === true && status.verdict === 'green';
  return step('t3.3-state-safety-proof', 'T3.3', 'T2 state-safety proof is green', ok ? 'pass' : 'blocked', ok ? 'T2 state-safety proof is green.' : 'T2 state-safety proof is not green yet.', { loop, evidenceFile: file, t2: { verdict: status.verdict, stateSafetyReady: !!status.stateSafetyReady } });
}
function validateWorkloadProof(doc, installerInfo) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return { ready: false, errors: ['Installed workload evidence is not valid JSON.'], proof: null };
  if (doc.schema !== 'starnet.t3-installed-workload-proof.v1') errors.push('schema must be starnet.t3-installed-workload-proof.v1');
  const gotHash = String(doc.installer && doc.installer.sha256 || '').toLowerCase();
  const gotBytes = Number(doc.installer && doc.installer.bytes || 0);
  if (!gotHash) errors.push('installer.sha256 is missing');
  if (installerInfo && gotHash && gotHash !== String(installerInfo.sha256).toLowerCase()) errors.push('installer.sha256 does not match current installer');
  if (installerInfo && gotBytes && gotBytes !== installerInfo.bytes) errors.push('installer.bytes does not match current installer');

  const app = doc.installedApp || {};
  if (!INSTALLED_SOURCES.has(String(app.source || ''))) errors.push('installedApp.source must be an installed package source');
  if (app.launched !== true) errors.push('installedApp.launched must be true');
  if (app.usableHarness !== true) errors.push('installedApp.usableHarness must be true');

  const w = doc.workload || {};
  if (w.completed !== true) errors.push('workload.completed must be true');
  const durationMs = Number(w.durationMs || 0);
  const timeoutMs = Number(w.timeoutMs || MAX_WORKLOAD_MS);
  if (!durationMs || durationMs <= 0) errors.push('workload.durationMs must be positive');
  if (!timeoutMs || timeoutMs <= 0) errors.push('workload.timeoutMs must be positive');
  if (durationMs && timeoutMs && durationMs > timeoutMs) errors.push('workload.durationMs exceeds workload.timeoutMs');
  if (durationMs > MAX_WORKLOAD_MS) errors.push('workload.durationMs exceeds T3 max timeout');
  if (!hasItems(w.runIds)) errors.push('workload.runIds[] is required');
  if (!hasItems(w.transcriptIds)) errors.push('workload.transcriptIds[] is required');
  if (!hasLedgerRows(w.ledgerRows)) errors.push('workload.ledgerRows[] with model is required');
  if (!hasItems(w.modelNames)) errors.push('workload.modelNames[] is required');
  if (!hasItems(w.artifactPaths)) errors.push('workload.artifactPaths[] is required');
  if (!Array.isArray(w.toolCalls)) errors.push('workload.toolCalls[] is required');
  for (const name of REQUIRED_TOOLS) if (!hasTool(w.toolCalls, name)) errors.push('workload.toolCalls[] missing ' + name);
  if (!hasAnyTool(w.toolCalls, TERMINAL_TOOLS)) errors.push('workload.toolCalls[] missing shell_exec or verify_run');
  if (REQUIRE_LIVE) {
    const paid = w.paidSmoke || {};
    const ledgerRows = Array.isArray(w.ledgerRows) ? w.ledgerRows : [];
    if (w.liveProvider !== true) errors.push('workload.liveProvider must be true when a live provider key is present');
    if (paid.succeeded !== true) errors.push('workload.paidSmoke.succeeded must be true when live proof is required');
    if (Number(paid.spendUsd || 0) <= 0 && !ledgerRows.some(row => Number(row.spendUsd || row.usd || 0) > 0)) errors.push('paid live smoke spend must be positive');
  }
  return {
    ready: errors.length === 0,
    errors,
    proof: {
      schema: doc.schema || '',
      generatedAt: doc.generatedAt || '',
      sourceMachine: doc.sourceMachine || {},
      installer: doc.installer || {},
      installedApp: {
        source: app.source || '',
        launched: app.launched === true,
        usableHarness: app.usableHarness === true,
        observedWindowTitle: app.observedWindowTitle || ''
      },
      workload: {
        completed: w.completed === true,
        durationMs,
        timeoutMs,
        runIds: Array.isArray(w.runIds) ? w.runIds : [],
        transcriptIds: Array.isArray(w.transcriptIds) ? w.transcriptIds : [],
        ledgerRows: Array.isArray(w.ledgerRows) ? w.ledgerRows : [],
        modelNames: Array.isArray(w.modelNames) ? w.modelNames : [],
        toolCalls: Array.isArray(w.toolCalls) ? w.toolCalls : [],
        artifactPaths: Array.isArray(w.artifactPaths) ? w.artifactPaths : [],
        liveProvider: w.liveProvider === true,
        paidSmoke: w.paidSmoke || null
      },
      notes: Array.isArray(doc.notes) ? doc.notes : []
    }
  };
}
function checkWorkloadProof(loop, installerInfo) {
  const file = workloadEvidencePath();
  if (!file) return step('t3.4-installed-workload-proof', 'T3.4', 'Installed app completed the release-smoke workload', 'blocked', 'No installed workload evidence JSON was provided. Set STARNET_T3_WORKLOAD_EVIDENCE or pass --workload-evidence.', { loop, evidenceFile: '' });
  if (!existsSync(file)) return step('t3.4-installed-workload-proof', 'T3.4', 'Installed app completed the release-smoke workload', 'blocked', 'Installed workload evidence file does not exist: ' + file, { loop, evidenceFile: file });
  const doc = readJson(file);
  const validation = validateWorkloadProof(doc, installerInfo);
  writeJson(join(OUT, 'imported-workload-evidence.json'), validation.proof || { path: file, errors: validation.errors });
  return step('t3.4-installed-workload-proof', 'T3.4', 'Installed app completed the release-smoke workload', validation.ready ? 'pass' : 'fail', validation.ready ? 'Installed workload proof matches the current package and completed before timeout.' : validation.errors.join('; '), { loop, evidenceFile: file, workloadProof: validation.proof, errors: validation.errors });
}
function checkLive(loop, workloadStep) {
  const proof = workloadStep && workloadStep.workloadProof;
  const w = proof && proof.workload || {};
  if (!REQUIRE_LIVE) return step('t3.5-paid-live-installed-smoke', 'T3.5', 'Paid/live installed smoke is present when required', 'skip', 'No live provider key is present and --require-live was not supplied.', { loop, liveRequired: false });
  const paid = w.paidSmoke || {};
  const ledgerSpend = Array.isArray(w.ledgerRows) ? w.ledgerRows.some(row => Number(row.spendUsd || row.usd || 0) > 0) : false;
  const ok = !!(proof && w.liveProvider === true && paid.succeeded === true && (Number(paid.spendUsd || 0) > 0 || ledgerSpend));
  return step('t3.5-paid-live-installed-smoke', 'T3.5', 'Paid/live installed smoke is present when required', ok ? 'pass' : 'blocked', ok ? 'Installed workload includes paid/live model evidence.' : 'Live provider key is present, so installed workload proof must include paid/live model evidence.', { loop, liveRequired: true });
}
function runOnce(loop) {
  const results = [];
  results.push(checkPlan(loop));
  const installer = checkInstaller(loop);
  results.push(installer);
  const installerInfo = installer.artifacts && installer.artifacts.installer;
  results.push(checkT0(loop, installerInfo));
  results.push(checkT2(loop));
  const workload = checkWorkloadProof(loop, installerInfo);
  results.push(workload);
  results.push(checkLive(loop, workload));
  return results;
}
function signature(results) {
  return results.map(r => r.id + ':' + r.status + ':' + (r.reason || '')).join('|');
}
function chooseNextAction(latest) {
  const nonPass = latest.filter(r => r.status === 'fail' || r.status === 'blocked');
  if (!nonPass.length) return null;
  const failed = nonPass.find(r => r.status === 'fail');
  if (failed) return failed;
  const priority = [
    't3.1-release-installer',
    't3.2-clean-install-proof',
    't3.3-state-safety-proof',
    't3.4-installed-workload-proof',
    't3.5-paid-live-installed-smoke',
    't3.0-loop-spec'
  ];
  for (const id of priority) {
    const match = nonPass.find(r => r.id === id);
    if (match) return match;
  }
  return nonPass[0];
}
function writeArtifactHashes(files) {
  const hashes = {};
  for (const file of files) {
    const p = join(OUT, file);
    if (existsSync(p)) hashes[file] = { sha256: sha256(p), bytes: statSync(p).size };
  }
  writeJson(join(OUT, 'artifact-hashes.json'), hashes);
}
function writeSummary(allResults, loopsRun, stableIterations) {
  ensureDir(OUT);
  const latest = allResults.filter(r => r.loop === loopsRun);
  const pass = latest.filter(r => r.status === 'pass').length;
  const fail = latest.filter(r => r.status === 'fail').length;
  const blocked = latest.filter(r => r.status === 'blocked').length;
  const skipped = latest.filter(r => r.status === 'skip').length;
  const nextAction = chooseNextAction(latest);
  const releaseSmokeReady = fail === 0 && blocked === 0 && latest.length > 0 && latest.every(r => r.status === 'pass' || r.status === 'skip');
  const verdict = fail ? 'red' : (blocked ? 'blocked' : 'green');
  const status = {
    schema: 'starnet.t3-release-smoke-status.v1',
    generatedAt: nowIso(),
    lane: 'T3-release-smoke',
    verdict,
    releaseSmokeReady,
    liveRequired: REQUIRE_LIVE,
    loopsRun,
    stableIterations,
    outDir: OUT,
    counts: { pass, blocked, fail, skipped },
    nextAction: nextAction ? { id: nextAction.id, status: nextAction.status, reason: nextAction.reason } : null,
    results: latest,
    history: allResults.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeJson(join(OUT, 't3-release-smoke-status.json'), status);

  let md = '# StarNet T3 Release Smoke Evidence\n\n';
  md += '- Generated: `' + status.generatedAt + '`\n';
  md += '- Verdict: `' + status.verdict + '`\n';
  md += '- Release smoke ready: `' + status.releaseSmokeReady + '`\n';
  md += '- Live proof required this run: `' + status.liveRequired + '`\n';
  md += '- Loops run: `' + status.loopsRun + '`\n\n';
  md += '| Status | Phase | Step | Notes |\n|---|---|---|---|\n';
  for (const r of latest) md += '| ' + statusIcon(r.status) + ' | `' + mdEscape(r.phase) + '` | `' + r.id + '` ' + mdEscape(r.title) + ' | ' + mdEscape(r.reason) + ' |\n';
  md += '\n## Next Action\n\n';
  if (nextAction) md += 'Work `' + nextAction.id + '`: ' + nextAction.reason + '\n';
  else md += 'T3 release smoke is ready.\n';
  writeFileSync(join(OUT, 'summary.md'), md);
  writeArtifactHashes(['t3-release-smoke-status.json', 'summary.md', 'imported-workload-evidence.json']);
  copyLatest();
  return status;
}

let allResults = [];
let loopsRun = 0;
let prevSig = '';
let stableIterations = 0;
for (let i = 1; i <= LOOP_MAX; i += 1) {
  console.log('[t3-release-smoke] loop ' + i + ' starting');
  const results = runOnce(i);
  loopsRun = i;
  allResults = allResults.concat(results);
  for (const r of results) console.log('[t3-release-smoke]   ' + statusIcon(r.status) + ' ' + r.id);
  const sig = signature(results);
  stableIterations = sig === prevSig ? stableIterations + 1 : 1;
  if (!results.some(r => r.status === 'fail' || r.status === 'blocked')) break;
  if (prevSig && prevSig === sig) break;
  prevSig = sig;
}

const summary = writeSummary(allResults, loopsRun, stableIterations);
console.log('[t3-release-smoke] evidence: ' + OUT);
console.log('[t3-release-smoke] latest: ' + LATEST);
console.log('[t3-release-smoke] releaseSmokeReady=' + summary.releaseSmokeReady);
if (summary.verdict === 'red') process.exit(1);
if (!summary.releaseSmokeReady) process.exit(2);
process.exit(0);
