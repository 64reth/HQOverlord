#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { makeReceipt } from './comparison.mjs';
import { manifestEvidence, validateManifest } from './bind.mjs';
import { signReceipt } from './receipt-signing.mjs';

const EXPECTED_SCHEMA = 'starnet.eval.same-model-probe.v1';
const EXPECTED_PROMPT = 'Return exactly PARITY-PROBE-731 and no other text.';
const EXPECTED_TEXT = 'PARITY-PROBE-731';
const EXPECTED_PROVIDER = 'openai-codex';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1];
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(file), 'utf8').replace(/^\uFEFF/, ''));
}

function fileEvidence(file) {
  const path = resolve(file), body = readFileSync(path);
  return { path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}

function stats(values) {
  const ordered = values.map(Number).sort((a, b) => a - b);
  return { min: ordered[0], median: ordered[Math.floor(ordered.length / 2)], max: ordered[ordered.length - 1] };
}

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function check(id, pass, actual, expected) {
  return { id, pass: pass === true, actual, expected };
}

const opts = argsOf(process.argv.slice(2));
for (const name of ['probes', 'subject-manifest', 'reference-manifest', 'contract', 'signing-key', 'receipt']) {
  if (!opts[name]) throw new Error(`missing --${name}`);
}

const probeFiles = opts.probes.split(',').map(value => value.trim()).filter(Boolean);
const probes = probeFiles.map(readJson);
const contract = readJson(opts.contract);
const subject = validateManifest(readJson(opts['subject-manifest'])).subject;
const reference = validateManifest(readJson(opts['reference-manifest'])).subject;
if (reference.commit !== contract.reference.commit || reference.sourceTree.value !== contract.reference.sourceTree || reference.version !== contract.reference.version) {
  throw new Error('reference manifest does not match the frozen contract identity');
}

const model = probes[0] && probes[0].comparisonModel;
const checks = [
  check('three-distinct-attempts', probes.length === 3 && new Set(probeFiles.map(file => resolve(file))).size === 3,
    { attempts: probes.length, distinctFiles: new Set(probeFiles.map(file => resolve(file))).size }, { attempts: 3, distinctFiles: 3 }),
  check('probe-schema', probes.length === 3 && probes.every(row => row.schemaVersion === EXPECTED_SCHEMA),
    probes.map(row => row.schemaVersion), Array(3).fill(EXPECTED_SCHEMA)),
  check('exact-prompt', probes.length === 3 && probes.every(row => row.prompt === EXPECTED_PROMPT),
    probes.map(row => row.prompt), Array(3).fill(EXPECTED_PROMPT)),
  check('same-explicit-model', !!model && probes.length === 3 && probes.every(row => row.comparisonModel === model && row.starnet?.model === model && row.hermes?.model === model && row.sameModel === true),
    probes.map(row => ({ comparison: row.comparisonModel, starnet: row.starnet?.model, reference: row.hermes?.model, sameModel: row.sameModel })),
    `three attempts with one explicit model (${model || 'missing'})`),
  check('same-provider', probes.length === 3 && probes.every(row => row.starnet?.provider === EXPECTED_PROVIDER && row.hermes?.provider === EXPECTED_PROVIDER),
    probes.map(row => ({ starnet: row.starnet?.provider, reference: row.hermes?.provider })), Array(3).fill(EXPECTED_PROVIDER)),
  check('exact-output', probes.length === 3 && probes.every(row => row.starnet?.text === EXPECTED_TEXT && row.hermes?.text === EXPECTED_TEXT),
    probes.map(row => ({ starnet: row.starnet?.text, reference: row.hermes?.text })), Array(3).fill(EXPECTED_TEXT)),
  check('successful-outcomes', probes.length === 3 && probes.every(row => row.pass === true && row.starnet?.ok === true && row.hermes?.ok === true),
    probes.map(row => ({ pass: row.pass, starnet: row.starnet?.ok, reference: row.hermes?.ok })), 'all true'),
  check('complete-timings', probes.length === 3 && probes.every(row => finitePositive(row.starnet?.bootMs) && finitePositive(row.starnet?.firstTokenMs) && finitePositive(row.starnet?.totalMs) && finitePositive(row.hermes?.firstOutputMs) && finitePositive(row.hermes?.totalMs)),
    probes.map(row => ({ starnetBootMs: row.starnet?.bootMs, starnetFirstOutputMs: row.starnet?.firstTokenMs, starnetTotalMs: row.starnet?.totalMs, referenceFirstOutputMs: row.hermes?.firstOutputMs, referenceTotalMs: row.hermes?.totalMs })),
    'five finite positive measurements per attempt'),
  check('complete-token-usage', probes.length === 3 && probes.every(row => finitePositive(row.starnet?.usage?.total_tokens) && finitePositive(row.hermes?.usage?.total_tokens)),
    probes.map(row => ({ starnet: row.starnet?.usage?.total_tokens, reference: row.hermes?.usage?.total_tokens })), 'positive total tokens for both harnesses')
];

const canSummarize = probes.length > 0 && probes.every(row => row.starnet && row.hermes);
const measurements = canSummarize ? {
  starnet: {
    sidecarBootMs: stats(probes.map(row => row.starnet.bootMs)),
    firstOutputMs: stats(probes.map(row => row.starnet.firstTokenMs)),
    totalMs: stats(probes.map(row => row.starnet.totalMs)),
    totalTokens: stats(probes.map(row => row.starnet.usage?.total_tokens))
  },
  reference: {
    firstOutputMs: stats(probes.map(row => row.hermes.firstOutputMs)),
    totalMs: stats(probes.map(row => row.hermes.totalMs)),
    totalTokens: stats(probes.map(row => row.hermes.usage?.total_tokens))
  }
} : null;

const result = {
  schemaVersion: 'starnet.eval.same-model-performance.v1',
  pass: checks.every(row => row.pass),
  attempts: probes.length,
  provider: EXPECTED_PROVIDER,
  comparisonModel: model || null,
  measurements,
  checks
};
const receipt = makeReceipt({
  kind: 'performance', contract, subject, reference, result,
  evidence: {
    probes: probeFiles.map(fileEvidence),
    subjectManifest: manifestEvidence(opts['subject-manifest']),
    referenceManifest: manifestEvidence(opts['reference-manifest'])
  },
  limitations: [
    'The StarNet measurements launch the bound installed runtime node/sidecar directly; they do not measure desktop UI cold boot.',
    'The exact-output probe is a provider/model equivalence preflight, not the 32-scenario parity gauntlet or a useful-artifact benchmark.',
    'The provider-free control soak cannot replace the pending installed provider-backed 48-hour soak.'
  ]
});
signReceipt(receipt, opts['signing-key']);
mkdirSync(dirname(resolve(opts.receipt)), { recursive: true });
writeFileSync(resolve(opts.receipt), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log(`[agent-eval] SAME MODEL RECEIPT ${result.pass ? 'PASS' : 'FAIL'} attempts=${result.attempts} model=${result.comparisonModel || '(missing)'}`);
if (measurements) console.log(`[agent-eval] medians StarNet first=${measurements.starnet.firstOutputMs.median.toFixed(1)}ms total=${measurements.starnet.totalMs.median.toFixed(1)}ms reference first=${measurements.reference.firstOutputMs.median.toFixed(1)}ms total=${measurements.reference.totalMs.median.toFixed(1)}ms`);
console.log('[agent-eval] receipt ' + resolve(opts.receipt));
process.exitCode = result.pass ? 0 : 1;
