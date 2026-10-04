/* node test/queststore.test.js — the thin read-join behind the QUEST LOG panel (frontend/app/queststore.js).
   Decisions live in the pure quests.js (tested separately); this verifies the JOIN: view() gathers the real
   station XP rollup (meter + milestones), the dossier known/blank dims, and the pending-idea flag, and hands them
   to Quests.build — and degrades to "fewer quests, no crash" when a subsystem is absent. */
'use strict';
const A = require('./_assert.js');
global.Xp = require('../frontend/app/xp.js');
global.Quests = require('../frontend/app/quests.js');

// a station rollup with one task shipped → first_light earned, pack_rat not
let stats = Xp.fresh();
stats = Xp.applyEvent(stats, { name: 'agent.run.end', payload: { reason: 'done', usd: 0.1 } }).stats;
global.XpStore = { stationStats: () => stats };

global.DossierStore = {
  summary: () => ({ counts: { goals: 1 }, known: ['goals'], blank: ['identity', 'stack', 'style', 'standing_orders'], total: 1, familiarity: 0.2, observed: null }),
  dims: () => [
    { key: 'identity', label: 'Identity' }, { key: 'stack', label: 'Stack & tools' }, { key: 'goals', label: 'Goals' },
    { key: 'style', label: 'Working style' }, { key: 'standing_orders', label: 'Standing orders' }
  ]
};
let pending = true;
global.SuggestStore = { willSuggest: () => pending };

const { QuestStore } = require('../frontend/app/queststore.js');

/* ---------- the join ---------- */
const v = QuestStore.view();
A.ok(v.meter && v.meter.level >= 1, 'view() carries the station meter (Xp.compute of the rollup)');
A.ok(v.quests.length > 0, 'view() builds a quest list');
A.eq(v.quests[0].kind, 'idea', 'a pending idea leads the list');
A.eq(v.quests.find(q => q.id === 'dim:goals').status, 'done', 'a known dossier dimension → a done quest');
A.eq(v.quests.find(q => q.id === 'dim:identity').status, 'open', 'a blank dossier dimension → an open quest');
A.eq(v.quests.find(q => q.id === 'ms:first_light').status, 'done', 'an earned milestone → a done quest');
A.eq(v.quests.find(q => q.id === 'ms:pack_rat').status, 'open', 'an unearned milestone → an open quest');
A.eq(v.summary.open + v.summary.done, v.summary.total, 'summary counts are consistent');
const st = v.quests.map(q => q.status);
A.eq(st.indexOf('done') > st.lastIndexOf('open'), true, 'the view preserves open-before-done ordering through the join');

/* ---------- pending-idea flag flows through ---------- */
pending = false;
A.eq(QuestStore.view().quests.some(q => q.kind === 'idea'), false, 'no idea quest when none is due');

/* ---------- the STATION ARC joins from live floor counts (World) + crew size (App) ---------- */
A.eq(QuestStore.view().quests.some(q => q.kind === 'station'), false, 'no World → no station arc (never an arc claiming a floor we cannot read)');
global.World = { stationCounts: () => ({ belts: 2, connectors: 0, liveRoute: 2 }) };
global.App = { crewCount: () => 2 };
const withArc = QuestStore.view();
A.eq(withArc.quests.find(q => q.id === 'st:crew').status, 'done', 'crew size 2 → recruit quest done through the join');
A.eq(withArc.quests.find(q => q.id === 'st:belt').status, 'done', 'a LIVE route (not bare belts) → belt quest done through the join');
A.eq(withArc.quests.find(q => q.id === 'st:connector').status, 'open', 'no portals yet → portal quest open through the join');
global.World = { stationCounts: () => ({ belts: 0, connectors: 0 }) };
global.App = undefined;   // World present but App missing → crew reads 0, arc still renders (recruit stays open)
A.eq(QuestStore.view().quests.find(q => q.id === 'st:crew').status, 'open', 'missing App degrades to crew:0 (recruit open), never a crash');
global.World = undefined;

/* ---------- partial outages: each guard works in isolation ---------- */
global.SuggestStore = undefined; global.DossierStore = undefined;   // XpStore only
const xpOnly = QuestStore.view();
A.ok(xpOnly.meter && xpOnly.meter.level >= 1, 'XpStore-only → meter present');
A.ok(xpOnly.quests.length > 0 && xpOnly.quests.every(q => q.kind === 'milestone'), 'XpStore-only → only milestone quests (no dossier/idea)');
global.XpStore = undefined;   // DossierStore only
global.DossierStore = { summary: () => ({ known: [], blank: ['identity'], counts: {}, total: 0, familiarity: 0, observed: null }), dims: () => [{ key: 'identity', label: 'Identity' }] };
const dossOnly = QuestStore.view();
A.eq(dossOnly.meter, null, 'DossierStore-only → null meter (no XP rollup)');
A.ok(dossOnly.quests.length === 1 && dossOnly.quests[0].kind === 'dossier', 'DossierStore-only → only dossier quests');

/* ---------- graceful degradation: missing subsystems → fewer quests, never a crash ---------- */
global.XpStore = undefined; global.DossierStore = undefined; global.SuggestStore = undefined;
const empty = QuestStore.view();
A.eq(empty.meter, null, 'no XP rollup → null meter, no crash');
A.eq(empty.quests.length, 0, 'no sources → no quests, no crash');

A.report('queststore.test');
