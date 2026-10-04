/* node test/seedcredit.test.js — the PURE seed-callout helper (G3a): when does a pitch/suggestion/digest
   genuinely reuse a Commander-saved seed? HONESTY is the contract under test: a credit renders only when
   provenance links (the seedborn flag, a routine-name match, or a real template match) — an uncertain row
   gets NO credit, never a guess. */
'use strict';
const A = require('./_assert.js');
const SC = require('../frontend/app/seedcredit.js');

// ---- creditForRecipe: the pitch/suggestion path (provenance = the durable seedborn flag) ----
A.eq(SC.creditForRecipe({ id: 'custom-recipe-x', name: 'Release Notes', seedborn: true }),
  'built from the seed you saved — “Release Notes”.',
  'a seedborn recipe earns the credit line, naming the seed');
A.eq(SC.creditForRecipe({ id: 'custom-recipe-y', name: 'Hand Built', custom: true }), '',
  'a hand-authored custom (no seedborn flag) earns NO credit — only agent-minted seeds get the callout');
A.eq(SC.creditForRecipe({ id: 'daily-brief', name: 'Daily Brief' }), '', 'a builtin earns no credit');
A.eq(SC.creditForRecipe(null), '', 'a missing recipe (unknown id) earns no credit — silence over fabrication');
A.eq(SC.creditForRecipe({ seedborn: true, name: '   ' }), '', 'a seedborn recipe with a blank name renders nothing');

// ---- matchSeed / annotate: the digest path ----
const seeds = [
  { id: 'c1', name: 'Morning Sweep', task: 'sweep my inbox for {input} and summarize', seedborn: true },
  { id: 'c2', name: 'Hand Built', task: 'do a thing', seedborn: false }
];

// 1. routine-name path: the matched cron job carries the seed's name
let row = { runId: 'r1', title: 'whatever the prompt was', routine: 'morning sweep' };
A.eq((SC.matchSeed(row, seeds) || {}).id, 'c1', 'a routine named like the seed matches (case/space-insensitive)');
row = { runId: 'r2', title: 'x', routine: 'Hand Built' };
A.eq(SC.matchSeed(row, seeds), null, 'a NON-seedborn custom never credits, even on a perfect name match');

// 2. template path: the run's recorded title IS the filled template ({tokens} as wildcards)
row = { runId: 'r3', title: 'sweep my inbox for launch replies and summarize', routine: '' };
A.eq((SC.matchSeed(row, seeds) || {}).id, 'c1', 'a title that fills the seed template matches (token = wildcard)');
row = { runId: 'r4', title: 'SWEEP  MY  INBOX for launch replies AND summarize', routine: '' };
A.eq((SC.matchSeed(row, seeds) || {}).id, 'c1', 'whitespace + case differences still match (normalized)');
row = { runId: 'r5', title: 'sweep my desk for crumbs', routine: '' };
A.eq(SC.matchSeed(row, seeds), null, 'a title that does NOT fill the template matches nothing — no credit');
A.eq(SC.matchSeed({ title: '', routine: '' }, seeds), null, 'an empty row matches nothing');
A.eq(SC.matchSeed(row, []), null, 'no customs → no match');
A.eq(SC.matchSeed(row, null), null, 'missing customs list tolerated');

// 3. truncation: returns.js caps titles at 90 chars — a near-cap title accepts an opening-segment match
const longSeed = [{
  id: 'c3', seedborn: true, name: 'Deep Research',
  task: 'research the competitive landscape around {input} and produce a sourced brief with at least five citations'
}];
// mirror returns.js exactly: the recorded row title is the filled prompt .slice(0, 90)
const filled = 'research the competitive landscape around quantum sensing startups and produce a sourced brief with at least five citations';
const truncated = filled.slice(0, 90);
A.eq((SC.matchSeed({ title: truncated, routine: '' }, longSeed) || {}).id, 'c3',
  'a truncated (near-cap) title still credits via the template’s opening literal segment');
A.eq(SC.matchSeed({ title: 'research nothing in particular', routine: '' }, longSeed), null,
  'a short title never uses the loose prefix path — exact template match only');

// ---- annotate: rows are marked in place; unmatched rows untouched ----
const rows = [
  { runId: 'a', title: 'sweep my inbox for invoices and summarize', routine: '' },
  { runId: 'b', title: 'unrelated run', routine: '' }
];
SC.annotate(rows, seeds);
A.eq(rows[0].seed, 'Morning Sweep', 'annotate stamps .seed with the credited seed’s name');
A.eq(rows[1].seed, undefined, 'an unmatched row is left untouched (no .seed key, no fake credit)');
A.eq(SC.annotate(null, seeds), [], 'annotate tolerates a missing rows list');

// ---- template edge: regex specials in the literal segments never break the matcher ----
const trickSeed = [{ id: 'c4', seedborn: true, name: 'Regex Trick', task: 'grep (all) files for {input} + report [ok]' }];
A.eq((SC.matchSeed({ title: 'grep (all) files for TODO + report [ok]', routine: '' }, trickSeed) || {}).id, 'c4',
  'literal regex specials in the template are escaped, not interpreted');

A.report('seedcredit.test');
