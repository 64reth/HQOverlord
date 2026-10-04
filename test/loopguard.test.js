/* node test/loopguard.test.js — the loop guard (sidecar/loop.js): a tool called with IDENTICAL
   arguments that keeps FAILING is a stuck loop, not progress. Proves: warn-nudge at warnAfter,
   hard-stop at stopAfter (in-contract 'error' reason), success clears the streak, varied args never
   trip it, and limits.loopGuard === false disables it. Replay provider -> zero spend. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');

const openCtx = () => ({ canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' });

function setup() {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  const emit = makeEmitter(bus, () => {});
  return { bus, seq, emit };
}

// A provider that emits one tool call per turn for `count` turns, then a plain text turn. argsFn(i)
// yields the raw args string for turn i (identical across turns by default, varied when asked).
function toolLoopProvider(count, argsFn) {
  const turns = [];
  for (let i = 0; i < count; i++) {
    turns.push([
      { type: 'tool_start', index: 0, id: 'c' + i, name: 'thing' },
      { type: 'tool_args', index: 0, chunk: argsFn(i) },
      { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      { type: 'done', finishReason: 'tool_calls' }
    ]);
  }
  turns.push([{ type: 'text', delta: 'done' }, { type: 'done', finishReason: 'stop' }]);
  let n = 0;
  return {
    async *stream() { const t = turns[Math.min(n, turns.length - 1)]; n++; for (const ev of t) yield ev; },
    priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000, callCount: () => n
  };
}

const alwaysFail = async () => ({ ok: false, isError: true, content: 'nope', summary: 'error' });

(async () => {
  // ---- identical failing call: warn nudge at 3, hard-stop at 6 ----
  {
    const { seq, emit } = setup();
    const provider = toolLoopProvider(10, () => '{"x":1}');
    const messages = [{ role: 'user', content: 'go' }];
    const res = await runAgentLoop({ messages, provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', dispatch: alwaysFail, capCtx: openCtx() });

    A.eq(res.reason, 'error', 'a stuck identical-failing loop ends as error (in-contract reason)');
    A.eq(provider.callCount(), 6, 'stops at the stopAfter threshold (6), not the maxIters default (10)');
    const err = seq.filter(e => e.name === 'agent.run.error');
    A.eq(err.length, 1, 'exactly one agent.run.error');
    A.ok(/loop guard/.test(err[0].payload.message), 'the error message names the loop guard');
    A.eq(err[0].payload.transient, false, 'a stuck loop is not transient');
    const nudges = messages.filter(m => m.role === 'system' && /<loop_guard>/.test(m.content));
    A.eq(nudges.length, 1, 'exactly one warn-nudge injected (fires once at warnAfter)');
    A.ok(/same arguments 3 times/.test(nudges[0].content), 'the nudge reports the repeat count at warnAfter');
  }

  // ---- a success clears the streak: never reaches the stop threshold ----
  {
    const { seq, emit } = setup();
    const provider = toolLoopProvider(10, () => '{"x":1}');
    let calls = 0;
    // fail, fail, SUCCEED, fail, fail, fail, ... — the success at #3 resets the counter so STOP (6) is never hit
    const dispatch = async () => { calls++; return calls === 3 ? { ok: true, isError: false, content: 'ok', summary: 'ok' } : { ok: false, isError: true, content: 'nope', summary: 'error' }; };
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { maxIters: 8, grace: false }, dispatch, capCtx: openCtx() });
    A.eq(res.reason, 'max_iters', 'with an intervening success the guard never hard-stops (runs to maxIters)');
    A.ok(seq.filter(e => e.name === 'agent.run.error' && /loop guard/.test(e.payload.message)).length === 0, 'no loop-guard stop when the streak was cleared');
  }

  // ---- varied arguments are legitimate progress: the guard never fires ----
  {
    const { emit } = setup();
    const provider = toolLoopProvider(10, (i) => '{"x":' + i + '}');   // different args every turn
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { maxIters: 5, grace: false }, dispatch: alwaysFail, capCtx: openCtx() });
    A.eq(res.reason, 'max_iters', 'varied-arg failures are not a stuck loop -> runs to maxIters, not a guard stop');
  }

  // ---- disabled: limits.loopGuard === false leaves identical failures alone ----
  {
    const { seq, emit } = setup();
    const provider = toolLoopProvider(10, () => '{"x":1}');
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { maxIters: 4, loopGuard: false, grace: false }, dispatch: alwaysFail, capCtx: openCtx() });
    A.eq(res.reason, 'max_iters', 'loopGuard:false -> no early stop (runs to maxIters)');
    A.eq(seq.filter(e => e.name === 'agent.run.error').length, 0, 'no loop-guard error when disabled');
    A.eq(provider.callCount(), 4, 'ran the full maxIters with the guard off');
  }

  // ---- custom thresholds: stopAfter:2 stops on the second identical failure ----
  {
    const { emit } = setup();
    const provider = toolLoopProvider(10, () => '{"x":1}');
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { loopGuard: { warnAfter: 0, stopAfter: 2 } }, dispatch: alwaysFail, capCtx: openCtx() });
    A.eq(res.reason, 'error', 'custom stopAfter:2 trips on the second identical failure');
    A.eq(provider.callCount(), 2, 'stopped at the custom threshold');
  }

  A.report('loopguard.test');
})();
