/* node test/cron.test.js — the PURE cron-math core (CRON Commit 1).
   Proves the schedule parser, next-fire math, and the tick planner are pure, deterministic, and
   injected-clock — and that the three subtle invariants hold: at-most-once across a crash, the
   no-backlog fast-forward of stale recurring jobs, and one-shots that fire once then never again.
   Everything is driven by makeClock (no wall-clock read), exactly like loop.replay/permissions. */
'use strict';
const A = require('./_assert.js');
const { makeClock } = require('../shared/clock-rng.js');
const cron = require('../sidecar/cron.js');

const T0 = 1700000000000;   // a fixed ms epoch (2023-11-14T...) — all times are relative to this
const clock = makeClock(T0);
const job = (o) => Object.assign({ id: 'j1', enabled: true, schedule: null, nextRunAt: null, lastRunAt: null }, o);

// ---- 1. parseSchedule: interval forms ----
{
  A.eq(cron.parseSchedule('every 30m', T0).kind, 'interval', 'every 30m -> interval');
  A.eq(cron.parseSchedule('every 30m', T0).minutes, 30, 'every 30m -> 30 minutes');
  A.eq(cron.parseSchedule('every 1h', T0).minutes, 60, 'every 1h -> 60 minutes');
  A.eq(cron.parseSchedule('every 2 hours', T0).minutes, 120, 'every 2 hours -> 120 minutes');
  A.eq(cron.parseSchedule('every day', T0).minutes, 1440, 'every day (no N) -> 1440 minutes');
  A.eq(cron.parseSchedule('every 1h', T0).display, 'every 1h', 'interval display is humanized');
  A.eq(cron.parseSchedule('every 30s', T0), null, 'sub-minute interval rejected (60s tick)');
}

// ---- 2. parseSchedule: once (relative + absolute) ----
{
  const inTwoH = cron.parseSchedule('in 2h', T0);
  A.eq(inTwoH.kind, 'once', 'in 2h -> once');
  A.eq(inTwoH.runAt, T0 + 2 * 3600000, 'in 2h runAt = now + 2h (now is a PARAM)');

  const bare = cron.parseSchedule('30m', T0);
  A.eq(bare.kind, 'once', 'bare 30m -> once');
  A.eq(bare.runAt, T0 + 30 * 60000, 'bare 30m runAt = now + 30m');

  const stamp = cron.parseSchedule('2026-06-15T09:00:00Z', T0);
  A.eq(stamp.kind, 'once', 'ISO timestamp -> once');
  A.eq(stamp.runAt, Date.parse('2026-06-15T09:00:00Z'), 'ISO runAt = Date.parse(value)');

  // the SAME relative string parsed at a different `now` yields a different runAt — purity, not ambient
  A.eq(cron.parseSchedule('in 2h', T0 + 1000).runAt, T0 + 1000 + 2 * 3600000, 'relative once tracks the passed now');
}

// ---- 3. parseSchedule: cron subset, and garbage ----
{
  const c = cron.parseSchedule('*/30 * * * *', T0);
  A.eq(c.kind, 'cron', '5-field expr recognised as cron');
  A.eq(c.expr, '*/30 * * * *', 'cron expression is canonicalized');
  A.eq(c.fields.minute, [0, 30], 'cron step field parsed');
  A.eq(cron.parseSchedule('61 * * * *', T0), null, 'out-of-range cron field -> null');
  A.eq(cron.parseSchedule('0 0 31 2 *', T0), null, 'impossible cron date -> null');
  A.eq(cron.parseSchedule('not a schedule', T0), null, 'garbage -> null');
  A.eq(cron.parseSchedule('', T0), null, 'empty -> null');
  A.eq(cron.parseSchedule('* * * *', T0), null, '4-field (not 5) is not cron -> null');
}

// ---- 4. nextFireAt: once vs interval, run vs not-run ----
{
  const once = { kind: 'once', runAt: T0 + 5000 };
  A.eq(cron.nextFireAt(once, null, T0), T0 + 5000, 'once not-run -> its runAt');
  A.eq(cron.nextFireAt(once, cron._internals.iso(T0), T0), null, 'once already-run -> null (ineligible)');

  const iv = { kind: 'interval', minutes: 60 };
  A.eq(cron.nextFireAt(iv, null, T0), T0 + 3600000, 'interval no last-run -> now + period');
  A.eq(cron.nextFireAt(iv, cron._internals.iso(T0 - 600000), T0), T0 - 600000 + 3600000, 'interval -> lastRun + period');

  const base = Date.parse('2026-06-19T08:58:00Z');
  const daily = cron.parseSchedule('0 9 * * *', base);
  A.eq(cron.nextFireAt(daily, null, base), Date.parse('2026-06-19T09:00:00Z'), 'daily cron -> next matching UTC minute');
  A.eq(cron.nextFireAt(daily, cron._internals.iso(Date.parse('2026-06-19T09:00:00Z')), Date.parse('2026-06-19T09:00:00Z')),
    Date.parse('2026-06-20T09:00:00Z'), 'cron advances strictly after the last fire');

  const workHours = cron.parseSchedule('*/15 9-10 * * 1-5', Date.parse('2026-06-19T09:01:00Z')); // Friday
  A.eq(cron.nextFireAt(workHours, null, Date.parse('2026-06-19T09:01:00Z')), Date.parse('2026-06-19T09:15:00Z'), 'cron range/list/step fields match');
}

// ---- 5. planTick: nothing due when nextRunAt is in the future ----
{
  const jobs = [job({ schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(T0 + 3600000) })];
  const r = cron.planTick(jobs, T0);
  A.eq(r.fire.length, 0, 'future nextRunAt -> nothing fires');
  A.eq(r.skipped.length, 0, 'future nextRunAt -> nothing skipped');
}

// ---- 6. planTick: an interval job due exactly on time fires once and advances ----
{
  const now = T0 + 3600000;
  const jobs = [job({ schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(now) })];
  const r = cron.planTick(jobs, now);
  A.eq(r.fire.length, 1, 'due interval job fires');
  A.eq(r.fire[0].jobId, 'j1', 'the right job fires');
  A.eq(r.next.length, 1, 'a due fire advances next');
  A.eq(r.next[0].nextAt, now + 3600000, 'advanced to now + period');
  A.eq(r.skipped.length, 0, 'an on-time fire is not a skip');
}

// ---- 7. AT-MOST-ONCE across a simulated crash: fire -> persist advance -> "restart" same now -> no double-fire ----
{
  const now = T0 + 3600000;
  const j = job({ schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(now) });
  const r1 = cron.planTick([j], now);
  A.eq(r1.fire.length, 1, 'first tick fires');
  // host persists the advance BEFORE launching the run; simulate that, then re-plan at the SAME now (crash/restart)
  j.nextRunAt = cron._internals.iso(r1.next[0].nextAt);
  const r2 = cron.planTick([j], now);
  A.eq(r2.fire.length, 0, 'after advance-before-run, a restart at the same instant does NOT double-fire');
}

// ---- 8. NO-BACKLOG + MISFIRE POLICY: a recurring job stale beyond grace fast-forwards, then the policy
//         decides whether the missed occurrence still runs ONCE (fire_once) or is dropped (skip) ----
{
  // every 60m -> grace = clamp(30m, 2m, 2h) = 30m. Make it late by 3h (way past grace).
  // A 60m interval is a SLOW interval (>= 1h), so its DEFAULT misfire is fire_once: one catch-up run.
  const now = T0 + 10 * 3600000;
  const jobs = [job({ schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(now - 3 * 3600000) })];
  const r = cron.planTick(jobs, now);
  A.eq(r.fire.length, 1, 'stale slow interval fires ONE catch-up (fire_once default), never a backlog burst');
  A.eq(r.skipped.length, 0, 'the catch-up run is not also a skip');
  A.eq(r.next.length, 1, 'stale job is fast-forwarded');
  A.ok(r.next[0].nextAt > now, 'fast-forwarded to a FUTURE occurrence');
  A.ok(r.next[0].nextAt - now <= 3600000, 'fast-forwarded to the NEXT future occurrence (within one period)');

  // explicit misfire:'skip' opts out of the catch-up (the pre-policy behavior).
  const jSkip = job({ schedule: { kind: 'interval', minutes: 60 }, misfire: 'skip', nextRunAt: cron._internals.iso(now - 3 * 3600000) });
  const rSkip = cron.planTick([jSkip], now);
  A.eq(rSkip.fire.length, 0, 'misfire:skip -> stale-beyond-grace does NOT fire');
  A.eq(rSkip.skipped.length, 1, 'misfire:skip -> stale job is skipped...');
  A.eq(rSkip.skipped[0].reason, 'caught-up', '...with reason caught-up');

  // a FAST interval (< 1h) defaults to skip: a stale poll is worthless by the next one.
  const jFast = job({ schedule: { kind: 'interval', minutes: 5 }, nextRunAt: cron._internals.iso(now - 3600000) });
  const rFast = cron.planTick([jFast], now);
  A.eq(rFast.fire.length, 0, 'fast interval defaults to misfire:skip (no stale poll catch-up)');
  A.eq(rFast.skipped.length, 1, 'fast interval stale occurrence is skipped');

  // explicit misfire:'fire_once' on a FAST interval overrides the skip default.
  const jFastOnce = job({ schedule: { kind: 'interval', minutes: 5 }, misfire: 'fire_once', nextRunAt: cron._internals.iso(now - 3600000) });
  const rFastOnce = cron.planTick([jFastOnce], now);
  A.eq(rFastOnce.fire.length, 1, 'misfire:fire_once on a fast interval fires ONE catch-up');

  // a CRON schedule (daily work) defaults to fire_once: opening the app at 12:01 still runs the 9:00 routine.
  const dueAt = Date.parse('2026-06-19T09:00:00Z');
  const late = dueAt + 3 * 3600000 + 60000;                         // checked at 12:01 — way past grace
  const jDaily = job({ schedule: cron.parseSchedule('0 9 * * *', T0), nextRunAt: cron._internals.iso(dueAt) });
  const rDaily = cron.planTick([jDaily], late);
  A.eq(rDaily.fire.length, 1, 'missed daily cron fires ONE catch-up by default (fire_once)');
  A.eq(rDaily.fire[0].scheduledFor, dueAt, 'the catch-up is attributed to the missed occurrence');
  A.eq(rDaily.next.length, 1, 'and the schedule is still fast-forwarded to a future occurrence');
  A.ok(rDaily.next[0].nextAt > late, 'fast-forwarded past now (no backlog burst)');
}

// ---- 9. WITHIN-GRACE catch-up: late but inside grace fires exactly once ----
{
  const now = T0 + 5 * 3600000;
  const jobs = [job({ schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(now - 10 * 60000) })]; // 10m late < 30m grace
  const r = cron.planTick(jobs, now);
  A.eq(r.fire.length, 1, 'within-grace lateness fires the catch-up');
  A.eq(r.skipped.length, 0, 'within-grace is not a skip');
}

// ---- 9b. cron jobs fire and advance with the same no-backlog policy as intervals ----
{
  const due = Date.parse('2026-06-19T09:00:00Z');
  const sched = cron.parseSchedule('0 9 * * *', due - 60000);
  const jobs = [job({ schedule: sched, nextRunAt: cron._internals.iso(due) })];
  const r = cron.planTick(jobs, due);
  A.eq(r.fire.length, 1, 'due cron job fires');
  A.eq(r.next.length, 1, 'due cron job advances');
  A.eq(r.next[0].nextAt, Date.parse('2026-06-20T09:00:00Z'), 'daily cron advances to the next day');
}

{
  const due = Date.parse('2026-06-19T09:00:00Z');
  const now = Date.parse('2026-06-19T13:30:00Z');              // 4.5h late > daily cron grace (2h clamp)
  const sched = cron.parseSchedule('0 9 * * *', due - 60000);
  // MISFIRE POLICY: a cron schedule defaults to fire_once — the stale occurrence still runs EXACTLY once
  // (never a backlog burst: one fire, fast-forwarded next). misfire:'skip' restores the drop behavior.
  const jobs = [job({ schedule: sched, nextRunAt: cron._internals.iso(due) })];
  const r = cron.planTick(jobs, now);
  A.eq(r.fire.length, 1, 'stale cron job fires ONE catch-up (fire_once default), not a backlog');
  A.eq(r.skipped.length, 0, 'the catch-up is not also a skip');
  A.eq(r.next[0].nextAt, Date.parse('2026-06-20T09:00:00Z'), 'stale cron job fast-forwards to the next future run');
  const rSkip = cron.planTick([job({ schedule: sched, misfire: 'skip', nextRunAt: cron._internals.iso(due) })], now);
  A.eq(rSkip.fire.length, 0, 'misfire:skip -> stale cron job does not fire');
  A.eq(rSkip.skipped.length, 1, 'misfire:skip -> stale cron job is skipped');
}

// ---- 10. one-shots: fire once when due, then permanently ineligible; disabled jobs ignored ----
{
  const now = T0 + 1000;
  const oneShot = job({ id: 'o1', schedule: { kind: 'once', runAt: T0 }, nextRunAt: cron._internals.iso(T0) });
  let r = cron.planTick([oneShot], now);
  A.eq(r.fire.length, 1, 'a due one-shot fires');
  A.eq(r.next.length, 0, 'a one-shot does not recur (no next)');

  // host marks it run (lastRunAt set) -> never fires again, even though nextRunAt is still in the past
  oneShot.lastRunAt = cron._internals.iso(now);
  r = cron.planTick([oneShot], now + 10000);
  A.eq(r.fire.length, 0, 'a one-shot with lastRunAt set is permanently ineligible');

  const disabled = job({ id: 'd1', enabled: false, schedule: { kind: 'interval', minutes: 1 }, nextRunAt: cron._internals.iso(T0 - 1000) });
  A.eq(cron.planTick([disabled], now).fire.length, 0, 'disabled job is ignored (never fires)');
}

// ---- 11. dueJobs is the no-backlog pair (fire + advanced) over planTick ----
{
  const now = T0 + 3600000;
  const jobs = [job({ schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(now) })];
  const d = cron.dueJobs(jobs, now);
  A.eq(d.fire.length, 1, 'dueJobs exposes the fire set');
  A.eq(d.advanced.length, 1, 'dueJobs exposes the advanced next-fire (paired with fire)');
  A.eq(d.advanced[0].nextAt, now + 3600000, 'advanced = now + period');
}

// ---- 12. DETERMINISM: same (jobs, now) -> byte-identical plan (the replay-test invariant) ----
{
  const mk = () => [
    job({ id: 'a', schedule: { kind: 'interval', minutes: 60 }, nextRunAt: cron._internals.iso(T0) }),
    job({ id: 'b', schedule: { kind: 'interval', minutes: 30 }, nextRunAt: cron._internals.iso(T0 - 5 * 3600000) }),
    job({ id: 'c', schedule: { kind: 'once', runAt: T0 - 1000 }, nextRunAt: cron._internals.iso(T0 - 1000) })
  ];
  const a = cron.planTick(mk(), T0);
  const b = cron.planTick(mk(), T0);
  A.eq(JSON.stringify(a), JSON.stringify(b), 'planTick is byte-identical for identical inputs');
}

// ---- 13. clock-INJECTED end to end: advance the fake clock and watch a job become due ----
{
  const c = makeClock(T0);
  const sched = cron.parseSchedule('every 1h', c.now());
  const j = job({ schedule: sched, nextRunAt: cron._internals.iso(cron.nextFireAt(sched, null, c.now())) });
  A.eq(cron.planTick([j], c.now()).fire.length, 0, 'not due at t0');
  c.advance(3600000);
  A.eq(cron.planTick([j], c.now()).fire.length, 1, 'due after advancing the injected clock one period');
}

// ---- isFireable validates the schedule can PRODUCE a time (bug-sweep 2026-08-28) ----
{
  A.eq(cron.isFireable({ kind: 'interval', minutes: 60 }), true, 'a sane interval is fireable');
  A.eq(cron.isFireable({ kind: 'interval', minutes: NaN }), false, 'NaN minutes -> unfireable (was: kind-only pass)');
  A.eq(cron.isFireable({ kind: 'interval', minutes: 0 }), false, 'zero period -> unfireable');
  A.eq(cron.isFireable({ kind: 'once', runAt: 1700000000000 }), true, 'a numeric once runAt is fireable');
  A.eq(cron.isFireable({ kind: 'once', runAt: NaN }), false, 'NaN runAt -> unfireable');
  A.eq(cron.isFireable({ kind: 'cron', expr: 'garbage' }), false, 'an unparseable cron expr -> unfireable');
  A.eq(cron.isFireable(cron.parseSchedule('0 9 * * *', 1700000000000)), true, 'a parsed cron schedule stays fireable');
}

// ---- a NaN-period job can never poison the plan (bug-sweep 2026-08-28) ----
// Before this, { minutes: NaN } sailed past every `p <= 0` guard, pushed { nextAt: NaN } into plan.next,
// and the driver's iso(NaN) advance THREW the whole tick out — every routine in the store stopped firing.
{
  const good = { id: 'g', enabled: true, schedule: { kind: 'interval', minutes: 1 }, nextRunAt: new Date(1700000000000).toISOString() };
  const bad = { id: 'b', enabled: true, schedule: { kind: 'interval', minutes: NaN }, nextRunAt: new Date(1700000000000).toISOString() };
  const plan = cron.planTick([bad, good], 1700000000000 + 60000);
  A.eq(plan.next.every(nx => isFinite(nx.nextAt)), true, 'no NaN advance ever reaches the plan');
  A.eq(plan.fire.some(f => f.jobId === 'g'), true, 'the healthy job still plans to fire alongside the corrupt one');
  A.eq(plan.fire.some(f => f.jobId === 'b'), false, 'the corrupt job is excluded, not exploded');
}

// ---- backwards clock: a future-stamped in-flight one-shot stays suppressed (bug-sweep 2026-08-28) ----
// An NTP step back made now < heartbeatAt/fireClaim; the old `age >= 0 &&` guards then treated a genuinely
// in-flight one-shot as due and DOUBLE-FIRED it across a restart. A negative age is unambiguously not stale.
{
  const T = 1700000000000;
  const j = { id: 'o', enabled: true, schedule: { kind: 'once', runAt: T }, nextRunAt: new Date(T).toISOString(),
    lastRunAt: null, fireClaim: T + 120000, heartbeatAt: T + 120000 };   // stamped 2min in the "future"
  const plan = cron.planTick([j], T + 60000, { maxRunMs: 480000 });      // clock stepped back below the stamps
  A.eq(plan.fire.length, 0, 'a future-stamped (clock-rewind) in-flight one-shot is NOT re-fired');
}

// ---- CRON SEARCH STALL (bug-sweep 2026-08-28): impossible dates answer instantly, sparse dates skip days ----
{
  const T = 1700000000000;   // 2023-11-14T22:13:20Z
  // 1. an impossible-but-well-formed dom/month combo returns null WITHOUT the 2.6M-step scan.
  //    Pre-fix this pair cost multiple SECONDS of synchronous Intl calls straight from POST /api/cron.
  const t0 = Date.now();
  A.eq(cron.parseSchedule('0 0 30 2 *', T), null, 'Feb 30 is rejected at parse (never a stored dead routine)');
  A.eq(cron.parseSchedule('0 0 31 4 *', T), null, 'Apr 31 is rejected at parse');
  A.eq(cron._internals.nextCronFireAt({ kind: 'cron', expr: '0 0 30 2 *' }, T, 'UTC'), null, 'a stored Feb-30 record computes null');
  const impossibleMs = Date.now() - t0;
  A.ok(impossibleMs < 1000, 'the impossible-date rejection is instant (took ' + impossibleMs + 'ms; pre-fix: seconds)');
  A.eq(cron.isFireable({ kind: 'cron', expr: '0 0 30 2 *' }), false, 'an impossible-date cron is visibly unfireable, not idle-forever');
  A.eq(cron.isFireable({ kind: 'cron', expr: '0 0 29 2 *' }), true, 'Feb 29 stays fireable (leap years exist)');

  // 2. Feb 29 is FOUND (the day-skip must not skip the one matching date) — and found fast.
  const t1 = Date.now();
  const leap = cron._internals.nextCronFireAt({ kind: 'cron', expr: '0 0 29 2 *' }, T, 'UTC');
  const leapMs = Date.now() - t1;
  A.eq(leap, Date.UTC(2024, 1, 29, 0, 0), 'the next Feb 29 after 2023-11 is 2024-02-29T00:00Z');
  A.ok(leapMs < 2000, 'the leap-day search completes quickly (took ' + leapMs + 'ms; pre-fix: minute-grind)');

  // 3. both dom AND dow restricted = OR semantics — the dow leg keeps an "impossible" dom feasible.
  const orNext = cron._internals.nextCronFireAt({ kind: 'cron', expr: '0 0 30 2 1' }, T, 'UTC');
  A.eq(orNext, Date.UTC(2024, 1, 5), 'Feb-30-or-Monday fires the first February Monday (the OR leg is never starved by the feasibility check)');

  // 4. EQUIVALENCE vs a brute-force minute scan (UTC): the day-skip may change SPEED, never the answer.
  const brute = (schedule, anchor, days) => {
    const f = schedule.fields, hasv = (a, v) => a.indexOf(v) >= 0;
    const end = anchor + days * 86400000;
    for (let t = Math.floor(anchor / 60000) * 60000 + 60000; t <= end; t += 60000) {
      const d = new Date(t);
      if (!hasv(f.minute, d.getUTCMinutes()) || !hasv(f.hour, d.getUTCHours()) || !hasv(f.month, d.getUTCMonth() + 1)) continue;
      const dom = hasv(f.dayOfMonth, d.getUTCDate()), dow = hasv(f.dayOfWeek, d.getUTCDay());
      if ((!schedule.dayOfMonthWildcard && !schedule.dayOfWeekWildcard) ? (dom || dow) : (dom && dow)) return t;
    }
    return null;
  };
  const exprs = ['0 9 * * *', '*/15 * * * *', '0 0 1 * *', '30 14 15 6 *', '0 8 * * 1', '0 0 13 * 5', '5 4 31 1,3,5 *'];
  const anchors = [T, T + 37 * 3600000, T + 400 * 86400000 + 12345678];
  for (const e of exprs) for (const a of anchors) {
    const sched = cron.parseSchedule(e, a);
    A.ok(sched && sched.kind === 'cron', 'parsed ' + e);
    A.eq(cron._internals.nextCronFireAt(sched, a, 'UTC'), brute(sched, a, 400), 'day-skip answer == brute minute scan for "' + e + '" @ +' + Math.round((a - T) / 3600000) + 'h');
  }

  // 5. day-skip + DST gap on the MATCHING day: "30 2 8 3 *" in America/New_York — the scan skips
  //    Jan..Mar-7 day-by-day, then Mar 8 2026 is the spring-forward day and 02:30 sits IN the gap →
  //    policy fires the post-transition equivalent 03:30 EDT (07:30Z). Proves the jump never lands past
  //    a day boundary and the gap detector still sees adjacent minutes where it matters.
  const gap = cron._internals.nextCronFireAt({ kind: 'cron', expr: '30 2 8 3 *', tz: 'America/New_York' }, Date.UTC(2026, 0, 1), 'America/New_York');
  A.eq(gap, Date.UTC(2026, 2, 8, 7, 30), 'a gap-swallowed sparse-date fire lands at its post-transition equivalent (03:30 EDT)');
}

A.report('cron');
