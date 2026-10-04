/* node test/recommend.test.js — the pure recommendation spine: one voice, evidence or silence. */
'use strict';
const A = require('./_assert.js');
const Recommend = require('../frontend/app/recommend.js');
const BeatCard = require('../frontend/app/beatcard.js');

/* ── 1. the priority order is the beat-slot order, with the nudge family expanded in ladder order ── */
for (let i = 0; i < BeatCard.DEFAULT_PRIORITY.length - 1; i++) {
  const kind = BeatCard.DEFAULT_PRIORITY[i];
  if (kind === 'nudge') continue;
  A.ok(Recommend.PRIORITY.indexOf(kind) >= 0, 'the spine knows the beat kind ' + kind);
}
A.eq(Recommend.PRIORITY.slice(0, 6), ['memory', 'study', 'arc', 'trust', 'thread', 'rate'],
  'the spine head is beatcard DEFAULT_PRIORITY');
A.eq(Recommend.PRIORITY.slice(6), ['suggest', 'seed', 'routine', 'recruit', 'curiosity'],
  'the gentle tail keeps the old wireCuriosity ladder precedence');
A.eq(Recommend.slotKindOf('curiosity'), 'nudge', 'every gentle channel shares the one nudge slot family');
A.eq(Recommend.slotKindOf('study'), 'study', 'a turn-in channel keeps its own slot family');
A.eq(Recommend.slotKindOf('mystery'), 'mystery', 'an unknown kind passes through unchanged');

/* ── 2. EVIDENCE OR SILENCE ── */
A.eq(Recommend.citable({ kind: 'study', why: 'you said invoices eat your Sundays' }), true, 'a cited candidate may speak');
A.eq(Recommend.citable({ kind: 'study' }), false, 'a candidate with no why is not citable');
A.eq(Recommend.citable({ kind: 'study', why: '   ' }), false, 'whitespace is not evidence');
A.eq(Recommend.citable(null), false, 'a null candidate is not citable');
A.eq(Recommend.pick([{ kind: 'study' }, { kind: 'curiosity' }]), null,
  'a field of uncitable candidates produces SILENCE, never a fallback pick');
A.eq(Recommend.pick([]), null, 'no candidates is silence');
A.eq(Recommend.pick(null), null, 'a missing candidate list is silence');
A.eq(Recommend.pick([{ kind: 'study' }, { kind: 'curiosity', why: 'i still do not know your goals' }]).kind, 'curiosity',
  'an uncitable higher-priority candidate cannot block a cited lower-priority one');

/* ── 3. ONE VOICE, by priority — not by who armed first ── */
const field = [
  { kind: 'curiosity', why: 'i still do not know your goals' },
  { kind: 'thread', why: 'you said "we should automate the invoice thing"' },
  { kind: 'study', why: 'from "ship the billing rewrite by Friday"' },
  { kind: 'trust', why: '5 approvals in a row' }
];
A.eq(Recommend.pick(field).kind, 'study', 'the best candidate speaks regardless of list order');
A.eq(Recommend.pick(field.slice().reverse()).kind, 'study', 'the pick is order-independent');

/* ── 4. BAND STABILITY: no stack of modifiers may leapfrog a BAND ──
   The bands are the part of priority that is a LAW. Inside a band, priority is only a tie-bias (§4b). */
const uRead = { dims: { goals: { weight: 1, conf: 0 }, style: { weight: 0.2, conf: 0.9 } } };
A.eq(Recommend.BANDS.length, 4, 'four bands: memory · the turn-ins · rate · the gentle asides');
A.eq(Recommend.BANDS[0], ['memory'], 'the reflection deck stands alone at the top');
A.eq(Recommend.BANDS[1], ['study', 'arc', 'trust', 'thread'], 'the turn-ins share one band');
A.eq(Recommend.BANDS[2], ['rate'], 'the rating of work just done has its own band');
A.eq(Recommend.BANDS[3], ['suggest', 'seed', 'routine', 'recruit', 'curiosity'], 'the five gentle channels share the bottom band');
A.eq(Recommend.PRIORITY, ['memory', 'study', 'arc', 'trust', 'thread', 'rate', 'suggest', 'seed', 'routine', 'recruit', 'curiosity'],
  'the flattened band table IS the old priority order (banding changed the arithmetic, never the pecking order)');
A.eq(Recommend.bandOf('curiosity'), 3, 'bandOf reports a kind’s band');
A.eq(Recommend.bandOf('mystery'), -1, 'an unknown kind belongs to no band');
A.eq(Recommend.sameBand('suggest', 'curiosity'), true, 'two gentle channels share a band');
A.eq(Recommend.sameBand('arc', 'curiosity'), false, 'a turn-in and a nudge never do');
A.ok(Recommend.MOD_CAP * 2 < Recommend.BAND_GAP_MIN,
  'the TOTAL modifier budget is strictly under the smallest gap between adjacent bands (' + Recommend.MOD_CAP + '×2 < ' + Recommend.BAND_GAP_MIN + ')');
/* MOD_CAP is a SLACK INVARIANT, not a working limit — the comment beside it says so, and this proves it. The
   real achievable range is VOI 0..+60, streak 0..+20, declines 0..−45, strength −15..0, quality −15..+7.5. */
{
  const base = Recommend.BASE.curiosity;
  const hottest = Recommend.score({ kind: 'curiosity', why: 'x', dim: 'goals', streak: 99, strength: 1, quality: Recommend.QUALITY_CAP },
    { dims: { goals: { weight: 1, conf: 0 } } }) - base;
  const coldest = Recommend.score({ kind: 'curiosity', why: 'x', declines: 99, strength: 0, quality: Recommend.QUALITY_FLOOR }) - base;
  A.eq(Math.round(hottest * 10) / 10, 87.5, 'the largest modifier stack the scorer can actually build is +87.5');
  A.eq(Math.round(coldest * 10) / 10, -75, '…and the smallest is −75');
  A.ok(Math.max(Math.abs(hottest), Math.abs(coldest)) < Recommend.MOD_CAP,
    'so the ±' + Recommend.MOD_CAP + ' clamp is inert today — it is the structural guard for a FUTURE modifier, not a live limit');
}
/* ── 4a. A READING IS A NUMBER OR IT IS NOTHING (fail-open for EVERY non-numeric shape, 2026-08-04) ──
   The old denylist ('' / null / boolean) still let `' '`, `[]` and `[0]` through Number() as a hard 0 — the
   identical bug one shape further out, and a hard 0 in `strength` is the FULL thin-evidence penalty applied to a
   field the station simply failed to read. recquality.js num() is the same predicate. */
{
  const flat = { kind: 'seed', why: 'x' };
  for (const junk of [' ', '', '  \n', [], [0], [1], {}, false, true, null, undefined, NaN, Infinity, new Date(0), 'abc'])
    A.eq(Recommend.score(Object.assign({ strength: junk }, flat)), Recommend.score(flat),
      'an unreadable strength (' + JSON.stringify(junk) + ') is NEUTRAL, never a penalty');
  for (const real of ['0', ' 0.25 ', 0.25])
    A.ok(Recommend.score(Object.assign({ strength: real }, flat)) < Recommend.score(flat),
      'a real numeric reading (' + JSON.stringify(real) + ') — including one spelled as a string — still discounts');
  A.eq(Recommend.score(Object.assign({ streak: [] }, flat)), Recommend.score(flat), 'and an unreadable COUNT is zero of them, not a fabricated one');
  A.eq(Recommend.score(Object.assign({ quality: ' ' }, flat)), Recommend.score(flat), 'the same predicate guards the quality multiplier');
}
const hotCuriosity = { kind: 'curiosity', why: 'x', dim: 'goals', streak: 99, strength: 1, quality: Recommend.QUALITY_CAP };
const coldTrust = { kind: 'trust', why: 'y', declines: 99, strength: 0, quality: Recommend.QUALITY_FLOOR };
A.eq(Recommend.pick([hotCuriosity, coldTrust], uRead).kind, 'trust',
  'a maxed-out gentle candidate still loses to a bottomed-out turn-in');
/* EXHAUSTIVE: every kind, at every extreme of every modifier, against every other kind. A cross-band inversion
   at ANY corner of the modifier space is a broken law, not a tuning miss — so the corners are enumerated. */
const EXT = { streak: [0, 99], declines: [0, 99], strength: [null, 0, 1], quality: [null, Recommend.QUALITY_FLOOR, Recommend.QUALITY_CAP], dim: [null, 'goals'] };
const corners = [];
for (const streak of EXT.streak) for (const declines of EXT.declines) for (const strength of EXT.strength)
  for (const quality of EXT.quality) for (const dim of EXT.dim) corners.push({ streak, declines, strength, quality, dim });
let crossBandInversions = 0, sameBandSwaps = 0, compared = 0;
for (const hi of Recommend.PRIORITY) for (const lo of Recommend.PRIORITY) {
  if (Recommend.PRIORITY.indexOf(hi) >= Recommend.PRIORITY.indexOf(lo)) continue;
  for (const a of corners) for (const b of corners) {
    const ca = Object.assign({ kind: hi, why: 'a' }, a), cb = Object.assign({ kind: lo, why: 'b' }, b);
    const won = Recommend.pick([ca, cb], uRead);
    compared++;
    if (won === cb) { if (Recommend.sameBand(hi, lo)) sameBandSwaps++; else crossBandInversions++; }
  }
}
A.eq(crossBandInversions, 0, 'across ' + compared + ' modifier corners, a lower BAND never once outranked a higher one');
A.ok(sameBandSwaps > 0, 'and within a band the modifiers really do reorder (' + sameBandSwaps + ' swaps) — the scorer is not inert');
A.ok(Recommend.VOI_MAX < Recommend.BAND_GAP_MIN, 'the VOI term is bounded below one band gap');

/* ── 4b. THE SCORER IS NOT DECORATION: same-band reordering, reachable by the REAL pass ──
   The pass emits at most ONE candidate per kind, so the only reorder that can ever happen live is between two
   DIFFERENT kinds of the same band. These are exactly those cases. */
// a dud-channel suggestion loses its default lead to a routine nudge whose accepted offers really produced work.
const dudSuggest = { kind: 'suggest', why: 'you’ve told me about your goals', quality: Recommend.QUALITY_FLOOR };
const goodRoutine = { kind: 'routine', why: 'you’ve launched the digest 4 times by hand', quality: Recommend.QUALITY_CAP };
A.eq(Recommend.pick([dudSuggest, goodRoutine]).kind, 'routine',
  'a channel with a real record of duds loses its rank lead to one with a real record of hits');
A.eq(Recommend.pick([{ kind: 'suggest', why: 'a' }, { kind: 'routine', why: 'b' }]).kind, 'suggest',
  '…and with NOTHING known about either, the rank order is the tie-bias (a cold station is unchanged)');
// thin evidence speaks later than well-corroborated evidence in the same band
A.eq(Recommend.pick([{ kind: 'seed', why: 'a', strength: 0.05 }, { kind: 'routine', why: 'b', strength: 1 }]).kind, 'routine',
  'a one-off seed shape loses to a well-grounded routine nudge in the same band');
// THE SPINE-ERA VOI PROMOTION, locked for real this time: a blank high-weight dimension makes the get-to-know-you
// question the most valuable thing the station can say, and it beats a recruit pitch it normally sits below.
const voiRead = { dims: { goals: { weight: 1, conf: 0 } } };
A.eq(Recommend.pick([{ kind: 'recruit', why: 'your crew has no researcher' }, { kind: 'curiosity', why: 'i still don’t know your goals', dim: 'goals' }], voiRead).kind,
  'curiosity', 'a maximum-VOI question outranks the recruit pitch above it (the promotion the clamp had silently killed)');
A.eq(Recommend.pick([{ kind: 'recruit', why: 'your crew has no researcher' }, { kind: 'curiosity', why: 'i still don’t know your style', dim: 'style' }], uRead).kind,
  'recruit', '…and a LOW-value question does not — the promotion is earned by the gap, not granted by the kind');

/* ── 5. the VOI term orders WITHIN a band, reusing weight × (1 − conf) ── */
const wide = { kind: 'curiosity', why: 'a', dim: 'goals' };
const narrow = { kind: 'curiosity', why: 'b', dim: 'style' };
A.ok(Recommend.score(wide, uRead) > Recommend.score(narrow, uRead),
  'the dimension with the larger weight × (1 − conf) gap scores higher');
A.eq(Recommend.pick([narrow, wide], uRead).why, 'a', 'the higher-VOI question wins its own band');
A.eq(Recommend.score(wide, null), Recommend.score({ kind: 'curiosity', why: 'a' }, null),
  'no understanding read → no VOI bonus (fail-open, never fabricated)');
A.eq(Recommend.score({ kind: 'curiosity', why: 'a', dim: 'nope' }, uRead), Recommend.score({ kind: 'curiosity', why: 'a' }, uRead),
  'an unknown dimension contributes nothing');
A.eq(Recommend.score({ kind: 'curiosity', why: 'a', dim: 'goals' }, { dims: { goals: { weight: null, conf: null } } }),
  Recommend.score({ kind: 'curiosity', why: 'a' }), 'an UNREADABLE dimension contributes nothing either (null is not zero)');

/* ── 6. streak and decline hooks are bounded ── */
const plain = { kind: 'trust', why: 'w' };
A.ok(Recommend.score({ kind: 'trust', why: 'w', streak: 3 }) > Recommend.score(plain), 'a real streak helps');
A.eq(Recommend.score({ kind: 'trust', why: 'w', streak: 1000 }), Recommend.score({ kind: 'trust', why: 'w', streak: 4 }),
  'the streak bonus saturates');
A.ok(Recommend.score({ kind: 'trust', why: 'w', declines: 2 }) < Recommend.score(plain), 'recent declines soften the ask');
A.eq(Recommend.score({ kind: 'trust', why: 'w', declines: 1000 }), Recommend.score({ kind: 'trust', why: 'w', declines: 3 }),
  'the decline penalty saturates');
A.eq(Recommend.score({ kind: 'trust', why: 'w', streak: -5, declines: -5 }), Recommend.score(plain),
  'negative hooks are clamped, never inverted');

/* ── 7. an explicit base override wins over the derived tier ── */
A.eq(Recommend.pick([{ kind: 'curiosity', why: 'a', base: 9000 }, { kind: 'study', why: 'b' }]).kind, 'curiosity',
  'an explicit base lets a caller stage a candidate deliberately');

/* ── 8. determinism ── */
const twice = [Recommend.score(field[0], uRead), Recommend.score(field[0], uRead)];
A.eq(twice[0], twice[1], 'scoring has no clock and no randomness');

/* ── 9. whyLine — ONE grammar for COMMS and the FOR YOU shelf ── */
A.eq(Recommend.whyLine({ why: 'you said invoices eat your Sundays' }), 'because you said invoices eat your Sundays', 'the base grammar');
A.eq(Recommend.whyLine({ why: 'because the last 3 runs hit this wall' }), 'because the last 3 runs hit this wall', 'an already-because string is not doubled');
A.eq(Recommend.whyLine({ why: 'Since you keep hand-launching it' }), 'because you keep hand-launching it', 'other connectives normalize too');
A.eq(Recommend.whyLine({ why: 'You mentioned Sundays.' }), 'because you mentioned Sundays', 'a leading capital joins mid-sentence; trailing punctuation goes');
A.eq(Recommend.whyLine({ why: 'MCP connectors keep timing out' }), 'because MCP connectors keep timing out', 'an acronym keeps its case');
/* THE SPINE NEVER REWRITES THE COMMANDER'S WORDS. Lower-casing "a plain leading capital" mangled the evidence
   itself — proper nouns, languages, products and people's names all got de-capitalized inside their own quote. */
A.eq(Recommend.whyLine({ why: 'Python is the stack you work in' }), 'because Python is the stack you work in',
  'a proper noun is NOT de-capitalized (it is the Commander’s word, not the spine’s framing)');
A.eq(Recommend.whyLine({ why: 'Andrew ships on Fridays' }), 'because Andrew ships on Fridays', 'nor is a person’s name');
A.eq(Recommend.whyLine({ why: 'you said “Python is my stack”' }), 'because you said “Python is my stack”',
  'a quoted citation passes through verbatim');
A.eq(Recommend.whyLine({ why: 'from the task you gave me: “Ship the billing rewrite”' }),
  'from the task you gave me: “Ship the billing rewrite”',
  'a citation that carries its OWN preposition is a complete phrase — "because from …" is not English');
A.eq(Recommend.whyLine({ why: 'from the conversation: “a price watcher for GPUs”' }),
  'from the conversation: “a price watcher for GPUs”', 'the softened thread citation reads as written');
A.eq(Recommend.whyLine({ why: 'It matches your goal: “invoices”' }), 'because It matches your goal: “invoices”',
  'a quote-carrying line is never touched at all');
A.eq(Recommend.whyLine({ why: '  you   said   this  ' }), 'because you said this', 'whitespace is collapsed');
A.eq(Recommend.whyLine({ why: '' }), '', 'nothing to cite renders nothing');
A.eq(Recommend.whyLine(null), '', 'a null candidate renders nothing');
A.eq(Recommend.whyLine({ why: 'because' }), '', 'a bare connective is not evidence');

/* ── 10. the spine is pure: no DOM, no fetch, no timers ── */
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'app', 'recommend.js'), 'utf8');
A.eq(/\bdocument\b/.test(src), false, 'recommend.js touches no DOM');
A.eq(/\bfetch\s*\(/.test(src), false, 'recommend.js performs no I/O');
A.eq(/\bsetTimeout\b|Date\.now|Math\.random/.test(src), false, 'recommend.js is clock-free and deterministic');

/* ── 11. THE ONE CARD GRAMMAR (source-lock — chat.js is DOM-flow, not node-loadable) ──
   Every proactive consent offer renders through ONE renderer, in one order:
   eyebrow → evidence (the Commander's words) → proposal → consent buttons. */
const fs = require('fs'), path = require('path');
const chatSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'css', 'app.css'), 'utf8');
const iRecCard = chatSrc.indexOf('function recCard(spec)');
A.ok(iRecCard > 0, 'chat.js defines the ONE offer-card renderer');
const recBody = chatSrc.slice(iRecCard, iRecCard + 2600);
A.ok(/rec-eyebrow/.test(recBody) && /rec-glyph/.test(recBody), 'the card leads with the eyebrow, glyph boxed on its own');
// the eyebrow NAMES the noticer — every caller passes none, so a bare 'NOTICED' dropped the agent's identity
A.ok(/name \? String\(name\)\.toUpperCase\(\) \+ ' NOTICED' : 'NOTICED'/.test(recBody),
  'the eyebrow reads “◈ <AGENT> NOTICED” — the station has a name, and the card says it');
A.ok(recBody.indexOf('rec-evidence') < recBody.indexOf("className = 'turnin-text'"),
  'the EVIDENCE line is rendered BEFORE the proposal (noticed → because → propose)');
A.ok(recBody.indexOf("className = 'turnin-text'") < recBody.indexOf("className = 'consent-btns'"),
  'the proposal precedes the consent buttons');
A.ok(/classList\.add\('turnin'\)/.test(recBody), 'the card extends the established .turnin family, not a new visual language');
A.ok(/textContent/.test(recBody) && !/innerHTML/.test(recBody), 'every dynamic string is set via textContent');
// all three consent channels route their presentation through it (one shape, not seven)
for (const fn of ['studyCard', 'trustCard', 'threadCard']) {
  const i = chatSrc.indexOf('function ' + fn);
  A.ok(i > 0 && /recCard\(\{/.test(chatSrc.slice(i, i + 2400)), fn + ' renders through the shared offer card');
}
// the why-string grammar is shared with the FOR YOU shelf
const mktSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'marketplace.js'), 'utf8');
A.ok(/function whyGrammar\(raw\)[\s\S]{0,300}Recommend\.whyLine\(\{ why: t \}\)/.test(mktSrc),
  'the bay routes every shelf reason through ONE grammar helper, the same whyLine the COMMS cards use');
A.ok(/return whyGrammar\(raw\);/.test(mktSrc), 'the FOR YOU shelf speaks it');
A.ok(/const why = whyGrammar\(/.test(mktSrc) && /why: whyGrammar\('it covers the '/.test(mktSrc),
  'and so does the specialists shelf (the two shelves can never disagree)');
/* Every composed reason must read as English AFTER the framing. "because matches your goal" was not a sentence;
   the leading "it" is what makes it one. Locked on the real strings both shelves emit. */
const Recipes = require('../frontend/app/recipes.js');
const reasonOf = (opts) => Recipes.forYouReason({ id: 'r1', name: 'Invoice sweep', tagline: 'clears the invoice pile', tags: {} }, opts);
A.eq(Recommend.whyLine({ why: reasonOf({ goalText: 'ship the invoice rewrite' }) }),
  'because it matches your goal: “invoice”', 'a goal match reads as a sentence');
A.eq(Recommend.whyLine({ why: reasonOf({ launches: { r1: 3 } }) }), 'because you have launched this 3×', 'a launch count already read fine');
A.eq(Recommend.whyLine({ why: reasonOf({ launches: { r1: { n: 3, rated: { great: 2 } } } }) }),
  'because you rated this work great 2×', 'so did a verdict count');
for (const v of ['it matches your focus on code', 'it matches your focus on research', 'it fits your day-to-day ops']) {
  A.ok(mktSrc.indexOf("'" + v + "'") > 0, 'the affinity copy reads as a sentence after the framing: ' + v);
}
/* ── 11b. THE CARD NEVER PUTS WORDS IN THE COMMANDER'S MOUTH (truthful telemetry, 2026-08-04) ──
   `because you said "…"` was rendered for EVERY citation the card had. But study.js falls back to the run's
   DIRECTIVE when the model returns no QUOTE line (evidenceRef.kind = 'directive'), and a directive is very often
   machine-composed (routine, recipe, scheduled brief); threadmine locates its quote in the whole exchange, which
   includes the AGENT's turns. Each source now gets its own honest phrasing. */
const iCite = chatSrc.indexOf('function recCite');
A.ok(iCite > 0, 'chat.js has ONE citation composer, discriminated by source');
const citeBody = A.fnBody(chatSrc, 'function recCite(');
A.ok(/kind === 'verbatim'\) return 'you said/.test(citeBody), 'only a VERBATIM quote may be rendered as speech');
A.ok(/kind === 'directive'\) return 'from the task you gave me/.test(citeBody), 'a directive is cited as the task, not as words spoken');
A.ok(/kind === 'conversation'\) return 'from the conversation/.test(citeBody), 'an unattributed quote is cited as the conversation');
A.ok(/return 'from “' \+ t \+ '”';/.test(citeBody), 'anything unlabelled falls back to a neutral quote that claims no speaker');
for (const [fn, probe] of [['function studyCard(', /recCite\(prop\.evidence, prop\.evidenceRef && prop\.evidenceRef\.kind\)/],
                           ['async function studyCandidate(', /recCite\(prop\.evidence, prop\.evidenceRef && prop\.evidenceRef\.kind\)/],
                           ['function threadCard(', /recCite\(prop\.spec, threadCiteKind\(prop\)\)/],
                           ['async function threadCandidate(', /recCite\(prop\.spec, threadCiteKind\(prop\)\)/]]) {
  A.ok(probe.test(A.fnBody(chatSrc, fn)), fn.replace(/^(async )?function |\($/g, '') + ' cites by SOURCE, never blanket "you said"');
}
A.ok(/prop\.speaker === 'user'/.test(A.fnBody(chatSrc, 'function threadCiteKind(')),
  'a mined thread claims speech only when threadmine located the quote in the Commander’s own turns');
/* …and a DOSSIER belief is cited by ITS recorded provenance, so the arc and the re-confirm card can no longer
   render a study-OBSERVED goal as words the Commander spoke (that is the exact mis-attribution above, on the one
   card whose whole subject is whether the station's memory can be trusted). */
const citeKindBody = A.fnBody(chatSrc, 'function beliefCiteKind(');
A.ok(citeKindBody.length > 0, 'chat.js derives a belief’s citation kind from the belief itself');
A.ok(/w === 'stated' \|\| src === 'commander'/.test(citeKindBody), 'only Commander-authored evidence may be rendered as speech');
A.ok(/return '';/.test(citeKindBody), 'an observed / synthesised / seeded belief falls back to the neutral quote that claims no speaker');
/* …and the two provenance holes the re-sweep found in that predicate (2026-08-04):
     · source:'curiosity' was a blanket "you said" — but a CANNED CHIP tap lands as weight:'seed'
       (interview.js beliefFromAnswer), i.e. the station's own sentence read back as the Commander's words. A
       TYPED answer is already 'stated', so the clause bought nothing and cost the truth.
     · CONFIRMED must be checked BEFORE stated/commander: the re-confirm card upgrades a station-authored belief
       to commander/stated (truthfully — an affirmation IS a statement of the content), so without the earlier
       check every later card would quote words the Commander never spoke. */
A.eq(/src === 'curiosity'/.test(citeKindBody), false,
  'a curiosity answer is NOT blanket-quoted as speech — a canned chip tap is the station’s own sentence');
A.ok(/if \(ref === 'confirmed'\) return 'confirmed';/.test(citeKindBody),
  'an AFFIRMED belief cites the affirmation, never authorship');
A.ok(citeKindBody.indexOf("ref === 'confirmed'") < citeKindBody.indexOf("w === 'stated'"),
  '…and that check comes FIRST, or the stated/commander clause the confirm itself writes would swallow it');
A.ok(/kind === 'confirmed'\) return 'you confirmed/.test(citeBody),
  'recCite gives the affirmation its own verb: “you confirmed …”, never “you said …”');
for (const fn of ['function arcCandidate(', 'function reconfirmCard(']) {
  A.ok(/recCite\((?:text|prop\.text), beliefCiteKind\(belief\)\)/.test(A.fnBody(chatSrc, fn)),
    fn.replace(/^function |\($/g, '') + ' cites its belief by that provenance, never a blanket "you said"');
}
// …and the blanket composer both call sites moved off is GONE, not left lying around to be reached for again.
A.eq(/function recQuote\b/.test(chatSrc), false, 'the dead blanket recQuote() composer is deleted');
A.eq(/\brecQuote\(/.test(chatSrc), false, 'and nothing calls it');
// …and the producer stamps that discrimination in the first place
A.ok(/speaker: \(nq && spoken\.indexOf\(nq\) >= 0\) \? 'user' : 'other'/.test(fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'threadmine.js'), 'utf8')),
  'threadmine stamps WHO said the quote it mined');
// a cut directive ends in an ellipsis, so the citation can never read as a sentence the Commander never finished
A.ok(/dir\.length > 140 \? \(dir\.slice\(0, 139\) \+ '…'\) : dir/.test(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'study.js'), 'utf8')),
  'a truncated directive citation is visibly truncated');

const iRecWhy = chatSrc.indexOf('function recWhy');
A.ok(iRecWhy > 0 && /Recommend\.whyLine/.test(chatSrc.slice(iRecWhy, iRecWhy + 420)), 'the cards route their citation through whyLine');
// styling: matte, dark-only, no gloss, no white control, entrance mirrors the vanish timing
A.ok(/\.cmsg\.turnin\.rec\b/.test(cssSrc), 'app.css styles the offer card inside the .turnin family');
A.ok(/@keyframes rec-card-in/.test(cssSrc) && /animation: rec-card-in \.26s/.test(cssSrc),
  'the entrance mirrors the .beat-vanish timing (.26s) — one motion vocabulary');
A.ok(/prefers-reduced-motion[\s\S]{0,80}rec\b/.test(cssSrc) || /rec-card-in[\s\S]*prefers-reduced-motion/.test(cssSrc),
  'the entrance collapses under prefers-reduced-motion');
const recCss = cssSrc.slice(cssSrc.indexOf('THE OFFER CARD (recommendation spine)'), cssSrc.indexOf('THE OFFER CARD (recommendation spine)') + 2600);
A.eq(/#fff|#ffffff|white/i.test(recCss), false, 'no white controls or white paint anywhere in the card');
A.eq(/gradient|blur\(|backdrop-filter/i.test(recCss), false, 'matte, not glossy — no gradients or glass on the card');
A.ok(/\.rec-glyph[\s\S]{0,220}width: 11px/.test(recCss), 'the ◈ symbol glyph is BOX-sized, never padded from font-size');

A.report('recommend.test');
