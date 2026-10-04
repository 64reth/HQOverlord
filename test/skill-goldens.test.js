/* node test/skill-goldens.test.js — consistency loop slice 4: skills/goldens.js (pure).
   A `great` run freezes a reference; check() is a deterministic shape+content consistency measure with explicit
   thresholds; fold() caps per skill and dedupes by run. The same output always passes its own golden (the floor
   any consistency measure must clear), a same-length rewrite about something else fails on overlap, and a 3×
   longer rewrite fails on length even when every keyword is present. */
'use strict';
const A = require('./_assert.js');
const G = require('../sidecar/skills/goldens.js');

const BRIEF = 'Weekly team brief. Decisions: ship the billing dashboard Friday; pause the newsletter until October. ' +
  'Risks: Stripe webhook retries are flaky in staging; two customers asked about invoices. ' +
  'Next: Andrew reviews pricing copy Monday, Sam fixes the webhook retry, Priya drafts the investor update.';

/* ---------- mint ---------- */
A.eq(G.mint({ runId: 'r1', directive: 'write the weekly brief', outputText: 'too short' }, 10), null, 'an output under 8 words is not measurable → no golden');
A.eq(G.mint({ runId: 'r1', directive: '', outputText: BRIEF }, 10), null, 'no directive → no golden');
const g = G.mint({ runId: 'r1', agentId: 'a', skillId: 'weekly-brief', directive: '  write the   weekly brief ', outputText: BRIEF }, 10);
A.ok(g && g.id === 'g_r1_10', 'golden id is deterministic from run + clock');
A.eq(g.directive, 'write the weekly brief', 'directive whitespace collapsed');
A.ok(g.reference.words > 30 && g.reference.chars === BRIEF.length, 'reference carries word + char counts');
A.ok(g.reference.keywords.length > 10 && g.reference.keywords.indexOf('the') === -1, 'keywords are content words (stoplist applied)');
A.ok(g.reference.keywords.indexOf('webhook') !== -1, 'a repeated distinctive word ranks as a keyword');
A.eq(G.mint({ runId: 'r2', directive: 'x', outputText: 'w '.repeat(5000) }, 1).reference.text.length, G.REF_TEXT_CAP, 'reference text is capped');

/* ---------- check: the floor — an output matches its own golden ---------- */
const self = G.check(g, BRIEF);
A.ok(self.pass && self.lengthRatio === 1 && self.overlap === 1, 'RATCHET: the reference passes its own golden (ratio 1, overlap 1)');
// a consistent rewrite: same shape, same facts, different wording
const REWRITE = 'Team brief for the week. We decided to ship the billing dashboard on Friday and to pause the newsletter until October. ' +
  'Risks: the Stripe webhook retries stay flaky in staging, and two customers raised invoice questions. ' +
  'Next steps: Andrew reviews the pricing copy Monday; Sam fixes webhook retry; Priya drafts the investor update.';
const rw = G.check(g, REWRITE);
A.ok(rw.pass, 'a faithful rewrite passes: ' + JSON.stringify(rw));
// inconsistent: same length, different content
const OTHER = 'Quarterly roadmap overview. Themes: mobile onboarding redesign, analytics export, SSO for enterprise accounts. ' +
  'Hiring: two backend engineers and a designer by December. Budget: marketing spend flat, infrastructure up fifteen percent. ' +
  'Milestones: beta in November, general availability in February, first enterprise pilot in March.';
const oth = G.check(g, OTHER);
A.ok(!oth.pass && /overlap/.test(oth.reason), 'same length, different content fails on keyword overlap: ' + oth.reason);
// inconsistent: everything present but three times as long
const LONG = BRIEF + ' ' + BRIEF + ' ' + BRIEF + ' and additionally some more context paragraphs that ramble on.';
const lg = G.check(g, LONG);
A.ok(!lg.pass && /length/.test(lg.reason) && lg.overlap === 1, 'a 3× longer output fails on length even at full overlap: ' + lg.reason);
A.ok(!G.check(g, '').pass, 'an empty output fails');
A.ok(!G.check(null, BRIEF).pass && /no measurable/.test(G.check({}, BRIEF).reason), 'a golden with no reference never passes (no fake green)');
A.ok(G.check(g, LONG, { lengthMax: 4 }).pass, 'thresholds are explicit and overridable');

/* ---------- fold ---------- */
let list = [];
for (let i = 0; i < 7; i++) list = G.fold(list, G.mint({ runId: 'run' + i, directive: 'd', outputText: BRIEF }, i));
A.eq(list.length, G.MAX_GOLDENS_PER_SKILL, 'capped per skill');
A.eq(list[0].runId, 'run6', 'newest first');
list = G.fold(list, G.mint({ runId: 'run6', directive: 'd', outputText: BRIEF }, 99));
A.eq(list.filter(x => x.runId === 'run6').length, 1, 'one golden per run (re-rating replaces)');
A.eq(list[0].mintedAt, 99, 'the replacement is the latest mint');

A.report('skill-goldens');
