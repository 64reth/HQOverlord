/* node test/seeds.test.js — the pure seed-proposal engine (frontend/app/seeds.js).
   Locks: a mint candidate becomes a seed whose task keeps the {input} gap token, whose title is the readable
   (de-tokened, capitalized) name, and whose voiced line offers to save it (naming the gap when there is one);
   degenerate candidates yield null; two-choice beat; deterministic. Pure. */
'use strict';
const A = require('./_assert.js');
const S = require('../frontend/app/seeds.js');

/* ---------- a candidate WITH a gap token ---------- */
const c = { key: 'k1', count: 4, template: 'draft release notes for {input}', hasToken: true, lastText: 'draft release notes for v2' };
const seed = S.fromCandidate(c);
A.eq(seed.key, 'k1', 'carries the mint key');
A.eq(seed.task, 'draft release notes for {input}', 'task keeps the {input} token (the gap) verbatim');
A.ok(seed.title.indexOf('{') < 0, 'the title strips the token');
A.ok(/release notes/i.test(seed.title), 'the title is the readable directive');
A.eq(seed.title[0], seed.title[0].toUpperCase(), 'the title is capitalized (it becomes a recipe name)');
A.eq(seed.hasGap, true, 'hasGap reflects the induced token');
A.ok(/one blank/i.test(seed.line), 'the voiced line names the gap when there is one');
A.ok(/seed/i.test(seed.line), 'the line offers to save it as a seed');

/* ---------- a no-token candidate (fixed one-tap) ---------- */
const seed2 = S.fromCandidate({ key: 'k2', count: 3, template: 'summarize my inbox', hasToken: false, lastText: 'summarize my inbox' });
A.eq(seed2.hasGap, false, 'a no-token candidate has no gap');
A.ok(/one tap/i.test(seed2.line), 'a no-gap seed reads as a pure one-tap');

/* ---------- degenerate / invalid → null (graceful) ---------- */
A.eq(S.fromCandidate(null), null, 'null candidate → null');
A.eq(S.fromCandidate({ count: 3 }), null, 'a candidate with no key → null');
A.eq(S.fromCandidate({ key: 'k', template: '   ' }), null, 'an empty template → null');
A.eq(S.fromCandidate({ key: 'k', template: '{input}' }), null, 'a token-only template (no words) → null');
A.eq(S.fromCandidate({ key: 'k', lastText: 'do the thing' }).title, 'Do the thing', 'falls back to lastText when no template');

/* ---------- title is capped ---------- */
const long = S.fromCandidate({ key: 'k', template: 'please carefully ' + 'x'.repeat(200) + ' now' });
A.ok(long.title.length <= S.TITLE_CHARS + 1, 'the title is capped to keep recipe names sane');

/* ---------- the two-choice beat ---------- */
const ch = S.choices();
A.eq(ch.length, 2, 'two choices — save it / not now (never a menu)');
A.eq(ch.map(x => x.value), ['save', 'no'], 'save + a soft out');

/* ---------- deterministic ---------- */
A.eq(JSON.stringify(S.fromCandidate(c)), JSON.stringify(seed), 'fromCandidate is deterministic');

A.report('seeds.test');
