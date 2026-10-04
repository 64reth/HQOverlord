/* node test/harness-snapshot.test.js — planted live-state contract for station.inspect. */
'use strict';
const A = require('./_assert.js');
const { makeHarnessSnapshot } = require('../sidecar/harness-snapshot.js');

const SECRET = 'sk-or-v1-THIS-MUST-NOT-LEAK';
const snap = makeHarnessSnapshot({
  now: () => 1700000000000,
  redact: value => String(value).split(SECRET).join('[REDACTED]'),
  readBuild: () => ({
    harness: 'v0.9.0-4-gabc1234', app: '0.9.0', node: 'v22.0.0', harnessSource: 'git',
    buildSha: 'a'.repeat(40), buildDirty: false, ignoredPath: 'C:\\private'
  }),
  readScheduler: () => ({
    jobs: [{ id: 'morning' }, { id: 'backup' }], enabled: true, halted: false, tickMs: 60000,
    health: { healthy: true, lastTickAt: 1699999999000, lastSuccessAt: 1699999999001, lastTickError: null }
  }),
  readConnectors: () => [{
    id: 'github', label: 'GitHub', state: 'up', enabled: true, toolCount: 7, oauth: true,
    token: SECRET, url: 'https://user:' + SECRET + '@example.test'
  }],
  readDiagnostics: () => ({
    errors: [{ ts: 1699999990000, message: 'provider failed ' + SECRET }],
    lastRun: { runId: 'run-1', status: 'done', ts: 1699999995000 },
    uptimeMs: 90000, workspacePresent: true, agentCount: 3, workspace: 'C:\\private',
    swallowed: { total: 7, tagCount: 2, truncated: false, tags: [
      { tag: 'aux.reflection.envelope', count: 6, firstAt: 1699999990000, lastAt: 1699999999000 },
      { tag: 'cron.tick ' + SECRET, count: 1, firstAt: 1699999991000, lastAt: 1699999991000 }
    ] }
  })
}).snapshot({ provider: 'codex', model: 'gpt-5.3-codex', agentId: 'nova', runId: 'run-live', surface: 'interactive', trigger: 'directive' });

A.eq(snap.observedAt, 1700000000000, 'the injected observation clock is authoritative');
A.eq(snap.build.status, 'confirmed', 'build source is confirmed');
A.eq(snap.build.data.harness, 'v0.9.0-4-gabc1234', 'exact harness build survives');
A.eq(snap.build.data.app, '0.9.0', 'exact app version survives');
A.eq(snap.runtime.data.requestedModel, 'gpt-5.3-codex', 'current run identity is present');
A.eq(snap.scheduler.data.jobCount, 2, 'planted routine count is exact');
A.eq(snap.scheduler.data.healthy, true, 'planted scheduler health is exact');
A.eq(snap.connectors.data.count, 1, 'planted connector count is exact');
A.eq(snap.connectors.data.connected[0].state, 'up', 'planted connector handshake state survives');
A.eq(snap.diagnostics.data.errorCount, 1, 'planted recorded-error count is exact');
A.ok(/\[REDACTED\]/.test(snap.diagnostics.data.recentErrors[0].message), 'diagnostic error text is redacted again');
A.eq(snap.diagnostics.data.swallowed.total, 7, 'planted swallowed-error total is exact (fail-open pressure is visible to the agent)');
A.eq(snap.diagnostics.data.swallowed.tags[0].tag, 'aux.reflection.envelope', 'swallowed tags ride through with their count');
A.eq(snap.diagnostics.data.swallowed.tags[0].count, 6, 'per-tag count is exact');
A.ok(/\[REDACTED\]/.test(snap.diagnostics.data.swallowed.tags[1].tag), 'even a tag is redacted again (defence in depth)');
const wire = JSON.stringify(snap);
A.ok(wire.indexOf(SECRET) < 0, 'no secret reaches the snapshot');
A.ok(wire.indexOf('C:\\\\private') < 0, 'unapproved filesystem paths are not in the allowlisted shape');
A.ok(wire.indexOf('token') < 0 && wire.indexOf('url') < 0, 'connector tokens and URLs are structurally excluded');

const partial = makeHarnessSnapshot({
  now: () => 1,
  readBuild: () => ({ harness: 'dev' }),
  readScheduler: () => { throw new Error('cron store unreadable'); },
  readConnectors: () => { throw new Error('connector store unreadable'); },
  readDiagnostics: () => { throw new Error('diagnostic store unreadable'); }
}).snapshot({});
A.eq(partial.scheduler.status, 'unavailable', 'a failed scheduler read is not rendered as zero jobs');
A.ok(/cron store unreadable/.test(partial.scheduler.reason), 'the unavailable section names its source failure');
A.eq(partial.connectors.status, 'unavailable', 'a failed connector read is not rendered as none connected');
A.eq(partial.diagnostics.status, 'unavailable', 'a failed diagnostics read is not rendered as no errors');
const noTally = makeHarnessSnapshot({ now: () => 1, readDiagnostics: () => ({ errors: [] }) }).snapshot({});
A.eq(noTally.diagnostics.data.swallowed, null, 'a missing swallowed tally is null, never a confident zero');

A.report('harness-snapshot');
