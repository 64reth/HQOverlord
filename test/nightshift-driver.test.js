/* node test/nightshift-driver.test.js — the night-shift TICK DRIVER (NS-1).

   Proves the index.js-owned driver is correct with every ambient dep FAKED (fake clock, fake beat, capturing
   ledger + persisted state) — no http server, no real timer, no wall-clock read. Asserts:
     · a clear tick FIRES the beat and PERSISTS the leash spend IMMEDIATELY (before the async beat resolves)
     · a blocked tick does NOT fire and records a 'decline' ledger entry naming the binding
     · ONE beat at a time: a tick during an in-flight beat is a no-op (binding:'in-flight')
     · the leash is ENFORCED: after leashPerDay fires, further ticks decline with binding:'leash'
     · a DAY ROLLOVER re-enables firing and the persisted counter resets
     · every tick writes the decision trail (decline/beat + outcome) to the ledger
     · abortBeat aborts an in-flight beat (E-STOP hook) */
'use strict';
const A = require('./_assert.js');
const { makeNightshiftDriver } = require('../sidecar/nightshift-driver.js');
const ns = require('../sidecar/nightshift.js');

const DAY = 86400000;
const T0 = 1700000000000;
const flush = () => new Promise(r => setImmediate(r));

function setup(over) {
  over = over || {};
  let state = ns.fresh(T0);
  let clock = T0;
  const persisted = [];        // every setState the driver committed (the durability trail)
  const ledger = [];           // every ledger entry
  const beats = [];            // every beat({agentId,signal}) call
  const prechecks = [];        // every precheck({agentId}) call (NS-2 cold-leash fix)
  let beatResolve = null;      // hold a beat open to test the in-flight guard
  const cfg = {
    getState: () => state,
    setState: (s) => {
      if (over.persistError) throw over.persistError;
      state = s; persisted.push(s);
    },
    getPosture: () => ({ actsUnattended: over.actsUnattended !== false, leashPerDay: over.leashPerDay != null ? over.leashPerDay : 3 }),
    lastActivity: () => (over.lastActivity != null ? over.lastActivity : clock - 20 * 60000),   // away by default
    isHalted: () => !!over.halted,
    concurrencyFree: () => over.concurrencyFree !== false,
    // NS-2 cold-leash fix: the optional pre-spend local gate. `over.precheck` (a value or fn) drives it; absent → NS-1
    // behavior (no precheck dep at all). A precheck call is recorded so a test can assert it ran BEFORE the spend.
    precheck: (over.precheck === undefined) ? undefined : (arg) => { prechecks.push(arg); return (typeof over.precheck === 'function') ? over.precheck(arg) : over.precheck; },
    beat: (o) => { beats.push(o); return new Promise((res) => { beatResolve = res; if (over.autoResolve !== false) res({ delivered: true, title: 'X', archetype: 'advance-goal' }); }); },
    newAbort: () => { let aborted = false; return { signal: { get aborted() { return aborted; } }, abort: () => { aborted = true; } }; },
    now: () => clock,
    ledger: (e) => ledger.push(e),
    agentId: 'agent',
    awayThresholdMs: 15 * 60000,
    beatIntervalMs: 45 * 60000
  };
  const driver = makeNightshiftDriver(cfg);
  return { driver, get state() { return state; }, persisted, ledger, beats, prechecks, setClock: (t) => { clock = t; }, resolveBeat: (r) => beatResolve && beatResolve(r) };
}

// ---- a clear tick fires + persists the spend immediately ----
(async function firesAndPersists() {
  const h = setup({ autoResolve: false });   // hold the beat open so we can inspect state mid-flight
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, true, 'clear tick fires');
  A.eq(h.driver.runInFlight(), true, 'a beat is in flight');
  // the spend was persisted synchronously at accept-time (before the beat resolves):
  A.eq(h.state.beatsUsedToday, 1, 'leash spent immediately (crash-safe accounting)');
  A.eq(h.beats.length, 1, 'beat launched once');
  // a decision ledger entry for the beat exists:
  A.ok(h.ledger.some(e => e.kind === 'beat'), 'ledger records the beat decision');
  // resolve the beat → guard clears + an outcome is logged.
  h.resolveBeat({ delivered: true, title: 'X', archetype: 'advance-goal' });
  await flush();
  A.eq(h.driver.runInFlight(), false, 'guard clears after the beat settles');
  A.ok(h.ledger.some(e => e.kind === 'outcome' && e.delivered === true), 'ledger records the outcome');
})();

// ---- persistence failure stands down BEFORE ledgering/firing (restart-safe leash authority) ----
(function persistFailureFailsClosed() {
  const err = new Error('disk full'); err.code = 'ENOSPC';
  const h = setup({ persistError: err, autoResolve: false });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, false, 'a failed leash/accounting write prevents the beat from firing');
  A.eq(r.binding, 'persist-failed', 'the failed authority boundary is named');
  A.eq(h.state.beatsUsedToday, 0, 'RAM does not claim a spend that disk rejected');
  A.eq(h.persisted.length, 0, 'no state commit is recorded');
  A.eq(h.beats.length, 0, 'the autonomous beat pipeline is never called');
  A.ok(!h.ledger.some(e => e.kind === 'beat'), 'no phantom beat/act is ledgered');
  A.ok(h.ledger.some(e => e.kind === 'decline' && e.binding === 'persist-failed' && e.preSpend === true), 'the fail-closed stand-down is ledgered honestly');
})();

// ---- a blocked tick declines with a named binding ----
(function declines() {
  const h = setup({ actsUnattended: false });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, false, 'posture-blocked tick does not fire');
  A.eq(r.binding, 'posture', 'names the binding');
  A.ok(h.ledger.some(e => e.kind === 'decline' && e.binding === 'posture'), 'ledger records the decline + binding');
})();

// ---- one beat at a time ----
(async function oneAtATime() {
  const h = setup({ autoResolve: false });
  h.driver.applyTick(T0);                    // starts a beat, held open
  const r2 = h.driver.applyTick(T0 + 1000);  // second tick while in flight
  A.eq(r2.fired, false, 'no second beat while one is in flight');
  A.eq(r2.binding, 'in-flight', 'names in-flight');
  A.eq(h.beats.length, 1, 'still only one beat launched');
  h.resolveBeat({ delivered: false, reason: 'stood-down' });
  await flush();
})();

// ---- the leash is enforced across ticks ----
(async function leashEnforced() {
  const h = setup({ leashPerDay: 2 });
  // beat 1 at T0
  h.driver.applyTick(T0); await flush();
  // beat 2 must wait past the cooldown (45 min); advance the clock.
  const t1 = T0 + 46 * 60000;
  h.setClock(t1);
  h.driver.applyTick(t1); await flush();
  A.eq(h.state.beatsUsedToday, 2, 'two beats spent');
  // beat 3 (past cooldown again) is refused — leash spent.
  const t2 = t1 + 46 * 60000;
  h.setClock(t2);
  const r = h.driver.applyTick(t2);
  A.eq(r.fired, false, 'third beat refused (leash 2 spent)');
  A.eq(r.binding, 'leash', 'binding is leash');
})();

// ---- day rollover re-enables + resets the persisted counter ----
(async function rollover() {
  const h = setup({ leashPerDay: 1 });
  h.driver.applyTick(T0); await flush();
  A.eq(h.state.beatsUsedToday, 1, 'day-1 beat spent the single leash');
  const nextDay = T0 + DAY;
  h.setClock(nextDay);
  const r = h.driver.applyTick(nextDay);
  A.eq(h.state.beatsUsedToday, 1, 'a beat fired on the new day (counter is 1 = this new beat, not 2)');
  A.eq(r.fired, true, 'the new day re-enabled firing');
})();

// ---- a halted tick declines with binding:'halt' and spends NOTHING (the durable E-STOP gate) ----
(function haltedTick() {
  const h = setup({ halted: true });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, false, 'a halted tick does not fire');
  A.eq(r.binding, 'halt', 'names halt');
  A.eq(h.state.beatsUsedToday, 0, 'a halted tick spends no leash');
  A.ok(h.ledger.some(e => e.kind === 'decline' && e.binding === 'halt'), 'ledger records the halt decline');
})();

// ---- abortBeat is the E-STOP hook ----
(async function estop() {
  const h = setup({ autoResolve: false });
  h.driver.applyTick(T0);
  A.eq(h.driver.runInFlight(), true, 'beat in flight');
  const n = h.driver.abortBeat();
  A.eq(n, 1, 'abortBeat aborts the in-flight beat');
  h.resolveBeat({ delivered: false, reason: 'aborted' });
  await flush();
  A.eq(h.driver.runInFlight(), false, 'guard cleared after abort settles');
})();

// ---- NS-2: the COLD-LEASH FIX — a pre-spend readiness stand-down does NOT spend a leash unit ----
(function coldLeashNoSpend() {
  // the pure gates all clear (away, posture, leash, cooldown), but the local precheck says "not ready" (cold on
  // both grounding paths → no model call could salvage it). The beat must decline WITHOUT spending.
  const h = setup({ precheck: { ok: false, reason: 'readiness' } });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, false, 'a cold-readiness beat does NOT fire');
  A.eq(r.binding, 'readiness', 'the binding is readiness (the pre-spend stand-down kind)');
  A.eq(h.state.beatsUsedToday, 0, 'NO leash was spent (the cold-leash wart is fixed)');
  A.eq(h.beats.length, 0, 'no model-call beat was launched (purely-local stand-down)');
  A.eq(h.prechecks.length, 1, 'the precheck ran');
  A.ok(h.ledger.some(e => e.kind === 'decline' && e.binding === 'readiness' && e.preSpend === true), 'the decline is ledgered with binding:readiness + preSpend:true');
})();

// ---- LANE L: a pre-spend BUDGET/CAPABILITY stand-down does NOT spend a leash unit either ----
// The precheck is generic over its reason: when it reports the cross-run budget pool is exhausted (or no provider is
// runnable), a beat's first model call would die AFTER the leash was spent — so declining here saves the unit. The
// driver must carry that reason through as the binding and spend nothing. (index.js wires budget.check/capability
// into nightshiftPrecheck; nightshift-budget.e2e.test.js proves the wiring end-to-end.)
(function budgetPreSpendNoSpend() {
  const h = setup({ precheck: { ok: false, reason: 'budget' } });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, false, 'a budget-exhausted beat does NOT fire');
  A.eq(r.binding, 'budget', 'the binding is budget (pool exhausted, pre-spend)');
  A.eq(h.state.beatsUsedToday, 0, 'NO leash was spent on a budget-exhausted no-op (the burned-leash wart is fixed)');
  A.eq(h.beats.length, 0, 'no model-call beat was launched (purely-local stand-down)');
  A.ok(h.ledger.some(e => e.kind === 'decline' && e.binding === 'budget' && e.preSpend === true), 'the decline is ledgered with binding:budget + preSpend:true');
})();

// ---- NS-2: a beat that PASSES the precheck still spends at accept-time (anti-runaway preserved) ----
(function passingPrecheckStillSpends() {
  const h = setup({ precheck: { ok: true }, autoResolve: false });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, true, 'a ready beat fires');
  A.eq(h.state.beatsUsedToday, 1, 'the leash IS spent at accept-time (a beat that reached a model call cost budget)');
  A.eq(h.beats.length, 1, 'the model-call beat launched');
  A.eq(h.prechecks.length, 1, 'the precheck ran before the spend');
  h.resolveBeat({ delivered: false, reason: 'stood-down' });
})();

// ---- RELEASE ESCAPE: a precheck HICCUP fails CLOSED before spend ----
(function precheckHiccupFailsClosed() {
  const h = setup({ precheck: () => { throw new Error('boom'); }, autoResolve: false });
  const r = h.driver.applyTick(T0);
  A.eq(r.fired, false, 'a throwing precheck stands down; unattended work never fires through an unproven gate');
  A.eq(r.binding, 'precheck-error', 'the stand-down names the failed safety inspection');
  A.eq(h.state.beatsUsedToday, 0, 'a failed precheck spends no leash unit');
  A.eq(h.beats.length, 0, 'the autonomous beat is never invoked');
  A.ok(h.ledger.some(e => e.kind === 'decline' && e.binding === 'precheck-error' && e.preSpend === true), 'the failure is ledgered truthfully as a pre-spend decline');
  const sd = h.driver.statusDecision(T0);
  A.eq([sd.fire, sd.binding], [false, 'precheck-error'], 'status reports the same safe stand-down instead of claiming a beat can fire');
})();

// ---- NS-2: statusDecision reflects the pre-spend readiness stand-down (status == what the tick would do) ----
(function statusReflectsPrecheck() {
  const h = setup({ precheck: { ok: false, reason: 'readiness' } });
  const sd = h.driver.statusDecision(T0);
  A.eq([sd.fire, sd.binding], [false, 'readiness'], 'statusDecision folds the precheck: binding readiness, no fire');
  // no precheck dep → statusDecision == decideNow (unchanged path).
  const h2 = setup({});   // no precheck
  A.eq(h2.driver.statusDecision(T0).fire, h2.driver.decideNow(T0).fire, 'with no precheck, statusDecision matches decideNow');
})();

// ---- NS-2: the pure-gate declines still take precedence over the precheck (precheck only runs when gates clear) ----
(function gateBeforePrecheck() {
  const h = setup({ actsUnattended: false, precheck: { ok: false, reason: 'readiness' } });
  const r = h.driver.applyTick(T0);
  A.eq(r.binding, 'posture', 'a pure-gate decline (posture) still names its gate — the precheck is not consulted');
  A.eq(h.prechecks.length, 0, 'the precheck is not even called when a pure gate already blocks (no wasted work)');
})();

setTimeout(() => A.report('nightshift-driver.test'), 50);
