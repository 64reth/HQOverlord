/* node test/autojobstore.test.js — the browser wiring around the self-initiation engine (frontend/app/autojobstore.js).
   autojobstore.js is glue (bus hook + reason-only model call + Dialogue approval loop + POST /api/cron via an
   injected dep); its DECISIONS live in the pure autojobs.js (tested separately). This fakes the globals it talks to
   with shapes that match the real APIs, and locks the wiring:
     - subscribes read-only to agent.run.end (never emits); the real emit→onRunEnd→propose path works
     - the proactive gate fires only once, after the First Pitch, with autonomy on + enough known, dialogue closed
     - it runs the directive as a REASON-ONLY call (isTask:false, placed:[], internal:true) on the live system prompt
     - it presents one approval node per proposal; 'schedule it' → scheduleJob(toCronBody); 'skip' → nothing
     - a model error / empty reply degrades gracefully and leaves the fire-once flag UNSET (retry later)
     - the proactive flag round-trips through localStorage; reset() re-arms a new hero; the manual path never needs it */
'use strict';
const A = require('./_assert.js');

global.AutoJobs = require('../frontend/app/autojobs.js');   // real pure engine (we want the integration)

const mem = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

const bus = A.makeBus();
global.U = { bus };

let knownDims = ['goals', 'pain'];
global.DossierStore = { summary: () => ({ known: knownDims, blank: [] }) };

let pitchDoneFlag = true;
global.PitchStore = { done: () => pitchDoneFlag };

let autonomyOn = true;
global.AutonomyStore = { summary: () => ({ enabled: autonomyOn }) };

const dlg = {
  opened: 0, said: [], noded: 0, closed: 0, _open: false, choices: [], lastNodes: [],
  open() { this._open = true; this.opened++; },
  say(s) { this.said.push(String(s)); return Promise.resolve(); },
  node(cfg) { this.noded++; this.lastNodes.push(cfg); return Promise.resolve(this.choices.length ? this.choices.shift() : { value: 'no', skip: true }); },
  close() { this._open = false; this.closed++; },
  isOpen() { return this._open; }
};
global.Dialogue = dlg;

const hn = { calls: [], next: { text: '' }, chat(args) { this.calls.push(args); return Promise.resolve(this.next); } };
const ledgerCalls = [];
hn.apiFetch = (url, opts) => { ledgerCalls.push(JSON.parse(opts.body)); return Promise.resolve({ ok: true }); };
global.Harness = hn;

let scheduled = [];
let boardHere = false;   // G4 feature 2: is a MISSION BOARD placed? toggled per-case below
const SYSTEM = 'SYSTEM PROMPT\nWHAT YOU KNOW ABOUT YOUR COMMANDER: goals — ship StarNet.';
const deps = {
  getSystem: () => SYSTEM,
  getName: () => 'NOVA',
  readiness: () => ({ ready: true, reasons: [] }),
  getBeliefs: () => ({ goals: ['ship StarNet'], pain: ['manual standups'] }),
  getExistingJobs: () => Promise.resolve(['Morning brief']),
  scheduleJob: (body) => { scheduled.push(body); return Promise.resolve({ ok: true }); },
  boardPlaced: () => boardHere
};

const { AutoJobStore } = require('../frontend/app/autojobstore.js');

const tick = ms => new Promise(r => setTimeout(r, ms));
function clearFakes() { hn.calls = []; dlg.opened = dlg.noded = dlg.closed = 0; dlg.said = []; dlg._open = false; dlg.choices = []; dlg.lastNodes = []; scheduled = []; }

const TWO = [
  'JOB: Standup draft', 'WHY: kills the standup pain', 'GROUNDS: manual standups', 'CADENCE: morning', 'RUN: Draft the standup from what you know.',
  '', 'JOB: Ship nudge', 'WHY: advances the goal', 'GROUNDS: ship StarNet', 'CADENCE: weekly', 'RUN: Draft the next ship step.'
].join('\n');

/* ---------- init subscribes read-only ---------- */
AutoJobStore.init(deps);
A.ok(bus._h['agent.run.end'] && bus._h['agent.run.end'].length === 1, 'init subscribes exactly one agent.run.end listener');

/* ---------- decide(): the proactive gate ---------- */
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: true, reason: 'ready' }, 'autonomy on + graduated + knows enough → propose');
A.eq(AutoJobStore._decide({ reason: 'error', agentId: 'agent' }), { go: false, reason: 'not-done' }, 'a failed run never proposes');
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'worker-2' }), { go: false, reason: 'not-hero' }, 'only the hero self-initiates');
autonomyOn = false;
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: false, reason: 'autonomy-off' }, 'never proposes while autonomy is off');
autonomyOn = true;
pitchDoneFlag = false;
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: false, reason: 'no-first-pitch' }, 'graduation first — never before the First Pitch');
pitchDoneFlag = true;
knownDims = ['pain'];
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: false, reason: 'missing:goals' }, 'cannot propose without knowing the goal');
knownDims = ['goals', 'pain'];
dlg._open = true;
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: false, reason: 'dialogue-open' }, 'never stomps an open Dialogue');
dlg._open = false;
global.Onboarding = { isRunning: () => true };
A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }).reason, 'onboarding', 'never fires during the awakening');
global.Onboarding = undefined;

(async () => {
  try {
    /* ---------- propose(): approve one, skip one → one job scheduled ---------- */
    clearFakes(); AutoJobStore.reset();
    hn.next = { text: TWO };
    dlg.choices = [{ value: 'yes' }, { value: 'no', skip: true }];
    const r = await AutoJobStore.propose({ proactive: true });

    A.eq(hn.calls.length, 1, 'propose makes exactly one model call');
    const call = hn.calls[0];
    A.eq(call.system, SYSTEM, 'the call uses the LIVE system prompt');
    A.eq(call.isTask, false, 'reason-only (isTask:false)');
    A.eq(call.placed, [], 'no capabilities (placed:[]) — it cannot touch tools');
    A.eq(call.internal, true, 'internal → harness suppresses run.start/end re-emit (the self-talk never counts)');
    A.ok(call.messages[0].content.indexOf('ship StarNet') >= 0, 'the directive grounds on the real beliefs');
    A.ok(call.messages[0].content.indexOf('Morning brief') >= 0, 'the directive lists existing jobs (dedup)');

    A.eq(dlg.noded, 2, 'one approval node per proposal');
    A.eq(scheduled.length, 1, 'only the approved proposal is scheduled');
    A.eq(scheduled[0].name, 'Standup draft', 'the scheduled job carries the proposal title');
    A.eq(scheduled[0].schedule, '0 9 * * *', 'the cadence mapped to a real schedule string');
    A.eq(scheduled[0].prompt, 'Draft the standup from what you know.', 'the RUN instruction is the job prompt');
    A.eq(r.scheduled, 1, 'propose reports how many were scheduled');
    A.eq(AutoJobStore._state().proposed, true, 'a delivered proactive offer sets the fire-once flag');
    A.ok(dlg.closed >= 1, 'the Dialogue closes after the flow');

    /* ---------- the proactive offer is fire-once ---------- */
    A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: false, reason: 'already-proposed' }, 'the proactive offer fires once, ever');

    /* ---------- manual propose() ignores the fire-once flag (explicit ask) ---------- */
    clearFakes();
    hn.next = { text: TWO };
    dlg.choices = [{ value: 'yes' }, { value: 'yes' }];
    const r2 = await AutoJobStore.propose();   // no { proactive } → manual
    A.eq(scheduled.length, 2, 'manual propose can schedule again even after the proactive offer was spent');
    A.eq(r2.scheduled, 2, 'both approved jobs scheduled');

    /* ---------- graceful: a model error schedules nothing and does NOT burn the flag ---------- */
    clearFakes(); AutoJobStore.reset();
    hn.next = { error: true, text: '' };
    await AutoJobStore.propose({ proactive: true });
    A.eq(scheduled.length, 0, 'a model error schedules nothing');
    A.eq(AutoJobStore._state().proposed, false, 'a model error does NOT burn the proactive offer (retry later)');
    A.ok(dlg.closed >= 1, 'the panel is cleaned up on a model error');

    /* ---------- graceful: an unparseable / ungrounded reply schedules nothing, flag stays unset ---------- */
    clearFakes(); AutoJobStore.reset();
    hn.next = { text: 'sorry, nothing comes to mind' };
    await AutoJobStore.propose({ proactive: true });
    A.eq(scheduled.length, 0, 'an unparseable reply schedules nothing');
    A.eq(AutoJobStore._state().proposed, false, 'an unparseable reply does not burn the offer');

    /* ---------- integration: a real agent.run.end emit drives onRunEnd → propose ---------- */
    clearFakes(); AutoJobStore.reset();
    hn.next = { text: TWO };
    dlg.choices = [{ value: 'no', skip: true }, { value: 'no', skip: true }];
    bus.emit('agent.run.end', { reason: 'done', agentId: 'agent' });
    await tick(10);
    A.eq(hn.calls.length, 1, 'emitting agent.run.end runs the proactive proposal (onRunEnd → propose)');
    A.eq(scheduled.length, 0, 'declining all schedules nothing');
    A.eq(AutoJobStore._state().proposed, true, 'declining all still spends the one-time proactive offer (delivered)');

    /* ---------- fire-once persists through localStorage (survives reload) ---------- */
    A.ok(mem['starnet.autojobs.v1'] && JSON.parse(mem['starnet.autojobs.v1']).proposed === true, 'the proactive flag persists to its own key');
    AutoJobStore.init(deps);   // simulate reload
    A.eq(AutoJobStore._decide({ reason: 'done', agentId: 'agent' }), { go: false, reason: 'already-proposed' }, 'the persisted flag blocks a re-offer after reload');

    /* ---------- reset re-arms for a brand-new hero ---------- */
    AutoJobStore.reset();
    A.eq(mem['starnet.autojobs.v1'], undefined, 'reset() removes the persisted key');
    AutoJobStore.init(deps);
    A.eq(AutoJobStore._state().proposed, false, 'after reset the new hero re-earns the proactive offer');
    // (the read-only "never emits on U.bus" discipline is enforced across all frontend files by the lint-emits gate)

    /* ========== G4 feature 2 — PIN-TO-BOARD: proposals get a body on the MISSION BOARD ========== */

    /* with a board placed, propose() PARKS the proposals as pending cards (no Dialogue approval loop) ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = true;
    hn.next = { text: TWO };
    const rp = await AutoJobStore.propose({ proactive: true });
    A.eq(dlg.noded, 0, 'board mode does NOT run the inline Dialogue approval loop');
    A.eq(scheduled.length, 0, 'board mode schedules nothing up front — the Commander decides at the board');
    A.eq(rp.pinned, 2, 'both parsed proposals are pinned to the board');
    A.eq(AutoJobStore.pendingCount(), 2, 'the pending ledger holds the two pinned proposals');
    A.eq(AutoJobStore._state().proposed, true, 'a board-delivered proactive offer still spends the fire-once flag');
    const list = AutoJobStore.pendingList();
    A.eq(list.length, 2, 'pendingList surfaces the cards');
    A.ok(list[0].id && list[0].title === 'Standup draft', 'a pending card carries an id + the proposal title');

    /* pending survives a reload (a real "waiting for you" state) ---- */
    AutoJobStore.init(deps);
    A.eq(AutoJobStore.pendingCount(), 2, 'pending proposals persist through localStorage across a reload');

    /* APPROVE routes the real cron POST (the same scheduleJob path) then clears the card ---- */
    const firstId = AutoJobStore.pendingList()[0].id;
    const firstRecId = AutoJobStore.pendingList()[0].recommendationId;
    const ar = await AutoJobStore.acceptPending(firstId);
    A.eq(ar.ok, true, 'acceptPending reports success when the POST succeeds');
    const adoption = ledgerCalls.find(c => c.id === firstRecId && c.outcome);
    A.eq(adoption && adoption.outcome.adopted, true, 'new approved routine records adoption separately');
    A.eq(adoption && adoption.outcome.quality, undefined, 'routine adoption does not invent satisfaction');
    A.eq(scheduled.length, 1, 'approve fires the real POST /api/cron (scheduleJob)');
    A.eq(scheduled[0].name, 'Standup draft', 'the scheduled job carries the approved proposal title');
    A.eq(AutoJobStore.pendingCount(), 1, 'an approved card leaves the ledger');

    /* DECLINE drops the card without scheduling ---- */
    const secondId = AutoJobStore.pendingList()[0].id;
    A.eq(AutoJobStore.declinePending(secondId), true, 'declinePending drops the card');
    A.eq(scheduled.length, 1, 'decline never schedules');
    A.eq(AutoJobStore.pendingCount(), 0, 'the ledger is empty after both cards are resolved');

    /* the walk-and-pin plays ONCE per proposal: a re-propose of the SAME job does not re-pin ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = true;
    hn.next = { text: TWO };
    await AutoJobStore.propose({ proactive: true });
    A.eq(AutoJobStore.pendingCount(), 2, 'first proposal run pins two');
    // parse with the SAME evidence pool the store uses, or the veto would return [] and this dedup check would
    // pass for the wrong reason (nothing to re-pin is not the same as a rejected duplicate).
    const again = AutoJobStore.pinProposals(AutoJobs.parseProposals(TWO, { beliefs: deps.getBeliefs() }));
    A.eq(again, 0, 're-pinning the same proposals adds nothing (dedup by title — once per proposal)');
    A.eq(AutoJobStore.pendingCount(), 2, 'the ledger did not grow on a duplicate re-propose');

    /* a failed cron POST leaves the card pinned (never a silent loss) ---- */
    const stickyId = AutoJobStore.pendingList()[0].id;
    const realSched = deps.scheduleJob;
    deps.scheduleJob = () => Promise.resolve({ ok: false });
    AutoJobStore.init(deps);
    const fr = await AutoJobStore.acceptPending(stickyId);
    A.eq(fr.ok, false, 'a failed POST reports failure');
    A.ok(AutoJobStore.pendingCount() === 2, 'a failed approve leaves the card pinned so the Commander can retry');
    deps.scheduleJob = realSched;

    /* no board → the Dialogue flow is untouched (the pin is a projection, never a gate) ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = false;
    hn.next = { text: TWO };
    dlg.choices = [{ value: 'yes' }, { value: 'no', skip: true }];
    const rn = await AutoJobStore.propose({ proactive: true });
    A.eq(dlg.noded, 2, 'no board → the inline Dialogue approval runs (the original flow)');
    A.eq(scheduled.length, 1, 'no board → the Dialogue approval schedules directly');
    A.eq(AutoJobStore.pendingCount(), 0, 'no board → nothing is parked on a (non-existent) board');
    A.eq(rn.scheduled, 1, 'no-board propose reports scheduled count as before');

    /* ========== POPUP-ESCAPE (Andrew): the Commander can bail the WHOLE multi-proposal ask ========== */
    /* each approval node is offered as dismissable, and a `dismissed` result stops asking the rest ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = false;
    hn.next = { text: TWO };
    dlg.choices = [{ value: '', skip: true, dismissed: true }, { value: 'yes' }];   // Esc / "leave it" on proposal #1
    const rd = await AutoJobStore.propose({ proactive: true });
    A.eq(dlg.noded, 1, 'a dismiss on the first proposal stops the loop — the 2nd is never asked');
    A.eq(scheduled.length, 0, 'dismissing the flow schedules nothing');
    A.ok(dlg.lastNodes[0] && dlg.lastNodes[0].dismissable === true, 'each proposal node is presented as dismissable (Esc/✕ can exit)');
    A.eq(rd.scheduled, 0, 'a dismissed flow reports zero scheduled');
    A.ok(dlg.closed >= 1, 'the Dialogue still closes cleanly after a dismiss (panel never left hanging)');
    A.eq(AutoJobStore._state().proposed, true, 'a dismissed proactive offer is still spent — it is not re-nagged this session');

    /* ========== W6 MINT DEDUP: the frontend never offers/mints a routine that already exists ========== */

    /* inline Dialogue flow: a proposal whose name already matches a LIVE routine is skipped (no doomed offer) ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = false;
    const realGet = deps.getExistingJobs;
    deps.getExistingJobs = () => Promise.resolve(['Standup draft']);   // 'Standup draft' already runs
    AutoJobStore.init(deps);
    hn.next = { text: TWO };
    dlg.choices = [{ value: 'yes' }];   // would approve the ONE remaining proposal
    const rdup = await AutoJobStore.propose({ proactive: true });
    A.eq(dlg.noded, 1, 'the already-live proposal is skipped — only the genuinely-new one is offered');
    A.eq(scheduled.length, 1, 'only the new routine is scheduled (the duplicate never reaches a POST)');
    A.eq(scheduled[0].name, 'Ship nudge', 'the scheduled one is the non-duplicate proposal');
    A.ok(rdup.scheduled === 1, 'propose reports one scheduled (the dup was silently skipped)');
    deps.getExistingJobs = realGet;

    /* board flow: acceptPending on a name that is already live retires the card WITHOUT a second POST ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = true;
    deps.getExistingJobs = () => Promise.resolve(['Standup draft']);
    AutoJobStore.init(deps);
    hn.next = { text: TWO };
    await AutoJobStore.propose({ proactive: true });
    A.eq(AutoJobStore.pendingCount(), 2, 'both proposals pinned (the board pins optimistically)');
    const dupCardId = AutoJobStore.pendingList().find(p => p.title === 'Standup draft').id;
    const dr = await AutoJobStore.acceptPending(dupCardId);
    A.eq(dr.ok, true, 'accepting a now-duplicate card resolves it (not a failure)');
    A.eq(dr.duplicate, true, 'the accept reports it was a duplicate');
    A.eq(scheduled.length, 0, 'accepting a duplicate card fires NO POST (the routine already exists)');
    A.ok(!AutoJobStore.pendingList().some(p => p.id === dupCardId), 'the duplicate card vanishes (COMMS: a decided card is removed)');
    deps.getExistingJobs = realGet; boardHere = false;

    /* server-reported duplicate (mint gate) also retires a pending card ---- */
    clearFakes(); AutoJobStore.reset(); boardHere = true;
    AutoJobStore.init(deps);
    hn.next = { text: TWO };
    await AutoJobStore.propose({ proactive: true });
    const anyId = AutoJobStore.pendingList()[0].id;
    const duplicateRecId = AutoJobStore.pendingList()[0].recommendationId;
    const realSched2 = deps.scheduleJob;
    deps.scheduleJob = () => Promise.resolve({ ok: true, duplicate: true });   // the server gate refused it
    AutoJobStore.init(deps);
    const sr = await AutoJobStore.acceptPending(anyId);
    A.eq(sr.duplicate, true, 'a server-reported duplicate is surfaced');
    A.ok(!ledgerCalls.some(c => c.id === duplicateRecId && c.outcome && c.outcome.adopted), 'duplicate routine retirement does not invent adoption');
    A.ok(!AutoJobStore.pendingList().some(p => p.id === anyId), 'a server-reported duplicate also retires the card (no ghost)');
    deps.scheduleJob = realSched2; boardHere = false;

    A.report('autojobstore.test');
  } catch (e) {
    A.ok(false, 'unexpected throw: ' + (e && e.stack || e));
    A.report('autojobstore.test');
  }
})();
