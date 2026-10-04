/* STARNET — recipefit.test.js : locks the CONTEXT-DRIVEN recipe shelf.

   The point of RecipeFit is that a card on the READY shelf makes a CLAIM about this station ("2 projects
   granted, and nothing watches them"). Every claim is a promise the harness has to be able to back, so the
   assertions below are mostly about what the module must REFUSE to say — an over-eager recommender that
   invents context is worse than no shelf at all, because it teaches the Commander not to trust the station.

   Pure module: no DOM, no fetch, no clock. */
'use strict';
const A = require('./_assert.js');
const F = require('../frontend/app/recipefit.js');
const R = require('../frontend/app/recipes.js');

const recipes = R.builtins();
const FULL = {
  projects: [{ root: 'C:/work/gen', name: 'gen' }, { root: 'C:/work/site', name: 'site' }],
  channels: [{ id: 'tg', label: 'Telegram' }],
  topics: [{ term: 'agent harness', weight: 1.4 }],
  scheduled: [{ recipeId: 'morning-brief' }],
  launches: { 'fix-bug': { n: 4 }, 'summarize': { n: 2, rated: { miss: 2 } } }
};

/* ---------- THE COLD STATION: silence, not theatre ---------- */
A.eq(F.offers(recipes, {}).length, 0, 'a station that knows nothing offers nothing');
A.eq(F.offers(recipes, null).length, 0, 'a null context offers nothing');
A.eq(F.offers(recipes, { launches: { 'fix-bug': { n: 9 } } }).length, 0,
  'launch history ALONE is not context — with no project, channel or topic there is nothing to bind to');
A.eq(F.basis({}), '', 'no basis line without real context');
A.eq(F.hasContext({}), false, 'hasContext is false on a cold station');
A.eq(F.hasContext({ projects: [{ root: 'x' }] }), true, 'one granted project is enough context to start');

/* ---------- THE HONESTY LAW: every claim traces to a counter ---------- */
const offers = F.offers(recipes, FULL, { limit: 8 });
A.ok(offers.length > 0, 'a real station gets offers');
for (const o of offers) {
  A.ok(o.why && o.why.length > 0, o.recipe.id + ' carries a reason (no card without an honest one)');
  // a claim naming a COUNT must name a count the context actually holds
  const m = /(\d+) project/.exec(o.why);
  if (m) A.eq(Number(m[1]), FULL.projects.length, o.recipe.id + ' cites the REAL project count');
  const c = /(\d+) connected channel/.exec(o.why);
  if (c) A.eq(Number(c[1]), FULL.channels.length, o.recipe.id + ' cites the REAL channel count');
  // a named thing must be a thing that was passed in
  if (o.why.indexOf('Telegram') >= 0) A.ok(FULL.channels.some(x => x.label === 'Telegram'), 'names a real channel');
  if (o.why.indexOf('agent harness') >= 0) A.ok(FULL.topics.some(x => x.term === 'agent harness'), 'names a real topic');
}
// the basis line is auditable and states only what was counted
A.eq(F.basis(FULL), '2 projects · 1 connected channel · 1 learned topic · 1 routine already running',
  'the basis line states exactly what the station looked at');

/* ---------- EXCLUSIONS ---------- */
A.ok(!F.offers(recipes, FULL, { limit: 99 }).some(o => o.recipe.id === 'morning-brief'),
  'a recipe already running as a routine is NOT offered again');
A.ok(!F.offers(recipes, FULL, { limit: 99 }).some(o => o.recipe.id === 'summarize'),
  'a recipe the Commander rated a miss stays sunk');

/* a connector recipe must not be offered to a station with no channel connected — that is an advert for a
   feature the Commander does not have, dressed as a readiness claim. */
const noChan = Object.assign({}, FULL, { channels: [] });
for (const o of F.offers(recipes, noChan, { limit: 99 })) {
  A.eq(F.needsOf(o.recipe).channel, false, o.recipe.id + ' needs a channel but none is connected — must not be offered');
}
const noProj = Object.assign({}, FULL, { projects: [] });
for (const o of F.offers(recipes, noProj, { limit: 99 })) {
  A.eq(F.needsOf(o.recipe).folder, false, o.recipe.id + ' needs a folder but none is granted — must not be offered');
}

/* ---------- BINDING: a typed slot is a promise; a key is only a guess ---------- */
// ⛔ the regression that shipped once: PLACE_KEYS matched `where` on promises-made — a CHANNEL recipe whose
// own default reads the connected channels — and silently rewrote it into a folder path, changing the task.
for (const o of F.offers(recipes, FULL, { limit: 99 })) {
  if (F.needsOf(o.recipe).channel) {
    A.eq(o.bound.some(b => b.from === 'project'), false,
      o.recipe.id + ' reads a channel — a project folder must never be bound into it');
  }
}
// a typed folder param binds to a real granted root, never to an invented path
for (const o of F.offers(recipes, FULL, { limit: 99 })) {
  for (const b of o.bound) {
    if (b.from === 'project') A.ok(FULL.projects.some(p => p.name === b.label || p.root === b.label), 'bound to a REAL project');
    if (b.from === 'topic') A.ok(FULL.topics.some(t => t.term === b.label), 'bound to a REAL learned topic');
  }
  for (const k of Object.keys(o.values)) {
    A.ok(o.recipe.params.some(p => p.key === k), o.recipe.id + ' only pre-fills params the recipe declares');
  }
}

/* ---------- KIND MATCH: a granted folder is not self-describing ----------
   ⛔ the regression this locks: a path grant makes a repo and a folder of invoices both "a project", so the
   shelf offered PR Sweep against a landing page. The claim ("2 projects granted") was TRUE and the match was
   obviously wrong to a human, which is the fastest way to lose trust in a recommender. A code recipe may only
   be offered when a granted folder is actually a git repo — real evidence from the projects API. */
const noRepo = { projects: [{ root: '/a', name: 'landing-site', git: false }, { root: '/b', name: 'invoices', git: false }] };
for (const o of F.offers(recipes, noRepo, { limit: 99 })) {
  if (F.needsOf(o.recipe).folder) {
    A.eq(Number((o.recipe.tags || {}).code) > 0, false,
      o.recipe.id + ' is code work but no granted folder is a repo — must not be offered');
  }
}
const oneRepo = { projects: [{ root: '/a', name: 'orbital-api', git: true }, { root: '/b', name: 'landing-site', git: false }] };
const repoOffers = F.offers(recipes, oneRepo, { limit: 99 });
A.ok(repoOffers.some(o => Number((o.recipe.tags || {}).code) > 0), 'a real git repo unlocks code recipes');
// and when a code recipe fires on a repo, the evidence must NAME the repo rather than say "2 projects"
for (const o of repoOffers) {
  if (Number((o.recipe.tags || {}).code) > 0 && F.needsOf(o.recipe).folder) {
    A.ok(o.why.indexOf('orbital-api') >= 0 && o.why.indexOf('git repo') >= 0,
      o.recipe.id + ' names the actual repo as its evidence, got: ' + o.why);
    A.ok(o.why.indexOf('landing-site') < 0, o.recipe.id + ' does not cite the NON-repo folder as the reason');
  }
}
/* ⛔ "nothing watches it" describes a GAP A STANDING RECIPE WOULD FILL, so it may only appear on one. It
   shipped on one-shots too — "Build a Feature: orbital-api is a git repo and nothing watches it" — which is
   nonsense, since a one-shot was never going to watch anything. Caught in a screenshot, not by a DOM read. */
for (const o of F.offers(recipes, oneRepo, { limit: 99 }).concat(F.offers(recipes, noRepo, { limit: 99 }))) {
  if (!o.recipe.cadence) {
    A.ok(o.why.indexOf('watches') < 0,
      o.recipe.id + ' is a one-shot and must not claim to fill a watching gap, got: ' + o.why);
  }
}

/* ---------- SHELF SHAPE ---------- */
const five = F.offers(recipes, FULL, { limit: 5 });
A.ok(five.length <= 5, 'limit is respected');
const buckets = {};
five.forEach(o => { buckets[o.recipe.category] = (buckets[o.recipe.category] || 0) + 1; });
A.ok(Object.keys(buckets).every(k => buckets[k] <= 2),
  'no browse bucket takes more than two of the shelf (a matched pair must not eat the whole row): ' + JSON.stringify(buckets));
A.ok(Object.keys(buckets).length >= 2, 'the shelf spans more than one bucket');

/* ---------- PURITY: same context in, same shelf out ---------- */
A.eq(JSON.stringify(F.offers(recipes, FULL).map(o => o.recipe.id)),
  JSON.stringify(F.offers(recipes, FULL).map(o => o.recipe.id)),
  'offers() is deterministic for a fixed context');
// and it must not mutate what it was handed
const before = JSON.stringify(FULL);
F.offers(recipes, FULL, { limit: 99 });
A.eq(JSON.stringify(FULL), before, 'offers() does not mutate the context it was given');

/* ---------- GARBAGE IN ---------- */
A.eq(F.offers(null, FULL).length, 0, 'a null recipe list offers nothing');
A.eq(F.offers(recipes, { projects: 'not-an-array' }).length, 0, 'a malformed context is treated as no context');
A.ok(F.offers([{ id: 'x' }, null, { name: 'no id' }], FULL).length >= 0, 'malformed recipes do not throw');

A.report('recipefit');
