/* node test/eval-comparison.test.js — frozen v0.9 contract, fault/parity gates, and receipt truth. */
'use strict';
const A = require('./_assert.js');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const root = resolve(__dirname, '..');
  const core = await import('../scripts/eval/core.mjs');
  const cmp = await import('../scripts/eval/comparison.mjs');
  const faultAdapters = await import('../scripts/eval/adapters/fault.mjs');
  const independent = await import('../scripts/eval/independent-grader.mjs');
  const contract = JSON.parse(readFileSync(join(root, 'scripts/eval/contracts/v0.9.0.json'), 'utf8'));
  const claims = JSON.parse(readFileSync(join(root, 'qa/product-perfect/claims.json'), 'utf8'));
  const parityTasks = core.readJsonl(join(root, 'scripts/eval/packs/parity-v0.9.0.jsonl'));
  const parityFixtures = core.readJsonl(join(root, 'scripts/eval/fixtures/parity-v0.9.0.jsonl'));
  const faultTasks = core.readJsonl(join(root, 'scripts/eval/packs/fault-v0.9.0.jsonl'));

  const checked = cmp.validateComparisonContract(contract, claims);
  A.ok(checked.ok, 'the v0.9 contract classifies the live claims ledger without drift: ' + checked.errors.join('; '));
  A.eq(contract.reference.tagObject, 'd25e2dbdbc40b49808c0a0e9cfed21cc90cffab3', 'the annotated tag object is recorded separately');
  A.eq(contract.reference.commit, 'cc4cab2f592e60a197e796506de9168f74baf3ea', 'the frozen reference identity is the peeled commit, not the tag object');
  A.eq(checked.summary, {
    claims: 37, classified: 37,
    byClassification: { required: 26, experimental: 2, excluded: 3, differentiator: 6 },
    contractSha256: checked.summary.contractSha256
  }, 'all 37 claim families have exactly one release treatment');
  A.ok(cmp.validateScenarioPack(parityTasks, { expectedCount: 32, categories: {
    'coding-file': 6, 'research-browser': 4, 'document-data': 4, 'memory-history': 4,
    orchestration: 6, 'routine-channel': 4, 'recovery-security': 4
  } }).ok, 'the shared workload pack is frozen at 32 scenarios in the declared category split');
  const fixtureCheck = independent.validateParityFixtures(parityTasks, parityFixtures);
  A.ok(fixtureCheck.ok && fixtureCheck.fixtures === 32, 'all 32 parity scenarios have one independent executable fixture and oracle');
  A.ok(cmp.validateScenarioPack(faultTasks, { expectedCount: 10, categories: { 'run-boundary': 10 } }).ok,
    'the crash gauntlet freezes all ten run boundaries as active critical scenarios');

  const hash = 'a'.repeat(64);
  const trajectory = (task, fault, attempt) => ({
    schemaVersion: core.TRAJECTORY_SCHEMA, taskId: task.id, attempt, runId: 'run-' + task.id + '-' + attempt,
    startedAt: '2026-08-02T12:00:00.000Z', endedAt: '2026-08-02T12:00:00.200Z', finalText: 'done',
    events: [{ seq: 1, at: '2026-08-02T12:00:00.000Z', type: 'agent.run.start', data: {} },
      { seq: 2, at: '2026-08-02T12:00:00.200Z', type: 'agent.run.end', data: { reason: 'done' } }],
    artifacts: [{ path: 'output.bin', sha256: hash, mutatedAt: '2026-08-02T12:00:00.100Z', verifiedSha256: hash, verifiedAt: '2026-08-02T12:00:00.150Z' }],
    outcome: { passed: true, violations: { falseDone: 0, wrongDestination: 0, duplicateMutation: 0, authorityEscape: 0 } },
    routing: { requestedAgentId: 'agent', observedAgentId: 'agent', requestedSessionId: 'session', observedSessionId: 'session', requestedDestination: 'chat:1', deliveredDestination: 'chat:1' },
    fault: fault ? { injectedAt: task.graders.find(row => row.type === 'fault_recovery').injectedAt,
      observedRecovery: task.graders.find(row => row.type === 'fault_recovery').value, ambiguous: false } : undefined
  });
  const fixtureByTask = new Map(parityFixtures.map(fixture => [fixture.taskId, fixture]));
  const parityRows = parityTasks.flatMap(task => [1, 2, 3].map(attempt => {
    const row = trajectory(task, false, attempt), passing = independent.makePassingObservation(fixtureByTask.get(task.id));
    row.finalText = passing.finalText; row.observation = passing.observation;
    return row;
  }));
  const independentlyGraded = independent.applyIndependentParityGrades({ tasks: parityTasks, fixtures: parityFixtures, rows: parityRows });
  A.eq(independentlyGraded.filter(row => row.outcome.passed).length, 96, 'the independent grader derives all 96 ordinary attempts from host observations');
  const realDottedArtifact = JSON.parse(JSON.stringify(parityRows.find(row => row.taskId === 'parity-code-verified-artifact')));
  realDottedArtifact.observation.artifacts = { 'dist/release.txt': { fresh: true, hashMatch: true } };
  realDottedArtifact.observation.files = { 'dist/release.txt': 'VERIFIED-ARTIFACT-731' };
  A.ok(independent.applyIndependentParityGrades({ tasks: parityTasks, fixtures: parityFixtures, rows: [realDottedArtifact] })[0].outcome.passed,
    'nested receipt fields resolve beneath a dotted artifact filename');
  const diskDerivedSeam = JSON.parse(JSON.stringify(parityRows.find(row => row.taskId === 'parity-code-inspect')));
  delete diskDerivedSeam.observation.seam;
  diskDerivedSeam.observation.files = { 'src/ids.js': 'export const normalizeWidgetId = value => String(value);\n' };
  A.ok(independent.applyIndependentParityGrades({ tasks: parityTasks, fixtures: parityFixtures, rows: [diskDerivedSeam] })[0].outcome.passed,
    'the seam is independently derived from captured fixture bytes when no convenience action supplied it');
  const conflictCase = JSON.parse(JSON.stringify(parityRows.find(row => row.taskId === 'parity-code-patch-conflict')));
  conflictCase.finalText = 'Conflict detected; no files were changed.';
  A.ok(independent.applyIndependentParityGrades({ tasks: parityTasks, fixtures: parityFixtures, rows: [conflictCase] })[0].outcome.passed,
    'semantic prose containment is case-insensitive while structural checks remain exact');
  const forged = JSON.parse(JSON.stringify(parityRows));
  forged[0].outcome.passed = true; forged[0].observation.seam = 'forged:1'; forged[0].observation.claimedDone = true;
  const refusedForge = independent.applyIndependentParityGrades({ tasks: parityTasks, fixtures: parityFixtures, rows: forged });
  A.ok(!refusedForge[0].outcome.passed && refusedForge[0].outcome.violations.falseDone === 1,
    'a harness-provided pass cannot override a failed host observation');
  const parity = cmp.compareHarnesses({ tasks: parityTasks, starnetRows: parityRows, referenceRows: parityRows, contract });
  A.ok(parity.pass, 'a fully evidenced equal comparison passes all parity gates');
  A.eq(parity.summary.starnetPassRatePct, 100, 'StarNet pass rate is calculated from active scenarios');
  A.eq(parity.summary.violations, { falseDone: 0, wrongDestination: 0, duplicateMutation: 0, authorityEscape: 0 }, 'zero-tolerance events are counted explicitly');

  const unsafe = JSON.parse(JSON.stringify(parityRows));
  unsafe[0].outcome.violations.falseDone = 1;
  const refused = cmp.compareHarnesses({ tasks: parityTasks, starnetRows: unsafe, referenceRows: parityRows, contract });
  A.ok(!refused.pass && refused.checks.some(row => row.id === 'zero-falseDone' && !row.pass),
    'one false-done event fails the release comparison even when ordinary scoring is otherwise green');

  const faultRows = faultTasks.flatMap(task => Array.from({ length: 100 }, (_, index) => trajectory(task, true, index + 1)));
  const fault = cmp.evaluateFaultGauntlet({ tasks: faultTasks, candidateRows: faultRows, contract });
  A.ok(fault.pass, 'all ten exact recovery outcomes produce a green fault receipt');
  const ambiguous = JSON.parse(JSON.stringify(faultRows));
  ambiguous[3].fault.ambiguous = true;
  A.ok(!cmp.evaluateFaultGauntlet({ tasks: faultTasks, candidateRows: ambiguous, contract }).pass,
    'an ambiguous mutation boundary fails closed');

  const observedFaultRows = await faultAdapters.runFaultAdapters({ tasks: faultTasks, repeats: 2 });
  A.eq(observedFaultRows.filter(row => row.outcome.passed).length, 20,
    'the production-module fault adapters prove all ten boundaries on every attempt');
  A.eq(Array.from(new Set(observedFaultRows.filter(row => !row.outcome.passed).map(row => row.taskId))), [],
    'the adapter receipt leaves no recovery boundary unproved');

  const sourceReceipt = cmp.makeReceipt({ kind: 'parity', contract, subject: { commit: 'b'.repeat(40), sourceTree: { algorithm: 'git-tree', value: 'tree' } }, result: parity });
  A.ok(!sourceReceipt.candidateBound && sourceReceipt.limitations.some(x => /not installed-candidate proof/.test(x)),
    'a source-only receipt names its limitation instead of impersonating installed proof');
  const installedReceipt = cmp.makeReceipt({ kind: 'parity', contract, subject: {
    commit: 'b'.repeat(40), sourceTree: { algorithm: 'git-tree', value: 'tree' }, executable: { path: 'StarNet.exe', sha256: hash },
    provenance: { verified: true }, dirty: false
  }, result: parity });
  A.ok(installedReceipt.candidateBound, 'verified clean provenance + commit + source tree + executable hash bind a receipt to a candidate');
  const unverifiedReceipt = cmp.makeReceipt({ kind: 'parity', contract, subject: {
    commit: 'b'.repeat(40), sourceTree: { algorithm: 'git-tree', value: 'tree' }, executable: { path: 'StarNet.exe', sha256: hash }, dirty: false
  }, result: parity });
  A.ok(!unverifiedReceipt.candidateBound, 'an executable hash cannot bind itself to an unrelated source commit without verified provenance');

  const temp = mkdtempSync(join(tmpdir(), 'starnet-eval-wave-a-'));
  try {
    const starnetFile = join(temp, 'starnet.jsonl');
    const referenceFile = join(temp, 'reference.jsonl');
    const faultFile = join(temp, 'fault.jsonl');
    core.writeJsonl(starnetFile, parityRows); core.writeJsonl(referenceFile, parityRows); core.writeJsonl(faultFile, faultRows);
    const contractCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'contract'], { cwd: root, encoding: 'utf8' });
    A.eq(contractCli.status, 0, 'contract CLI exits zero');
    A.ok(/CONTRACT PASS claims=37 classified=37/.test(contractCli.stdout), 'contract CLI prints a compact frozen-scope receipt');
    const helpCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', '--help'], { cwd: root, encoding: 'utf8' });
    A.eq(helpCli.status, 0, '--help exits without running the default adapter pack');
    A.ok(/usage: runner\.mjs/.test(helpCli.stdout) && !/existing-basic-response/.test(helpCli.stdout), '--help prints usage only');
    const privateKey = join(temp, 'receipt-private.pem'), publicKey = join(temp, 'receipt-public.pem');
    const keygenCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'keygen', '--private', privateKey, '--public', publicKey], { cwd: root, encoding: 'utf8' });
    A.eq(keygenCli.status, 0, 'receipt key generation exits zero');
    const parityReceipt = join(temp, 'parity.json');
    const compareCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'compare', '--starnet', starnetFile, '--reference', referenceFile, '--receipt', parityReceipt, '--signing-key', privateKey], { cwd: root, encoding: 'utf8' });
    A.eq(compareCli.status, 0, 'parity CLI exits zero for passing evidence');
    A.ok(/PARITY PASS StarNet=100.0%/.test(compareCli.stdout), 'parity CLI prints the scored comparison');
    const verifyCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'verify-receipt', '--receipt', parityReceipt], { cwd: root, encoding: 'utf8' });
    A.eq(verifyCli.status, 0, 'a signed receipt verifies through the CLI');
    A.ok(/SIGNATURE PASS/.test(verifyCli.stdout), 'signature verification prints the key identity');
    const faultCli = spawnSync(process.execPath, ['scripts/eval/runner.mjs', 'fault', '--candidate', faultFile, '--receipt', join(temp, 'fault.json')], { cwd: root, encoding: 'utf8' });
    A.eq(faultCli.status, 0, 'fault CLI exits zero for all ten boundaries');
    A.ok(/FAULT PASS passed=1000\/1000/.test(faultCli.stdout), 'fault CLI prints all 100 repetitions across ten boundaries');
  } finally { rmSync(temp, { recursive: true, force: true }); }

  A.report('eval-comparison.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
