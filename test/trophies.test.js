/* node test/trophies.test.js — the pure trophy-surface projection (frontend/app/trophies.js).
   Locks the G3b honesty contract: a trophy is a REAL completed quest/milestone (never an open one, never
   invented); its date comes from the durable QuestState memory (completedAt) and a null/0 renders "date
   unknown", NEVER epoch-0/1969; an empty case reports empty:true (honest dust, not placeholders); the
   living-tools shelf lists only seeds that genuinely ran (>0). Pure + deterministic — no clock injected. */
'use strict';
const A = require('./_assert.js');
const T = require('../frontend/app/trophies.js');

const q = (id, kind, status, extra) => Object.assign({ id, kind, status, title: 'T ' + id, reward: 'real work' }, extra || {});

/* ---------- only DONE quests become trophies; open ones are omitted ---------- */
{
  const quests = [q('ms:first_light', 'milestone', 'done'), q('ms:workhorse', 'milestone', 'open'), q('sq:a:dish', 'station-gap', 'done')];
  const dates = { 'ms:first_light': { completedAt: 2000 }, 'sq:a:dish': { completedAt: 3000 } };
  const r = T.build({ quests, stateOf: id => dates[id] || null });
  A.eq(r.earned, 2, 'exactly the two DONE quests are trophies (the open one is omitted)');
  A.eq(r.trophies.map(t => t.id), ['sq:a:dish', 'ms:first_light'], 'newest real completion first (3000 above 2000)');
  A.ok(r.trophies.every(t => t.dateKnown), 'both carry a known date');
  A.eq(r.trophies[0].completedAt, 3000, 'the completedAt is passed through raw for the caller to format');
  A.eq(r.empty, false, 'a case with trophies is not empty');
}

/* ---------- honest dates: null / undefined / 0 all render "date unknown", never 1969 ---------- */
{
  const quests = [q('ms:a', 'milestone', 'done'), q('ms:b', 'milestone', 'done'), q('ms:c', 'milestone', 'done'), q('ms:dated', 'milestone', 'done')];
  const r = T.build({ quests, stateOf: id => ({
    'ms:a': { completedAt: null },
    'ms:b': { completedAt: 0 },          // the pre-fix bug signature — must read as unknown, not epoch
    'ms:c': {},                          // no record of a date at all
    'ms:dated': { completedAt: 5000 }
  }[id]) });
  A.eq(r.earned, 4, 'all four completions are trophies regardless of date knowledge');
  const byId = Object.fromEntries(r.trophies.map(t => [t.id, t]));
  A.eq(byId['ms:a'].completedAt, null, 'a null completedAt stays null (date unknown)');
  A.eq(byId['ms:a'].dateKnown, false, '…and is flagged date-unknown');
  A.eq(byId['ms:b'].completedAt, null, 'a 0 completedAt (bug-window) reads as date unknown, NEVER epoch-0/1969');
  A.eq(byId['ms:c'].dateKnown, false, 'a missing date record is honestly unknown');
  A.eq(byId['ms:dated'].dateKnown, true, 'a real date is known');
  // the one dated trophy sorts ABOVE all three dateless ones (a known honour outranks an undated one)
  A.eq(r.trophies[0].id, 'ms:dated', 'the dated trophy leads; dateless ones sink below it');
  A.eq(r.trophies.slice(1).map(t => t.id), ['ms:a', 'ms:b', 'ms:c'], 'dateless trophies hold a stable (title) order');
}

/* ---------- an empty case is HONEST: empty:true, no fabricated trophies ---------- */
{
  const r = T.build({ quests: [q('ms:x', 'milestone', 'open')], stateOf: () => null, tools: [] });
  A.eq(r.earned, 0, 'no DONE quests → zero trophies (an open quest is never a trophy)');
  A.eq(r.trophies, [], '…and the trophy list is empty');
  A.eq(r.empty, true, 'the case reports empty so the surface shows honest dust');
}

/* ---------- the LIVING TOOLS shelf: only seeds that genuinely ran, sorted by lifetime ---------- */
{
  const r = T.build({
    quests: [],
    stateOf: () => null,
    tools: [{ name: 'price watch', runs: 12, sevenDay: 3 }, { name: 'never ran', runs: 0, sevenDay: 0 }, { name: 'brief', runs: 5, sevenDay: 5 }]
  });
  A.eq(r.tools.map(t => t.name), ['price watch', 'brief'], 'a seed that never ran (runs 0) is NOT a living tool — silence over a fabricated count');
  A.eq(r.tools[0].runs, 12, 'lifetime run count is carried through');
  A.eq(r.tools[0].sevenDay, 3, '…and the 7-day count');
  A.eq(r.empty, false, 'a case with living tools (even with no trophies) is not empty');
}

/* ---------- degrades safely on junk ---------- */
{
  A.notThrows(() => T.build(null), 'build(null) never throws');
  A.notThrows(() => T.build({ quests: [null, {}, { id: 'x' }], stateOf: () => { throw new Error('boom'); } }), 'a throwing stateOf never crashes the projection');
  const r = T.build({ quests: [q('ms:z', 'milestone', 'done')], stateOf: () => { throw new Error('boom'); } });
  A.eq(r.trophies[0].dateKnown, false, 'a stateOf that throws yields a date-unknown trophy (never a crash, never a fake date)');
}

/* ---------- the honesty guard on completedAt is direct-tested ---------- */
A.eq(T._completedAt(0), null, '_completedAt(0) → null (never epoch-0)');
A.eq(T._completedAt(null), null, '_completedAt(null) → null');
A.eq(T._completedAt(-5), null, '_completedAt(negative) → null (not a real ms stamp)');
A.eq(T._completedAt(1751000000000), 1751000000000, '_completedAt(real ms) → passed through');

A.report('trophies.test');
