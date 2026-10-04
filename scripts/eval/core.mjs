import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const TASK_SCHEMA = 'starnet.eval.task.v1';
export const TRAJECTORY_SCHEMA = 'starnet.eval.trajectory.v1';
export const REPORT_SCHEMA = 'starnet.eval.report.v1';
export const BENCHMARK_VERSION = 'starnet-0.9.0-agent-quality-v1';

const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie|credential)/i;
const REDACTED = '[REDACTED]';
const QUALITY_DIMENSIONS = new Set(['planning', 'toolSelection', 'recovery', 'stopping', 'completion', 'latency', 'cost']);

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function sha256Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function redactString(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer ' + REDACTED)
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])-[-A-Za-z0-9_]{12,}\b/g, REDACTED)
    .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\[REDACTED]')
    .replace(/\/(?:home|Users)\/[^/\s]+/g, '/home/[REDACTED]');
}

export function redactDeep(value, key = '') {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(v => redactDeep(v));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v, k);
  return out;
}

export function readJsonl(file) {
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return text.split(/\r?\n/).map((line, index) => ({ line, index }))
    .filter(row => row.line.trim() && !row.line.trim().startsWith('#'))
    .map(row => {
      try { return JSON.parse(row.line); }
      catch (error) { throw new Error(`${file}:${row.index + 1}: invalid JSON: ${error.message}`); }
    });
}

export function writeJsonl(file, rows) {
  writeFileSync(file, rows.map(row => JSON.stringify(redactDeep(row))).join('\n') + '\n', 'utf8');
}

export function validateTasks(tasks) {
  const seen = new Set();
  for (const [index, task] of tasks.entries()) {
    if (!task || task.schemaVersion !== TASK_SCHEMA) throw new Error(`task row ${index + 1}: schemaVersion must be ${TASK_SCHEMA}`);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(String(task.id || ''))) throw new Error(`task row ${index + 1}: invalid id`);
    if (seen.has(task.id)) throw new Error(`duplicate task id: ${task.id}`);
    seen.add(task.id);
    if (!['active', 'pending'].includes(task.status)) throw new Error(`task ${task.id}: status must be active or pending`);
    if (task.status === 'active' && (!Array.isArray(task.graders) || !task.graders.length)) throw new Error(`task ${task.id}: active tasks need graders`);
    for (const grader of task.graders || []) {
      if (grader.dimension && !QUALITY_DIMENSIONS.has(grader.dimension)) throw new Error(`task ${task.id}: invalid quality dimension ${grader.dimension}`);
    }
  }
  return tasks;
}

export function validateTrajectories(rows) {
  const byId = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row || row.schemaVersion !== TRAJECTORY_SCHEMA) throw new Error(`trajectory row ${index + 1}: schemaVersion must be ${TRAJECTORY_SCHEMA}`);
    if (!row.taskId) throw new Error(`trajectory row ${index + 1}: taskId is required`);
    if (byId.has(row.taskId)) throw new Error(`duplicate trajectory taskId: ${row.taskId}`);
    if (!Array.isArray(row.events)) throw new Error(`trajectory ${row.taskId}: events must be an array`);
    byId.set(row.taskId, redactDeep(row));
  }
  return byId;
}

function eventData(event) {
  return event && event.data && typeof event.data === 'object' ? event.data : {};
}

function eventsOf(trajectory, type) {
  return trajectory.events.filter(event => event && event.type === type);
}

function valueAt(object, dotted) {
  return String(dotted || '').split('.').filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], object);
}

export function deriveMetrics(trajectory) {
  const events = trajectory.events || [];
  const artifacts = trajectory.artifacts || [];
  const costs = eventsOf(trajectory, 'agent.cost');
  const starts = eventsOf(trajectory, 'agent.run.start');
  const ends = eventsOf(trajectory, 'agent.run.end');
  const explicit = trajectory.metrics || {};
  const observedRetries = eventsOf(trajectory, 'provider.retry').length;
  const startedAt = Date.parse(trajectory.startedAt || (starts[0] && starts[0].at) || '');
  const endedAt = Date.parse(trajectory.endedAt || (ends[ends.length - 1] && ends[ends.length - 1].at) || '');
  const firstToken = events.find(event => event && event.type === 'agent.token' && String(eventData(event).delta || ''));
  const firstTokenAt = Date.parse(firstToken && firstToken.at || '');
  const sum = (key) => costs.reduce((total, event) => total + finite(eventData(event)[key]), 0);
  return {
    turns: finite(explicit.turns, eventsOf(trajectory, 'model.turn').length),
    toolCalls: finite(explicit.toolCalls, eventsOf(trajectory, 'agent.tool_call').length),
    // Raw retry events are direct trajectory evidence and therefore a hard lower bound.
    // Preserve summary-only adapters that provide an explicit count, but never let a stale
    // or contradictory lower summary erase retries that the event stream proves occurred.
    retries: Math.max(observedRetries, finite(explicit.retries, observedRetries)),
    tokensIn: finite(explicit.tokensIn, sum('tokensIn')),
    tokensOut: finite(explicit.tokensOut, sum('tokensOut')),
    tokens: finite(explicit.tokens, sum('tokensIn') + sum('tokensOut')),
    costUsd: finite(explicit.costUsd, costs.reduce((total, event) => total + finite(eventData(event).usd), 0)),
    firstTokenMs: finite(explicit.firstTokenMs,
      Number.isFinite(startedAt) && Number.isFinite(firstTokenAt) ? Math.max(0, firstTokenAt - startedAt) : 0),
    durationMs: finite(explicit.durationMs, Number.isFinite(startedAt) && Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : 0),
    artifactHashes: artifacts.map(a => ({ path: String(a.path || ''), sha256: String(a.sha256 || '') })),
    verificationFresh: artifacts.length > 0 && artifacts.every(a => {
      const changed = Date.parse(a.mutatedAt || '');
      const verified = Date.parse(a.verifiedAt || '');
      return !!a.sha256 && a.verifiedSha256 === a.sha256 && Number.isFinite(changed) && Number.isFinite(verified) && verified >= changed;
    })
  };
}

function gradeOne(grader, trajectory, metrics) {
  const events = trajectory.events || [];
  const artifacts = trajectory.artifacts || [];
  let actual;
  switch (grader.type) {
    case 'final_contains': {
      const needles = Array.isArray(grader.values) ? grader.values : [grader.value];
      actual = String(trajectory.finalText || '');
      return { pass: needles.every(v => actual.includes(String(v))), actual: actual.slice(0, 240), expected: needles };
    }
    case 'final_equals':
      actual = String(trajectory.finalText || '');
      return { pass: actual === String(grader.value || ''), actual: actual.slice(0, 240), expected: grader.value };
    case 'event_count': {
      actual = events.filter(event => event.type === grader.event).length;
      const min = grader.min == null ? actual : finite(grader.min);
      const max = grader.max == null ? Infinity : finite(grader.max);
      return { pass: actual >= min && actual <= max, actual, expected: { event: grader.event, min, max: Number.isFinite(max) ? max : null } };
    }
    case 'run_reason': {
      const end = [...events].reverse().find(event => event.type === 'agent.run.end');
      actual = end && eventData(end).reason;
      return { pass: actual === grader.value, actual: actual || null, expected: grader.value };
    }
    case 'event_data_equals': {
      const hit = events.find(event => event.type === grader.event);
      actual = hit ? valueAt(eventData(hit), grader.path) : undefined;
      return { pass: JSON.stringify(actual) === JSON.stringify(grader.value), actual: actual === undefined ? null : actual, expected: grader.value };
    }
    case 'event_data_min': {
      const hit = events.find(event => event.type === grader.event);
      actual = hit ? finite(valueAt(eventData(hit), grader.path), Number.NEGATIVE_INFINITY) : Number.NEGATIVE_INFINITY;
      return { pass: actual >= finite(grader.value), actual: Number.isFinite(actual) ? actual : null, expected: { min: grader.value } };
    }
    case 'event_data_sequence': {
      actual = events.filter(event => event.type === grader.event).map(event => valueAt(eventData(event), grader.path));
      return { pass: JSON.stringify(actual) === JSON.stringify(grader.values || []), actual, expected: grader.values || [] };
    }
    case 'tool_sequence': {
      actual = eventsOf(trajectory, 'agent.tool_call').map(event => String(eventData(event).name || ''));
      return { pass: JSON.stringify(actual) === JSON.stringify(grader.values || []), actual, expected: grader.values || [] };
    }
    case 'metric_max': {
      actual = finite(metrics && metrics[grader.metric], Number.POSITIVE_INFINITY);
      return { pass: actual <= finite(grader.value), actual: Number.isFinite(actual) ? actual : null, expected: { metric: grader.metric, max: grader.value } };
    }
    case 'artifact_hash': {
      const artifact = artifacts.find(item => item.path === grader.path);
      actual = artifact && artifact.sha256;
      return { pass: actual === String(grader.sha256 || '').toLowerCase(), actual: actual || null, expected: grader.sha256 };
    }
    case 'verification_fresh': {
      const selected = grader.path ? artifacts.filter(item => item.path === grader.path) : artifacts;
      actual = selected.map(item => ({ path: item.path, mutatedAt: item.mutatedAt, verifiedAt: item.verifiedAt, hashMatch: item.sha256 === item.verifiedSha256 }));
      return { pass: selected.length > 0 && selected.every(item => {
        const changed = Date.parse(item.mutatedAt || '');
        const verified = Date.parse(item.verifiedAt || '');
        return item.sha256 && item.sha256 === item.verifiedSha256 && Number.isFinite(changed) && Number.isFinite(verified) && verified >= changed;
      }), actual, expected: 'verification at or after mutation with matching sha256' };
    }
    case 'outcome_pass': {
      actual = trajectory.outcome && trajectory.outcome.passed;
      return { pass: actual === true, actual: actual == null ? null : actual, expected: true };
    }
    case 'safety_invariants': {
      const names = ['falseDone', 'wrongDestination', 'duplicateMutation', 'authorityEscape'];
      const values = trajectory.outcome && trajectory.outcome.violations;
      actual = values && typeof values === 'object'
        ? Object.fromEntries(names.map(name => [name, finite(values[name], 0)]))
        : null;
      return { pass: !!actual && names.every(name => actual[name] === 0), actual, expected: Object.fromEntries(names.map(name => [name, 0])) };
    }
    case 'route_match': {
      const route = trajectory.routing;
      actual = route && typeof route === 'object' ? {
        agent: [route.requestedAgentId || '', route.observedAgentId || ''],
        session: [route.requestedSessionId || '', route.observedSessionId || ''],
        destination: [route.requestedDestination || '', route.deliveredDestination || '']
      } : null;
      return { pass: !!actual && Object.values(actual).every(pair => pair[0] && pair[0] === pair[1]), actual, expected: 'requested agent, session, and destination equal observed values' };
    }
    case 'fault_recovery': {
      const fault = trajectory.fault;
      actual = fault && typeof fault === 'object' ? {
        injectedAt: fault.injectedAt || '',
        observedRecovery: fault.observedRecovery || '',
        ambiguous: !!fault.ambiguous
      } : null;
      const expected = { injectedAt: String(grader.injectedAt || ''), observedRecovery: String(grader.value || ''), ambiguous: false };
      return { pass: !!actual && !!expected.injectedAt && !!expected.observedRecovery && actual.injectedAt === expected.injectedAt &&
        actual.observedRecovery === expected.observedRecovery && !actual.ambiguous, actual, expected };
    }
    default:
      return { pass: false, actual: null, expected: null, error: `unknown grader type: ${grader.type}` };
  }
}

export function gradeTask(task, trajectory, metrics = deriveMetrics(trajectory)) {
  const grades = task.graders.map((grader, index) => Object.assign({
    id: grader.id || `${grader.type}-${index + 1}`,
    type: grader.type,
    dimension: grader.dimension || ''
  }, gradeOne(grader, trajectory, metrics)));
  const passed = grades.filter(grade => grade.pass).length;
  return { pass: passed === grades.length, score: grades.length ? passed / grades.length : 0, grades };
}

function regressionCheck(name, candidate, baseline, threshold, unit = '') {
  const pass = candidate <= baseline + threshold;
  return { name, pass, candidate, baseline, allowedIncrease: threshold, unit };
}

function percentCheck(name, candidate, baseline, percent, unit = '') {
  const allowed = baseline === 0 ? 0 : Math.abs(baseline) * finite(percent) / 100;
  return regressionCheck(name, candidate, baseline, allowed, unit);
}

export function compareMetrics(task, candidate, baseline) {
  const limits = task.thresholds || {};
  if (!baseline) return [];
  const checks = [];
  if (limits.maxTurnsIncrease != null) checks.push(regressionCheck('turns', candidate.turns, baseline.turns, finite(limits.maxTurnsIncrease)));
  if (limits.maxToolCallsIncrease != null) checks.push(regressionCheck('toolCalls', candidate.toolCalls, baseline.toolCalls, finite(limits.maxToolCallsIncrease)));
  if (limits.maxRetriesIncrease != null) checks.push(regressionCheck('retries', candidate.retries, baseline.retries, finite(limits.maxRetriesIncrease)));
  if (limits.maxTokensIncreasePct != null) checks.push(percentCheck('tokens', candidate.tokens, baseline.tokens, limits.maxTokensIncreasePct));
  if (limits.maxCostIncreasePct != null) checks.push(percentCheck('costUsd', candidate.costUsd, baseline.costUsd, limits.maxCostIncreasePct, 'USD'));
  if (limits.maxDurationIncreasePct != null) checks.push(percentCheck('durationMs', candidate.durationMs, baseline.durationMs, limits.maxDurationIncreasePct, 'ms'));
  if (limits.maxCostUsd != null) checks.push({ name: 'costUsdCeiling', pass: candidate.costUsd <= finite(limits.maxCostUsd), candidate: candidate.costUsd, ceiling: finite(limits.maxCostUsd), unit: 'USD' });
  return checks;
}

export function evaluate({ tasks, candidateRows, baselineRows = [] }) {
  validateTasks(tasks);
  const candidates = validateTrajectories(candidateRows);
  const baselines = validateTrajectories(baselineRows);
  const results = [];
  for (const task of tasks) {
    if (task.status === 'pending') {
      results.push({ taskId: task.id, status: 'pending', pass: true, adapter: task.adapter || '', note: task.note || '' });
      continue;
    }
    const trajectory = candidates.get(task.id);
    if (!trajectory) {
      results.push({ taskId: task.id, status: 'missing', pass: false, failures: ['candidate trajectory missing'] });
      continue;
    }
    const metrics = deriveMetrics(trajectory);
    const grading = gradeTask(task, trajectory, metrics);
    const baselineTrajectory = baselines.get(task.id);
    const baselineMetrics = baselineTrajectory ? deriveMetrics(baselineTrajectory) : null;
    const regressions = compareMetrics(task, metrics, baselineMetrics);
    const minCorrectness = task.thresholds && task.thresholds.minCorrectness != null ? finite(task.thresholds.minCorrectness) : 1;
    const failures = [];
    if (grading.score < minCorrectness) failures.push(`correctness ${grading.score.toFixed(3)} below ${minCorrectness.toFixed(3)}`);
    for (const check of regressions) if (!check.pass) failures.push(`${check.name} regression`);
    results.push({ taskId: task.id, status: 'evaluated', pass: failures.length === 0, grading, metrics, baselineMetrics, regressions, failures });
  }
  const active = results.filter(result => result.status !== 'pending');
  const failed = active.filter(result => !result.pass);
  const dimensions = {};
  for (const result of active) {
    if (!result.grading) continue;
    for (const grade of result.grading.grades) {
      const key = grade.dimension;
      if (!key) continue;
      const row = dimensions[key] || (dimensions[key] = { passed: 0, total: 0, score: 0 });
      row.total++;
      if (grade.pass) row.passed++;
    }
  }
  for (const row of Object.values(dimensions)) row.score = row.total ? row.passed / row.total : 0;
  const dimensionRows = Object.values(dimensions);
  const qualityScore = dimensionRows.length
    ? dimensionRows.reduce((sum, row) => sum + row.score, 0) / dimensionRows.length
    : 0;
  return redactDeep({
    schemaVersion: REPORT_SCHEMA,
    benchmarkVersion: BENCHMARK_VERSION,
    suiteDigest: sha256Text(BENCHMARK_VERSION + '\n' + JSON.stringify(tasks)),
    baselineDigest: sha256Text(JSON.stringify(baselineRows)),
    generatedAt: new Date().toISOString(),
    summary: {
      pass: failed.length === 0, active: active.length, passed: active.length - failed.length,
      failed: failed.length, pending: results.length - active.length,
      qualityScore, dimensions
    },
    results
  });
}

export function recordTrajectory({ taskId, rawEvents, runId = '', startedAt = '', endedAt = '', finalText = '', artifacts = [], metrics = {} }) {
  if (!taskId) throw new Error('record: taskId is required');
  const events = rawEvents.map((event, index) => ({
    seq: finite(event.seq, index + 1),
    at: event.at || '',
    type: String(event.type || event.name || ''),
    data: redactDeep(event.data === undefined ? event.payload : event.data)
  }));
  return redactDeep({ schemaVersion: TRAJECTORY_SCHEMA, taskId, runId, startedAt, endedAt, finalText, events, artifacts, metrics });
}
