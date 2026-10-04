/* node test/subagents.test.js - durable background subagent registry. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeSubagentManager } = require('../sidecar/subagents.js');

function tick() { return new Promise(resolve => setImmediate(resolve)); }

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-subagents-'));
  const file = path.join(root, 'subagents.json');
  let T = 1000;
  const clock = { now: () => T++ };
  const emitted = [];
  let n = 0;
  const ids = () => 'id_' + (++n);

  try {
    const mgr = makeSubagentManager({ fs, pathMod: path, file, clock, emit: (name, p) => emitted.push({ name, p }), newId: ids });

    // start returns a watchable running record immediately; events are tailed and existing task events are emitted.
    const s = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'do work' }, async (h) => {
      h.emit('agent.run.start', { agentId: 'worker', runId: h.runId, trigger: 'directive', model: 'm' });
      return { status: 'done', reason: 'done', result: 'finished', usd: 0.12 };
    });
    A.eq(s.status, 'running', 'start returns a running record');
    A.ok(s.id && s.runId, 'record has stable ids');
    await tick(); await tick();
    const done = mgr.get(s.id);
    A.eq(done.status, 'done', 'completed runner marks record done');
    A.eq(done.result, 'finished', 'completed runner stores result');
    A.ok(done.events.some(e => e.name === 'agent.run.start'), 'watch event tail stores forwarded lifecycle');
    A.ok(emitted.some(e => e.name === 'task' && e.p.status === 'running'), 'start emits existing task running event');
    A.ok(emitted.some(e => e.name === 'task' && e.p.status === 'done'), 'completion emits existing task done event');

    // Reconnect truth: a queued record is not yet WORKING; run.start confirms it; run.end clears it
    // immediately even if the runner promise has not completed its final registry patch yet.
    let liveHandle = null, releaseLive = null;
    const live = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'reconnect truth', runId: 'run_live' }, async (h) => {
      liveHandle = h;
      await new Promise(resolve => { releaseLive = resolve; });
      return { status: 'done', reason: 'done', result: 'live done', usd: 0 };
    });
    await tick();
    A.eq(mgr.activeRuns(), [], 'queued background record is not active before agent.run.start confirms it');
    liveHandle.emit('agent.run.start', { agentId: 'worker', runId: live.runId, trigger: 'directive', model: 'm' });
    const active = mgr.activeRuns();
    A.eq(active.length, 1, 'confirmed background worker is exposed to reconnect snapshots');
    A.eq({ runId: active[0].runId, agentId: active[0].agentId, source: active[0].source },
      { runId: live.runId, agentId: 'worker', source: 'subagent' }, 'reconnect activity keeps the exact run and agent identity');
    A.ok(active[0].startedAt > 0, 'reconnect activity carries the confirmed start time');
    liveHandle.emit('agent.run.end', { agentId: 'worker', runId: live.runId, reason: 'done', turns: 1, usd: 0 });
    A.eq(mgr.activeRuns(), [], 'agent.run.end clears reconnect activity before final registry settlement');
    releaseLive(); await tick(); await tick();

    // interrupt aborts the live controller and leaves a resumable durable record.
    let captured = null;
    const hold = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'hold' }, async (h) => {
      captured = h;
      return new Promise(() => {});
    });
    await tick();
    const cut = mgr.interrupt(hold.id, 'lead');
    A.ok(cut.ok, 'interrupt succeeds');
    A.ok(captured.signal.aborted, 'interrupt aborts the live signal');
    const interrupted = mgr.get(hold.id);
    A.eq(interrupted.status, 'interrupted', 'interrupt marks record interrupted');
    A.eq(interrupted.canResume, true, 'interrupted record can resume');
    A.ok(!mgr.interrupt(hold.id, 'other').ok, 'lead ownership is enforced');

    // Steering is durable, one-shot, ownership-bound, and generation-bound.
    let steeredHandle = null, finishSteered;
    const steeredDone = new Promise(resolve => { finishSteered = resolve; });
    const steered = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'steer me',
      resultSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } }, async (h) => {
      steeredHandle = h;
      await steeredDone;
      return { status: 'done', reason: 'done', result: '{"ok":true}', structuredResult: { ok: true },
        validation: { state: 'valid' }, repairRunId: 'repair_1', artifacts: [{ path: 'proof.txt' }], usd: 0.4 };
    });
    await tick();
    A.ok(!mgr.steer(steered.id, 'other', steered.generation, 'wrong owner').ok, 'another lead cannot steer the worker');
    A.ok(!mgr.steer(steered.id, 'lead', steered.generation + 1, 'wrong generation').ok, 'a mismatched generation is rejected');
    A.ok(mgr.steer(steered.id, 'lead', steered.generation, 'use the newer constraint').ok, 'the exact live generation accepts steering');
    A.eq(steeredHandle.steer(), ['use the newer constraint'], 'the worker drains its durable steering instruction once');
    A.eq(steeredHandle.steer(), [], 'an applied steering instruction cannot replay');
    finishSteered(); await tick(); await tick();
    const steeredFinal = mgr.get(steered.id);
    A.eq(steeredFinal.steerHistory[0].status, 'applied', 'steering history records durable application');
    A.eq(steeredFinal.steerHistory[0].origin, 'lead', 'a lead-tool steer is origin-stamped as the lead');
    A.eq(steeredFinal.structuredResult, { ok: true }, 'structured result survives settlement');
    A.eq(steeredFinal.artifacts[0].path, 'proof.txt', 'artifact receipt survives settlement');
    A.eq(steeredFinal.usd, 0.4, 'worker cost survives settlement');

    // COMMANDER STEERING + LEAD CONTEXT (G6): the authenticated local route passes NO leadId — the Commander
    // outranks lead ownership — and the note is origin-stamped so the drain names its source to the worker.
    // The lead's handoff context is durable on the record so resume rebuilds the same opening message.
    let cmdHandle = null, finishCmd;
    const cmdDone = new Promise(resolve => { finishCmd = resolve; });
    const cmdSteered = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'commander steer',
      context: 'the repo root is /srv/app' }, async (h) => {
      cmdHandle = h; await cmdDone;
      return { status: 'done', reason: 'done', result: 'ok', usd: 0 };
    });
    await tick();
    A.eq(mgr.get(cmdSteered.id).context, 'the repo root is /srv/app', 'the lead handoff context is durable on the record');
    A.eq(cmdSteered.context, 'the repo root is /srv/app', 'the view exposes the handoff context');
    A.ok(mgr.steer(cmdSteered.id, undefined, cmdSteered.generation, 'switch to the staging DB', 'commander').ok, 'the Commander (no leadId) can steer a running worker');
    A.eq(mgr.get(cmdSteered.id).steerHistory[0].origin, 'commander', 'steering history records the commander origin truthfully');
    A.eq(cmdHandle.steer(), ['[from the Commander] switch to the staging DB'], 'a commander note names its source at drain');
    finishCmd(); await tick(); await tick();

    // A late settlement from an interrupted generation cannot clobber its resumed replacement.
    let finishOld, finishNew;
    const oldDone = new Promise(resolve => { finishOld = resolve; });
    const newDone = new Promise(resolve => { finishNew = resolve; });
    const racing = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'generation race' }, async () => oldDone);
    await tick(); mgr.interrupt(racing.id, 'lead');
    const racingResume = mgr.resume(racing.id, async () => newDone);
    A.eq(racingResume.record.generation, racing.generation + 1, 'resume advances the worker generation');
    finishOld({ status: 'done', reason: 'done', result: 'old generation', usd: 9 }); await tick(); await tick();
    const duringRace = mgr.get(racing.id);
    A.eq(duringRace.status, 'running', 'late old-generation settlement cannot finish the replacement');
    A.eq(duringRace.generation, racingResume.record.generation, 'late settlement cannot roll back generation');
    finishNew({ status: 'done', reason: 'done', result: 'new generation', usd: 0.1 }); await tick(); await tick();
    A.eq(mgr.get(racing.id).result, 'new generation', 'only the current generation may settle the record');

    // restart/load marks formerly-running records stale; resume restarts in the same durable record.
    const stale = mgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'resume me' }, async () => new Promise(() => {}));
    await tick();
    const mgr2 = makeSubagentManager({ fs, pathMod: path, file, clock, emit: () => {}, newId: ids });
    A.eq(mgr2.get(stale.id).status, 'stale', 'a running record is marked stale on manager reload');
    const resumed = mgr2.resume(stale.id, async () => ({ status: 'done', reason: 'done', result: 'resumed', usd: 0.2 }));
    A.ok(resumed.ok, 'resume starts stale record');
    await tick(); await tick();
    const after = mgr2.get(stale.id);
    A.eq(after.status, 'done', 'resumed runner can complete');
    A.eq(after.result, 'resumed', 'resume stores new result');
    A.ok(after.attempts >= 2, 'resume increments attempts');

    // Crash after durable finalization but before destination publication: restart replays the same logical receipt.
    const crashMgr = makeSubagentManager({ fs, pathMod: path, file, clock, emit: () => {}, newId: ids,
      afterFinalizationCommitted: () => false });
    const crash = crashMgr.start({ leadId: 'lead', agentId: 'worker', prompt: 'survive finalization', destination: 'lead:lead', runId: 'run_final' },
      async () => ({ status: 'done', reason: 'done', result: 'durable answer', usd: 0.33 }));
    await tick(); await tick();
    const pending = crashMgr.get(crash.id);
    A.eq(pending.finalization.state, 'pending', 'completion receipt is durable before publication');
    const recoveredEvents = [];
    const recoveredMgr = makeSubagentManager({ fs, pathMod: path, file, clock, emit: (name, p) => recoveredEvents.push({ name, p }), newId: ids });
    const recovered = recoveredMgr.get(crash.id);
    A.eq(recovered.finalization.state, 'delivered', 'restart reconciles a pending finalization');
    A.eq({ result: recovered.result, usd: recovered.usd, destination: recovered.finalization.destination },
      { result: 'durable answer', usd: 0.33, destination: 'lead:lead' }, 'result, one cost record, and original destination survive together');
    A.eq(recoveredEvents.filter(e => e.name === 'task' && e.p.id === crash.id && e.p.status === 'done').length, 1,
      'recovery publishes one idempotent terminal task receipt');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }

  A.report('subagents.test');
})().catch(e => { console.log('FAIL: subagents.test threw - ' + (e && e.stack || e)); process.exit(1); });
