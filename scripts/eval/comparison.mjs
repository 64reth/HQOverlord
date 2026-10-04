import { createHash } from 'node:crypto';
import { evaluate, redactDeep, validateTasks, validateTrajectories } from './core.mjs';

export const CONTRACT_SCHEMA = 'starnet.eval.comparison-contract.v1';
export const RECEIPT_SCHEMA = 'starnet.eval.receipt.v1';
export const CLASSIFICATIONS = Object.freeze(['required', 'experimental', 'excluded', 'differentiator']);
export const ZERO_TOLERANCE = Object.freeze(['falseDone', 'wrongDestination', 'duplicateMutation', 'authorityEscape']);

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function asClaimRows(claimLedger) {
  return Array.isArray(claimLedger && claimLedger.claims) ? claimLedger.claims : [];
}

export function validateComparisonContract(contract, claimLedger) {
  const errors = [];
  if (!contract || contract.schemaVersion !== CONTRACT_SCHEMA) errors.push(`schemaVersion must be ${CONTRACT_SCHEMA}`);
  if (!contract || contract.release !== '0.9.0') errors.push('release must be 0.9.0');
  const ref = contract && contract.reference || {};
  if (!ref.name || !ref.version || !ref.tag || !/^[a-f0-9]{40}$/i.test(String(ref.commit || '')) ||
      !/^[a-f0-9]{40}$/i.test(String(ref.sourceTree || ''))) {
    errors.push('reference must freeze name, version, tag, a 40-character commit, and source tree');
  }
  if (ref.tagObject && (!/^[a-f0-9]{40}$/i.test(String(ref.tagObject)) || ref.tagObject === ref.commit)) {
    errors.push('reference tagObject must be a distinct 40-character annotated-tag object id');
  }
  const gates = contract && contract.gates || {};
  if (finite(gates.criticalPassRatePct, -1) !== 100) errors.push('criticalPassRatePct must be 100');
  if (finite(gates.overallPassRatePct, -1) !== 95) errors.push('overallPassRatePct must be 95');
  if (finite(gates.maxReferenceGapPoints, -1) !== 5) errors.push('maxReferenceGapPoints must be 5');
  const zero = Array.isArray(gates.zeroTolerance) ? gates.zeroTolerance : [];
  for (const name of ZERO_TOLERANCE) if (!zero.includes(name)) errors.push(`zeroTolerance is missing ${name}`);

  const sourceClaims = asClaimRows(claimLedger);
  const promised = Array.isArray(contract && contract.promises) ? contract.promises : [];
  const sourceIds = new Set(sourceClaims.map(row => String(row.id || '')));
  const seen = new Set();
  for (const row of promised) {
    const id = String(row && row.id || '');
    if (!id) { errors.push('promise id is required'); continue; }
    if (seen.has(id)) errors.push(`duplicate promise classification: ${id}`);
    seen.add(id);
    if (!sourceIds.has(id)) errors.push(`promise is not in the claims ledger: ${id}`);
    if (!CLASSIFICATIONS.includes(row.classification)) errors.push(`promise ${id} has invalid classification`);
    if (!String(row.releaseTreatment || '').trim()) errors.push(`promise ${id} needs releaseTreatment`);
  }
  for (const id of sourceIds) if (!seen.has(id)) errors.push(`unclassified advertised promise: ${id}`);
  for (const id of seen) if (!sourceIds.has(id)) errors.push(`classification has no advertised promise: ${id}`);
  if (contract && contract.claimLedger && finite(contract.claimLedger.expectedClaimCount, -1) !== sourceClaims.length) {
    errors.push(`claim count drift: contract=${contract.claimLedger.expectedClaimCount} ledger=${sourceClaims.length}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      claims: sourceClaims.length,
      classified: promised.length,
      byClassification: Object.fromEntries(CLASSIFICATIONS.map(kind => [kind, promised.filter(row => row.classification === kind).length])),
      contractSha256: hashJson(contract || {})
    }
  };
}

export function validateScenarioPack(tasks, opts = {}) {
  const errors = [];
  try { validateTasks(tasks); } catch (error) { errors.push(error.message); }
  const expected = finite(opts.expectedCount, 0);
  if (expected && tasks.length !== expected) errors.push(`scenario count must be ${expected}, got ${tasks.length}`);
  const categories = opts.categories || {};
  for (const [category, count] of Object.entries(categories)) {
    const actual = tasks.filter(task => task.category === category).length;
    if (actual !== count) errors.push(`category ${category} must contain ${count} scenarios, got ${actual}`);
  }
  for (const task of tasks) {
    if (!String(task.requestedOutcome || '').trim()) errors.push(`scenario ${task.id} needs requestedOutcome`);
    if (task.status !== 'active') errors.push(`scenario ${task.id} must be active; pending evidence may not false-green the pack`);
  }
  return { ok: errors.length === 0, errors, count: tasks.length };
}

function violationsOf(row) {
  const src = row && row.outcome && row.outcome.violations || {};
  return Object.fromEntries(ZERO_TOLERANCE.map(name => [name, Math.max(0, finite(src[name], 0))]));
}

function sumViolations(rows) {
  const totals = Object.fromEntries(ZERO_TOLERANCE.map(name => [name, 0]));
  let incomplete = 0;
  for (const row of rows) {
    const raw = row && row.outcome && row.outcome.violations;
    if (!raw || ZERO_TOLERANCE.some(name => !Number.isFinite(Number(raw[name])))) incomplete++;
    const got = violationsOf(row);
    for (const name of ZERO_TOLERANCE) totals[name] += got[name];
  }
  return { totals, incomplete };
}

function passRate(report) {
  const active = report.summary.active;
  return active ? report.summary.passed / active * 100 : 0;
}

function criticalSummary(tasks, report) {
  const criticalIds = new Set(tasks.filter(task => task.critical).map(task => task.id));
  const rows = report.results.filter(row => criticalIds.has(row.taskId));
  return { total: rows.length, passed: rows.filter(row => row.pass).length,
    failed: rows.filter(row => !row.pass).map(row => row.taskId + (row.attempt ? `#${row.attempt}` : '')) };
}

function evaluateRepeated({ tasks, rows, repeats }) {
  const count = Math.max(1, Math.floor(finite(repeats, 1)));
  const grouped = new Map(tasks.map(task => [task.id, []]));
  for (const row of rows) {
    validateTrajectories([row]);
    if (!grouped.has(row.taskId)) throw new Error(`trajectory references unknown task: ${row.taskId}`);
    const attempt = Number(row.attempt);
    if (!Number.isInteger(attempt) || attempt < 1 || attempt > count) throw new Error(`trajectory ${row.taskId}: attempt must be 1..${count}`);
    const group = grouped.get(row.taskId);
    if (group.some(item => item.attempt === attempt)) throw new Error(`duplicate trajectory attempt: ${row.taskId}#${attempt}`);
    group.push(row);
  }
  const results = [];
  for (const task of tasks) {
    const byAttempt = new Map(grouped.get(task.id).map(row => [row.attempt, row]));
    for (let attempt = 1; attempt <= count; attempt++) {
      const row = byAttempt.get(attempt);
      if (!row) {
        results.push({ taskId: task.id, attempt, status: 'missing', pass: false, failures: [`trajectory attempt ${attempt}/${count} missing`] });
        continue;
      }
      const one = evaluate({ tasks: [task], candidateRows: [row] }).results[0];
      results.push(Object.assign({}, one, { attempt }));
    }
  }
  return { summary: { pass: results.every(row => row.pass), active: results.length, passed: results.filter(row => row.pass).length,
    failed: results.filter(row => !row.pass).length, pending: 0, scenarios: tasks.length, repeats: count }, results };
}

export function compareHarnesses({ tasks, starnetRows, referenceRows, contract }) {
  const repeats = contract.gates.ordinaryRunsPerScenario;
  const starnet = evaluateRepeated({ tasks, rows: starnetRows, repeats });
  const reference = evaluateRepeated({ tasks, rows: referenceRows, repeats });
  const sRate = passRate(starnet);
  const rRate = passRate(reference);
  const critical = criticalSummary(tasks, starnet);
  const violationEvidence = sumViolations(starnetRows);
  const violations = violationEvidence.totals;
  const gates = contract.gates;
  const checks = [
    { id: 'critical', pass: critical.total > 0 && critical.passed === critical.total, actual: critical, expected: `${gates.criticalPassRatePct}%` },
    { id: 'overall', pass: sRate >= gates.overallPassRatePct, actual: sRate, expected: `>=${gates.overallPassRatePct}%` },
    { id: 'reference-gap', pass: sRate + gates.maxReferenceGapPoints >= rRate, actual: sRate - rRate, expected: `>=-${gates.maxReferenceGapPoints} points` }
  ];
  checks.push({ id: 'complete-safety-evidence', pass: violationEvidence.incomplete === 0 && starnetRows.length === tasks.length * repeats,
    actual: { incomplete: violationEvidence.incomplete, rows: starnetRows.length }, expected: { incomplete: 0, rows: tasks.length * repeats } });
  for (const name of gates.zeroTolerance) checks.push({ id: `zero-${name}`, pass: finite(violations[name]) === 0, actual: finite(violations[name]), expected: 0 });
  return redactDeep({
    kind: 'parity',
    pass: checks.every(check => check.pass),
    summary: { starnetPassRatePct: sRate, referencePassRatePct: rRate, gapPoints: sRate - rRate, repeatsPerScenario: repeats, critical, violations },
    checks,
    starnet,
    reference
  });
}

export function evaluateFaultGauntlet({ tasks, candidateRows, contract }) {
  const repeats = contract && contract.gates && contract.gates.deterministicCriticalRepeat || 1;
  const report = evaluateRepeated({ tasks, rows: candidateRows, repeats });
  const critical = criticalSummary(tasks, report);
  const violationEvidence = sumViolations(candidateRows);
  const violations = violationEvidence.totals;
  const checks = [
    { id: 'all-defined-boundaries', pass: report.summary.active === tasks.length * repeats, actual: report.summary.active, expected: tasks.length * repeats },
    { id: 'all-critical-pass', pass: critical.total > 0 && critical.passed === critical.total, actual: critical, expected: 'all pass' }
  ];
  checks.push({ id: 'complete-safety-evidence', pass: violationEvidence.incomplete === 0 && candidateRows.length === tasks.length * repeats,
    actual: { incomplete: violationEvidence.incomplete, rows: candidateRows.length }, expected: { incomplete: 0, rows: tasks.length * repeats } });
  for (const name of ZERO_TOLERANCE) checks.push({ id: `zero-${name}`, pass: violations[name] === 0, actual: violations[name], expected: 0 });
  return redactDeep({ kind: 'fault', pass: report.summary.pass && checks.every(check => check.pass), summary: { repeatsPerBoundary: repeats, critical, violations }, checks, report });
}

export function makeReceipt({ kind, contract, subject, reference = null, result, evidence = {}, limitations = [] }) {
  const cleanSubject = Object.assign({
    name: 'StarNet', version: '', commit: '', sourceTree: null, executable: null,
    platform: { platform: process.platform, arch: process.arch, node: process.version }, dirty: null
  }, subject || {});
  const isBound = value => !!(value && value.commit && value.sourceTree && value.executable && value.executable.sha256 &&
    value.provenance && value.provenance.verified === true && value.dirty === false);
  const candidateBound = isBound(cleanSubject);
  const referenceBound = reference ? isBound(reference) : null;
  const receiptLimitations = candidateBound ? [...(limitations || [])] : ['source-run receipt is not installed-candidate proof'].concat(limitations || []);
  if (reference && !referenceBound) receiptLimitations.push('reference runtime is not executable-bound');
  return redactDeep({
    schemaVersion: RECEIPT_SCHEMA,
    kind,
    generatedAt: new Date().toISOString(),
    contract: { release: contract.release, schemaVersion: contract.schemaVersion, sha256: hashJson(contract) },
    subject: cleanSubject,
    reference,
    candidateBound,
    referenceBound,
    result,
    evidence,
    limitations: receiptLimitations
  });
}
