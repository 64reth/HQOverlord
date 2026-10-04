#!/usr/bin/env node
// phase3-seal.mjs - bounded seal loop before Phase 4 planning.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedCommand } from './lib/run-command.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || 3) || 3) : 1;
const SKIP_PHASE4_BASELINE = /^(1|true|yes|on)$/i.test(String(process.env.STARNET_SKIP_PHASE4_BASELINE || '').trim());
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_PHASE3_SEAL_DIR || join(ROOT, '.dogfood', 'phase3-seal-' + STAMP));
const LATEST = join(ROOT, '.dogfood', 'phase3-seal-latest');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'BLOCKED';
}

async function commandStep(step, loop) {
  ensureDir(OUT);
  const logFile = join(OUT, 'loop' + loop + '-' + step.id + '.log');
  const result = await runBoundedCommand({
    cmd: step.cmd,
    args: step.args || [],
    cwd: ROOT,
    env: process.env,
    timeoutMs: step.timeoutMs || 900000,
    label: 'phase3-seal/' + step.id
  });
  writeFileSync(logFile, result.output);
  return {
    id: step.id,
    title: step.title,
    loop,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    logFile,
    reason: result.timedOut ? 'Timed out after ' + (step.timeoutMs || 900000) + 'ms.' : ''
  };
}

function proofLanguageStep(loop) {
  const file = join(ROOT, '.dogfood', 'phase3-latest', 'phase3-status.json');
  const json = readJson(file);
  const rows = json && Array.isArray(json.results) ? json.results : [];
  const browser = rows.find(r => r.id === '3.5-browser-automation');
  const computer = rows.find(r => r.id === '3.6-computer-use');
  const bad = [];
  if (!browser || browser.proofClass !== 'automated-contract') bad.push('3.5-browser-automation proofClass');
  if (!computer || computer.proofClass !== 'automated-contract') bad.push('3.6-computer-use proofClass');
  return {
    id: 'proof-language',
    title: 'Phase 3 browser/computer-use claims are automated-contract only',
    loop,
    status: bad.length ? 'fail' : 'pass',
    exitCode: null,
    timedOut: false,
    durationMs: 0,
    logFile: null,
    reason: bad.length ? 'Missing honest proof labels: ' + bad.join(', ') + '; see ' + file : 'Browser/computer-use are labeled automated-contract, not ref-proven.'
  };
}

function writeSummary(results, loopsRun) {
  const latest = results.filter(r => r.loop === loopsRun);
  const fail = latest.filter(r => r.status === 'fail').length;
  const pass = latest.filter(r => r.status === 'pass').length;
  const verdict = fail ? 'red' : 'green';
  const json = {
    generatedAt: new Date().toISOString(),
    verdict,
    loopsRun,
    counts: { pass, fail, blocked: 0, skipped: 0 },
    results: latest,
    history: results.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeFileSync(join(OUT, 'phase3-seal-status.json'), JSON.stringify(json, null, 2));

  let md = '# StarNet Phase 3 Seal Evidence\n\n';
  md += '- Generated: `' + json.generatedAt + '`\n';
  md += '- Verdict: `' + verdict + '`\n';
  md += '- Loops run: `' + loopsRun + '`\n\n';
  md += '| Status | Step | Notes |\n|---|---|---|\n';
  for (const r of latest) {
    const note = r.reason || (r.logFile ? 'log ' + r.logFile : 'ok');
    md += '| ' + statusIcon(r.status) + ' | `' + r.id + '` ' + mdEscape(r.title) + ' | ' + mdEscape(note) + ' |\n';
  }
  md += '\n## Seal Rule\n\n';
  md += 'This seal is green when Phase 1-3 gates are bounded, Phase 3 proof claims are honest, and Phase 4 baseline evidence is preserved. It does not require live provider, attended UI, or Cargo proof; those belong to Phase 4.\n';
  writeFileSync(join(OUT, 'summary.md'), md);

  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    try { copyFileSync(join(OUT, name), join(LATEST, name)); } catch (_) {}
  }
  return json;
}

function signature(results) {
  return results.map(r => r.id + ':' + r.status + ':' + (r.reason || '')).join('|');
}

async function runOnce(loop) {
  const steps = [
    { id: 'phase3-classifier', title: 'Phase 3 classifier completes without red failure', cmd: npmCmd, args: ['run', 'phase3'], timeoutMs: 1200000 },
    { id: 'timeout-wrapper', title: 'Timeout wrapper kills a hung test process', cmd: nodeCmd, args: ['test/timeout.test.js'], timeoutMs: 30000 },
    { id: 'diff-check', title: 'Git whitespace conflict check', cmd: 'git', args: ['diff', '--check'], timeoutMs: 30000 }
  ];
  if (!SKIP_PHASE4_BASELINE) {
    steps.push({ id: 'phase4-baseline', title: 'Preserve latest Phase 1-3 evidence for Phase 4', cmd: nodeCmd, args: ['scripts/preserve-phase4-baseline.mjs'], timeoutMs: 30000 });
  }
  const results = [];
  for (const step of steps) {
    console.log('[phase3-seal] loop ' + loop + ' ' + step.id + ' - ' + step.title);
    const r = await commandStep(step, loop);
    results.push(r);
    console.log('[phase3-seal]   ' + statusIcon(r.status) + (r.exitCode == null ? '' : ' exit=' + r.exitCode));
    if (r.status === 'fail') return results;
    if (step.id === 'phase3-classifier') {
      const proof = proofLanguageStep(loop);
      results.push(proof);
      console.log('[phase3-seal]   ' + statusIcon(proof.status) + ' proof-language');
      if (proof.status === 'fail') return results;
    }
  }
  return results;
}

let allResults = [];
let previous = '';
let loopsRun = 0;
for (let i = 1; i <= LOOP_MAX; i++) {
  const results = await runOnce(i);
  loopsRun = i;
  allResults = allResults.concat(results);
  const sig = signature(results);
  if (!results.some(r => r.status === 'fail')) break;
  if (previous && previous === sig) break;
  previous = sig;
}
const summary = writeSummary(allResults, loopsRun);
console.log('[phase3-seal] evidence: ' + OUT);
console.log('[phase3-seal] latest: ' + LATEST);
if (summary.verdict !== 'green') process.exit(1);
