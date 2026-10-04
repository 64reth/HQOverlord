#!/usr/bin/env node
import { createWriteStream, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1];
  return out;
}
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const iso = ms => new Date(ms).toISOString();
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function writeAtomic(file, value) {
  const target = resolve(file), temp = target + '.tmp';
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temp, target);
}

function processStats(pid) {
  if (process.platform !== 'win32') return { rssBytes: null, cpuSeconds: null };
  try {
    const script = `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write($p.WorkingSet64.ToString()+'|'+$p.CPU.ToString([Globalization.CultureInfo]::InvariantCulture))`;
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim().split('|');
    return { rssBytes: finite(raw[0], null), cpuSeconds: finite(raw[1], null) };
  } catch (_) { return { rssBytes: null, cpuSeconds: null }; }
}

async function waitHealth(base, child, timeoutMs) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (child.exitCode != null) throw new Error('candidate sidecar exited before health: ' + child.exitCode);
    try {
      const response = await fetch(base + '/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) return { bootMs: performance.now() - started, body: await response.json() };
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('candidate sidecar health timeout');
}

async function main() {
  const opts = argsOf(process.argv.slice(2));
  for (const key of ['runtime-root', 'node', 'workspace', 'output', 'describe']) if (!opts[key]) throw new Error('missing --' + key);
  const durationHours = Math.max(0.001, finite(opts['duration-hours'], 48));
  const intervalSeconds = Math.max(1, finite(opts['interval-seconds'], 60));
  const port = Math.max(1024, Math.floor(finite(opts.port, 19109)));
  const runtimeRoot = resolve(opts['runtime-root']), node = resolve(opts.node), workspace = resolve(opts.workspace), output = resolve(opts.output);
  mkdirSync(workspace, { recursive: true }); mkdirSync(dirname(output), { recursive: true });
  const stdoutFile = output.replace(/\.json$/i, '') + '.out.log', stderrFile = output.replace(/\.json$/i, '') + '.err.log';
  const out = createWriteStream(stdoutFile, { flags: 'a' }), err = createWriteStream(stderrFile, { flags: 'a' });
  const startedAt = Date.now(), deadline = startedAt + durationHours * 60 * 60 * 1000, base = `http://127.0.0.1:${port}`;
  const child = spawn(node, ['sidecar/index.js'], {
    cwd: runtimeRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      STARNET_WORKSPACES: workspace, STARNET_PORT: String(port), STARNET_BUILD_DESCRIBE: String(opts.describe),
      STARNET_DEFAULT_MODEL: 'fixture/offline', STARNET_CRON_ARMED: '0', SKYNET_CRON_ARMED: '0'
    })
  });
  child.stdout.pipe(out); child.stderr.pipe(err);
  const report = {
    schemaVersion: 'starnet.eval.soak.v1', mode: 'provider-free-control-plane', qualifiesRelease: false,
    startedAt: iso(startedAt), plannedEndAt: iso(deadline), durationHours, intervalSeconds, pid: child.pid,
    runtime: { root: runtimeRoot, node, workspace, describe: String(opts.describe), port },
    samples: [], summary: { pass: false, completed: false, healthChecks: 0, healthFailures: 0, unexpectedExits: 0 },
    limitations: ['No provider credential or model run is used.', 'This control-plane soak does not replace the post-parity installed active/idle 48-hour release soak.']
  };
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    const boot = await waitHealth(base, child, 30000);
    report.boot = { ms: Math.round(boot.bootMs * 1000) / 1000, status: boot.body.status || '', version: boot.body.version || '' };
    if (report.boot.version !== String(opts.describe)) throw new Error('health version mismatch: ' + report.boot.version);
    let firstSample = true;
    while (!interrupted && (firstSample || Date.now() < deadline)) {
      firstSample = false;
      const at = Date.now(); let ok = false, status = 0, version = '', error = '';
      try {
        const response = await fetch(base + '/health', { signal: AbortSignal.timeout(5000) });
        status = response.status; const body = await response.json(); version = String(body.version || '');
        ok = response.ok && body.status === 'ok' && version === String(opts.describe);
      } catch (e) { error = String(e && e.message || e).slice(0, 240); }
      const stats = processStats(child.pid), exited = child.exitCode != null;
      report.samples.push({ at: iso(at), ok, status, version, rssBytes: stats.rssBytes, cpuSeconds: stats.cpuSeconds, exited, error });
      report.summary.healthChecks++;
      if (!ok) report.summary.healthFailures++;
      if (exited) { report.summary.unexpectedExits++; break; }
      const rss = report.samples.map(sample => sample.rssBytes).filter(Number.isFinite);
      report.summary.rssBytes = rss.length ? { first: rss[0], last: rss[rss.length - 1], min: Math.min(...rss), max: Math.max(...rss) } : null;
      report.updatedAt = iso(Date.now()); writeAtomic(output, report);
      await sleep(Math.min(intervalSeconds * 1000, Math.max(1, deadline - Date.now())));
    }
    report.endedAt = iso(Date.now()); report.summary.completed = !interrupted && Date.now() >= deadline;
    report.summary.pass = report.summary.completed && report.summary.healthChecks > 0 && report.summary.healthFailures === 0 && report.summary.unexpectedExits === 0;
    report.interrupted = interrupted; writeAtomic(output, report);
  } catch (e) {
    report.endedAt = iso(Date.now()); report.error = String(e && e.stack || e).slice(0, 4000); writeAtomic(output, report);
    throw e;
  } finally {
    try { child.kill(); } catch (_) {}
    await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), sleep(3000)]);
    out.end(); err.end();
  }
  console.log(`[agent-eval] SOAK ${report.summary.pass ? 'PASS' : (interrupted ? 'INTERRUPTED' : 'FAIL')} checks=${report.summary.healthChecks} failures=${report.summary.healthFailures}`);
  console.log('[agent-eval] soak ' + output);
  process.exitCode = report.summary.pass ? 0 : 1;
}

main().catch(error => { console.error('[agent-eval] soak failed:', error && error.message || error); process.exit(1); });
