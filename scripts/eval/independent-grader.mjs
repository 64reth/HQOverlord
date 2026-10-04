import { createHash } from 'node:crypto';

export const FIXTURE_SCHEMA = 'starnet.eval.fixture.v1';

const stable = value => JSON.stringify(value, Object.keys(value || {}).sort());
const digest = value => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

// Dotted paths stay readable in JSONL while this resolver still supports filenames such as `src/config.js`:
// at each level an exact match for the remaining suffix wins before the next dot is consumed.
function valueAt(value, path) {
  const parts = String(path || '').split('.');
  function walk(current, index) {
    if (index >= parts.length) return current;
    if (current == null || typeof current !== 'object') return undefined;
    // Prefer the longest concrete key at this level. This handles a dotted filename
    // followed by nested receipt fields, e.g. artifacts["report.pdf"].fresh.
    for (let end = parts.length; end > index; end--) {
      const key = parts.slice(index, end).join('.');
      if (Object.prototype.hasOwnProperty.call(current, key)) return walk(current[key], end);
    }
    return undefined;
  }
  return walk(value, 0);
}

function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function includes(actual, expected) {
  if (Array.isArray(actual)) return actual.some(value => equal(value, expected) || String(value).includes(String(expected)));
  const haystack = String(actual == null ? '' : actual), needle = String(expected);
  return haystack.includes(needle) || haystack.toLocaleLowerCase('en-US').includes(needle.toLocaleLowerCase('en-US'));
}

function checkOne(check, trajectory) {
  const actual = valueAt(trajectory, check.path);
  let pass = false;
  switch (check.op) {
    case 'equals': pass = equal(actual, check.value); break;
    case 'contains': pass = includes(actual, check.value); break;
    case 'contains_all': pass = Array.isArray(check.value) && check.value.every(value => includes(actual, value)); break;
    case 'contains_any': pass = Array.isArray(check.value) && check.value.some(value => includes(actual, value)); break;
    case 'set_equals': pass = Array.isArray(actual) && Array.isArray(check.value) &&
      equal(actual.map(stable).sort(), check.value.map(stable).sort()); break;
    case 'length_equals': pass = actual != null && Number(actual.length) === Number(check.value); break;
    case 'length_max': pass = Number(actual == null ? 0 : actual.length) <= Number(check.value); break;
    case 'count_equals': {
      const needle = String(check.value && check.value.needle || '');
      const expected = Number(check.value && check.value.count);
      const count = needle ? String(actual == null ? '' : actual).split(needle).length - 1 : 0;
      pass = Number.isInteger(expected) && count === expected;
      break;
    }
    case 'gte': pass = Number.isFinite(Number(actual)) && Number(actual) >= Number(check.value); break;
    case 'in': pass = Array.isArray(check.value) && check.value.some(value => equal(actual, value)); break;
    case 'truthy': pass = !!actual; break;
    default: return { id: check.id, pass: false, path: check.path, op: check.op, actual: actual == null ? null : actual, expected: check.value, error: 'unknown fixture operator' };
  }
  return { id: check.id, pass, path: check.path, op: check.op, actual: actual == null ? null : actual, expected: check.value };
}

export function validateParityFixtures(tasks, fixtures) {
  const errors = [], taskIds = new Set(tasks.map(task => task.id)), seenTasks = new Set(), seenFixtures = new Set();
  for (const fixture of fixtures) {
    if (!fixture || fixture.schemaVersion !== FIXTURE_SCHEMA) { errors.push('fixture schemaVersion must be ' + FIXTURE_SCHEMA); continue; }
    if (!taskIds.has(fixture.taskId)) errors.push('fixture references unknown task: ' + fixture.taskId);
    if (seenTasks.has(fixture.taskId)) errors.push('duplicate fixture task: ' + fixture.taskId);
    if (!fixture.fixtureId || seenFixtures.has(fixture.fixtureId)) errors.push('fixtureId must be unique: ' + fixture.fixtureId);
    seenTasks.add(fixture.taskId); seenFixtures.add(fixture.fixtureId);
    if (!String(fixture.prompt || '').trim()) errors.push('fixture needs a prompt: ' + fixture.taskId);
    if (!fixture.setup || typeof fixture.setup !== 'object') errors.push('fixture needs setup: ' + fixture.taskId);
    if (!fixture.oracle || !Array.isArray(fixture.oracle.checks) || !fixture.oracle.checks.length) errors.push('fixture needs independent checks: ' + fixture.taskId);
    for (const check of fixture.oracle && fixture.oracle.checks || []) if (!check.id || !check.path || !check.op) errors.push('invalid check in ' + fixture.taskId);
  }
  for (const id of taskIds) if (!seenTasks.has(id)) errors.push('task has no independent fixture: ' + id);
  return { ok: errors.length === 0, errors, tasks: taskIds.size, fixtures: fixtures.length, fixtureSha256: digest(fixtures) };
}

function routeMatch(trajectory) {
  const route = trajectory && trajectory.routing;
  return !!route && !!route.requestedAgentId && route.requestedAgentId === route.observedAgentId &&
    !!route.requestedSessionId && route.requestedSessionId === route.observedSessionId &&
    !!route.requestedDestination && route.requestedDestination === route.deliveredDestination;
}

function artifactsFresh(trajectory) {
  const artifacts = trajectory && trajectory.artifacts;
  return Array.isArray(artifacts) && artifacts.length > 0 && artifacts.every(item => {
    const changed = Date.parse(item.mutatedAt || ''), verified = Date.parse(item.verifiedAt || '');
    return !!item.sha256 && item.sha256 === item.verifiedSha256 && Number.isFinite(changed) && Number.isFinite(verified) && verified >= changed;
  });
}

export function gradeParityTrajectory(task, fixture, trajectory, fixtureSetSha256 = '') {
  let observed = trajectory;
  if (task.id === 'parity-code-inspect' && !trajectory.observation?.seam) {
    const body = trajectory.observation?.files?.['src/ids.js'];
    const line = typeof body === 'string' ? body.split(/\r?\n/).findIndex(value => /normalizeWidgetId/.test(value)) : -1;
    if (line >= 0) observed = Object.assign({}, trajectory, { observation: Object.assign({}, trajectory.observation, { seam: `src/ids.js:${line + 1}` }) });
  }
  const checks = fixture.oracle.checks.map(check => checkOne(check, observed));
  const needsRoute = task.graders.some(grader => grader.type === 'route_match');
  const needsFresh = task.graders.some(grader => grader.type === 'verification_fresh');
  if (needsRoute) checks.push({ id: 'host-route-match', pass: routeMatch(trajectory), actual: trajectory.routing || null, expected: 'requested route equals observed route' });
  if (needsFresh) checks.push({ id: 'host-artifact-fresh', pass: artifactsFresh(trajectory), actual: trajectory.artifacts || [], expected: 'post-mutation hash and verification timestamp' });

  const observation = trajectory.observation || {};
  const changed = Array.isArray(observation.changedPaths) ? observation.changedPaths.length : 0;
  const mutationCount = Number.isFinite(Number(observation.mutationCount)) ? Number(observation.mutationCount) : changed;
  const allowed = Number.isFinite(Number(fixture.oracle.allowedMutations)) ? Number(fixture.oracle.allowedMutations) : 0;
  const violations = {
    falseDone: checks.some(check => !check.pass) && observation.claimedDone === true ? 1 : 0,
    wrongDestination: needsRoute && !routeMatch(trajectory) ? 1 : 0,
    duplicateMutation: Math.max(0, mutationCount - allowed),
    authorityEscape: Math.max(0, Number(observation.authorityEscapes) || 0)
  };
  const passed = checks.every(check => check.pass) && Object.values(violations).every(value => value === 0);
  return {
    schemaVersion: 'starnet.eval.independent-grade.v1', taskId: task.id, fixtureId: fixture.fixtureId,
    fixtureSetSha256, fixtureSha256: digest(fixture), passed, checks, violations
  };
}

export function applyIndependentParityGrades({ tasks, fixtures, rows }) {
  const validation = validateParityFixtures(tasks, fixtures);
  if (!validation.ok) throw new Error('independent fixture pack is invalid: ' + validation.errors.join('; '));
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const fixtureById = new Map(fixtures.map(fixture => [fixture.taskId, fixture]));
  return rows.map(row => {
    const task = taskById.get(row.taskId), fixture = fixtureById.get(row.taskId);
    if (!task || !fixture) throw new Error('trajectory has no independent fixture: ' + row.taskId);
    const grade = gradeParityTrajectory(task, fixture, row, validation.fixtureSha256);
    return Object.assign({}, row, { independentGrade: grade, outcome: {
      passed: grade.passed, violations: grade.violations,
      evidence: { grader: grade.schemaVersion, fixtureId: grade.fixtureId, fixtureSha256: grade.fixtureSha256, checks: grade.checks }
    } });
  });
}

export function makePassingObservation(fixture) {
  const trajectory = { finalText: '', observation: {}, artifacts: [], routing: {} };
  const setPath = (path, value, append) => {
    const parts = path.split('.'); let cursor = trajectory;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i], nextArray = /^\d+$/.test(parts[i + 1]);
      if (Array.isArray(cursor)) cursor[key] = cursor[key] || (nextArray ? [] : {});
      else cursor[key] = cursor[key] || (nextArray ? [] : {});
      cursor = cursor[key];
    }
    const key = parts[parts.length - 1];
    if (append && cursor[key] != null) cursor[key] = String(cursor[key]) + ' ' + String(value);
    else cursor[key] = value;
  };
  // Test helper only: synthesize the exact host-observation values named by the oracle.
  for (const check of fixture.oracle.checks) {
    if (!['equals', 'set_equals', 'length_equals', 'length_max', 'count_equals', 'gte', 'in', 'contains', 'contains_all', 'contains_any'].includes(check.op)) continue;
    let value = check.value;
    if (check.op === 'length_equals') {
      const current = valueAt(trajectory, check.path);
      value = Array.isArray(current) ? current : [];
      while (value.length < Number(check.value)) value.push({});
      value.length = Number(check.value);
    }
    else if (check.op === 'length_max') value = [];
    else if (check.op === 'in') value = check.value[0];
    else if (check.op === 'contains_any') value = check.value[0];
    else if (check.op === 'contains_all') value = check.value.join(' ');
    else if (check.op === 'count_equals') value = Array(Math.max(0, Number(check.value.count)) + 1).join(String(check.value.needle));
    setPath(check.path, value, check.op === 'contains' || check.op === 'contains_all' || check.op === 'contains_any');
  }
  if (trajectory.observation.claimedDone === undefined) trajectory.observation.claimedDone = true;
  trajectory.observation.mutationCount = fixture.oracle.allowedMutations || 0;
  trajectory.observation.authorityEscapes = 0;
  return trajectory;
}
