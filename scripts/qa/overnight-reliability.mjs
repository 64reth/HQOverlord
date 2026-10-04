#!/usr/bin/env node
// Repeated loopback fault-injection campaign for unattended reliability evidence.
// Example: node scripts/qa/overnight-reliability.mjs --duration-hours 8 --cycle-minutes 30 --output .dogfood/overnight-reliability/overnight-8h/report.json
// This intentionally uses synthetic providers and never qualifies as the installed 48-hour release soak.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA = 'starnet.qa.overnight-reliability.v1';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const iso = ms => new Date(ms).toISOString();

export const PROBES = Object.freeze([
  { id: 'completion-authority', files: ['test/completion-evidence.test.js', 'test/task-postconditions.test.js', 'test/task-postconditions-ui.test.js', 'test/run-execution-state.test.js', 'test/runstore.test.js'] },
  { id: 'interrupted-run-recovery', files: ['test/run-journal-disk-boundary.test.js', 'test/run-recovery.api.test.js', 'test/run-recovery-ui.test.js', 'test/recovery-policy.test.js', 'test/tool-recovery.test.js'] },
  { id: 'execution-context-continuity', files: ['test/project-root.e2e.test.js', 'test/shell-session.test.js', 'test/acp.e2e.test.js'] },
  { id: 'failure-route-exhaustion', files: ['test/loop.failure-recovery.test.js', 'test/loop.verify-on-stop.test.js', 'test/loop.replay.test.js', 'test/tool-model-fallback.e2e.test.js'] },
  { id: 'oauth-refresh', files: ['test/mcp.oauth.test.js', 'test/provider.oauth-device.test.js', 'test/spotify.store.test.js', 'test/oauth-status.e2e.test.js'] },
  { id: 'rate-limit-failover', files: ['test/ratelimits.test.js', 'test/provider-recovery.e2e.test.js'] },
  { id: 'scheduled-continuation', files: ['test/cron.session-transcript.e2e.test.js', 'test/run-recovery-continuation.test.js'] },
  { id: 'restart-persistence', files: ['test/output-recovery.e2e.test.js', 'test/mcp.orphan-recovery.test.js'] },
  { id: 'duplicate-delivery', files: ['test/channels.outbox.test.js', 'test/webhook-replay.e2e.test.js'] },
  { id: 'partial-platform-outage', files: ['test/e2e.mcp-connector.test.js', 'test/loop.provider-recovery.test.js'] }
]);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i] || '');
    if (!raw.startsWith('--')) throw new Error('unexpected argument: ' + raw);
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next != null && !String(next).startsWith('--')) { out[key] = String(next); i++; }
    else out[key] = '1';
  }
  return out;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function git(...args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + String(result.stderr || '').trim());
  return String(result.stdout || '').trim();
}

export function sourceIdentity() {
  return {
    root: ROOT,
    commit: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    dirty: Boolean(git('status', '--porcelain'))
  };
}

function writeAtomic(file, value) {
  const target = resolve(file), temp = target + '.tmp';
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temp, target);
}

function safeEnvironment(cycle, probeId) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/(?:^|_)(?:API_?)?KEY$|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL/i.test(key)) continue;
    env[key] = value;
  }
  env.STARNET_SOAK_CYCLE = String(cycle);
  env.STARNET_SOAK_PROBE = probeId;
  env.SKYNET_CRON_ARMED = '0';
  env.STARNET_CRON_ARMED = '0';
  return env;
}

function redact(text) {
  return String(text || '')
    .replace(/(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{16,}/gi, 'Bearer [REDACTED]')
    .replace(/(?:access|refresh)[_-]?token["'\s:=]+[A-Za-z0-9._~+\/-]{12,}/gi, match => match.replace(/[A-Za-z0-9._~+\/-]{12,}$/, '[REDACTED]'));
}

async function terminateTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
  await Promise.race([new Promise(done => child.once('exit', done)), sleep(2000)]);
}

export function runFile(file, options = {}) {
  const timeoutMs = Math.max(1000, finite(options.timeoutMs, 180000));
  const absolute = resolve(ROOT, file);
  return new Promise((done) => {
    const began = Date.now();
    const child = spawn(process.execPath, [absolute], {
      cwd: ROOT,
      env: safeEnvironment(options.cycle || 0, options.probeId || ''),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '', stderr = '', timedOut = false, settled = false, timer = null;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const finish = (code, signal) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      const ended = Date.now();
      const cleanOut = redact(stdout), cleanErr = redact(stderr);
      done({
        file: relative(ROOT, absolute).replace(/\\/g, '/'),
        startedAt: iso(began), endedAt: iso(ended), durationMs: ended - began,
        ok: !timedOut && code === 0, exitCode: code, signal: signal || '', timedOut,
        outputSha256: createHash('sha256').update(cleanOut + '\n' + cleanErr).digest('hex'),
        stdout: cleanOut.slice(-12000), stderr: cleanErr.slice(-12000)
      });
    };
    timer = setTimeout(async () => {
      timedOut = true;
      await terminateTree(child);
      finish(child.exitCode, child.signalCode || 'timeout');
    }, timeoutMs);
    child.on('error', error => { stderr += '\n' + String(error && error.stack || error); finish(null, 'spawn-error'); });
    child.on('close', finish);
  });
}

export function summarize(report, now = Date.now()) {
  const cycles = Array.isArray(report.cycles) ? report.cycles : [];
  const completedCycles = cycles.filter(cycle => Boolean(cycle.endedAt));
  const rows = cycles.flatMap(cycle => cycle.probes || []).flatMap(probe => probe.runs || []);
  const failed = rows.filter(row => !row.ok);
  const coverage = Array.isArray(report.coverage) ? report.coverage : [];
  const coverageViolations = [];
  if (coverage.length > 0) {
    for (const cycle of cycles) {
      for (const expected of coverage) {
        const probes = (cycle.probes || []).filter(probe => probe.id === expected.id);
        if (probes.length !== 1) {
          coverageViolations.push({ cycle: cycle.number, probe: expected.id, reason: probes.length === 0 ? 'missing-probe' : 'duplicate-probe' });
          continue;
        }
        const actualFiles = (probes[0].runs || []).map(run => run.file);
        for (const file of expected.files || []) {
          const count = actualFiles.filter(actual => actual === file).length;
          if (count !== 1) coverageViolations.push({ cycle: cycle.number, probe: expected.id, file, reason: count === 0 ? 'missing-run' : 'duplicate-run' });
        }
        for (const file of actualFiles) {
          if (!(expected.files || []).includes(file)) coverageViolations.push({ cycle: cycle.number, probe: expected.id, file, reason: 'unexpected-run' });
        }
      }
    }
  }
  const plannedEnd = Date.parse(report.plannedEndAt);
  const completed = report.once === true ? completedCycles.length >= 1 : Number.isFinite(plannedEnd) && now >= plannedEnd;
  return {
    completed,
    pass: completed && failed.length === 0 && coverageViolations.length === 0 && completedCycles.length >= Number(report.requiredCycles || 1),
    cycles: completedCycles.length,
    attemptedCycles: cycles.length,
    requiredCycles: Number(report.requiredCycles || 1),
    probeRuns: rows.length,
    expectedProbeRuns: cycles.length * coverage.reduce((sum, probe) => sum + (probe.files || []).length, 0),
    coverageViolations: coverageViolations.length,
    coverageViolationDetails: coverageViolations,
    failures: failed.length,
    failed: failed.map(row => ({ file: row.file, cycle: row.cycle, exitCode: row.exitCode, timedOut: row.timedOut }))
  };
}

async function runCycle(report, output, evidenceDir, timeoutMs) {
  let cycle = report.cycles[report.cycles.length - 1];
  if (!cycle || cycle.endedAt) {
    cycle = { number: report.cycles.length + 1, startedAt: iso(Date.now()), probes: [], ok: false };
    report.cycles.push(cycle);
  } else {
    cycle.resumedAt = [...(cycle.resumedAt || []), iso(Date.now())];
  }
  const cycleNumber = cycle.number;
  writeAtomic(output, report);
  const cycleDir = join(evidenceDir, 'cycle-' + String(cycleNumber).padStart(4, '0'));
  mkdirSync(cycleDir, { recursive: true });
  console.log(`[overnight] cycle ${cycleNumber} started`);
  for (const probe of PROBES) {
    let row = cycle.probes.find(candidate => candidate.id === probe.id);
    if (!row) {
      row = { id: probe.id, startedAt: iso(Date.now()), runs: [], ok: false };
      cycle.probes.push(row);
    }
    writeAtomic(output, report);
    for (const file of probe.files) {
      if (row.runs.some(run => run.file === file)) continue;
      const result = await runFile(file, { timeoutMs, cycle: cycleNumber, probeId: probe.id });
      result.cycle = cycleNumber;
      row.runs.push(result);
      const log = [result.stdout, result.stderr].filter(Boolean).join('\n');
      writeFileSync(join(cycleDir, file.replace(/^test\//, '').replace(/[^A-Za-z0-9_.-]+/g, '_') + '.log'), log + '\n', 'utf8');
      console.log(`[overnight] cycle ${cycleNumber} ${result.ok ? 'PASS' : 'FAIL'} ${file} (${result.durationMs}ms)`);
      report.updatedAt = iso(Date.now()); report.summary = summarize(report); writeAtomic(output, report);
    }
    row.endedAt = iso(Date.now()); row.ok = row.runs.every(run => run.ok); writeAtomic(output, report);
  }
  cycle.endedAt = iso(Date.now()); cycle.ok = cycle.probes.every(probe => probe.ok);
  report.summary = summarize(report); writeAtomic(output, report);
  console.log(`[overnight] cycle ${cycleNumber} ${cycle.ok ? 'GREEN' : 'RED'}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const once = opts.once === '1';
  const durationHours = Math.max(0.01, finite(opts['duration-hours'], 8));
  const cycleMinutes = Math.max(0.1, finite(opts['cycle-minutes'], 30));
  const timeoutMs = Math.max(1000, finite(opts['probe-timeout-seconds'], 180) * 1000);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = resolve(ROOT, opts.output || join('.dogfood', 'overnight-reliability', stamp, 'report.json'));
  const evidenceDir = resolve(opts['evidence-dir'] || dirname(output));
  const resume = opts.resume === '1';
  if (existsSync(output) && !resume) throw new Error('output already exists; pass --resume to continue it');

  let report;
  if (resume) {
    if (!existsSync(output)) throw new Error('--resume output does not exist: ' + output);
    report = JSON.parse(readFileSync(output, 'utf8').replace(/^\uFEFF/, ''));
    if (report.schemaVersion !== SCHEMA) throw new Error('cannot resume an unknown report schema');
    const current = sourceIdentity();
    if (current.commit !== report.source.commit || current.dirty) throw new Error('resume requires the original commit and a clean worktree');
    report.resumedAt = [...(report.resumedAt || []), iso(Date.now())];
  } else {
    const source = sourceIdentity();
    if (source.dirty && opts['allow-dirty'] !== '1') throw new Error('overnight evidence requires a clean worktree (or explicit --allow-dirty 1 for a non-candidate smoke)');
    const started = Date.now(), cycleMs = cycleMinutes * 60000;
    report = {
      schemaVersion: SCHEMA,
      mode: 'loopback-fault-injection',
      qualifiesRelease: false,
      startedAt: iso(started),
      plannedEndAt: iso(once ? started : started + durationHours * 3600000),
      durationHours: once ? 0 : durationHours,
      cycleMinutes,
      once,
      requiredCycles: once ? 1 : Math.max(1, Math.ceil(durationHours * 60 / cycleMinutes)),
      source,
      runner: { pid: process.pid, node: process.execPath },
      safety: { externalProviders: false, providerSpend: false, thirdPartyMutation: false, inheritedSecretsRemoved: true },
      qualityGates: {
        requiredInvariants: ['no-silent-stop', 'no-false-completion', 'no-duplicate-effect', 'durable-restart', 'actionable-terminal-state'],
        evidenceModel: 'deterministic-test-probes'
      },
      coverage: PROBES.map(probe => ({ id: probe.id, files: probe.files.slice() })),
      cycles: [],
      summary: { completed: false, pass: false, cycles: 0, requiredCycles: once ? 1 : Math.max(1, Math.ceil(durationHours * 60 / cycleMinutes)), probeRuns: 0, expectedProbeRuns: 0, coverageViolations: 0, coverageViolationDetails: [], failures: 0, failed: [] }
    };
  }

  mkdirSync(evidenceDir, { recursive: true }); writeAtomic(output, report);
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const plannedEnd = Date.parse(report.plannedEndAt), cycleMs = report.cycleMinutes * 60000;
  const hasIncompleteCycle = () => Boolean(report.cycles.length && !report.cycles[report.cycles.length - 1].endedAt);
  while (!interrupted && (report.once ? report.cycles.length === 0 || hasIncompleteCycle() : Date.now() < plannedEnd || hasIncompleteCycle())) {
    await runCycle(report, output, evidenceDir, timeoutMs);
    if (report.once) break;
    const completedCycles = report.cycles.filter(cycle => cycle.endedAt).length;
    const nextDue = Date.parse(report.startedAt) + completedCycles * cycleMs;
    report.nextCycleAt = iso(Math.min(nextDue, plannedEnd));
    let nextHeartbeat = Date.now();
    while (!interrupted && Date.now() < Math.min(nextDue, plannedEnd)) {
      if (Date.now() >= nextHeartbeat) {
        report.heartbeatAt = iso(Date.now()); report.updatedAt = report.heartbeatAt;
        report.runner = { pid: process.pid, node: process.execPath, rssBytes: process.memoryUsage().rss };
        writeAtomic(output, report); nextHeartbeat = Date.now() + 60000;
      }
      await sleep(Math.min(1000, Math.max(1, nextDue - Date.now())));
    }
  }
  report.endedAt = iso(Date.now()); report.interrupted = interrupted; report.nextCycleAt = null;
  report.summary = summarize(report);
  if (interrupted) report.summary.pass = false;
  writeAtomic(output, report);
  console.log(`[overnight] ${report.summary.pass ? 'PASS' : (interrupted ? 'INTERRUPTED' : 'FAIL')} cycles=${report.summary.cycles}/${report.summary.requiredCycles} probes=${report.summary.probeRuns} failures=${report.summary.failures}`);
  console.log('[overnight] report ' + output);
  process.exitCode = report.summary.pass ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error('[overnight] failed:', error && error.stack || error); process.exit(1); });
}
