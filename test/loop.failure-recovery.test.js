/* node test/loop.failure-recovery.test.js — engine-enforced alternative-path recovery.

   A model may see one failed tool and immediately hand the setup burden to the Commander. Prompt doctrine helps,
   but this is important enough to enforce at the loop: the first give-up response after a non-terminal failure
   buys a bounded recovery turn that explicitly requires a different route. Real user denial remains terminal and
   the guard is bounded so it can never create an infinite/spending loop. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');

const TOOLS = ['primary_tool', 'alternate_tool', 'tool_search'].map(name => ({
  type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } }
}));
const openCtx = () => ({ canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' });
const textTurn = text => [{ type: 'text', delta: text }, { type: 'done', finishReason: 'stop' }];
const toolTurn = (name, id) => [
  { type: 'tool_start', index: 0, id, name },
  { type: 'tool_args', index: 0, chunk: '{}' },
  { type: 'done', finishReason: 'tool_calls' }
];
function scripted(turns) {
  let n = 0;
  return {
    async *stream() { const turn = turns[Math.min(n++, turns.length - 1)]; for (const ev of turn) yield ev; },
    priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000, callCount: () => n
  };
}
function setup() {
  const bus = A.makeBus();
  return { emit: makeEmitter(bus, () => {}) };
}
async function run(turns, dispatch, limits) {
  const provider = scripted(turns);
  const messages = [{ role: 'user', content: 'finish the task' }];
  const res = await runAgentLoop({
    messages, provider, emit: setup().emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
    model: 'replay/model', agentId: 'a', runId: 'r', tools: TOOLS, dispatch, capCtx: openCtx(),
    limits: Object.assign({ maxIters: 10, grace: false }, limits || {})
  });
  return { res, messages, provider };
}

(async () => {
  // First failure -> model tries to hand setup to user -> host rejects that premature stop -> alternate succeeds.
  {
    const dispatched = [];
    const out = await run([
      toolTurn('primary_tool', 'c1'),
      textTurn('I cannot do this. Please start a separate program and give me its port.'),
      toolTurn('alternate_tool', 'c2'),
      textTurn('Finished through the alternate route and verified the result.')
    ], async call => {
      dispatched.push(call.name);
      return call.name === 'primary_tool'
        ? { ok: false, isError: true, content: 'primary route unavailable', summary: 'unavailable' }
        : { ok: true, isError: false, content: 'alternate route verified', summary: 'ok' };
    });
    const nudges = out.messages.filter(m => m.role === 'system' && /<failure_recovery>/.test(String(m.content)));
    A.eq(nudges.length, 1, 'one failed path forces a recovery turn before the run may end');
    A.ok(/different query, arguments, strategy, or tool/.test(nudges[0].content), 'recovery turn requires a materially different route');
    A.ok(/tool_search/.test(nudges[0].content), 'recovery turn points at live capability discovery');
    A.eq(dispatched, ['primary_tool', 'alternate_tool'], 'the alternate route actually executes');
    A.eq(out.res.reason, 'done', 'recovered work reaches a clean delivery');
  }

  // A model that ignores recovery remains bounded: two nudges, then an honest final is allowed.
  {
    const out = await run([
      toolTurn('primary_tool', 'c1'),
      textTurn('Cannot continue.'), textTurn('Still cannot continue.'), textTurn('Blocked after exhausting alternatives.')
    ], async () => ({ ok: false, isError: true, content: 'temporary failure', summary: 'error' }));
    const nudges = out.messages.filter(m => m.role === 'system' && /<failure_recovery>/.test(String(m.content)));
    A.eq(nudges.length, 2, 'failure recovery is persistent but bounded to two extra model turns');
    A.eq(out.provider.callCount(), 4, 'the bounded model stops after the two recovery opportunities');
    A.eq(out.res.reason, 'done', 'bounded guard never loops forever');
  }

  // The Commander explicitly denied the action: no workaround pressure may override that authority.
  {
    const out = await run([
      toolTurn('primary_tool', 'c1'), textTurn('The Commander declined that action, so I stopped.')
    ], async () => ({ ok: false, isError: true, content: 'The action was not performed.', summary: 'denied' }));
    const nudges = out.messages.filter(m => m.role === 'system' && /<failure_recovery>/.test(String(m.content)));
    A.eq(nudges.length, 0, 'the consent broker\'s denied summary is an irreducible terminal decision, not a recovery target');
  }

  // A harness capability denial is also terminal: recovery may find another granted tool, but it may not
  // pressure the model to route around the capability boundary that just refused the call.
  {
    const out = await run([
      toolTurn('primary_tool', 'c1'), textTurn('That capability is not granted, so I stopped.')
    ], async () => ({ ok: false, isError: true, content: 'Capability is not granted for this station.', summary: 'capdenied' }));
    const nudges = out.messages.filter(m => m.role === 'system' && /<failure_recovery>/.test(String(m.content)));
    A.eq(nudges.length, 0, 'capability denial stays a terminal safety boundary');
    A.eq(out.res.reason, 'done', 'capability denial can be reported without a forced bypass attempt');
  }

  // Operators/tests can disable this guard explicitly, matching the existing continuation-guard posture.
  {
    const out = await run([
      toolTurn('primary_tool', 'c1'), textTurn('Cannot continue.')
    ], async () => ({ ok: false, isError: true, content: 'failed', summary: 'error' }), { failureRecovery: false });
    A.eq(out.messages.some(m => /<failure_recovery>/.test(String(m.content))), false, 'failureRecovery:false disables the guard');
  }

  A.report('loop.failure-recovery.test');
})().catch(e => { console.error(e); process.exit(1); });
