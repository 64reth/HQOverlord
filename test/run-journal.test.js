'use strict';
const A = require('./_assert');
const J = require('../sidecar/run-journal');

function memoryIo() {
  const files = new Map();
  return {
    create(id, line) { if (files.has(id)) throw new Error('exists'); files.set(id, line + '\n'); },
    append(id, line) { if (!files.has(id)) throw new Error('missing'); files.set(id, files.get(id) + line + '\n'); },
    read(id) { return files.get(id); }, list() { return Array.from(files.keys()); },
    readFile(id) { return files.get(id); }, remove(id) { files.delete(id); }, quarantine(id) { files.set(id + '.corrupt', files.get(id)); files.delete(id); return id + '.corrupt'; },
    repair(id, records) { files.set(id + '.corrupt', files.get(id)); files.set(id, records.map(r => JSON.stringify(r)).join('\n') + '\n'); return id + '.corrupt'; },
    files
  };
}

let tick = 100;
const io = memoryIo();
const j = J.makeRunJournal({ io, clock: { now: () => ++tick }, redact: s => s.replace(/secret/g, '[redacted]') });
j.begin({ runId: 'r1', agentId: 'a', messages: [{ role: 'user', content: 'secret request' }] });
j.checkpoint('r1', { phase: 'assistant', messages: [{ role: 'assistant', content: 'working' }] });
j.toolIntent('r1', { callId: 'c1', name: 'fs.write', argsRaw: '{"value":"secret"}', mutating: true });
let state = j.inspect('r1');
A.eq(state.status, 'needs_review', 'an unmatched tool intent requires review');
A.eq(state.uncertain.length, 1, 'the uncertain boundary is retained');
A.ok(!io.read('r1').includes('secret'), 'journal strings are redacted before persistence');

j.toolResult('r1', { callId: 'c1', ok: true, content: 'saved' });
j.checkpoint('r1', { phase: 'tool_results', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'c1' }] }, { role: 'tool', tool_call_id: 'c1', content: 'saved' }] });
state = j.inspect('r1');
A.eq(state.status, 'resumable', 'a paired result is safe to resume');
A.eq(state.checkpoint.phase, 'tool_results', 'latest provider-valid checkpoint wins');
A.eq(state.completed.length, 1, 'paired intent/result evidence survives recovery analysis');
A.eq(state.meta.agentId, 'a', 'run metadata remains available to the restart reconciler');
j.recoveryAttempt('r1', { sequence: 1, stage: 'provider_stream', action: 'retry', reason: 'timeout' });
A.eq(j.inspect('r1').recoveryAttempts.map(x => x.action), ['retry'], 'recovery attempt survives journal inspection');

j.finish('r1', { reason: 'done', transcriptAck: true });
state = j.inspect('r1');
A.eq(state.status, 'finished', 'a terminal record is not offered as interrupted work');
j.remove('r1');
A.eq(io.files.has('r1'), false, 'settled journals can be removed after transcript persistence');

const badIo = memoryIo();
const bad = J.makeRunJournal({ io: badIo, clock: { now: () => 1 } });
bad.begin({ runId: 'broken', messages: [] });
badIo.files.set('broken', badIo.files.get('broken') + '{bad-json\n');
const recovered = bad.recoverAll();
A.eq(recovered.length, 1, 'corrupt-tail journal is discovered');
A.eq(recovered[0].corrupt, true, 'corrupt tail is disclosed');
A.eq(recovered[0].status, 'resumable', 'valid prefix remains recoverable');
bad.checkpoint('broken', { phase: 'after-repair', messages: [] });
A.eq(bad.inspect('broken').records, 2, 'new records remain visible after a torn tail is repaired');

const unknownIo = memoryIo();
const unknown = J.makeRunJournal({ io: unknownIo, clock: { now: () => 2 } });
unknown.begin({ runId: 'unknown', messages: [] });
unknown.toolIntent('unknown', { callId: 'side-effect', name: 'shell.exec', mutating: true });
const uncertainRetirement = unknown.finishAndRetire('unknown', { reason: 'error', transcriptAck: true });
A.eq(uncertainRetirement.retired, false, 'an unmatched side-effect intent is never retired');
A.eq(uncertainRetirement.state.status, 'needs_review', 'run.end cannot erase an unknown side-effect outcome');
A.ok(unknownIo.files.has('unknown'), 'the review-required journal remains durable and discoverable');
const resolved = unknown.resolve('unknown', {
  resolutionId: 'resolution-1', operator: 'local',
  outcomes: [{ callId: 'side-effect', outcome: 'happened' }],
  note: 'verified in the target system'
});
A.eq(resolved.status, 'resolved', 'an explicit operator verdict closes review without replaying the tool');
A.eq(resolved.uncertain.length, 1, 'resolution retains the original uncertain boundary as audit evidence');
A.eq(resolved.resolution.outcomes[0].outcome, 'happened', 'the verified outcome is durable and inspectable');
A.eq(resolved.finish.reason, 'error', 'the original terminal evidence remains inspectable after an additive resolution');
A.eq(unknown.resolve('unknown', {
  resolutionId: 'resolution-1', operator: 'local',
  outcomes: [{ callId: 'side-effect', outcome: 'happened' }],
  note: 'verified in the target system'
}).records, resolved.records, 'retrying the same resolution id is idempotent and appends nothing');
A.throws(() => unknown.resolve('unknown', {
  resolutionId: 'resolution-2', operator: 'local',
  outcomes: [{ callId: 'side-effect', outcome: 'did_not_happen' }]
}), 'a different verdict cannot overwrite the durable operator resolution');

const retiredIo = memoryIo();
const retired = J.makeRunJournal({ io: retiredIo, clock: { now: () => 2 } });
retired.begin({ runId: 'retired', messages: [] });
retired.toolIntent('retired', { callId: 'read', name: 'station.inspect', mutating: false });
retired.toolResult('retired', { callId: 'read', ok: true, content: 'ok' });
const cleanRetirement = retired.finishAndRetire('retired', { reason: 'done', transcriptAck: true });
A.eq(cleanRetirement.retired, true, 'a fully paired, transcript-acknowledged journal retires');
A.eq(retiredIo.files.has('retired'), false, 'clean retirement removes the redundant journal');

const readIo = memoryIo();
const read = J.makeRunJournal({ io: readIo, clock: { now: () => 2 } });
read.begin({ runId: 'read', agentId: 'a', messages: [] });
read.checkpoint('read', { phase: 'assistant', messages: [{ role: 'assistant', content: '', tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'fs.read', arguments: '{"path":"notes.txt"}' } }] }] });
read.toolIntent('read', { callId: 'read-1', name: 'fs.read', mutating: false });
const readState = read.inspect('read');
A.eq(readState.status, 'resumable', 'an unmatched explicitly read-only intent is safe to replay from its checkpoint');
A.eq(readState.uncertain.length, 0, 'a read-only intent is not misreported as an unknown side effect');
A.eq(readState.replayableReads.map(x => x.callId), ['read-1'], 'recovery retains the exact read call to replay once');

// The v1 prepared/dispatched protocol narrows mutation uncertainty without weakening legacy recovery. A newly
// prepared call is known not to have reached tool.run; once the durable dispatch record exists, a missing result
// is again review-required. Legacy unmatched mutations above remain conservative because they lack the marker.
const phasedIo = memoryIo();
const phased = J.makeRunJournal({ io: phasedIo, clock: { now: () => 3 } });
phased.begin({ runId: 'phased', messages: [] });
phased.toolIntent('phased', {
  callId: 'write-1', name: 'fs.write', mutating: true,
  boundaryModel: J.DISPATCH_BOUNDARY_MODEL
});
let phasedState = phased.inspect('phased');
A.eq(phasedState.status, 'resumable', 'a newly prepared mutation is safe to resume because tool.run was not reached');
A.eq(phasedState.replayablePrepared.map(x => x.callId), ['write-1'], 'prepared mutation is visible as a distinct recovery class');
A.eq(phasedState.uncertain.length, 0, 'prepared-only mutation is not falsely reported as having possibly happened');
phased.toolDispatch('phased', { callId: 'write-1', name: 'fs.write', mutating: true });
phasedState = phased.inspect('phased');
A.eq(phasedState.status, 'needs_review', 'a dispatched mutation with no durable result requires review');
A.eq(phasedState.uncertain.map(x => x.callId), ['write-1'], 'dispatch boundary identifies the exact uncertain mutation');

const dispatchedReadIo = memoryIo();
const dispatchedRead = J.makeRunJournal({ io: dispatchedReadIo, clock: { now: () => 3 } });
dispatchedRead.begin({ runId: 'dispatched-read', messages: [] });
dispatchedRead.toolIntent('dispatched-read', {
  callId: 'read-2', name: 'fs.read', mutating: false,
  boundaryModel: J.DISPATCH_BOUNDARY_MODEL
});
dispatchedRead.toolDispatch('dispatched-read', { callId: 'read-2', name: 'fs.read', mutating: false });
const dispatchedReadState = dispatchedRead.inspect('dispatched-read');
A.eq(dispatchedReadState.status, 'resumable', 'a dispatched read remains safe to replay after a lost result');
A.eq(dispatchedReadState.replayableReads.map(x => x.callId), ['read-2'], 'dispatched read recovery remains explicit');

const pendingIo = memoryIo();
const pending = J.makeRunJournal({ io: pendingIo, clock: { now: () => 3 } });
pending.begin({ runId: 'pending', messages: [] });
pending.finish('pending', { reason: 'done', transcriptAck: false });
A.eq(pending.inspect('pending').status, 'awaiting_commit', 'terminal run remains recoverable until transcript durability is acknowledged');

const scrubIo = memoryIo();
const scrub = J.makeRunJournal({ io: scrubIo, clock: { now: () => 4 } });
scrub.begin({ runId: 'scrub', messages: [] });
scrub.toolIntent('scrub', { callId: 'x', name: 'connector.write', argsRaw: '{"password":"hunter2","nested":{"api_key":"ordinary-value"},"safe":"kept"}' });
const scrubbedBytes = scrubIo.read('scrub');
A.ok(!/hunter2|ordinary-value/.test(scrubbedBytes), 'serialized JSON credential fields are scrubbed by key');
A.ok(/kept/.test(scrubbedBytes), 'non-secret tool arguments remain reviewable');
scrub.toolResult('scrub', { callId: 'x', content: JSON.stringify({ credentials: { value: 'nested-secret' }, authorization: { value: 'Basic abc123' }, compass: 'north' }) });
const containerBytes = scrubIo.read('scrub');
A.ok(!/nested-secret|abc123/.test(containerBytes), 'credential-shaped object containers are scrubbed as a whole');
A.ok(/compass/.test(containerBytes), 'ordinary keys containing pass-like letters are not over-redacted');

const contextIo = memoryIo();
const contextJournal = J.makeRunJournal({ io: contextIo, clock: { now: () => 5 } });
contextJournal.begin({ runId: 'context', agentId: 'a' });
contextJournal.checkpoint('context', { phase: 'initial', messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'request' }] });
contextJournal.checkpoint('context', { phase: 'assistant', messages: [{ role: 'assistant', content: 'work', tool_calls: [{ id: 'c' }] }] });
const contextState = contextJournal.inspect('context');
A.eq(contextState.checkpoint.messages.map(m => m.role), ['system', 'user', 'assistant'], 'recovery checkpoint combines initial provider context with the latest run delta');
A.eq(contextState.baseCheckpoint.messages.length, 2, 'initial provider context remains separately inspectable');
A.eq(contextState.deltaCheckpoint.phase, 'assistant', 'latest run delta remains separately inspectable for recovery reconciliation');

// The real fs writer must retry short writes instead of accepting a torn record.
const chunks = [];
const fakeFs = {
  writeSync(fd, buf, off, len) { const n = Math.min(3, len); chunks.push(Buffer.from(buf.subarray(off, off + n))); return n; }
};
J._internals.writeAll(fakeFs, 1, 'abcdefghij');
A.eq(Buffer.concat(chunks).toString(), 'abcdefghij', 'short writes are completed fully');

A.report('run-journal.test');
