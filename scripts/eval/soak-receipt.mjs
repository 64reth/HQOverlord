#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeReceipt } from './comparison.mjs';
import { signReceipt } from './receipt-signing.mjs';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1];
  return out;
}
const json = file => JSON.parse(readFileSync(resolve(file), 'utf8'));
const hash = file => createHash('sha256').update(readFileSync(resolve(file))).digest('hex');
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;

const opts = argsOf(process.argv.slice(2));
for (const key of ['soak', 'manifest', 'contract', 'signing-key', 'receipt']) if (!opts[key]) throw new Error(`missing --${key}`);
const soakPath = resolve(opts.soak), manifestPath = resolve(opts.manifest), receiptPath = resolve(opts.receipt);
const soak = json(soakPath), manifest = json(manifestPath), contract = json(opts.contract);
const summary = soak.summary || {}, samples = Array.isArray(soak.samples) ? soak.samples : [];
const plannedSamples = finite(soak.durationHours) != null && finite(soak.intervalSeconds) > 0
  ? Number(soak.durationHours) * 3600 / Number(soak.intervalSeconds) : 0;
const minimumSamples = Math.max(1, Math.floor(plannedSamples * 0.99));
const plannedEnd = Date.parse(soak.plannedEndAt), ended = Date.parse(soak.endedAt);
const describe = String(soak.runtime && soak.runtime.describe || '');
const subject = manifest.subject || {};
const manifestDescribe = String(subject.provenance && subject.provenance.describe || '');
const sampleTimes = samples.map(row => Date.parse(row && row.at));
const sampleGaps = sampleTimes.slice(1).map((time, index) => (time - sampleTimes[index]) / 1000);
const maxAllowedGapSeconds = Number(soak.intervalSeconds) * 1.5 + 5;
const cpu = samples.map(row => finite(row && row.cpuSeconds));
const resourceEvidenceRequired = subject.platform && subject.platform.platform === 'win32';
const checks = [
  { id: 'provider-free-mode', pass: soak.mode === 'provider-free-control-plane' && soak.qualifiesRelease === false,
    actual: { mode: soak.mode, qualifiesRelease: soak.qualifiesRelease }, expected: { mode: 'provider-free-control-plane', qualifiesRelease: false } },
  { id: 'completed', pass: summary.completed === true && soak.interrupted === false && Number.isFinite(ended) && Number.isFinite(plannedEnd) && ended >= plannedEnd,
    actual: { completed: summary.completed, interrupted: soak.interrupted, endedAt: soak.endedAt }, expected: { completed: true, interrupted: false, endedAt: `>=${soak.plannedEndAt}` } },
  { id: 'sample-coverage', pass: samples.length === summary.healthChecks && samples.length >= minimumSamples,
    actual: { samples: samples.length, healthChecks: summary.healthChecks }, expected: { minimumSamples } },
  { id: 'sampling-cadence', pass: sampleTimes.every(Number.isFinite) && sampleGaps.every(gap => gap > 0 && gap <= maxAllowedGapSeconds),
    actual: { invalidTimestamps: sampleTimes.filter(time => !Number.isFinite(time)).length,
      nonMonotonicGaps: sampleGaps.filter(gap => !(gap > 0)).length,
      gapsOverLimit: sampleGaps.filter(gap => gap > maxAllowedGapSeconds).length,
      maximumGapSeconds: sampleGaps.length ? Math.max(...sampleGaps) : null },
    expected: { strictlyIncreasing: true, maximumGapSeconds: `<=${maxAllowedGapSeconds}` } },
  { id: 'health', pass: summary.healthFailures === 0 && samples.every(row => row && row.ok === true && row.status === 200),
    actual: { failures: summary.healthFailures, badSamples: samples.filter(row => !row || row.ok !== true || row.status !== 200).length }, expected: { failures: 0, badSamples: 0 } },
  { id: 'process-survival', pass: summary.unexpectedExits === 0 && samples.every(row => row.exited === false),
    actual: { unexpectedExits: summary.unexpectedExits, exitedSamples: samples.filter(row => row && row.exited !== false).length }, expected: { unexpectedExits: 0, exitedSamples: 0 } },
  { id: 'resource-continuity', pass: !resourceEvidenceRequired || (samples.every(row => finite(row && row.rssBytes) > 0 && finite(row && row.cpuSeconds) >= 0) &&
      cpu.slice(1).every((value, index) => value >= cpu[index])),
    actual: { required: Boolean(resourceEvidenceRequired), missingRss: samples.filter(row => !(finite(row && row.rssBytes) > 0)).length,
      missingCpu: cpu.filter(value => !(value >= 0)).length, cpuRegressions: cpu.slice(1).filter((value, index) => !(value >= cpu[index])).length },
    expected: resourceEvidenceRequired ? { missingRss: 0, missingCpu: 0, cpuRegressions: 0 } : 'not required on this platform' },
  { id: 'version-continuity', pass: Boolean(describe) && samples.every(row => String(row.version || '') === describe),
    actual: { expectedDescribe: describe, mismatches: samples.filter(row => String(row && row.version || '') !== describe).length }, expected: { mismatches: 0 } },
  { id: 'candidate-binding', pass: subject.dirty === false && subject.provenance && subject.provenance.verified === true &&
      Boolean(subject.executable && subject.executable.sha256) && manifestDescribe === describe,
    actual: { commit: subject.commit, manifestDescribe, soakDescribe: describe }, expected: 'verified clean executable manifest with matching live describe' }
];
const result = {
  schemaVersion: 'starnet.eval.soak-verdict.v1',
  pass: summary.pass === true && checks.every(row => row.pass),
  scope: 'provider-free-control-plane',
  qualifiesRelease: false,
  startedAt: soak.startedAt,
  endedAt: soak.endedAt,
  durationHours: soak.durationHours,
  intervalSeconds: soak.intervalSeconds,
  samples: samples.length,
  checks,
  resources: { rssBytes: summary.rssBytes || null }
};
const evidenceStat = statSync(soakPath);
let receipt = makeReceipt({
  kind: 'soak-control', contract, subject, result,
  evidence: { path: soakPath, bytes: evidenceStat.size, sha256: hash(soakPath), manifestPath, manifestSha256: hash(manifestPath) },
  limitations: Array.from(new Set([...(Array.isArray(soak.limitations) ? soak.limitations : []),
    'This signed control-plane receipt does not qualify the release and cannot replace installed provider-backed active/idle soak evidence.']))
});
receipt = signReceipt(receipt, opts['signing-key']);
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
console.log(`[agent-eval] SOAK RECEIPT ${result.pass ? 'PASS' : 'FAIL'} samples=${samples.length}/${minimumSamples}+ candidateBound=${receipt.candidateBound}`);
console.log(`[agent-eval] receipt ${receiptPath}`);
process.exitCode = result.pass ? 0 : 1;
