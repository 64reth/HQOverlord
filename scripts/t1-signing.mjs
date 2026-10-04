#!/usr/bin/env node
// t1-signing.mjs - Authenticode/updater signing lead-time loop for beta distribution.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedCommand } from './lib/run-command.mjs';
import { findCurrentNsisInstaller } from './lib/release-installer.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_T1_LOOPS || 3) || 3) : 1;
const REQUIRE_PUBLIC = argSet.has('--public') || argSet.has('--require-public');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace(/Z$/, '') + '-' + process.pid;
const OUT = resolve(process.env.STARNET_T1_SIGNING_DIR || join(ROOT, '.dogfood', 't1-signing-' + STAMP));
const LATEST = resolve(process.env.STARNET_T1_SIGNING_LATEST_DIR || join(ROOT, '.dogfood', 't1-signing-latest'));

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
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
    try { copyFileSync(join(OUT, name), join(LATEST, name)); } catch (_) {}
  }
}
function sha256(file) {
  const h = createHash('sha256');
  h.update(readFileSync(file));
  return h.digest('hex');
}
function fileInfo(file) {
  if (!file || !existsSync(file)) return null;
  if (!statSync(file).isFile()) return null;
  const st = statSync(file);
  return { path: file, bytes: st.size, sha256: sha256(file), mtime: st.mtime.toISOString() };
}
function tauriVersion() {
  const conf = readJson(join(ROOT, 'src-tauri', 'tauri.conf.json'), {});
  return conf && conf.version || '';
}
function artifacts() {
  const release = join(ROOT, 'src-tauri', 'target', 'release');
  const app = process.env.STARNET_T1_APP_EXE || join(release, 'skynet-desktop.exe');
  const installer = process.env.STARNET_T1_INSTALLER_EXE || findCurrentNsisInstaller(ROOT);
  return {
    app: app ? resolve(app) : '',
    installer: installer ? resolve(installer) : '',
    version: tauriVersion()
  };
}
function encodedPowerShell(command) {
  return Buffer.from(command, 'utf16le').toString('base64');
}
async function authenticode(paths) {
  if (process.env.STARNET_T1_AUTHENTICODE_MOCK) return JSON.parse(process.env.STARNET_T1_AUTHENTICODE_MOCK);
  if (process.platform !== 'win32') {
    return paths.map(p => ({ path: p, status: 'UnsupportedPlatform', statusMessage: 'Authenticode check runs on Windows.', signerSubject: '', signerThumbprint: '' }));
  }
  const psPaths = JSON.stringify(paths);
  const command = `
$ErrorActionPreference = 'Stop'
$paths = ConvertFrom-Json @'
${psPaths}
'@
$out = @()
foreach ($p in $paths) {
  $sig = Get-AuthenticodeSignature -FilePath $p
  $cert = $sig.SignerCertificate
  $out += [pscustomobject]@{
    path = $sig.Path
    status = $sig.Status.ToString()
    statusMessage = $sig.StatusMessage
    signerSubject = $(if ($cert) { $cert.Subject } else { '' })
    signerThumbprint = $(if ($cert) { $cert.Thumbprint } else { '' })
    notBefore = $(if ($cert) { $cert.NotBefore.ToUniversalTime().ToString('o') } else { '' })
    notAfter = $(if ($cert) { $cert.NotAfter.ToUniversalTime().ToString('o') } else { '' })
  }
}
$out | ConvertTo-Json -Depth 5
`;
  const result = await runBoundedCommand({
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedPowerShell(command)],
    cwd: ROOT,
    timeoutMs: 60000,
    label: 't1-signing/authenticode'
  });
  if (result.exitCode !== 0) {
    return paths.map(p => ({ path: p, status: 'CheckFailed', statusMessage: result.output.trim(), signerSubject: '', signerThumbprint: '' }));
  }
  let output = String(result.output || '');
  output = output.replace(/^#< CLIXML\r?\n/, '');
  const xmlAt = output.indexOf('<Objs Version=');
  if (xmlAt >= 0) output = output.slice(0, xmlAt);
  const start = output.search(/[\[{]/);
  if (start < 0) {
    return paths.map(p => ({ path: p, status: 'CheckFailed', statusMessage: result.output.trim(), signerSubject: '', signerThumbprint: '' }));
  }
  const jsonText = output.slice(start).trim();
  const end = Math.max(jsonText.lastIndexOf(']'), jsonText.lastIndexOf('}'));
  if (end < 0) {
    return paths.map(p => ({ path: p, status: 'CheckFailed', statusMessage: result.output.trim(), signerSubject: '', signerThumbprint: '' }));
  }
  const parsed = JSON.parse(jsonText.slice(0, end + 1) || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}
function updaterStatus(installer) {
  const sigFile = installer ? installer + '.sig' : '';
  const keyPath = String(process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || '').trim();
  const keyInline = String(process.env.TAURI_SIGNING_PRIVATE_KEY || '').trim();
  const signatureFilePresent = !!(sigFile && existsSync(sigFile));
  let signatureFileFresh = false;
  let installerMtime = '';
  let signatureMtime = '';
  if (installer && existsSync(installer)) {
    try { installerMtime = statSync(installer).mtime.toISOString(); } catch (_) {}
  }
  if (signatureFilePresent) {
    try {
      const installerStat = statSync(installer);
      const signatureStat = statSync(sigFile);
      signatureMtime = signatureStat.mtime.toISOString();
      signatureFileFresh = signatureStat.mtimeMs >= installerStat.mtimeMs;
    } catch (_) {}
  }
  return {
    signatureFile: sigFile,
    signatureFilePresent,
    signatureFileFresh,
    installerMtime,
    signatureMtime,
    privateKeyPathPresent: !!(keyPath && existsSync(keyPath)),
    privateKeyEnvPresent: !!keyInline,
    requiredEnv: 'TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH'
  };
}
function procurementStatus() {
  const raw = String(process.env.STARNET_AUTHENTICODE_CERT_STATUS || '').trim().toLowerCase();
  const allowed = new Set(['started', 'ordered', 'validation', 'issued', 'available']);
  return allowed.has(raw) ? raw : 'not-started';
}
function classifyAuthenticode(signatures) {
  if (!signatures.length) return { ready: false, failed: false, label: 'missing', detail: 'No artifacts were checked.' };
  const statuses = signatures.map(s => String(s.status || ''));
  if (statuses.every(s => s === 'Valid')) return { ready: true, failed: false, label: 'valid', detail: 'All checked Windows artifacts have valid Authenticode signatures.' };
  const unsignedLike = new Set(['NotSigned', 'UnknownError', 'UnsupportedPlatform']);
  if (statuses.every(s => unsignedLike.has(s))) return { ready: false, failed: false, label: 'unsigned', detail: 'Artifacts are unsigned or Authenticode is unavailable in this environment.' };
  return { ready: false, failed: true, label: 'invalid', detail: 'At least one artifact has an invalid or failed Authenticode status: ' + statuses.join(', ') };
}
function step(id, phase, title, status, reason, extra = {}) {
  return Object.assign({ id, phase, title, status, required: true, reason }, extra);
}
function acceptedOrBlocked(publicStatus, reason) {
  return REQUIRE_PUBLIC
    ? { status: 'blocked', reason }
    : { status: 'accepted-deferral', reason: reason + ' Accepted for invited beta only; public release remains blocked.' };
}
function checkPlan(loop) {
  const file = join(ROOT, 'docs', 'STARNET_T1_SIGNING_LOOP.md');
  const text = readText(file).toLowerCase();
  const required = ['authenticode', 'invited beta', 'public release', 'ov', 'ev', 'smartscreen', 'tauri_signing_private_key'];
  const missing = required.filter(term => text.indexOf(term) < 0);
  return step('t1.0-loop-spec', 'T1.0', 'T1 signing lead-time loop is documented', existsSync(file) && !missing.length ? 'pass' : 'fail', missing.length ? 'Missing terms: ' + missing.join(', ') : 'T1 loop spec exists.', { loop, evidenceFile: file });
}
async function runOnce(loop) {
  const results = [checkPlan(loop)];
  const a = artifacts();
  const appInfo = fileInfo(a.app);
  const installerInfo = fileInfo(a.installer);
  results.push(step('t1.1-release-artifacts', 'T1.1', 'App and NSIS artifacts are discoverable', appInfo && installerInfo ? 'pass' : 'blocked', appInfo && installerInfo ? 'App and installer found; hashes recorded.' : 'Build desktop artifacts first with npm.cmd run phase5:surface or npm.cmd run desktop:build.', { loop, artifacts: { app: appInfo, installer: installerInfo, version: a.version } }));

  let signatures = [];
  if (appInfo && installerInfo) signatures = await authenticode([a.app, a.installer]);
  writeJson(join(OUT, 'authenticode.json'), signatures);
  const sig = classifyAuthenticode(signatures);
  if (sig.ready) {
    results.push(step('t1.2-authenticode', 'T1.2', 'Authenticode signatures are valid', 'pass', sig.detail, { loop, signatures }));
  } else if (sig.failed) {
    results.push(step('t1.2-authenticode', 'T1.2', 'Authenticode signatures are valid', 'fail', sig.detail, { loop, signatures }));
  } else {
    const s = acceptedOrBlocked(REQUIRE_PUBLIC, 'Windows app and installer are not Authenticode-signed yet.');
    results.push(step('t1.2-authenticode', 'T1.2', 'Authenticode signatures are valid', s.status, s.reason, { loop, signatures }));
  }

  const up = updaterStatus(a.installer);
  if (up.signatureFilePresent && up.signatureFileFresh) {
    results.push(step('t1.3-tauri-updater-signature', 'T1.3', 'Tauri updater signature artifact exists', 'pass', 'Updater signature artifact exists next to the installer and is current with the installer build.', { loop, updater: up }));
  } else if (up.signatureFilePresent) {
    const s = acceptedOrBlocked(REQUIRE_PUBLIC, 'Updater .sig artifact is older than the current installer; rebuild with the Tauri signing private key before public update delivery.');
    results.push(step('t1.3-tauri-updater-signature', 'T1.3', 'Tauri updater signature artifact exists', s.status, s.reason, { loop, updater: up }));
  } else {
    const s = acceptedOrBlocked(REQUIRE_PUBLIC, 'Updater .sig artifact is missing; build with the Tauri signing private key before public update delivery.');
    results.push(step('t1.3-tauri-updater-signature', 'T1.3', 'Tauri updater signature artifact exists', s.status, s.reason, { loop, updater: up }));
  }

  const cert = procurementStatus();
  if (sig.ready || ['started', 'ordered', 'validation', 'issued', 'available'].includes(cert)) {
    results.push(step('t1.4-cert-procurement', 'T1.4', 'Authenticode certificate procurement is tracked', 'pass', sig.ready ? 'Signing certificate is already evidenced by valid signatures.' : 'Certificate procurement status: ' + cert + '.', { loop, procurement: { status: cert } }));
  } else {
    const s = acceptedOrBlocked(REQUIRE_PUBLIC, 'Authenticode certificate procurement has not been marked started.');
    results.push(step('t1.4-cert-procurement', 'T1.4', 'Authenticode certificate procurement is tracked', s.status, s.reason, { loop, procurement: { status: cert, expectedEnv: 'STARNET_AUTHENTICODE_CERT_STATUS=started|ordered|validation|issued|available' } }));
  }

  return results;
}
function signature(results) {
  return results.map(r => r.id + ':' + r.status + ':' + (r.reason || '')).join('|');
}
function chooseNextAction(latest) {
  const nonPass = latest.filter(r => r.status === 'fail' || r.status === 'blocked' || r.status === 'accepted-deferral');
  if (!nonPass.length) return null;
  const failed = nonPass.find(r => r.status === 'fail');
  if (failed) return failed;
  const priority = [
    't1.4-cert-procurement',
    't1.3-tauri-updater-signature',
    't1.2-authenticode',
    't1.1-release-artifacts',
    't1.0-loop-spec'
  ];
  for (const id of priority) {
    const match = nonPass.find(r => r.id === id);
    if (match) return match;
  }
  return nonPass[0];
}
function writeSummary(allResults, loopsRun) {
  ensureDir(OUT);
  const latest = allResults.filter(r => r.loop === loopsRun);
  const fail = latest.filter(r => r.status === 'fail').length;
  const blocked = latest.filter(r => r.status === 'blocked').length;
  const accepted = latest.filter(r => r.status === 'accepted-deferral').length;
  const pass = latest.filter(r => r.status === 'pass').length;
  const publicReleaseReady = !fail && !blocked && !accepted && latest.length > 0;
  const invitedBetaReady = !fail && !latest.some(r => r.id === 't1.1-release-artifacts' && r.status !== 'pass');
  const procurement = latest.find(r => r.id === 't1.4-cert-procurement');
  const leadTimeStarted = !!(procurement && procurement.status === 'pass');
  const nextAction = chooseNextAction(latest);
  const verdict = fail ? 'red' : (blocked ? 'blocked' : 'green');
  const acceptedLeadTimeGaps = latest.filter(r => r.status === 'accepted-deferral').map(r => r.reason);
  const json = {
    generatedAt: nowIso(),
    lane: 'T1-signing-lead-time',
    mode: REQUIRE_PUBLIC ? 'public-release' : 'invited-beta',
    verdict,
    invitedBetaReady,
    publicReleaseReady,
    leadTimeStarted,
    loopsRun,
    outDir: OUT,
    counts: { pass, accepted, blocked, fail },
    acceptedLeadTimeGaps,
    nextAction: nextAction ? { id: nextAction.id, status: nextAction.status, reason: nextAction.reason } : null,
    results: latest,
    history: allResults.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeJson(join(OUT, 't1-signing-status.json'), json);

  let md = '# StarNet T1 Signing Lead-Time Evidence\n\n';
  md += '- Generated: `' + json.generatedAt + '`\n';
  md += '- Mode: `' + json.mode + '`\n';
  md += '- Verdict: `' + json.verdict + '`\n';
  md += '- Invited beta ready: `' + json.invitedBetaReady + '`\n';
  md += '- Public release ready: `' + json.publicReleaseReady + '`\n\n';
  md += '- Lead-time started: `' + json.leadTimeStarted + '`\n\n';
  md += '| Status | Phase | Step | Notes |\n|---|---|---|---|\n';
  for (const r of latest) md += '| ' + statusIcon(r.status) + ' | `' + mdEscape(r.phase) + '` | `' + r.id + '` ' + mdEscape(r.title) + ' | ' + mdEscape(r.reason) + ' |\n';
  md += '\n## Accepted Lead-Time Gaps\n\n';
  if (!acceptedLeadTimeGaps.length) md += 'None.\n';
  else for (const gap of acceptedLeadTimeGaps) md += '- ' + gap + '\n';
  md += '\n## Next Action\n\n';
  const next = nextAction;
  if (next) md += 'Work `' + next.id + '`: ' + next.reason + '\n';
  else md += 'T1 is public-release ready: signed artifacts and updater signature evidence are present.\n';
  writeFileSync(join(OUT, 'summary.md'), md);
  copyLatest();
  return json;
}

let allResults = [];
let loopsRun = 0;
let prevSig = '';
for (let i = 1; i <= LOOP_MAX; i += 1) {
  console.log('[t1-signing] loop ' + i + ' starting');
  const results = await runOnce(i);
  loopsRun = i;
  allResults = allResults.concat(results);
  for (const r of results) console.log('[t1-signing]   ' + statusIcon(r.status) + ' ' + r.id);
  const sig = signature(results);
  if (!results.some(r => r.status !== 'pass')) break;
  if (prevSig && prevSig === sig) break;
  prevSig = sig;
}

const summary = writeSummary(allResults, loopsRun);
console.log('[t1-signing] evidence: ' + OUT);
console.log('[t1-signing] latest: ' + LATEST);
console.log('[t1-signing] invitedBetaReady=' + summary.invitedBetaReady + ' publicReleaseReady=' + summary.publicReleaseReady);
if (summary.verdict === 'red') process.exit(1);
if (REQUIRE_PUBLIC && !summary.publicReleaseReady) process.exit(2);
if (!REQUIRE_PUBLIC && !summary.invitedBetaReady) process.exit(2);
process.exit(0);
