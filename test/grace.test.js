/* node test/grace.test.js — the iteration-ceiling GRACE turn (sidecar/loop.js, P0.3).
   When a run hits maxIters, the loop spends ONE final no-tools turn so the agent can deliver its best answer
   instead of dead-stopping at 'max_iters'. Proves: the grace turn lets a capped run finish 'done' + injects the
   nudge; a grace turn that STILL calls a tool ends 'max_iters' (bounded, one grace only); limits.grace===false
   restores the raw hard cap. Replay provider -> zero spend. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');

const openCtx = () => ({ canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' });
const okDispatch = async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' });
function setup() {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  const emit = makeEmitter(bus, () => {});
  return { seq, emit };
}
// `count` tool turns, then a plain text turn (the model's final answer).
function toolThenText(count) {
  const turns = [];
  for (let i = 0; i < count; i++) turns.push([
    { type: 'tool_start', index: 0, id: 'c' + i, name: 'thing' },
    { type: 'tool_args', index: 0, chunk: '{}' },
    { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
    { type: 'done', finishReason: 'tool_calls' }
  ]);
  turns.push([{ type: 'text', delta: 'final answer' }, { type: 'done', finishReason: 'stop' }]);
  let n = 0;
  return { async *stream() { const t = turns[Math.min(n, turns.length - 1)]; n++; for (const ev of t) yield ev; },
           priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000, callCount: () => n };
}

(async () => {
  // ---- A. grace lets a capped run deliver a final answer -> 'done', with the nudge injected ----
  {
    const { emit } = setup();
    const provider = toolThenText(1);   // turn0: tool (hits maxIters:1), grace turn: text
    const messages = [{ role: 'user', content: 'go' }];
    const res = await runAgentLoop({ messages, provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { maxIters: 1 }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'done', 'grace turn delivers a final answer instead of max_iters');
    const grace = messages.filter(m => m.role === 'system' && /<iteration_limit>/.test(m.content));
    A.eq(grace.length, 1, 'exactly one grace nudge injected');
    const last = res.messages.filter(m => m.role === 'assistant').pop();
    A.ok(last && /final answer/.test(String(last.content)), 'the final assistant answer is present');
  }

  // ---- B. a grace turn that STILL calls a tool -> max_iters (bounded; one grace only) ----
  {
    const { emit } = setup();
    const provider = toolThenText(5);   // every turn within reach is a tool call
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { maxIters: 1 }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'max_iters', 'grace is spent once; a still-tooling run then ends max_iters');
    A.eq(provider.callCount(), 2, 'exactly one extra (grace) turn beyond the cap, not an unbounded spin');
  }

  // ---- C. limits.grace === false restores the raw hard cap (no extra turn) ----
  {
    const { emit } = setup();
    const provider = toolThenText(5);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
      model: 'replay/model', agentId: 'a', runId: 'r', limits: { maxIters: 1, grace: false }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'max_iters', 'grace:false -> hard cap');
    A.eq(provider.callCount(), 1, 'no grace turn when disabled');
  }

  A.report('grace.test');
})();
