/* node test/cron.oneshot.test.js — G4.5: one-shot fire-claim idempotency (at-most-once-within-window).

   A NON-recurring (one-shot) routine must fire AT MOST ONCE even if the process crash-restarts
   while its run is still in flight (before markRun stamps lastRunAt). The advance-before-run trick
   that protects recurring jobs (persist the advanced nextRunAt before launch) has no analog for a
   one-shot — a one-shot has no "next" fire to advance. So we stamp a FIRE-CLAIM at fire time and
   persist it BEFORE launching; planTick then treats a one-shot carrying a FRESH claim (claim age <
   maxRunMs, no settlement) as NOT due, so a crash-restart inside the run window does NOT re-fire.

   The three properties, all headless with an injected clock + injected runOnce:

     · CRASH-IN-WINDOW: a one-shot fires (claim stamped + persisted), then a NEW driver over the SAME
       persisted store at a `now` still INSIDE the window fires ZERO (not re-fired); a `now` PAST the
       maxRunMs ceiling (a ZOMBIE claim from a crashed holder) IS reclaimed and re-fireable.

     · IN-FLIGHT vs SETTLED (the critic-flagged correctness hole): markRun CLEARS / supersedes the
       fireClaim on SETTLEMENT — success OR terminal failure OR transient failure — so the not-due
       guard ONLY suppresses re-fire while the run is ACTUALLY in flight. A run that returns a
       TRANSIENT failure inside the window must RE-ARM via the existing backoff path (NOT be
       suppressed by a stale fireClaim). A settled (terminal success/failure) one-shot does not
       re-fire and its claim is cleared.

     · REGRESSION: recurring jobs (interval / cron) are UNAFFECTED — their advance-before-run path
       is unchanged by the one-shot claim logic. */
'use strict';
const A = require('./_assert.js');
const os = require('node:os');
const realFs = require('node:fs');
const path = require('node:path');
const { makeClock } = require('../shared/clock-rng.js');
const cron = require('../sidecar/cron.js');
const cronStore = require('../sidecar/cron-store.js');
const { makeCronDriver } = require('../sidecar/cron-driver.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');

const T0 = 1700000000000;
const MIN = 60000;
const MAX_RUN = 8 * MIN;                              // the lease / fire-claim ceiling used throughout
const tmpRoot = realFs.mkdtempSync(path.join(os.tmpdir(), 'cron-once-'));
const cleanup = [];
function tmpFile(name) { const f = path.join(tmpRoot, name); cleanup.push(f); return f; }
const iso = ms => new Date(ms).toISOString();

(async function () {

  /* ---- 0. makeJob stamps the additive fireClaim/lastFireAttemptAt fields (null on a fresh job) ---- */
  {
    const once = cronStore.makeJob({ id: 'os0', prompt: 'p', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'os0', now: T0 });
    A.eq(once.fireClaim, null, 'a fresh one-shot has fireClaim:null');
    A.eq(once.lastFireAttemptAt, null, 'a fresh one-shot has lastFireAttemptAt:null');
    A.ok(once.schedule && once.schedule.kind === 'once', 'parsed a once schedule');
  }

  /* ---- 1. planTick suppresses a one-shot carrying a FRESH claim; reclaims a ZOMBIE claim ----
     Pure-math level: no driver, just planTick over a store with a hand-stamped claim. ---- */
  {
    const dueAt = T0 + 5 * MIN;
    const base = cronStore.makeJob({ id: 'osp', prompt: 'p', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'osp', now: T0 });
    A.eq(base.nextRunAt, iso(dueAt), 'one-shot armed at its runAt');

    // (a) NO claim, due -> fires.
    const planNoClaim = cron.planTick([base], dueAt, { maxRunMs: MAX_RUN });
    A.eq(planNoClaim.fire.length, 1, 'an unclaimed due one-shot is planned to fire');

    // (b) FRESH claim (stamped exactly at the fire instant), still inside the window -> NOT due.
    const claimed = Object.assign({}, base, { fireClaim: dueAt, lastFireAttemptAt: iso(dueAt) });
    const insideWindow = dueAt + MAX_RUN - 1;           // claim age = MAX_RUN-1 < ceiling
    const planFresh = cron.planTick([claimed], insideWindow, { maxRunMs: MAX_RUN });
    A.eq(planFresh.fire.length, 0, 'a one-shot with a FRESH claim is NOT re-fired inside the window');

    // (c) ZOMBIE claim past the ceiling -> reclaimed (re-fireable).
    const pastWindow = dueAt + MAX_RUN + 1;             // claim age = MAX_RUN+1 >= ceiling
    const planZombie = cron.planTick([claimed], pastWindow, { maxRunMs: MAX_RUN });
    A.eq(planZombie.fire.length, 1, 'a one-shot with a ZOMBIE claim (age >= maxRunMs) IS reclaimed and re-fires');

    // (d) a SETTLED one-shot (lastRunAt set) is never re-fired regardless of claim state.
    const settled = Object.assign({}, base, { lastRunAt: iso(dueAt), fireClaim: null });
    A.eq(cron.planTick([settled], pastWindow, { maxRunMs: MAX_RUN }).fire.length, 0, 'a settled one-shot (lastRunAt set) never re-fires');
  }

  /* ---- 2. CRASH-IN-WINDOW end-to-end via the REAL driver + durable persistence ----
     The driver fires a due one-shot; the claim is persisted to disk BEFORE the (never-settling) run.
     A NEW driver over the SAME on-disk store at a `now` still inside the window fires ZERO; a NEW
     driver at a `now` past the ceiling (zombie) fires it again. ---- */
  {
    const jobsFile = tmpFile('once-crash.json');
    const dueAt = T0 + 5 * MIN;
    const once = cronStore.makeJob({ id: 'oc', prompt: 'go', agentId: 'cron_oc', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'oc', now: T0 });
    let store = [once];
    const persist = () => writeFileDurable({ fs: realFs, path: path }, jobsFile, JSON.stringify(cronStore.toEnvelope(store)));
    persist();

    const clock = makeClock(dueAt);
    const never = new Promise(() => {});                // run stays in flight -> finishFire/markRun never runs
    const fired = [];
    const mkDriver = () => makeCronDriver({
      getJobs: () => store,
      setJobs: (j) => { store = j; persist(); },        // claim persisted here, BEFORE the run
      runOnce: () => never,
      emit: (name, payload) => { if (name === 'cron.fire') fired.push(payload); },
      newId: () => 'rid', newAbort: () => new AbortController(), now: () => clock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: MAX_RUN
    });

    const d1 = mkDriver();
    A.eq(d1.applyTick(clock.now()).fired, 1, 'the due one-shot fires exactly once on the first tick');
    A.eq(fired.length, 1, 'one cron.fire emitted');

    // the fire-claim was persisted to disk BEFORE the never-settling run.
    const onDisk = cronStore.loadEnvelope(realFs.readFileSync(jobsFile, 'utf8')).jobs;
    A.eq(onDisk.length, 1, 'store persisted to disk');
    A.eq(onDisk[0].fireClaim, dueAt, 'the fireClaim (= fire instant ms) was persisted before launch');
    A.eq(onDisk[0].lastFireAttemptAt, iso(dueAt), 'lastFireAttemptAt persisted as the ISO fire instant');
    A.eq(onDisk[0].lastRunAt, null, 'lastRunAt is still null (the run never settled — mid-window crash point)');

    // CRASH-RESTART inside the window: a brand-new driver over the SAME on-disk store -> ZERO fires.
    let restartStore = cronStore.loadEnvelope(realFs.readFileSync(jobsFile, 'utf8')).jobs;
    const insideClock = makeClock(dueAt + MAX_RUN - 1);
    const fired2 = [];
    const d2 = makeCronDriver({
      getJobs: () => restartStore, setJobs: (j) => { restartStore = j; },
      runOnce: () => new Promise(() => {}),
      emit: (name, payload) => { if (name === 'cron.fire') fired2.push(payload); },
      newId: () => 'rid2', newAbort: () => new AbortController(), now: () => insideClock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: MAX_RUN
    });
    A.eq(d2.applyTick(insideClock.now()).fired, 0, 'CRASH-RESTART inside the window fires ZERO (fireClaim suppresses re-fire)');
    A.eq(fired2.length, 0, 'no cron.fire on the in-window restart tick');

    // CRASH-RESTART past the ceiling: the claim is a ZOMBIE -> reclaimed and re-fired.
    let zombieStore = cronStore.loadEnvelope(realFs.readFileSync(jobsFile, 'utf8')).jobs;
    const pastClock = makeClock(dueAt + MAX_RUN + 1);
    const fired3 = [];
    const d3 = makeCronDriver({
      getJobs: () => zombieStore, setJobs: (j) => { zombieStore = j; },
      runOnce: () => new Promise(() => {}),
      emit: (name, payload) => { if (name === 'cron.fire') fired3.push(payload); },
      newId: () => 'rid3', newAbort: () => new AbortController(), now: () => pastClock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: MAX_RUN
    });
    A.eq(d3.applyTick(pastClock.now()).fired, 1, 'CRASH-RESTART past maxRunMs RE-FIRES (zombie claim reclaimed)');
    A.eq(fired3.length, 1, 'one cron.fire on the zombie restart tick');
  }

  /* ---- 3. IN-FLIGHT vs SETTLED (the critic case): markRun CLEARS the claim on EVERY settlement ----
     Reducer level: prove markRun clears fireClaim for transient, terminal-success, terminal-failure. ---- */
  {
    const dueAt = T0 + 5 * MIN;
    const mk = () => Object.assign(
      cronStore.makeJob({ id: 'ms', prompt: 'p', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'ms', now: T0 }),
      { fireClaim: dueAt, lastFireAttemptAt: iso(dueAt) }
    );

    // (a) TRANSIENT failure -> claim CLEARED, lastRunAt still null, nextRunAt backed off (re-arm via backoff).
    let jt = cronStore.markRun([mk()], 'ms', { runId: 'r', status: 'error', error: 'net', transient: true }, { now: dueAt + MIN, backoffMs: 90000 });
    const tj = cronStore.getJob(jt, 'ms');
    A.eq(tj.fireClaim, null, 'TRANSIENT settlement CLEARS fireClaim (the run is no longer in flight)');
    A.eq(tj.lastRunAt, null, 'transient does NOT finalize the occurrence (lastRunAt still null)');
    A.eq(tj.nextRunAt, iso(dueAt + MIN + 90000), 'transient backs off nextRunAt');
    A.eq(tj.retryCount, 1, 'transient bumps retryCount');

    // (b) the backed-off one-shot is NOT suppressed by a stale claim: at the backoff time it RE-ARMS / fires.
    const reArmAt = dueAt + MIN + 90000;
    const planReArm = cron.planTick([tj], reArmAt, { maxRunMs: MAX_RUN });
    A.eq(planReArm.fire.length, 1, 'a transient-failed one-shot RE-ARMS via backoff (NOT suppressed by a stale fireClaim)');

    // (c) TERMINAL SUCCESS -> claim CLEARED, occurrence finalized (lastRunAt set, completed, disabled).
    let js = cronStore.markRun([mk()], 'ms', { runId: 'r', status: 'ok', reason: 'done' }, { now: dueAt + MIN });
    const sj = cronStore.getJob(js, 'ms');
    A.eq(sj.fireClaim, null, 'TERMINAL SUCCESS clears fireClaim');
    A.ok(sj.lastRunAt != null, 'terminal success stamps lastRunAt');
    A.eq(sj.enabled, false, 'one-shot disabled after success');
    A.eq(sj.state, 'completed', 'one-shot state completed after success');
    A.eq(cron.planTick([sj], dueAt + MIN, { maxRunMs: MAX_RUN }).fire.length, 0, 'a completed one-shot never re-fires');

    // (d) TERMINAL FAILURE (permanent, retries exhausted via non-transient) -> claim CLEARED, finalized.
    let jf = cronStore.markRun([mk()], 'ms', { runId: 'r', status: 'error', error: 'bad model', transient: false }, { now: dueAt + MIN });
    const fj = cronStore.getJob(jf, 'ms');
    A.eq(fj.fireClaim, null, 'TERMINAL FAILURE clears fireClaim');
    A.ok(fj.lastRunAt != null, 'terminal failure stamps lastRunAt (occurrence consumed)');
    A.eq(fj.enabled, false, 'one-shot disabled after a terminal (non-transient) failure');
    A.eq(cron.planTick([fj], dueAt + MIN, { maxRunMs: MAX_RUN }).fire.length, 0, 'a terminally-failed one-shot never re-fires');
  }

  /* ---- 4. END-TO-END transient re-arm through the REAL driver (in-flight -> settled-transient -> re-fire) ----
     Fire a one-shot, settle it transient inside the window via the driver's finishFire path, then advance
     the clock to the backoff time and assert the SAME driver fires it again (the claim did not wedge it). ---- */
  {
    const dueAt = T0 + 5 * MIN;
    const once = cronStore.makeJob({ id: 'e2e', prompt: 'go', agentId: 'cron_e2e', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'e2e', now: T0 });
    let store = [once];
    const clock = makeClock(dueAt);
    const fired = [];
    let runMode = 'transient';                          // first run settles transient, then we re-fire
    const driver = makeCronDriver({
      getJobs: () => store,
      setJobs: (j) => { store = j; },
      runOnce: ({ emit }) => {
        // settle synchronously so finishFire/markRun runs within applyTick's microtask drain.
        if (runMode === 'transient') return Promise.resolve().then(() => { emit('agent.run.error', { message: 'net', transient: true }); emit('agent.run.end', { reason: 'error' }); });
        return Promise.resolve().then(() => { emit('agent.run.end', { reason: 'done' }); });
      },
      emit: (name, payload) => { if (name === 'cron.fire') fired.push(payload); },
      newId: () => 'rid', newAbort: () => new AbortController(), now: () => clock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: MAX_RUN, backoffMs: 90000
    });

    driver.applyTick(clock.now());
    await Promise.resolve(); await Promise.resolve();   // drain finishFire's .then chain
    A.eq(fired.length, 1, 'one-shot fires once');
    const afterTransient = cronStore.getJob(store, 'e2e');
    A.eq(afterTransient.fireClaim, null, 'after a transient settle the claim is cleared (driver path)');
    A.eq(afterTransient.lastRunAt, null, 'transient did not finalize the one-shot');
    A.ok(afterTransient.nextRunAt != null && Date.parse(afterTransient.nextRunAt) > dueAt, 'nextRunAt backed off into the future');

    // before the backoff time: still not due, no re-fire.
    A.eq(driver.applyTick(dueAt + MIN).fired, 0, 'not re-fired before the backoff time');

    // at the backoff time: re-arms and fires again (claim cleared -> NOT suppressed).
    runMode = 'ok';
    const reArm = Date.parse(afterTransient.nextRunAt);
    clock.set(reArm);
    A.eq(driver.applyTick(reArm).fired, 1, 'a transient-failed one-shot RE-FIRES at the backoff time via the driver');
    await Promise.resolve(); await Promise.resolve();
    A.eq(fired.length, 2, 'two total fires (initial + backoff retry)');
    const done = cronStore.getJob(store, 'e2e');
    A.ok(done.lastRunAt != null && done.state === 'completed', 'the retry succeeds and finalizes the one-shot');
    A.eq(done.fireClaim, null, 'claim cleared after the successful retry');
  }

  /* ---- 4b. NO-CAPABILITY one-shot: a fire-claim is still stamped (so it backs off ~maxRunMs instead of
     hammering every tick), then a ZOMBIE reclaim past the ceiling lets it retry once capability returns.
     This is the safe, explicit policy — a no-capability one-shot is non-firing either way; the claim just
     converts per-tick re-attempts into a bounded backoff, recovered by the zombie reclaim. ---- */
  {
    const dueAt = T0 + 5 * MIN;
    const once = cronStore.makeJob({ id: 'ncap', prompt: 'go', agentId: 'cron_ncap', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'ncap', now: T0 });
    let store = [once];
    const clock = makeClock(dueAt);
    let hasCap = false;
    const fired = [];
    const driver = makeCronDriver({
      getJobs: () => store, setJobs: (j) => { store = j; },
      runOnce: ({ emit }) => Promise.resolve().then(() => { emit('agent.run.end', { reason: 'done' }); }),
      emit: (name, payload) => { if (name === 'cron.fire') fired.push(payload); },
      newId: () => 'rid', newAbort: () => new AbortController(), now: () => clock.now(),
      // model present but credential absent -> fireJob returns false (no-capability), no run launched.
      getKey: () => '', defaultModel: 'm', hasCredential: () => hasCap, maxRunMs: MAX_RUN
    });

    A.eq(driver.applyTick(clock.now()).fired, 0, 'a no-capability one-shot does not fire (no run launched)');
    A.eq(fired.length, 0, 'no cron.fire for the no-capability one-shot');
    A.eq(cronStore.getJob(store, 'ncap').fireClaim, null, 'blocked_config clears the in-flight claim because no run launched');
    A.eq(cronStore.getJob(store, 'ncap').state, 'blocked_config', 'missing capability is a durable visible configuration block');
    A.eq(Date.parse(cronStore.getJob(store, 'ncap').nextRunAt), dueAt + MIN, 'the blocked one-shot receives a bounded recheck time instead of hammering every tick');

    // next tick INSIDE the window: still claimed -> not re-attempted (bounded backoff, not per-tick hammering).
    clock.set(dueAt + MIN);
    A.eq(driver.applyTick(clock.now()).fired, 0, 'inside the window the no-capability one-shot is not re-attempted (claim holds)');

    // PAST the ceiling, capability now present: zombie reclaim -> it fires.
    hasCap = true;
    clock.set(dueAt + MAX_RUN + 1);
    A.eq(driver.applyTick(clock.now()).fired, 1, 'past maxRunMs with capability restored the one-shot fires (zombie reclaim recovers)');
    await Promise.resolve(); await Promise.resolve();
    A.ok(cronStore.getJob(store, 'ncap').lastRunAt != null, 'the recovered run settles + finalizes the one-shot');
  }

  /* ---- 5. REGRESSION: recurring (interval) jobs are UNAFFECTED by the one-shot claim logic ----
     A due interval job still fires once + advances; it carries no fireClaim and the claim guard never
     touches it (the guard is one-shot-only). ---- */
  {
    const period = 10 * MIN;
    const dueAt = T0 + period;
    const iv = cronStore.makeJob({ id: 'rv', prompt: 'tick', schedule: cron.parseSchedule('every 10m', T0) }, { id: 'rv', now: T0 });
    A.eq(iv.fireClaim, null, 'interval job also carries the additive fireClaim:null (additive shape is uniform)');
    const plan = cron.planTick([iv], dueAt, { maxRunMs: MAX_RUN });
    A.eq(plan.fire.length, 1, 'a due interval job still fires (claim guard is one-shot-only)');
    A.eq(plan.next.length, 1, 'a due interval job still advances (advance-before-run intact)');
    A.eq(plan.next[0].nextAt, dueAt + period, 'interval advances exactly one period');
  }

  /* ---- 6. NS-0 HEARTBEAT (one-shot crown jewel): a durable FRESH heartbeat suppresses re-fire REGARDLESS of
     wall-clock claim age, so a long one-shot research run that outlives maxRunMs fires EXACTLY ONCE; a STALE
     heartbeat falls through to the zombie reclaim so a crashed holder is still recovered. Pure planTick level. ---- */
  {
    const dueAt = T0 + 5 * MIN;
    const base = cronStore.makeJob({ id: 'hb1', prompt: 'p', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'hb1', now: T0 });
    // claim + a heartbeat renewed WELL past the old maxRunMs ceiling (the run is genuinely still emitting).
    const farPast = dueAt + 5 * MAX_RUN;                 // claim age = 5×maxRunMs (would be a zombie by claim alone)
    const live = Object.assign({}, base, { fireClaim: dueAt, lastFireAttemptAt: iso(dueAt), heartbeatAt: farPast });
    // heartbeatStaleMs defaults to maxRunMs*1; the heartbeat age is 0 here (fresh) -> NOT re-fired.
    A.eq(cron.planTick([live], farPast, { maxRunMs: MAX_RUN }).fire.length, 0,
      'a one-shot with a FRESH heartbeat is NOT re-fired even though its claim is 5×maxRunMs old (long run fires once)');
    // now the heartbeat goes stale (age > staleMs) AND the claim is a zombie -> reclaimed + re-fires.
    const stale = Object.assign({}, base, { fireClaim: dueAt, lastFireAttemptAt: iso(dueAt), heartbeatAt: dueAt });
    A.eq(cron.planTick([stale], dueAt + MAX_RUN + 1, { maxRunMs: MAX_RUN }).fire.length, 1,
      'a one-shot whose heartbeat is STALE (>staleMs) AND claim zombie IS reclaimed and re-fires (crash recovery)');
    // explicit staleMs knob: a bigger staleMs keeps a modestly-old heartbeat alive (env-tunable).
    A.eq(cron.planTick([stale], dueAt + MAX_RUN + 1, { maxRunMs: MAX_RUN, heartbeatStaleMs: 100 * MAX_RUN }).fire.length, 0,
      'a large heartbeatStaleMs keeps the same heartbeat fresh (the staleness knob is honored)');
  }

  /* ---- 7. NS-0 END-TO-END: the driver renews a one-shot's DURABLE heartbeat on run progress, so a long
     one-shot run that outlives maxRunMs is NOT re-fired by a crash-restart driver at the same store. ---- */
  {
    const dueAt = T0 + 5 * MIN;
    const once = cronStore.makeJob({ id: 'hbe2e', prompt: 'go', agentId: 'cron_hbe2e', schedule: cron.parseSchedule('in 5m', T0) }, { id: 'hbe2e', now: T0 });
    let store = [once];
    const clock = makeClock(dueAt);
    let pulse = null;
    const driver = makeCronDriver({
      getJobs: () => store, setJobs: (j) => { store = j; },
      runOnce: (o) => { o.emit('agent.run.start', { agentId: 'a', runId: o.runId, trigger: 'schedule', model: 'm' }); pulse = () => o.emit('agent.token', { delta: '.' }); return new Promise(() => {}); },
      emit: () => {},
      newId: () => 'rid', newAbort: () => new AbortController(), now: () => clock.now(),
      // durableHeartbeatMs 0 so every pulse persists immediately (test determinism, not throttle-gated).
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: MAX_RUN, durableHeartbeatMs: 0
    });
    driver.applyTick(clock.now());                       // fires; run.start already renewed a durable heartbeat
    A.ok(cronStore.getJob(store, 'hbe2e').heartbeatAt != null, 'the driver persisted a durable heartbeat on run progress');
    // advance past maxRunMs, pulsing each step so the durable heartbeat stays fresh on disk.
    for (let k = 0; k < 4; k++) { clock.advance(MAX_RUN - 1); pulse(); driver.applyTick(clock.now()); }
    // a CRASH-RESTART driver over the SAME on-disk store, now far past the claim's maxRunMs age.
    let restart = store.map(j => Object.assign({}, j));  // snapshot the persisted store (incl. the fresh heartbeat)
    const rClock = makeClock(clock.now());
    const fired = [];
    const d2 = makeCronDriver({
      getJobs: () => restart, setJobs: (j) => { restart = j; },
      runOnce: () => new Promise(() => {}),
      emit: (name, payload) => { if (name === 'cron.fire') fired.push(payload); },
      newId: () => 'rid2', newAbort: () => new AbortController(), now: () => rClock.now(),
      getKey: () => 'sk', defaultModel: 'm', maxRunMs: MAX_RUN
    });
    d2.applyTick(rClock.now());
    A.eq(fired.length, 0, 'a crash-restart sees the FRESH durable heartbeat and does NOT re-fire the long one-shot (exactly-once across restart)');
  }

  // tidy up (best-effort).
  try { for (const f of cleanup) { try { realFs.unlinkSync(f); } catch (_) {} } realFs.rmdirSync(tmpRoot, { recursive: true }); } catch (_) {}

  A.report('cron.oneshot');
})();
