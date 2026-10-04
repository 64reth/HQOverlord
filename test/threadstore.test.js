/* node test/threadstore.test.js — the live wiring around the NS-6 THREAD turn-in
   (frontend/app/threadstore.js), the frontend hop that makes the thread ledger real. Locks:
     - fingerprint parity with sidecar/threadmine.fingerprint (client resolve/ignore recognises the same idea)
     - fetchProposals returns { runId (the STASH BATCH id), proposals } and fails open
     - session cap (≤1 card shown per session), nextLive drops resolved + stop-forever-ignored candidates
     - keep → POST verdict 'keep'; edits → verdict 'edit' carrying title+spec; discard → verdict 'discard';
       EVERY verdict marks the candidate resolved client-side (a stale batch can never re-offer it) and the
       server's honest { ok, reason } passes through untouched (the card only claims what the ledger verified)
     - ignore is a 2-strike tally (once = second chance, twice = stop-forever), never resolved server-side
     - persistence round-trip (own key), corrupt-key hydrate, new-hero reset
     - beat-slot arbiter: canThread/threadShown/threadDone are the FIFTH participant — a thread card may only
       take a WHOLLY FREE slot (memory > study > arc > trust > thread) and never stacks on any other beat */
'use strict';
const A = require('./_assert.js');

const mem = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
const KEY = 'starnet.threadturnin.v1';

// a controllable Harness: records every turn-in POST, serves a scripted proposals batch.
let turninCalls = [];
let turninReply = { ok: true, reason: 'added' };
let proposalsReply = { runId: 'batch1', proposals: [] };
let proposalsThrow = false;
global.Harness = {
  threadProposals: async () => { if (proposalsThrow) throw new Error('net down'); return proposalsReply; },
  threadTurnin: async (o) => { turninCalls.push(o); return turninReply; }
};

const { ThreadStore } = require('../frontend/app/threadstore.js');
const Study = require('../frontend/app/study.js');
const threadmine = require('../sidecar/threadmine.js');

const prop = (id, title, spec) => ({ id, title, spec: spec || 'a verbatim quote here', fingerprint: ThreadStore.fingerprint(title), sourceRef: { runId: 'r1' } });

(async () => {

/* ---------- 1. fingerprint parity with the sidecar mine ---------- */
ThreadStore.init({ now: () => 424242 });
for (const t of ['GPU price watcher', 'Watch GPU prices!!', 'the CRM idea']) {
  A.eq(ThreadStore.fingerprint(t), threadmine.fingerprint(t), 'client fingerprint matches threadmine.fingerprint for "' + t + '"');
}

/* ---------- 2. session cap + nextLive gating ---------- */
A.ok(ThreadStore.canShow(), 'a fresh session has the one card budget open');
A.eq(ThreadStore.SESSION_CAP, 1, 'the session cap is 1 (anti-nag)');
const p1 = prop('p1', 'GPU price watcher');
const p2 = prop('p2', 'Rebuild the docs site');
A.eq(ThreadStore.nextLive([null, {}, p1, p2]).id, 'p1', 'nextLive skips malformed entries and returns the first live candidate');
ThreadStore.markShown();
A.ok(!ThreadStore.canShow(), 'markShown spends the session budget');

/* ---------- 3. keep → verdict keep, resolved, honest passthrough ---------- */
turninReply = { ok: true, reason: 'added' };
let r = await ThreadStore.keep(p1, 'batch1', 'agent', null);
A.eq(r, { ok: true, reason: 'added' }, 'keep passes the server verdict through untouched');
A.eq(turninCalls[0], { agentId: 'agent', runId: 'batch1', id: 'p1', verdict: 'keep' }, 'keep POSTs verdict:keep with the BATCH runId (no title/spec on a plain keep)');
A.ok(ThreadStore.isExhausted('GPU price watcher'), 'a kept idea is resolved — never re-offered from a stale batch');
A.eq(ThreadStore.nextLive([p1, p2]).id, 'p2', 'nextLive drops the resolved candidate');

/* ---------- 4. edit → verdict edit carrying title + spec ---------- */
turninCalls = [];
r = await ThreadStore.keep(p2, 'batch1', 'agent', { title: 'Docs site v2', spec: 'rebuild it on the new stack' });
A.eq(turninCalls[0], { agentId: 'agent', runId: 'batch1', id: 'p2', verdict: 'edit', title: 'Docs site v2', spec: 'rebuild it on the new stack' }, 'an edited keep POSTs verdict:edit with the tweaked title+spec');
A.ok(ThreadStore.isExhausted('Rebuild the docs site'), 'an edited idea resolves under its ORIGINAL title fingerprint');

/* ---------- 5. the server refusing is passed through honestly (denylist / duplicate) ---------- */
const p3 = prop('p3', 'Invented spaceship');
turninReply = { ok: true, reason: 'declined' };
r = await ThreadStore.keep(p3, 'batch1', 'agent', null);
A.eq(r.reason, 'declined', 'a fingerprint-denylisted keep reports reason:declined (the card must not flash "kept")');
turninReply = { ok: false };
const p4 = prop('p4', 'Netsplit dashboard');
r = await ThreadStore.keep(p4, 'batch1', 'agent', null);
A.eq(r.ok, false, 'a failed POST reports ok:false');

/* ---------- 6. discard → verdict discard + resolved ---------- */
turninCalls = []; turninReply = { ok: true, reason: 'declined' };
const p5 = prop('p5', 'Price alert emails');
r = await ThreadStore.discard(p5, 'batch1', 'agent');
A.eq(turninCalls[0], { agentId: 'agent', runId: 'batch1', id: 'p5', verdict: 'discard' }, 'discard POSTs verdict:discard');
A.ok(r.ok === true, 'discard passes the server result through');
A.ok(ThreadStore.isExhausted('Price alert emails'), 'a discarded idea is resolved client-side too');

/* ---------- 7. ignore: two strikes then stop-forever; never a server call ---------- */
turninCalls = [];
const p6 = prop('p6', 'Weekly digest bot');
ThreadStore.ignore(p6);
A.ok(!ThreadStore.isExhausted('Weekly digest bot'), 'one ignore leaves the idea offerable (the second chance)');
ThreadStore.ignore(p6);
A.ok(ThreadStore.isExhausted('Weekly digest bot'), 'two ignores stop the idea for good');
A.eq(turninCalls.length, 0, 'ignore never calls the server (an ignored idea may legitimately re-mine)');

/* ---------- 8. fetchProposals: batch runId + fail-open ---------- */
proposalsReply = { runId: 'batchX', proposals: [p1] };
let batch = await ThreadStore.fetchProposals('runZ', 'agent');
A.eq(batch.runId, 'batchX', 'fetchProposals surfaces the STASH BATCH runId (the id the turn-in must reference)');
A.eq(batch.proposals.length, 1, '…with the proposals');
proposalsThrow = true;
batch = await ThreadStore.fetchProposals('runZ', 'agent');
A.eq(batch, { runId: null, proposals: [] }, 'a network failure fails open to an empty batch');
proposalsThrow = false;

/* ---------- 9. persistence round-trip + corrupt hydrate + reset ---------- */
A.ok(!!mem[KEY], 'the store persists to its OWN key');
ThreadStore.init({ now: () => 1 });   // re-hydrate from the persisted key (a fresh app run)
A.ok(ThreadStore.isExhausted('GPU price watcher'), 'resolved fingerprints survive a reload');
A.ok(ThreadStore.isExhausted('Weekly digest bot'), 'ignore tallies survive a reload');
A.ok(ThreadStore.canShow(), 'the session shown-counter is in-memory — a reload reopens the budget');
mem[KEY] = '{not json';
A.notThrows(() => ThreadStore.init({}), 'a corrupt key hydrates clean, never throws');
A.ok(!ThreadStore.isExhausted('GPU price watcher'), '…to a fresh state');
ThreadStore.ignore(p6); ThreadStore.ignore(p6);
ThreadStore.reset();
A.ok(!ThreadStore.isExhausted('Weekly digest bot'), 'new-hero reset clears the gate state');
A.eq(mem[KEY], undefined, '…and removes the key');

/* ---------- 10. the beat-slot arbiter: thread is the FIFTH, lowest-priority participant ---------- */
const slot = Study.makeBeatSlot();
A.eq(slot.canThread(), 'free', 'an idle slot is free for a thread card');
slot.memoryProposed('r1');
A.eq(slot.canThread(), 'memory', 'reflection in flight → memory wins the moment, thread stands down');
slot.memoryDeck(); slot.memoryDone('r1', false);
A.eq(slot.canThread(), 'free', 'the slot frees after the memory deck resolves');
slot.studyShown();
A.eq(slot.canThread(), 'busy', 'a visible STUDY card blocks the thread card (study first — they take turns)');
slot.studyDone(false);
slot.threadShown();
A.eq(slot.visibleBeat(), 'thread', 'threadShown claims the visible beat');
A.eq([slot.canStudy(), slot.canArc(), slot.canTrust()], ['busy', 'busy', 'busy'], 'a visible thread card reads as busy to every other lane — never two beats at once');
slot.threadDone(false);
A.eq(slot.visibleBeat(), null, 'threadDone releases the slot');
slot.threadShown(); slot.threadDone(true);
A.eq(slot.visibleBeat(), 'memory', 'threadDone(more) hands the slot straight to a queued memory deck');

A.report('threadstore.test');
})().catch(e => { console.log('FAIL: threadstore.test threw - ' + (e && e.stack || e)); process.exit(1); });
