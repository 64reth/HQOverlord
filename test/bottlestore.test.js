/* node test/bottlestore.test.js — R5 "BOTTLE A RUN" gate + persisted per-run denylist (bottlestore.js).

   The contract: a 👍 verdict on a real interactive TASK run that did work — and was NOT recipe-launched, NOT cron —
   earns exactly ONE "bottle it?" offer, through the shared beat slot. 👌/👎 never offer; a recipe-launched or
   pure-chat or empty-directive run never offers; a decided run (bottled OR dismissed) is NEVER re-offered, this
   session or after reload; and a busy beat slot DEFERS (retries) rather than stacking a second ask.

   The pure halves (shouldOffer / isDecided / latch) are node-tested directly. The DOM/beat half rides Chat.nudge —
   we drive onVerdict() with fake Chat + localStorage + document globals and assert what it does (offer / defer /
   drop / persist), the same way the store runs in the browser. */
'use strict';
const A = require('./_assert.js');

/* ---------- a minimal browser shim (localStorage + document + Chat + Recipes) ---------- */
let mem = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
// a fake chat-log whose querySelector reports whether a rate/turn-in control is live (drives slotBusy()).
let rateLive = false;
global.document = { getElementById: id => (id === 'chat-log' ? { querySelector: () => (rateLive ? {} : null) } : null) };
// a fake Chat.nudge that captures the last offer (line + options) and lets the test pick an action.
let lastNudge = null, chatBusy = false;
global.Chat = {
  isBusy: () => chatBusy,
  nudge: (line, options, onPick) => { lastNudge = { line, options, onPick }; return {}; }
};
// a fake Recipes.mintFromRun so BOTTLE IT has a proposal to hand the editor (its own logic is recipes.test.js).
let mintCalls = [];
global.Recipes = { mintFromRun: (directive, opts) => { mintCalls.push({ directive, opts }); return { name: 'D', task: directive, sourceRunId: opts && opts.runId }; } };

const { BottleStore } = require('../frontend/app/bottlestore.js');

/* ---------- 1. shouldOffer — the truthful gate (pure) ---------- */
const fresh = () => BottleStore._hydrate(null);
const info = (o) => Object.assign({ isTask: true, fromRecipe: false, cron: false, directive: 'do the thing', didWork: true }, o || {});

A.eq(BottleStore.shouldOffer(fresh(), 'great', info()), true, 'a 👍 on a real interactive work run offers');
A.eq(BottleStore.shouldOffer(fresh(), 'ok', info()), false, 'a 👌 verdict never offers (only 👍)');
A.eq(BottleStore.shouldOffer(fresh(), 'miss', info()), false, 'a 👎 verdict never offers');
A.eq(BottleStore.shouldOffer(fresh(), 'great', info({ fromRecipe: true })), false, 'a recipe-launched run is never bottled (it already IS a recipe)');
A.eq(BottleStore.shouldOffer(fresh(), 'great', info({ cron: true })), false, 'a cron/unattended run is never offered (truthful)');
A.eq(BottleStore.shouldOffer(fresh(), 'great', info({ isTask: false })), false, 'a non-task (pure chat) run is never offered');
A.eq(BottleStore.shouldOffer(fresh(), 'great', info({ didWork: false })), false, 'a task that produced no real work is never offered');
A.eq(BottleStore.shouldOffer(fresh(), 'great', info({ directive: '   ' })), false, 'a run with no real directive is never offered');
A.eq(BottleStore.shouldOffer(fresh(), 'great', null), false, 'missing run info offers nothing');
A.eq(BottleStore.shouldOffer(null, 'great', info()), false, 'a missing ledger offers nothing');

/* ---------- 2. isDecided / latch — the persisted dismiss-once denylist (pure) ---------- */
let s = fresh();
A.eq(BottleStore.isDecided(s, 'r1'), false, 'a fresh ledger has decided no runs');
BottleStore.latch(s, 'r1', 'dismissed');
A.eq(BottleStore.isDecided(s, 'r1'), true, 'a latched run reads as decided');
BottleStore.latch(s, 'r2', 'bottled');
A.eq(BottleStore.isDecided(s, 'r2'), true, 'a bottled run is decided too (never re-offered)');
// hydrate keeps only valid decisions from a persisted blob.
const rehydrated = BottleStore._hydrate({ decided: { r1: 'dismissed', r2: 'bottled', bad: 'junk', worse: 5 } });
A.eq(BottleStore.isDecided(rehydrated, 'r1'), true, 'a persisted dismissal survives hydrate');
A.eq(BottleStore.isDecided(rehydrated, 'r2'), true, 'a persisted bottling survives hydrate');
A.eq(BottleStore.isDecided(rehydrated, 'bad'), false, 'a garbage decision value is dropped on hydrate');

/* ---------- 3. onVerdict — the live offer through Chat.nudge, with real persistence ---------- */
function initStore(runInfoFor) {
  mem = {}; lastNudge = null; mintCalls = []; rateLive = false; chatBusy = false;
  let opened = [];
  BottleStore.init({ openEditor: p => opened.push(p), runInfo: runInfoFor });
  return { opened: () => opened };
}
// helper: run onVerdict then flush the SETTLE_MS defer (setTimeout) synchronously.
const realSetTimeout = global.setTimeout;
let pending = [];
global.setTimeout = (fn, ms) => { pending.push(fn); return 0; };
function flush() { const p = pending; pending = []; p.forEach(fn => { try { fn(); } catch (_) {} }); }

// 3a. a qualifying 👍 offers exactly one beat with BOTTLE IT + NOT THIS ONE actions.
let h = initStore(() => info({ directive: 'brief me on X', runId: 'ignored' }));
BottleStore.onVerdict('run-A', 'great', 'agent');
flush();   // drain the settle defer
A.ok(lastNudge, 'onVerdict offers a beat for a qualifying 👍 run');
A.ok(/bottle it/i.test(lastNudge.line), 'the beat line pitches bottling the run');
const vals = lastNudge.options.map(o => o.value);
A.eq(vals, ['bottle', 'dismiss'], 'the beat offers BOTTLE IT then NOT THIS ONE');
A.ok(lastNudge.options[1].skip === true, 'NOT THIS ONE is a skip (dismiss) chip');

// 3b. picking BOTTLE IT opens the editor with a mintFromRun proposal + latches the run bottled (persisted).
lastNudge.onPick({ value: 'bottle' });
A.eq(mintCalls.length, 1, 'BOTTLE IT derives a proposal via Recipes.mintFromRun');
A.eq(mintCalls[0].opts.runId, 'run-A', 'the proposal carries the bottled run id');
A.eq(h.opened().length, 1, 'BOTTLE IT opens the R2 editor pre-filled');
A.ok(/"run-A":"bottled"/.test(mem['starnet.bottle.v1'] || ''), 'the bottled decision is persisted (never re-offered)');
// the same run never offers again (decided).
lastNudge = null;
BottleStore.onVerdict('run-A', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a bottled run is never re-offered');

// 3c. a 👎 / 👌 / recipe-launched / non-hero run makes no offer.
h = initStore(() => info());
BottleStore.onVerdict('run-B', 'ok', 'agent'); flush();
A.eq(lastNudge, null, 'a 👌 fires no offer');
BottleStore.onVerdict('run-B', 'miss', 'agent'); flush();
A.eq(lastNudge, null, 'a 👎 fires no offer');
h = initStore(() => info({ fromRecipe: true }));
BottleStore.onVerdict('run-C', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a recipe-launched run fires no offer even on 👍');
h = initStore(() => info());
BottleStore.onVerdict('run-D', 'great', 'worker-7'); flush();
A.eq(lastNudge, null, 'a summoned worker run fires no hero bottle offer');

// 3d. DISMISS = stop forever: waving off latches the run dismissed; it never re-offers (this session or reload).
h = initStore(() => info({ directive: 'do X' }));
BottleStore.onVerdict('run-E', 'great', 'agent'); flush();
A.ok(lastNudge, 'a qualifying run offers');
lastNudge.onPick({ value: 'dismiss' });
A.ok(/"run-E":"dismissed"/.test(mem['starnet.bottle.v1'] || ''), 'a dismissal is persisted');
lastNudge = null;
BottleStore.onVerdict('run-E', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a dismissed run is never re-offered in the same session');
// simulate a reload: a fresh init over the SAME localStorage still sees the run as decided.
BottleStore.init({ openEditor: () => {}, runInfo: () => info({ directive: 'do X' }) });
lastNudge = null;
BottleStore.onVerdict('run-E', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a dismissed run stays dismissed across a reload (persisted denylist)');

// 3e. a busy beat slot DEFERS (no offer yet, no premature latch) rather than stacking a second ask.
h = initStore(() => info({ directive: 'do Y' }));
rateLive = true;   // a rate/turn-in control is live in the feed
BottleStore.onVerdict('run-F', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a busy beat slot defers the offer (no stacked ask)');
A.ok(!/run-F/.test(mem['starnet.bottle.v1'] || ''), 'a deferred run is not yet decided (it can still offer once the slot frees)');
rateLive = false;   // slot frees → the queued retry now offers
flush();
A.ok(lastNudge, 'once the slot frees, the deferred offer fires');

// 3f. reset() clears the denylist — a fresh hero re-earns every offer.
BottleStore.reset();
A.eq(mem['starnet.bottle.v1'], undefined, 'reset() drops the persisted denylist key');

global.setTimeout = realSetTimeout;
A.report('bottlestore.test');
