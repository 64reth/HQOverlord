#!/usr/bin/env node
// replacement-sweep.mjs - invited-beta replacement baseline sweep with proof imports.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const DRY_RUN = argSet.has('--dry-run') || truthy(process.env.STARNET_REPLACEMENT_SWEEP_DRY_RUN);
const SKIP_FAST = argSet.has('--skip-fast') || truthy(process.env.STARNET_REPLACEMENT_SWEEP_SKIP_FAST);
const REQUIRE_LIVE = !argSet.has('--no-require-live') && !truthy(process.env.STARNET_REPLACEMENT_SWEEP_NO_REQUIRE_LIVE);
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace(/Z$/, '') + '-' + process.pid;
const OUT = resolve(process.env.STARNET_REPLACEMENT_SWEEP_DIR || join(ROOT, '.dogfood', 'replacement-sweep-' + STAMP));
const LATEST = resolve(process.env.STARNET_REPLACEMENT_SWEEP_LATEST_DIR || join(ROOT, '.dogfood', 'replacement-sweep-latest'));
const DOGFOOD = resolve(process.env.STARNET_REPLACEMENT_SWEEP_DOGFOOD_DIR || join(ROOT, '.dogfood'));
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const PROOFS = {
  t0: {
    env: 'STARNET_T0_CLEAN_EVIDENCE',
    schema: 'starnet.clean-install-proof.v1',
    description: 'T0 clean-machine install proof',
    evidenceFileName: 'clean-install-proof.json'
  },
  t3: {
    env: 'STARNET_T3_WORKLOAD_EVIDENCE',
    schema: 'starnet.t3-installed-workload-proof.v1',
    description: 'T3 installed workload proof',
    evidenceFileName: 'installed-workload-proof.json'
  },
  t4: {
    env: 'STARNET_T4_UPDATE_PROOF',
    schema: 'starnet.t4-update-delivery-proof.v1',
    description: 'T4 update delivery proof',
    evidenceFileName: 'update-delivery-proof.json'
  }
};

function truthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1 || String(v || '').toLowerCase() === 'yes';
}
function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function stripJsonBom(text) { return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }
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
function findInstaller(nsisDir) {
  try {
    const names = readdirSync(nsisDir).filter(n => /-setup\.exe$/i.test(n)).sort();
    return names.length ? join(nsisDir, names[names.length - 1]) : '';
  } catch (_) {
    return '';
  }
}
function installerPath() {
  const raw = process.env.STARNET_REPLACEMENT_SWEEP_INSTALLER_EXE
    || process.env.STARNET_T4_INSTALLER_EXE
    || process.env.STARNET_T3_INSTALLER_EXE
    || process.env.STARNET_T0_INSTALLER_EXE
    || '';
  if (raw) return resolve(raw);
  return findInstaller(join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis'));
}
function argValue(name) {
  const eq = rawArgs.find(a => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const idx = rawArgs.indexOf(name);
  return idx >= 0 ? rawArgs[idx + 1] : '';
}
function proofOverride(id) {
  const spec = PROOFS[id];
  const upper = id.toUpperCase();
  const raw = process.env[spec.env]
    || process.env['STARNET_REPLACEMENT_SWEEP_' + upper + '_EVIDENCE']
    || argValue('--' + id + '-evidence')
    || '';
  return raw ? resolve(raw) : '';
}
function walkJsonFiles(root, maxFiles = 2500) {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile() && /\.json$/i.test(ent.name)) out.push(p);
      if (out.length >= maxFiles) break;
    }
  }
  return out;
}
function proofInstaller(doc) {
  const installer = doc && doc.installer || {};
  return {
    sha256: String(installer.sha256 || '').trim().toLowerCase(),
    bytes: Number(installer.bytes || 0)
  };
}
function proofGeneratedAt(doc, file) {
  const parsed = Date.parse(doc && doc.generatedAt || '');
  if (Number.isFinite(parsed)) return parsed;
  try { return statSync(file).mtimeMs; } catch (_) { return 0; }
}
function validateProofFile(file, spec, installer) {
  if (!file) return { ok: false, reason: 'No proof file was provided.', doc: null };
  if (!existsSync(file)) return { ok: false, reason: 'Proof file does not exist: ' + file, doc: null };
  const doc = readJson(file);
  if (!doc || typeof doc !== 'object') return { ok: false, reason: 'Proof file is not valid JSON: ' + file, doc: null };
  if (doc.schema !== spec.schema) return { ok: false, reason: 'Proof schema is ' + (doc.schema || 'missing') + ', expected ' + spec.schema + '.', doc };
  const got = proofInstaller(doc);
  if (installer && installer.sha256 && got.sha256 && got.sha256 !== String(installer.sha256).toLowerCase()) {
    return { ok: false, reason: 'Proof installer hash does not match the current NSIS installer.', doc };
  }
  if (installer && installer.bytes && got.bytes && got.bytes !== installer.bytes) {
    return { ok: false, reason: 'Proof installer byte size does not match the current NSIS installer.', doc };
  }
  return { ok: true, reason: 'Proof matches schema and current installer metadata.', doc };
}
function discoverProof(id, installer, jsonFiles) {
  const spec = PROOFS[id];
  const override = proofOverride(id);
  if (override) {
    const validation = validateProofFile(override, spec, installer);
    return { id, path: override, source: 'override', validation };
  }

  const candidates = [];
  for (const file of jsonFiles) {
    const doc = readJson(file);
    if (!doc || doc.schema !== spec.schema) continue;
    const validation = validateProofFile(file, spec, installer);
    if (validation.ok) candidates.push({ file, doc, generatedAtMs: proofGeneratedAt(doc, file) });
  }
  candidates.sort((a, b) => b.generatedAtMs - a.generatedAtMs || b.file.localeCompare(a.file));
  const picked = candidates[0];
  if (!picked) {
    return {
      id,
      path: '',
      source: 'auto',
      validation: {
        ok: false,
        reason: 'Could not find a matching ' + spec.description + ' under ' + DOGFOOD + '.'
      }
    };
  }
  return { id, path: picked.file, source: 'auto', validation: validateProofFile(picked.file, spec, installer) };
}
function step(id, title, status, reason, extra = {}) {
  return Object.assign({ id, title, status, reason }, extra);
}
function runNpm(script, envExtra = {}) {
  const env = Object.assign({}, process.env, envExtra);
  const res = spawnSync(NPM, ['run', script], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true
  });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return {
    script,
    exitCode: res.status == null ? 1 : res.status,
    signal: res.signal || null,
    error: res.error ? String(res.error.message || res.error) : ''
  };
}
function readLatestStatus(name) {
  const file = join(ROOT, '.dogfood', name + '-latest', name + '-status.json');
  return { file, status: readJson(file) };
}
function readyField(status, names) {
  for (const name of names) {
    if (status && status[name] !== undefined) return { name, value: status[name] };
  }
  return { name: '', value: undefined };
}
function commandStep(id, title, script, readyNames, envExtra = {}) {
  console.log('[replacement-sweep] running ' + script);
  const run = runNpm(script, envExtra);
  const statusName = {
    't0:clean-install:loop': 't0-clean-install',
    't1:signing:loop': 't1-signing',
    't2:state-safety:loop': 't2-state-safety',
    't3:release-smoke:loop': 't3-release-smoke',
    't4:update-delivery:loop': 't4-update-delivery'
  }[script];
  const latest = statusName ? readLatestStatus(statusName) : { file: '', status: null };
  const ready = readyField(latest.status, readyNames || []);
  let status = run.exitCode === 0 ? 'pass' : (run.exitCode === 2 ? 'blocked' : 'fail');
  let reason = status === 'pass' ? script + ' passed.' : script + ' exited ' + run.exitCode + '.';
  if (status === 'pass' && readyNames && readyNames.length && ready.value !== true) {
    status = 'fail';
    reason = 'Latest status did not report ' + readyNames.join(' or ') + '=true.';
  }
  return step(id, title, status, reason, { run, latestStatusFile: latest.file, ready });
}
function lintStep() {
  console.log('[replacement-sweep] running evidence secret lint');
  const run = runNpm('lint:evidence-secrets');
  return step('evidence-secret-lint', 'Evidence packs contain no obvious secrets', run.exitCode === 0 ? 'pass' : 'fail', run.exitCode === 0 ? 'Secret lint passed.' : 'Secret lint exited ' + run.exitCode + '.', { run });
}
function processScanStep() {
  if (process.platform !== 'win32') return step('process-scan', 'No stale desktop smoke processes are visible', 'skip', 'Process scan only runs on Windows.');
  const res = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return step('process-scan', 'No stale desktop smoke processes are visible', 'skip', 'tasklist was unavailable.');
  const suspicious = [];
  const names = ['qemu-system-x86_64.exe', 'skynet-desktop.exe', 'starnet.exe', 'tauri.exe'];
  for (const line of String(res.stdout || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","([^"]+)"/);
    if (!m) continue;
    const proc = m[1].toLowerCase();
    if (names.includes(proc) || proc.includes('starnet')) suspicious.push({ processName: m[1], pid: m[2] });
  }
  return step(
    'process-scan',
    'No stale desktop smoke processes are visible',
    suspicious.length ? 'warn' : 'pass',
    suspicious.length ? 'Desktop smoke processes are still visible; close them before packaging public evidence.' : 'No StarNet/QEMU/Tauri smoke process was visible.',
    { suspicious }
  );
}
function copyLatest() {
  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    const src = join(OUT, name);
    if (statSync(src).isFile()) copyFileSync(src, join(LATEST, name));
  }
}
function writeSummary(results, proofs, installer) {
  ensureDir(OUT);
  const fail = results.filter(r => r.status === 'fail').length;
  const blocked = results.filter(r => r.status === 'blocked').length;
  const pass = results.filter(r => r.status === 'pass').length;
  const warn = results.filter(r => r.status === 'warn').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const verdict = fail ? 'red' : (blocked ? 'blocked' : 'green');
  const replacementSweepReady = verdict === 'green';
  const nextAction = results.find(r => r.status === 'fail') || results.find(r => r.status === 'blocked') || null;
  const status = {
    schema: 'starnet.replacement-sweep-status.v1',
    generatedAt: nowIso(),
    lane: 'replacement-sweep',
    scope: 'invited-beta-manual-distribution',
    verdict,
    replacementSweepReady,
    dryRun: DRY_RUN,
    requireLive: REQUIRE_LIVE,
    outDir: OUT,
    installer,
    proofs,
    counts: { pass, blocked, fail, warn, skipped },
    nextAction: nextAction ? { id: nextAction.id, status: nextAction.status, reason: nextAction.reason } : null,
    results
  };
  writeJson(join(OUT, 'replacement-sweep-status.json'), status);

  let md = '# StarNet Replacement Sweep\n\n';
  md += '- Generated: `' + status.generatedAt + '`\n';
  md += '- Scope: `' + status.scope + '`\n';
  md += '- Verdict: `' + status.verdict + '`\n';
  md += '- Replacement sweep ready: `' + status.replacementSweepReady + '`\n';
  md += '- T3 live proof required: `' + status.requireLive + '`\n\n';
  md += '| Status | Step | Notes |\n|---|---|---|\n';
  for (const r of results) md += '| ' + String(r.status).toUpperCase() + ' | `' + r.id + '` ' + r.title + ' | ' + String(r.reason || '').replace(/\|/g, '\\|') + ' |\n';
  md += '\n## Proof Imports\n\n';
  for (const [id, proof] of Object.entries(proofs)) md += '- `' + id + '`: `' + (proof.path || 'missing') + '`\n';
  md += '\n## Next Action\n\n';
  if (status.nextAction) md += 'Work `' + status.nextAction.id + '`: ' + status.nextAction.reason + '\n';
  else md += 'Replacement baseline is green for invited/manual beta distribution. Run T5 separately for public distribution.\n';
  writeFileSync(join(OUT, 'summary.md'), md);
  copyLatest();
  return status;
}

ensureDir(OUT);

const installer = fileInfo(installerPath());
const results = [];
if (!installer) {
  results.push(step('installer', 'Current NSIS installer is discoverable', 'blocked', 'No current NSIS installer was found.'));
  const status = writeSummary(results, {}, installer);
  console.log('[replacement-sweep] evidence: ' + OUT);
  console.log('[replacement-sweep] latest: ' + LATEST);
  console.log('[replacement-sweep] replacementSweepReady=' + status.replacementSweepReady);
  process.exit(2);
}

const jsonFiles = existsSync(DOGFOOD) ? walkJsonFiles(DOGFOOD) : [];
const proofs = {};
for (const id of Object.keys(PROOFS)) {
  const found = discoverProof(id, installer, jsonFiles);
  proofs[id] = {
    path: found.path,
    source: found.source,
    schema: PROOFS[id].schema,
    ok: !!(found.validation && found.validation.ok),
    reason: found.validation && found.validation.reason || ''
  };
  results.push(step(
    id + '-proof-import',
    PROOFS[id].description + ' is available for this installer',
    proofs[id].ok ? 'pass' : 'blocked',
    proofs[id].reason,
    { evidenceFile: proofs[id].path, source: proofs[id].source }
  ));
}

if (results.some(r => r.status === 'blocked' || r.status === 'fail')) {
  const status = writeSummary(results, proofs, installer);
  console.log('[replacement-sweep] evidence: ' + OUT);
  console.log('[replacement-sweep] latest: ' + LATEST);
  console.log('[replacement-sweep] replacementSweepReady=' + status.replacementSweepReady);
  process.exit(status.verdict === 'red' ? 1 : 2);
}

if (DRY_RUN) {
  results.push(step('dry-run', 'Replacement sweep command execution was skipped', 'pass', 'Dry run verified proof discovery without running child gates.'));
  const status = writeSummary(results, proofs, installer);
  console.log('[replacement-sweep] evidence: ' + OUT);
  console.log('[replacement-sweep] latest: ' + LATEST);
  console.log('[replacement-sweep] replacementSweepReady=' + status.replacementSweepReady);
  process.exit(status.verdict === 'red' ? 1 : (status.replacementSweepReady ? 0 : 2));
}

if (!SKIP_FAST) results.push(commandStep('test-fast', 'Full fast gate is green', 'test:fast'));
else results.push(step('test-fast', 'Full fast gate is green', 'skip', 'Skipped by --skip-fast.'));

results.push(commandStep('t0-clean-install', 'T0 clean install proof is green', 't0:clean-install:loop', ['cleanInstallProofReady'], {
  STARNET_T0_CLEAN_EVIDENCE: proofs.t0.path,
  STARNET_T0_INSTALLER_EXE: installer.path
}));
results.push(commandStep('t1-signing', 'T1 invited beta signing posture is green', 't1:signing:loop', ['invitedBetaReady'], {
  STARNET_T1_INSTALLER_EXE: installer.path
}));
results.push(commandStep('t2-state-safety', 'T2 state safety is green', 't2:state-safety:loop', ['stateSafetyReady']));
results.push(commandStep('t3-release-smoke', 'T3 installed release smoke is green with live proof', 't3:release-smoke:loop', ['releaseSmokeReady'], {
  STARNET_T3_WORKLOAD_EVIDENCE: proofs.t3.path,
  STARNET_T3_INSTALLER_EXE: installer.path,
  STARNET_T3_REQUIRE_LIVE: REQUIRE_LIVE ? '1' : ''
}));
results.push(commandStep('t4-update-delivery', 'T4 update delivery is green', 't4:update-delivery:loop', ['updateDeliveryReady'], {
  STARNET_T4_UPDATE_PROOF: proofs.t4.path,
  STARNET_T4_INSTALLER_EXE: installer.path
}));
results.push(lintStep());
results.push(processScanStep());

const status = writeSummary(results, proofs, installer);
console.log('[replacement-sweep] evidence: ' + OUT);
console.log('[replacement-sweep] latest: ' + LATEST);
console.log('[replacement-sweep] replacementSweepReady=' + status.replacementSweepReady);
if (status.verdict === 'red') process.exit(1);
if (!status.replacementSweepReady) process.exit(2);
process.exit(0);
