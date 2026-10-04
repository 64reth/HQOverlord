/* node test/prospect.test.js — the pure prospect generator (frontend/app/prospect.js) + the store cadence/denylist
   (frontend/app/prospectstore.js).
   Locks Slice 4's promises: buildDirective constrains kit/skills to the real sets + supports a NONE reply; parse
   round-trips a well-formed draft; HARD validation rejects an unknown kit key, an unknown skill slug, a near-
   duplicate of an existing class, and a partial spec; NONE parses to a sentinel (no draft); cold-start mints
   nothing; the growth+cooldown+warm gate holds; and dismissing a prospect denylists it so an equivalent never
   re-mints. Deterministic — no clock/rng in the pure module. */
'use strict';
const A = require('./_assert.js');
const P = require('../frontend/app/prospect.js');

const CAPS = ['dish', 'cabinet', 'notebook', 'workbench', 'studio', 'connector'];
const SLUGS = ['web-research', 'price-watch', 'humanizer'];
const EXISTING = [
  { name: 'Researcher', tagline: 'Web research & sourced briefs', tags: { research: 1 } },
  { name: 'Engineer', tagline: 'Write, debug & ship code', tags: { code: 1 } }
];
const opts = { allowedKit: CAPS, allowedSkills: SLUGS, existingClasses: EXISTING };

// a well-formed model reply (a role no existing class serves: a market-intel specialist)
const GOOD = [
  'NAME: Market Analyst',
  'EMOJI: ⊞',
  'TAGLINE: Live competitive-pricing intel',
  'PURPOSE: You track competitor pricing across the live web and brief the Commander on moves that matter.',
  'MANUAL: Fetch real listings | Cite every price with source + date | Flag only meaningful moves',
  'KIT: dish, cabinet, notebook',
  'SKILLS: price-watch, web-research',
  'WHY: most of your recent work used the dish for competitive research and no class produces a pricing brief'
].join('\n');

/* ---------- buildDirective: constrains to the real sets + offers NONE ---------- */
const dir = P.buildDirective({ capabilityKeys: CAPS, skillSlugs: SLUGS, rosterClasses: [{ name: 'Chief of Staff' }], catalogSummary: EXISTING.map(c => ({ id: c.name.toLowerCase(), tagline: c.tagline })), worksignalSummary: 'dish-heavy (research)', topRecommendation: 'researcher' });
A.ok(dir.indexOf('dish') >= 0 && dir.indexOf('price-watch') >= 0, 'the directive lists the real capability + skill sets');
A.ok(/NONE/.test(dir), 'the directive offers a NONE reply when a class already serves the gap');
A.ok(dir.indexOf('researcher') >= 0, 'the directive names the recruiter top pick so the draft avoids duplicating it');

/* ---------- parse round-trip: a well-formed draft ---------- */
const good = P.parse(GOOD, opts);
A.ok(good && !good.none && good.draft, 'a well-formed reply parses to a draft');
A.eq(good.draft.name, 'Market Analyst', 'parse carries the name');
A.eq(good.draft.tagline, 'Live competitive-pricing intel', 'parse carries the tagline');
A.eq(good.draft.kit, ['dish', 'cabinet', 'notebook'], 'parse carries the validated kit');
A.eq(good.draft.skills, ['price-watch', 'web-research'], 'parse carries the validated skills');
A.ok(good.draft.manual.indexOf('- Fetch real listings') >= 0, 'MANUAL splits on | into standing-order bullets');
A.ok(good.why.length > 0, 'parse carries the grounded WHY');
A.eq(good.draft.custom, true, 'the draft is a custom spec');

/* an EMPTY field (SKILLS:) followed by another field must NOT swallow the next line — a common real LLM shape */
const emptySkills = [
  'NAME: Cold Caller', 'EMOJI: ☎', 'TAGLINE: outbound sales outreach drafts',
  'PURPOSE: Drafts outbound outreach the Commander can send.', 'MANUAL: keep it short',
  'KIT: cabinet, notebook', 'SKILLS:',   // deliberately empty, immediately before WHY
  'WHY: your work leaned on files with no outreach role rostered'
].join('\n');
const es = P.parse(emptySkills, opts);
A.ok(es && es.draft, 'a draft with an EMPTY SKILLS field still parses (empty field does not swallow the next line)');
A.eq(es.draft.skills, [], 'an empty SKILLS field yields no skills (not the WHY line miscaptured)');
A.ok(/outreach/.test(es.why), 'WHY is captured correctly even when the preceding field was empty');

/* ---------- NONE handling ---------- */
A.eq(P.parse('NONE', opts).none, true, 'a bare NONE reply parses to the no-mint sentinel');
A.eq(P.parse('  none  ', opts).none, true, 'NONE is case/space tolerant');
const fullWithNoneWord = GOOD + '\nEXTRA: this role is NONE of the others';   // a full draft that merely mentions "none"
A.ok(P.parse(fullWithNoneWord, opts) && P.parse(fullWithNoneWord, opts).draft, 'a full draft that merely mentions the word none is still parsed as a draft, not NONE');

/* ---------- HARD validation: reject bad kit / skill / duplicate / partial ---------- */
const badKit = GOOD.replace('KIT: dish, cabinet, notebook', 'KIT: dish, teleporter');   // teleporter is not a real cap
A.eq(P.parse(badKit, opts), null, 'an unknown kit key rejects the whole draft (no fabricated capability)');
const badSkill = GOOD.replace('SKILLS: price-watch, web-research', 'SKILLS: price-watch, telepathy');
A.eq(P.parse(badSkill, opts), null, 'an unknown skill slug rejects the draft');
const noKit = GOOD.replace('KIT: dish, cabinet, notebook', 'KIT: ');
A.eq(P.parse(noKit, opts), null, 'a specialist with no kit is rejected (not a real role)');
const partial = 'NAME: Foo\nEMOJI: x\nKIT: dish';   // missing tagline/purpose/why
A.eq(P.parse(partial, opts), null, 'a partial spec (missing load-bearing fields) is rejected');

/* near-duplicate of an existing class → rejected */
const dupName = GOOD.replace('NAME: Market Analyst', 'NAME: Researcher');
A.eq(P.parse(dupName, opts), null, 'an exact name clash with an existing class is rejected');
const dupTag = [
  'NAME: Web Digger', 'EMOJI: ◎', 'TAGLINE: Web research and sourced briefs',
  'PURPOSE: Does web research and writes sourced briefs.', 'MANUAL: cite sources',
  'KIT: dish, notebook', 'SKILLS: web-research',
  'WHY: your work used the dish a lot'
].join('\n');
A.eq(P.parse(dupTag, opts), null, 'a heavy tag/tagline overlap with an existing class is rejected as a near-duplicate');

/* a distinct role with the SAME kit as an existing class is still allowed (kit overlap != duplicate) */
A.ok(P.parse(GOOD, opts).draft, 'a distinct role sharing kit with an existing class is NOT a duplicate');

/* ---------- fingerprint stability (denylist keying) ---------- */
A.eq(P.fingerprint('Market Analyst'), P.fingerprint('analyst market'), 'the fingerprint is order-insensitive (reordered names match)');

/* ---------- store: the SCOUT CLIENT (server truth cached; legacy hydrated; decide flows) ----------
   The mint itself moved server-side (sidecar scout — covered by test/scout.test.js + test/scout.http.test.js);
   this store is now the thin client. Prove: init pushes context + reads /api/scout; server prospects render
   through the SAME card shape; recipe drafts + interests (with evidence) are exposed; a legacy localStorage
   draft still renders and decides LOCALLY (dismiss denylists); a server draft decides via POST + optimistic
   cache drop. */
global.Prospect = P;   // kept a browser global for any residual consumers
const { ProspectStore } = require('../frontend/app/prospectstore.js');
global.localStorage = { _s: {}, getItem(k){ return this._s[k] == null ? null : this._s[k]; }, setItem(k,v){ this._s[k]=v; }, removeItem(k){ delete this._s[k]; } };

(async () => {
  const calls = [];
  const PAYLOAD = {
    warm: true,
    gate: { fire: false, binding: 'cooldown', runsSinceMint: 1, mintEveryRuns: 3 },
    interests: [{ topic: 'stock-research', label: 'stock research', weight: 2.1, count: 3, evidence: ['NVDA earnings and the market reaction'] }],
    staged: [
      { id: 'sp1', kind: 'prospect', draft: { name: 'Market Analyst', kit: ['dish'] }, why: 'dish-heavy research, no pricing role', fingerprint: 'fp-sp1', at: 5 },
      { id: 'sr1', kind: 'recipe', draft: { name: 'Stock Radar', task: 'Check {t}.', params: [{ key: 't' }] }, why: 'you keep asking about stocks', fingerprint: 'fp-sr1', at: 6 }
    ],
    ledger: [
      { at: 5, kind: 'prospect', outcome: 'staged', reason: 'dish-heavy research, no pricing role', title: 'Market Analyst' },
      { at: 7, kind: 'recipe', outcome: 'rejected', reason: 'draft failed hard validation (near-duplicate)', title: '' }
    ]
  };
  const fakeFetch = async (u, init) => {
    calls.push({ u: u, init: init || {} });
    if (u === '/api/scout') return { ok: true, json: async () => JSON.parse(JSON.stringify(PAYLOAD)) };
    return { ok: true, json: async () => ({ ok: true }) };
  };

  // a legacy draft staged by a pre-scout build survives the upgrade
  localStorage.setItem('starnet.prospects.v1', JSON.stringify({ v: 1, prospects: [{ id: 'legacy1', draft: { name: 'Old Draft' }, why: 'w', fingerprint: 'fp-legacy' }], denylist: [] }));

  ProspectStore.init({
    fetch: fakeFetch,
    getCustomRecipes: () => [{ name: 'My Recipe', tagline: 't' }],
    getWorksignalSummary: () => 'dish-heavy',
    getTopRecommendation: () => 'researcher'
  });
  await new Promise(r => setTimeout(r, 10));   // let init's pushContext + refresh settle

  const ctxCall = calls.find(c => c.u === '/api/scout/context');
  A.ok(!!ctxCall, 'init pushes the browser-only context to the server');
  A.ok(JSON.parse(ctxCall.init.body).customRecipes[0].name === 'My Recipe', 'the context push carries the custom recipes');
  A.ok(calls.some(c => c.u === '/api/scout'), 'init reads server truth from /api/scout');

  const items = ProspectStore.list();
  A.eq(items.length, 2, 'the shelf merges the legacy draft with the server-staged prospect');
  A.ok(items.some(p => p.id === 'sp1' && p.draft.name === 'Market Analyst'), 'a server prospect renders through the same card shape');
  A.eq(ProspectStore.recipeDrafts().length, 1, 'server recipe drafts are exposed for the SUGGESTED shelf');
  A.eq(ProspectStore.recipeDrafts()[0].draft.name, 'Stock Radar', 'the recipe draft round-trips intact');
  A.eq(ProspectStore.warm(), true, 'warmth mirrors the server read');
  A.ok(ProspectStore.interests()[0].evidence.length > 0, 'interests carry their evidence quotes');
  A.eq(ProspectStore.gate().binding, 'cooldown', 'the live gate binding is exposed (honest shelf copy)');
  // the attempt ledger is exposed for the SCOUT LOG view — server truth, every recorded outcome (truthful telemetry)
  A.eq(ProspectStore.ledger().length, 2, 'the scout attempt ledger is exposed for the SCOUT LOG');
  A.eq(ProspectStore.ledger()[0].outcome, 'staged', 'a MINTED (staged) outcome round-trips with its reason');
  A.eq(ProspectStore.ledger()[1].outcome, 'rejected', 'a REJECTED outcome round-trips (a dismissed draft is not the whole story)');

  // LEGACY decide: local, dismiss denylists (never re-mint an equivalent client-side draft)
  A.eq(ProspectStore.dismiss('legacy1'), true, 'a legacy draft dismisses locally');
  A.eq(ProspectStore.isDenied('fp-legacy'), true, 'the legacy dismissal denylists its fingerprint');

  // SERVER decide: optimistic drop + POSTed verdict
  const before = calls.length;
  A.eq(ProspectStore.dismiss('sp1'), true, 'a server draft dismisses');
  A.eq(ProspectStore.list().length, 0, 'the dismissed server draft drops from the shelf instantly');
  await new Promise(r => setTimeout(r, 10));
  const decide = calls.slice(before).find(c => c.u === '/api/scout/decide');
  A.ok(!!decide, 'the dismiss verdict POSTs to /api/scout/decide');
  A.eq(JSON.parse(decide.init.body).decision, 'dismiss', 'the verdict carries the decision');
  A.eq(ProspectStore.accept('sr1'), true, 'a server recipe draft accepts');
  A.eq(ProspectStore.recipeDrafts().length, 0, 'the accepted draft leaves the staging list');
  A.eq(ProspectStore.dismiss('nope'), false, 'deciding an unknown id is a no-op');

  A.report('prospect');
})();
