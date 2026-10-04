/* node test/verdictfollowup.test.js — the pure verdict follow-up engine (frontend/app/verdictfollowup.js).
   Locks the POPUP LAW (docs/NEXT.md 2026-08-21): a short-of-the-mark verdict asks ONE thing and every chip
   maps to a real Commander Dossier dimension so the answer CHANGES something (a belief in every briefing);
   praise asks nothing; skip writes nothing; the written belief cites the run that taught it. */
'use strict';
const A = require('./_assert.js');
const V = require('../frontend/app/verdictfollowup.js');
const Dossier = require('../frontend/app/dossier.js');

/* ---------- who gets asked ---------- */
A.eq(V.shouldAsk('great'), false, 'a nailed-it verdict asks nothing (no popup after praise)');
A.eq(V.shouldAsk('ok'), true, 'a close verdict asks');
A.eq(V.shouldAsk('miss'), true, 'a missed verdict asks');
A.eq(V.shouldAsk(''), false, 'empty verdict → quiet');
A.eq(V.shouldAsk(undefined), false, 'undefined verdict → quiet, never throws');
A.eq(V.chips('great').length, 0, 'no chips for praise');

/* ---------- every chip writes somewhere real ---------- */
const chips = V.chips('miss');
A.ok(chips.length >= 4, 'a miss offers several causes');
A.ok(chips.some(c => c.skip), 'a skip chip is always offered');
A.eq(chips.filter(c => c.skip).length, 1, 'exactly one skip chip');
for (const c of chips) {
  if (c.skip) { A.eq(V.belief(c.value, {}), null, 'skip writes nothing'); continue; }
  const b = V.belief(c.value, { now: 1700000000000 });
  A.ok(b && b.dim, 'chip "' + c.value + '" yields a belief');
  A.ok(Dossier.DIM_KEYS.indexOf(b.dim) !== -1, 'chip "' + c.value + '" writes a REAL dossier dimension (' + b.dim + ')');
  A.eq(b.weight, 'observed', 'a chip-tap is an OBSERVED belief (never opens the readiness gate as "stated")');
  A.eq(b.source, 'verdict', 'source names the verdict path');
  A.eq(b.observedAt, 1700000000000, 'observedAt stamps the tap');
  A.ok(b.text.length > 20 && b.text.length <= Dossier.TEXT_CHARS, 'belief text fits a single dossier belief');
}
A.eq(V.belief('nonsense', {}), null, 'unknown chip → null, never a guessed belief');

/* ---------- the belief cites the run ---------- */
const cited = V.belief('shorter', { directive: 'write   the Monday\n brief for the team', now: 5 });
A.ok(cited.text.indexOf('“write the Monday brief for the team”') !== -1, 'the run directive is cited, whitespace collapsed');
const long = V.belief('shorter', { directive: 'x'.repeat(400), now: 5 });
A.ok(long.text.indexOf('…') !== -1 && long.text.length <= Dossier.TEXT_CHARS, 'a long directive is trimmed so the belief still fits');
A.eq(V.belief('shorter', { now: 0 }).observedAt, null, 'a missing clock leaves observedAt null rather than lying');
A.ok(V.belief('shorter', {}).text.indexOf('(from:') === -1, 'no directive → no empty citation');

/* ---------- the belief actually lands in a dossier and reaches the briefing ---------- */
const d = Dossier.fresh();
const b = V.belief('audience', { directive: 'draft outreach to investors', now: 10 });
Dossier.upsert(d, b.dim, { text: b.text, source: b.source, weight: b.weight, observedAt: b.observedAt }, 10);
A.eq(Dossier.beliefs(d, 'people').length, 1, 'the belief is stored under its dimension');
A.eq(Dossier.weightOf(Dossier.beliefs(d, 'people')[0]), 'observed', 'stored with observed weight');
A.ok(Dossier.composeBlock(d, {}).indexOf('wrong audience') !== -1, 'the composed briefing block carries the lesson to every later agent');

A.report();
