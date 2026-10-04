/* node test/resummonstore.test.js — P3.1 "RUN IT AGAIN?" gate + persisted per-run denylist (resummonstore.js).

   The contract: a 👍 verdict on a real interactive TASK run that did work (and was NOT cron, has a real directive)
   earns exactly ONE "run it again?" offer, through the shared beat slot. 👌/👎 never offer; a pure-chat / no-work /
   empty-directive / cron run never offers; a summoned worker's run fires no hero offer; a decided run (re-summoned
   OR dismissed) is NEVER re-offered, this session or after reload; a busy beat slot DEFERS (retries) rather than
   stacking a second ask; and ACCEPTING pre-fills a fresh run (agent + directive) and NEVER auto-runs it.

   The pure halves (shouldOffer / isDecided / latch) are node-tested directly. The DOM/beat half rides Chat.nudge —
   we drive onVerdict() with fake Chat + localStorage + document globals and assert what it does. */
'use strict';
const A = require('./_assert.js');

/* ---------- a minimal browser shim (localStorage + document + Chat) ---------- */
let mem = {};
global.localStorage = {
  getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
// a fake chat-log whose querySelector reports whether a rate/turn-in control OR a gentle nudge is live (slotBusy()).
let slotLive = false;
global.document = { getElementById: id => (id === 'chat-log' ? { querySelector: () => (slotLive ? {} : null) } : null) };
// a fake Chat.nudge that captures the last offer (line + options) and lets the test pick an action.
let lastNudge = null, chatBusy = false;
global.Chat = {
  isBusy: () => chatBusy,
  nudge: (line, options, onPick) => { lastNudge = { line, options, onPick }; return {}; }
};

const { ResummonStore } = require('../frontend/app/resummonstore.js');

/* ---------- 1. shouldOffer — the truthful gate (pure) ---------- */
const fresh = () => ResummonStore._hydrate(null);
const info = (o) => Object.assign({ isTask: true, cron: false, directive: 'do the thing', didWork: true, agentId: 'agent', agentName: 'NOVA' }, o || {});

A.eq(ResummonStore.shouldOffer(fresh(), 'great', info()), true, 'a 👍 on a real interactive work run offers');
A.eq(ResummonStore.shouldOffer(fresh(), 'ok', info()), false, 'a 👌 verdict never offers (only 👍)');
A.eq(ResummonStore.shouldOffer(fresh(), 'miss', info()), false, 'a 👎 verdict never offers');
A.eq(ResummonStore.shouldOffer(fresh(), 'great', info({ cron: true })), false, 'a cron/unattended run is never offered (truthful)');
A.eq(ResummonStore.shouldOffer(fresh(), 'great', info({ isTask: false })), false, 'a non-task (pure chat) run is never offered');
A.eq(ResummonStore.shouldOffer(fresh(), 'great', info({ didWork: false })), false, 'a task that produced no real work is never offered');
A.eq(ResummonStore.shouldOffer(fresh(), 'great', info({ directive: '   ' })), false, 'a run with no real directive to seed is never offered');
A.eq(ResummonStore.shouldOffer(fresh(), 'great', null), false, 'missing run info offers nothing');
A.eq(ResummonStore.shouldOffer(null, 'great', info()), false, 'a missing ledger offers nothing');

/* ---------- 2. isDecided / latch — the persisted dismiss-once denylist (pure) ---------- */
let s = fresh();
A.eq(ResummonStore.isDecided(s, 'r1'), false, 'a fresh ledger has decided no runs');
ResummonStore.latch(s, 'r1', 'dismissed');
A.eq(ResummonStore.isDecided(s, 'r1'), true, 'a latched run reads as decided');
ResummonStore.latch(s, 'r2', 'again');
A.eq(ResummonStore.isDecided(s, 'r2'), true, 'a re-summoned run is decided too (never re-offered)');
const rehydrated = ResummonStore._hydrate({ decided: { r1: 'dismissed', r2: 'again', bad: 'junk', worse: 5 } });
A.eq(ResummonStore.isDecided(rehydrated, 'r1'), true, 'a persisted dismissal survives hydrate');
A.eq(ResummonStore.isDecided(rehydrated, 'r2'), true, 'a persisted re-summon decision survives hydrate');
A.eq(ResummonStore.isDecided(rehydrated, 'bad'), false, 'a garbage decision value is dropped on hydrate');

/* ---------- 3. onVerdict — the live offer through Chat.nudge, with real persistence + pre-fill ---------- */
let prefills = [];
function initStore(runInfoFor) {
  mem = {}; lastNudge = null; prefills = []; slotLive = false; chatBusy = false;
  ResummonStore.init({ runInfo: runInfoFor, prefillRun: o => prefills.push(o) });
}
const realSetTimeout = global.setTimeout;
let pending = [];
global.setTimeout = (fn) => { pending.push(fn); return 0; };
function flush() { const p = pending; pending = []; p.forEach(fn => { try { fn(); } catch (_) {} }); }

// 3a. a qualifying 👍 offers exactly one beat with RUN IT AGAIN + NOT NOW actions, addressing the agent by name.
initStore(() => info({ directive: 'brief me on X', agentName: 'SCOUT' }));
ResummonStore.onVerdict('run-A', 'great', 'agent');
flush();
A.ok(lastNudge, 'onVerdict offers a beat for a qualifying 👍 run');
A.ok(/run it again/i.test(lastNudge.line), 'the beat line pitches re-running the work');
A.ok(/SCOUT/.test(lastNudge.line), 'the beat addresses the run\'s agent by name');
const vals = lastNudge.options.map(o => o.value);
A.eq(vals, ['again', 'dismiss'], 'the beat offers RUN IT AGAIN then NOT NOW');
A.ok(lastNudge.options[1].skip === true, 'NOT NOW is a skip (dismiss) chip');

// 3b. picking RUN IT AGAIN pre-fills a fresh run (agent + directive) — NEVER auto-running — + latches (persisted).
lastNudge.onPick({ value: 'again' });
A.eq(prefills.length, 1, 'RUN IT AGAIN pre-fills exactly one fresh run');
A.eq(prefills[0].directive, 'brief me on X', 'the pre-fill carries the run\'s directive verbatim (the Commander edits + sends)');
A.eq(prefills[0].agentId, 'agent', 'the pre-fill targets the run\'s agent');
A.ok(/"run-A":"again"/.test(mem['starnet.resummon.v1'] || ''), 'the re-summon decision is persisted (never re-offered)');
lastNudge = null;
ResummonStore.onVerdict('run-A', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a re-summoned run is never re-offered');

// 3c. a 👎 / 👌 / non-hero run makes no offer.
initStore(() => info());
ResummonStore.onVerdict('run-B', 'ok', 'agent'); flush();
A.eq(lastNudge, null, 'a 👌 fires no offer');
ResummonStore.onVerdict('run-B', 'miss', 'agent'); flush();
A.eq(lastNudge, null, 'a 👎 fires no offer');
initStore(() => info());
ResummonStore.onVerdict('run-D', 'great', 'worker-7'); flush();
A.eq(lastNudge, null, 'a summoned worker run fires no hero re-summon offer');

// 3d. DISMISS = stop forever: waving off latches dismissed; never re-offers (this session or reload).
initStore(() => info({ directive: 'do X' }));
ResummonStore.onVerdict('run-E', 'great', 'agent'); flush();
A.ok(lastNudge, 'a qualifying run offers');
lastNudge.onPick({ value: 'dismiss' });
A.eq(prefills.length, 0, 'dismissing pre-fills nothing (no run is seeded)');
A.ok(/"run-E":"dismissed"/.test(mem['starnet.resummon.v1'] || ''), 'a dismissal is persisted');
lastNudge = null;
ResummonStore.onVerdict('run-E', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a dismissed run is never re-offered in the same session');
ResummonStore.init({ runInfo: () => info({ directive: 'do X' }), prefillRun: () => {} });
lastNudge = null;
ResummonStore.onVerdict('run-E', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a dismissed run stays dismissed across a reload (persisted denylist)');

// 3e. a busy beat slot DEFERS (no offer yet, no premature latch) rather than stacking a second ask.
initStore(() => info({ directive: 'do Y' }));
slotLive = true;   // a rate/turn-in/nudge beat is live in the feed
ResummonStore.onVerdict('run-F', 'great', 'agent'); flush();
A.eq(lastNudge, null, 'a busy beat slot defers the offer (no stacked ask)');
A.ok(!/run-F/.test(mem['starnet.resummon.v1'] || ''), 'a deferred run is not yet decided (it can still offer once the slot frees)');
slotLive = false;   // slot frees → the queued retry now offers
flush();
A.ok(lastNudge, 'once the slot frees, the deferred offer fires');

// 3f. reset() clears the denylist — a fresh hero re-earns every offer.
ResummonStore.reset();
A.eq(mem['starnet.resummon.v1'], undefined, 'reset() drops the persisted denylist key');

global.setTimeout = realSetTimeout;
A.report('resummonstore.test');
