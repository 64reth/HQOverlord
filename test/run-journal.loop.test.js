'use strict';
const A = require('./_assert.js');
const { makeRunJournal, _internals } = require('../sidecar/run-journal.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeRunExecutionState } = require('../sidecar/run-execution-state.js');

function memoryIo() {
  const files = new Map();
  return {
    create(id, line) { files.set(id, line + '\n'); },
    append(id, line) { files.set(id, (files.get(id) || '') + line + '\n'); },
    read(id) { return files.get(id); }, list() { return Array.from(files.keys()); },
    readFile(id) { return files.get(id); }, remove(id) { files.delete(id); }, files
  };
}
function provider() {
  let turn = 0;
  return { async *stream() {
    if (turn++ === 0) {
      yield { type: 'tool_start', index: 0, id: 'c1', name: 'fs_write' };
      yield { type: 'tool_args', index: 0, chunk: '{"path":"a.txt","content":"ok"}' };
      yield { type: 'done', finishReason: 'tool_calls' };
    } else {
      yield { type: 'text', delta: 'saved' };
      yield { type: 'done', finishReason: 'stop' };
    }
  } };
}

(async () => {
  const io = memoryIo();
  let tick = 0;
  const journal = makeRunJournal({ io, clock: { now: () => ++tick } });
  const messages = [{ role: 'user', content: 'write it' }];
  journal.begin({ runId: 'r', agentId: 'a' });
  const result = await runAgentLoop({
    messages, provider: provider(), emit() {}, model: 'm', agentId: 'a', runId: 'r',
    onCheckpoint({ phase, messages: current, turn }) { journal.checkpoint('r', { phase, turn, messages: current }); },
    async dispatch(call) {
      journal.toolIntent('r', { callId: call.id, name: call.name, argsRaw: call.argsRaw, mutating: true, boundaryModel: 'prepared-dispatch-v1' });
      journal.toolDispatch('r', { callId: call.id, name: call.name, mutating: true });
      const out = { ok: true, content: 'wrote a.txt', summary: 'saved' };
      journal.toolResult('r', { callId: call.id, ok: true, content: out.content, summary: out.summary });
      return out;
    },
    capCtx: {}
  });
  journal.finish('r', { reason: result.reason, transcriptAck: true });
  const rows = _internals.parseRecords(io.read('r')).records;
  A.eq(rows.map(r => r.type), ['begin', 'checkpoint', 'tool_intent', 'tool_dispatch', 'tool_result', 'checkpoint', 'checkpoint', 'finish'], 'assistant, prepared intent, dispatch, and result are durable in execution order');
  A.eq(rows[1].payload.phase, 'assistant', 'provider-valid tool-call assistant checkpoint is first');
  A.eq(rows[5].payload.phase, 'tool_results', 'paired tool results receive their own checkpoint');
  A.eq(journal.inspect('r').status, 'finished', 'fully paired terminal run is settled');

  const io2 = memoryIo();
  const uncertain = makeRunJournal({ io: io2, clock: { now: () => 1 } });
  uncertain.begin({ runId: 'u', agentId: 'a' });
  const failed = await runAgentLoop({
    messages: [{ role: 'user', content: 'mutate then fail' }], provider: provider(), emit() {}, model: 'm', agentId: 'a', runId: 'u',
    onCheckpoint({ phase, messages: current }) { uncertain.checkpoint('u', { phase, messages: current }); },
    async dispatch(call) {
      uncertain.toolIntent('u', { callId: call.id, name: call.name, mutating: true, boundaryModel: 'prepared-dispatch-v1' });
      uncertain.toolDispatch('u', { callId: call.id, name: call.name, mutating: true });
      const boundary = new Error('process lost result boundary');
      boundary.fatalToRun = true;
      throw boundary;
    }, capCtx: {}
  });
  uncertain.finish('u', { reason: failed.reason });
  A.eq(failed.reason, 'error', 'a lost durable tool boundary terminates the run instead of allowing false success');
  A.eq(uncertain.inspect('u').status, 'needs_review', 'terminal error never makes an unmatched mutation replayable');

  // Production host behavior when the TOOL returned but its durable result append failed: stop immediately as
  // error and retain the unmatched intent. The model never gets another turn in which it could claim success or
  // repeat the effect.
  const io3 = memoryIo();
  const boundary = makeRunJournal({ io: io3, clock: { now: () => 1 } });
  const execution = makeRunExecutionState();
  boundary.begin({ runId: 'boundary', agentId: 'a' });
  const boundaryResult = await runAgentLoop({
    messages: [{ role: 'user', content: 'mutate safely' }], provider: provider(), emit() {},
    model: 'm', agentId: 'a', runId: 'boundary', capCtx: {},
    async dispatch(call) {
      boundary.toolIntent('boundary', { callId: call.id, name: call.name, mutating: true });
      // The underlying tool completed here. Simulate runJournal.toolResult throwing at the production seam.
      return execution.failJournal(new Error('journal disk full'));
    }
  });
  A.eq(boundaryResult.reason, 'error', 'a failed durable result boundary cannot end done');
  const boundaryRetirement = boundary.finishAndRetire('boundary', { reason: boundaryResult.reason, transcriptAck: true });
  A.eq(boundaryRetirement.retired, false, 'the unmatched intent remains after terminal error');
  A.eq(boundaryRetirement.state.status, 'needs_review', 'the retained outcome is explicitly review-required');
  A.ok(io3.files.has('boundary'), 'the recovery evidence remains on disk');

  // If the dispatch append itself fails, the registry boundary returns a terminal error before tool.run. The
  // prepared marker is therefore replayable rather than an unknown side effect.
  const io4 = memoryIo();
  const prepared = makeRunJournal({ io: io4, clock: { now: () => 1 } });
  const preparedExecution = makeRunExecutionState();
  prepared.begin({ runId: 'prepared', agentId: 'a' });
  prepared.toolIntent('prepared', { callId: 'c1', name: 'fs_write', mutating: true, boundaryModel: 'prepared-dispatch-v1' });
  const stoppedBeforeRun = preparedExecution.failJournal(new Error('dispatch fsync failed'), { beforeDispatch: true });
  A.ok(stoppedBeforeRun.control.final, 'dispatch persistence failure is terminal');
  A.ok(/not started/i.test(stoppedBeforeRun.content), 'the result truthfully says the tool did not start');
  A.eq(prepared.inspect('prepared').status, 'resumable', 'prepared-only mutation is recoverable without operator review');
  A.eq(prepared.inspect('prepared').replayablePrepared.map(x => x.callId), ['c1'], 'prepared recovery retains the exact call');

  A.report('run-journal.loop.test');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
