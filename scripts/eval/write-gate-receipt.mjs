/* write-gate-receipt.mjs — runs the credential-free eval slice and writes ONE durable receipt.
 *
 * Steps (all deterministic, no provider, no credential, no public network):
 *   1. contract        — frozen v0.9.0 comparison contract vs the live claims ledger
 *   2. agent-quality   — 13-row deterministic pack through the real runAgentLoop
 *   3. fault-capture   — 10 run-boundary scenarios x 100 repeats = 1000 host-observed rows
 *   4. fault-grade     — frozen-contract fault gauntlet over those 1000 rows
 *   5. parity-offline  — 32 parity scenarios + 4 deliberate-violation probes (plumbing only)
 *
 * The receipt lands in qa/eval-receipts/ (committed home; .dogfood/ is gitignored and past
 * signed receipts there are unrecoverable). Honesty flags are forced in code: this receipt
 * proves harness plumbing on the source tree — never model quality, never an installed
 * candidate, and never the frozen v0.9.0 contract gates.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDeep } from './core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const RECEIPT_FILE = join(ROOT, 'qa', 'eval-receipts', 'last-gate-receipt.json');
// Relative on purpose: steps run with cwd=ROOT, and the committed receipt must not embed
// machine-local absolute paths (core.mjs redaction is applied to the whole receipt as well).
const FAULT_TRAJECTORIES = '.dogfood/eval/gate/fault-trajectories.jsonl';
const FAULT_RECEIPT = '.dogfood/eval/gate/fault-receipt.json';

const PACK_FILES = {
  contract: 'scripts/eval/contracts/v0.9.0.json',
  claimsLedger: 'qa/product-perfect/claims.json',
  qualityTasks: 'scripts/eval/fixtures/tasks.jsonl',
  qualityBaseline: 'scripts/eval/fixtures/baseline.jsonl',
  faultPack: 'scripts/eval/packs/fault-v0.9.0.jsonl',
  parityPack: 'scripts/eval/packs/parity-v0.9.0.jsonl',
  parityFixtures: 'scripts/eval/fixtures/parity-v0.9.0.jsonl',
  independentGrader: 'scripts/eval/independent-grader.mjs'
};

export const STEPS = [
  { id: 'contract', pack: 'contract', args: ['scripts/eval/runner.mjs', 'contract'],
    parse: { claims: /CONTRACT PASS claims=(\d+)/ } },
  { id: 'agent-quality', pack: 'quality', args: ['scripts/eval/runner.mjs', 'run'],
    parse: { activeRows: /PASS active=(\d+)/, quality: /quality=([\d.]+)/ } },
  { id: 'fault-capture', pack: 'fault', args: ['scripts/eval/runner.mjs', 'capture-fault', '--out', FAULT_TRAJECTORIES],
    parse: { rows: /FAULT CAPTURE rows=(\d+)/, passedRows: /passed=(\d+)/ } },
  { id: 'fault-grade', pack: 'fault', args: ['scripts/eval/runner.mjs', 'fault', '--candidate', FAULT_TRAJECTORIES, '--receipt', FAULT_RECEIPT],
    parse: { passedRows: /FAULT PASS passed=(\d+)\/(?:\d+)/ } },
  { id: 'parity-offline', pack: 'parity', args: ['scripts/eval/adapters/parity-offline.mjs'],
    parse: { scenarios: /scenarios=(\d+)\/32/, probes: /probes=(\d+)\/4/ } }
];

function sha256File(file) { return createHash('sha256').update(readFileSync(resolve(ROOT, file))).digest('hex'); }
function git(args, fallback = '') {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch (_) { return fallback; }
}

export function runStep(step) {
  const startedAt = Date.now();
  const child = spawnSync(process.execPath, step.args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const durationMs = Date.now() - startedAt;
  const output = String(child.stdout || '') + String(child.stderr || '');
  const summaryLines = output.split(/\r?\n/)
    .filter(line => /^\[(agent-eval|parity-offline)\]/.test(line) && !/^\[agent-eval\] (PASS|FAIL) [a-z]/.test(line))
    .map(line => line.split(resolve(ROOT)).join('<repo>').split(resolve(ROOT).replace(/\\/g, '/')).join('<repo>'));
  const parsed = {};
  for (const [name, pattern] of Object.entries(step.parse || {})) {
    const hit = output.match(pattern);
    parsed[name] = hit ? Number(hit[1]) : null;
  }
  return { id: step.id, pack: step.pack, command: ['node', ...step.args.map(arg => arg.replace(/\\/g, '/'))].join(' '),
    exitCode: child.status, pass: child.status === 0, durationMs, parsed, summaryLines, output };
}

/* Load-bearing honesty guard: the gate receipt may never claim more than the slice proved. */
export function assertGateReceiptHonesty(receipt) {
  const honesty = receipt && receipt.honesty;
  if (!honesty) throw new Error('gate receipt must carry an honesty block');
  for (const [flag, expected] of [['liveModel', false], ['candidateBound', false], ['provesModelQuality', false], ['satisfiesV090ContractGates', false]]) {
    if (honesty[flag] !== expected) throw new Error(`gate receipt honesty.${flag} must be ${expected}`);
  }
  if (typeof honesty.signed !== 'boolean') throw new Error('gate receipt honesty.signed must be an explicit boolean');
  if (receipt.kind !== 'credential-free-eval-gate') throw new Error('gate receipt kind must be credential-free-eval-gate');
  return receipt;
}

export function buildGateReceipt(stepResults) {
  const receipt = {
    schemaVersion: 'starnet.eval.gate-receipt.v1',
    kind: 'credential-free-eval-gate',
    generatedAt: new Date().toISOString(),
    // dirty excludes ONLY the receipt home: this receipt writes itself into qa/eval-receipts/,
    // so counting that path would make every receipt self-report dirty. Everything else counts.
    git: {
      commit: git(['rev-parse', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: git(['status', '--porcelain'], '').split(/\r?\n/).filter(line => line.trim() && !/ qa\/eval-receipts\//.test(line)).length > 0,
      dirtyExcludes: ['qa/eval-receipts/']
    },
    platform: { platform: process.platform, arch: process.arch, node: process.version },
    packs: Object.fromEntries(Object.entries(PACK_FILES).map(([name, file]) => [name, { path: file, sha256: sha256File(file) }])),
    expectedCounts: { faultScenarios: 10, faultRepeats: 100, faultRows: 1000, qualityRows: 13, parityScenarios: 32, parityProbes: 4 },
    grader: { file: PACK_FILES.independentGrader, sha256: sha256File(PACK_FILES.independentGrader), gradeSchema: 'starnet.eval.independent-grade.v1' },
    steps: stepResults.map(({ output, ...step }) => step),
    verdict: {
      pass: stepResults.length === STEPS.length && stepResults.every(step => step.pass),
      perPack: Object.fromEntries(['contract', 'quality', 'fault', 'parity'].map(pack => [
        pack, stepResults.filter(step => step.pack === pack).every(step => step.pass) && stepResults.some(step => step.pack === pack)
      ]))
    },
    honesty: {
      liveModel: false,
      candidateBound: false,
      signed: false,
      provesModelQuality: false,
      satisfiesV090ContractGates: false,
      notes: [
        'Source-tree run with scripted in-process providers; no provider credential was used and no live model produced any output.',
        'This proves harness plumbing (loop, journal, channel, transcript, fixture-oracle, grader detection) on this commit — it is NOT evidence of model quality or scenario outcomes under a real model.',
        'It does not replace the frozen v0.9.0 contract campaign (installed candidate, live keys, Hermes reference, signed receipts under .dogfood with committed hash indexes).'
      ]
    }
  };
  return assertGateReceiptHonesty(receipt);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    mkdirSync(dirname(FAULT_TRAJECTORIES), { recursive: true });
    mkdirSync(dirname(RECEIPT_FILE), { recursive: true });
    const results = [];
    for (const step of STEPS) {
      console.log(`[eval-gate] step ${step.id} ...`);
      const result = runStep(step);
      process.stdout.write(result.output);
      console.log(`[eval-gate] step ${step.id} ${result.pass ? 'PASS' : 'FAIL'} exit=${result.exitCode} wallMs=${result.durationMs}`);
      results.push(result);
    }
    const receipt = redactDeep(buildGateReceipt(results));
    assertGateReceiptHonesty(receipt);
    writeFileSync(RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
    console.log('[eval-gate] receipt ' + RECEIPT_FILE);
    console.log(`[eval-gate] ${receipt.verdict.pass ? 'PASS' : 'FAIL'} ` +
      Object.entries(receipt.verdict.perPack).map(([pack, ok]) => `${pack}=${ok ? 'pass' : 'FAIL'}`).join(' ') +
      ' liveModel=false provesModelQuality=false');
    process.exitCode = receipt.verdict.pass ? 0 : 1;
  } catch (error) {
    console.error('[eval-gate] ERROR ' + ((error && error.message) || error));
    process.exitCode = 2;
  }
}
