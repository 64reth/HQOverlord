/* node test/topicmatch.test.js — the LEARNED-TOPIC recommendation lane (2026-07-28).

   The station has always learned WHAT the Commander keeps working on (sidecar/interests.js: an evidence-backed,
   decaying topic histogram), but only the LLM drafting paths could read it. This lane feeds that signal to the
   three DETERMINISTIC recommendation surfaces — the FOR YOU recipe row, the bay's class shelves, and the night
   shift's focus resolver — plus opens the one recommendation the curated shelf structurally cannot make ("you
   keep asking about X and nobody on the crew covers it").

   WHAT THIS FILE EXISTS TO PROTECT — the promise the lane was built under: it must be IMPOSSIBLE for the topic
   term to make an existing recommendation worse. So the assertions below are mostly NEGATIVE:
     · the ANCHOR RULE — below the warm floor the contribution is exactly 0, so a cold/calibrating station ranks
       byte-identically to how it ranked before this code existed (proven by direct comparison, on all 4 surfaces);
     · MAJORITY COVERAGE — a single grazing token is not a match (the precision rule the archetype shelf learned);
     · ADDITIVE ONLY — the term can raise a score, never lower one, so it can never shrink a shelf the way the
       negative outcome term once emptied the FOR YOU row (2026-07-26);
     · BOUNDED — the night-shift boost is a tie-break, not a re-ranker: it may reorder near-neighbours and must
       NOT be able to drag a stale project over fresh work;
     · CITED — every promotion carries the real topic label + its real observation count (truthful telemetry).
   Pure/headless: no DOM, no clock, no network. */
'use strict';
const A = require('./_assert.js');
const TM = require('../frontend/app/topicmatch.js');
const R = require('../frontend/app/recipes.js');
const Recruiter = require('../frontend/app/recruiter.js');
const NF = require('../sidecar/nightfocus.js');

/* ============================ 1. the matcher itself ============================ */

const WARM = [{ label: 'gpu price tracking', weight: 1.4, count: 5, evidence: ['track 3080 prices'] }];
const COLD = [{ label: 'gpu price tracking', weight: 0.4, count: 1, evidence: ['track 3080 prices'] }];
const CORPUS = 'Price Watch — tracks GPU prices daily and reports the delta';

A.eq(TM.tokens('gpu price tracking').join(','), 'price,track', 'tokens drop sub-4-char words and stem the rest');
A.eq(TM.tokens('the daily project work').length, 0, 'a label of pure stopwords yields no tokens (matches nothing, by design)');
A.eq(TM.coverage('gpu price tracking', CORPUS), 1, 'a corpus containing every significant token covers the topic fully');
A.ok(TM.coverage('gpu price tracking', 'a price list') === 0.5, 'one of two tokens is HALF coverage');
A.eq(TM.match(WARM, 'a price list'), null, 'HALF coverage is not a match — a majority is required (the precision rule)');

const m = TM.match(WARM, CORPUS);
A.ok(!!m, 'a warm, fully-covered topic matches');
A.ok(m.score > 0, 'a match carries a positive score');
A.eq(m.top.label, 'gpu price tracking', 'the match names the real topic');
A.eq(m.top.count, 5, 'the match carries the topic\'s REAL observation count');
A.ok(TM.reason(m).indexOf('gpu price tracking') >= 0 && TM.reason(m).indexOf('5×') >= 0, 'the WHY cites the real label and count: ' + TM.reason(m));

// THE ANCHOR RULE — the whole safety story rests on this one line.
A.eq(TM.match(COLD, CORPUS), null, 'a BELOW-WARM topic never matches, however well it is covered (the anchor rule)');
A.eq(TM.match(WARM, ''), null, 'an empty corpus never matches');
A.eq(TM.match(null, CORPUS), null, 'absent topics never match');
A.eq(TM.term(null, 1.5, 3), 0, 'no match contributes exactly 0');
A.eq(TM.term({ score: 100 }, 1.5, 3), 3, 'the term is capped — an unbounded histogram can never swamp the other signals');
A.eq(TM.warmTopics(COLD).length, 0, 'warmTopics filters out everything below the floor');
A.eq(TM.warmTopics(WARM).length, 1, 'warmTopics keeps a real habit');

/* ============================ 2. the FOR YOU recipe row ============================ */

const items = R.builtins();
// a REALISTIC profile scorer: ProfileStore.score dots a recipe's tags with the Commander's NORMALIZED interest
// vector, so real affinities land in the 0.2–0.7 band, not at 1.0. Testing against a saturated 1.0 scorer would
// let the affinity term dwarf every other signal and prove nothing about how the blend actually behaves.
const VECTOR = { research: 0.5, code: 0.2, general: 0.3 };
const profile = tags => Object.keys(VECTOR).reduce((s, k) => s + (Number(tags && tags[k]) || 0) * VECTOR[k], 0);

// THE IDENTITY PROPERTY: cold topics change NOTHING, on every input shape.
for (const opts of [
  { score: profile, goalText: 'ship code', limit: 4 },
  { score: () => 0, goalText: '', limit: 5 },
  { launches: { 'summarize': { n: 3 } }, limit: 4 },
  { launches: { 'summarize': { n: 1, rated: { miss: 2 } } }, score: () => 0, goalText: '', limit: 5 }
]) {
  const before = R.rankRecipes(items, opts).map(r => r.id).join(',');
  const after = R.rankRecipes(items, Object.assign({}, opts, { topics: COLD })).map(r => r.id).join(',');
  A.eq(after, before, 'a cold histogram leaves the FOR YOU row byte-identical (limit ' + opts.limit + ')');
}
const noTopics = R.rankRecipes(items, { score: profile, limit: 4 });
A.eq(R.rankRecipes(items, { score: profile, topics: [], limit: 4 }).map(r => r.id).join(','), noTopics.map(r => r.id).join(','), 'an EMPTY topic list is identical to passing none');

// ADDITIVE ONLY: with a live profile (the only state in which topics are ever passed — marketplace gates both on
// the same learning switch), a warm topic can only ever ADD survivors. It must never shrink the row.
const warmRow = R.rankRecipes(items, { score: profile, topics: WARM, limit: 8 });
const plainRow = R.rankRecipes(items, { score: profile, limit: 8 });
A.ok(warmRow.length >= plainRow.length, 'a warm topic never shrinks the row: ' + plainRow.length + ' → ' + warmRow.length);
for (const r of plainRow) A.ok(warmRow.some(x => x.id === r.id), 'every previously-ranked recipe survives the topic term: ' + r.id);

// …and it PROMOTES what the Commander demonstrably keeps doing. A synthetic recipe nobody would rank without the
// topic (zero research affinity, no launches, no goal words) must climb into the row on topic evidence alone.
const withNiche = items.concat([{ id: 'niche-gpu', name: 'GPU Price Watch', tagline: 'tracks gpu prices daily',
  blurb: 'watch prices', category: 'ops', tags: { general: 1 }, accent: '#fff' }]);
const nicheOff = R.rankRecipes(withNiche, { score: profile, limit: 3 });
const nicheOn = R.rankRecipes(withNiche, { score: profile, topics: WARM, limit: 3 });
A.ok(!nicheOff.some(r => r.id === 'niche-gpu'), 'without topics the niche recipe does not rank (no other signal touches it)');
A.ok(nicheOn.some(r => r.id === 'niche-gpu'), 'a warm learned topic promotes the recipe the Commander actually keeps working on');
A.eq(R.rankRecipes(withNiche, { score: profile, topics: COLD, limit: 3 }).map(r => r.id).join(','), nicheOff.map(r => r.id).join(','), 'and a COLD topic promotes nothing');

// determinism (the whole file's contract: same input → same order)
A.eq(R.rankRecipes(withNiche, { score: profile, topics: WARM, limit: 3 }).map(r => r.id).join(','), nicheOn.map(r => r.id).join(','), 'the topic term is deterministic for a fixed input');
// garbage tolerance — a malformed histogram must degrade to silence, never throw into the shelf render
for (const junk of [[{ label: '', weight: 9 }], [{ label: 'x', weight: NaN }], [null], 'nope', 42])
  A.notThrows(() => R.rankRecipes(items, { score: profile, topics: junk, limit: 3 }), 'a malformed topic list never throws');

/* ============================ 3. the honest WHY ============================ */

const niche = withNiche[withNiche.length - 1];
A.eq(R.forYouReason(niche, { topics: WARM }), TM.reason(TM.match(WARM, 'GPU Price Watch tracks gpu prices daily watch prices general ops')), 'the FOR YOU reason is the topic WHY when a topic matched');
// (the reason leads with "it" so the shared "because …" framing composes into a sentence — see recommend.js whyLine)
A.ok(R.forYouReason(niche, { topics: COLD, goalText: 'watch prices closely' }).indexOf('it matches your goal') === 0, 'a goal match is named when no topic matched');
A.eq(R.forYouReason(niche, { launches: { 'niche-gpu': { n: 2, rated: { great: 3 } } } }), 'you rated this work great 3×', 'the Commander\'s own verdicts are cited before raw launches');
A.eq(R.forYouReason(niche, { launches: { 'niche-gpu': { n: 4 } } }), 'you have launched this 4×', 'a launch count is cited when nothing stronger fired');
A.eq(R.forYouReason(niche, {}), '', 'with NO real signal the card claims no reason at all (never a fabricated one)');
A.eq(R.forYouReason(null, { topics: WARM }), '', 'a missing recipe yields no reason');
// the reason must never disagree with the rank: whatever it names has to be a signal that actually scored.
A.ok(R.topicScore(niche, WARM) > 0 && R.topicScore(niche, COLD) === 0, 'the cited topic is the same one that scored');

/* ============================ 4. the INTEREST GAP (the recommendation recommend() cannot make) ============================ */

const CATALOG = [
  { id: 'analyst', name: 'Analyst', tagline: 'digs through numbers', blurb: 'reads reports', kit: ['dish'], tags: { research: 1 } },
  { id: 'pricehawk', name: 'Price Hawk', tagline: 'tracks prices across the web', blurb: 'price tracking on a cadence', kit: ['dish'], tags: { research: 1 } },
  { id: 'coder', name: 'Coder', tagline: 'writes and fixes code', blurb: 'ships patches', kit: ['workbench'], tags: { code: 1 } }
];

const gap = Recruiter.interestGaps({ topics: WARM, roster: ['coder'], catalog: CATALOG });
A.eq(gap.items.length, 1, 'a warm topic nobody covers surfaces exactly one uncovered hire');
A.eq(gap.items[0].classId, 'pricehawk', 'it names the catalog class that actually covers the topic');
A.ok(gap.items[0].why.indexOf('gpu price tracking') >= 0, 'the why names the real topic');
A.ok(gap.items[0].why.indexOf('5×') >= 0, 'the why cites the real observation count');
A.ok(gap.items[0].why.indexOf('nobody on the crew covers it') >= 0, 'the why states the actual claim being made');

// the gap CLOSES the moment the crew covers it — by roster id…
A.eq(Recruiter.interestGaps({ topics: WARM, roster: ['pricehawk'], catalog: CATALOG }).items.length, 0, 'a rostered class that covers the topic closes the gap');
// …or by a CUSTOM class the catalog never held (rosterSpecs) — a custom specialist absolutely counts.
A.eq(Recruiter.interestGaps({ topics: WARM, roster: [], catalog: CATALOG,
  rosterSpecs: [{ name: 'My Tracker', tagline: 'price tracking bot', blurb: '', tags: {} }] }).items.length, 0, 'a CUSTOM crew class covering the topic closes the gap too');
// cold topics never claim a gap; neither does a topic nothing in the catalog serves.
A.eq(Recruiter.interestGaps({ topics: COLD, roster: [], catalog: CATALOG }).items.length, 0, 'a below-warm topic never claims a gap');
A.eq(Recruiter.interestGaps({ topics: [{ label: 'medieval falconry', weight: 3, count: 9 }], roster: [], catalog: CATALOG }).items.length, 0, 'a topic NOTHING in the catalog covers surfaces nothing (never a wrong hire)');
A.eq(Recruiter.interestGaps({}).items.length, 0, 'no inputs → no claim');
A.ok(Recruiter.interestGaps({ topics: WARM, roster: [], catalog: CATALOG }).items.length <= Recruiter.GAP_LIMIT, 'the gap shelf is capped');

// AND THE WALL STAYS UP: recommend() is untouched — passing topics changes nothing about the curated shelf.
const recArgs = { worksignal: null, roster: [], catalog: CATALOG, dossier: {}, now: 0 };
A.eq(JSON.stringify(Recruiter.recommend(Object.assign({ topics: WARM }, recArgs))), JSON.stringify(Recruiter.recommend(recArgs)), 'recommend() ignores topics entirely — the curated shelf is byte-identical');

/* ============================ 5. the night shift's focus ============================ */

const DAY = 86400000, NOW = 1000 * DAY;
const PRICE_TOPIC = [{ label: 'pricewatch tracker', weight: 1.4, count: 5 }];   // both tokens appear in the root below
const twoProjects = (staleDays) => ({
  projects: [
    { root: '/w/fresh', displayPath: '/w/fresh', lastTouchedAt: NOW, isGitRepo: true },
    { root: '/w/pricewatch-tracker', displayPath: '/w/pricewatch-tracker', lastTouchedAt: NOW - staleDays * DAY, isGitRepo: true }
  ], threads: [], quests: [], goal: null, northStar: null
});

// IDENTITY: a cold histogram resolves the identical focus.
const near = twoProjects(5);
const plain = NF.resolveFocus(near, { now: NOW });
A.eq(NF.resolveFocus(Object.assign({ topics: COLD }, near), { now: NOW }).ref, plain.ref, 'a cold histogram resolves the SAME focus as no topics at all');
A.eq(plain.ref, '/w/fresh', 'without topics the most recently touched project wins (pure recency, as before)');

// TIE-BREAK: a warm topic flips a NEAR-neighbour…
const flipped = NF.resolveFocus(Object.assign({ topics: PRICE_TOPIC }, near), { now: NOW });
A.eq(flipped.ref, '/w/pricewatch-tracker', 'a warm topic flips a near-tie toward the subject the Commander keeps working on');
A.ok(flipped.why.some(w => w.indexOf('pricewatch tracker') >= 0), 'the flipped focus CITES the topic that moved it: ' + JSON.stringify(flipped.why));
A.ok(flipped.why.length >= 2, 'the topic line is ADDED to the existing evidence, never replaces it');

// …and CANNOT drag a stale project over fresh work. This is the line between a tie-break and a re-ranker.
const stale = twoProjects(20);
A.eq(NF.resolveFocus(Object.assign({ topics: [{ label: 'pricewatch tracker', weight: 9, count: 99 }] }, stale), { now: NOW }).ref,
  '/w/fresh', 'even a hugely-weighted topic cannot drag a 20-day-stale project over fresh work (the boost is bounded)');
A.ok(NF.TOPIC_BOOST_MAX <= 0.25, 'the night-shift boost stays a tie-break: ' + NF.TOPIC_BOOST_MAX);

// the boost reaches threads and quests too, and stays absent on a miss.
const threadInp = { projects: [], threads: [{ id: 't1', title: 'chase gpu price tracking', spec: '', updatedAt: NOW }], quests: [], goal: null, northStar: null };
const tFocus = NF.resolveFocus(Object.assign({ topics: WARM }, threadInp), { now: NOW });
A.ok(tFocus.why.some(w => w.indexOf('gpu price tracking') >= 0), 'a thread focus cites a matching topic too');
A.eq(NF.topicBoost(WARM, 'nothing relevant here'), null, 'no match → no boost and no cited why');
A.eq(NF.topicBoost(COLD, CORPUS), null, 'a cold topic never boosts a focus');

// a STEER still outranks everything, topics included — the user's explicit word is never overridden by inference.
A.eq(NF.resolveFocus(Object.assign({ topics: [{ label: 'pricewatch tracker', weight: 9, count: 99 }], steer: { ref: '/w/fresh', kind: 'project', setAt: NOW } }, near), { now: NOW }).source,
  'steer', 'a durable steer still outranks the strongest possible topic evidence');

A.report('topicmatch');
