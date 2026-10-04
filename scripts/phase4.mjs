#!/usr/bin/env node
// phase4.mjs - StarNet the reference harness cutover qualification loop.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coerceTimeoutMs, runBoundedCommand } from './lib/run-command.mjs';
import { hasLiveProviderKey, liveProviderEnv, withoutLiveProviderEnv } from './lib/provider-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_PHASE4_LOOPS || 3) || 3) : 1;
const WANT_LIVE = argSet.has('--live');
const REQUIRE_GREEN = argSet.has('--require-green');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_PHASE4_DIR || join(ROOT, '.dogfood', 'phase4-' + STAMP));
const LATEST = join(ROOT, '.dogfood', 'phase4-latest');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;
const STEP_TIMEOUT_MS = coerceTimeoutMs(process.env.STARNET_PHASE4_STEP_TIMEOUT_MS || 1200000);

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'blocked' ? 'BLOCKED' : 'SKIP';
}
function hasLiveKey() {
  return hasLiveProviderKey();
}
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function evidencePath(name) {
  return join(ROOT, '.dogfood', name);
}
function copyLatest() {
  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    try { copyFileSync(join(OUT, name), join(LATEST, name)); } catch (_) {}
  }
}

async function commandStep(step, loop) {
  ensureDir(OUT);
  if (step.skip) {
    return Object.assign({}, step, {
      loop,
      status: step.blocked ? 'blocked' : 'skip',
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      logFile: null,
      reason: step.reason || ''
    });
  }
  const logFile = join(OUT, 'loop' + loop + '-' + step.id + '.log');
  const result = await runBoundedCommand({
    cmd: step.cmd,
    args: step.args || [],
    cwd: ROOT,
    env: step.env || process.env,
    timeoutMs: step.timeoutMs || STEP_TIMEOUT_MS,
    label: 'phase4/' + step.id
  });
  writeFileSync(logFile, result.output);
  return Object.assign({}, step, {
    loop,
    status: result.exitCode === 0 ? 'pass' : (step.allowFailure ? 'blocked' : 'fail'),
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    logFile,
    reason: result.timedOut ? 'Timed out after ' + (step.timeoutMs || STEP_TIMEOUT_MS) + 'ms.' : ''
  });
}

function checkRefBaseline(loop) {
  const file = join(ROOT, 'docs', 'STARNET_PHASE4_REF_BASELINE.md');
  const text = readText(file);
  const required = ['real paid model call', 'task loop', 'file deliverables', 'shell', 'restart', 'spend', 'cancellation'];
  const missing = required.filter(term => text.toLowerCase().indexOf(term) < 0);
  return {
    id: '4.1-ref-baseline',
    phase: '4.1',
    title: 'the reference harness replacement baseline is explicit',
    loop,
    status: existsSync(file) && !missing.length ? 'pass' : 'fail',
    required: true,
    class: 'baseline-contract',
    evidenceFile: file,
    reason: missing.length ? 'Baseline is missing expected terms: ' + missing.join(', ') : 'Baseline contract exists.'
  };
}

function dogfoodAutomatedHealth() {
  const file = evidencePath('dogfood-latest/dogfood-status.json');
  const json = readJson(file);
  if (!json) return { status: 'fail', reason: 'Missing dogfood evidence; expected ' + file, file };
  const automatedBad = (json.results || []).filter(r => r.class === 'automated-proof' && r.required && r.status !== 'pass');
  if (automatedBad.length) return { status: 'fail', reason: 'Automated dogfood proof failed: ' + automatedBad[0].id, file };
  return { status: 'pass', reason: 'Automated dogfood proofs are green.', file };
}

function attendedEvidence() {
  return readJson(evidencePath('phase4-attended-evidence.json'));
}

function checkSameWorkTrial(loop) {
  const health = dogfoodAutomatedHealth();
  if (health.status !== 'pass') {
    return {
      id: '4.2-starnet-same-work-trial',
      phase: '4.2',
      title: 'StarNet same-work trial through gamified UI',
      loop,
      status: 'fail',
      required: true,
      class: 'attended-cutover',
      evidenceFile: health.file,
      reason: health.reason
    };
  }
  const evFile = evidencePath('phase4-attended-evidence.json');
  const ev = attendedEvidence();
  const trial = ev && ev.sameWorkTrial;
  const enoughEvidence = trial && trial.passed
    && Array.isArray(trial.screenshots) && trial.screenshots.length
    && Array.isArray(trial.runIds) && trial.runIds.length
    && Array.isArray(trial.transcriptIds) && trial.transcriptIds.length
    && Array.isArray(trial.artifactPaths) && trial.artifactPaths.length
    && Array.isArray(trial.ledgerRows) && trial.ledgerRows.length;
  return {
    id: '4.2-starnet-same-work-trial',
    phase: '4.2',
    title: 'StarNet same-work trial through gamified UI',
    loop,
    status: enoughEvidence ? 'pass' : 'blocked',
    required: true,
    class: 'attended-cutover',
    evidenceFile: evFile,
    reason: enoughEvidence
      ? 'Attended same-work UI evidence is present.'
      : 'Needs .dogfood/phase4-attended-evidence.json with sameWorkTrial.passed plus screenshots, run ids, transcript ids, artifacts, and ledger rows.'
  };
}

function checkTwoPassSoak(loop) {
  const evFile = evidencePath('phase4-attended-evidence.json');
  const ev = attendedEvidence();
  const soak = ev && ev.soak;
  const ok = soak && soak.freshPass && soak.restartPass && soak.transcriptPreserved
    && soak.ledgerPreserved && soak.artifactsPreserved && soak.memoryPreserved && soak.stationStatePreserved;
  return {
    id: '4.4-two-pass-soak',
    phase: '4.4',
    title: 'Fresh plus restart soak preserves provenance',
    loop,
    status: ok ? 'pass' : 'blocked',
    required: true,
    class: 'attended-soak',
    evidenceFile: evFile,
    reason: ok
      ? 'Fresh and restart pass evidence is present.'
      : 'Needs attended evidence for fresh pass, restart pass, transcript, ledger, artifacts, memory, and station state preservation.'
  };
}

function checkFailureRecoveryAttended(loop) {
  const evFile = evidencePath('phase4-attended-evidence.json');
  const ev = attendedEvidence();
  const fr = ev && ev.failureRecovery;
  const ok = fr && fr.cancelPassed && fr.budgetPassed && fr.deniedConsentPassed && fr.toolErrorPassed && fr.checkpointRestorePassed;
  return {
    id: '4.5-failure-recovery-attended',
    phase: '4.5',
    title: 'Failure/recovery paths are proven and recorded',
    loop,
    status: ok ? 'pass' : 'blocked',
    required: true,
    class: 'recovery-evidence',
    evidenceFile: evFile,
    reason: ok
      ? 'Failure/recovery evidence is present from the recovery proof suite.'
      : 'Needs recovery evidence for cancel, budget, denied consent, tool error, and checkpoint/restore.'
  };
}

function checkDecision(loop, priorResults) {
  const file = evidencePath('phase4-decision.json');
  const decision = readJson(file);
  const allowed = new Set(['ready-to-replace', 'limited-pilot', 'blocked', 'not-ready']);
  const priorBad = priorResults.filter(r => r.required && r.status !== 'pass');
  if (priorBad.length) {
    return {
      id: '4.6-pilot-decision',
      phase: '4.6',
      title: 'Final the reference harness replacement go/no-go decision',
      loop,
      status: 'blocked',
      required: true,
      class: 'decision',
      evidenceFile: file,
      reason: 'Decision waits for prior P4 gates; first non-pass is ' + priorBad[0].id + '.'
    };
  }
  const ok = decision && allowed.has(decision.decision) && decision.acceptedBy && decision.acceptedAt && decision.notes;
  return {
    id: '4.6-pilot-decision',
    phase: '4.6',
    title: 'Final the reference harness replacement go/no-go decision',
    loop,
    status: ok ? 'pass' : 'blocked',
    required: true,
    class: 'decision',
    evidenceFile: file,
    reason: ok ? 'Final decision recorded: ' + decision.decision + '.' : 'Needs .dogfood/phase4-decision.json with decision, acceptedBy, acceptedAt, and notes.'
  };
}

function liveCommands() {
  if (!hasLiveKey()) {
    return [{
      id: '4.3-live-provider-proof',
      phase: '4.3',
      title: 'Paid live provider smoke and live audit',
      skip: true,
      blocked: true,
      required: true,
      class: 'live-provider',
      reason: 'No live key found. Set SKYNET_OPENROUTER_KEY, STARNET_OPENROUTER_KEY, or OPENROUTER_API_KEY.'
    }];
  }
  return [
    {
      id: '4.3-live-smoke',
      phase: '4.3',
      title: 'Paid live provider smoke via /api/run',
      cmd: nodeCmd,
      args: ['test/live.smoke.js'],
      env: liveProviderEnv(),
      required: true,
      class: 'live-provider',
      timeoutMs: 600000
    },
    {
      id: '4.3-live-audit',
      phase: '4.3',
      title: 'Live provider UI audit with real model/spend telemetry',
      cmd: npmCmd,
      args: ['run', 'audit'],
      env: liveProviderEnv(),
      required: true,
      class: 'live-provider',
      timeoutMs: 600000
    }
  ];
}

async function runOnce(loop) {
  const results = [];
  const nonLiveEnv = withoutLiveProviderEnv({ STARNET_SKIP_PHASE4_BASELINE: '1' });

  const seal = await commandStep({
    id: '4.0-phase3-seal',
    phase: '4.0',
    title: 'Phase 1-3 seal remains green',
    cmd: npmCmd,
    args: ['run', 'phase3:seal'],
    env: nonLiveEnv,
    required: true,
    class: 'entry-gate',
    timeoutMs: 1200000
  }, loop);
  results.push(seal);
  if (seal.status === 'fail') return results;

  results.push(checkRefBaseline(loop));
  if (results.some(r => r.status === 'fail')) return results;

  const dogfood = await commandStep({
    id: '4.2-automated-dogfood-support',
    phase: '4.2',
    title: 'Automated same-work support proofs remain green',
    cmd: npmCmd,
    args: ['run', 'dogfood'],
    env: withoutLiveProviderEnv(),
    required: true,
    class: 'automated-proof',
    timeoutMs: 1200000
  }, loop);
  results.push(dogfood);
  if (dogfood.status === 'fail') return results;
  results.push(checkSameWorkTrial(loop));

  for (const live of liveCommands()) {
    const r = await commandStep(live, loop);
    results.push(r);
    if (r.status === 'fail') return results;
  }

  results.push(checkTwoPassSoak(loop));

  const recovery = await commandStep({
    id: '4.5-failure-recovery-automated',
    phase: '4.5',
    title: 'Automated failure/recovery safety suite',
    cmd: nodeCmd,
    args: ['scripts/phase4-recovery-proof.mjs'],
    env: withoutLiveProviderEnv(),
    required: true,
    class: 'automated-recovery',
    timeoutMs: 300000
  }, loop);
  results.push(recovery);
  if (recovery.status === 'fail') return results;
  results.push(checkFailureRecoveryAttended(loop));
  results.push(checkDecision(loop, results));
  return results;
}

function writeSummary(allResults, loopsRun) {
  const latest = allResults.filter(r => r.loop === loopsRun);
  const pass = latest.filter(r => r.status === 'pass').length;
  const fail = latest.filter(r => r.status === 'fail').length;
  const blocked = latest.filter(r => r.status === 'blocked').length;
  const skipped = latest.filter(r => r.status === 'skip').length;
  const verdict = fail ? 'red' : blocked ? 'blocked' : 'green';
  const json = {
    generatedAt: new Date().toISOString(),
    phase: 4,
    verdict,
    loopsRun,
    outDir: OUT,
    liveKeyPresent: hasLiveKey(),
    wantLive: WANT_LIVE,
    counts: { pass, fail, blocked, skipped },
    results: latest.map(r => ({
      id: r.id,
      phase: r.phase,
      title: r.title,
      status: r.status,
      required: !!r.required,
      class: r.class || '',
      exitCode: r.exitCode,
      timedOut: !!r.timedOut,
      durationMs: r.durationMs || 0,
      logFile: r.logFile || '',
      evidenceFile: r.evidenceFile || '',
      reason: r.reason || ''
    })),
    history: allResults.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeFileSync(join(OUT, 'phase4-status.json'), JSON.stringify(json, null, 2));

  let md = '# StarNet Phase 4 Cutover Evidence\n\n';
  md += '- Generated: `' + json.generatedAt + '`\n';
  md += '- Verdict: `' + verdict + '`\n';
  md += '- Loops run: `' + loopsRun + '`\n';
  md += '- Live key present: `' + json.liveKeyPresent + '`\n\n';
  md += '| Status | Phase | Step | Class | Required | Notes |\n|---|---|---|---|---:|---|\n';
  for (const r of latest) {
    const note = r.reason || (r.evidenceFile ? 'evidence ' + r.evidenceFile : (r.logFile ? 'log ' + r.logFile : (r.exitCode == null ? '' : 'exit ' + r.exitCode)));
    md += '| ' + statusIcon(r.status) + ' | `' + mdEscape(r.phase) + '` | `' + r.id + '` ' + mdEscape(r.title)
      + ' | ' + mdEscape(r.class || '') + ' | ' + (r.required ? 'yes' : 'no') + ' | ' + mdEscape(note) + ' |\n';
  }
  md += '\n## Continuous Loop Rule\n\n';
  md += 'Run `npm.cmd run phase4:loop` after each fix or evidence update. The loop stops when it is green, red, or stably blocked on external live/attended/decision evidence.\n\n';
  md += '## Next Action\n\n';
  const next = latest.find(r => r.status === 'fail' || r.status === 'blocked');
  if (!next) md += 'P4 is green. StarNet has replacement qualification evidence and a recorded decision.\n';
  else md += 'Work the first non-pass item: `' + next.id + '` - ' + (next.reason || next.title) + '\n';
  writeFileSync(join(OUT, 'summary.md'), md);
  copyLatest();
  return json;
}

function signature(results) {
  return results.map(r => r.id + ':' + r.status + ':' + (r.reason || '')).join('|');
}

let allResults = [];
let prevSig = '';
let loopsRun = 0;
for (let i = 1; i <= LOOP_MAX; i++) {
  console.log('[phase4] loop ' + i + ' starting');
  const results = await runOnce(i);
  loopsRun = i;
  allResults = allResults.concat(results);
  for (const r of results) {
    console.log('[phase4]   ' + statusIcon(r.status) + ' ' + r.id + (r.exitCode == null ? '' : ' exit=' + r.exitCode));
  }
  const hasFail = results.some(r => r.required && r.status === 'fail');
  const hasBlocked = results.some(r => r.required && r.status === 'blocked');
  const sig = signature(results);
  if (hasFail) break;
  if (!hasBlocked) break;
  if (prevSig && prevSig === sig) break;
  prevSig = sig;
  break;
}

const summary = writeSummary(allResults, loopsRun);
console.log('[phase4] evidence: ' + OUT);
console.log('[phase4] latest: ' + LATEST);
if (summary.verdict === 'red') process.exit(1);
if ((REQUIRE_GREEN || WANT_LIVE) && summary.verdict !== 'green') process.exit(2);
