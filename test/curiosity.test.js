/* node test/curiosity.test.js — the pure just-in-time curiosity engine (frontend/app/curiosity.js).
   Locks the anti-nag promises: pick() asks about the first still-blank, not-dismissed dimension in
   canonical order; respects the per-session cap; stays silent when everything is known or dismissed; and
   hydrate() rebuilds the persisted dismissals defensively. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const C = require('../frontend/app/curiosity.js');

/* ---------- pick: first blank, not-dismissed, canonical order ---------- */
A.eq(C.pick({ blank: ['identity', 'stack'], dismissed: {}, count: 0, cap: 1 }), 'identity', 'asks the first blank dimension');
A.eq(C.pick({ blank: ['stack', 'goals'], dismissed: {}, count: 0, cap: 1 }), 'stack', 'order follows the blank list');
A.eq(C.pick({ blank: ['identity', 'stack'], dismissed: { identity: true }, count: 0, cap: 1 }), 'stack', 'skips a dismissed dimension');

/* ---------- silence cases ---------- */
A.eq(C.pick({ blank: [], dismissed: {}, count: 0, cap: 1 }), null, 'stays quiet when nothing is blank (all known)');
A.eq(C.pick({ blank: ['identity'], dismissed: { identity: true }, count: 0, cap: 1 }), null, 'stays quiet when the only blank is dismissed');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 1, cap: 1 }), null, 'stays quiet once the session cap is reached');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 5, cap: 1 }), null, 'stays quiet past the cap');

/* ---------- cap is honored / configurable ---------- */
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 2 }), 'identity', 'asks while under a higher cap');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0 }), 'identity', 'defaults to the built-in cap when unspecified');
A.eq(C.CAP, 1, 'the default cap is one nudge per session (anti-nag)');

/* ---------- defensive inputs ---------- */
A.eq(C.pick({}), null, 'no options → quiet, never throws');
A.eq(C.pick({ blank: null, dismissed: null }), null, 'malformed inputs → quiet, never throws');

/* ---------- WORK-EARNED ask floor (beat-fat trim 2026-07-03): no get-to-know-you question until the
   station has completed MIN_WORK real task-runs this session — an unearned ask reads as pre-generated ---------- */
A.eq(C.MIN_WORK, 3, 'the earned-ask floor is three task-runs per session');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1, work: 0 }), null, 'zero work done → the ask is unearned (quiet)');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1, work: 2 }), null, 'under the work floor → still quiet');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1, work: 3 }), 'identity', 'at the work floor → the ask is earned');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1, work: 9 }), 'identity', 'past the floor → asks normally');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1, work: 1, minWork: 1 }), 'identity', 'minWork is configurable');
// absent/non-finite work = unknown caller → fail-open (no gate); the live store always passes a real counter
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1 }), 'identity', 'absent work → no gate (fail-open for pure callers)');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 0, cap: 1, work: 'x' }), 'identity', 'non-finite work → no gate (never throws)');
// the earned floor composes with, never replaces, the other silences
A.eq(C.pick({ blank: ['identity'], dismissed: {}, count: 1, cap: 1, work: 5 }), null, 'earned work does not override the session cap');
A.eq(C.pick({ blank: [], dismissed: {}, count: 0, cap: 1, work: 5 }), null, 'earned work does not conjure a question when nothing is blank');

/* ---------- source-lock: the live wiring actually passes/banks the work counter, and the whole gentle
   post-run chain (suggestion → seed → curiosity) stands down until the ask is earned ---------- */
{
  const fsw = require('fs'), pathw = require('path');
  const storeSrc = fsw.readFileSync(pathw.join(__dirname, '../frontend/app/curiositystore.js'), 'utf8');
  A.ok(/function noteWork/.test(storeSrc) && /workCount\+\+/.test(storeSrc), 'CuriosityStore.noteWork banks a completed task-run');
  A.ok(/work:\s*workCount/.test(storeSrc), 'CuriosityStore.consider passes the live work counter into pick()');
  A.ok(/function earned/.test(storeSrc), 'CuriosityStore.earned exposes the floor to the beat chain');
  const chatSrcW = fsw.readFileSync(pathw.join(__dirname, '../frontend/app/chat.js'), 'utf8');
  // RECOMMENDATION SPINE: the gentle chain is now staged as candidates inside ONE collection pass, so the
  // earned-work floor is asserted where it lives — before any gentle candidate is built at all.
  const iPassW = chatSrcW.indexOf('async function recommendPass');
  const iGate = chatSrcW.indexOf('CuriosityStore.earned && !CuriosityStore.earned()', iPassW);
  const iSuggestW = chatSrcW.indexOf('suggestCandidate()', iPassW);
  A.ok(iPassW > 0, 'chat.js drives ONE post-run collection pass');
  A.ok(iGate > 0, 'chat.js gates the gentle post-run chain on the earned-work floor');
  A.ok(iSuggestW > iGate, 'the earn gate sits BEFORE any gentle candidate — no unsolicited idea until work earned it');
  A.ok(chatSrcW.indexOf('CuriosityStore.noteWork()') > 0 && chatSrcW.indexOf('CuriosityStore.noteWork()') < iGate, 'a task-run banks work before the gate reads it');
}

/* ---------- stop-forever after ASK_LIMIT ignored asks (the "same question over and over" fix) ---------- */
A.eq(C.ASK_LIMIT, 2, 'the stop-forever ceiling is two unanswered asks');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, asked: { identity: 1 }, count: 0, cap: 1 }), 'identity', 'still asks at one prior unanswered ask (under the limit)');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, asked: { identity: 2 }, count: 0, cap: 1 }), null, 'stops for good once asked-and-ignored to the limit');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, asked: { identity: 5 }, count: 0, cap: 1 }), null, 'stays stopped past the limit');
A.eq(C.pick({ blank: ['identity', 'stack'], dismissed: {}, asked: { identity: 2 }, count: 0, cap: 1 }), 'stack', 'an exhausted dimension is skipped — the next live one is offered');
A.eq(C.pick({ blank: ['identity'], dismissed: {}, asked: { identity: 1 }, count: 0, cap: 1, askLimit: 1 }), null, 'askLimit is configurable');
A.eq(C.exhausted('identity', { identity: true }, {}, 2), true, 'exhausted: a dismissed dim is worn out');
A.eq(C.exhausted('identity', {}, { identity: 2 }, 2), true, 'exhausted: an asked-to-limit dim is worn out');
A.eq(C.exhausted('identity', {}, { identity: 1 }, 2), false, 'exhausted: under the limit is still live');

/* ---------- fresh + hydrate ---------- */
A.eq(C.fresh(), { v: 1, dismissed: {}, asked: {} }, 'fresh() is empty dismissal + asked sets');
A.eq(C.hydrate(null).dismissed, {}, 'hydrate(null) → empty');
A.eq(C.hydrate(null).asked, {}, 'hydrate(null) → empty asked');
A.eq(C.hydrate('garbage').dismissed, {}, 'hydrate of garbage → empty');
A.eq(C.hydrate({ dismissed: { stack: true, x: false } }).dismissed, { stack: true }, 'hydrate keeps only truthy dismissals');
A.eq(C.hydrate({ asked: { stack: 2, bad: 0, junk: 'x', neg: -3 } }).asked, { stack: 2 }, 'hydrate keeps only positive integer ask counts');
// a hydrated dismissal actually suppresses the nudge
const st = C.hydrate({ dismissed: { identity: true } });
A.eq(C.pick({ blank: ['identity', 'stack'], dismissed: st.dismissed, count: 0, cap: 1 }), 'stack', 'a hydrated dismissal is honored by pick');
// a hydrated asked-count actually suppresses the nudge
const sa = C.hydrate({ asked: { identity: 2 } });
A.eq(C.pick({ blank: ['identity', 'stack'], dismissed: {}, asked: sa.asked, count: 0, cap: 1 }), 'stack', 'a hydrated asked-to-limit count is honored by pick');

/* ---------- source-lock: the ASKED counter must reflect IGNORES only — every ANSWER path clears it ---------- */
// curiositystore + dossierstore are browser-coupled IIFEs (localStorage / live globals), so — like newhero-reset.test.js
// — we lock the wiring at the source: markAnswered exists + clears the dim, and DossierStore.upsert (the chokepoint
// EVERY answer flows through: curiosity nudge, full interview, onboarding, manual +add) calls it.
const fs = require('fs'), path = require('path');
const csSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/curiositystore.js'), 'utf8');
A.ok(/function markAnswered/.test(csSrc) && /delete\s+state\.asked\[/.test(csSrc), 'CuriosityStore.markAnswered clears the dimension ask count');
A.ok(/markAnswered\b/.test(csSrc.slice(csSrc.lastIndexOf('return {'))), 'markAnswered is exported from CuriosityStore');
const dsSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/dossierstore.js'), 'utf8');
const upsertSeg = dsSrc.slice(dsSrc.indexOf('function upsert'), dsSrc.indexOf('function forget'));
A.ok(/CuriosityStore\.markAnswered\(/.test(upsertSeg), 'DossierStore.upsert clears the curiosity ask tally on EVERY answer path (not just the nudge)');

/* ---------- VOI order: pick asks the highest-value dimension first, gates unchanged ---------- */
// order re-ranks the blank dims (the understanding engine's weight × gap ranking, best first)
A.eq(C.pick({ blank: ['identity', 'stack', 'ambition'], dismissed: {}, asked: {}, count: 0, cap: 1, order: ['ambition', 'pain', 'identity'] }),
  'ambition', 'order aims the ask at the highest value-of-information dimension');
// a dim missing from order falls back AFTER the ordered ones, in canonical position (never unaskable)
A.eq(C.pick({ blank: ['stack', 'style'], dismissed: {}, asked: {}, count: 0, cap: 1, order: ['ambition', 'style'] }),
  'style', 'ordered dims come first; unordered dims still follow canonically');
A.eq(C.pick({ blank: ['stack', 'style'], dismissed: {}, asked: {}, count: 0, cap: 1, order: ['ambition'] }),
  'stack', 'when no blank dim is in the order, canonical order is preserved');
// every gate still applies over the re-ordered list
A.eq(C.pick({ blank: ['identity', 'ambition'], dismissed: { ambition: true }, asked: {}, count: 0, cap: 1, order: ['ambition', 'identity'] }),
  'identity', 'a dismissed dim is skipped even when it tops the VOI order');
A.eq(C.pick({ blank: ['identity', 'ambition'], dismissed: {}, asked: { ambition: 2 }, count: 0, cap: 1, order: ['ambition', 'identity'] }),
  'identity', 'a stop-forever dim is skipped even when it tops the VOI order');
A.eq(C.pick({ blank: ['ambition'], dismissed: {}, asked: {}, count: 0, cap: 1, order: ['ambition'], work: 1, minWork: 3 }),
  null, 'the earned-work floor still silences an ordered ask');
A.eq(C.pick({ blank: ['ambition'], dismissed: {}, asked: {}, count: 1, cap: 1, order: ['ambition'] }),
  null, 'the session cap still silences an ordered ask');

/* ---------- V3 §7 HUNT MODE — hungrier below the readiness gate, same Commander-signal protections ---------- */
A.eq(C.pick({ blank: ['goals'], dismissed: {}, asked: {}, count: 0, work: 0, hunting: true }),
  'goals', 'hunting waives the earned-work floor (the gap is the earning)');
A.eq(C.pick({ blank: ['goals'], dismissed: {}, asked: {}, count: 1, work: 9, hunting: true }),
  'goals', 'hunting doubles the session budget (cap 2)');
A.eq(C.pick({ blank: ['goals'], dismissed: {}, asked: {}, count: 2, work: 9, hunting: true }),
  null, 'the hunt budget is still a hard cap — never unbounded');
A.eq(C.pick({ blank: ['goals'], dismissed: { goals: true }, asked: {}, count: 0, hunting: true }),
  null, 'a DISMISSED dim stays dead even while hunting (never re-ask a rejection)');
A.eq(C.pick({ blank: ['goals'], dismissed: {}, asked: { goals: 2 }, count: 0, hunting: true }),
  null, 'the asked-and-ignored stop-forever holds while hunting');
A.eq(C.HUNT_CAP, 2, 'the hunt budget is a named, tested constant');

A.report('curiosity.test');
