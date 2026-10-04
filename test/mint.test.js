/* node test/mint.test.js — the AUTO-MINT engine (frontend/app/mint.js).
   Locks the moat-move promises: a RECURRING task shape is grouped by a function-word skeleton (the verb is kept
   so different verbs never merge); a shape only becomes a candidate at the recurrence THRESHOLD; induceTemplate
   turns varying examples into a {input} template but BACKS OFF to the raw text when the bucket is too mixed (never
   a junk over-grouped proposal); minted/dismissed candidates stay gone; pausing stops folding; and a malformed
   persisted blob hydrates to a valid state. Clock is injected — everything is deterministic. */
'use strict';
const A = require('./_assert.js');
const M = require('../frontend/app/mint.js');

/* ---------- normalizeShape: group same-kind requests, keep the verb, drop noise ---------- */
A.eq(M.normalizeShape('Brief me on AI agents'), M.normalizeShape('brief me on rust'), 'same-shape requests share a key regardless of the specifics');
A.ok(M.normalizeShape('Summarize the report') !== M.normalizeShape('Delete the report'), 'different VERBS never group (verb is kept in the skeleton)');
A.eq(M.normalizeShape('go'), '', 'a too-short directive carries no learnable shape');
A.eq(M.normalizeShape('the a on of'), '', 'an all-function-words message (no verb) carries no shape');
A.ok(M.normalizeShape('summarize this').length > 0, 'a verb + function word is still a (fixed) shape');
A.eq(M.normalizeShape('Brief me on AI!!'), M.normalizeShape('brief me on ai'), 'punctuation + case are normalized away');

/* ---------- observe: fold directives into the recurrence map ---------- */
let st = M.fresh();
A.eq(st, { v: 1, shapes: {}, enabled: true }, 'fresh() is an empty, enabled state');
M.observe(st, 'Brief me on AI', 100);
const key = M.normalizeShape('Brief me on AI');
A.eq(st.shapes[key].count, 1, 'observe records the first occurrence');
M.observe(st, 'Brief me on rust', 200);
A.eq(st.shapes[key].count, 2, 'a same-shape directive bumps the same bucket');
A.eq(st.shapes[key].examples.length, 2, 'distinct examples accumulate');
A.eq(st.shapes[key].lastAt, 200, 'observe stamps the injected clock');
// a repeated IDENTICAL directive bumps count but stays one example (de-duped, most-recent-last)
M.observe(st, 'Brief me on AI', 300);
A.eq(st.shapes[key].count, 3, 'a repeat still counts');
A.eq(st.shapes[key].examples.length, 2, 'an identical repeat does not add a new example');
A.eq(st.shapes[key].examples[st.shapes[key].examples.length - 1], 'Brief me on AI', 'a repeated example moves to most-recent');

// observe is a no-op when paused, and for a shapeless directive
const sd = M.fresh(); M.setEnabled(sd, false); M.observe(sd, 'Brief me on AI', 0);
A.eq(Object.keys(sd.shapes).length, 0, 'observe is a no-op while paused');
const se = M.fresh(); M.observe(se, 'hi', 0);
A.eq(Object.keys(se.shapes).length, 0, 'a shapeless directive is not tracked');

/* ---------- induceTemplate: varying examples -> a {input} template, heterogeneous -> raw ---------- */
const vary = M.induceTemplate(['Brief me on AI', 'Brief me on rust', 'Brief me on LLMs']);
A.eq(vary.template, 'Brief me on {input}', 'a common prefix with a varying tail induces a {input} template');
A.eq(vary.hasToken, true, 'the induced template carries a token');
const mid = M.induceTemplate(['Compare {x}', 'Compare apples to oranges', 'Compare cats to dogs']);
A.ok(mid.template.indexOf('Compare') === 0, 'induction anchors on the shared prefix');
const same = M.induceTemplate(['Summarize what shipped today', 'Summarize what shipped today']);
A.eq(same.hasToken, false, 'identical examples induce a FIXED mission (no token)');
A.eq(same.template, 'Summarize what shipped today', 'the fixed template is the directive itself');
const het = M.induceTemplate(['Do alpha now', 'Do beta later']);
A.eq(het.hasToken, false, 'a too-heterogeneous bucket backs off to the raw text (no junk token)');
A.eq(het.template, 'Do beta later', 'the raw fallback is the most-recent example');
A.eq(M.induceTemplate([]).template, '', 'no examples -> empty template');
// review hardening: a trailing-APPEND family (one example is a strict prefix of the others) must not fuse {input}
const app = M.induceTemplate(['summarize the report', 'summarize the report notes', 'summarize the report fully']);
A.eq(app.hasToken, true, 'a trailing-append family still induces a token');
A.ok(app.template.indexOf('report{input}') < 0, 'the {input} never fuses onto the preceding word');
A.ok(app.template.indexOf('report {input}') >= 0, 'a separating space is inserted before the append slot');

/* ---------- candidates: the gated proposals ---------- */
const c0 = M.fresh();
M.observe(c0, 'Fix the bug in auth', 1); M.observe(c0, 'Fix the bug in login', 2);
A.eq(M.candidates(c0).length, 0, 'below the recurrence threshold: no proposal');
M.observe(c0, 'Fix the bug in checkout', 3);
const cand = M.candidates(c0);
A.eq(cand.length, 1, 'at the threshold the shape becomes a candidate');
A.eq(cand[0].count, 3, 'the candidate carries its recurrence count');
A.ok(cand[0].template.indexOf('Fix the bug in') === 0, 'the candidate proposes the induced template');
A.ok(cand[0].hasToken, 'a varying-tail candidate offers a {input}');

// dismiss / mint remove a candidate
M.markDismissed(c0, cand[0].key);
A.eq(M.candidates(c0).length, 0, 'a dismissed shape is never proposed again');
const c1 = M.fresh();
for (let i = 0; i < 3; i++) M.observe(c1, 'Draft a reply to msg ' + i, i);
A.eq(M.candidates(c1).length, 1, 'a fresh recurring shape proposes');
M.markMinted(c1, M.candidates(c1)[0].key);
A.eq(M.candidates(c1).length, 0, 'a minted shape is never proposed again');

// paused state surfaces no candidates; cap is honored
const cp = M.fresh();
for (let i = 0; i < 3; i++) M.observe(cp, 'Plan the launch step ' + i, i);
A.ok(M.candidates(cp).length >= 1, 'an enabled state proposes');
M.setEnabled(cp, false);
A.eq(M.candidates(cp).length, 0, 'a paused state surfaces no proposals');

// MAX_CANDIDATES cap: many recurring shapes -> at most the cap
const cm = M.fresh();
for (let s = 0; s < 6; s++) for (let i = 0; i < 3; i++) M.observe(cm, 'Verb' + s + ' the thing number ' + i, s * 10 + i);
A.ok(M.candidates(cm).length <= M.MAX_CANDIDATES, 'never more than MAX_CANDIDATES proposals at once');

/* ---------- seenCount: the recurrence signal that drives the memory beat's salience (RECUR_MIN < seed THRESHOLD) ---------- */
A.eq(M.RECUR_MIN, 2, 'a shape is "recurring" once seen twice (a lower bar than the seed THRESHOLD)');
A.ok(M.RECUR_MIN < M.THRESHOLD, 'recurring (memory beat) fires sooner than minting a seed recipe');
const cseen = M.fresh();
A.eq(M.seenCount(cseen, 'Brief me on AI'), 0, 'an unseen shape has count 0 (a basic one-off → memory beat stays quiet)');
M.observe(cseen, 'Brief me on AI', 1);
A.eq(M.seenCount(cseen, 'Brief me on rust'), 1, 'first occurrence of a shape → count 1 (still below the recurring bar)');
M.observe(cseen, 'Brief me on rust', 2);
A.eq(M.seenCount(cseen, 'Brief me on go'), 2, 'second same-shape directive → count 2 (now recurring → memory beat fires)');
A.ok(M.seenCount(cseen, 'Brief me on go') >= M.RECUR_MIN, 'the shape clears the recurring bar after two sightings');
A.eq(M.seenCount(cseen, 'hi'), 0, 'a shapeless directive has no recurrence count');
A.eq(M.seenCount(null, 'Brief me on AI'), 0, 'a missing state → count 0 (never throws)');

/* ---------- markProposed + maxProposed: the seed nudge stops re-offering an ignored shape ---------- */
const cprop = M.fresh();
for (let i = 0; i < 3; i++) M.observe(cprop, 'Tidy the inbox folder ' + i, i);
const pk = M.candidates(cprop)[0].key;
A.eq(M.candidates(cprop, { maxProposed: 2 }).length, 1, 'a never-offered shape is offerable under the nudge ceiling');
M.markProposed(cprop, pk);
A.eq(cprop.shapes[pk].proposed, 1, 'markProposed tallies one offer');
A.eq(M.candidates(cprop, { maxProposed: 2 }).length, 1, 'still offerable after one ignored offer (under the ceiling)');
M.markProposed(cprop, pk);
A.eq(cprop.shapes[pk].proposed, 2, 'markProposed tallies the second offer');
A.eq(M.candidates(cprop, { maxProposed: 2 }).length, 0, 'the seed NUDGE stops offering a shape ignored to the ceiling');
A.eq(M.candidates(cprop).length, 1, 'but the unfiltered candidates() (RECIPES tab) still shows it');
// proposed survives a round-trip
A.eq(M.hydrate(JSON.parse(JSON.stringify(cprop))).shapes[pk].proposed, 2, 'hydrate carries the proposed count');

/* ---------- forget / hydrate ---------- */
const f = M.forget(c0);
A.eq(Object.keys(f.shapes).length, 0, 'forget wipes the tracked shapes');
A.eq(f.enabled, c0.enabled, 'forget keeps the on/off choice');
A.eq(M.forget({}).enabled, true, 'forget defaults a flagless state to enabled');

A.eq(M.hydrate(null).shapes && Object.keys(M.hydrate(null).shapes).length, 0, 'hydrate(null) -> a fresh state');
A.eq(M.hydrate(undefined).enabled, true, 'hydrate of nothing is enabled by default');
const h = M.hydrate({ enabled: false, shapes: { 'k ∎': { count: 4, examples: ['a', 'b'], minted: true, lastAt: 9 }, bad: { count: -1 }, junk: 'nope' } });
A.eq(h.enabled, false, 'hydrate carries the paused flag');
A.eq(h.shapes['k ∎'].count, 4, 'hydrate carries a valid shape');
A.eq(h.shapes['k ∎'].minted, true, 'hydrate carries the minted flag');
A.ok(!h.shapes.bad && !h.shapes.junk, 'hydrate drops malformed/negative-count shapes');

// review hardening: hydrate enforces the MAX_SHAPES bound (a large / tampered blob can't bypass it across reloads)
const big = { enabled: true, shapes: {} };
for (let i = 0; i < M.MAX_SHAPES + 60; i++) big.shapes['verb' + i + ' the ∎'] = { count: (i % 9) + 1, examples: ['ex' + i], lastAt: i };
A.ok(Object.keys(M.hydrate(big).shapes).length <= M.MAX_SHAPES, 'hydrate trims a large blob to the MAX_SHAPES bound');

// review hardening: observe evicts the weakest shape at the cap rather than freezing — learning never permanently stops
const cap = M.fresh();
for (let i = 0; i < M.MAX_SHAPES + 5; i++) M.observe(cap, 'verb' + i + ' the thing', i);
A.ok(Object.keys(cap.shapes).length <= M.MAX_SHAPES, 'observe keeps the tracked-shape count bounded');
M.observe(cap, 'brandnewverb the brandnew thing', 999999);
A.ok(!!cap.shapes[M.normalizeShape('brandnewverb the brandnew thing')], 'a new shape is still learned after the cap (weakest evicted, no freeze)');

// round-trip: fresh -> observe -> JSON -> hydrate preserves the recurrence
const rt = M.fresh(); M.observe(rt, 'Review the alpha module', 1); M.observe(rt, 'Review the beta module', 2); M.observe(rt, 'Review the gamma module', 3);
const re = M.hydrate(JSON.parse(JSON.stringify(rt)));
A.eq(M.candidates(re).length, 1, 'a serialized recurrence still proposes after hydrate');

A.report('mint');
