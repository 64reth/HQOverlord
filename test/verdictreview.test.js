/* node test/verdictreview.test.js — the consistency loop's slice 1 (sidecar/verdictreview.js + skillreview.js).
   Ratchet: a Commander `ok`/`miss` verdict on a SMALL run MUST earn a skill review (the 08-17 law — a background
   pass owes a test that proves it FIRES); `great` never spends a packet; a packet is taken once; the packet store is
   bounded (cap + TTL); the review prompt carries the verdict and the Commander's own correction. */
'use strict';
const A = require('./_assert.js');
const { makeVerdictReview, VERDICTS_THAT_TEACH } = require('../sidecar/verdictreview.js');
const SR = require('../sidecar/skillreview.js');

/* ---------- the gate: verdict beats size ---------- */
const tiny = { reason: 'done', turns: 1, messages: [{ role: 'user', content: 'brief me' }, { role: 'assistant', content: 'ok' }] };
A.eq(SR.shouldReviewRun(tiny), false, 'a tiny run earns no size-review (unchanged)');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'miss' }), true, 'RATCHET: a tiny run rated miss earns a review');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'ok' }), true, 'a tiny run rated ok (close) earns a review');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'great' }), false, 'praise is not a lesson: great never triggers by itself');
A.eq(SR.shouldReviewRun({ reason: 'error', turns: 1, messages: [] }, { verdict: 'miss' }), false, 'a failed run is the failure review\'s job, not this one');
A.eq(SR.shouldReviewRun(tiny, { verdict: 'miss', enabled: false }), false, 'the enabled=false kill switch still wins');

/* ---------- the prompt: verdict + correction ride in ---------- */
const p = SR.buildPrompt({ verdict: 'miss', correction: '  shorter,   bullets only  ', messages: tiny.messages });
A.ok(p.indexOf('COMMANDER VERDICT ON THIS RUN: MISSED the mark') !== -1, 'a miss is named as a miss');
A.ok(p.indexOf('in their words: "shorter, bullets only"') !== -1, 'the correction is quoted verbatim, whitespace collapsed');
A.ok(p.indexOf('NEXT run of this class of task does not repeat') !== -1, 'the reviewer is given the one job');
const pOk = SR.buildPrompt({ verdict: 'ok', messages: tiny.messages });
A.ok(pOk.indexOf('CLOSE, but short of the mark') !== -1 && pOk.indexOf('No written correction') !== -1, 'ok without a correction says so honestly');
A.eq(SR.buildPrompt({ verdict: 'great', messages: tiny.messages }).indexOf('COMMANDER VERDICT'), -1, 'a great verdict adds no block');
A.eq(SR.buildPrompt({ messages: tiny.messages }).indexOf('COMMANDER VERDICT'), -1, 'a size-triggered review is byte-identical in shape (no block)');
A.ok(SR.buildPrompt({ verdict: 'miss', correction: 'x'.repeat(2000), messages: [] }).indexOf('x'.repeat(601)) === -1, 'a correction is capped at 600 chars');

/* ---------- the packet store ---------- */
let t = 1000;
const vr = makeVerdictReview({ cap: 3, ttlMs: 500, now: () => t });
A.eq(vr.stash('', {}), false, 'no runId → no packet');
A.eq(vr.stash('r1', null), false, 'no packet → nothing stored');
A.eq(vr.stash('r1', { agentId: 'a' }), true, 'a packet parks');
A.eq(vr.shouldTrigger('r1', 'great'), false, 'great never triggers');
A.eq(vr.take('r1', 'great'), null, 'great never takes the packet');
A.eq(vr.has('r1'), true, '…and the packet is still there for a later honest verdict');
A.eq(vr.shouldTrigger('r1', 'miss'), true, 'miss triggers');
A.eq(vr.shouldTrigger('nope', 'miss'), false, 'an unknown run never triggers');
const got = vr.take('r1', 'miss');
A.eq(got && got.agentId, 'a', 'take returns the packet');
A.eq(vr.take('r1', 'miss'), null, 'taken ONCE — a second verdict on the same run reviews nothing');
// cap: oldest evicted
vr.stash('a', {}); vr.stash('b', {}); vr.stash('c', {}); vr.stash('d', {});
A.eq(vr.size(), 3, 'cap holds');
A.eq(vr.has('a'), false, 'the oldest packet is the one evicted');
A.eq(vr.has('d'), true, 'the newest survives');
// re-stash moves to newest
vr.stash('b', { v: 2 }); vr.stash('e', {});
A.eq(vr.has('c'), false, 're-stashing b made c the oldest → evicted');
A.eq(vr.take('b', 'ok').v, 2, 'a re-stash replaces the packet (latest state wins)');
// ttl
t += 501;
A.eq(vr.has('d'), false, 'a packet past its TTL is gone (a day-old verdict never reviews against a moved skillbase)');
A.eq(vr.size(), 0, 'sweep drains everything stale');
A.ok(VERDICTS_THAT_TEACH.has('ok') && VERDICTS_THAT_TEACH.has('miss') && !VERDICTS_THAT_TEACH.has('great'), 'the teaching set is exactly ok+miss');

/* ---------- slice 2: correction grace (fake timers, injected) ---------- */
{
  const timers = []; let tick = 0;
  const fakeSet = (fn, ms) => { const h = { fn, ms, id: ++tick, live: true }; timers.push(h); return h; };
  const fakeClear = (h) => { if (h) h.live = false; };
  const runTimers = () => { for (const h of timers.splice(0)) if (h.live) h.fn(); };
  const fired = [];
  const g = makeVerdictReview({ now: () => 1, graceMs: 5000, setTimeout: fakeSet, clearTimeout: fakeClear });
  g.stash('r1', { agentId: 'a' }); g.stash('r2', { agentId: 'a' }); g.stash('r3', { agentId: 'a' });
  A.eq(g.arm('r1', 'great', j => fired.push(j)), false, 'great never arms');
  A.eq(g.arm('r1', 'miss', null), false, 'no fire fn → no arm');
  A.eq(g.arm('r1', 'miss', j => fired.push(j)), true, 'a miss arms a held review');
  A.eq(fired.length, 0, 'RATCHET: the review does NOT fire on the verdict alone — it waits for the correction');
  A.eq(g.holding('r1'), true, 'held');
  A.eq(g.arm('r1', 'miss', j => fired.push(j)), false, 'a duplicate verdict never double-arms');
  A.eq(g.correct('r1', 'too long — tighter', false, 'chip').fired, false, 'a chip attaches but keeps waiting');
  A.eq(g.correct('r1', '  shorter, bullets   only ', true, 'message').fired, true, 'the typed message fires NOW');
  A.eq(fired.length, 1, 'exactly one review fired');
  A.eq(fired[0].runId, 'r1', 'with the run id');
  A.eq(fired[0].verdict, 'miss', 'with the verdict');
  A.eq(fired[0].correction, 'shorter, bullets only', 'the typed message REPLACES the chip (their words win), whitespace collapsed');
  A.eq(fired[0].correctionSource, 'message', 'source names the message');
  A.eq(fired[0].firedBy, 'correction', 'fired by the correction');
  A.eq(fired[0].agentId, 'a', 'the packet rides through');
  A.eq(g.holding('r1'), false, 'no longer held');
  A.eq(g.correct('r1', 'again', true).ok, false, 'a correction after firing changes nothing (single-shot)');
  runTimers();
  A.eq(fired.length, 1, 'the cancelled timer never fires a second review');
  // grace expiry with only a chip
  g.arm('r2', 'ok', j => fired.push(j));
  g.correct('r2', 'wrong audience / tone', false, 'chip');
  runTimers();
  A.eq(fired.length, 2, 'the grace timer fires the review');
  A.eq(fired[1].correction, 'wrong audience / tone', 'with the chip as the correction');
  A.eq(fired[1].firedBy, 'grace', 'fired by grace');
  // initial correction from the ratings body, then nothing
  g.arm('r3', 'miss', j => fired.push(j), 'from body');
  runTimers();
  A.eq(fired[2].correction, 'from body', 'a correction carried on the rating body survives to the grace fire');
  A.eq(fired[2].correctionSource, 'verdict', 'source = verdict');
  // graceMs 0 = immediate (the old behaviour, opt-in)
  const g0 = makeVerdictReview({ now: () => 1, graceMs: 0, setTimeout: fakeSet, clearTimeout: fakeClear });
  g0.stash('x', {}); const f0 = []; g0.arm('x', 'miss', j => f0.push(j));
  A.eq(f0.length === 1 && f0[0].firedBy, 'immediate', 'graceMs 0 fires immediately');
  A.eq(makeVerdictReview({ now: () => 1 }).graceMs, 90000, 'default grace is 90s');
}

A.report('verdictreview');
