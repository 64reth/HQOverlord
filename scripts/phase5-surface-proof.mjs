#!/usr/bin/env node
// phase5-surface-proof.mjs - browser/computer/desktop evidence classifier for P5.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedCommand } from './lib/run-command.mjs';
import { withoutLiveProviderEnv } from './lib/provider-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.STARNET_PHASE5_SURFACE_DIR || join(ROOT, '.dogfood', 'phase5-surface-proof'));
const evidenceFile = join(ROOT, '.dogfood', 'phase5-evidence.json');
const nodeCmd = process.execPath;
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function evidenceTemplate() {
  return {
    generatedAt: new Date().toISOString(),
    operator: process.env.USERNAME || process.env.USER || 'andro',
    workloads: { passed: false, proofLevel: '', screenshots: [], runIds: [], transcriptIds: [], artifactPaths: [], ledgerRows: [], modelNames: [], toolCalls: [], notes: '' },
    surface: {
      browser: { status: 'blocked', proofLevel: '', logs: [], notes: '' },
      computer: { status: 'blocked', proofLevel: '', logs: [], notes: '' }
    },
    soak: { phase4LiveGreen: false, phase5WorkloadGreen: false, restartPreserved: false, notes: '' },
    recovery: { phase4RecoveryGreen: false, phase5RecoveryGreen: false, notes: '' },
    desktop: { status: 'blocked', logs: [], notes: '' }
  };
}
async function runStep(id, cmd, args, timeoutMs = 300000) {
  console.log('[phase5-surface] ' + id);
  const result = await runBoundedCommand({
    cmd,
    args,
    cwd: ROOT,
    env: withoutLiveProviderEnv(),
    timeoutMs,
    label: 'phase5-surface/' + id
  });
  const logFile = join(OUT, id + '.log');
  writeFileSync(logFile, result.output);
  const status = result.exitCode === 0 ? 'pass' : 'fail';
  console.log('[phase5-surface]   ' + status.toUpperCase() + ' exit=' + result.exitCode);
  return { id, status, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, logFile };
}
function cargoAvailable() {
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const pathEnv = String(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  const candidates = pathEnv.map(p => p && join(p, exe));
  if (process.platform === 'win32' && process.env.USERPROFILE) candidates.push(join(process.env.USERPROFILE, '.cargo', 'bin', exe));
  return candidates.some(p => p && existsSync(p));
}
function tauriCliPath() {
  return join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
}
function vsDevCmdPath() {
  if (process.platform !== 'win32') return '';
  const base = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const p = join(base, 'Microsoft Visual Studio', '2022', 'BuildTools', 'Common7', 'Tools', 'VsDevCmd.bat');
  return existsSync(p) ? p : '';
}
function msvcLinkerPath() {
  if (process.platform !== 'win32') return '';
  const base = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const tools = join(base, 'Microsoft Visual Studio', '2022', 'BuildTools', 'VC', 'Tools', 'MSVC');
  try {
    const versions = readdirSync(tools).sort().reverse();
    for (const v of versions) {
      const p = join(tools, v, 'bin', 'Hostx64', 'x64', 'link.exe');
      if (existsSync(p)) return p;
    }
  } catch (_) {}
  return '';
}
function cmdQuote(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function desktopBuildStep() {
  if (process.platform !== 'win32') return { cmd: npmCmd, args: ['run', 'desktop:build'], timeoutMs: 600000 };
  const tauri = tauriCliPath();
  const cargoBin = process.env.USERPROFILE ? join(process.env.USERPROFILE, '.cargo', 'bin') : '';
  const lines = ['@echo off'];
  const vsdev = vsDevCmdPath();
  const linker = msvcLinkerPath();
  if (vsdev) lines.push('call ' + cmdQuote(vsdev) + ' -arch=x64 -host_arch=x64');
  if (cargoBin) lines.push('set "PATH=' + cargoBin + ';%PATH%"');
  if (linker) lines.push('set "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER=' + linker + '"');
  lines.push(cmdQuote(process.execPath) + ' scripts\\prepare-node.mjs');
  lines.push('if errorlevel 1 exit /b %errorlevel%');
  lines.push(cmdQuote(process.execPath) + ' scripts\\stage-voice-deps.mjs --target win-x64');
  lines.push('if errorlevel 1 exit /b %errorlevel%');
  lines.push(cmdQuote(tauri) + ' build');
  lines.push('exit /b %errorlevel%');
  const runner = join(OUT, 'desktop-build-runner.cmd');
  writeFileSync(runner, lines.join('\r\n') + '\r\n');
  return { cmd: runner, args: [], timeoutMs: 1200000 };
}
function desktopArtifacts() {
  const release = join(ROOT, 'src-tauri', 'target', 'release');
  const nsis = join(release, 'bundle', 'nsis');
  let setup = '';
  try { setup = readdirSync(nsis).find(n => /-setup\.exe$/i.test(n)) || ''; } catch (_) {}
  return {
    app: join(release, 'skynet-desktop.exe'),
    setup: setup ? join(nsis, setup) : '',
    appExists: existsSync(join(release, 'skynet-desktop.exe')),
    setupExists: !!(setup && existsSync(join(nsis, setup)))
  };
}
function signingSecretMissing(result) {
  return /TAURI_SIGNING_PRIVATE_KEY/.test(readText(result && result.logFile));
}
function unique(xs) {
  return Array.from(new Set((xs || []).filter(x => String(x || '').trim())));
}
function cleanNotes(xs) {
  const out = [];
  for (const note of xs || []) {
    for (const part of String(note || '').split(/(?<=\.)\s+/)) {
      const s = part.trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    }
  }
  return out.join(' ');
}

ensureDir(OUT);
const results = [];
results.push(await runStep('browser-contract', nodeCmd, ['test/browser.test.js'], 120000));
results.push(await runStep('computer-contract', nodeCmd, ['test/computer.test.js'], 120000));
results.push(await runStep('desktop-prepare', npmCmd, ['run', 'desktop:prepare'], 300000));
if (!existsSync(tauriCliPath())) {
  results.push(await runStep('desktop-node-deps', npmCmd, ['ci'], 300000));
}

let desktopBuild = null;
if (cargoAvailable()) {
  const step = desktopBuildStep();
  desktopBuild = await runStep('desktop-build', step.cmd, step.args, step.timeoutMs);
  const artifacts = desktopArtifacts();
  if (desktopBuild.status === 'fail' && signingSecretMissing(desktopBuild) && artifacts.appExists && artifacts.setupExists) {
    desktopBuild.status = 'pass';
    desktopBuild.reason = 'Desktop binary and NSIS installer were produced; updater signing private key is absent, so signed update artifacts were not produced.';
    console.log('[phase5-surface]   PASS desktop-build artifacts exist; signing key missing');
  }
  results.push(desktopBuild);
} else {
  desktopBuild = { id: 'desktop-build', status: 'blocked', exitCode: null, timedOut: false, durationMs: 0, logFile: join(OUT, 'desktop-build.log'), reason: 'cargo not found on PATH' };
  writeFileSync(desktopBuild.logFile, 'blocked: cargo not found on PATH\n');
  results.push(desktopBuild);
  console.log('[phase5-surface]   BLOCKED desktop-build cargo not found on PATH');
}

const browser = results.find(r => r.id === 'browser-contract');
const computer = results.find(r => r.id === 'computer-contract');
const prepare = results.find(r => r.id === 'desktop-prepare');
const nodeDeps = results.find(r => r.id === 'desktop-node-deps');
const fail = results.some(r => r.status === 'fail');
const desktopStatus = prepare && prepare.status === 'pass' && (!nodeDeps || nodeDeps.status === 'pass') && desktopBuild && desktopBuild.status === 'pass'
  ? 'green'
  : (prepare && prepare.status === 'pass' && desktopBuild && desktopBuild.status === 'blocked' ? 'toolchain-blocked' : 'blocked');
const artifacts = desktopArtifacts();
const signingMissing = !!(desktopBuild && signingSecretMissing(desktopBuild) && artifacts.appExists && artifacts.setupExists);

const evidence = readJson(evidenceFile, evidenceTemplate());
evidence.generatedAt = new Date().toISOString();
evidence.operator = evidence.operator || process.env.USERNAME || process.env.USER || 'andro';
evidence.surface = evidence.surface || {};
const priorBrowser = evidence.surface.browser || {};
const priorComputer = evidence.surface.computer || {};
const browserRef = priorBrowser.status === 'ref-proven';
const computerRef = priorComputer.status === 'ref-proven';
evidence.surface.browser = {
  status: browserRef ? 'ref-proven' : (browser && browser.status === 'pass' ? 'contract-green' : 'blocked'),
  proofLevel: browserRef ? (priorBrowser.proofLevel || 'live-ui-browser-tools') : (browser && browser.status === 'pass' ? 'automated-contract' : ''),
  logs: unique((priorBrowser.logs || []).concat(browser && browser.logFile)),
  notes: browserRef
    ? cleanNotes([priorBrowser.notes, browser && browser.status === 'pass' ? 'Browser automation contract also remains green.' : 'Browser automation contract failed or timed out; live proof is preserved but the regression must be fixed.'])
    : (browser && browser.status === 'pass'
      ? 'Browser automation contract is green. This is not yet ref-proven live browser workload evidence.'
      : 'Browser automation contract failed or timed out.')
};
evidence.surface.computer = {
  status: computerRef ? 'ref-proven' : (computer && computer.status === 'pass' ? 'contract-green' : 'blocked'),
  proofLevel: computerRef ? (priorComputer.proofLevel || 'live-ui-attended-driver') : (computer && computer.status === 'pass' ? 'automated-contract' : ''),
  logs: unique((priorComputer.logs || []).concat(computer && computer.logFile)),
  notes: computerRef
    ? cleanNotes([priorComputer.notes, computer && computer.status === 'pass' ? 'Desktop computer-use contract also remains green.' : 'Desktop computer-use contract failed or timed out; live attended-driver proof is preserved but the regression must be fixed.'])
    : (computer && computer.status === 'pass'
      ? 'Desktop computer-use contract is green. Real attended desktop-driver evidence is still required for ready-to-replace.'
      : 'Desktop computer-use contract failed or timed out.')
};
evidence.desktop = {
  status: desktopStatus,
  logs: unique((evidence.desktop && evidence.desktop.logs || []).concat(results.filter(r => /^desktop-/.test(r.id)).map(r => r.logFile))),
  artifacts: unique([artifacts.appExists && artifacts.app, artifacts.setupExists && artifacts.setup]),
  signing: signingMissing ? { status: 'secret-missing', requiredEnv: 'TAURI_SIGNING_PRIVATE_KEY', notes: 'Updater public key is configured, but the private key is not present in this environment.' } : { status: desktopStatus === 'green' ? 'not-required-or-present' : 'unknown', requiredEnv: 'TAURI_SIGNING_PRIVATE_KEY', notes: '' },
  notes: desktopStatus === 'green'
    ? (signingMissing
      ? 'Desktop prepare, locked Node dependency install, Rust compile, and NSIS bundle are green. Updater signing private key is not present, so signed update artifacts were not produced in this run.'
      : 'Desktop prepare and Tauri build are green on this machine.')
    : (desktopStatus === 'toolchain-blocked'
      ? 'Desktop prepare is green, but Cargo is not on PATH so clean-machine/Tauri build remains a toolchain evidence item.'
      : 'Desktop readiness is blocked; inspect the desktop logs.')
};
writeJson(evidenceFile, evidence);

const status = {
  generatedAt: new Date().toISOString(),
  verdict: fail ? 'red' : 'green',
  counts: { pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length, blocked: results.filter(r => r.status === 'blocked').length },
  results
};
writeJson(join(OUT, 'phase5-surface-status.json'), status);
console.log('[phase5-surface] evidence: ' + OUT);
console.log('[phase5-surface] phase5 evidence: ' + evidenceFile);
process.exit(fail ? 1 : 0);
