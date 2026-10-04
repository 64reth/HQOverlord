/* node test/routinenudgestore.test.js — the routine-nudge wiring (frontend/app/routinenudgestore.js, lane D).
   Locks: the pick gates (launch floor, cadence-only, no-live-routine, durable anti-nag), the fail-closed
   unknown-cron stand-down, the one-offer-per-session cap, the propose() nudge shape + accept deep-link +
   dismiss-forever, and reset. Runs under node with the seedstore.test.js global-shim pattern. */
'use strict';
const A = require('./_assert.js');

// ---- shims ----
const mem = {};
global.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };

let launchCounts = {};
global.ProspectStore = { launches: () => launchCounts };

const RECIPES = {
  'morning-brief': { id: 'morning-brief', name: 'Morning Brief', cadence: 'morning' },
  'price-watch': { id: 'price-watch', name: 'Price Watch', cadence: 'sixhourly' },
  'fix-bug': { id: 'fix-bug', name: 'Fix a Bug', cadence: null }   // one-shot by nature — never nudged
};
global.Recipes = { get: id => RECIPES[id] || null };

const chat = { nudges: [], nudge(t, o, cb) { this.nudges.push({ t, o, cb }); } };
global.Chat = chat;
let opened = [];
global.App = { openRecipeLaunch: (id, mode) => { opened.push({ id, mode }); } };

const { RoutineNudgeStore } = require('../frontend/app/routinenudgestore.js');
const R = RoutineNudgeStore;

function clearFakes() { chat.nudges = []; opened = []; }

/* ---------- fail-closed: unknown cron state → the store stands down entirely ---------- */
R.reset(); R.init();   // the browser query spine is absent under Node → cache stays UNKNOWN
launchCounts = { 'morning-brief': { n: 5, lastAt: 1 } };
A.eq(R.willPropose(), false, 'cron state unknown → stand down (fail-closed, never a duplicate-routine offer)');

/* ---------- the pick gates ---------- */
R._setCronForTest([]);   // cron known-empty from here on
A.eq(R.willPropose(), true, 'a cadence recipe past the launch floor with no live routine is offered');
A.eq(R._pick().id, 'morning-brief', 'the pick is the eligible recipe');

launchCounts = { 'morning-brief': { n: R.LAUNCH_FLOOR - 1, lastAt: 1 } };
A.eq(R.willPropose(), false, 'below the launch floor → no offer');

/* A RECIPE WITH NO AUTHORED CADENCE STILL EARNS THE OFFER (2026-08-05). The old gate required `r.cadence` — the
   CATALOG AUTHOR's suggestion — which quietly excluded every recipe the station itself mints: seedstore →
   Recipes.draft stamps `cadence: null`, so an agent-authored recipe the Commander launched nine times by hand
   could never earn "want it on a schedule?". The evidence was always the launch count, and that is all the
   nudge cites; the cadence is chosen by the Commander in the SCHEDULE IT form the accept opens. */
launchCounts = { 'fix-bug': { n: 9, lastAt: 1 } };
A.eq(R.willPropose(), true, 'a recipe with NO authored cadence is nudged on its real hand-launch count');
A.eq(R._pick().cadence, null, '…and the pick carries no cadence — nothing is fabricated for it');

launchCounts = { 'ghost-recipe': { n: 9, lastAt: 1 } };
A.eq(R.willPropose(), false, 'an unknown recipe id is never nudged');

// the busiest eligible recipe wins
launchCounts = { 'morning-brief': { n: 4, lastAt: 1 }, 'price-watch': { n: 7, lastAt: 2 } };
A.eq(R._pick().id, 'price-watch', 'the most-launched eligible recipe is picked');
// …and an EQUAL count breaks toward the one whose author declared a rhythm (ordering only, never admission)
launchCounts = { 'fix-bug': { n: 6, lastAt: 2 }, 'morning-brief': { n: 6, lastAt: 1 } };
A.eq(R._pick().id, 'morning-brief', 'on a tie, the recipe with a declared cadence wins the slot');
/* ---------- THE RATED COUNTERS ARE CONSULTED, NOT JUST THE LAUNCH COUNT (2026-08-05) ----------
   pick() read `u.n` and nothing else, so a recipe launched three times and rated 👎 all three still earned
   "want this every day?" — repetition read as approval while the Commander's own rate-the-work verdicts said
   the opposite. The offer is BINARY, so a mismatch of kind must EXCLUDE, not down-rank (repo law). */
launchCounts = { 'morning-brief': { n: 3, lastAt: 1 } };
A.eq(R.willPropose(), true, 'control: the same 3 launches with NO verdicts on record does earn the offer');
launchCounts = { 'morning-brief': { n: 3, lastAt: 1, rated: { great: 0, miss: 3 } } };
A.eq(R.willPropose(), false, 'a recipe launched 3× and rated 👎 3× is NOT offered a schedule');
launchCounts = { 'morning-brief': { n: 5, lastAt: 1, rated: { great: 0, miss: 1 } } };
A.eq(R.willPropose(), true, 'ONE bad run is not a verdict — the offer stands');
launchCounts = { 'morning-brief': { n: 6, lastAt: 1, rated: { great: 3, miss: 2 } } };
A.eq(R.willPropose(), true, '…nor is a recipe that was mostly liked');
launchCounts = { 'morning-brief': { n: 6, lastAt: 1, rated: { great: 2, miss: 2 } } };
A.eq(R.willPropose(), false, 'an even split with 2+ misses is not a habit worth automating');
launchCounts = { 'morning-brief': { n: 6, lastAt: 1, rated: { great: 'x', miss: null } } };
A.eq(R.willPropose(), true, 'malformed counters read as zero and change nothing');
// …and the exclusion is per-recipe: a miss-heavy recipe steps aside for an eligible one rather than silencing the beat
launchCounts = { 'morning-brief': { n: 9, lastAt: 1, rated: { miss: 4 } }, 'price-watch': { n: 3, lastAt: 2 } };
A.eq(R._pick().id, 'price-watch', 'the miss-heavy recipe is dropped and the clean one takes the slot');

launchCounts = { 'morning-brief': { n: 4, lastAt: 1 }, 'price-watch': { n: 7, lastAt: 2 } };   // restore the two-recipe fixture

// a live routine for the recipe (cron meta.recipeId) suppresses its offer
R._setCronForTest([{ id: 'j1', meta: { recipeId: 'price-watch' } }]);
A.eq(R._pick().id, 'morning-brief', 'a recipe with a live routine is skipped (no duplicate offers)');
R._setCronForTest([{ id: 'j1', meta: { recipeId: 'price-watch' } }, { id: 'j2', meta: { recipeId: 'morning-brief' } }]);
A.eq(R.willPropose(), false, 'every eligible recipe scheduled → nothing to offer');

/* ---------- propose(): nudge shape, accept deep-link, session cap ---------- */
R._setCronForTest([]);
launchCounts = { 'morning-brief': { n: 5, lastAt: 1 } };
clearFakes();
R.propose();
A.eq(chat.nudges.length, 1, 'propose renders exactly one gentle nudge');
A.ok(chat.nudges[0].t.indexOf('Morning Brief') >= 0 && chat.nudges[0].t.indexOf('5') >= 0, 'the nudge names the recipe and the real launch count');
A.ok(chat.nudges[0].o.some(o => o.value === 'routine') && chat.nudges[0].o.some(o => o.value === 'no'), 'the nudge offers schedule-it and not-now');
// accept → deep-link into the SCHEDULE IT form (propose-and-confirm; never a direct cron write)
chat.nudges[0].cb({ value: 'routine' });
A.eq(opened.length, 1, 'accepting deep-links via App.openRecipeLaunch');
A.eq(opened[0].id, 'morning-brief', 'the deep-link targets the picked recipe');
A.eq(opened[0].mode, 'routine', 'the deep-link opens in routine mode');
chat.nudges[0].cb({ value: 'routine' });
A.eq(opened.length, 1, 'the choice callback is one-shot (a double-click cannot double-open)');
// session cap: the one offer is spent
A.eq(R.willPropose(), false, 'the session budget is spent (one offer per session)');
clearFakes(); R.propose();
A.eq(chat.nudges.length, 0, 'propose past the cap is a no-op');

/* ---------- durable anti-nag: offers tally across sessions; dismissal retires forever ---------- */
R.init(); R._setCronForTest([]);   // "next session" (init re-arms the session budget, keeps the durable ledger)
A.eq(R.willPropose(), true, 'an ignored offer may re-surface next session (once)');
clearFakes(); R.propose();          // second (and final) offer for this recipe
R.init(); R._setCronForTest([]);
A.eq(R.willPropose(), false, 'after OFFER_MAX ignored offers the recipe stops surfacing for good');

// an explicit "not now" retires immediately (fresh ledger, fresh recipe)
R.reset(); R.init(); R._setCronForTest([]);
launchCounts = { 'price-watch': { n: 6, lastAt: 1 } };
clearFakes(); R.propose();
chat.nudges[0].cb({ value: 'no' });
A.eq(opened.length, 0, 'declining opens nothing');
R.init(); R._setCronForTest([]);
A.eq(R.willPropose(), false, 'an explicit not-now retires the recipe durably (never offered again)');

/* ---------- reset: a new hero starts clean ---------- */
R.reset(); R.init(); R._setCronForTest([]);
A.eq(R.willPropose(), true, 'reset clears the durable ledger (a new hero re-earns the nudges)');

/* ---------- wiring source-locks (browser-flow files, not node-loadable) ---------- */
const fs = require('fs'), path = require('path');
const idx = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
A.ok(/app\/routinenudgestore\.js/.test(idx), 'routinenudgestore.js is loaded by index.html (a missing tag fails silently — locked here)');
const appSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
A.ok(/RoutineNudgeStore\.init\(\)/.test(appSrc), 'app.js inits RoutineNudgeStore (warms the cron cache)');
A.ok(/openRecipeLaunch:\s*openRecipeLaunch/.test(appSrc), 'App exports openRecipeLaunch (the accept deep-link)');
A.ok(/launchSeed:\s*\{\s*id:\s*String\(recipeId\)/.test(appSrc), 'openRecipeLaunch seeds ctx.launchSeed for the bay');
const mkt = fs.readFileSync(path.join(__dirname, '../frontend/app/marketplace.js'), 'utf8');
A.ok(/function maybeConsumeLaunchSeed/.test(mkt), 'the bay defines the one-shot launch-seed consume');
A.ok(/ctx\.launchSeed = null/.test(mkt), 'the launch seed is consumed one-shot (cleared before any render)');
// lane F (same telemetry read): the card life chip is the Commander's OWN counts, honestly framed — never "popular".
A.ok(/function recipeLifeChip/.test(mkt), 'the bay defines the recipe life chip (lane F)');
A.ok(/ProspectStore\.launches\(\)/.test(mkt.slice(mkt.indexOf('function recipeLifeChip'), mkt.indexOf('function recipeLifeChip') + 900)), 'the life chip reads the real scout launch counters');
A.ok(!/popular/i.test(mkt.slice(mkt.indexOf('function recipeLifeChip'), mkt.indexOf('function recipeCardHTML'))), 'the life chip never claims popularity (own counts only — truthful telemetry)');

A.report('routinenudgestore');
