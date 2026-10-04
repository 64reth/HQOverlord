/* node test/quests.test.js — the pure quest-skin engine (frontend/app/quests.js).
   Locks the projection: a pending idea is the first (open) quest; blank dossier dims are open, known are done;
   unearned milestones are open (with their hint), earned are done; ALL open quests precede done; every quest
   names a real reward; honest counts. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const Q = require('../frontend/app/quests.js');

/* ---------- defensive ---------- */
A.eq(Q.build({}), [], 'no inputs → no quests');
A.eq(Q.build(), [], 'undefined input → no quests, never throws');
A.eq(Q.summary(null), { open: 0, done: 0, total: 0 }, 'summary of nothing is all-zero');

const dims = [
  { key: 'identity', label: 'Identity', known: true },
  { key: 'stack', label: 'Stack & tools', known: false },
  { key: 'goals', label: 'Goals', known: true }
];
const ms = [
  { id: 'first_light', label: 'FIRST LIGHT', hint: 'ship 1 task', earned: true },
  { id: 'pack_rat', label: 'PACK RAT', hint: 'reuse a memory', earned: false }
];
const list = Q.build({ milestones: ms, dossierDims: dims, pendingIdea: true });

/* ---------- the idea is the first, most-actionable quest ---------- */
A.eq(list[0].kind, 'idea', 'a pending idea is the first quest');
A.eq(list[0].status, 'open', 'the idea quest is open');
A.eq(list[0].title, 'An idea is waiting', 'the idea quest has the expected title');
A.ok(/finish a task/i.test(list[0].desc) && /COMMS/i.test(list[0].desc), 'the idea quest honestly tells the user HOW to hear it (finish a task → offered in COMMS), not the misleading "open COMMS"');
A.eq(list[0].reward, 'a real, working build', 'the idea quest pays out a real build');

/* ---------- open before done ---------- */
const statuses = list.map(q => q.status);
A.eq(statuses.indexOf('done') > statuses.lastIndexOf('open'), true, 'all open quests come before all done quests');

/* ---------- dossier dims: blank → open, known → done ---------- */
const stackQ = list.find(q => q.id === 'dim:stack');
A.eq(stackQ.status, 'open', 'a blank dossier dimension is an open quest');
A.ok(/stack & tools/i.test(stackQ.title), 'the dossier quest names the dimension');
A.eq(list.find(q => q.id === 'dim:identity').status, 'done', 'a known dimension is a done quest');

/* ---------- milestones: earned → done, unearned → open (with the how-to) ---------- */
A.eq(list.find(q => q.id === 'ms:first_light').status, 'done', 'an earned milestone is done');
const packRat = list.find(q => q.id === 'ms:pack_rat');
A.eq(packRat.status, 'open', 'an unearned milestone is open');
A.ok(/reuse a memory/.test(packRat.desc), 'an open milestone shows how to earn it');

/* ---------- honest rewards (real outcomes, never a fake currency) ---------- */
A.ok(list.every(q => typeof q.reward === 'string' && q.reward.length > 0), 'every quest names a real reward');
A.ok(!list.some(q => /\bXP\b|points|coins|gold/i.test(q.reward)), 'no quest rewards a fake currency');

/* ---------- no pending idea → no idea quest ---------- */
A.eq(Q.build({ milestones: ms, dossierDims: dims, pendingIdea: false }).some(q => q.kind === 'idea'), false, 'no idea quest when none is pending');

/* ---------- the STATION ARC (recruit → belts → portals): the tutorial's hand-off spine ---------- */
const fresh = Q.build({ station: { crew: 1, belts: 0, connectors: 0 } });
A.eq(fresh.length, 3, 'a fresh floor has the three station-arc quests');
A.ok(fresh.every(q => q.kind === 'station' && q.status === 'open'), 'all three arc quests start open');
A.eq(fresh[0].id, 'st:crew', 'recruit-a-specialist leads the arc');
A.ok(fresh.every(q => typeof q.reward === 'string' && q.reward.length > 0 && !/\bXP\b|points|coins/i.test(q.reward)), 'arc quests pay real capabilities, never a fake currency');
const grown = Q.build({ station: { crew: 2, belts: 4, connectors: 0, liveRoute: 0 } });
A.eq(grown.find(q => q.id === 'st:crew').status, 'done', 'a second crew member completes the recruit quest');
A.eq(grown.find(q => q.id === 'st:belt').status, 'open', 'bare belts with NO live route leave the belt quest open (a dead line is not the reward)');
const routed = Q.build({ station: { crew: 2, belts: 4, connectors: 0, liveRoute: 4 } });
A.eq(routed.find(q => q.id === 'st:belt').status, 'done', 'a LIVE intake→bay route completes the belt quest');
A.eq(grown.find(q => q.id === 'st:connector').status, 'open', 'the portal quest stays open until one is placed');
A.eq(Q.build({ milestones: ms, dossierDims: dims, pendingIdea: false }).some(q => q.kind === 'station'), false, 'no station input → no arc (older callers unchanged)');
const withIdea = Q.build({ station: { crew: 1, belts: 0, connectors: 0 }, pendingIdea: true });
A.eq(withIdea[0].kind, 'idea', 'a waiting idea still leads — the arc follows it');
A.eq(withIdea[1].kind, 'station', 'the arc sits right after the idea');
const arcStatuses = Q.build({ station: { crew: 2, belts: 0, connectors: 1 }, dossierDims: dims }).map(q => q.status);
A.eq(arcStatuses.indexOf('done') > arcStatuses.lastIndexOf('open'), true, 'open-before-done ordering holds with the arc mixed in');

/* ---------- QUEST V2 §C: the HARNESS LEDGER splice (kind:'ledger') ---------- */
const ledger = [
  { id: 'q:1', kind: 'ledger', ledgerKind: 'generated', title: 'Automate the weekly digest', desc: 'a build the agent proposed', reward: 'a standing digest', status: 'open', contract: { type: 'attest', key: '' } },
  { id: 'q:2', kind: 'ledger', ledgerKind: 'work', title: 'Wire the CRM sync', desc: 'in flight', reward: 'a live sync', status: 'done', contract: { type: 'run', key: 'run-9' } }
];
const withLedger = Q.build({ ledgerQuests: ledger, pendingIdea: true, station: { crew: 1, belts: 0, connectors: 0 } });
A.eq(withLedger[0].kind, 'idea', 'the waiting idea still leads the whole list');
A.eq(withLedger[1].id, 'q:1', 'an open ledger quest splices right after the idea (most personal/actionable)');
A.eq(withLedger[1].kind, 'ledger', '…and keeps its ledger kind so handlers/dismiss route unambiguously');
A.ok(withLedger.some(x => x.id === 'q:2' && x.status === 'done'), 'a done ledger quest lands in the done set (so the QuestState fold sees its open→done edge)');
const lstat = withLedger.map(x => x.status);
A.eq(lstat.indexOf('done') > lstat.lastIndexOf('open'), true, 'open-before-done ordering holds with ledger quests mixed in');
A.eq(Q.build({ ledgerQuests: [null, { id: '' }, { status: 'open' }] }).length, 0, 'malformed ledger entries (no id) are skipped, never a crash');
A.eq(Q.build({ milestones: ms, dossierDims: dims }).some(x => x.kind === 'ledger'), false, 'absent ledger input → no ledger quests (older callers unchanged)');

/* ---------- summary counts ---------- */
const sum = Q.summary(list);
A.eq(sum.total, list.length, 'summary total matches the list');
A.eq(sum.open + sum.done, sum.total, 'open + done = total');
A.eq(sum.open, 3, 'three open quests (idea + stack + pack_rat)');
A.eq(sum.done, 3, 'three done quests (identity + goals + first_light)');

/* ---------- malformed entries are skipped, never crash; a key-only dim falls back to the key ---------- */
const malformed = Q.build({ milestones: [null, { id: '' }], dossierDims: [{ key: 'x' }, null, {}, { key: null, label: 'Name' }] });
A.eq(malformed.length, 1, 'null/empty/keyless entries are skipped; only the valid-key dim yields a quest');
A.eq(malformed[0].id, 'dim:x', 'a dim with a key but no label still makes a quest (key as the label)');
A.ok(!malformed.some(q => q.id === 'dim:null'), 'a dim with a null key never produces a dim:null quest');

/* ---------- deterministic ---------- */
A.eq(JSON.stringify(Q.build({ milestones: ms, dossierDims: dims, pendingIdea: true })), JSON.stringify(list), 'build is deterministic for the same input');

A.report('quests.test');
