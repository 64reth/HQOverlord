/* node test/provider.codex.pairing.test.js — the codex tool-pair repair in messagesToInput.
   The Responses backend 400-rejects a request whose input holds a function_call_output with no matching
   function_call ("No tool call found for function call output with call_id …") or a call with no output.
   A transcript that lost one side of a pair (restart/resume/compaction seam) used to replay the orphan on
   EVERY later turn — the chat was permanently bricked (reported live from a Telegram user, call_recovered_3).
   These tests pin the wire invariant: every function_call in the built input has exactly one matching
   function_call_output and vice versa, with no information silently dropped. Pure, zero network. */
'use strict';
const A = require('./_assert.js');
const { _internals } = require('../sidecar/providers/codex.js');
const toInput = _internals.messagesToInput;

function pairingHolds(input) {
  const calls = new Map(), outs = new Map();
  for (const it of input) {
    if (it && it.type === 'function_call') calls.set(it.call_id, (calls.get(it.call_id) || 0) + 1);
    if (it && it.type === 'function_call_output') outs.set(it.call_id, (outs.get(it.call_id) || 0) + 1);
  }
  if (calls.size !== outs.size) return false;
  for (const [id, n] of calls) if (n !== 1 || outs.get(id) !== 1 || !id) return false;
  return true;
}

(function () {
  // A. a well-formed transcript passes through unchanged (the repair is inert on healthy history)
  {
    const input = toInput([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', function: { name: 'web_search', arguments: '{"q":1}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'result body' },
      { role: 'assistant', content: 'done' }
    ]);
    A.eq(input[1], { type: 'function_call', call_id: 'call_1', name: 'web_search', arguments: '{"q":1}' }, 'healthy call unchanged');
    A.eq(input[2], { type: 'function_call_output', call_id: 'call_1', output: 'result body' }, 'healthy result unchanged');
    A.ok(pairingHolds(input), 'healthy transcript pairs');
  }

  // B. THE REPORTED BUG: an orphaned tool result (its call lost from the transcript) must never become a
  //    function_call_output — it is downgraded to a labeled user message, content preserved.
  {
    const input = toInput([
      { role: 'user', content: 'continue' },
      { role: 'tool', tool_call_id: 'call_recovered_3', content: 'the orphaned body' }
    ]);
    A.ok(!input.some(it => it.type === 'function_call_output'), 'orphan result emits NO function_call_output');
    const down = input.find(it => it.role === 'user' && it.content && it.content[0] && /call_recovered_3/.test(it.content[0].text));
    A.ok(down, 'orphan downgraded to a labeled user message naming the call id');
    A.ok(/the orphaned body/.test(down.content[0].text), 'orphan content preserved');
    A.ok(pairingHolds(input), 'orphaned-result transcript pairs');
  }

  // C. the reverse orphan: an assistant call whose result never landed gets a synthesized output right after it
  {
    const input = toInput([
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_lost', function: { name: 'fs_read', arguments: '{}' } }] },
      { role: 'user', content: 'still there?' }
    ]);
    const ci = input.findIndex(it => it.type === 'function_call' && it.call_id === 'call_lost');
    A.ok(ci >= 0, 'the unanswered call is kept');
    A.eq(input[ci + 1] && input[ci + 1].type, 'function_call_output', 'synthesized output directly after the call');
    A.ok(/no recorded result/.test(input[ci + 1].output), 'synthesized output states the truth');
    A.ok(pairingHolds(input), 'unanswered-call transcript pairs');
  }

  // D. a duplicate result for an already-answered call is downgraded, not double-paired
  {
    const input = toInput([
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_9', function: { name: 't', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_9', content: 'first' },
      { role: 'tool', tool_call_id: 'call_9', content: 'second (duplicate)' }
    ]);
    A.eq(input.filter(it => it.type === 'function_call_output').length, 1, 'exactly one output for the call');
    A.ok(input.some(it => it.role === 'user' && /second \(duplicate\)/.test(it.content[0].text)), 'duplicate preserved as user text');
    A.ok(pairingHolds(input), 'duplicate-result transcript pairs');
  }

  // E. an assistant tool_call that arrived with NO id gets a deterministic minted id — never an empty call_id
  {
    const input = toInput([
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'noop', arguments: '{}' } }] }
    ]);
    const call = input.find(it => it.type === 'function_call');
    A.eq(call.call_id, 'call_local_1', 'empty id minted deterministically');
    A.ok(pairingHolds(input), 'minted-id transcript pairs');
  }

  // F. parallel calls with interleaved results still pair (open-map, not adjacency)
  {
    const input = toInput([
      { role: 'assistant', content: '', tool_calls: [
        { id: 'a', function: { name: 't1', arguments: '{}' } },
        { id: 'b', function: { name: 't2', arguments: '{}' } }
      ] },
      { role: 'tool', tool_call_id: 'b', content: 'B' },
      { role: 'tool', tool_call_id: 'a', content: 'A' }
    ]);
    A.ok(pairingHolds(input), 'parallel interleaved results pair');
    A.eq(input.filter(it => it.type === 'function_call_output').length, 2, 'both outputs kept as real outputs');
  }

  A.report('provider.codex.pairing.test');
})();
