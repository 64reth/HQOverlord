/* node test/nightshift.test.js — the PURE night-shift PLANNER (NS-1).

   Proves the server-owned idle-autonomy DECISION is correct with the clock INJECTED (no wall-clock read, no
   timer, no fs). Asserts the load-bearing safety properties:
     · a fully-clear state FIRES (fire:true, binding:null)
     · each GATE binds INDIVIDUALLY — posture / present / halt / leash / cooldown / concurrency — and names itself
     · gate PRECEDENCE (posture > present > halt > leash > cooldown > concurrency) so `binding` is deterministic
     · DAY ROLLOVER resets beatsUsedToday at a new UTC day-bucket (and keeps lastBeatAt for cross-midnight cadence)
     · recordBeat spends exactly one leash unit + stamps lastBeatAt; a spent leash then binds 'leash'
     · beatsLeft fails SAFE to 0 on a missing/NaN cap (never unbounded)
     · loadEnvelope/normalize are tolerant + fail-closed (garbage → floor) */
'use strict';
const A = require('./_assert.js');
const ns = require('../sidecar/nightshift.js');

const DAY = 86400000;
const T0 = 1700000000000;                 // an arbitrary fixed instant
const dayStart = Math.floor(T0 / DAY) * DAY;   // the UTC midnight of T0's day-bucket

// a baseline "everything clears" input at instant `now`, with the driver's knobs.
function inp(now, over) {
  return Object.assign({
    now: now,
    lastUserActivityAt: now - 20 * 60000,   // 20 min ago → away (threshold 15 min)
    actsUnattended: true,
    leashPerDay: 3,
    halted: false,
    concurrencyFree: true,
    awayThresholdMs: 15 * 60000,
    beatIntervalMs: 45 * 60000
  }, over || {});
}

// ---- the clear-fire baseline ----
(function fires() {
  const s = ns.fresh(T0);
  const d = ns.decide(s, inp(T0));
  A.eq(d.fire, true, 'clear state fires');
  A.eq(d.binding, null, 'a firing decision names no binding');
  A.ok(d.away === true, 'baseline is away');
  A.eq(d.beatsLeft, 3, 'fresh leash = full');
})();

// ---- each gate binds individually ----
(function postureGate() {
  const d = ns.decide(ns.fresh(T0), inp(T0, { actsUnattended: false }));
  A.eq(d.fire, false, 'posture below leash → no fire');
  A.eq(d.binding, 'posture', 'names posture');
})();
(function presentGate() {
  const d = ns.decide(ns.fresh(T0), inp(T0, { lastUserActivityAt: T0 - 60000 }));   // 1 min ago → present
  A.eq(d.fire, false, 'Commander present → no fire');
  A.eq(d.binding, 'present', 'names present');
})();
(function haltGate() {
  const d = ns.decide(ns.fresh(T0), inp(T0, { halted: true }));
  A.eq(d.fire, false, 'E-STOP → no fire');
  A.eq(d.binding, 'halt', 'names halt');
})();
(function leashGate() {
  // spend the whole leash, then the next decision binds 'leash'. Use a lastBeat far in the past so cooldown clears.
  let s = ns.fresh(T0);
  s = ns.recordBeat(s, T0 - 3 * 3600000);   // beat 1 (3h ago)
  s = ns.recordBeat(s, T0 - 2 * 3600000);   // beat 2
  s = ns.recordBeat(s, T0 - 1 * 3600000);   // beat 3 → leash (3) spent
  A.eq(ns.beatsLeft(s, T0, 3), 0, 'leash fully spent');
  const d = ns.decide(s, inp(T0));
  A.eq(d.fire, false, 'spent leash → no fire');
  A.eq(d.binding, 'leash', 'names leash');
})();
(function cooldownGate() {
  const s = ns.recordBeat(ns.fresh(T0), T0 - 10 * 60000);   // last beat 10 min ago (< 45 min interval)
  const d = ns.decide(s, inp(T0));
  A.eq(d.fire, false, 'too soon since last beat → no fire');
  A.eq(d.binding, 'cooldown', 'names cooldown');
  // and it fires once the interval elapses:
  const later = T0 - 10 * 60000 + 45 * 60000 + 1;
  const d2 = ns.decide(s, inp(later));
  A.eq(d2.fire, true, 'fires after the beat interval elapses');
})();
(function concurrencyGate() {
  const d = ns.decide(ns.fresh(T0), inp(T0, { concurrencyFree: false }));
  A.eq(d.fire, false, 'agent busy → no fire');
  A.eq(d.binding, 'concurrency', 'names concurrency');
})();

// ---- gate PRECEDENCE: posture beats everything, present beats halt, halt beats leash, leash beats cooldown ----
(function precedence() {
  // all gates fail at once → posture wins (the most "the Commander decided this" reason first).
  let s = ns.recordBeat(ns.recordBeat(ns.recordBeat(ns.fresh(T0), T0), T0), T0);   // leash spent + cooldown hot
  const d = ns.decide(s, inp(T0, { actsUnattended: false, lastUserActivityAt: T0, halted: true, concurrencyFree: false }));
  A.eq(d.binding, 'posture', 'posture has top precedence');
  const d2 = ns.decide(s, inp(T0, { lastUserActivityAt: T0, halted: true, concurrencyFree: false }));
  A.eq(d2.binding, 'present', 'present beats halt/leash/cooldown');
  const d3 = ns.decide(s, inp(T0, { halted: true, concurrencyFree: false }));
  A.eq(d3.binding, 'halt', 'halt beats leash/cooldown');
  const d4 = ns.decide(s, inp(T0, { concurrencyFree: false }));   // leash spent + cooldown hot both true
  A.eq(d4.binding, 'leash', 'leash beats cooldown');
})();

// ---- day rollover ----
(function dayRollover() {
  // spend all 3 beats on day D; a decision the NEXT day resets the counter (leash full again).
  let s = ns.fresh(dayStart);
  s = ns.recordBeat(s, dayStart + 1 * 3600000);
  s = ns.recordBeat(s, dayStart + 2 * 3600000);
  s = ns.recordBeat(s, dayStart + 3 * 3600000);
  A.eq(ns.beatsLeft(s, dayStart + 4 * 3600000, 3), 0, 'same day: leash spent');
  const nextDay = dayStart + DAY + 3600000;
  A.eq(ns.beatsLeft(s, nextDay, 3), 3, 'next day: leash rolls back to full');
  const rolled = ns.rollDay(s, nextDay);
  A.eq(rolled.beatsUsedToday, 0, 'rollDay zeroes the counter');
  A.ok(rolled.lastBeatAt === s.lastBeatAt, 'rollDay keeps lastBeatAt (cadence spans midnight)');
  // a beat that fires the day after full-spend should be allowed (cooldown permitting):
  const d = ns.decide(s, inp(nextDay, { lastUserActivityAt: nextDay - 20 * 60000 }));
  A.eq(d.fire, true, 'a fresh day re-enables acting');
})();

// ---- recordBeat accounting ----
(function recordBeat() {
  const s0 = ns.fresh(T0);
  const s1 = ns.recordBeat(s0, T0);
  A.eq(s1.beatsUsedToday, 1, 'recordBeat spends exactly one');
  A.eq(s1.lastBeatAt, T0, 'recordBeat stamps lastBeatAt');
  A.eq(s0.beatsUsedToday, 0, 'input state is not mutated');
})();

// ---- fail-safe cap + tolerant load ----
(function failSafe() {
  A.eq(ns.beatsLeft(ns.fresh(T0), T0, NaN), 0, 'NaN cap → 0 (never unbounded)');
  A.eq(ns.beatsLeft(ns.fresh(T0), T0, undefined), 0, 'missing cap → 0');
  const g = ns.loadEnvelope('not json at all', T0);
  A.eq(g.beatsUsedToday, 0, 'garbage → floor');
  A.eq(ns.normalize({ beatsUsedToday: -5, lastBeatAt: 'x' }, T0).beatsUsedToday, 0, 'negative counter clamps to 0');
  const dec = ns.decide(ns.fresh(T0), inp(T0, { leashPerDay: NaN }));
  A.eq(dec.binding, 'leash', 'a missing cap binds leash (fail closed, never fires)');
})();

// ---- NS E-STOP durable halt: engage → every decision binds 'halt' (even after cooldown clears), survives the
// envelope round-trip (a restart must NOT silently re-enable overnight spend), clears only deliberately. This is
// the escape test for the resume-after-cooldown bug (isHalted was hardcoded false in the composition root).
(function durableHalt() {
  let s = ns.recordBeat(ns.fresh(T0), T0);            // a beat just fired (leash 1/3 spent, cooldown hot)
  s = ns.engageHalt(s, T0 + 60000);                   // Commander hits E-STOP a minute later
  A.ok(ns.isHalted(s), 'engageHalt stamps the flag');
  A.eq(s.beatsUsedToday, 1, 'engageHalt preserves the leash accounting');
  // the OLD failure mode: 45 min later the cooldown clears — without the durable flag this decision fired.
  const afterCooldown = T0 + 46 * 60000;
  const d = ns.decide(s, inp(afterCooldown, { halted: ns.isHalted(s) }));
  A.eq(d.fire, false, 'halt holds AFTER the cooldown clears (the resume-after-cooldown escape)');
  A.eq(d.binding, 'halt', 'names halt, truthfully');
  // restart round-trip: envelope out → JSON → envelope in. The halt must survive.
  const revived = ns.loadEnvelope(JSON.stringify(ns.toEnvelope(s, afterCooldown)), afterCooldown);
  A.ok(ns.isHalted(revived), 'halt survives the persist/restart round-trip');
  // day rollover must NOT lift it (an E-STOP is not a daily counter).
  A.ok(ns.isHalted(ns.rollDay(revived, afterCooldown + DAY)), 'halt survives day rollover');
  // deliberate clear (the dial re-write path) lifts it; decisions fire again.
  const cleared = ns.clearHalt(revived, afterCooldown + DAY);
  A.ok(!ns.isHalted(cleared), 'clearHalt lifts the flag');
  const d2 = ns.decide(cleared, inp(afterCooldown + DAY, { lastUserActivityAt: afterCooldown + DAY - 20 * 60000 }));
  A.eq(d2.fire, true, 'a cleared halt lets the shift act again');
  // legacy envelope (no haltedAt field) hydrates un-halted — additive, backward-compatible.
  A.ok(!ns.isHalted(ns.loadEnvelope(JSON.stringify({ v: 1, day: ns.dayOf(T0), beatsUsedToday: 0, lastBeatAt: 0 }), T0)), 'legacy state (no haltedAt) reads un-halted');
})();

A.report('nightshift.test');
