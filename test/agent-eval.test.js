/* node test/agent-eval.test.js — deterministic task-quality evaluation foundation. */
'use strict';
const A = require('./_assert.js');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { dirname, join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const core = await import('../scripts/eval/core.mjs');
  const root = resolve(__dirname, '..');
  const fixtures = join(root, 'scripts', 'eval', 'fixtures');
  const tasks = core.readJsonl(join(fixtures, 'tasks.jsonl'));
  const baseline = core.readJsonl(join(fixtures, 'baseline.jsonl'));
  const candidate = core.readJsonl(join(fixtures, 'candidate.jsonl'));

  const report = core.evaluate({ tasks, baselineRows: baseline, candidateRows: candidate });
  A.eq({ pass: report.summary.pass, active: report.summary.active, passed: report.summary.passed, failed: report.summary.failed, pending: report.summary.pending },
    { pass: true, active: 13, passed: 13, failed: 0, pending: 0 }, 'seed pack passes existing behavior, bridge parity, and five quality scenarios');
  A.eq(report.summary.qualityScore, 1, 'seven quality dimensions produce an equal-weight perfect deterministic baseline');
  A.eq(Object.keys(report.summary.dimensions).sort(), ['completion', 'cost', 'latency', 'planning', 'recovery', 'stopping', 'toolSelection'], 'scorecard names every requested quality dimension');
  A.ok(/^[a-f0-9]{64}$/.test(report.suiteDigest) && /^[a-f0-9]{64}$/.test(report.baselineDigest), 'report binds the exact suite and comparison baseline');
  A.eq(report.benchmarkVersion, 'starnet-0.9.0-agent-quality-v1', 'receipt names the fixed StarNet 0.9.0 benchmark version');
  A.eq(report.results[1].metrics, {
    turns: 1, toolCalls: 1, retries: 0, tokensIn: 20, tokensOut: 8, tokens: 28, costUsd: 0.000036, firstTokenMs: 0, durationMs: 190,
    artifactHashes: [{ path: 'output.md', sha256: '0da6d1b1911c49b32fb845247367d08532316038e81c2b524de8b192818e1e9f' }], verificationFresh: true
  }, 'metrics include turns, tools, retries, tokens, cost, time, artifact identity, and verification freshness');

  const redacted = core.recordTrajectory({
    taskId: 'redaction-probe', finalText: 'used Bearer abc.def.ghi and sk-supersecret123456',
    rawEvents: [{ name: 'agent.cost', payload: { tokensIn: 12, apiKey: 'sk-rawsecret123456', nested: { refresh_token: 'rotate-me' }, path: 'C:\\Users\\andrew\\project' } }]
  });
  const redactedText = JSON.stringify(redacted);
  A.ok(!redactedText.includes('supersecret') && !redactedText.includes('rawsecret') && !redactedText.includes('rotate-me') && !redactedText.includes('andrew'), 'recording removes secret values and user-home identity');
  A.eq(redacted.events[0].data.tokensIn, 12, 'ordinary token accounting is preserved');
  A.eq(redacted.events[0].data.apiKey, '[REDACTED]', 'sensitive field is redacted');

  const { runBridgeAdapters } = await import('../scripts/eval/adapters/bridge.mjs');
  const { runQualityAdapters } = await import('../scripts/eval/adapters/quality.mjs');
  const liveBridge = await runBridgeAdapters();
  const recordedBridge = candidate.filter(row => row.taskId.startsWith('bridge-'));
  A.eq(liveBridge, recordedBridge, 'real module adapters reproduce the committed candidate evidence byte-for-byte');
  A.eq(liveBridge.map(row => row.taskId), ['bridge-continuation', 'bridge-recovery', 'bridge-code-mode', 'bridge-lsp-delta', 'bridge-full-history', 'bridge-cron-runtime'], 'every runtime bridge has a deterministic adapter');
  const liveQuality = await runQualityAdapters();
  const recordedQuality = candidate.filter(row => row.taskId.startsWith('quality-'));
  A.eq(liveQuality, recordedQuality, 'real-loop quality adapters reproduce the committed current baseline byte-for-byte');
  A.ok(liveQuality.every(row => row.events.find(event => event.type === 'quality.safety' && event.data.externalDispatches === 0)), 'every quality scenario proves zero external dispatches');

  const broken = JSON.parse(JSON.stringify(candidate));
  broken[0].finalText = 'wrong answer';
  broken[0].events.splice(2, 0, { seq: 3, at: '2026-08-01T12:10:00.020Z', type: 'provider.retry', data: {} });
  const failed = core.evaluate({ tasks, baselineRows: baseline, candidateRows: broken });
  A.eq(failed.summary.pass, false, 'correctness and metric regressions produce a failing report');
  A.ok(failed.results[0].failures.some(x => x.includes('correctness')), 'correctness failure is named');
  A.ok(failed.results[0].failures.some(x => x.includes('retries')), 'retry regression is named');

  const contradictory = JSON.parse(JSON.stringify(candidate));
  const retryRow = contradictory.find(row => row.taskId === 'bridge-continuation');
  retryRow.events.push(...Array.from({ length: 50 }, (_, index) => ({
    seq: retryRow.events.length + index + 1,
    at: `2026-08-01T12:15:00.${String(index).padStart(3, '0')}Z`,
    type: 'provider.retry', data: {}
  })));
  retryRow.metrics = { retries: 0 };
  const contradicted = core.evaluate({ tasks, baselineRows: baseline, candidateRows: contradictory });
  const retryResult = contradicted.results.find(row => row.taskId === 'bridge-continuation');
  A.eq(retryResult.metrics.retries, 50, 'observed retry events override a contradictory lower summary metric');
  A.eq(retryResult.pass, false, 'a contradictory retry summary cannot false-green the trajectory');
  A.ok(retryResult.failures.some(x => x.includes('retries')), 'the observed retry regression is named');

  const inefficient = JSON.parse(JSON.stringify(candidate));
  const slowRow = inefficient.find(row => row.taskId === 'quality-stop-on-proof');
  slowRow.metrics = { durationMs: 999, tokens: 999, costUsd: 0.1 };
  const efficiencyFailure = core.evaluate({ tasks, baselineRows: baseline, candidateRows: inefficient });
  const slowResult = efficiencyFailure.results.find(row => row.taskId === 'quality-stop-on-proof');
  A.eq(slowResult.pass, false, 'absolute quality ceilings and baseline regressions fail the task');
  A.ok(slowResult.grading.grades.some(grade => grade.dimension === 'latency' && !grade.pass), 'latency failure is assigned to latency');
  A.ok(slowResult.grading.grades.some(grade => grade.dimension === 'cost' && !grade.pass), 'token/cost failure is assigned to cost');
  A.ok(efficiencyFailure.summary.dimensions.latency.score < 1 && efficiencyFailure.summary.dimensions.cost.score < 1, 'dimension scorecard cannot hide efficiency regressions');

  const temp = mkdtempSync(join(tmpdir(), 'starnet-agent-eval-'));
  try {
    const reportFile = join(temp, 'report.json');
    const cli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'run', '--report', reportFile], { cwd: root, encoding: 'utf8' });
    A.eq(cli.status, 0, 'default CLI seed evaluation exits zero');
    A.ok(/PASS active=13/.test(cli.stdout) && /quality=100\.0/.test(cli.stdout), 'CLI prints a compact scored baseline receipt');
    A.ok(/planning=100/.test(cli.stdout) && /recovery=100/.test(cli.stdout) && /cost=100/.test(cli.stdout), 'CLI prints the requested dimensions');
    A.eq(JSON.parse(readFileSync(reportFile, 'utf8')).summary.pass, true, 'CLI writes the report');

    const rawFile = join(temp, 'raw.jsonl');
    const outFile = join(temp, 'recorded.jsonl');
    writeFileSync(rawFile, JSON.stringify({ name: 'agent.tool_result', payload: { authorization: 'Bearer private-token-value', result: 'ok' } }) + '\n');
    const rec = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'record', '--task', 'record-probe', '--input', rawFile, '--output', outFile], { cwd: root, encoding: 'utf8' });
    A.eq(rec.status, 0, 'record CLI exits zero');
    const recordedText = readFileSync(outFile, 'utf8');
    A.ok(!recordedText.includes('private-token-value') && recordedText.includes('[REDACTED]'), 'record CLI writes only redacted evidence');

    const brokenFile = join(temp, 'broken.jsonl');
    core.writeJsonl(brokenFile, broken);
    const failCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'run', '--candidate', brokenFile], { cwd: root, encoding: 'utf8' });
    A.eq(failCli.status, 1, 'CLI returns nonzero for threshold failures');
    A.ok(/FAIL existing-basic-response/.test(failCli.stdout), 'CLI names the failing task');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  A.throws(() => core.validateTasks([tasks[0], tasks[0]]), 'duplicate task ids fail schema validation');
  const invalidDimension = JSON.parse(JSON.stringify(tasks[8]));
  invalidDimension.graders[0].dimension = 'vibes';
  A.throws(() => core.validateTasks([invalidDimension]), 'unknown quality dimensions fail validation instead of diluting the score');

  const bind = await import('../scripts/eval/bind.mjs');
  const runtimeNode = bind.probeStarNetRuntimeNode(dirname(process.execPath), process.execPath);
  A.eq(runtimeNode.version, process.version, 'StarNet binding records the installed subject Node rather than the controller process by assumption');
  A.eq(runtimeNode.path, resolve(process.execPath), 'runtime Node evidence records the exact executable it probed');
  A.throws(() => bind.probeStarNetRuntimeNode(dirname(process.execPath), join(root, 'missing-node')), 'missing installed runtime Node fails candidate binding closed');
  const bindTemp = mkdtempSync(join(tmpdir(), 'starnet-eval-bind-'));
  try {
    const source = join(bindTemp, 'source'), runtime = join(bindTemp, 'runtime');
    mkdirSync(join(source, 'frontend'), { recursive: true });
    mkdirSync(join(runtime, 'frontend'), { recursive: true });
    const runGit = args => spawnSync('git', args, { cwd: source, encoding: 'utf8' });
    A.eq(runGit(['init']).status, 0, 'bind fixture initializes a source repository');
    A.eq(runGit(['config', 'user.email', 'eval@example.invalid']).status, 0, 'bind fixture configures a local author email');
    A.eq(runGit(['config', 'user.name', 'StarNet Eval']).status, 0, 'bind fixture configures a local author name');
    writeFileSync(join(source, 'frontend', 'app.js'), 'first\nsecond\n', 'utf8');
    A.eq(runGit(['add', 'frontend/app.js']).status, 0, 'bind fixture stages the LF source');
    A.eq(runGit(['commit', '-m', 'fixture']).status, 0, 'bind fixture commits the LF source');
    const commit = runGit(['rev-parse', 'HEAD']).stdout.trim();
    writeFileSync(join(runtime, 'frontend', 'app.js'), 'first\r\nsecond\r\n', 'utf8');
    const verified = bind.verifyRuntimeTree({ dir: source, commit }, runtime, ['frontend']);
    A.eq(verified.normalization, { kind: 'crlf-to-lf', files: 1 }, 'candidate binding accepts and records CRLF-only Windows checkout conversion');
    writeFileSync(join(runtime, 'frontend', 'app.js'), 'first\r\nchanged\r\n', 'utf8');
    A.throws(() => bind.verifyRuntimeTree({ dir: source, commit }, runtime, ['frontend']), 'candidate binding still rejects substantive runtime changes');
  } finally {
    rmSync(bindTemp, { recursive: true, force: true });
  }
  A.report('agent-eval.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
