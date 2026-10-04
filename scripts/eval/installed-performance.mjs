#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { startFixtureMcpServer } from './campaign/fixture-host.mjs';
import { desktopStartupLogMark, installedDesktopStartupLog, startStarNetDriver, waitInstalledDesktopPort } from './campaign/drivers.mjs';
import { validateManifest } from './bind.mjs';
import { makeReceipt } from './comparison.mjs';
import { gradeParityTrajectory, validateParityFixtures } from './independent-grader.mjs';
import { signReceipt } from './receipt-signing.mjs';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const round = value => Math.round(Number(value) * 1000) / 1000;
const hashFile = file => createHash('sha256').update(readFileSync(resolve(file))).digest('hex');
function argsOf(argv) { const out = {}; for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1]; return out; }
function json(file) { return JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, '')); }
function jsonl(file) { return readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse); }

export function performanceStats(values) {
  if (!Array.isArray(values) || !values.length || values.some(value => !Number.isFinite(Number(value)))) throw new Error('performance samples must be finite and non-empty');
  const ordered = values.map(Number).sort((a, b) => a - b);
  const at = p => ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * p) - 1))];
  return { unit: 'ms', samples: ordered.length, min: round(ordered[0]), median: round(at(0.5)), p95: round(at(0.95)), max: round(ordered.at(-1)), values: ordered.map(round) };
}

async function terminateTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') {
    const script = `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue;if($p){$null=$p.CloseMainWindow()}`;
    spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
    await Promise.race([new Promise(done => child.once('exit', done)), sleep(5000)]);
    if (child.exitCode == null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10000 });
  }
  else { try { child.kill('SIGTERM'); } catch (_) {} }
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(3000)]);
}

async function endpointAvailable(base) {
  try { return (await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok; } catch (_) { return false; }
}

async function waitDesktopReady(base, child, timeoutMs, started = performance.now()) {
  while (performance.now() - started < timeoutMs) {
    if (child.exitCode != null) throw new Error(`installed desktop exited ${child.exitCode} before readiness`);
    try {
      const [healthResponse, stationResponse] = await Promise.all([
        fetch(base + '/health', { signal: AbortSignal.timeout(1000) }),
        fetch(base + '/', { signal: AbortSignal.timeout(1000) })
      ]);
      const health = await healthResponse.json(), html = await stationResponse.text();
      if (healthResponse.ok && stationResponse.ok && health.status === 'ok' && /<html|<!doctype/i.test(html)) {
        return { ms: performance.now() - started, version: String(health.version || ''), healthStatus: health.status, stationBytes: Buffer.byteLength(html) };
      }
    } catch (_) {}
    await sleep(100);
  }
  throw new Error(`installed desktop readiness timed out after ${timeoutMs}ms`);
}

async function main() {
  const opts = argsOf(process.argv.slice(2));
  for (const key of ['desktop-executable', 'runtime-root', 'workspaces', 'manifest', 'contract', 'fixtures', 'tasks', 'signing-key', 'output', 'receipt', 'output-dir']) if (!opts[key]) throw new Error(`missing --${key}`);
  const samples = Math.max(3, Math.min(30, Math.floor(Number(opts.samples) || 5)));
  const timeoutMs = Math.max(30000, Math.min(600000, Math.floor(Number(opts['timeout-ms']) || 180000)));
  const executable = resolve(opts['desktop-executable']), manifestPath = resolve(opts.manifest), output = resolve(opts.output), receiptPath = resolve(opts.receipt), outputDir = resolve(opts['output-dir']);
  const manifest = validateManifest(json(manifestPath)), subject = manifest.subject;
  if (resolve(subject.executable.path) !== executable || subject.executable.sha256 !== hashFile(executable)) throw new Error('desktop executable does not match the installed candidate manifest');
  mkdirSync(dirname(output), { recursive: true }); mkdirSync(outputDir, { recursive: true });

  const startupLog = installedDesktopStartupLog(opts.workspaces);
  const coldSamples = [];
  for (let index = 0; index < samples; index++) {
    const launchStarted = performance.now(), startupMark = desktopStartupLogMark(startupLog);
    const child = spawn(executable, [], { cwd: dirname(executable), windowsHide: true, stdio: 'ignore', env: Object.assign({}, process.env) });
    let desktopBase = '';
    try {
      const actualPort = await waitInstalledDesktopPort({ startupLog, afterBytes: startupMark, child, timeoutMs });
      desktopBase = `http://127.0.0.1:${actualPort}`;
      const ready = await waitDesktopReady(desktopBase, child, timeoutMs, launchStarted);
      if (ready.version !== subject.provenance.describe) throw new Error(`desktop health version ${ready.version} != ${subject.provenance.describe}`);
      coldSamples.push({ attempt: index + 1, port: actualPort, ...ready });
    } finally { await terminateTree(child); }
    for (let wait = 0; desktopBase && wait < 100 && await endpointAvailable(desktopBase); wait++) await sleep(100);
    if (desktopBase && await endpointAvailable(desktopBase)) throw new Error(`desktop port did not release after attempt ${index + 1}`);
  }

  const tasks = jsonl(opts.tasks), fixtures = jsonl(opts.fixtures), validation = validateParityFixtures(tasks, fixtures);
  if (!validation.ok) throw new Error('fixture pack invalid: ' + validation.errors.join('; '));
  const task = tasks.find(row => row.id === 'parity-code-verified-artifact'), fixture = fixtures.find(row => row.taskId === task?.id);
  if (!task || !fixture) throw new Error('verified-artifact performance fixture is missing');
  const fixtureServer = await startFixtureMcpServer(); let driver = null;
  const artifactSamples = [];
  try {
    driver = await startStarNetDriver({ desktopExecutable: executable, root: opts['runtime-root'], workspaces: opts.workspaces, fixtureUrl: fixtureServer.url, outputDir, timeoutMs });
    for (let index = 0; index < samples; index++) {
      const root = mkdtempSync(join(outputDir, `installed-artifact-a${index + 1}-`)), state = fixtureServer.activate(fixture, root);
      try {
        const row = await driver.run({ fixture, state, root, attempt: index + 1 });
        const grade = gradeParityTrajectory(task, fixture, row, validation.fixtureSha256);
        if (!grade.passed) throw new Error(`useful-artifact attempt ${index + 1} failed independent grading: ` + grade.checks.filter(check => !check.pass).map(check => check.id).join(', '));
        const verifiedAt = Math.max(...row.artifacts.map(item => Date.parse(item.verifiedAt)));
        artifactSamples.push({ attempt: index + 1, firstVisibleTokenMs: round(row.metrics.firstOutputMs), verifiedArtifactMs: round(verifiedAt - Date.parse(row.startedAt)), finalMs: round(row.metrics.totalMs), runId: row.runId, artifactSha256: row.artifacts[0].sha256 });
      } finally { rmSync(root, { recursive: true, force: true }); }
    }
  } finally { if (driver) await driver.close(); await fixtureServer.close(); }

  const result = {
    schemaVersion: 'starnet.eval.installed-performance.v1', pass: coldSamples.length === samples && artifactSamples.length === samples,
    scope: 'installed Windows desktop cold start plus installed-runtime provider-backed useful artifact', samples,
    measurements: {
      desktopProcessToHealthAndStationMs: performanceStats(coldSamples.map(row => row.ms)),
      sendToFirstVisibleTokenMs: performanceStats(artifactSamples.map(row => row.firstVisibleTokenMs)),
      sendToVerifiedArtifactMs: performanceStats(artifactSamples.map(row => row.verifiedArtifactMs)),
      sendToFinalMs: performanceStats(artifactSamples.map(row => row.finalMs))
    },
    coldSamples, artifactSamples,
    limitations: ['Desktop readiness is health plus served station HTML; one live Windows UI inspection is recorded separately.', 'Useful-artifact timing uses the installed runtime and active provider credentials, not simulated output.']
  };
  const report = { ...result, capturedAt: new Date().toISOString(), candidate: { executable, sha256: hashFile(executable), describe: subject.provenance.describe }, fixtureSetSha256: validation.fixtureSha256 };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  let receipt = makeReceipt({ kind: 'installed-performance', contract: json(opts.contract), subject, result,
    evidence: { path: output, bytes: statSync(output).size, sha256: hashFile(output), manifestPath, manifestSha256: hashFile(manifestPath), fixtureSetSha256: validation.fixtureSha256 }, limitations: result.limitations });
  receipt = signReceipt(receipt, opts['signing-key']); writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log(`[agent-eval] INSTALLED PERFORMANCE PASS cold=${result.measurements.desktopProcessToHealthAndStationMs.median}ms useful=${result.measurements.sendToVerifiedArtifactMs.median}ms samples=${samples}`);
  console.log(`[agent-eval] receipt ${receiptPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error('[agent-eval] installed performance failed:', error && error.stack || error); process.exit(1); });
}
