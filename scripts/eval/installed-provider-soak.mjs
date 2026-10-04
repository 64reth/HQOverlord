#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureMcpServer } from './campaign/fixture-host.mjs';
import { startStarNetDriver } from './campaign/drivers.mjs';
import { validateManifest } from './bind.mjs';
import { makeReceipt } from './comparison.mjs';
import { gradeParityTrajectory, validateParityFixtures } from './independent-grader.mjs';
import { signReceipt } from './receipt-signing.mjs';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const iso = ms => new Date(ms).toISOString();
export function hashFileStreamed(file) {
  return new Promise((done, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(resolve(file), { highWaterMark: 64 * 1024 });
    input.on('error', reject);
    input.on('data', chunk => hash.update(chunk));
    input.on('end', () => done(hash.digest('hex')));
  });
}
export async function retryObserver(fn, attempts = 3, options = {}) {
  let last; const failures = [];
  const retrySleep = options.sleep || sleep, baseDelayMs = finite(options.baseDelayMs, 250);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fn(attempt); }
    catch (error) {
      last = error; failures.push(String(error?.message || error));
      if (attempt < attempts) await retrySleep(baseDelayMs * attempt);
    }
  }
  if (last && typeof last === 'object') last.observerFailures = failures;
  throw last;
}
function argsOf(argv) { const out = {}; for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1]; return out; }
function json(file) { return JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, '')); }
function jsonl(file) { return readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function finite(value, fallback = null) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function writeAtomic(file, value) { const target = resolve(file), temp = target + '.tmp'; mkdirSync(dirname(target), { recursive: true }); writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(temp, target); }

export function installedRuntimeFingerprint(root, paths = ['frontend', 'sidecar', 'shared']) {
  const base = resolve(root), files = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const path of paths) visit(resolve(base, path));
  files.sort((a, b) => relative(base, a).localeCompare(relative(base, b), 'en'));
  const hash = createHash('sha256');
  for (const file of files) {
    const name = relative(base, file).split(sep).join('/');
    hash.update(name).update('\0').update(createHash('sha256').update(readFileSync(file)).digest('hex')).update('\n');
  }
  return { algorithm: 'path-content-sha256', files: files.length, sha256: hash.digest('hex') };
}

export function requiredSoakCoverage(durationHours, intervalSeconds) {
  if (!(Number(durationHours) > 0) || !(Number(intervalSeconds) > 0)) throw new Error('soak duration and interval must be positive');
  return Math.max(1, Math.floor((Number(durationHours) * 3600 / Number(intervalSeconds)) * 0.99));
}

function windowsObserverScript(pid) {
  return [
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)',
    "while (($request = [Console]::In.ReadLine()) -ne $null) {",
    '  try {',
    `    $p=Get-Process -Id ${Number(pid)} -ErrorAction Stop`,
    "    [Console]::Out.WriteLine('OK|'+$p.WorkingSet64.ToString()+'|'+$p.CPU.ToString([Globalization.CultureInfo]::InvariantCulture))",
    '  } catch {',
    "    $detail=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.ToString()))",
    "    [Console]::Out.WriteLine('ERR|'+$detail)",
    '  }',
    '  [Console]::Out.Flush()',
    '}'
  ].join("\n");
}

export function parseWindowsObserverLine(line) {
  const fields = String(line || '').trim().split('|');
  if (fields[0] === 'ERR') {
    let detail = 'Windows process observer failed';
    try { detail = Buffer.from(fields.slice(1).join('|'), 'base64').toString('utf8') || detail; } catch (_) {}
    throw new Error(detail);
  }
  if (fields[0] !== 'OK') throw new Error(`unexpected Windows observer response: ${String(line || '').slice(0, 160)}`);
  const stats = { rssBytes: finite(fields[1]), cpuSeconds: finite(fields[2]) };
  if (!(stats.rssBytes > 0) || !(stats.cpuSeconds >= 0)) throw new Error('process telemetry was incomplete');
  return stats;
}

export function createWindowsProcessObserver(pid, options = {}) {
  const spawnProcess = options.spawn || spawn, attempts = Math.max(1, finite(options.attempts, 6));
  const requestTimeoutMs = Math.max(100, finite(options.requestTimeoutMs, 5000));
  const baseDelayMs = Math.max(0, finite(options.baseDelayMs, 1000));
  const encoded = Buffer.from(windowsObserverScript(pid), 'utf16le').toString('base64');
  let child = null, buffer = '', inflight = null, stderr = '', closed = false;

  const failInflight = error => {
    if (!inflight) return;
    const pending = inflight; inflight = null; clearTimeout(pending.timer); pending.reject(error);
  };
  const discardChild = error => {
    const stale = child; child = null; buffer = '';
    failInflight(error || new Error('Windows process observer restarted'));
    if (stale && stale.exitCode == null) { try { stale.kill(); } catch (_) {} }
  };
  const ensureChild = () => {
    if (closed) throw new Error('Windows process observer is closed');
    if (child && child.exitCode == null && !child.killed) return child;
    stderr = ''; buffer = '';
    const active = spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    child = active;
    active.stdout.setEncoding('utf8'); active.stderr.setEncoding('utf8');
    active.stdout.on('data', chunk => {
      if (child !== active) return;
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (!inflight) continue;
        const pending = inflight; inflight = null; clearTimeout(pending.timer); pending.resolve(line);
      }
    });
    active.stderr.on('data', chunk => { if (child === active) stderr = (stderr + chunk).slice(-4000); });
    active.on('error', error => { if (child === active) discardChild(error); });
    active.on('exit', (code, signal) => {
      if (child !== active) return;
      const detail = stderr.trim().replace(/\u0000/g, ' ').slice(-1000);
      discardChild(new Error(`Windows process observer exited code=${code} signal=${signal || ''}${detail ? `: ${detail}` : ''}`));
    });
    return active;
  };
  const request = () => new Promise((resolveRequest, rejectRequest) => {
    const active = ensureChild();
    if (inflight) return rejectRequest(new Error('Windows process observer request overlap'));
    const timer = setTimeout(() => {
      if (!inflight) return;
      inflight = null; discardChild(); rejectRequest(new Error(`Windows process observer timed out after ${requestTimeoutMs}ms`));
    }, requestTimeoutMs);
    inflight = { resolve: resolveRequest, reject: rejectRequest, timer };
    active.stdin.write("sample\n", error => { if (error && inflight) discardChild(error); });
  });

  return {
    async sample() {
      try {
        return await retryObserver(async () => {
          try { return parseWindowsObserverLine(await request()); }
          catch (error) { discardChild(error); throw error; }
        }, attempts, { baseDelayMs });
      } catch (error) {
        const history = Array.isArray(error?.observerFailures) ? `; attempts: ${error.observerFailures.join(' | ')}` : '';
        return { rssBytes: null, cpuSeconds: null, error: (String(error?.message || error) + history).slice(0, 1000) };
      }
    },
    close() { closed = true; discardChild(new Error('Windows process observer closed')); }
  };
}

async function main() {
  const opts = argsOf(process.argv.slice(2));
  for (const key of ['desktop-executable', 'runtime-root', 'workspaces', 'manifest', 'contract', 'fixtures', 'tasks', 'signing-key', 'output', 'receipt', 'output-dir']) if (!opts[key]) throw new Error(`missing --${key}`);
  const durationHours = finite(opts['duration-hours'], 48), healthIntervalSeconds = finite(opts['health-interval-seconds'], 60), activeIntervalSeconds = finite(opts['active-interval-seconds'], 3600);
  if (!(durationHours >= 48) && opts['allow-short-smoke'] !== '1') throw new Error('a qualifying provider-backed soak must run for at least 48 hours');
  if (!(healthIntervalSeconds >= 10) || !(activeIntervalSeconds >= healthIntervalSeconds)) throw new Error('invalid soak sampling intervals');
  const output = resolve(opts.output), receiptPath = resolve(opts.receipt), outputDir = resolve(opts['output-dir']), manifestPath = resolve(opts.manifest);
  const manifest = validateManifest(json(manifestPath)), subject = manifest.subject, tasks = jsonl(opts.tasks), fixtures = jsonl(opts.fixtures), validation = validateParityFixtures(tasks, fixtures);
  if (!validation.ok) throw new Error('fixture pack invalid: ' + validation.errors.join('; '));
  const task = tasks.find(row => row.id === 'parity-code-inspect'), fixture = fixtures.find(row => row.taskId === task?.id);
  if (!task || !fixture) throw new Error('provider activity fixture is missing');
  mkdirSync(dirname(output), { recursive: true }); mkdirSync(outputDir, { recursive: true });
  const runtimePaths = subject.provenance?.runtime?.paths || ['frontend', 'sidecar', 'shared'];
  const initialRuntimeFingerprint = installedRuntimeFingerprint(opts['runtime-root'], runtimePaths);
  const executablePath = resolve(subject.executable.path), expectedExecutableSha256 = subject.executable.sha256;
  const desktopExecutable = resolve(opts['desktop-executable']);
  if (desktopExecutable !== executablePath) throw new Error('soak desktop executable does not match the candidate manifest path');
  const fixtureServer = await startFixtureMcpServer(); let driver = null, resourceObserver = null, interrupted = false;
  const startedAt = Date.now(), deadline = startedAt + durationHours * 3600000;
  const report = {
    schemaVersion: 'starnet.eval.installed-provider-soak.v1', mode: 'installed-provider-backed-active-idle', qualifyingDuration: durationHours >= 48, qualifiesRelease: false,
    startedAt: iso(startedAt), plannedEndAt: iso(deadline), durationHours, healthIntervalSeconds, activeIntervalSeconds,
    runtime: { root: resolve(opts['runtime-root']), workspace: resolve(opts.workspaces), port: null, describe: subject.provenance.describe,
      executable: executablePath, executableSha256: expectedExecutableSha256, rawHealthVersion: null, initialFingerprint: initialRuntimeFingerprint },
    samples: [], providerRuns: [], summary: { pass: false, completed: false, healthChecks: 0, healthFailures: 0, providerChecks: 0, providerFailures: 0, identityFailures: 0, observerFailures: 0, unexpectedExits: 0 }
  };
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    driver = await startStarNetDriver({ desktopExecutable, root: opts['runtime-root'], workspaces: opts.workspaces, fixtureUrl: fixtureServer.url, outputDir, timeoutMs: 300000 });
    if (process.platform === 'win32') resourceObserver = createWindowsProcessObserver(driver.process.pid);
    if (driver.identity.mode !== 'installed-desktop' || driver.identity.health?.status !== 'ok' || String(driver.identity.health?.version || '') !== String(subject.provenance.describe)) throw new Error('installed desktop soak health identity does not match the manifest');
    report.runtime.rawHealthVersion = String(driver.identity.health?.version || '');
    report.runtime.port = Number(new URL(driver.base).port);
    report.pid = driver.process.pid; let nextHealth = Date.now(), nextActive = Date.now(), activeAttempt = 0;
    while (!interrupted && Date.now() < deadline) {
      const clock = Date.now();
      if (clock >= nextActive) {
        activeAttempt++; const root = mkdtempSync(join(outputDir, `soak-provider-a${activeAttempt}-`)), state = fixtureServer.activate(fixture, root), began = Date.now();
        try {
          const row = await driver.run({ fixture, state, root, attempt: activeAttempt }), grade = gradeParityTrajectory(task, fixture, row, validation.fixtureSha256);
          const executableHashMatch = await retryObserver(async () => await hashFileStreamed(executablePath) === expectedExecutableSha256);
          const runtimeFingerprint = installedRuntimeFingerprint(opts['runtime-root'], runtimePaths);
          const runtimeFingerprintMatch = runtimeFingerprint.sha256 === initialRuntimeFingerprint.sha256 && runtimeFingerprint.files === initialRuntimeFingerprint.files;
          const ok = grade.passed && row.metrics.provider === 'openai-codex' && row.metrics.model === 'gpt-5.6-luna' && row.hostEvidence.fixtureCalls.length > 0 && executableHashMatch && runtimeFingerprintMatch;
          report.providerRuns.push({ at: iso(began), ok, runId: row.runId, totalMs: row.metrics.totalMs, firstOutputMs: row.metrics.firstOutputMs, model: row.metrics.model, provider: row.metrics.provider, fixtureCalls: row.hostEvidence.fixtureCalls.length, executableHashMatch, runtimeFingerprintMatch, runtimeFingerprint, finalTextSha256: createHash('sha256').update(row.finalText).digest('hex'), failedChecks: grade.checks.filter(check => !check.pass).map(check => check.id) });
          if (!executableHashMatch || !runtimeFingerprintMatch) report.summary.identityFailures++;
          report.summary.providerChecks++; if (!ok) report.summary.providerFailures++;
        } catch (error) {
          report.providerRuns.push({ at: iso(began), ok: false, error: String(error.message || error).slice(0, 1000) }); report.summary.providerChecks++; report.summary.providerFailures++;
        } finally { rmSync(root, { recursive: true, force: true }); }
        while (nextActive <= Date.now()) nextActive += activeIntervalSeconds * 1000;
      }
      if (Date.now() >= nextHealth) {
        const at = Date.now(); let healthOk = false, status = 0, version = '', error = '';
        let executableHashMatch = null;
        try { executableHashMatch = await retryObserver(async () => await hashFileStreamed(executablePath) === expectedExecutableSha256); } catch (caught) { error = String(caught.message || caught).slice(0, 240); }
        try { const response = await fetch(driver.base + '/health', { signal: AbortSignal.timeout(5000) }); status = response.status; const body = await response.json(); version = String(body.version || ''); healthOk = response.ok && body.status === 'ok' && version === String(subject.provenance.describe); }
        catch (caught) { error = String(caught.message || caught).slice(0, 240); }
        const exited = driver.process.exitCode != null;
        const stats = exited ? { rssBytes: null, cpuSeconds: null, error: 'installed desktop process exited' } : (resourceObserver ? await resourceObserver.sample() : { rssBytes: null, cpuSeconds: null });
        const observerOk = executableHashMatch !== null && (process.platform !== 'win32' || (stats.rssBytes > 0 && stats.cpuSeconds >= 0));
        const ok = healthOk && executableHashMatch === true;
        const observerError = [error, stats.error].filter(Boolean).join('; ').slice(0, 480);
        report.samples.push({ at: iso(at), ok, status, version, executableHashMatch, observerOk, rssBytes: stats.rssBytes, cpuSeconds: stats.cpuSeconds, exited, error: observerError });
        report.summary.healthChecks++; if (!ok) report.summary.healthFailures++; if (executableHashMatch === false) report.summary.identityFailures++; if (!observerOk) report.summary.observerFailures++; if (exited) { report.summary.unexpectedExits++; break; }
        while (nextHealth <= Date.now()) nextHealth += healthIntervalSeconds * 1000;
      }
      const rss = report.samples.map(row => row.rssBytes).filter(Number.isFinite);
      report.summary.rssBytes = rss.length ? { first: rss[0], last: rss.at(-1), min: Math.min(...rss), max: Math.max(...rss) } : null;
      report.updatedAt = iso(Date.now()); writeAtomic(output, report);
      const next = Math.min(nextHealth, nextActive, deadline); await sleep(Math.max(1, Math.min(1000, next - Date.now())));
    }
    report.endedAt = iso(Date.now()); report.interrupted = interrupted; report.summary.completed = !interrupted && Date.now() >= deadline;
    const healthMinimum = requiredSoakCoverage(durationHours, healthIntervalSeconds), activeMinimum = requiredSoakCoverage(durationHours, activeIntervalSeconds);
    const resourcesGood = process.platform !== 'win32' || report.samples.every(row => finite(row.rssBytes, 0) > 0 && finite(row.cpuSeconds, -1) >= 0);
    report.summary.required = { healthMinimum, activeMinimum };
    report.summary.pass = report.qualifyingDuration && report.summary.completed && report.samples.length >= healthMinimum && report.providerRuns.length >= activeMinimum && report.summary.healthFailures === 0 && report.summary.providerFailures === 0 && report.summary.identityFailures === 0 && report.summary.observerFailures === 0 && report.summary.unexpectedExits === 0 && resourcesGood;
    report.qualifiesRelease = report.summary.pass;
    writeAtomic(output, report);
    if (!report.summary.pass) throw new Error('installed provider-backed soak did not meet its qualifying gates');
    const result = { schemaVersion: 'starnet.eval.installed-provider-soak-verdict.v1', pass: true, qualifiesRelease: true, scope: report.mode, durationHours, samples: report.samples.length, providerRuns: report.providerRuns.length, summary: report.summary, resources: { rssBytes: report.summary.rssBytes } };
    let receipt = makeReceipt({ kind: 'installed-provider-soak', contract: json(opts.contract), subject, result,
      evidence: { path: output, bytes: statSync(output).size, sha256: await hashFileStreamed(output), manifestPath, manifestSha256: await hashFileStreamed(manifestPath), fixtureSetSha256: validation.fixtureSha256 } });
    receipt = signReceipt(receipt, opts['signing-key']); writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    console.log(`[agent-eval] INSTALLED PROVIDER SOAK PASS health=${report.samples.length} provider=${report.providerRuns.length} duration=${durationHours}h`);
    console.log(`[agent-eval] receipt ${receiptPath}`);
  } catch (error) {
    report.endedAt = report.endedAt || iso(Date.now()); report.interrupted = interrupted; report.error = String(error.stack || error).slice(0, 4000); writeAtomic(output, report); throw error;
  } finally { if (resourceObserver) resourceObserver.close(); if (driver) await driver.close(); await fixtureServer.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error('[agent-eval] installed provider soak failed:', error && error.message || error); process.exit(1); });
}
