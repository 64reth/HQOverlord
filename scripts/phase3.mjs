#!/usr/bin/env node
// phase3.mjs - StarNet beta-replacement Phase 3 steering runner.
//
// Phase 3 is not a single feature. It is a loop system for 3.1-3.7:
// dogfood proof, soak, fs.patch, MCP stdio, browser automation, computer-use,
// and desktop release proof. This runner executes the gates that exist and marks
// missing parity surfaces as implementation gaps rather than fake-green.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coerceTimeoutMs, runBoundedCommand } from './lib/run-command.mjs';
import { withoutLiveProviderEnv } from './lib/provider-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_PHASE3_LOOPS || 3) || 3) : 1;
const REQUIRE_GREEN = argSet.has('--require-green');
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const OUT = resolve(process.env.STARNET_PHASE3_DIR || join(ROOT, '.dogfood', 'phase3-' + STAMP));
const LATEST = join(ROOT, '.dogfood', 'phase3-latest');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCmd = process.execPath;
const STEP_TIMEOUT_MS = coerceTimeoutMs(process.env.STARNET_PHASE3_STEP_TIMEOUT_MS || 900000);

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function tail(s, n = 5000) {
  s = String(s || '');
  return s.length > n ? s.slice(s.length - n) : s;
}
function statusIcon(status) {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : status === 'blocked' ? 'BLOCKED' : 'SKIP';
}
function cargoAvailable() {
  const exe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
  const paths = String(process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  return paths.some(p => p && existsSync(join(p, exe)));
}
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function textIncludes(file, pattern) {
  try { return readFileSync(file, 'utf8').indexOf(pattern) >= 0; } catch (_) { return false; }
}
function missing(paths) {
  return paths.filter(p => !existsSync(join(ROOT, p)));
}
function evidenceVerdict(latestDir, statusName) {
  const json = readJson(join(ROOT, latestDir, statusName));
  if (!json) return null;
  return { verdict: json.verdict, counts: json.counts || {}, results: json.results || [], file: join(ROOT, latestDir, statusName) };
}

async function runCommand(step, loopIndex) {
  ensureDir(OUT);
  const logFile = join(OUT, 'loop' + loopIndex + '-' + step.id + '.log');
  const result = await runBoundedCommand({
    cmd: step.cmd,
    args: step.args || [],
    cwd: ROOT,
    env: step.env || process.env,
    timeoutMs: step.timeoutMs || STEP_TIMEOUT_MS,
    label: 'phase3/' + step.id
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

async function runStep(step, loopIndex) {
  ensureDir(OUT);
  if (step.skip) {
    return Object.assign({}, step, {
      status: step.blocked ? 'blocked' : 'skip',
      exitCode: null,
      durationMs: 0,
      logFile: null,
      reason: step.reason || ''
    });
  }

  if (step.check) {
    return Object.assign({}, step, {
      status: step.check.status,
      exitCode: null,
      durationMs: 0,
      logFile: null,
      reason: step.check.reason || ''
    });
  }

  let result = await runCommand(step, loopIndex);
  if (result.status === 'pass' && step.evidence) {
    const ev = evidenceVerdict(step.evidence.latestDir, step.evidence.statusName);
    result.evidenceFile = ev && ev.file;
    if (!ev) {
      result.status = 'fail';
      result.reason = 'Expected evidence file was not written: ' + step.evidence.latestDir + '/' + step.evidence.statusName;
    } else if (step.evidence.requiredOnly) {
      const requiredBad = ev.results.filter(r => r && r.required && r.status !== 'pass');
      const requiredFail = requiredBad.find(r => r.status === 'fail');
      if (requiredFail) {
        result.status = 'fail';
        result.reason = step.evidence.label + ' required gate failed: ' + requiredFail.id + '; see ' + ev.file;
      } else if (requiredBad.length) {
        result.status = 'blocked';
        result.reason = step.evidence.label + ' required gate blocked: ' + requiredBad[0].id + '; see ' + ev.file;
      } else {
        result.reason = step.evidence.label + ' required gates green; see ' + ev.file;
      }
    } else if (ev.verdict === 'red') {
      result.status = 'fail';
      result.reason = step.evidence.label + ' verdict red; see ' + ev.file;
    } else if (ev.verdict === 'blocked') {
      result.status = 'blocked';
      result.reason = step.evidence.label + ' verdict blocked; see ' + ev.file;
    } else {
      result.reason = step.evidence.label + ' verdict green; see ' + ev.file;
    }
  }
  return result;
}

function implementationCheck(id) {
  if (id === 'fs-patch') {
    const miss = missing(['sidecar/tools/builtin/patchparse.js', 'sidecar/tools/builtin/fuzzymatch.js', 'test/fs.patch.test.js']);
    if (!textIncludes(join(ROOT, 'sidecar/tools/builtin/fs.js'), 'fs.patch')) miss.push('fs.patch registration in sidecar/tools/builtin/fs.js');
    if (miss.length) return { status: 'blocked', reason: 'Implementation gap: missing ' + miss.join(', ') + '.' };
    return null;
  }
  if (id === 'mcp-stdio') {
    const miss = missing(['sidecar/mcp/transport.stdio.js', 'test/mcp.stdio.test.js']);
    if (!textIncludes(join(ROOT, 'sidecar/mcp/manager.js'), 'stdio')) miss.push('stdio manager wiring in sidecar/mcp/manager.js');
    if (miss.length) return { status: 'blocked', reason: 'Implementation gap: missing ' + miss.join(', ') + '.' };
    return null;
  }
  if (id === 'browser-automation') {
    const miss = missing(['sidecar/tools/builtin/browser.js', 'test/browser.test.js']);
    if (miss.length) return { status: 'blocked', reason: 'Implementation gap: missing ' + miss.join(', ') + '.' };
    return null;
  }
  if (id === 'computer-use') {
    const miss = missing(['sidecar/tools/builtin/computer.js', 'test/computer.test.js']);
    if (miss.length) return { status: 'blocked', reason: 'Implementation gap: missing ' + miss.join(', ') + '.' };
    return null;
  }
  return null;
}

function passNote(r) {
  if (r.proofClass === 'automated-contract') {
    return 'automated contract green; Phase 4 still needs attended/live reliability proof';
  }
  if (r.evidenceFile) return 'evidence ' + r.evidenceFile;
  return r.exitCode == null ? '' : 'exit ' + r.exitCode;
}

function buildSteps() {
  const nonLiveEnv = withoutLiveProviderEnv();
  return [
    {
      id: '3.1-phase2-foundation',
      title: 'Phase 2 foundation gates remain trustworthy',
      phase: '3.1',
      cmd: npmCmd,
      args: ['run', 'phase2:desktop'],
      env: nonLiveEnv,
      required: true,
      evidence: { latestDir: '.dogfood/phase2-latest', statusName: 'phase2-status.json', label: 'Phase 2', requiredOnly: true }
    },
    {
      id: '3.1-dogfood-pack',
      title: 'Daily-driver dogfood evidence pack',
      phase: '3.1',
      cmd: npmCmd,
      args: ['run', 'dogfood'],
      env: nonLiveEnv,
      required: true,
      evidence: { latestDir: '.dogfood/dogfood-latest', statusName: 'dogfood-status.json', label: 'Dogfood' }
    },
    {
      id: '3.2-soak-repeat',
      title: 'Reliability soak: two green dogfood passes',
      phase: '3.2',
      required: true,
      check: { status: 'blocked', reason: 'Requires two complete green dogfood passes, one fresh and one after sidecar restart.' }
    },
    {
      id: '3.3-fs-patch',
      title: 'ref-style fs.patch parser/fuzzy atomic patching',
      phase: '3.3',
      cmd: nodeCmd,
      args: ['test/fs.patch.test.js'],
      env: nonLiveEnv,
      required: true,
      check: implementationCheck('fs-patch')
    },
    {
      id: '3.4-mcp-stdio',
      title: 'Secure MCP stdio transport and cleanup',
      phase: '3.4',
      cmd: nodeCmd,
      args: ['test/mcp.stdio.test.js'],
      env: nonLiveEnv,
      required: true,
      check: implementationCheck('mcp-stdio')
    },
    {
      id: '3.5-browser-automation',
      title: 'Browser automation automated contract with stable refs and SSRF guards',
      phase: '3.5',
      cmd: nodeCmd,
      args: ['test/browser.test.js'],
      env: nonLiveEnv,
      required: true,
      proofClass: 'automated-contract',
      check: implementationCheck('browser-automation')
    },
    {
      id: '3.6-computer-use',
      title: 'Desktop computer-use automated contract with consent and capture-after proof',
      phase: '3.6',
      cmd: nodeCmd,
      args: ['test/computer.test.js'],
      env: nonLiveEnv,
      required: true,
      proofClass: 'automated-contract',
      check: implementationCheck('computer-use')
    },
    {
      id: '3.7-desktop-prepare',
      title: 'Desktop bundled Node preparation',
      phase: '3.7',
      cmd: npmCmd,
      args: ['run', 'desktop:prepare'],
      env: nonLiveEnv,
      required: true
    },
    {
      id: '3.7-desktop-build',
      title: 'Desktop Tauri release build',
      phase: '3.7',
      cmd: npmCmd,
      args: ['run', 'desktop:build'],
      env: nonLiveEnv,
      required: true,
      allowFailure: true,
      skip: !cargoAvailable(),
      blocked: true,
      reason: 'Cargo/Rust is not on PATH. Install Rust toolchain, then rerun npm.cmd run phase3.'
    }
  ];
}

function writeSummary(allResults, loopCount) {
  const latestResults = allResults.filter(r => r.loop === loopCount);
  const pass = latestResults.filter(r => r.status === 'pass').length;
  const fail = latestResults.filter(r => r.status === 'fail').length;
  const blocked = latestResults.filter(r => r.status === 'blocked').length;
  const skipped = latestResults.filter(r => r.status === 'skip').length;
  const verdict = fail ? 'red' : blocked ? 'blocked' : 'green';
  const json = {
    generatedAt: new Date().toISOString(),
    phase: 3,
    loopsRun: loopCount,
    outDir: OUT,
    verdict,
    counts: { pass, fail, blocked, skipped },
    cargoPresent: cargoAvailable(),
    results: latestResults.map(r => ({
      id: r.id,
      phase: r.phase,
      title: r.title,
      status: r.status,
      required: !!r.required,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      timedOut: !!r.timedOut,
      logFile: r.logFile,
      evidenceFile: r.evidenceFile || '',
      proofClass: r.proofClass || '',
      reason: (r.status === 'skip' || r.status === 'blocked' || r.status === 'fail') ? (r.reason || '') : ''
    })),
    history: allResults.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeFileSync(join(OUT, 'phase3-status.json'), JSON.stringify(json, null, 2));

  let md = '# StarNet Phase 3 Evidence\n\n';
  md += '- Generated: `' + json.generatedAt + '`\n';
  md += '- Verdict: `' + verdict + '`\n';
  md += '- Loops run: `' + loopCount + '`\n';
  md += '- Cargo present: `' + json.cargoPresent + '`\n\n';
  md += '| Status | Phase | Step | Required | Notes |\n|---|---|---|---:|---|\n';
  for (const r of latestResults) {
    const note = (r.status === 'pass')
      ? passNote(r)
      : (r.reason || '');
    md += '| ' + statusIcon(r.status) + ' | `' + mdEscape(r.phase) + '` | `' + r.id + '` ' + mdEscape(r.title)
      + ' | ' + (r.required ? 'yes' : 'no') + ' | ' + mdEscape(note) + ' |\n';
  }
  md += '\n## Continuous Loop Rule\n\n';
  md += 'Run `npm.cmd run phase3:loop` after each fix. The loop stops when the verdict is green, red, or blocked with no state change; it does not spin on missing keys, missing Cargo, or unimplemented parity surfaces.\n\n';
  md += '## Next Action\n\n';
  const next = latestResults.find(r => r.status === 'fail' || r.status === 'blocked');
  if (!next) md += 'All Phase 3 gates are green. StarNet is at beta replacement parity for this plan.\n';
  else md += 'Work the first non-pass item: `' + next.id + '` - ' + (next.reason || next.title) + '\n';
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

async function runOnce(loopIndex) {
  const results = [];
  for (const step of buildSteps()) {
    console.log('[phase3] loop ' + loopIndex + ' ' + step.id + ' - ' + step.title);
    const r = await runStep(step, loopIndex);
    r.loop = loopIndex;
    results.push(r);
    console.log('[phase3]   ' + statusIcon(r.status) + (r.exitCode == null ? '' : ' exit=' + r.exitCode));
    if (r.status === 'fail' && r.required) break;
  }
  return results;
}

async function main() {
  ensureDir(OUT);
  let allResults = [];
  let prevSig = '';
  let loopsRun = 0;
  for (let i = 1; i <= LOOP_MAX; i++) {
    const results = await runOnce(i);
    loopsRun = i;
    allResults = allResults.concat(results);
    const currentSig = signature(results);
    const hasFail = results.some(r => r.status === 'fail' && r.required);
    const hasBlocked = results.some(r => r.status === 'blocked' && r.required);
    if (hasFail) break;
    if (!hasBlocked) break;
    if (prevSig && prevSig === currentSig) break;
    prevSig = currentSig;
    if (i < LOOP_MAX) console.log('[phase3] blocked state stable enough to stop after current loop unless external state changes.');
    break;
  }
  const summary = writeSummary(allResults, loopsRun);
  console.log('[phase3] evidence: ' + OUT);
  console.log('[phase3] latest: ' + LATEST);
  if (summary.verdict === 'red') process.exit(1);
  if (REQUIRE_GREEN && summary.verdict !== 'green') process.exit(2);
}

main().catch(e => { console.error('[phase3] FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
