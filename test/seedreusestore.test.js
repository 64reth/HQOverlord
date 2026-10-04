/* node test/seedreusestore.test.js — the seed-reuse aggregate wiring (frontend/app/seedreusestore.js).
   The window/lifetime logic lives in the pure seedreuse.js (tested separately); this verifies the wiring:
   recordAnnotatedRows tallies ONLY digest rows carrying a proven `.seed` (provenance-only); the fire-once
   window crest routes a GENTLE Chat.nudge callout (never an XP mint, never a separate panel); livingTools
   exposes the shelf; and it persists to its own key + reset re-arms a fresh Commander. */
'use strict';
const A = require('./_assert.js');
global.SeedReuse = require('../frontend/app/seedreuse.js');

const mem = {};
global.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const chat = { nudges: [], nudge(t, o, cb) { this.nudges.push({ t, o, cb }); } };
global.Chat = chat;
let seedChimes = 0;
global.SFX = { seed: () => { seedChimes++; } };

const { SeedReuseStore } = require('../frontend/app/seedreusestore.js');
SeedReuseStore.init();

/* ---------- provenance-only: rows WITHOUT a .seed contribute nothing ---------- */
SeedReuseStore.recordAnnotatedRows([{ runId: 'r1', title: 'random run' }, { runId: 'r2', title: 'another' }]);
A.eq(SeedReuseStore.livingTools().length, 0, 'digest rows with no proven .seed are never tallied (honest — the matcher decides)');
A.eq(chat.nudges.length, 0, '…and no callout fires for unmatched rows');

/* ---------- a matched row tallies; five reuses fire ONE gentle callout ---------- */
for (let i = 0; i < 4; i++) SeedReuseStore.recordAnnotatedRows([{ runId: 'a' + i, seed: 'morning brief' }]);
A.eq(chat.nudges.length, 0, 'four matched reuses have not yet crossed the crest');
A.eq(SeedReuseStore.windowCount('morning brief'), 4, 'the window count reflects four proven reuses');

SeedReuseStore.recordAnnotatedRows([{ runId: 'a5', seed: 'morning brief' }]);
A.eq(chat.nudges.length, 1, 'the FIFTH reuse fires exactly one gentle callout');
A.ok(/morning brief/.test(chat.nudges[0].t) && /5/.test(chat.nudges[0].t) && /week/.test(chat.nudges[0].t), 'the callout says the seed ran 5× this week');
A.eq(chat.nudges[0].o.length, 1, 'one acknowledge choice — a gentle aside, not a build ask');
A.ok(chat.nudges[0].o[0].skip, '…and it is a skip choice (never blocks the beat slot)');
A.ok(seedChimes >= 1, 'the callout rings the seed chime (a living tool, reusing the existing sound)');

/* ---------- fire-once per window: further reuses in the same window do NOT re-nag ---------- */
SeedReuseStore.recordAnnotatedRows([{ runId: 'a6', seed: 'morning brief' }]);
A.eq(chat.nudges.length, 1, 'a sixth reuse in the same window never re-fires (fire-once per window crest)');

/* ---------- livingTools exposes the honest shelf ---------- */
const tools = SeedReuseStore.livingTools();
A.eq(tools.length, 1, 'one living tool tracked');
A.eq(tools[0].name, 'morning brief', 'the seed name is carried');
A.eq(tools[0].runs, 6, 'lifetime run count is the honest total');

/* ---------- persistence to its own key ---------- */
A.ok(Object.prototype.hasOwnProperty.call(mem, 'starnet.seedreuse.v1'), 'it self-persists to its OWN key (no save.js change)');

/* ---------- reset: a fresh Commander inherits no tally ---------- */
SeedReuseStore.reset();
A.eq(SeedReuseStore.livingTools().length, 0, 'reset wipes the shelf — a new Commander starts with no tool-usage history');
A.eq(mem['starnet.seedreuse.v1'], undefined, '…and clears its persisted key');

A.report('seedreusestore.test');
