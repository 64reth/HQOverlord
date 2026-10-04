/* node test/beatcard.test.js — pure COMMS beat lifecycle with a fake clock. */
'use strict';
const A = require('./_assert.js');
const BeatCard = require('../frontend/app/beatcard.js');

function fakeClock() {
  let now = 0, next = 1;
  const jobs = new Map();
  return {
    setTimeout(fn, ms) { const id = next++; jobs.set(id, { at: now + Number(ms || 0), fn }); return id; },
    clearTimeout(id) { jobs.delete(id); },
    tick(ms) {
      const end = now + ms;
      for (;;) {
        let pick = null;
        for (const [id, job] of jobs) if (job.at <= end && (!pick || job.at < pick.job.at || (job.at === pick.job.at && id < pick.id))) pick = { id, job };
        if (!pick) break;
        jobs.delete(pick.id); now = pick.job.at; pick.job.fn();
      }
      now = end;
    }
  };
}

const clock = fakeClock();
const vanished = [];
const ctl = BeatCard.create({
  timers: clock,
  minVisible: 20,   // the MINIMUM VISIBLE AGE, shrunk for the fake clock (production default is 1200ms)
  vanish(node, done) { vanished.push(node && node.id); if (node) node.isConnected = false; if (done) done(); }
});

const study = ctl.claim({ kind: 'study', runId: 'run-1', node: { id: 'study-1', isConnected: true } });
A.ok(study, 'the first offer claims the shared slot');
A.eq(ctl.claim({ kind: 'trust', runId: 'run-1' }), null, 'a simultaneous lower-priority offer cannot stack');
A.eq(ctl.visibleBeat(), 'study', 'exactly one beat is visible');

let ignored = 0;
study.ifCurrent(rec => { rec.onExpire = () => { ignored += 1; }; });
ctl.scheduleExpire('study', 25);
clock.tick(24);
A.eq(ctl.busy(), true, 'the card remains live before its expiry');
clock.tick(1);
A.eq(ignored, 1, 'expiry invokes the feature ignore hook once');
A.eq(vanished[0], 'study-1', 'expiry retires the visible node through the injected vanish path');
A.eq(ctl.visibleBeat(), null, 'expiry releases the shared slot');

const trust = ctl.claim({ kind: 'trust', runId: 'run-2', node: { id: 'trust-2', isConnected: true } });
A.eq(trust.decide(), true, 'the first decision owns the card');
A.eq(trust.decide(), false, 'a second decision is rejected');
A.eq(ctl.expire('trust'), false, 'a decided card cannot be miscounted as ignored');
A.eq(trust.finish({ delay: 40 }), true, 'the decided card arms its vanish');
clock.tick(39);
A.eq(ctl.busy('trust'), true, 'the verdict remains visible during its flash');
clock.tick(1);
A.eq(vanished[1], 'trust-2', 'the decided card vanishes after the verdict flash');
A.eq(ctl.busy(), false, 'decision cleanup releases the active card');

A.eq(ctl.once('study', 'run-3'), true, 'a run is admitted once for its feature');
A.eq(ctl.once('study', 'run-3'), false, 'the same run cannot re-offer that feature');
A.eq(ctl.once('thread', 'run-3'), true, 'the same run may independently feed another feature family');

ctl.reserve('memory', 'run-memory');
A.eq(ctl.canOffer('study'), 'memory', 'an in-flight memory proposal blocks a lower-priority offer');
ctl.releaseReservation('memory', 'run-memory');
A.eq(ctl.canOffer('study'), 'free', 'an empty memory fetch releases the reservation');

/* ── THE SELF-RESERVATION DEADLOCK (regression, 2026-08-04) ───────────────────────────────────────────
   The collection pass reserves BOTH fetch-backed kinds under its own runId so nothing lower can steal the
   slot across the await, then collects both candidates. Before the fix the pass's OWN 'study' reservation
   outranked 'thread', so the thread candidate was vetoed on every single run — threadCandidate always
   returned null, queueThread was never reached and offerThread was unreachable code. A reservation held
   under the caller's own key must be invisible to that caller. */
ctl.reset();
ctl.reserve('study', 'run-pass'); ctl.reserve('thread', 'run-pass');     // exactly what recommendPass does
A.eq(ctl.canOffer('thread'), 'study', 'THE OLD FAILURE: a keyless read still sees the higher-ranked reservation');
A.eq(ctl.canOffer('thread', 'run-pass'), 'free', 'the pass\'s own reservation can never veto its own thread candidate');
A.eq(ctl.canOffer('study', 'run-pass'), 'free', 'nor its own study candidate');
ctl.reserve('memory', 'run-other');
A.eq(ctl.canOffer('thread', 'run-pass'), 'memory', 'a FOREIGN higher-priority reservation still blocks (memory wins)');
ctl.reserve('study', 'run-other');
ctl.releaseReservation('memory', 'run-other');
A.eq(ctl.canOffer('thread', 'run-pass'), 'study', 'another run holding the same kind still blocks — only the SELF key is excused');
ctl.releaseReservation('study', 'run-other');
A.eq(ctl.canOffer('thread', 'run-pass'), 'free', 'releasing the foreign claim frees the pass again');
ctl.reset();

const oldThread = ctl.claim({ kind: 'thread', runId: 'run-old', node: { id: 'thread-old', isConnected: true } });
A.eq(oldThread.decide(), true, 'the old async action starts while its card is current');
let staleFinish = null;
clock.setTimeout(() => { staleFinish = oldThread.finish({ delay: 0 }); }, 10);   // stand-in for a late fetch completion
ctl.reset();
const fresh = ctl.claim({ kind: 'study', runId: 'run-fresh', node: { id: 'study-fresh', isConnected: true } });
A.ok(fresh, 'a fresh COMMS generation may claim the slot');
A.eq(oldThread.isCurrent(), false, 'the old async handle is stale after reset');
clock.tick(100);
A.eq(staleFinish, false, 'a stale async completion cannot schedule cleanup');
A.eq(ctl.visibleBeat(), 'study', 'the stale completion cannot release or replace the fresh card');
A.eq(vanished.indexOf('study-fresh'), -1, 'the fresh card was not touched by stale cleanup');

/* THE STARVE FIX (recommendation spine S2): a sweep armed for one kind must free the slot from whatever
   UNDECIDED card is holding it — the old kind-matched sweep let an unanswered nudge starve every offer. */
ctl.reset();
const stuck = ctl.claim({ kind: 'nudge', runId: 'run-stuck', node: { id: 'nudge-stuck', isConnected: true } });
let nudgeIgnored = 0;
stuck.ifCurrent(rec => { rec.onExpire = () => { nudgeIgnored += 1; }; });
A.eq(ctl.visibleBeat(), 'nudge', 'the gentle aside holds the one slot');
ctl.scheduleExpire('study', 20);            // a NEW task end sweeps the previous moment
clock.tick(20);
A.eq(nudgeIgnored, 1, 'the mismatched holder fires its OWN ignore hook, not the sweeper kind\'s');
A.eq(ctl.visibleBeat(), null, 'a cross-kind sweep frees the slot instead of starving the queue');
A.ok(ctl.claim({ kind: 'study', runId: 'run-after', node: { id: 'study-after', isConnected: true } }),
  'the higher-value offer can now take the freed moment');

// a DECIDED card is still immune — a verdict is never miscounted as an ignore.
ctl.reset();
const answered = ctl.claim({ kind: 'nudge', runId: 'run-answered', node: { id: 'nudge-answered', isConnected: true } });
let answeredIgnored = 0;
answered.ifCurrent(rec => { rec.onExpire = () => { answeredIgnored += 1; }; });
A.eq(answered.decide(), true, 'the Commander answered the aside');
ctl.scheduleExpire('thread', 20);
clock.tick(20);
A.eq(answeredIgnored, 0, 'a decided card is never swept as ignored');
A.eq(ctl.sweepExpire(), false, 'a direct sweep also refuses a decided card');

/* ══ THE RACING SWEEPS (regression, 2026-08-04) ══════════════════════════════════════════════════════
   Every hero run end arms THREE sweeps at the same delay (the study, trust and thread lifecycle wires each
   call scheduleExpire(kind, 900)) and the queue drain fires in that same timer batch. The drain rendered a
   FRESH card between two sweeps; the later sweep then retired it — the Commander saw zero frames — and its
   onExpire tallied an "ignore" against a belief that was never shown. Two of those permanently silence it,
   and markShown had already spent the session cap. A sweep may only retire the card that was holding the
   slot when THAT sweep armed. */
{
  const clk = fakeClock();
  const gone = [];
  const c = BeatCard.create({
    timers: clk, minVisible: 20,
    vanish(node, done) { gone.push(node && node.id); if (node) node.isConnected = false; if (done) done(); }
  });
  let staleIgnored = 0, freshIgnored = 0;
  // the PREVIOUS moment's undecided card, already long visible
  const stale = c.claim({ kind: 'study', runId: 'run-1', node: { id: 'study-stale', isConnected: true } });
  stale.ifCurrent(rec => { rec.onExpire = () => { staleIgnored += 1; }; });
  clk.tick(5000);
  // a new run ends: all three lifecycle wires arm their sweep, and the queue drain is armed alongside them
  c.scheduleExpire('study', 900);
  c.scheduleExpire('trust', 900);
  c.scheduleExpire('thread', 900);
  let fresh = null;
  clk.setTimeout(() => {                                   // stand-in for flushStudyPending's taste path
    fresh = c.claim({ kind: 'study', runId: 'run-2', node: { id: 'study-fresh', isConnected: true } });
    if (fresh) fresh.ifCurrent(rec => { rec.onExpire = () => { freshIgnored += 1; }; });
  }, 900);
  clk.tick(1000);                                          // the whole batch drains in one tick
  A.eq(staleIgnored, 1, 'the card the sweeps ARMED against is retired exactly once (its ignore is real)');
  A.eq(gone.indexOf('study-stale') >= 0, true, 'the stale card vanished');
  A.ok(fresh && fresh.isCurrent(), 'THE FIX: the freshly rendered card survives the other two sweeps in the batch');
  A.eq(freshIgnored, 0, 'a card the Commander never saw a frame of can never tally an ignore');
  A.eq(c.visibleBeat(), 'study', 'the fresh card still owns the one slot');
  A.eq(gone.indexOf('study-fresh'), -1, 'and it was never vanished out from under the Commander');

  // ── S4 IGNORE-TALLY FAIRNESS: even a sweep correctly aimed at a card frees the slot but does NOT tally an
  //    ignore until that card has been visible for the minimum age.
  c.reset();
  let blinkIgnored = 0;
  const blink = c.claim({ kind: 'trust', runId: 'run-3', node: { id: 'trust-blink', isConnected: true } });
  blink.ifCurrent(rec => { rec.onExpire = () => { blinkIgnored += 1; }; });
  c.scheduleExpire('trust', 5);                            // aimed at THIS card, but fires under the visible age
  clk.tick(5);
  A.eq(blinkIgnored, 0, 'a card retired before the minimum visible age is not counted as ignored');
  A.eq(c.visibleBeat(), null, 'the slot is still freed (the queue can never starve behind it)');
  A.eq(c.busy(), false, 'the blink card is gone');

  // …and a card that DID live past the minimum age still tallies its ignore exactly as before.
  let heldIgnored = 0;
  const held = c.claim({ kind: 'thread', runId: 'run-4', node: { id: 'thread-held', isConnected: true } });
  held.ifCurrent(rec => { rec.onExpire = () => { heldIgnored += 1; }; });
  clk.tick(50);
  c.scheduleExpire('thread', 5);
  clk.tick(5);
  A.eq(heldIgnored, 1, 'a card the Commander really did leave undecided still tallies its ignore');

  // a sweep armed while NOTHING held the slot may never retire whatever arrives later
  c.reset();
  c.scheduleExpire('study', 30);
  const later = c.claim({ kind: 'study', runId: 'run-5', node: { id: 'study-later', isConnected: true } });
  clk.tick(60);
  A.ok(later.isCurrent(), 'a sweep armed against an EMPTY slot retires nothing');
}

A.report('beatcard.test');
