'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeRunJournal, DISPATCH_BOUNDARY_MODEL } = require('../sidecar/run-journal.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-journal-boundary-'));
try {
  let tick = 0;
  const first = makeRunJournal({ dir: root, clock: { now: () => ++tick } });
  first.begin({ runId: 'settled', agentId: 'agent' });
  first.checkpoint('settled', { phase: 'assistant', messages: [{ role: 'assistant', tool_calls: [{ id: 'write-1' }] }] });
  first.toolIntent('settled', { callId: 'write-1', name: 'fs.write', mutating: true, boundaryModel: DISPATCH_BOUNDARY_MODEL });
  first.toolDispatch('settled', { callId: 'write-1', name: 'fs.write', mutating: true });
  first.toolResult('settled', { callId: 'write-1', ok: true, content: 'saved' });
  first.checkpoint('settled', { phase: 'tool_results', messages: [{ role: 'tool', tool_call_id: 'write-1', content: 'saved' }] });

  // A fresh journal instance is a process-restart boundary: no in-memory sequence/map state survives.
  const restarted = makeRunJournal({ dir: root, clock: { now: () => ++tick } });
  const settled = restarted.recoverAll().find(row => row.runId === 'settled');
  A.eq(settled.status, 'resumable', 'settled mutation resumes after a real disk/restart round-trip');
  A.eq(settled.uncertain, [], 'durable result prevents false mutation uncertainty');
  A.eq(settled.completed[0].dispatch.callId, 'write-1', 'restart retains the exact dispatch boundary');
  A.eq(settled.checkpoint.phase, 'tool_results', 'restart resumes after the paired tool-result checkpoint');

  const prepared = makeRunJournal({ dir: root, clock: { now: () => ++tick } });
  prepared.begin({ runId: 'prepared', agentId: 'agent' });
  prepared.toolIntent('prepared', { callId: 'write-2', name: 'fs.write', mutating: true, boundaryModel: DISPATCH_BOUNDARY_MODEL });
  const preparedRestart = makeRunJournal({ dir: root, clock: { now: () => ++tick } }).recoverAll().find(row => row.runId === 'prepared');
  A.eq(preparedRestart.status, 'resumable', 'prepared-only mutation is retryable after restart');
  A.eq(preparedRestart.replayablePrepared.map(x => x.callId), ['write-2'], 'prepared retry identity survives fsync/read-back');

  const dispatched = makeRunJournal({ dir: root, clock: { now: () => ++tick } });
  dispatched.begin({ runId: 'dispatched', agentId: 'agent' });
  dispatched.toolIntent('dispatched', { callId: 'write-3', name: 'fs.write', mutating: true, boundaryModel: DISPATCH_BOUNDARY_MODEL });
  dispatched.toolDispatch('dispatched', { callId: 'write-3', name: 'fs.write', mutating: true });
  const dispatchedRestart = makeRunJournal({ dir: root, clock: { now: () => ++tick } }).recoverAll().find(row => row.runId === 'dispatched');
  A.eq(dispatchedRestart.status, 'needs_review', 'dispatched mutation without result fails closed after restart');
  A.eq(dispatchedRestart.uncertain.map(x => x.callId), ['write-3'], 'review names only the may-have-happened mutation');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

A.report('run-journal-disk-boundary.test');
