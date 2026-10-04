'use strict';
const A = require('./_assert');
const { makeRunJournal } = require('../sidecar/run-journal');
const Recovery = require('../sidecar/run-recovery');

function memoryIo() {
  const files = new Map();
  return {
    create(id, line) { if (files.has(id)) throw new Error('exists'); files.set(id, line + '\n'); },
    append(id, line) { if (!files.has(id)) throw new Error('missing'); files.set(id, files.get(id) + line + '\n'); },
    read(id) { return files.get(id); }, list() { return Array.from(files.keys()); },
    readFile(id) { return files.get(id); }, remove(id) { files.delete(id); }, files
  };
}

let now = 10;
const io = memoryIo();
const journal = makeRunJournal({ io, clock: { now: () => ++now } });
const argsRaw = '{"delta":1,"label":"once"}';
const fingerprint = Recovery.replayFingerprint('fixture.increment', argsRaw);
journal.begin({ runId: 'crashed', agentId: 'agent', streamId: 'global', model: 'fixture/model' });
journal.checkpoint('crashed', { phase: 'initial', turn: 0, messages: [
  { role: 'system', content: 'fixture system' }, { role: 'user', content: 'increment exactly once' }
] });
journal.checkpoint('crashed', { phase: 'assistant', turn: 1, messages: [{
  role: 'assistant', content: '', tool_calls: [{ id: 'call-once', type: 'function', function: { name: 'fixture_increment', arguments: argsRaw } }]
}] });
journal.toolIntent('crashed', { callId: 'call-once', name: 'fixture.increment', argsRaw, replayFingerprint: fingerprint, mutating: true });

let counter = 0;
counter++; // deterministic side effect happened, then the process died before tool_result could be journaled.
let recovered = journal.inspect('crashed');
A.eq(recovered.status, 'needs_review', 'crash after mutation and before result requires operator review');
journal.resolve('crashed', {
  resolutionId: 'resolution-once', operator: 'local',
  outcomes: [{ callId: 'call-once', outcome: 'happened' }]
});
recovered = journal.inspect('crashed');
const plan = Recovery.continuationPlan(recovered);
A.eq(plan.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'system'], 'continuation pairs the outstanding provider tool call before adding operator context');
A.ok(/verified.*happened/i.test(plan.messages[3].content), 'the provider sees the explicit verified outcome as its tool result');
A.ok(/no reviewed mutating call/i.test(plan.messages[4].content), 'the provider receives the explicit durable no-replay continuation context');
A.eq(plan.blockedFingerprints, [fingerprint], 'the host plan carries the reviewed mutation fingerprint');

const barrier = Recovery.makeReplayBarrier(plan.blockedFingerprints);
const replay = barrier.check('fixture.increment', '{"label":"once","delta":1}', true);
A.eq(replay.ok, false, 'canonical argument ordering cannot evade the replay barrier');
if (replay.ok) counter++;
A.eq(counter, 1, 'the reviewed mutation occurred exactly once across crash, review, and attempted resume replay');
A.eq(barrier.check('fixture.increment', '{"delta":2,"label":"different"}', true).ok, true, 'a genuinely different follow-up mutation is not mistaken for replay');

const ready = journal.prepareContinuation('crashed', {
  continuationId: 'continue-once', operator: 'local', blockedFingerprints: plan.blockedFingerprints,
  context: plan.context
});
A.eq(ready.continuation.state, 'ready', 'continuation intent is durable before any provider call');
A.eq(journal.prepareContinuation('crashed', {
  continuationId: 'continue-once', operator: 'local', blockedFingerprints: plan.blockedFingerprints,
  context: plan.context
}).records, ready.records, 'retrying continuation preparation is idempotent');
journal.startContinuation('crashed', { continuationId: 'continue-once', continuedRunId: 'continued-run' });
journal.finishContinuation('crashed', { continuationId: 'continue-once', continuedRunId: 'continued-run', reason: 'done' });
const secondBoot = makeRunJournal({ io, clock: { now: () => ++now } }).recoverAll()[0];
A.eq(secondBoot.continuation.state, 'finished', 'a second reboot preserves completed continuation state');
A.eq(secondBoot.continuation.continuedRunId, 'continued-run', 'the durable audit links the original and continued runs');

const unknownIo = memoryIo();
const unknown = makeRunJournal({ io: unknownIo, clock: { now: () => ++now } });
unknown.begin({ runId: 'unknown-run', agentId: 'agent' });
unknown.checkpoint('unknown-run', { phase: 'assistant', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'u1', type: 'function', function: { name: 'fixture_increment', arguments: '{"delta":1}' } }] }] });
unknown.toolIntent('unknown-run', { callId: 'u1', name: 'fixture.increment', argsRaw: '{"delta":1}', replayFingerprint: Recovery.replayFingerprint('fixture.increment', '{"delta":1}'), mutating: true });
unknown.resolve('unknown-run', { resolutionId: 'resolution-unknown', outcomes: [{ callId: 'u1', outcome: 'unknown' }] });
A.throws(() => Recovery.continuationPlan(unknown.inspect('unknown-run')), 'an unknown operator outcome cannot continue');

const autoIo = memoryIo();
const auto = makeRunJournal({ io: autoIo, clock: { now: () => ++now } });
auto.begin({ runId: 'auto-read', agentId: 'agent' });
auto.checkpoint('auto-read', { phase: 'initial', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'read then finish' }] });
auto.checkpoint('auto-read', { phase: 'assistant', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'fs_read', arguments: '{"path":"a.txt"}' } }] }] });
auto.toolIntent('auto-read', { callId: 'read-1', name: 'fs.read', argsRaw: '{"path":"a.txt"}', mutating: false, boundaryModel: 'prepared-dispatch-v1' });
auto.toolDispatch('auto-read', { callId: 'read-1', name: 'fs.read', mutating: false });
const autoState = auto.inspect('auto-read');
const autoPlan = Recovery.automaticContinuationPlan(autoState);
A.eq(autoPlan.mode, 'automatic', 'a dispatched read with no result receives the automatic continuation mode');
A.eq(autoPlan.messages.map(m => m.role), ['system', 'user', 'assistant', 'tool', 'system'], 'automatic continuation pairs the interrupted read before asking the provider to retry');
A.ok(/read-only call had no durable result/.test(autoPlan.messages[3].content), 'paired read result reports only the recovery fact');
A.ok(/no uncertain dispatched mutations/i.test(autoPlan.context), 'automatic context states the exact safety proof');
const autoReady = auto.prepareContinuation('auto-read', {
  continuationId: 'auto-continue', mode: 'automatic', operator: 'host',
  blockedFingerprints: autoPlan.blockedFingerprints, context: autoPlan.context
});
A.eq([autoReady.continuation.state, autoReady.continuation.mode], ['ready', 'automatic'], 'automatic continuation preparation is durable and typed');

const preparedIo = memoryIo();
const prepared = makeRunJournal({ io: preparedIo, clock: { now: () => ++now } });
prepared.begin({ runId: 'auto-prepared', agentId: 'agent' });
prepared.checkpoint('auto-prepared', { phase: 'assistant', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'write-safe', type: 'function', function: { name: 'fs_write', arguments: '{"path":"a.txt","content":"x"}' } }] }] });
prepared.toolIntent('auto-prepared', { callId: 'write-safe', name: 'fs.write', argsRaw: '{"path":"a.txt","content":"x"}', mutating: true, boundaryModel: 'prepared-dispatch-v1' });
A.eq(Recovery.automaticContinuationPlan(prepared.inspect('auto-prepared')).mode, 'automatic', 'prepared but never dispatched mutation is automatically continuable');

const resultOnlyIo = memoryIo();
const resultOnly = makeRunJournal({ io: resultOnlyIo, clock: { now: () => ++now } });
resultOnly.begin({ runId: 'auto-result', agentId: 'agent' });
resultOnly.checkpoint('auto-result', { phase: 'assistant', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'read-durable', type: 'function', function: { name: 'fs_read', arguments: '{"path":"a.txt"}' } }] }] });
resultOnly.toolIntent('auto-result', { callId: 'read-durable', name: 'fs.read', argsRaw: '{"path":"a.txt"}', mutating: false, boundaryModel: 'prepared-dispatch-v1' });
resultOnly.toolDispatch('auto-result', { callId: 'read-durable', name: 'fs.read', mutating: false });
resultOnly.toolResult('auto-result', { callId: 'read-durable', ok: true, content: 'durable value' });
const resultOnlyPlan = Recovery.automaticContinuationPlan(resultOnly.inspect('auto-result'));
A.eq(resultOnlyPlan.messages.map(m => m.role), ['assistant', 'tool', 'system'], 'a crash after durable result but before the result checkpoint remains automatically continuable');
A.eq(resultOnlyPlan.messages[1].content, 'durable value', 'recovery pairs the exact durable result instead of asking the provider to replay the tool');
A.ok(!/no durable result/.test(resultOnlyPlan.messages[1].content), 'recovery does not misreport a completed tool as interrupted');

const unsafeIo = memoryIo();
const unsafe = makeRunJournal({ io: unsafeIo, clock: { now: () => ++now } });
unsafe.begin({ runId: 'unsafe', agentId: 'agent' });
unsafe.checkpoint('unsafe', { phase: 'assistant', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'write-uncertain', type: 'function', function: { name: 'fs_write', arguments: '{}' } }] }] });
unsafe.toolIntent('unsafe', { callId: 'write-uncertain', name: 'fs.write', argsRaw: '{}', mutating: true, boundaryModel: 'prepared-dispatch-v1' });
unsafe.toolDispatch('unsafe', { callId: 'write-uncertain', name: 'fs.write', mutating: true });
A.throws(() => Recovery.automaticContinuationPlan(unsafe.inspect('unsafe')), 'a dispatched mutation can never enter automatic continuation');
A.throws(() => unsafe.prepareContinuation('unsafe', { continuationId: 'unsafe-auto', mode: 'automatic' }), 'journal refuses automatic preparation when mutation outcome is uncertain');

A.report('run-recovery-continuation.test');
