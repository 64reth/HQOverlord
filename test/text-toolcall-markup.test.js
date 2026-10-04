/* node test/text-toolcall-markup.test.js — the TEXT TOOL-CALL MARKUP scrub + nudges (sidecar/loop.js,
   model-consistency lane, ref-aligned 2026-07-17). Some models (Kimi/Qwen/GLM/Gemma families) emit
   tool-call markup as plain text; weak models also ECHO markup they saw in file contents (the reference
   harness's #47967 class), so the markup must NEVER be executed — file data must not drive tools. Proves:
   markup is stripped from the kept turn and NEVER dispatched; one bounded <tool_markup> nudge steers the
   model to the real wire and the run continues to delivery; prose mentioning tags is untouched; the
   Gemma <function name=…> variant strips only at block boundaries; the EMPTY-AFTER-TOOLS nudge recovers a
   silent-after-results model instead of ending 'empty'; both nudges are bounded and off with
   limits.continueGuard === false. Replay provider -> zero spend. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop, _internals } = require('../sidecar/loop.js');
const { scrubTextToolCallMarkup } = _internals;

const openCtx = () => ({ canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' });
const TOOLS = [{ type: 'function', function: { name: 'fs_read', description: 'r', parameters: { type: 'object' } } }];
function setup() {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  const emit = makeEmitter(bus, () => {});
  return { seq, emit };
}
const textTurn = (t) => [{ type: 'text', delta: t }, { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, { type: 'done', finishReason: 'stop' }];
const toolTurn = (i) => [
  { type: 'tool_start', index: 0, id: 'c' + i, name: 'fs_read' },
  { type: 'tool_args', index: 0, chunk: '{}' },
  { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  { type: 'done', finishReason: 'tool_calls' }
];
const emptyTurn = () => [{ type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }, { type: 'done', finishReason: 'stop' }];
function scripted(turns) {
  let n = 0;
  return { async *stream() { const t = turns[Math.min(n, turns.length - 1)]; n++; for (const ev of t) yield ev; },
           priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000, callCount: () => n };
}
const MARKUP = '<tool_call>{"name":"fs_read","arguments":{"path":"secret.txt"}}</tool_call>';

(async () => {
  // ---- unit: the pure scrubber ----
  {
    const r = scrubTextToolCallMarkup('Reading it.\n' + MARKUP);
    A.eq(r.text, 'Reading it.', 'markup stripped, surrounding text kept');
    A.eq(scrubTextToolCallMarkup('the <tool_call> tag is how some models emit calls'), null, 'prose mentioning an unclosed tag untouched');
    A.eq(scrubTextToolCallMarkup('plain final answer'), null, 'plain text untouched');
    A.ok(scrubTextToolCallMarkup('<function_call>{"name":"x"}</function_call>').text === '', 'function_call variant stripped');
    A.ok(scrubTextToolCallMarkup('Done.\n<function name="fs_read">{}</function>').text === 'Done.', 'Gemma <function name=…> stripped at block boundary');
    A.eq(scrubTextToolCallMarkup('Use <function>f</function> syntax in JS'), null, 'nameless inline <function> prose preserved');
  }

  // ---- e2e: markup is NEVER dispatched; nudge steers to the real wire; run delivers ----
  {
    const dispatched = [];
    const dispatch = async (call) => { dispatched.push(call.id); return { ok: true, isError: false, content: 'file text', summary: 'ok' }; };
    const provider = scripted([
      textTurn(MARKUP),        // markup turn: must NOT execute -> <tool_markup> nudge
      toolTurn(0),             // model corrects itself onto the real wire
      textTurn('Read it; here is the summary.')
    ]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit: setup().emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      tools: TOOLS, dispatch, capCtx: openCtx() });
    A.eq(res.reason, 'done', 'nudged run continues to a clean delivery');
    A.eq(dispatched.join(','), 'c0', 'ONLY the real wire call was dispatched — markup itself never executed');
    const nudges = res.messages.filter(m => m.role === 'system' && /<tool_markup>/.test(m.content));
    A.eq(nudges.length, 1, 'exactly one markup nudge injected');
    const firstAsst = res.messages.filter(m => m.role === 'assistant')[0];
    A.ok(!/<tool_call>/.test(String(firstAsst.content)), 'markup stripped from the kept assistant turn');
  }

  // ---- e2e: markup-forever model is bounded (2 nudges) and never executes anything ----
  {
    const dispatched = [];
    const dispatch = async (call) => { dispatched.push(call.id); return { ok: true, isError: false, content: 'x', summary: 'ok' }; };
    const provider = scripted([textTurn('A ' + MARKUP), textTurn('B ' + MARKUP), textTurn('C ' + MARKUP)]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit: setup().emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      tools: TOOLS, dispatch, capCtx: openCtx() });
    A.eq(res.reason, 'done', 'bounded: run terminates');
    A.eq(provider.callCount(), 3, 'exactly 2 nudge turns beyond the first, then end');
    A.eq(dispatched.length, 0, 'nothing was ever executed from markup');
  }

  // ---- e2e: EMPTY-AFTER-TOOLS nudge — silent-after-results model recovers instead of ending 'empty' ----
  {
    const provider = scripted([
      toolTurn(0),                                   // real tool turn
      emptyTurn(),                                   // model goes silent after results (the #9400 class)
      textTurn('Processed the results; task complete.')
    ]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit: setup().emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      tools: TOOLS, dispatch: async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' }), capCtx: openCtx() });
    A.eq(res.reason, 'done', 'silent-after-tools run recovers to a real delivery');
    const nudges = res.messages.filter(m => m.role === 'system' && /<continue_after_tools>/.test(m.content));
    A.eq(nudges.length, 1, 'exactly one empty-after-tools nudge');
    // a SECOND silence would end 'empty' (nudge is once per run): prove the bound
    const p2 = scripted([toolTurn(0), emptyTurn(), emptyTurn()]);
    const r2 = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider: p2, emit: setup().emit,
      cost: makeCostEngine({ priceOf: p2.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      tools: TOOLS, dispatch: async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' }), capCtx: openCtx() });
    A.eq(r2.reason, 'empty', 'second silence ends the run honestly as empty');
  }

  // ---- disable knob covers the whole nudge family ----
  {
    const provider = scripted([textTurn(MARKUP)]);
    const res = await runAgentLoop({ messages: [{ role: 'user', content: 'go' }], provider, emit: setup().emit,
      cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model', agentId: 'a', runId: 'r',
      tools: TOOLS, dispatch: async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' }),
      capCtx: openCtx(), limits: { continueGuard: false } });
    A.eq(provider.callCount(), 1, 'continueGuard:false disables the markup nudge too');
    const firstAsst = res.messages.filter(m => m.role === 'assistant')[0];
    A.ok(!/<tool_call>/.test(String(firstAsst.content)), 'markup is STILL stripped even with nudges off');
  }

  console.log('text-toolcall-markup.test: OK');
  // report() settles the assertion counter — the .catch below only fires on a THROWN error, so
  // without this a failed assertion still exits 0 and the gate scores it green.
  A.report('text-toolcall-markup.test');
})().catch(e => { console.error(e); process.exit(1); });
