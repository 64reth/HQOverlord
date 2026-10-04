/* node test/halt.test.js — the E-STOP kill logic (sidecar/halt.js). Locks: killAll aborts EVERY browser run
   AND every messaging-hub run, marks hub runs `superseded` BEFORE aborting (so no stale partial reply ships
   after the kill), returns the count, and never throws on null maps or a throwing abort (an E-STOP must not
   fail). The HTTP route /api/halt is verified separately by a live sidecar smoke. */
'use strict';
const A = require('./_assert.js');
const { killAll } = require('../sidecar/halt.js');

function fakeAc() { let aborted = false; return { abort() { aborted = true; }, get aborted() { return aborted; } }; }

/* ---- browser runs only ---- */
{
  const a = fakeAc(), b = fakeAc();
  const n = killAll(new Map([['r1', a], ['r2', b]]), null);
  A.eq(n, 2, 'aborts both browser runs and counts them');
  A.ok(a.aborted && b.aborted, 'both browser controllers aborted');
}

/* ---- browser + hub runs: hub runs are marked superseded BEFORE the abort ---- */
{
  const a = fakeAc();
  const h1 = { abort: fakeAc(), superseded: false };
  const h2 = { abort: fakeAc(), superseded: false };
  const n = killAll(new Map([['r1', a]]), new Map([['c1', h1], ['c2', h2]]));
  A.eq(n, 3, 'counts browser + both hub runs');
  A.ok(a.aborted, 'browser run aborted');
  A.ok(h1.abort.aborted && h2.abort.aborted, 'both hub runs aborted');
  A.ok(h1.superseded && h2.superseded, 'hub runs marked superseded — no stale partial delivered after HALT');
}

/* ---- MULTIPLE hub maps (Telegram + Discord) are all killed in one call ---- */
{
  const a = fakeAc();
  const tg = { abort: fakeAc(), superseded: false };
  const dc = { abort: fakeAc(), superseded: false };
  const n = killAll(new Map([['r1', a]]), new Map([['c1', tg]]), new Map([['c2', dc]]));
  A.eq(n, 3, 'counts browser + telegram + discord hub runs');
  A.ok(a.aborted, 'browser run aborted');
  A.ok(tg.abort.aborted && tg.superseded, 'telegram hub run aborted + superseded');
  A.ok(dc.abort.aborted && dc.superseded, 'discord hub run aborted + superseded');
  A.eq(killAll(null, null, null), 0, 'all-null hub maps -> 0, no throw');
}

/* ---- the E-STOP must be unbreakable: null maps, a throwing abort, a null rec ---- */
{
  A.eq(killAll(null, null), 0, 'null maps -> 0, no throw');
  const boom = { abort() { throw new Error('boom'); } };
  let n;
  A.notThrows(() => { n = killAll(new Map([['r1', boom], ['r2', fakeAc()]]), null); }, 'a throwing abort never propagates out of the E-STOP');
  A.eq(n, 2, 'still counts a run whose abort threw');
  A.notThrows(() => killAll(new Map(), new Map([['c', null]])), 'a null hub rec is tolerated');
}

A.report('halt');
