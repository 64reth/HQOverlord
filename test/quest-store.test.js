/* node test/quest-store.test.js — the station-wide, harness-owned QUEST LEDGER (QUEST V2 §A).

   Proves THE CONTRACT RULE (no valid contract → mint rejected), title-dedup vs open + dismissed, the per-agent
   open-generated cap, the attest→confirm(yes) completion and attest→confirm(no) declineNote-stays-open paths,
   dismiss = denylist-forever, the mechanical run sweep (completeByContract / stallRun), defensive hydration of a
   junk file, and the FIFO caps (never evict an OPEN quest). Runs against an in-memory fs so it needs no disk and
   stays deterministic (every timestamp is injected). */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const { makeQuestStore, normalize } = require('../sidecar/quest-store.js');

// ---- a tiny in-memory fs sufficient for durable-store (readFileSync/writeFileSync/rename/mkdirSync/...) ----
function memFs() {
  const files = new Map();
  return {
    _files: files,
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, data) { files.set(String(f), String(data)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); },
    mkdirSync() {},
    unlinkSync(f) { files.delete(String(f)); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => { fs.writeFileSync(file, data); };
function freshStore(fs) { return makeQuestStore({ fs: fs || memFs(), path, workspaces: '/ws', writeDurable }); }
const runContract = k => ({ type: 'run', key: k });
const attestContract = () => ({ type: 'attest', key: '' });

(async () => {
  // ---- 1. THE CONTRACT RULE: a quest CANNOT be minted without a valid completion contract ----
  {
    const s = freshStore();
    A.ok((await s.mint({ title: 'no contract' }, 1)).ok === false, 'mint with NO contract is rejected');
    A.ok((await s.mint({ title: 'bad type', contract: { type: 'nope', key: 'x' } }, 1)).ok === false, 'mint with an unknown contract type is rejected');
    A.ok((await s.mint({ title: 'no key', contract: { type: 'prop', key: '' } }, 1)).ok === false, 'a mechanical contract with an empty key is rejected');
    A.ok((await s.mint({ title: '', contract: runContract('r1') }, 1)).ok === false, 'mint with no title is rejected');
    // attest MAY carry an empty key
    const at = await s.mint({ title: 'attest ok', contract: attestContract() }, 1);
    A.ok(at.ok === true && /^q:\d+$/.test(at.id), 'an attest contract with key "" is accepted; id is q:<seq>');
    A.eq(s.list().length, 1, 'only the valid quest entered the ledger');
  }

  // ---- 2. mint success shape + defaults + steps ----
  {
    const s = freshStore();
    const r = await s.mint({ title: 'Learn the CSV flow', desc: 'd', reward: 'a cleaner', contract: { type: 'prop', key: 'csv' }, steps: [{ key: 'a', label: 'step a' }, { nope: 1 }], agentId: 'hero', kind: 'generated', groundedIn: 'dossier: works with CSVs daily', domain: 'research', goalId: 'goal:csv', milestoneId: 'm:learn' }, 100);
    A.ok(r.ok, 'mint returns ok');
    const q = s.get(r.id);
    A.eq(q.status, 'open', 'new quest is open');
    A.eq(q.kind, 'generated', 'kind persisted');
    A.eq(q.agentId, 'hero', 'agentId persisted');
    A.eq(q.createdBy, 'agent:hero', 'createdBy defaults to agent:<id> when agent-scoped');
    A.eq(q.contract, { type: 'prop', key: 'csv' }, 'contract persisted');
    A.eq(q.steps.length, 1, 'steps without a key are dropped');
    A.eq(q.steps[0], { key: 'a', label: 'step a', done: false }, 'a valid step is normalized');
    A.eq(q.groundedIn, 'dossier: works with CSVs daily', 'groundedIn stored');
    A.eq([q.domain, q.goalId, q.milestoneId], ['research', 'goal:csv', 'm:learn'], 'mastery domain and goal bindings persist with the quest');
    A.eq(q.createdAt, 100, 'createdAt is the injected now');
  }

  // ---- 3. TITLE-DEDUP vs OPEN quests (normalized) ----
  {
    const s = freshStore();
    await s.mint({ title: 'Build a JSON validator', contract: runContract('r1') }, 1);
    const dup = await s.mint({ title: '  build   a JSON   validator ', contract: runContract('r2') }, 2);
    A.ok(dup.ok === false && /already open/.test(dup.error), 'a same-normalized-title mint is rejected while the first is open');
    A.ok(/^q:\d+$/.test(dup.id), 'the rejection returns the existing open quest id');
    A.eq(s.list().filter(q => q.status === 'open').length, 1, 'the duplicate never entered the ledger');
    // a genuinely different title still mints
    A.ok((await s.mint({ title: 'Build a YAML validator', contract: runContract('r3') }, 3)).ok, 'a distinct title still mints');
  }

  // ---- 4. per-agent OPEN GENERATED cap = 3 (the 4th is rejected) ----
  {
    const s = freshStore();
    for (let i = 1; i <= 3; i++) A.ok((await s.mint({ title: 'gen ' + i, contract: attestContract(), agentId: 'hero', kind: 'generated' }, i)).ok, 'generated ' + i + ' mints');
    const fourth = await s.mint({ title: 'gen 4', contract: attestContract(), agentId: 'hero', kind: 'generated' }, 4);
    A.ok(fourth.ok === false && /max open generated/.test(fourth.error), 'the 4th open generated quest for an agent is rejected');
    // a DIFFERENT agent has its own budget
    A.ok((await s.mint({ title: 'gen other', contract: attestContract(), agentId: 'other', kind: 'generated' }, 5)).ok, 'the cap is per-agent');
    // a non-generated kind is not capped
    A.ok((await s.mint({ title: 'user q', contract: attestContract(), agentId: 'hero', kind: 'user' }, 6)).ok, 'the cap applies only to kind:generated');
  }

  // ---- 5. tickStep flips a named step, idempotent, and NEVER completes a mechanical quest ----
  {
    const s = freshStore();
    const r = await s.mint({ title: 'stepped', contract: runContract('r1'), steps: [{ key: 's1', label: 'one' }, { key: 's2', label: 'two' }] }, 1);
    A.ok((await s.tickStep(r.id, 's1', 'did one', 10)) === true, 'ticking an open step flips it');
    A.ok((await s.tickStep(r.id, 's1', 'again', 11)) === false, 'ticking an already-done step is an idempotent no-op');
    A.ok((await s.tickStep(r.id, 'nope', '', 12)) === false, 'ticking an unknown step is a no-op');
    // tick the LAST step — steps are progress display; the quest must NOT auto-complete (contract is run, unmet)
    A.ok((await s.tickStep(r.id, 's2', '', 13)) === true, 'ticking the last step flips it');
    A.eq(s.get(r.id).status, 'open', 'all steps done does NOT complete a run-contract quest (completion is contract-owned)');
    A.eq(s.get(r.id).steps[0].note, 'did one', 'the step note is stored');
  }

  // ---- 6. completeByContract('run', runId) — mechanical sweep completes bound run quests ----
  {
    const s = freshStore();
    // (a) match by contract.key directly
    const byKey = await s.mint({ title: 'run by key', contract: runContract('run-77') }, 1);
    // (b) match by a bound runId (contract keyed to a logical binding, run bound later)
    const byBind = await s.mint({ title: 'run by bind', contract: runContract('wq:9') }, 2);
    await s.bindRun(byBind.id, 'run-77', 'builder');
    // an attest quest with the same "key" must NOT be swept by a run completion
    const at = await s.mint({ title: 'attest not swept', contract: attestContract() }, 3);
    const done = await s.completeByContract('run', 'run-77', 500);
    A.ok(done.indexOf(byKey.id) >= 0 && done.indexOf(byBind.id) >= 0, 'both the key-matched and bind-matched run quests complete');
    A.eq(s.get(byKey.id).status, 'done', 'key-matched quest is done');
    A.eq(s.get(byKey.id).completedAt, 500, 'completedAt is the injected now');
    A.eq(s.get(byBind.id).status, 'done', 'bind-matched quest is done');
    A.eq(s.get(byBind.id).completedBy, 'builder', 'the agent who actually bound the successful run owns the verified mastery outcome');
    A.eq(s.get(at.id).status, 'open', 'attest quests are never completed by a mechanical run sweep');
    A.eq((await s.completeByContract('run', 'run-77', 600)).length, 0, 'a second sweep completes nothing (all already done)');
    A.eq((await s.completeByContract('attest', '', 600)).length, 0, 'completeByContract never fires for attest contracts');
  }

  // ---- 7. stallRun — a non-done run end stamps a stall + releases the binding (mirrors workquests) ----
  {
    const s = freshStore();
    const r = await s.mint({ title: 'stalls', contract: runContract('wq:1') }, 1);
    await s.bindRun(r.id, 'run-x');
    const stalled = await s.stallRun('run-x', 'budget', 700);
    A.ok(stalled.indexOf(r.id) >= 0, 'the bound quest stalls on a non-done run end');
    const q = s.get(r.id);
    A.eq(q.status, 'open', 'a stalled quest stays OPEN (not falsely completed)');
    A.eq(q.stalledAt, 700, 'stalledAt stamped');
    A.eq(q.stalledReason, 'budget', 'stalledReason stamped');
    A.eq(q.runId, null, 'the binding is released so a reused runId cannot later complete it');
    // re-bind un-stalls; a fresh run then completes it
    await s.bindRun(r.id, 'run-y');
    A.eq(s.get(r.id).stalledAt, null, 'a fresh binding clears the stall');
    await s.completeByContract('run', 'run-y', 800);
    A.eq(s.get(r.id).status, 'done', 'a re-launched, completing run finishes the quest');
  }

  // ---- 8. attest → confirm(YES) completes ----
  {
    const s = freshStore();
    const r = await s.mint({ title: 'attested', contract: attestContract() }, 1);
    // a mechanical quest rejects attest
    const mech = await s.mint({ title: 'mechanical', contract: runContract('r1') }, 2);
    A.ok((await s.attest(mech.id, { agentId: 'hero', evidence: 'I really did the thing here' }, 3)).ok === false, 'a mechanical-contract quest rejects an attest');
    // evidence too short → rejected
    A.ok((await s.attest(r.id, { agentId: 'hero', evidence: 'short' }, 4)).ok === false, 'attest with too-short evidence is rejected');
    const a1 = await s.attest(r.id, { agentId: 'hero', runId: 'run-1', evidence: 'Shipped the report and linked it in COMMS.' }, 5);
    A.ok(a1.ok, 'a valid attest sets a pending attest');
    A.eq(s.get(r.id).status, 'open', 'attesting does NOT complete the quest (Commander confirm required)');
    A.eq(s.get(r.id).attest.confirmed, null, 'the attest is pending');
    // a second attest while one is pending is rejected
    A.ok((await s.attest(r.id, { agentId: 'hero', evidence: 'trying again with new evidence' }, 6)).ok === false, 'a second attest while one is pending is rejected');
    // Commander confirms YES → done
    A.ok((await s.confirmAttest(r.id, true, '', 7)) === true, 'confirmAttest(yes) resolves the pending attest');
    A.eq(s.get(r.id).status, 'done', 'confirm(yes) completes the quest');
    A.eq(s.get(r.id).completedAt, 7, 'completedAt stamped on confirm');
    A.eq(s.get(r.id).attest.confirmed, true, 'the attest is kept, marked confirmed (audit)');
    A.eq(s.get(r.id).completedBy, 'hero', 'a Commander-confirmed attest attributes mastery to the attesting agent');
  }

  // ---- 9. attest → confirm(NO) stamps declineNote and stays open ----
  {
    const s = freshStore();
    const r = await s.mint({ title: 'declined attest', contract: attestContract() }, 1);
    await s.attest(r.id, { agentId: 'hero', evidence: 'I think this is done, honestly.' }, 2);
    A.ok((await s.confirmAttest(r.id, false, 'not quite — the export is still broken', 3)) === true, 'confirmAttest(no) resolves the pending attest');
    const q = s.get(r.id);
    A.eq(q.status, 'open', 'confirm(no) leaves the quest OPEN');
    A.eq(q.attest, null, 'the declined attest is cleared');
    A.eq(q.declineNote, { at: 3, note: 'not quite — the export is still broken' }, 'declineNote is stamped for the agent to see next run');
    // the agent can attest again after a decline
    A.ok((await s.attest(r.id, { agentId: 'hero', evidence: 'fixed the export and re-ran it clean' }, 4)).ok, 'the agent can re-attest after a decline');
    // confirming a quest with no pending attest is a no-op
    const r2 = await s.mint({ title: 'no attest yet', contract: attestContract() }, 5);
    A.ok((await s.confirmAttest(r2.id, true, '', 6)) === false, 'confirm with no pending attest is a no-op');
  }

  // ---- 10. DISMISS = deny re-mint by title (anti-nag, forever) ----
  {
    const s = freshStore();
    const r = await s.mint({ title: 'Automate the invoice run', contract: attestContract() }, 1);
    A.ok((await s.dismiss(r.id, 2)) === true, 'dismiss takes on an open quest');
    A.eq(s.get(r.id).status, 'dismissed', 'the quest is dismissed');
    // re-mint of the same normalized title is refused
    const re = await s.mint({ title: '  automate the INVOICE run ', contract: runContract('r9') }, 3);
    A.ok(re.ok === false && /dismissed before/.test(re.error), 'a dismissed title can never be re-minted (denylist forever)');
    // dismiss is idempotent
    A.ok((await s.dismiss(r.id, 4)) === false, 'a second dismiss is a no-op');
  }

  // ---- 11. openForAgent — own quests + station-wide (null agentId), open only ----
  {
    const s = freshStore();
    const mine = await s.mint({ title: 'mine', contract: attestContract(), agentId: 'hero' }, 1);
    const station = await s.mint({ title: 'station wide', contract: attestContract() }, 2);  // agentId null
    const theirs = await s.mint({ title: 'theirs', contract: attestContract(), agentId: 'other' }, 3);
    await s.dismiss(theirs.id, 4);
    const open = s.openForAgent('hero').map(q => q.id).sort();
    A.eq(open, [mine.id, station.id].sort(), 'openForAgent returns own + station-wide open quests, not another agent\'s');
  }

  // ---- 12. persistence round-trips a fresh store instance (restart-safe) ----
  {
    const fs = memFs();
    const s1 = makeQuestStore({ fs, path, workspaces: '/ws', writeDurable });
    const r = await s1.mint({ title: 'persist me', contract: runContract('r1') }, 1);
    await s1.dismiss((await s1.mint({ title: 'dismiss me', contract: attestContract() }, 2)).id, 3);
    const s2 = makeQuestStore({ fs, path, workspaces: '/ws', writeDurable });   // fresh instance, same disk
    A.ok(s2.get(r.id) && s2.get(r.id).status === 'open', 'a minted quest SURVIVES a fresh store (durable)');
    A.ok((await s2.mint({ title: 'dismiss me', contract: attestContract() }, 4)).ok === false, 'the dismissed-title denylist survives a restart');
  }

  // ---- 13. hydration of a JUNK / partial / legacy file loads to a safe shape ----
  {
    A.eq(normalize(null), { v: 1, seq: 0, quests: [], deniedTitles: [] }, 'null → empty safe record');
    A.eq(normalize('garbage'), { v: 1, seq: 0, quests: [], deniedTitles: [] }, 'a non-object → empty safe record');
    const junk = normalize({
      seq: 7,
      quests: [
        'not an object',
        { id: 'q:1' },                                             // no contract → dropped (contract rule)
        { id: 'q:2', contract: { type: 'bad', key: 'x' } },        // invalid contract → dropped
        { contract: runContract('r1') },                          // no id → dropped
        { id: 'q:3', title: 'ok', contract: runContract('r1'), status: 'weird', steps: [{ key: 'a' }, { nokey: 1 }] }
      ],
      deniedTitles: ['keep', 1, null, 'me']
    });
    A.eq(junk.quests.length, 1, 'only the well-formed, contract-bearing quest survives hydration');
    A.eq(junk.quests[0].status, 'open', 'an unknown status falls back to open');
    A.eq(junk.quests[0].steps.length, 1, 'keyless steps are dropped on hydrate');
    A.eq(junk.deniedTitles, ['keep', '1', 'me'], 'deniedTitles coerce to non-empty strings');
    A.eq(junk.seq, 7, 'seq is carried');
  }

  // ---- 14. FIFO caps: total-quests cap NEVER evicts an open quest ----
  {
    // Fabricate a ledger already at the 300 cap: 299 DONE + 1 OPEN, then mint one more. The oldest DONE is
    // evicted (FIFO terminal), the open one is untouched, and the new open quest lands.
    const quests = [];
    for (let i = 1; i <= 299; i++) quests.push({ id: 'q:' + i, title: 'done ' + i, contract: runContract('r' + i), status: 'done', completedAt: i, createdAt: i });
    quests.push({ id: 'q:300', title: 'the open one', contract: runContract('rOpen'), status: 'open', createdAt: 300 });
    const fs = memFs();
    fs.writeFileSync(path.join('/ws', '_station.quests.json'), JSON.stringify({ v: 1, seq: 300, quests, deniedTitles: [] }));
    const s = makeQuestStore({ fs, path, workspaces: '/ws', writeDurable });
    A.eq(s.list().length, 300, 'ledger loads at the cap');
    const r = await s.mint({ title: 'the new one', contract: runContract('rNew') }, 301);
    A.ok(r.ok, 'a new quest still mints at the cap');
    A.eq(s.list().length, 300, 'the ledger stays at the cap (one evicted)');
    A.ok(s.get('q:1') === null, 'the OLDEST done quest was evicted (FIFO terminal)');
    A.ok(s.get('q:300') && s.get('q:300').status === 'open', 'the OPEN quest was NOT evicted');
    A.ok(s.get(r.id) && s.get(r.id).status === 'open', 'the new quest landed');
  }

  // ---- 14b. all-open ledger at the cap: the cap YIELDS rather than dropping an open quest ----
  {
    const quests = [];
    for (let i = 1; i <= 300; i++) quests.push({ id: 'q:' + i, title: 'open ' + i, contract: runContract('r' + i), status: 'open', createdAt: i });
    const fs = memFs();
    fs.writeFileSync(path.join('/ws', '_station.quests.json'), JSON.stringify({ v: 1, seq: 300, quests, deniedTitles: [] }));
    const s = makeQuestStore({ fs, path, workspaces: '/ws', writeDurable });
    const r = await s.mint({ title: 'one more open', contract: runContract('rNew') }, 301);
    A.ok(r.ok, 'a new open quest still mints when the ledger is all-open at the cap');
    A.eq(s.list().length, 301, 'the ledger exceeds the cap rather than silently dropping an OPEN quest');
    A.ok(s.get('q:1') && s.get('q:1').status === 'open', 'no open quest was evicted');
  }

  // Life quests: pauses free recommendation slots without erasing history; only owner reports settle attest.
  {
    const fs = memFs(), s = freshStore(fs);
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await s.mint({ title: 'Practice ' + i, kind: 'generated', contract: attestContract() }, 100)).id);
    A.ok((await s.setDisposition(ids[0], { disposition: 'blocked', reason: 'Waiting for class signup' }, 200)).ok, 'blocked reason saves');
    A.eq(s.get(ids[0]).status, 'open', 'paused quest remains open');
    A.eq(s.openForAgent(null, 300).length, 2, 'paused quest is excluded from actionable agent slate');
    A.ok((await s.mint({ title: 'Smaller next action', kind: 'generated', contract: attestContract() }, 300)).ok, 'pausing frees generated capacity');
    A.ok(!(await s.mint({ title: 'Practice 0', contract: attestContract() }, 300)).ok, 'paused title remains deduplicated');
    const restarted = freshStore(fs);
    A.eq(restarted.get(ids[0]).disposition.reason, 'Waiting for class signup', 'feedback survives a new store instance');
    A.ok((await restarted.setDisposition(ids[0], { disposition: 'resume' }, 400)).ok, 'resume succeeds');
    A.eq(restarted.get(ids[0]).disposition, null, 'resume removes active pause');
    A.eq(restarted.get(ids[0]).dispositionHistory.length, 1, 'resume retains feedback history');
    A.ok(!(await restarted.setDisposition(ids[1], { disposition: 'later', snoozeUntil: 300 }, 400)).ok, 'past snooze rejected');
    await restarted.setDisposition(ids[1], { disposition: 'later', snoozeUntil: 600 }, 400);
    A.ok(!restarted.openForAgent(null, 599).some(q => q.id === ids[1]), 'snooze hides until due');
    A.ok(restarted.openForAgent(null, 600).some(q => q.id === ids[1]), 'snooze becomes actionable exactly when due');
    A.ok(!(await restarted.reportCompletion(ids[0], 'done', 700)).ok, 'empty accomplishment report rejected');
    A.ok((await restarted.reportCompletion(ids[0], 'I attended my first class today', 700)).ok, 'Commander report completes real-world action');
    const done = freshStore(fs).get(ids[0]);
    A.eq(done.attest.source, 'commander', 'direct user report retains provenance after restart');
    A.eq(done.attest.confirmed, true, 'report is explicitly Commander confirmed');
    A.eq(done.completedBy, null, 'life action is not attributed to an agent');
    const mech = await restarted.mint({ title: 'Machine work', contract: runContract('r-life') }, 800);
    A.ok(!(await restarted.reportCompletion(mech.id, 'I say this finished successfully', 900)).ok, 'reports cannot bypass mechanical contracts');
    A.ok(!(await restarted.reportCompletion(ids[0], 'Another report of this action', 900)).ok, 'report is not duplicated on a done quest');
  }
  {
    const s = freshStore();
    for (let i = 0; i < 3; i++) A.ok((await s.mint({ title: 'Old focus ' + i, kind: 'generated', goalId: 'goal:old', contract: attestContract() }, 100)).ok, 'old focus fills its own generated scope');
    A.ok(!(await s.mint({ title: 'Old focus fourth', kind: 'generated', goalId: 'goal:old', contract: attestContract() }, 100)).ok, 'same goal still caps at three');
    A.ok((await s.mint({ title: 'New focus first', kind: 'generated', goalId: 'goal:new', contract: attestContract() }, 100)).ok, 'new goal has independent generated capacity');
    A.ok((await s.mint({ title: 'Legacy unbound', kind: 'generated', contract: attestContract() }, 100)).ok, 'legacy unbound scope remains separate');
    A.ok((await s.mint({ title: 'Agent-specific old focus', kind: 'generated', agentId: 'hero', goalId: 'goal:old', contract: attestContract() }, 100)).ok, 'agent scope remains independent within a goal');
  }
  A.report('quest-store.test');
})();
