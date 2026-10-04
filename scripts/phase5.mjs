#!/usr/bin/env node
// phase5.mjs - StarNet the reference harness replacement-readiness loop.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coerceTimeoutMs, runBoundedCommand } from './lib/run-command.mjs';
import { hasLiveProviderKey, liveProviderEnv, withoutLiveProviderEnv } from './lib/provider-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_PHASE5_LOOPS || 3) || 3) : 1;
const WANT_LIVE = argSet.has('--live');
const REQUIRE_GREEN = argSet.has('--require-green');
const REQUIRE_READY = argSet.has('--require-ready');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_PHASE5_DIR || join(ROOT, '.dogfood', 'phase5-' + STAMP));
const LATEST = resolve(process.env.STARNET_PHASE5_LATEST_DIR || join(ROOT, '.dogfood', 'phase5-latest'));
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;
const STEP_TIMEOUT_MS = coerceTimeoutMs(process.env.STARNET_PHASE5_STEP_TIMEOUT_MS || 1200000);

const SURFACE_ALLOWED = new Set(['ref-proven', 'contract-green', 'accepted-deferral', 'blocked']);
const DESKTOP_ALLOWED = new Set(['green', 'toolchain-blocked', 'accepted-deferral', 'blocked']);
const DECISIONS = new Set(['ready-to-replace', 'limited-pilot', 'blocked', 'not-ready']);

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'blocked' ? 'BLOCKED' : 'SKIP';
}
function hasLiveKey() { return hasLiveProviderKey(); }
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function evidencePath(name) {
  return join(ROOT, '.dogfood', name);
}
function phase5EvidenceFile() {
  return evidencePath('phase5-evidence.json');
}
function phase5DecisionFile() {
  return evidencePath('phase5-decision.json');
}
function copyLatest() {
  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    try { copyFileSync(join(OUT, name), join(LATEST, name)); } catch (_) {}
  }
}
function unique(xs) {
  return Array.from(new Set((xs || []).filter(x => String(x || '').trim())));
}
function nowIso() { return new Date().toISOString(); }
function evidenceTemplate() {
  return {
    generatedAt: nowIso(),
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
function loadEvidence() {
  return readJson(phase5EvidenceFile()) || evidenceTemplate();
}
function saveEvidence(ev) {
  ev.generatedAt = nowIso();
  writeJson(phase5EvidenceFile(), ev);
}
function hasItems(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => String(x || '').trim());
}
function nonEmpty(v) { return typeof v === 'string' && v.trim(); }
function evidenceHealth() {
  const ev = readJson(phase5EvidenceFile());
  const missing = [];
  const add = (label, ok) => { if (!ok) missing.push(label); };
  if (!ev) return { ok: false, missing: ['phase5-evidence.json missing'], strictReady: false, evidence: null };
  const w = ev.workloads || {};
  add('workloads.passed', w.passed === true);
  add('workloads.proofLevel', nonEmpty(w.proofLevel));
  add('workloads.screenshots[]', hasItems(w.screenshots));
  add('workloads.runIds[]', hasItems(w.runIds));
  add('workloads.transcriptIds[]', hasItems(w.transcriptIds));
  add('workloads.artifactPaths[]', hasItems(w.artifactPaths));
  add('workloads.ledgerRows[]', hasItems(w.ledgerRows));
  add('workloads.modelNames[]', hasItems(w.modelNames));
  add('workloads.toolCalls[]', hasItems(w.toolCalls));
  const browser = ev.surface && ev.surface.browser || {};
  const computer = ev.surface && ev.surface.computer || {};
  add('surface.browser.status', SURFACE_ALLOWED.has(browser.status));
  add('surface.browser.logs[]', hasItems(browser.logs));
  add('surface.browser.notes', nonEmpty(browser.notes));
  add('surface.computer.status', SURFACE_ALLOWED.has(computer.status));
  add('surface.computer.logs[]', hasItems(computer.logs));
  add('surface.computer.notes', nonEmpty(computer.notes));
  const soak = ev.soak || {};
  add('soak.phase4LiveGreen', soak.phase4LiveGreen === true);
  add('soak.phase5WorkloadGreen', soak.phase5WorkloadGreen === true);
  add('soak.restartPreserved', soak.restartPreserved === true);
  add('soak.notes', nonEmpty(soak.notes));
  const recovery = ev.recovery || {};
  add('recovery.phase4RecoveryGreen', recovery.phase4RecoveryGreen === true);
  add('recovery.phase5RecoveryGreen', recovery.phase5RecoveryGreen === true);
  add('recovery.notes', nonEmpty(recovery.notes));
  const desktop = ev.desktop || {};
  add('desktop.status', DESKTOP_ALLOWED.has(desktop.status));
  add('desktop.logs[]', hasItems(desktop.logs));
  add('desktop.notes', nonEmpty(desktop.notes));
  const strictReady = !!(w.passed
    && browser.status === 'ref-proven'
    && computer.status === 'ref-proven'
    && desktop.status === 'green'
    && soak.phase4LiveGreen && soak.phase5WorkloadGreen && soak.restartPreserved
    && recovery.phase4RecoveryGreen && recovery.phase5RecoveryGreen);
  return { ok: missing.length === 0, missing, strictReady, evidence: ev };
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
    label: 'phase5/' + step.id
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

function checkWorkloadBaseline(loop) {
  const file = join(ROOT, 'docs', 'STARNET_PHASE5_REF_WORKLOADS.md');
  const text = readText(file).toLowerCase();
  const required = ['ready-to-replace', 'contract-green is not ref-proven', 'live model', 'browser', 'computer-use', 'desktop'];
  const missing = required.filter(term => text.indexOf(term) < 0);
  return {
    id: '5.1-ref-workload-baseline',
    phase: '5.1',
    title: 'the reference harness workload baseline is explicit',
    loop,
    status: existsSync(file) && !missing.length ? 'pass' : 'fail',
    required: true,
    class: 'baseline-contract',
    evidenceFile: file,
    reason: missing.length ? 'Baseline is missing expected terms: ' + missing.join(', ') : 'P5 workload baseline exists.'
  };
}

function phase4EvidenceComplete() {
  const ev = readJson(evidencePath('phase4-attended-evidence.json'));
  const trial = ev && ev.sameWorkTrial;
  const soak = ev && ev.soak;
  const fr = ev && ev.failureRecovery;
  return !!(trial && trial.passed && hasItems(trial.screenshots) && hasItems(trial.runIds) && hasItems(trial.transcriptIds) && hasItems(trial.artifactPaths) && hasItems(trial.ledgerRows)
    && soak && soak.freshPass && soak.restartPass && soak.transcriptPreserved && soak.ledgerPreserved && soak.artifactsPreserved && soak.memoryPreserved && soak.stationStatePreserved
    && fr && fr.cancelPassed && fr.budgetPassed && fr.deniedConsentPassed && fr.toolErrorPassed && fr.checkpointRestorePassed);
}

function ensurePhase4PilotDecision() {
  if (!phase4EvidenceComplete()) return false;
  const file = evidencePath('phase4-decision.json');
  const existing = readJson(file);
  if (existing && ['ready-to-replace', 'limited-pilot'].includes(existing.decision) && existing.acceptedBy && existing.acceptedAt && existing.notes) return true;
  writeJson(file, {
    decision: 'limited-pilot',
    acceptedBy: process.env.USERNAME || process.env.USER || 'codex-agent',
    acceptedAt: nowIso(),
    notes: 'Generated by Phase 5 bootstrap after P4 live UI, recovery, and evidence checks completed. P4 remains a limited pilot until P5 replacement gaps close.',
    acceptedPilotGaps: [
      'Browser/computer-use still need P5 ref-proven workload evidence.',
      'Desktop clean-machine/Tauri readiness remains part of P5.'
    ]
  });
  return true;
}

function updateEvidenceFromPhase4(recoveryResult) {
  const ev = loadEvidence();
  const phase4Status = readJson(evidencePath('phase4-latest/phase4-status.json'));
  const p4Green = !!(phase4Status && phase4Status.verdict === 'green' && phase4Status.wantLive);
  const p4Attended = readJson(evidencePath('phase4-attended-evidence.json'));
  const fr = p4Attended && p4Attended.failureRecovery;
  ev.soak = Object.assign({}, ev.soak || {}, {
    phase4LiveGreen: p4Green,
    notes: unique([ev.soak && ev.soak.notes, p4Green ? 'P4 live gate is green in this P5 run.' : 'P4 live gate is not green yet.']).join(' ')
  });
  ev.recovery = Object.assign({}, ev.recovery || {}, {
    phase4RecoveryGreen: !!(fr && fr.cancelPassed && fr.budgetPassed && fr.deniedConsentPassed && fr.toolErrorPassed && fr.checkpointRestorePassed),
    phase5RecoveryGreen: recoveryResult ? recoveryResult.status === 'pass' : !!(ev.recovery && ev.recovery.phase5RecoveryGreen),
    notes: unique([ev.recovery && ev.recovery.notes, 'P5 uses the Phase 4 recovery suite as the current recovery spine: cancel, budget, denied consent, tool error, and checkpoint/restore.']).join(' ')
  });
  saveEvidence(ev);
}

function deriveGaps(ev) {
  const gaps = [];
  const browser = ev && ev.surface && ev.surface.browser;
  const computer = ev && ev.surface && ev.surface.computer;
  const desktop = ev && ev.desktop;
  if (!browser || browser.status !== 'ref-proven') gaps.push('Browser automation is ' + ((browser && browser.status) || 'missing') + ', not ref-proven by a live replacement workload.');
  if (!computer || computer.status !== 'ref-proven') gaps.push('Desktop computer-use is ' + ((computer && computer.status) || 'missing') + ', not ref-proven by an attended driver workload.');
  if (!desktop || desktop.status !== 'green') gaps.push('Desktop clean-machine/Tauri readiness is ' + ((desktop && desktop.status) || 'missing') + '.');
  return gaps;
}

function ensurePhase5Decision() {
  const health = evidenceHealth();
  const existing = readJson(phase5DecisionFile());
  if (existing && existing.decision === 'ready-to-replace' && !health.strictReady) return existing;
  if (existing && existing.decision === 'not-ready') return existing;
  const gaps = health.evidence ? deriveGaps(health.evidence) : ['P5 evidence is incomplete.'];
  const decision = health.ok
    ? (health.strictReady ? 'ready-to-replace' : 'limited-pilot')
    : 'blocked';
  const doc = {
    decision,
    acceptedBy: process.env.USERNAME || process.env.USER || 'codex-agent',
    acceptedAt: nowIso(),
    notes: decision === 'ready-to-replace'
      ? 'P5 strict replacement proof is green with no accepted replacement gaps.'
      : (decision === 'limited-pilot'
        ? 'P5 evidence pack is green, but replacement readiness remains below ready-to-replace until accepted gaps close.'
        : 'P5 decision is blocked until live workload, surface, soak, recovery, and desktop evidence are complete.'),
    acceptedReplacementGaps: decision === 'ready-to-replace' ? [] : gaps
  };
  if (!existing || ['blocked', 'limited-pilot'].includes(existing.decision)) writeJson(phase5DecisionFile(), doc);
  return readJson(phase5DecisionFile()) || doc;
}

function checkEvidence(loop) {
  const health = evidenceHealth();
  return {
    id: '5.6-evidence-pack',
    phase: '5.6',
    title: 'P5 evidence pack is complete',
    loop,
    status: health.ok ? 'pass' : 'blocked',
    required: true,
    class: 'evidence',
    evidenceFile: phase5EvidenceFile(),
    replacementReady: health.strictReady,
    reason: health.ok ? 'P5 evidence fields are complete.' : 'Missing: ' + health.missing.slice(0, 6).join(', ') + (health.missing.length > 6 ? ', ...' : '')
  };
}

function checkDecision(loop, priorResults) {
  const priorBad = priorResults.filter(r => r.required && r.status !== 'pass');
  if (priorBad.length) {
    return {
      id: '5.7-replacement-decision',
      phase: '5.7',
      title: 'Final the reference harness replacement decision',
      loop,
      status: 'blocked',
      required: true,
      class: 'decision',
      evidenceFile: phase5DecisionFile(),
      replacementReady: false,
      reason: 'Decision waits for prior P5 gates; first non-pass is ' + priorBad[0].id + '.'
    };
  }
  const health = evidenceHealth();
  const decision = ensurePhase5Decision();
  const schemaOk = decision && DECISIONS.has(decision.decision) && decision.acceptedBy && decision.acceptedAt && decision.notes && Array.isArray(decision.acceptedReplacementGaps);
  const overclaim = decision && decision.decision === 'ready-to-replace' && (!health.strictReady || decision.acceptedReplacementGaps.length);
  return {
    id: '5.7-replacement-decision',
    phase: '5.7',
    title: 'Final the reference harness replacement decision',
    loop,
    status: schemaOk && !overclaim ? 'pass' : 'fail',
    required: true,
    class: 'decision',
    evidenceFile: phase5DecisionFile(),
    replacementReady: !!(schemaOk && !overclaim && decision.decision === 'ready-to-replace' && health.strictReady),
    reason: overclaim
      ? 'Decision overclaims ready-to-replace without strict P5 evidence.'
      : (schemaOk ? 'Final decision recorded: ' + decision.decision + '.' : 'Needs phase5-decision.json with decision, acceptedBy, acceptedAt, notes, and acceptedReplacementGaps.')
  };
}

function liveKeyBlockedStep(loop) {
  return {
    id: '5.2-live-provider-required',
    phase: '5.2',
    title: 'P5 live provider key is available',
    loop,
    status: 'blocked',
    required: true,
    class: 'live-provider',
    reason: 'No live key found. Set SKYNET_OPENROUTER_KEY, STARNET_OPENROUTER_KEY, or OPENROUTER_API_KEY.'
  };
}

async function runOnce(loop) {
  const results = [];
  results.push(checkWorkloadBaseline(loop));
  if (results.some(r => r.status === 'fail')) return results;

  if (WANT_LIVE) {
    if (!hasLiveKey()) {
      results.push(liveKeyBlockedStep(loop));
      return results;
    }
    const p4Ui = await commandStep({
      id: '5.0-p4-ui-evidence',
      phase: '5.0',
      title: 'P4 live UI evidence is refreshable',
      cmd: npmCmd,
      args: ['run', 'phase4:ui-proof'],
      env: liveProviderEnv(),
      required: true,
      class: 'entry-gate',
      timeoutMs: 600000
    }, loop);
    results.push(p4Ui);
    if (p4Ui.status === 'fail') return results;

    const p4Recovery = await commandStep({
      id: '5.0-p4-recovery-evidence',
      phase: '5.0',
      title: 'P4 recovery evidence is refreshable',
      cmd: npmCmd,
      args: ['run', 'phase4:recovery'],
      env: withoutLiveProviderEnv(),
      required: true,
      class: 'entry-gate',
      timeoutMs: 300000
    }, loop);
    results.push(p4Recovery);
    if (p4Recovery.status === 'fail') return results;
    ensurePhase4PilotDecision();

    const p4Live = await commandStep({
      id: '5.0-phase4-live-continuity',
      phase: '5.0',
      title: 'P4 live gate remains green',
      cmd: npmCmd,
      args: ['run', 'phase4:live'],
      env: liveProviderEnv(),
      required: true,
      class: 'entry-gate',
      timeoutMs: 1800000
    }, loop);
    results.push(p4Live);
    if (p4Live.status === 'fail') return results;
    updateEvidenceFromPhase4(p4Recovery);

    const workload = await commandStep({
      id: '5.2-live-ui-workload',
      phase: '5.2',
      title: 'Live StarNet UI ref-style workload',
      cmd: npmCmd,
      args: ['run', 'phase5:workload'],
      env: liveProviderEnv(),
      required: true,
      class: 'live-workload',
      timeoutMs: 600000
    }, loop);
    results.push(workload);
    if (workload.status === 'fail') return results;
  } else {
    const p4Seal = await commandStep({
      id: '5.0-p4-nonlive-seal',
      phase: '5.0',
      title: 'P4 non-live source gate remains runnable',
      cmd: npmCmd,
      args: ['run', 'phase4'],
      env: withoutLiveProviderEnv(),
      required: true,
      class: 'entry-gate',
      allowFailure: true,
      timeoutMs: 1200000
    }, loop);
    results.push(p4Seal);
  }

  const surface = await commandStep({
    id: '5.3-browser-computer-desktop-surface',
    phase: '5.3',
    title: 'Browser/computer-use surface and desktop readiness are classified',
    cmd: npmCmd,
    args: ['run', 'phase5:surface'],
    env: withoutLiveProviderEnv(),
    required: true,
    class: 'surface-proof',
    timeoutMs: 900000
  }, loop);
  results.push(surface);
  if (surface.status === 'fail') return results;

  const recovery = await commandStep({
    id: '5.5-recovery-spine',
    phase: '5.5',
    title: 'Recovery spine remains green under P5',
    cmd: npmCmd,
    args: ['run', 'phase4:recovery'],
    env: withoutLiveProviderEnv(),
    required: true,
    class: 'recovery',
    timeoutMs: 300000
  }, loop);
  results.push(recovery);
  if (recovery.status === 'fail') return results;
  updateEvidenceFromPhase4(recovery);

  const evidence = checkEvidence(loop);
  results.push(evidence);
  const decision = checkDecision(loop, results);
  results.push(decision);
  return results;
}

function writeSummary(allResults, loopsRun) {
  ensureDir(OUT);
  const latest = allResults.filter(r => r.loop === loopsRun);
  const pass = latest.filter(r => r.status === 'pass').length;
  const fail = latest.filter(r => r.status === 'fail').length;
  const blocked = latest.filter(r => r.status === 'blocked').length;
  const skipped = latest.filter(r => r.status === 'skip').length;
  const decision = readJson(phase5DecisionFile());
  const health = evidenceHealth();
  const verdict = fail ? 'red' : blocked ? 'blocked' : 'green';
  const evidenceReplacementReady = !!(decision && decision.decision === 'ready-to-replace' && health.strictReady);
  const replacementReady = evidenceReplacementReady && verdict === 'green';
  const json = {
    generatedAt: nowIso(),
    phase: 5,
    verdict,
    replacementReady,
    evidenceReplacementReady,
    decision: decision && decision.decision || '',
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
      replacementReady: !!r.replacementReady,
      exitCode: r.exitCode,
      timedOut: !!r.timedOut,
      durationMs: r.durationMs || 0,
      logFile: r.logFile || '',
      evidenceFile: r.evidenceFile || '',
      reason: r.reason || ''
    })),
    acceptedReplacementGaps: decision && Array.isArray(decision.acceptedReplacementGaps) ? decision.acceptedReplacementGaps : [],
    history: allResults.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeFileSync(join(OUT, 'phase5-status.json'), JSON.stringify(json, null, 2));

  let md = '# StarNet Phase 5 Replacement Evidence\n\n';
  md += '- Generated: `' + json.generatedAt + '`\n';
  md += '- Verdict: `' + verdict + '`\n';
  md += '- Replacement ready: `' + replacementReady + '`\n';
  md += '- Decision: `' + json.decision + '`\n';
  md += '- Loops run: `' + loopsRun + '`\n';
  md += '- Live key present: `' + json.liveKeyPresent + '`\n\n';
  md += '| Status | Phase | Step | Class | Required | Notes |\n|---|---|---|---|---:|---|\n';
  for (const r of latest) {
    const note = r.reason || (r.evidenceFile ? 'evidence ' + r.evidenceFile : (r.logFile ? 'log ' + r.logFile : (r.exitCode == null ? '' : 'exit ' + r.exitCode)));
    md += '| ' + statusIcon(r.status) + ' | `' + mdEscape(r.phase) + '` | `' + r.id + '` ' + mdEscape(r.title)
      + ' | ' + mdEscape(r.class || '') + ' | ' + (r.required ? 'yes' : 'no') + ' | ' + mdEscape(note) + ' |\n';
  }
  md += '\n## Accepted Replacement Gaps\n\n';
  if (!json.acceptedReplacementGaps.length) md += 'None.\n';
  else for (const gap of json.acceptedReplacementGaps) md += '- ' + gap + '\n';
  md += '\n## Continuous Loop Rule\n\n';
  md += 'Run `npm.cmd run phase5:loop` or `npm.cmd run phase5:live` after each fix or evidence update. Use `npm.cmd run phase5:ready` when checking whether the reference harness can be fully replaced.\n\n';
  md += '## Next Action\n\n';
  const next = latest.find(r => r.status === 'fail' || r.status === 'blocked');
  if (next) md += 'Work the first non-pass item: `' + next.id + '` - ' + (next.reason || next.title) + '\n';
  else if (replacementReady) md += 'P5 is ready-to-replace green. StarNet can replace the reference harness as the main harness.\n';
  else md += 'P5 evidence is green, but replacement readiness is still limited by the accepted gaps above.\n';
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
  console.log('[phase5] loop ' + i + ' starting');
  const results = await runOnce(i);
  loopsRun = i;
  allResults = allResults.concat(results);
  for (const r of results) {
    console.log('[phase5]   ' + statusIcon(r.status) + ' ' + r.id + (r.exitCode == null ? '' : ' exit=' + r.exitCode));
  }
  const hasFail = results.some(r => r.required && r.status === 'fail');
  const hasBlocked = results.some(r => r.required && r.status === 'blocked');
  const sig = signature(results);
  if (hasFail) break;
  if (!hasBlocked) break;
  if (prevSig && prevSig === sig) break;
  prevSig = sig;
}

const summary = writeSummary(allResults, loopsRun);
console.log('[phase5] evidence: ' + OUT);
console.log('[phase5] latest: ' + LATEST);
console.log('[phase5] replacementReady=' + summary.replacementReady + ' decision=' + summary.decision);
if (summary.verdict === 'red') process.exit(1);
if ((REQUIRE_GREEN || WANT_LIVE) && summary.verdict !== 'green') process.exit(2);
if (REQUIRE_READY && !summary.replacementReady) process.exit(2);
