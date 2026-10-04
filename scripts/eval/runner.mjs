#!/usr/bin/env node
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { evaluate, readJsonl, recordTrajectory, writeJsonl } from './core.mjs';
import { compareHarnesses, evaluateFaultGauntlet, makeReceipt, validateComparisonContract, validateScenarioPack } from './comparison.mjs';
import { bindHermes, bindStarNet, manifestEvidence, validateManifest } from './bind.mjs';
import { generateReceiptKeyPair, signReceipt, verifyReceiptSignature } from './receipt-signing.mjs';
import { applyIndependentParityGrades, validateParityFixtures } from './independent-grader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = {
  tasks: join(HERE, 'fixtures', 'tasks.jsonl'),
  candidate: join(HERE, 'fixtures', 'candidate.jsonl'),
  baseline: join(HERE, 'fixtures', 'baseline.jsonl'),
  contract: join(HERE, 'contracts', 'v0.9.0.json'),
  claims: resolve(HERE, '..', '..', 'qa', 'product-perfect', 'claims.json'),
  faultPack: join(HERE, 'packs', 'fault-v0.9.0.jsonl'),
  parityPack: join(HERE, 'packs', 'parity-v0.9.0.jsonl'),
  parityFixtures: join(HERE, 'fixtures', 'parity-v0.9.0.jsonl')
};

function argsOf(argv) {
  const out = { _: [] };
  const booleans = new Set(['help']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) out._.push(arg);
    else {
      const [key, inline] = arg.slice(2).split('=', 2);
      out[key] = inline === undefined && !booleans.has(key) ? argv[++i] : (inline === undefined ? true : inline);
    }
  }
  return out;
}

function ensureParent(file) { mkdirSync(dirname(resolve(file)), { recursive: true }); }
function readJson(file) { return JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, '')); }
function sha256File(file) {
  const buf = readFileSync(resolve(file));
  return createHash('sha256').update(buf).digest('hex');
}
function git(args, fallback = '') {
  try { return execFileSync('git', args, { cwd: resolve(HERE, '..', '..'), encoding: 'utf8' }).trim(); }
  catch (_) { return fallback; }
}
function subjectMeta(opts) {
  if (opts['subject-manifest']) return validateManifest(readJson(opts['subject-manifest'])).subject;
  const pkg = readJson(resolve(HERE, '..', '..', 'package.json'));
  const executable = opts.executable ? resolve(opts.executable) : '';
  let executableInfo = null;
  if (executable) {
    const st = statSync(executable);
    executableInfo = { path: executable, bytes: st.size, sha256: sha256File(executable) };
  }
  return {
    name: 'StarNet', version: pkg.version || '', commit: git(['rev-parse', 'HEAD']),
    sourceTree: { algorithm: 'git-tree', value: git(['rev-parse', 'HEAD^{tree}']) },
    executable: executableInfo,
    platform: { platform: process.platform, arch: process.arch, node: process.version },
    dirty: !!git(['status', '--porcelain'], '')
  };
}
function writeReceipt(file, receipt) {
  ensureParent(file);
  writeFileSync(resolve(file), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  console.log('[agent-eval] receipt ' + resolve(file));
}

function fileEvidence(file) { return { path: resolve(file), sha256: sha256File(file) }; }
function writeSignedReceipt(file, receipt, opts) {
  if (opts['signing-key']) signReceipt(receipt, opts['signing-key']);
  writeReceipt(file, receipt);
}

function referenceMeta(opts, contract) {
  if (!opts['reference-manifest']) return contract.reference;
  const subject = validateManifest(readJson(opts['reference-manifest'])).subject;
  if (subject.commit !== contract.reference.commit || subject.sourceTree.value !== contract.reference.sourceTree || subject.version !== contract.reference.version) {
    throw new Error('reference manifest does not match the frozen contract identity');
  }
  return subject;
}

function printReport(report, reportFile = '') {
  const s = report.summary;
  console.log(`[agent-eval] ${s.pass ? 'PASS' : 'FAIL'} active=${s.active} passed=${s.passed} failed=${s.failed} pending=${s.pending} quality=${(s.qualityScore * 100).toFixed(1)}`);
  const dimensions = Object.entries(s.dimensions || {}).map(([name, row]) => `${name}=${(row.score * 100).toFixed(0)}`).join(' ');
  if (dimensions) console.log('[agent-eval] dimensions ' + dimensions);
  console.log(`[agent-eval] benchmark=${report.benchmarkVersion} suite=${report.suiteDigest.slice(0, 12)} baseline=${report.baselineDigest.slice(0, 12)}`);
  for (const result of report.results) {
    if (result.status === 'pending') console.log(`[agent-eval] SKIP ${result.taskId} — pending adapter ${result.adapter || 'unassigned'}`);
    else console.log(`[agent-eval] ${result.pass ? 'PASS' : 'FAIL'} ${result.taskId}${result.failures && result.failures.length ? ' — ' + result.failures.join('; ') : ''}`);
  }
  if (reportFile) console.log('[agent-eval] report ' + resolve(reportFile));
}

async function run(opts) {
  const tasksFile = resolve(opts.tasks || DEFAULTS.tasks);
  const baselineFile = resolve(opts.baseline || DEFAULTS.baseline);
  let candidateRows;
  if (opts.candidate) candidateRows = readJsonl(resolve(opts.candidate));
  else {
    const { runBridgeAdapters } = await import('./adapters/bridge.mjs');
    const { runQualityAdapters } = await import('./adapters/quality.mjs');
    candidateRows = readJsonl(DEFAULTS.candidate).filter(row => !/^(?:bridge|quality)-/.test(String(row.taskId)));
    candidateRows.push(...await runBridgeAdapters());
    candidateRows.push(...await runQualityAdapters());
  }
  if (opts['candidate-out']) {
    ensureParent(opts['candidate-out']);
    writeJsonl(resolve(opts['candidate-out']), candidateRows);
  }
  const report = evaluate({ tasks: readJsonl(tasksFile), candidateRows, baselineRows: readJsonl(baselineFile) });
  if (opts.report) {
    ensureParent(opts.report);
    writeFileSync(resolve(opts.report), JSON.stringify(report, null, 2) + '\n', 'utf8');
  }
  printReport(report, opts.report);
  return report.summary.pass ? 0 : 1;
}

function record(opts) {
  if (!opts.task || !opts.input || !opts.output) throw new Error('record requires --task, --input, and --output');
  const rawEvents = readJsonl(resolve(opts.input));
  const meta = opts.meta ? JSON.parse(readFileSync(resolve(opts.meta), 'utf8')) : {};
  const trajectory = recordTrajectory({ taskId: opts.task, rawEvents, ...meta });
  ensureParent(opts.output);
  writeJsonl(resolve(opts.output), [trajectory]);
  console.log(`[agent-eval] recorded ${rawEvents.length} redacted events for ${opts.task} -> ${resolve(opts.output)}`);
  return 0;
}

function contractCheck(opts) {
  const contractFile = resolve(opts.contract || DEFAULTS.contract);
  const result = validateComparisonContract(readJson(contractFile), readJson(opts.claims || DEFAULTS.claims));
  console.log(`[agent-eval] CONTRACT ${result.ok ? 'PASS' : 'FAIL'} claims=${result.summary.claims} classified=${result.summary.classified}`);
  for (const error of result.errors) console.log('[agent-eval] FAIL ' + error);
  return result.ok ? 0 : 1;
}

function fault(opts) {
  if (!opts.candidate) throw new Error('fault requires --candidate <trajectory.jsonl>');
  const contract = readJson(opts.contract || DEFAULTS.contract);
  const contractResult = validateComparisonContract(contract, readJson(opts.claims || DEFAULTS.claims));
  if (!contractResult.ok) throw new Error('comparison contract is invalid: ' + contractResult.errors.join('; '));
  const tasks = readJsonl(resolve(opts.tasks || DEFAULTS.faultPack));
  const pack = validateScenarioPack(tasks, { expectedCount: 10, categories: { 'run-boundary': 10 } });
  if (!pack.ok) throw new Error('fault pack is invalid: ' + pack.errors.join('; '));
  const result = evaluateFaultGauntlet({ tasks, candidateRows: readJsonl(resolve(opts.candidate)), contract });
  const evidence = { tasks: fileEvidence(opts.tasks || DEFAULTS.faultPack), candidate: fileEvidence(opts.candidate) };
  if (opts['subject-manifest']) evidence.subjectManifest = manifestEvidence(opts['subject-manifest']);
  const receipt = makeReceipt({ kind: 'fault', contract, subject: subjectMeta(opts), result, evidence });
  writeSignedReceipt(opts.receipt || join('.dogfood', 'eval', 'fault-receipt.json'), receipt, opts);
  console.log(`[agent-eval] FAULT ${result.pass ? 'PASS' : 'FAIL'} passed=${result.report.summary.passed}/${result.report.summary.active}`);
  return result.pass ? 0 : 1;
}

function compare(opts) {
  if (!opts.starnet || !opts.reference) throw new Error('compare requires --starnet <trajectory.jsonl> and --reference <trajectory.jsonl>');
  const contract = readJson(opts.contract || DEFAULTS.contract);
  const contractResult = validateComparisonContract(contract, readJson(opts.claims || DEFAULTS.claims));
  if (!contractResult.ok) throw new Error('comparison contract is invalid: ' + contractResult.errors.join('; '));
  const tasks = readJsonl(resolve(opts.tasks || DEFAULTS.parityPack));
  const pack = validateScenarioPack(tasks, { expectedCount: 32, categories: {
    'coding-file': 6, 'research-browser': 4, 'document-data': 4, 'memory-history': 4,
    orchestration: 6, 'routine-channel': 4, 'recovery-security': 4
  } });
  if (!pack.ok) throw new Error('parity pack is invalid: ' + pack.errors.join('; '));
  const fixtureFile = resolve(opts.fixtures || DEFAULTS.parityFixtures), fixtures = readJsonl(fixtureFile);
  const fixtureCheck = validateParityFixtures(tasks, fixtures);
  if (!fixtureCheck.ok) throw new Error('parity fixtures are invalid: ' + fixtureCheck.errors.join('; '));
  const starnetRows = applyIndependentParityGrades({ tasks, fixtures, rows: readJsonl(resolve(opts.starnet)) });
  const referenceRows = applyIndependentParityGrades({ tasks, fixtures, rows: readJsonl(resolve(opts.reference)) });
  const result = compareHarnesses({ tasks, starnetRows, referenceRows, contract });
  const evidence = { tasks: fileEvidence(opts.tasks || DEFAULTS.parityPack), fixtures: fileEvidence(fixtureFile),
    independentGrader: fileEvidence(join(HERE, 'independent-grader.mjs')), starnet: fileEvidence(opts.starnet), reference: fileEvidence(opts.reference) };
  if (opts['subject-manifest']) evidence.subjectManifest = manifestEvidence(opts['subject-manifest']);
  if (opts['reference-manifest']) evidence.referenceManifest = manifestEvidence(opts['reference-manifest']);
  const receipt = makeReceipt({ kind: 'parity', contract, subject: subjectMeta(opts), reference: referenceMeta(opts, contract), result, evidence });
  writeSignedReceipt(opts.receipt || join('.dogfood', 'eval', 'parity-receipt.json'), receipt, opts);
  console.log(`[agent-eval] PARITY ${result.pass ? 'PASS' : 'FAIL'} StarNet=${result.summary.starnetPassRatePct.toFixed(1)}% reference=${result.summary.referencePassRatePct.toFixed(1)}% gap=${result.summary.gapPoints.toFixed(1)}pt`);
  return result.pass ? 0 : 1;
}

async function baseline(opts) {
  const contract = readJson(opts.contract || DEFAULTS.contract);
  const contractResult = validateComparisonContract(contract, readJson(opts.claims || DEFAULTS.claims));
  if (!contractResult.ok) throw new Error('comparison contract is invalid: ' + contractResult.errors.join('; '));
  const { collectPerformanceBaseline } = await import('./performance.mjs');
  const result = await collectPerformanceBaseline({ samples: Number(opts.samples || 15) });
  const receipt = makeReceipt({ kind: 'performance', contract, subject: subjectMeta(opts), result,
    evidence: { scope: 'dependency-free source harness; no provider or installed desktop' },
    limitations: ['first-token, useful-artifact, installed cold-boot, and 48-hour resource measurements remain pending'] });
  writeSignedReceipt(opts.receipt || join('.dogfood', 'eval', 'performance-baseline.json'), receipt, opts);
  console.log(`[agent-eval] PERFORMANCE BASELINE samples=${result.samples} bridgeMedian=${result.measurements.bridgeAdapterPackMs.median}ms evalMedian=${result.measurements.evaluationPackMs.median}ms`);
  return 0;
}

function performanceProbe(opts) {
  if (!opts.probe) throw new Error('performance-probe requires --probe <same-model-probe.json>');
  const contract = readJson(opts.contract || DEFAULTS.contract), probe = readJson(opts.probe);
  const result = {
    pass: probe.pass === true,
    sameModel: probe.sameModel === true,
    measurements: {
      starnetInstalledSidecarBootMs: probe.starnet && probe.starnet.bootMs,
      starnetFirstTokenMs: probe.starnet && probe.starnet.firstTokenMs,
      starnetTotalMs: probe.starnet && probe.starnet.totalMs,
      hermesFirstOutputMs: probe.hermes && probe.hermes.firstOutputMs,
      hermesTotalMs: probe.hermes && probe.hermes.totalMs
    },
    outcomes: {
      starnet: { ok: !!(probe.starnet && probe.starnet.ok), status: probe.starnet && probe.starnet.status, tokens: probe.starnet && probe.starnet.usage && probe.starnet.usage.total_tokens },
      hermes: { ok: !!(probe.hermes && probe.hermes.ok), exitCode: probe.hermes && probe.hermes.exitCode, tokens: probe.hermes && probe.hermes.usage && probe.hermes.usage.total_tokens }
    }
  };
  const evidence = { probe: fileEvidence(opts.probe) };
  if (opts['subject-manifest']) evidence.subjectManifest = manifestEvidence(opts['subject-manifest']);
  if (opts['reference-manifest']) evidence.referenceManifest = manifestEvidence(opts['reference-manifest']);
  const receipt = makeReceipt({ kind: 'performance', contract, subject: subjectMeta(opts), reference: referenceMeta(opts, contract), result, evidence,
    limitations: ['single preflight only; StarNet provider run failed before first token', 'desktop cold boot and 48-hour resource soak remain unmeasured'] });
  writeSignedReceipt(opts.receipt || join('.dogfood', 'eval', 'performance-probe-receipt.json'), receipt, opts);
  console.log(`[agent-eval] PERFORMANCE PROBE ${result.pass ? 'PASS' : 'FAIL'} StarNetBoot=${Number(result.measurements.starnetInstalledSidecarBootMs || 0).toFixed(1)}ms`);
  return result.pass ? 0 : 1;
}

async function captureFault(opts) {
  const contract = readJson(opts.contract || DEFAULTS.contract);
  const tasks = readJsonl(resolve(opts.tasks || DEFAULTS.faultPack));
  const repeats = Number(opts.repeats || contract.gates.deterministicCriticalRepeat);
  if (!opts.out) throw new Error('capture-fault requires --out <trajectory.jsonl>');
  if (repeats !== contract.gates.deterministicCriticalRepeat) throw new Error(`capture-fault repeats must equal frozen contract value ${contract.gates.deterministicCriticalRepeat}`);
  const { runFaultAdapters } = await import('./adapters/fault.mjs');
  const rows = await runFaultAdapters({ tasks, repeats });
  ensureParent(opts.out); writeJsonl(resolve(opts.out), rows);
  console.log(`[agent-eval] FAULT CAPTURE rows=${rows.length} passed=${rows.filter(row => row.outcome && row.outcome.passed).length} failed=${rows.filter(row => !row.outcome || !row.outcome.passed).length}`);
  console.log('[agent-eval] trajectories ' + resolve(opts.out));
  return 0;
}

function markUnavailable(opts) {
  if (!opts.out || !opts.harness || !opts.reason) throw new Error('mark-unavailable requires --out, --harness, and --reason');
  const contract = readJson(opts.contract || DEFAULTS.contract);
  const tasks = readJsonl(resolve(opts.tasks || DEFAULTS.parityPack));
  const repeats = contract.gates.ordinaryRunsPerScenario;
  const rows = [];
  for (const task of tasks) for (let attempt = 1; attempt <= repeats; attempt++) rows.push({
    schemaVersion: 'starnet.eval.trajectory.v1', taskId: task.id, attempt,
    runId: `unavailable-${opts.harness}-${task.id}-${attempt}`, events: [], artifacts: [], finalText: '',
    outcome: { passed: false, evidence: { status: 'not-executed', harness: opts.harness, reason: opts.reason } }
  });
  ensureParent(opts.out); writeJsonl(resolve(opts.out), rows);
  console.log(`[agent-eval] UNAVAILABLE harness=${opts.harness} rows=${rows.length} reason=${opts.reason}`);
  return 0;
}

function keygen(opts) {
  if (!opts.private || !opts.public) throw new Error('keygen requires --private <pem> and --public <pem>');
  const result = generateReceiptKeyPair(opts.private, opts.public);
  console.log(`[agent-eval] KEYGEN Ed25519 keyId=${result.keyId} public=${result.publicFile}`);
  return 0;
}

function verifyReceipt(opts) {
  if (!opts.receipt) throw new Error('verify-receipt requires --receipt <json>');
  const result = verifyReceiptSignature(readJson(opts.receipt));
  console.log(`[agent-eval] SIGNATURE ${result.ok ? 'PASS' : 'FAIL'}${result.keyId ? ' keyId=' + result.keyId : ' — ' + result.reason}`);
  return result.ok ? 0 : 1;
}

async function bind(opts) {
  if (!opts.profile || !opts.manifest) throw new Error('bind requires --profile <starnet|hermes> and --manifest <json>');
  let manifest;
  if (opts.profile === 'starnet') manifest = await bindStarNet({
    sourceDir: opts['source-dir'], runtimeRoot: opts['runtime-root'], executable: opts.executable,
    runtimeNode: opts['runtime-node'], commit: opts.commit, tree: opts.tree, version: opts.version,
    describe: opts.describe, healthUrl: opts['health-url']
  });
  else if (opts.profile === 'hermes') {
    const contract = readJson(opts.contract || DEFAULTS.contract), ref = contract.reference;
    manifest = bindHermes({ sourceDir: opts['source-dir'], executable: opts.executable, homeDir: opts['home-dir'],
      commit: ref.commit, tree: ref.sourceTree, version: ref.version, tag: ref.tag, tagObject: ref.tagObject });
  } else throw new Error('bind --profile must be starnet or hermes');
  ensureParent(opts.manifest);
  writeFileSync(resolve(opts.manifest), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`[agent-eval] BIND PASS ${manifest.subject.name} ${manifest.subject.version} commit=${manifest.subject.commit} executable=${manifest.subject.executable.sha256}`);
  console.log('[agent-eval] manifest ' + resolve(opts.manifest));
  return 0;
}

function help() {
  console.log('usage: runner.mjs [run|record|contract|capture-fault|mark-unavailable|fault|compare|baseline|performance-probe|bind|keygen|verify-receipt] [options]');
  console.log('receipts: --subject-manifest <json> --reference-manifest <json> --signing-key <private.pem>');
  return 0;
}

try {
  const opts = argsOf(process.argv.slice(2));
  const command = opts._[0] || 'run';
  if (opts.help) process.exitCode = help();
  else if (command === 'run') process.exitCode = await run(opts);
  else if (command === 'record') process.exitCode = record(opts);
  else if (command === 'contract') process.exitCode = contractCheck(opts);
  else if (command === 'fault') process.exitCode = fault(opts);
  else if (command === 'compare') process.exitCode = compare(opts);
  else if (command === 'baseline') process.exitCode = await baseline(opts);
  else if (command === 'performance-probe') process.exitCode = performanceProbe(opts);
  else if (command === 'capture-fault') process.exitCode = await captureFault(opts);
  else if (command === 'mark-unavailable') process.exitCode = markUnavailable(opts);
  else if (command === 'bind') process.exitCode = await bind(opts);
  else if (command === 'keygen') process.exitCode = keygen(opts);
  else if (command === 'verify-receipt') process.exitCode = verifyReceipt(opts);
  else if (command === 'help') process.exitCode = help();
  else throw new Error('usage: runner.mjs [run|record|contract|capture-fault|mark-unavailable|fault|compare|baseline|performance-probe|bind|keygen|verify-receipt] [options]');
} catch (error) {
  console.error('[agent-eval] ERROR ' + ((error && error.message) || error));
  process.exitCode = 2;
}
