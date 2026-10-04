/* node test/iteration-budget.test.js — NO-OP TURN REFUND in the iteration budget (parity with the reference harness, sidecar/loop.js).
   A turn that produces NO tool call AND no NEW assistant content (empty/whitespace text, OR text byte-identical to
   the immediately-prior assistant turn — e.g. a wasted failover/compaction retry) is refunded from the effective
   iteration budget instead of counting against maxIters. Bounded by a HARD FLOOR (limits.refundMax, default 8): past
   the floor even a no-op counts, so a pathological all-no-op run still terminates. A refund emits iteration.refunded
   and NEVER touches the loop guard's failure streak (that only advances on tool-call turns).

   Proves: (1) productive turns count normally; (2) an empty no-op turn is refunded + emits iteration.refunded, and
   the RUN ends reason:'empty' (audit 1.7 — a final turn that produced zero tools and no text is NOT a clean 'done',
   so a degraded provider streaming empty completions is distinguishable from a real finish); (3) a duplicate-content
   no-op turn is refunded with reason 'duplicate' AND the run still ends 'done' (the prior assistant text is a real
   answer — only a genuinely empty final turn is 'empty'); (4) refundMax:0 disables the refund so a no-op turn counts
   (the floor mechanism controls counting → termination is guaranteed), and it still ends 'empty'; (5) the loop guard still
   hard-stops a stuck identical-failing loop with the refund logic in place; (6) replay determinism holds — two runs
   emit a byte-identical event stream. Replay-shaped provider -> zero spend. */
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

// A provider that plays a fixed list of turns (each an array of stream events), clamping to the last once exhausted.
function scriptProvider(turns) {
  let n = 0;
  return {
    async *stream() { const t = turns[Math.min(n, turns.length - 1)]; n++; for (const ev of t) yield ev; },
    priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000, callCount: () => n
  };
}
const usage = { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
const toolTurn = (id, args) => [{ type: 'tool_start', index: 0, id, name: 'thing' }, { type: 'tool_args', index: 0, chunk: args || '{}' }, usage, { type: 'done', finishReason: 'tool_calls' }];
const textTurn = (t) => [{ type: 'text', delta: t }, usage, { type: 'done', finishReason: 'stop' }];
const emptyTurn = [usage, { type: 'done', finishReason: 'stop' }];   // no text, no tool call
const okDispatch = async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' });
const failDispatch = async () => ({ ok: false, isError: true, content: 'nope', summary: 'error' });

(async () => {
  // ---- 1. productive (tool-call) turns COUNT normally; a real final text turn also counts ----
  {
    const { emit } = setup();
    // two tool turns, then a final answer with genuine (new) text -> 3 turns, none refunded
    const provider = scriptProvider([toolTurn('c1'), toolTurn('c2'), textTurn('final answer')]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      limits: { maxIters: 10, grace: false }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'done', 'productive run ends done');
    A.eq(res.turns, 3, 'two tool turns + one content-bearing final turn all count (no refund)');
  }

  // ---- 2. an EMPTY no-op turn is refunded + emits iteration.refunded(empty) ----
  {
    const { seq, emit } = setup();
    const provider = scriptProvider([emptyTurn]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      limits: { maxIters: 1, grace: false }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'empty', 'a final turn that produced ZERO tools and no text ends reason:empty (audit 1.7 — NOT a clean done, so a degraded provider streaming empty completions is distinguishable from a real finish)');
    A.eq(res.turns, 0, 'the empty no-op turn was refunded to the starting count');
    const ref = seq.filter(e => e.name === 'iteration.refunded');
    A.eq(ref.length, 1, 'exactly one iteration.refunded emitted');
    A.eq(ref[0].payload.reason, 'empty', 'the refund event reason is empty');
    A.eq(seq.find(e => e.name === 'agent.run.end').payload.reason, 'empty', 'agent.run.end carries reason:empty (frontend renders "ended: empty", never a delivered crate)');
    A.eq(ref[0].payload.refundsUsed, 1, 'refundsUsed reports the running count');
    A.eq(seq.find(e => e.name === 'agent.run.end').payload.turns, 0, 'run.end reports the refunded effective count');
  }

  // ---- 3. a DUPLICATE-content no-op turn (text == prior assistant turn) is refunded with reason 'duplicate' ----
  {
    const { seq, emit } = setup();
    // turn 1: a tool call whose assistant carries text "SAME"; turn 2: a no-tool turn re-emitting the identical "SAME"
    const dupToolTurn = [{ type: 'text', delta: 'SAME' }, { type: 'tool_start', index: 0, id: 'c1', name: 'thing' }, { type: 'tool_args', index: 0, chunk: '{}' }, usage, { type: 'done', finishReason: 'tool_calls' }];
    const provider = scriptProvider([dupToolTurn, textTurn('SAME')]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      limits: { maxIters: 10, grace: false }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'done', 'a DUPLICATE final turn still ends done (the re-emitted text is a real prior answer — only a genuinely empty final turn is reason:empty; this guards the empty-vs-duplicate scoping)');
    A.eq(res.turns, 1, 'only the productive tool turn counts; the duplicate no-op turn is refunded');
    const ref = seq.filter(e => e.name === 'iteration.refunded');
    A.eq(ref.length, 1, 'the duplicate turn emits one iteration.refunded');
    A.eq(ref[0].payload.reason, 'duplicate', 'reason is duplicate (re-emitted prior assistant text)');
  }

  // ---- 4. FLOOR: limits.refundMax:0 disables refunding — a no-op turn then COUNTS (the floor mechanism controls
  //         counting; past the floor a run terminates at maxIters instead of refunding forever) ----
  {
    const { seq, emit } = setup();
    const provider = scriptProvider([emptyTurn]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      limits: { maxIters: 1, grace: false, refundMax: 0 }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'empty', 'the empty final turn still reads reason:empty even when the refund floor is disabled (the reason reflects WHAT the turn produced — nothing — independent of budget accounting)');
    A.eq(res.turns, 1, 'refundMax:0 -> the no-op turn is NOT refunded, it counts (guarantees termination)');
    A.eq(seq.filter(e => e.name === 'iteration.refunded').length, 0, 'no iteration.refunded when the floor disables refunding');
  }

  // ---- 4b. FLOOR bound is honored: refundMax:1 lets exactly one refund happen, no more ----
  {
    const { seq, emit } = setup();
    // a tool turn, then an empty no-op stop turn; refundMax:1 permits the single refund
    const provider = scriptProvider([toolTurn('c1'), emptyTurn]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      limits: { maxIters: 10, grace: false, refundMax: 1 }, dispatch: okDispatch, capCtx: openCtx() });
    A.eq(res.turns, 1, 'the productive turn counts; the single no-op turn is refunded within the floor');
    A.eq(seq.filter(e => e.name === 'iteration.refunded').length, 1, 'exactly one refund within refundMax:1');
  }

  // ---- 5. LOOP GUARD still fires: a stuck identical-failing loop hard-stops (refund logic never touches its streak) ----
  {
    const { seq, emit } = setup();
    // 10 identical failing tool turns available; the guard must stop at stopAfter (default 6) well before maxIters
    const turns = []; for (let i = 0; i < 10; i++) turns.push(toolTurn('c' + i, '{"x":1}')); turns.push(textTurn('done'));
    const provider = scriptProvider(turns);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      dispatch: failDispatch, capCtx: openCtx() });
    A.eq(res.reason, 'error', 'the stuck loop still ends as error');
    A.eq(provider.callCount(), 6, 'loop guard still stops at stopAfter (6), unaffected by the refund logic');
    A.ok(seq.filter(e => e.name === 'iteration.refunded').length === 0, 'no refund fires — every turn made a tool call');
    A.ok(/loop guard/.test(seq.find(e => e.name === 'agent.run.error').payload.message), 'the guard names itself');
  }

  // ---- 6. DETERMINISM: two identical runs emit a byte-identical event stream (refund path included) ----
  {
    const run = async () => {
      const { seq, emit } = setup();
      const provider = scriptProvider([toolTurn('c1'), emptyTurn]);
      await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit,
        cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
        limits: { maxIters: 10, grace: false }, dispatch: okDispatch, capCtx: openCtx() });
      return seq.map(e => e.name + ':' + JSON.stringify(e.payload));
    };
    const a1 = await run(), a2 = await run();
    A.eq(JSON.stringify(a1), JSON.stringify(a2), 'byte-identical event stream across two runs (refund is deterministic)');
    A.ok(a1.some(s => s.indexOf('iteration.refunded') === 0), 'the stream includes the refund event');
  }

  A.report('iteration-budget.test');
})();
