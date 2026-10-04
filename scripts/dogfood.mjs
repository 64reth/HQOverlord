#!/usr/bin/env node
// dogfood.mjs - StarNet daily-driver evidence runner.
//
// This runner does not claim that headless tests equal a human UI dogfood pass.
// It gathers the cheap, repeatable proof for the Phase 3.1 pack and marks the
// live/UI portions blocked until the required external state exists.

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coerceTimeoutMs, runBoundedCommand } from './lib/run-command.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const WANT_LIVE = args.has('--live');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_DOGFOOD_DIR || join(ROOT, '.dogfood', 'dogfood-' + STAMP));
const LATEST = join(ROOT, '.dogfood', 'dogfood-latest');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;
const STEP_TIMEOUT_MS = coerceTimeoutMs(process.env.STARNET_DOGFOOD_STEP_TIMEOUT_MS || 900000);

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function hasEnvKey() {
  return !!String(process.env.SKYNET_OPENROUTER_KEY || process.env.STARNET_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY || '').trim();
}
function liveEnv() {
  const key = String(process.env.SKYNET_OPENROUTER_KEY || process.env.STARNET_OPENROUTER_KEY || process.env.OPENROUTER_API_KEY || '').trim();
  const env = Object.assign({}, process.env);
  if (key) {
    env.SKYNET_OPENROUTER_KEY = key;
    env.STARNET_OPENROUTER_KEY = key;
  }
  env.SKYNET_AUDIT_LIVE_PROVIDER = '1';
  return env;
}
function tail(s, n = 5000) {
  s = String(s || '');
  return s.length > n ? s.slice(s.length - n) : s;
}
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'blocked' ? 'BLOCKED' : 'SKIP';
}

async function runStep(step) {
  ensureDir(OUT);
  if (step.skip) {
    return Object.assign({}, step, {
      status: step.blocked ? 'blocked' : 'skip',
      exitCode: null,
      durationMs: 0,
      logFile: null,
      outputTail: step.reason || ''
    });
  }

  const logFile = join(OUT, step.id + '.log');
  const result = await runBoundedCommand({
    cmd: step.cmd,
    args: step.args || [],
    cwd: ROOT,
    env: step.env || process.env,
    timeoutMs: step.timeoutMs || STEP_TIMEOUT_MS,
    label: 'dogfood/' + step.id
  });
  writeFileSync(logFile, result.output);
  return Object.assign({}, step, {
    status: result.exitCode === 0 ? 'pass' : (step.allowFailure ? 'blocked' : 'fail'),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    logFile,
    outputTail: tail(result.output),
    reason: result.timedOut ? 'Timed out after ' + (step.timeoutMs || STEP_TIMEOUT_MS) + 'ms.' : step.reason
  });
}

function copyIfExists(src, destName) {
  try {
    if (!existsSync(src)) return;
    const dest = join(OUT, destName);
    ensureDir(dirname(dest));
    copyFileSync(src, dest);
  } catch (_) {}
}

function writeSummary(results) {
  const pass = results.filter(r => r.status === 'pass').length;
  const fail = results.filter(r => r.status === 'fail').length;
  const blocked = results.filter(r => r.status === 'blocked').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const json = {
    generatedAt: new Date().toISOString(),
    phase: '3.1-dogfood',
    outDir: OUT,
    verdict: fail ? 'red' : blocked ? 'blocked' : 'green',
    liveKeyPresent: hasEnvKey(),
    counts: { pass, fail, blocked, skipped },
    results: results.map(r => ({
      id: r.id,
      title: r.title,
      status: r.status,
      exitCode: r.exitCode,
      required: !!r.required,
      durationMs: r.durationMs,
      timedOut: !!r.timedOut,
      logFile: r.logFile,
      reason: (r.status === 'skip' || r.status === 'blocked' || r.status === 'fail') ? (r.reason || '') : '',
      class: r.class || ''
    }))
  };
  writeFileSync(join(OUT, 'dogfood-status.json'), JSON.stringify(json, null, 2));

  let md = '# StarNet Dogfood Evidence\n\n';
  md += '- Generated: `' + json.generatedAt + '`\n';
  md += '- Verdict: `' + json.verdict + '`\n';
  md += '- Live key present: `' + json.liveKeyPresent + '`\n\n';
  md += '| Status | Step | Required | Class | Notes |\n|---|---|---:|---|---|\n';
  for (const r of results) {
    const note = r.timedOut
      ? (r.reason || 'Timed out.')
      : (r.status === 'skip' || r.status === 'blocked')
      ? (r.reason || '')
      : (r.exitCode == null ? '' : 'exit ' + r.exitCode);
    md += '| ' + statusIcon(r.status) + ' | `' + r.id + '` ' + mdEscape(r.title) + ' | '
      + (r.required ? 'yes' : 'no') + ' | ' + mdEscape(r.class || '') + ' | ' + mdEscape(note) + ' |\n';
  }
  md += '\n## Logs\n\n';
  for (const r of results) if (r.logFile) md += '- `' + r.id + '`: `' + r.logFile + '`\n';
  md += '\n## Verdict Rule\n\n';
  md += 'This pack is green only when paid live provider proof and the attended UI dogfood proof are no longer blocked.\n';
  writeFileSync(join(OUT, 'summary.md'), md);

  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    try { copyFileSync(join(OUT, name), join(LATEST, name)); } catch (_) {}
  }
  return json;
}

async function main() {
  ensureDir(OUT);
  const noKeyReason = 'No live key found. Set SKYNET_OPENROUTER_KEY, STARNET_OPENROUTER_KEY, or OPENROUTER_API_KEY.';
  const steps = [
    {
      id: 'live-smoke',
      title: 'Paid provider smoke via /api/run',
      cmd: nodeCmd,
      args: ['test/live.smoke.js'],
      env: liveEnv(),
      required: true,
      skip: !hasEnvKey(),
      blocked: true,
      reason: noKeyReason,
      class: 'external-state'
    },
    {
      id: 'audit-live',
      title: 'Paid provider smoke through seeded UI audit',
      cmd: npmCmd,
      args: ['run', 'audit'],
      env: liveEnv(),
      required: true,
      skip: !hasEnvKey(),
      blocked: true,
      reason: noKeyReason,
      class: 'external-state'
    },
    {
      id: 'research-file-replay',
      title: 'Replay-backed research plus file deliverable proof',
      cmd: nodeCmd,
      args: ['test/harness.integration.test.js'],
      required: true,
      class: 'automated-proof'
    },
    {
      id: 'shell-exec-proof',
      title: 'Workbench shell execution proof',
      cmd: nodeCmd,
      args: ['test/shell.test.js'],
      required: true,
      class: 'automated-proof'
    },
    {
      id: 'verify-proof',
      title: 'Workbench verify command proof',
      cmd: nodeCmd,
      args: ['test/verify.run.test.js'],
      required: true,
      class: 'automated-proof'
    },
    {
      id: 'cancel-proof',
      title: 'Cancellation and halt proof',
      cmd: nodeCmd,
      args: ['test/halt.test.js'],
      required: true,
      class: 'automated-proof'
    },
    {
      id: 'budget-proof',
      title: 'Tiny budget stop proof',
      cmd: nodeCmd,
      args: ['test/budget.test.js'],
      required: true,
      class: 'automated-proof'
    },
    {
      id: 'restart-resume-proof',
      title: 'Run/transcript/ledger persistence proof',
      cmd: npmCmd,
      args: ['run', 'test:fast'],
      required: true,
      class: 'automated-proof'
    },
    {
      id: 'manual-ui-dogfood',
      title: 'Attended gamified UI dogfood pack',
      required: true,
      skip: true,
      blocked: true,
      reason: 'Needs an attended browser/desktop session with screenshots, run ids, transcript ids, artifact paths, and ledger rows from docs/STARNET_DOGFOOD_TASK_PACK.md.',
      class: 'attended-proof'
    },
    {
      id: 'repeat-after-restart',
      title: 'Fresh plus restarted repeat pass',
      required: true,
      skip: true,
      blocked: true,
      reason: 'Needs two complete dogfood passes: one fresh seeded workspace and one after sidecar restart.',
      class: 'attended-proof'
    }
  ];

  if (!WANT_LIVE) {
    // Live proof is still required for the verdict. WANT_LIVE only controls exit code.
  }

  const results = [];
  for (const step of steps) {
    console.log('[dogfood] ' + step.id + ' - ' + step.title);
    const r = await runStep(step);
    results.push(r);
    console.log('[dogfood]   ' + statusIcon(r.status) + (r.exitCode == null ? '' : ' exit=' + r.exitCode));
    if (r.status === 'fail' && r.required) break;
    if (r.id === 'audit-live') copyIfExists(join(ROOT, '.uiaudit', 'audit-report.json'), 'audit/live-audit-report.json');
  }

  const summary = writeSummary(results);
  console.log('[dogfood] evidence: ' + OUT);
  console.log('[dogfood] latest: ' + LATEST);
  if (summary.verdict === 'red') process.exit(1);
  if (WANT_LIVE && results.some(r => r.required && r.status === 'blocked' && r.class === 'external-state')) process.exit(2);
}

main().catch(e => { console.error('[dogfood] FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
