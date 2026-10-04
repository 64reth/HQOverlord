#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function argsOf(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[String(argv[i] || '').replace(/^--/, '')] = argv[i + 1];
  return out;
}

function sha256(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

function json(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function jsonl(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
  });
}

function writeAtomic(file, value) {
  const target = resolve(file), temp = `${target}.tmp`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(temp, target);
}

const opts = argsOf(process.argv.slice(2));
for (const key of ['contract', 'candidate-manifest', 'reference-manifest', 'fixtures', 'tasks', 'installed-executable', 'credential-envelope', 'rotation-after', 'output']) {
  if (!opts[key]) throw new Error(`missing --${key}`);
}

const paths = Object.fromEntries(Object.entries({
  contract: opts.contract,
  candidateManifest: opts['candidate-manifest'],
  referenceManifest: opts['reference-manifest'],
  fixtures: opts.fixtures,
  tasks: opts.tasks,
  installedExecutable: opts['installed-executable'],
  credentialEnvelope: opts['credential-envelope'],
  output: opts.output
}).map(([key, value]) => [key, resolve(value)]));
const rotationAfterMs = Date.parse(opts['rotation-after']);
if (!Number.isFinite(rotationAfterMs)) throw new Error('invalid --rotation-after timestamp');

const contract = json(paths.contract);
const candidate = json(paths.candidateManifest);
const reference = json(paths.referenceManifest);
const fixtures = jsonl(paths.fixtures);
const tasks = jsonl(paths.tasks);
const checks = [];
const check = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), detail });

const expectedReference = contract.reference || {};
const candidateSubject = candidate.subject || {};
const referenceSubject = reference.subject || {};
const candidateExecutable = candidateSubject.executable || {};
const referenceExecutable = referenceSubject.executable || {};

check('contract-release', contract.release === '0.9.0', String(contract.release || 'missing'));
check('contract-runs-per-scenario', contract.gates && contract.gates.ordinaryRunsPerScenario === 3,
  String(contract.gates && contract.gates.ordinaryRunsPerScenario));
check('candidate-provenance', candidateSubject.dirty === false && candidateSubject.provenance && candidateSubject.provenance.verified === true,
  `${candidateSubject.commit || 'missing'} / ${candidateSubject.provenance && candidateSubject.provenance.kind || 'missing'}`);
check('candidate-build-executable', Boolean(candidateExecutable.path) && sha256(resolve(candidateExecutable.path)) === candidateExecutable.sha256,
  candidateExecutable.sha256 || 'missing');
check('installed-candidate-match', sha256(paths.installedExecutable) === candidateExecutable.sha256,
  `installed=${sha256(paths.installedExecutable)} candidate=${candidateExecutable.sha256 || 'missing'}`);

check('reference-identity', referenceSubject.name === expectedReference.name && referenceSubject.version === expectedReference.version &&
  referenceSubject.commit === expectedReference.commit && referenceSubject.sourceTree && referenceSubject.sourceTree.value === expectedReference.sourceTree,
  `${referenceSubject.name || 'missing'} ${referenceSubject.version || 'missing'} ${referenceSubject.commit || 'missing'}`);
check('reference-provenance', referenceSubject.dirty === false && referenceSubject.provenance && referenceSubject.provenance.verified === true,
  referenceSubject.provenance && referenceSubject.provenance.kind || 'missing');
check('reference-executable', Boolean(referenceExecutable.path) && sha256(resolve(referenceExecutable.path)) === referenceExecutable.sha256,
  referenceExecutable.sha256 || 'missing');

const fixtureIds = fixtures.map(row => row.taskId);
const taskIds = tasks.map(row => row.id);
const uniqueFixtureIds = new Set(fixtureIds), uniqueTaskIds = new Set(taskIds);
check('fixture-count', fixtures.length === 32 && uniqueFixtureIds.size === 32, `${fixtures.length} rows / ${uniqueFixtureIds.size} unique`);
check('task-count', tasks.length === 32 && uniqueTaskIds.size === 32, `${tasks.length} rows / ${uniqueTaskIds.size} unique`);
check('fixture-task-bijection', fixtureIds.every(id => uniqueTaskIds.has(id)) && taskIds.every(id => uniqueFixtureIds.has(id)),
  `fixtures=${uniqueFixtureIds.size} tasks=${uniqueTaskIds.size}`);
check('fixtures-independent', fixtures.every(row => row.schemaVersion === 'starnet.eval.fixture.v1' && row.fixtureId && row.prompt && row.setup && row.oracle && Array.isArray(row.oracle.checks) && row.oracle.checks.length > 0),
  `packSha256=${sha256(paths.fixtures)}`);
check('tasks-active', tasks.every(row => row.status === 'active'), `${tasks.filter(row => row.status === 'active').length}/${tasks.length}`);

const credentialStat = statSync(paths.credentialEnvelope);
check('credential-rotated', credentialStat.mtimeMs > rotationAfterMs,
  `lastWrite=${credentialStat.mtime.toISOString()} requiredAfter=${new Date(rotationAfterMs).toISOString()}`);

const report = {
  schemaVersion: 'starnet.eval.campaign-preflight.v1',
  generatedAt: new Date().toISOString(),
  pass: checks.every(row => row.pass),
  release: contract.release,
  plannedAttemptsPerHarness: contract.gates && contract.gates.ordinaryRunsPerScenario,
  plannedRowsPerHarness: fixtures.length * Number(contract.gates && contract.gates.ordinaryRunsPerScenario || 0),
  identities: {
    candidate: { commit: candidateSubject.commit, executableSha256: candidateExecutable.sha256 },
    reference: { commit: referenceSubject.commit, executableSha256: referenceExecutable.sha256 }
  },
  credentialMetadata: {
    lastWriteUtc: credentialStat.mtime.toISOString(),
    requiredAfterUtc: new Date(rotationAfterMs).toISOString(),
    contentsRead: false
  },
  checks,
  limitations: [
    'This preflight authorizes no provider spend and executes no workload.',
    'Credential contents are never read; freshness is metadata-only.',
    'A green preflight does not replace trajectory capture, independent grading, signed receipts, performance measurement, or soak evidence.'
  ]
};
writeAtomic(paths.output, report);
for (const row of checks) console.log(`[agent-eval] ${row.pass ? 'PASS' : 'BLOCKED'} ${row.id}: ${row.detail}`);
console.log(`[agent-eval] CAMPAIGN PREFLIGHT ${report.pass ? 'PASS' : 'BLOCKED'} output=${paths.output}`);
process.exitCode = report.pass ? 0 : 1;
