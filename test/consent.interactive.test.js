/* node test/consent.interactive.test.js — the INTERACTIVE consent path, driven through the REAL agentic loop
   (not just the broker unit). Proves the live just-in-time prompt actually works end to end on the seams the
   sidecar wires: an interactive broker whose prompt() resolves a human decision, a fs.write that requiresConsent,
   the dotted->underscore wire boundary, and the loop that await-PAUSES on consent then resumes. Zero network,
   zero spend (replay provider). This is the test that would catch a broken async-consent pause, a deny that
   isn't a clean paired isError, or an 'always' that re-prompts.

   Also locks the emitter safety net: a well-formed permission.prompt VALIDATES and reaches the bus (so the UI
   always sees it — a silently-dropped event would hang the run on the 120s timeout), and a malformed one is
   rejected (proving the validation is real). */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');
const os = require('os');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeReplayProvider } = require('../sidecar/providers/replay.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');
const { makeNotebookTools } = require('../sidecar/tools/builtin/notebook.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');
const { makeCapCtx } = require('../sidecar/capability/capGate.js');
const { makeConsentBroker } = require('../sidecar/permissions.js');

const ROOT = path.join(os.tmpdir(), 'starnet-consent-itest-' + process.pid);

function writeTurn(wirePath) {
  return [
    { type: 'tool_start', index: 0, id: 'c_' + wirePath, name: 'fs_write' },
    { type: 'tool_args', index: 0, chunk: JSON.stringify({ path: wirePath, content: '# note\nbody' }) },
    { type: 'usage', usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 } },
    { type: 'done', finishReason: 'tool_calls' }
  ];
}
function notebookWriteTurn() {
  return [
    { type: 'tool_start', index: 0, id: 'nb1', name: 'notebook_write' },
    { type: 'tool_args', index: 0, chunk: JSON.stringify({ title: 'fact', body: 'remember this' }) },
    { type: 'usage', usage: { prompt_tokens: 14, completion_tokens: 4, total_tokens: 18 } },
    { type: 'done', finishReason: 'tool_calls' }
  ];
}
const reportTurn = [
  { type: 'text', delta: 'Done, Commander.' },
  { type: 'usage', usage: { prompt_tokens: 18, completion_tokens: 4, total_tokens: 22 } },
  { type: 'done', finishReason: 'stop' }
];
const MODELS = [{ id: 'replay/model', context_length: 8000, pricing: { prompt: '0.000001', completion: '0.000002' }, supportsTools: true }];

// Build the SAME graph the sidecar host builds (registry + fs cabinet, object=capability, wire-name boundary, the
// interactive broker) and run the mission. `decision` is what the simulated human clicks; `asked` records every
// time the broker actually prompted (so we can prove it asked exactly when it should).
async function runMission(turns, decision) {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  const emit = makeEmitter(bus, () => {});

  const registry = makeRegistry();
  makeFsTools({ fsp, pathMod: path, root: ROOT, limits: { writeBytes: 1 << 20, readReturn: 24000 } }).register(registry);
  makeNotebookTools({ store: new Map(), clock: { now: () => 0 } }).register(registry);

  const station = { agents: { agent: { id: 'agent', room: 'office' } }, rooms: { office: { id: 'office', objects: [
    { instanceId: 'pc1', objectType: 'computer' }, { instanceId: 'cab1', objectType: 'cabinet' }, { instanceId: 'nb1', objectType: 'notebook' }
  ] } } };
  const resolved = resolveTools('agent', station);

  const asked = [];
  const prompt = (call, tool) => { asked.push({ name: call.name, scope: tool && tool.scope }); return Promise.resolve(decision); };
  const consent = makeConsentBroker({
    sessionKey: 'itest', surface: 'interactive', prompt,
    networkOf: (c) => !!resolved.networkCaps[c.name]
  });
  const capCtx = makeCapCtx(resolved, { emit, consent, timeoutMs: 5000 });

  const toolDefs = registry.wireFormat(registry.list(new Set(resolved.tools)));
  const fromWire = new Map();
  for (const d of toolDefs) { const real = d.function.name; const w = real.replace(/\./g, '_'); fromWire.set(w, real); d.function.name = w; }
  const dispatch = async (c, ctx) => {
    if (fromWire.has(c.name)) c = Object.assign({}, c, { name: fromWire.get(c.name) });
    return registry.dispatch(c, ctx);
  };

  const provider = makeReplayProvider({ models: MODELS, turns });
  const cost = makeCostEngine({ priceOf: provider.priceOf });
  const res = await runAgentLoop({
    messages: [{ role: 'user', content: 'do the mission' }],
    provider, emit, cost, tools: toolDefs, dispatch, capCtx,
    model: 'replay/model', agentId: 'agent', runId: 'itest',
    limits: { maxIters: 8, maxCostUsd: 1 }, clock: { now: () => 0 }
  });
  return { res, seq, asked };
}

const exists = async (rel) => { try { await fsp.access(path.join(ROOT, 'agent', rel)); return true; } catch (e) { return false; } };

(async () => {
  // ---- 1. APPROVE ONCE: the loop pauses on consent, the human says 'once', the write goes through ----
  {
    const { res, seq, asked } = await runMission([writeTurn('approved.md'), reportTurn], 'once');
    A.eq(res.reason, 'done', 'once: mission completes');
    A.eq(asked.length, 1, 'once: the broker prompted exactly once');
    A.eq(asked[0], { name: 'fs.write', scope: 'write' }, 'once: prompted for the real dotted tool name + write scope');
    A.ok(await exists('approved.md'), 'once: the approved write REALLY landed on disk');
    const tr = seq.filter(e => e.name === 'agent.tool_result').map(e => e.payload);
    A.eq(tr.length, 1, 'once: exactly one tool result (pairing held)');
    A.eq(tr[0].isError, false, 'once: the write succeeded');
    A.ok(seq.find(e => e.name === 'deliverable' && e.payload.title === 'approved.md'), 'once: emitted a deliverable');
    A.ok(!seq.find(e => e.name === 'agent.run.error'), 'once: no run error');
  }

  // ---- 2. DENY: the write is refused, no bytes touch disk, the run still ends cleanly (paired isError, not a crash) ----
  {
    const { res, seq, asked } = await runMission([writeTurn('denied.md'), reportTurn], 'deny');
    A.eq(asked.length, 1, 'deny: the broker prompted once');
    A.ok(!(await exists('denied.md')), 'deny: nothing was written (no action on deny)');
    const tr = seq.filter(e => e.name === 'agent.tool_result').map(e => e.payload);
    A.eq(tr.length, 1, 'deny: exactly one tool result (pairing held)');
    A.eq(tr[0].isError, true, 'deny: surfaced as an isError result');
    A.eq(tr[0].summary, 'denied', 'deny: result summary marks it a consent denial');
    A.eq(res.reason, 'done', 'deny: the run still finishes cleanly (denial is a result, not a thrown error)');
    A.ok(!seq.find(e => e.name === 'agent.run.error'), 'deny: a refusal is NOT a run error');
  }

  // ---- 3. ALWAYS: grant the danger CLASS once; a SECOND write in the same run must NOT re-prompt (cache tier) ----
  {
    const { res, asked } = await runMission([writeTurn('a1.md'), writeTurn('a2.md'), reportTurn], 'always');
    A.eq(res.reason, 'done', 'always: two-write mission completes');
    A.eq(asked.length, 1, 'always: prompted only on the FIRST write; the second short-circuited via the cache');
    A.ok(await exists('a1.md'), 'always: first write landed');
    A.ok(await exists('a2.md'), 'always: second (un-prompted) write landed');
  }

  // ---- 4. NOTEBOOK is the agent's private memory — a write must NEVER prompt (consent gate off), even with a
  //         deny-disposed human. Guards the deliberate notebook.write requiresConsent:false. ----
  {
    const { res, seq, asked } = await runMission([notebookWriteTurn(), reportTurn], 'deny');
    A.eq(asked.length, 0, 'notebook write did NOT prompt (no consent gate) — the human is never even asked');
    A.eq(res.reason, 'done', 'notebook mission completes');
    const tr = seq.filter(e => e.name === 'agent.tool_result').map(e => e.payload);
    A.eq(tr.length, 1, 'one tool result');
    A.eq(tr[0].isError, false, 'the note saved without approval');
  }

  // ---- 5. EMITTER SAFETY NET: a well-formed permission.prompt validates + reaches the bus; a malformed one drops ----
  {
    const bus = A.makeBus(); const got = [];
    bus.on('permission.prompt', p => got.push(p));
    const emit = makeEmitter(bus, () => {});
    const good = emit('permission.prompt', { promptId: 'p1', agentId: 'agent', tool: 'fs.write', scope: 'write', argsSummary: 'approved.md' });
    A.ok(good === true, 'a well-formed permission.prompt validates and reaches the bus (never silently dropped → the UI always sees it)');
    A.eq(got.length, 1, 'the bus received exactly one prompt');
    const bad = emit('permission.prompt', { promptId: 'p2' });   // missing required agentId/tool/scope
    A.ok(bad === false, 'an incomplete permission.prompt is rejected (validation is real, not a no-op)');
    A.eq(got.length, 1, 'the malformed prompt never reached the bus');
  }

  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) {}
  A.report('consent.interactive.test');
})();
