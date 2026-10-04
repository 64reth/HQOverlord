/* test/prop-search.test.js — the PURE palette search matcher (frontend/app/propsearch.js).

   Asserted against the REAL PropSprites.CATALOG and the REAL label maps, so a renamed prop, a new
   category, or a new capability badge that would quietly become unfindable in REFIT fails HERE rather
   than in front of the Commander.

   The two closing blocks are the load-bearing ones, and they are written to cover props that DO NOT
   EXIST YET: every prop must be reachable by its own label, and every word the palette PRINTS on a
   tile or a tab must be typeable. Add a prop, a category or a grant tomorrow and these still hold it
   to account without anyone editing this file. */
'use strict';
const A = require('./_assert.js');
const PropSearch = require('../frontend/app/propsearch.js');
const PropSprites = require('../frontend/app/propsprites.js');
const WorldModel = require('../frontend/app/worldmodel.js');

const C = PropSprites.CATALOG;
// the SAME surfaces build.js searches on — imported, never re-declared. A hand-copied CAT_LABEL here
// is how the tab and the test drift until the test asserts a label no user can see.
const CAT_LABEL = PropSprites.CAT_LABEL, TIER_LABEL = PropSprites.TIER_LABEL;
const OPTS = {
  catLabel: c => CAT_LABEL[c] || String(c || '').toUpperCase(),
  tierLabel: t => TIER_LABEL[t] || String(t || '').toUpperCase(),
  extra: c => WorldModel.grantLabelForProp(c && c.id) || '',
};
const match = q => PropSearch.matchProps(C, q, OPTS);
const ids = q => match(q).map(c => c.id);

A.ok(C.length > 100, 'catalog is the real one (' + C.length + ' props)');

/* ---- active(): a blank query is BROWSING, not a zero-result search ---- */
A.eq(PropSearch.active(''), false, 'empty query is not a search');
A.eq(PropSearch.active('   '), false, 'whitespace-only query is not a search');
A.eq(PropSearch.active('mug'), true, 'a real word is a search');
A.eq(ids('').length, 0, 'no query matches nothing (the caller shows the tabs instead)');

/* ---- the basics ---- */
A.ok(ids('mug').indexOf('mug') >= 0, 'MUG is findable by name');
A.ok(ids('MUG').indexOf('mug') >= 0, 'search is case-insensitive');
A.ok(ids('pinball').indexOf('pinball') >= 0, 'PINBALL is findable');
A.eq(ids('zzzznotaprop').length, 0, 'an unknown word matches nothing');

/* ---- tokens are ANDed, not ORed: "desk lamp" must NARROW to the lamp, not list every desk ---- */
const deskLamp = ids('desk lamp');
A.ok(deskLamp.indexOf('desklamp') >= 0, '"desk lamp" finds DESK LAMP');
A.eq(deskLamp.indexOf('desk'), -1, '"desk lamp" does NOT drag in the plain DESK (tokens are ANDed)');
A.eq(deskLamp.join(','), ids('lamp desk').join(','), 'token order does not matter');

/* ---- one query reaches ACROSS both tiers — the whole point of the box ---- */
const desks = match('desk');
A.ok(desks.some(c => c.tier === 'functional'), '"desk" reaches the functional tier');
A.ok(desks.some(c => c.tier === 'cosmetic'), '"desk" reaches the cosmetic tier too');

/* ---- a category is searchable by id AND by its display label ---- */
const loungeIds = ids('lounge');
for (const id of ['couch', 'bookshelf', 'beanbag', 'pinball']) {
  A.ok(loungeIds.indexOf(id) >= 0, '"lounge" returns the whole lounge shelf (' + id + ')');
}
A.ok(ids('workstations').indexOf('desk') >= 0, 'the DISPLAY label ("WORKSTATIONS") is searchable');

/* ---- the TIER is searchable by key AND by the words printed on the tab ---- */
const functional = C.filter(c => c.tier === 'functional');
const cosmetic = C.filter(c => c.tier === 'cosmetic');
A.eq(ids('functional').length, functional.length, 'the tier KEY returns exactly that tier (' + functional.length + ')');
A.eq(ids('systems').length, functional.length, '"SYSTEMS" — the word on the tab — returns the whole functional tier');
A.ok(ids('systems').every(id => functional.some(c => c.id === id)), '"systems" returns ONLY functional props');
// "DECOR" is both a tier label and a category id, so it must return the whole tier, not just the shelf
A.eq(ids('decor').length, cosmetic.length, '"DECOR" returns the whole cosmetic tier, not only the decor category');

/* ---- the GRANT badge printed on a tile is typeable ---- */
A.ok(ids('compute').indexOf('desk') >= 0, 'the COMPUTE badge finds the props that grant it');
A.ok(ids('compute').every(id => WorldModel.grantLabelForProp(id) === 'COMPUTE'),
  '"compute" returns ONLY props that actually grant COMPUTE');
// a two-word grant still works, because tokens are ANDed across the same haystack
A.ok(ids('live tools').length > 0, 'a two-word grant ("LIVE TOOLS") is searchable');

/* ---- `desc` is searchable, but ALWAYS ranks below every name match ---- */
const withDesc = C.filter(c => c.desc);
A.ok(withDesc.length > 0, 'some props carry a desc (' + withDesc.length + ')');
const assign = match('assign');   // appears only in WORKSTATION descs, never in a label/id/cat
A.ok(assign.length > 0, 'a word that lives only in a desc still finds its props');
const nameHit = c => PropSearch.haystack(c, OPTS).indexOf('bar') >= 0;
const bars = match('bar');
const firstDescOnly = bars.findIndex(c => !nameHit(c));
const lastName = bars.map(nameHit).lastIndexOf(true);
A.ok(firstDescOnly === -1 || firstDescOnly > lastName, 'every desc-only hit sorts after every name hit');

/* ---- ranking: a label that starts with the query comes first ---- */
A.eq(String(desks[0].label).toLowerCase().indexOf('desk'), 0, 'a label-prefix match ranks first');

/* ---- opts is optional, and a bare function is still read as catLabel (callers stay simple) ---- */
A.ok(PropSearch.matchProps(C, 'mug').some(c => c.id === 'mug'), 'the matcher works with no opts at all');
A.ok(PropSearch.matchProps(C, 'workstations', x => CAT_LABEL[x]).some(c => c.id === 'desk'),
  'a bare function third arg is read as catLabel');

/* ================= THE LAWS — these must hold for props that do not exist yet ================= */

/* 1. no prop may be unfindable by its own label */
for (const c of C) {
  A.ok(match(c.label).some(x => x.id === c.id),
    c.id + ' is findable by typing its own label ("' + c.label + '")');
}

/* 2. every category in the catalog has a display label, and BOTH forms find that shelf. A new
      category added to the catalog without a CAT_LABEL entry fails here, before the tab renders
      as a raw id. */
for (const cat of Object.keys(PropSprites.CATS)) {
  A.ok(CAT_LABEL[cat], 'category "' + cat + '" has a display label on the tab');
  const shelf = PropSprites.CATS[cat];
  A.ok(ids(cat).length >= shelf.length, 'the category id "' + cat + '" finds its whole shelf');
  A.ok(ids(CAT_LABEL[cat]).length >= shelf.length,
    'the category LABEL "' + CAT_LABEL[cat] + '" finds its whole shelf');
}

/* 3. every word the palette PRINTS on a tile badge is typeable, and only ever returns props that
      really carry it. Add a capability tomorrow and this covers it with no edit here. */
const grants = {};
for (const c of C) { const g = WorldModel.grantLabelForProp(c.id); if (g) (grants[g] = grants[g] || []).push(c.id); }
A.ok(Object.keys(grants).length > 0, 'the catalog grants at least one capability');
for (const [g, members] of Object.entries(grants)) {
  const hits = ids(g);
  for (const id of members) A.ok(hits.indexOf(id) >= 0, 'grant "' + g + '" finds ' + id);
  // No hit may be a stranger: it either GRANTS the word or visibly CARRIES it. Both are honest
  // answers to typing it — a grant word can also be a prop name (TERMINAL grants LIVE TOOLS while a
  // different prop grants TERMINAL), and suppressing the same-named prop would be the real surprise.
  A.ok(hits.every(id => {
    if (WorldModel.grantLabelForProp(id) === g) return true;
    const c = C.find(x => x.id === id);
    return PropSearch.haystack(c, OPTS).indexOf(g.toLowerCase()) >= 0;
  }), 'grant "' + g + '" returns only props that grant it or visibly carry the word');
}

A.report('prop-search');
