'use strict';
const A = require('./_assert.js');
const { makeLoopTools, _internals } = require('../sidecar/tools/builtin/loops.js');

(async () => {
  let rows = [{ id: 'lp_1', name: 'Release green', objective: 'keep fixing until tests pass', agentId: 'agent', state: 'idle', enabled: true, exitOn: 'check-green', checkCmd: 'secret host command', pending: [], pendingCount: 0 }];
  const calls = [];
  const tools = makeLoopTools({
    listState: () => ({ loops: rows, halted: true, armed: false, inFlight: 0 }),
    createLoop: async spec => { calls.push(['create', spec]); return Object.assign({}, rows[0], { _duplicate: true, _halted: true }); },
    updateLoop: async (id, patch) => { calls.push(['update', id, patch]); rows[0] = Object.assign({}, rows[0], patch); return Object.assign({}, rows[0], { _halted: true }); },
    controlLoop: async (id, action, reason) => { calls.push(['control', id, action, reason]); rows[0] = Object.assign({}, rows[0], { state: action === 'resume' ? 'idle' : action + 'd' }); return Object.assign({}, rows[0], { _halted: true }); },
    removeLoop: async id => calls.push(['remove', id]),
    verdictLoop: async (id, n, verdict, note) => { calls.push(['verdict', id, n, verdict, note]); return Object.assign({}, rows[0], { pendingCount: 0 }); }
  });

  const listed = JSON.parse((await tools.listTool.run({})).content);
  A.eq(listed.halted, true, 'loop.list reports the durable E-STOP');
  A.eq(listed.armed, false, 'and the real timer state');
  A.eq(listed.loops.length, 1, 'it lists the authoritative store');
  A.eq(Object.prototype.hasOwnProperty.call(listed.loops[0], 'checkCmd'), false, 'the model never reads the host-run check command');
  A.ok(/E-STOP/.test(listed.note), 'the refusal state is plain language');

  const created = JSON.parse((await tools.createTool.run({ objective: 'keep fixing until tests pass', exitOn: 'check-green', workdir: 'C:/approved' }, { agentId: 'agent' })).content);
  A.eq(created.duplicate, true, 'a repeated semantic create reports reuse');
  A.eq(created.durable, true, 'the response is a durable host receipt');
  A.eq(calls[0][1].gate, 'review', 'the model path cannot select auto-apply');
  A.eq(Object.prototype.hasOwnProperty.call(calls[0][1], 'checkCmd'), false, 'the schema/path never carries a model-authored command');
  A.ok(/remain stopped/.test(created.note), 'creating does not lift E-STOP or imply firing');

  await tools.manageTool.run({ loop: 'release', action: 'update', objective: 'fix every failing release test', checkCmd: 'evil' });
  const patch = calls.find(row => row[0] === 'update')[2];
  A.eq(patch.objective, 'fix every failing release test', 'safe metadata is editable');
  A.eq(Object.prototype.hasOwnProperty.call(patch, 'checkCmd'), false, 'unlisted escalation fields are dropped');
  const resumed = JSON.parse((await tools.manageTool.run({ loop: 'lp_1', action: 'resume' })).content);
  A.eq(resumed.halted, true, 'resume still reports the independent E-STOP');
  A.ok(/remains blocked/.test(resumed.note), 'so the model cannot claim it is running');
  await tools.manageTool.run({ loop: 'Release green', action: 'approve', iteration: 2, note: 'looks good' });
  A.eq(calls[calls.length - 1][3], 'approved', 'review verdicts map exactly');
  A.ok(_internals.PATCHABLE.indexOf('checkCmd') < 0 && _internals.PATCHABLE.indexOf('workdir') < 0, 'the patch allowlist withholds command/path authority');

  for (const tool of [tools.listTool, tools.createTool, tools.manageTool]) A.eq(tool.capability, 'orchestrator', tool.name + ' is lead-only');
  A.eq(tools.listTool.requiresConsent, false, 'listing needs no consent');
  A.eq(tools.createTool.requiresConsent, true, 'standing autonomous creation needs consent');
  A.eq(tools.manageTool.requiresConsent, true, 'standing autonomous management needs consent');

  const reg = { names: [], register(tool) { this.names.push(tool.name); } };
  tools.register(reg);
  A.eq(reg.names.join(','), 'loop.list,loop.create,loop.manage', 'all loop tools register');
  const capSrc = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'sidecar', 'capability', 'registry.js'), 'utf8');
  for (const name of reg.names) A.ok(capSrc.indexOf("tool: '" + name + "'") >= 0, name + ' is in the capability allowlist');

  A.report('loop-tools.test');
})().catch(error => { console.error(error); process.exit(1); });
