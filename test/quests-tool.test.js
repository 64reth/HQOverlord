/* node test/quests-tool.test.js — the quest.update builtin tool (sidecar/tools/builtin/quests.js, QUEST V2 §B).
   Drives the tool against a REAL questStore over an in-memory fs (no disk, deterministic — every timestamp
   injected via the tool's clock). Proves: op routing (progress / attest_complete / mint / unknown); agent
   SCOPING (progress rejects a quest that isn't open for the calling agent); attest EVIDENCE requirement + the
   honest "proposed, not complete" copy + mechanical-contract rejection passthrough; mint contract-rule + cap
   error passthrough VERBATIM; and that it is wired into CAP_REGISTRY under the universally-present computer object
   (the 'quest' freebie capId), NOT the notebook — so a bare interactive office still grants it. */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const { makeQuestStore } = require('../sidecar/quest-store.js');
const { makeQuestTools } = require('../sidecar/tools/builtin/quests.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

function memFs() {
  const files = new Map();
  return {
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, data) { files.set(String(f), String(data)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); },
    mkdirSync() {}, unlinkSync(f) { files.delete(String(f)); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => { fs.writeFileSync(file, data); };
function fresh() { return makeQuestStore({ fs: memFs(), path, workspaces: '/ws', writeDurable }); }
// a monotonic injected clock so the tool's now() is deterministic.
function toolFor(store, activeGoal) { let t = 0; return makeQuestTools({ store, clock: { now: () => ++t }, activeGoal: () => activeGoal || null }).questUpdateTool; }
const ctxOf = (agentId, runId) => ({ agentId, runId });

(async () => {

  // ---- CAP_REGISTRY: quest.update is granted under the universally-present `computer` object (the compute freebie) ----
  // It MOVED off the notebook: the interactive baseline office is compute-only with no placed notebook, so a
  // notebook-scoped quest.update was ABSENT while the STATION QUESTS prompt commanded it (truthful-telemetry break).
  {
    const rows = (CAP_REGISTRY.computer || []).filter(g => g.tool === 'quest.update');
    A.eq(rows.length, 1, 'quest.update is registered exactly once under the computer object');
    A.eq(rows[0].capId, 'quest', 'quest.update belongs to the freebie quest capability (not compute — that would be swallowed by the compute gate)');
    A.eq(rows[0].requiresConsent, false, 'quest.update is consent-free (freebie trust class, like todo)');
    const onNotebook = (CAP_REGISTRY.notebook || []).filter(g => g.tool === 'quest.update');
    A.eq(onNotebook.length, 0, 'quest.update is NO LONGER granted by the notebook object');
  }

  // ---- op:progress — agent scoping + step ticking ----
  {
    const store = fresh();
    const tool = toolFor(store);
    const q = await store.mint({ title: 'Automate CSV', contract: { type: 'run', key: 'r1' },
      steps: [{ key: 'a', label: 'gather' }, { key: 'b', label: 'script' }], agentId: 'hero', kind: 'work' }, 1);
    A.ok(q.ok, 'seed: a hero work quest with steps');

    // a DIFFERENT agent cannot progress hero's quest (agent scoping via openForAgent)
    const denied = await tool.run({ op: 'progress', id: q.id, stepKey: 'a', note: 'x' }, ctxOf('intruder', 'run9'));
    A.ok(/not one of your open quests/.test(denied.content), 'progress is rejected for an agent the quest is not open for');
    A.eq(store.get(q.id).steps[0].done, false, 'the step stayed un-ticked after the scoped rejection');

    // the owner CAN progress it
    const ok = await tool.run({ op: 'progress', id: q.id, stepKey: 'a', note: 'gathered the columns' }, ctxOf('hero', 'run1'));
    A.ok(/Ticked step "a"/.test(ok.content), 'the owning agent ticks the step');
    A.eq(store.get(q.id).steps[0].done, true, 'the step is now done in the store');
    A.eq(store.get(q.id).steps[0].note, 'gathered the columns', 'the progress note is recorded on the step');

    // missing id / stepKey / unknown step are honest no-ops
    A.ok(/Pass the quest id/.test((await tool.run({ op: 'progress', stepKey: 'a' }, ctxOf('hero'))).content), 'progress with no id → asks for id');
    A.ok(/Pass the stepKey/.test((await tool.run({ op: 'progress', id: q.id }, ctxOf('hero'))).content), 'progress with no stepKey → asks for stepKey');
    A.ok(/No open step "zzz"/.test((await tool.run({ op: 'progress', id: q.id, stepKey: 'zzz' }, ctxOf('hero'))).content), 'progress on an unknown step → honest no-op');
  }

  // ---- op:start — explicitly bind ONLY the named run quest to THIS run ----
  {
    const store = fresh();
    const tool = toolFor(store);
    const first = await store.mint({ title: 'First run quest', contract: { type: 'run', key: 'work:first' }, agentId: 'hero' }, 1);
    const second = await store.mint({ title: 'Second run quest', contract: { type: 'run', key: 'work:second' }, agentId: 'hero' }, 2);
    const attest = await store.mint({ title: 'Not mechanical', contract: { type: 'attest', key: '' }, agentId: 'hero' }, 3);

    const started = await tool.run({ op: 'start', id: second.id }, ctxOf('hero', 'live-run'));
    A.ok(/Started quest/.test(started.content), 'start reports the explicitly named quest as started');
    A.eq(store.get(first.id).runId, null, 'another open run quest is NOT attached to the live run');
    A.eq(store.get(second.id).runId, 'live-run', 'the explicitly started run quest is bound to the live run');
    A.ok(/needs the current run/.test((await tool.run({ op: 'start', id: first.id }, ctxOf('hero', null))).content), 'start without a live runId is refused');
    A.ok(/not one of your open quests/.test((await tool.run({ op: 'start', id: first.id }, ctxOf('intruder', 'bad-run'))).content), 'another agent cannot start an owned quest');
    A.ok(/not a run quest/.test((await tool.run({ op: 'start', id: attest.id }, ctxOf('hero', 'live-run'))).content), 'a non-run contract cannot be bound through start');
  }

  // ---- op:attest_complete — evidence required, proposes (never completes), mechanical rejected ----
  {
    const store = fresh();
    const tool = toolFor(store);
    const attestQ = await store.mint({ title: 'Draft launch email', contract: { type: 'attest', key: '' }, agentId: 'hero' }, 1);
    const runQ = await store.mint({ title: 'Build the thing', contract: { type: 'run', key: 'r2' }, agentId: 'hero', kind: 'work' }, 1);

    // no evidence → rejected by the tool BEFORE the store
    const noEv = await tool.run({ op: 'attest_complete', id: attestQ.id }, ctxOf('hero', 'run1'));
    A.ok(/needs concrete evidence/.test(noEv.content), 'attest_complete without evidence is rejected');
    A.eq(store.get(attestQ.id).attest, null, 'no pending attest was set without evidence');

    // real evidence → PROPOSED, never completed
    const proposed = await tool.run({ op: 'attest_complete', id: attestQ.id, evidence: 'wrote a 3-paragraph email tailored to the launch, saved to workspace' }, ctxOf('hero', 'run1'));
    A.ok(/proposed/i.test(proposed.content) && /NOT complete/.test(proposed.content), 'attest copy is honest: proposed, not complete');
    A.eq(store.get(attestQ.id).status, 'open', 'the quest is STILL open after attest (Commander must confirm)');
    const at = store.get(attestQ.id).attest;
    A.eq(at.confirmed, null, 'the attest is pending (confirmed=null)');
    A.eq(at.agentId, 'hero', 'the attest carries the calling agentId from ctx');
    A.eq(at.runId, 'run1', 'the attest carries the runId from ctx');

    // a MECHANICAL (run) contract cannot be attested — the store's error string passes through
    const mech = await tool.run({ op: 'attest_complete', id: runQ.id, evidence: 'I say it is done, trust me' }, ctxOf('hero', 'run1'));
    A.ok(/completes mechanically/.test(mech.content), 'attesting a mechanical quest surfaces the store rejection verbatim');
    A.eq(store.get(runQ.id).attest, null, 'no attest was set on the mechanical quest');
  }

  // ---- op:attest_complete — AGENT SCOPING (mirrors progress): quest ids are sequential/guessable, so an
  //      unscoped attest would let any agent put a false completion proposal in front of the Commander ----
  {
    const store = fresh();
    const tool = toolFor(store);
    const heroQ = await store.mint({ title: 'Hero-only attest', contract: { type: 'attest', key: '' }, agentId: 'hero' }, 1);
    const stationQ = await store.mint({ title: 'Station-wide attest', contract: { type: 'attest', key: '' } }, 2);   // agentId null

    // an agent the quest is NOT open for is refused BEFORE the store — no pending attest is filed
    const denied = await tool.run({ op: 'attest_complete', id: heroQ.id, evidence: 'I definitely did hero\'s work, promise' }, ctxOf('intruder', 'runX'));
    A.ok(/not one of your open quests/.test(denied.content), 'attest by a NON-owning agent is refused (openForAgent scoping)');
    A.eq(store.get(heroQ.id).attest, null, 'no pending attest was set by the refused agent');
    A.eq(store.get(heroQ.id).status, 'open', 'the quest is untouched by the refused attest');

    // the OWNER may attest its own quest
    const owned = await tool.run({ op: 'attest_complete', id: heroQ.id, evidence: 'shipped the draft and linked it in COMMS today' }, ctxOf('hero', 'run1'));
    A.ok(/proposed/i.test(owned.content), 'the owning agent can still attest its own quest');
    A.eq(store.get(heroQ.id).attest.agentId, 'hero', 'the pending attest carries the owner');

    // a STATION-WIDE quest stays attestable by ANY agent (openForAgent includes agentId:null by the store's design)
    const sharedOk = await tool.run({ op: 'attest_complete', id: stationQ.id, evidence: 'completed the shared objective end to end' }, ctxOf('other', 'run2'));
    A.ok(/proposed/i.test(sharedOk.content), 'a station-wide quest is attestable by any agent (shared by design)');
    A.eq(store.get(stationQ.id).attest.agentId, 'other', 'the station-wide attest records the proposing agent');
  }

  // ---- op:progress — a successful tick on a RUN-contract quest BINDS the live run (the tool-seam binding),
  //      so the run-end settle sweep (completeByContract('run', runId) on 'done') can actually complete it ----
  {
    const store = fresh();
    const tool = toolFor(store);
    const runQ = await store.mint({ title: 'Wire the export', contract: { type: 'run', key: 'wq:5' },
      steps: [{ key: 's1', label: 'wire it' }], agentId: 'hero', kind: 'work' }, 1);
    const stationRunQ = await store.mint({ title: 'Shared build', contract: { type: 'run', key: 'wq:6' },
      steps: [{ key: 's1', label: 'build it' }] }, 2);   // station-wide: bindable ONLY via a real progress tick
    const attQ = await store.mint({ title: 'No binding here', contract: { type: 'attest', key: '' },
      steps: [{ key: 's1', label: 'do it' }], agentId: 'hero' }, 3);

    await tool.run({ op: 'progress', id: runQ.id, stepKey: 's1', note: 'wired' }, ctxOf('hero', 'run-77'));
    A.eq(store.get(runQ.id).runId, 'run-77', 'a progress tick on a run-contract quest binds the live run');
    await tool.run({ op: 'progress', id: stationRunQ.id, stepKey: 's1', note: 'built' }, ctxOf('hero', 'run-77'));
    A.eq(store.get(stationRunQ.id).runId, 'run-77', 'a station-wide run quest binds when an agent PROVABLY works it (progress tick)');
    await tool.run({ op: 'progress', id: attQ.id, stepKey: 's1', note: 'done-ish' }, ctxOf('hero', 'run-77'));
    A.eq(store.get(attQ.id).runId, null, 'a non-run contract never gains a run binding from progress');

    // the run ends 'done' → the EXISTING settle sweep completes both bound quests; a different runId completes nothing
    await store.completeByContract('run', 'run-unrelated', 9);
    A.eq(store.get(runQ.id).status, 'open', 'an unrelated run ending done does not complete the bound quest');
    await store.completeByContract('run', 'run-77', 10);
    A.eq(store.get(runQ.id).status, 'done', 'the bound run ending done completes the quest (the full seam, end to end)');
    A.eq(store.get(stationRunQ.id).status, 'done', 'the station-wide quest bound by real work completes too');
    A.eq(store.get(attQ.id).status, 'open', 'the attest quest is untouched by the run sweep');
  }

  // ---- op:mint — contract enforced, generated/agent-scoped, error passthrough VERBATIM ----
  {
    const store = fresh();
    const tool = toolFor(store, { id: 'goal:csv', milestoneId: 'm:flow' });

    // no contract → the store's exact error string
    const noC = await tool.run({ op: 'mint', title: 'do a thing' }, ctxOf('hero', 'run1'));
    A.ok(/needs a valid completion contract/.test(noC.content), 'mint with no contract surfaces the store error verbatim');

    // valid mint → generated + createdBy agent:<id> + agent-scoped
    const ok = await tool.run({ op: 'mint', title: 'Learn the CSV flow', contract: { type: 'attest', key: '' }, groundedIn: 'dossier: works with CSVs daily', domain: 'research' }, ctxOf('hero', 'run1'));
    A.ok(/Minted quest q:\d+/.test(ok.content), 'a valid mint returns the new quest id');
    const minted = store.list().find(q => q.title === 'Learn the CSV flow');
    A.eq(minted.kind, 'generated', 'minted quest is kind:generated');
    A.eq(minted.createdBy, 'agent:hero', 'minted quest createdBy is agent:<callingAgent>');
    A.eq(minted.agentId, 'hero', 'minted quest is scoped to the calling agent');
    A.eq(minted.groundedIn, 'dossier: works with CSVs daily', 'groundedIn is carried through');
    A.eq([minted.domain, minted.goalId, minted.milestoneId], ['research', 'goal:csv', 'm:flow'], 'minted quest binds its mastery domain and active life-goal step');

    // the ≤3-open-generated cap: 2 more ok, the 4th rejected with the store's verbatim message. NOTE: each mint is
    // on a DISTINCT runId so the per-run mint cap (below) doesn't mask the store's open-generated cap.
    await tool.run({ op: 'mint', title: 'Gen two', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'runB'));
    await tool.run({ op: 'mint', title: 'Gen three', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'runC'));
    const capped = await tool.run({ op: 'mint', title: 'Gen four', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'runD'));
    A.ok(/max open generated quests/.test(capped.content), 'the 4th open generated mint is rejected with the store cap message');
  }

  // ---- op:mint — the MECHANICAL per-run cap: at most ONE successful mint per run ----
  {
    const store = fresh();
    const tool = toolFor(store);

    // first mint on run7 succeeds
    const first = await tool.run({ op: 'mint', title: 'First quest', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'run7'));
    A.ok(/Minted quest q:\d+/.test(first.content), 'the first mint of a run succeeds');

    // a SECOND mint in the SAME run is rejected mechanically (not a store cap — a per-run cap in the tool)
    const second = await tool.run({ op: 'mint', title: 'Second quest', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'run7'));
    A.ok(/one quest per run/.test(second.content), 'a second mint in the same run is rejected with the per-run cap message');
    A.eq(store.list().filter(q => q.title === 'Second quest').length, 0, 'the second quest was NOT persisted (the store was never reached)');

    // a DIFFERENT run may mint again (the cap is per-run, not per-agent)
    const nextRun = await tool.run({ op: 'mint', title: 'Third quest', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'run8'));
    A.ok(/Minted quest q:\d+/.test(nextRun.content), 'a new run gets a fresh mint budget');

    // a REJECTED mint does not burn the run's budget: on a fresh run, a bad-contract mint fails, then a good one still lands
    const badFirst = await tool.run({ op: 'mint', title: 'No contract quest' }, ctxOf('hero', 'run9'));
    A.ok(/needs a valid completion contract/.test(badFirst.content), 'a bad mint is rejected (no contract)');
    const goodAfterBad = await tool.run({ op: 'mint', title: 'Good after bad', contract: { type: 'attest', key: '' } }, ctxOf('hero', 'run9'));
    A.ok(/Minted quest q:\d+/.test(goodAfterBad.content), 'a rejected mint did not consume the per-run budget — a valid mint still lands');

    // a run with NO runId can't be tracked → the mechanical cap simply does not apply (store cap still bounds).
    // Uses a fresh agent so hero's now-full ≤3-open-generated store cap doesn't mask what we're testing here.
    const noRunA = await tool.run({ op: 'mint', title: 'Runless one', contract: { type: 'attest', key: '' } }, ctxOf('scout', null));
    const noRunB = await tool.run({ op: 'mint', title: 'Runless two', contract: { type: 'attest', key: '' } }, ctxOf('scout', null));
    A.ok(/Minted quest q:\d+/.test(noRunA.content) && /Minted quest q:\d+/.test(noRunB.content), 'without a runId the per-run cap does not fire (mints bounded only by the store cap)');
  }

  // ---- unknown op ----
  {
    const tool = toolFor(fresh());
    A.ok(/Unknown op "frobnicate"/.test((await tool.run({ op: 'frobnicate' }, ctxOf('hero'))).content), 'an unknown op is reported honestly');
  }

  A.report('quests-tool.test');
})();
