/* node test/questledgerstore.test.js — the pure shaping surface of the QUEST V2 ledger's frontend citizen
   (frontend/app/questledgerstore.js). The live poll/fetch/beat wiring is browser-only; here we lock the two
   pure pieces the projection depends on: _shape (backend record → the shared quest shape) and _apply (the
   cache-rebuild that feeds quests()/pendingAttests()). No fetch/Chat/DOM is touched at module load or by these. */
'use strict';
const A = require('./_assert.js');
const { QuestLedgerStore: QLS } = require('../frontend/app/questledgerstore.js');

/* ---------- _shape: a backend record → the shared quest shape ---------- */
const s = QLS._shape({ id: 'q:5', kind: 'generated', title: 'Automate the digest', desc: 'the agent proposed this', reward: 'a standing digest', status: 'open', contract: { type: 'prop', key: 'dish' }, steps: [{ key: 'a', label: 'A', done: false }], attest: null, declineNote: null, groundedIn: 'goals dim' });
A.eq(s.id, 'q:5', 'shape keeps the ledger id (already q:N)');
A.eq(s.kind, 'ledger', 'shape stamps kind:ledger so handlers/dismiss route unambiguously');
A.eq(s.ledgerKind, 'generated', 'the backend kind rides along as ledgerKind (for the row copy)');
A.eq(s.contract, { type: 'prop', key: 'dish' }, 'the completion contract is carried through');
A.eq(s.status, 'open', 'open status preserved');
A.eq(s.groundedIn, 'goals dim', 'the grounding cite survives');
A.eq(s.steps.length, 1, 'steps carry through');

/* ---------- _shape: a pending attest is present only while confirmed:null ---------- */
const pend = QLS._shape({ id: 'q:6', kind: 'user', title: 'Ship the report', status: 'open', contract: { type: 'attest', key: '' }, attest: { agentId: 'agent', runId: 'r1', evidence: 'built and tested the report', at: 5, confirmed: null } });
A.ok(pend.attest && pend.attest.evidence === 'built and tested the report', 'a pending attest (confirmed:null) is surfaced with its evidence');
const settled = QLS._shape({ id: 'q:7', kind: 'user', title: 'X', status: 'done', contract: { type: 'attest', key: '' }, attest: { agentId: 'agent', evidence: 'e', at: 5, confirmed: true } });
A.eq(settled.attest, null, 'a confirmed attest is history, never a pending ask on the row');

/* ---------- _shape: fail-soft on junk ---------- */
const junk = QLS._shape({ id: 'q:8' });
A.eq(junk.contract, { type: 'attest', key: '' }, 'a record with no contract degrades to a safe attest shape, never throws');
A.eq(junk.status, 'open', 'a record with no status defaults open');

/* ---------- _apply + quests()/pendingAttests(): dismissed filtered, open+done kept ---------- */
QLS._apply([
  { id: 'q:1', status: 'open', kind: 'user', title: 'a', contract: { type: 'attest', key: '' }, attest: { agentId: 'agent', evidence: 'did the real thing', at: 1, confirmed: null } },
  { id: 'q:2', status: 'dismissed', kind: 'user', title: 'b', contract: { type: 'attest', key: '' } },
  { id: 'q:3', status: 'done', kind: 'work', title: 'c', contract: { type: 'run', key: 'run-9' } }
]);
const qs = QLS.quests();
A.eq(qs.length, 2, 'dismissed records are filtered out; open + done are kept');
A.ok(qs.every(x => x.kind === 'ledger'), 'every cached quest is shaped to kind:ledger');
A.ok(qs.some(x => x.id === 'q:3' && x.status === 'done'), 'a done ledger quest stays (so the QuestState fold sees its open→done edge and celebrates)');
A.eq(QLS.pendingAttests().length, 1, 'exactly one open quest carries a pending attest');
A.eq(QLS.pendingAttests()[0].id, 'q:1', '…and it is the attesting quest');

/* ---------- _apply is defensive ---------- */
A.notThrows(() => QLS._apply(null), '_apply(null) never throws');
A.eq(QLS.quests().length, 0, '…and clears the cache to empty');

/* ---------- new-quest detection: first fetch seeds SILENTLY, a later new open quest fires the COMMS
   broadcast ONLY — notification diet (2026-08-18): a new quest never reaches StationUI.notify (the quest
   log is the quest surface; the bell is reserved for things that need the Commander). ---------- */
{
  // capture StationUI.notify + Chat.broadcast via the globals the store guards on (typeof StationUI/Chat).
  const toasts = [];
  const casts = [];
  global.StationUI = { notify: (t, c) => toasts.push({ t, c }) };
  global.Chat = { broadcast: (t, o) => casts.push({ t, o }) };
  QLS.reset();
  A.eq(QLS._seededOnce(), false, 'a reset store has not yet seeded its new-quest baseline');

  // FIRST fetch (the boot backlog): two open quests — seeded silently, NO toast/broadcast.
  QLS._apply([
    { id: 'q:1', status: 'open', kind: 'generated', title: 'Boot quest one', contract: { type: 'attest', key: '' } },
    { id: 'q:2', status: 'open', kind: 'work', title: 'Boot quest two', contract: { type: 'run', key: 'r1' } }
  ]);
  A.eq(QLS._seededOnce(), true, 'the first fetch flips the seeded flag');
  A.eq(toasts.length, 0, 'the boot backlog is seeded SILENTLY — no toast-storm on the first fetch');
  A.eq(casts.length, 0, '…and no COMMS broadcast on the first fetch');

  // SECOND fetch: the two prior quests + a NEW mint (q:3). Only the new one announces.
  QLS._apply([
    { id: 'q:1', status: 'open', kind: 'generated', title: 'Boot quest one', contract: { type: 'attest', key: '' } },
    { id: 'q:2', status: 'open', kind: 'work', title: 'Boot quest two', contract: { type: 'run', key: 'r1' } },
    { id: 'q:3', status: 'open', kind: 'generated', title: 'Automate the weekly digest', contract: { type: 'attest', key: '' } }
  ]);
  A.eq(toasts.length, 0, 'notification diet: a new quest never toasts');
  A.eq(casts.length, 1, 'exactly one COMMS broadcast for the new quest');
  A.ok(/NEW QUEST/.test(casts[0].t) && /AUTOMATE THE WEEKLY DIGEST/.test(casts[0].t), 'the broadcast carries the new quest title');

  // THIRD fetch: nothing new (q:3 already seen) → no further announcements (anti-repeat).
  QLS._apply([
    { id: 'q:3', status: 'open', kind: 'generated', title: 'Automate the weekly digest', contract: { type: 'attest', key: '' } }
  ]);
  A.eq(casts.length, 1, 'an already-seen open quest never re-announces');

  // a quest first observed as DONE (never open this session) is not a "new quest" (the QuestState fold owns its celebration).
  QLS._apply([
    { id: 'q:3', status: 'open', kind: 'generated', title: 'Automate the weekly digest', contract: { type: 'attest', key: '' } },
    { id: 'q:9', status: 'done', kind: 'work', title: 'Already finished', contract: { type: 'run', key: 'r9' } }
  ]);
  A.eq(casts.length, 1, 'a quest that appears already-done is not announced as a new quest');
  A.eq(toasts.length, 0, 'StationUI.notify was never touched across the whole sequence');

  delete global.StationUI; delete global.Chat;
  QLS.reset();
}

A.report('questledgerstore.test');
