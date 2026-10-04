/* node test/specialties.test.js — the agent specialty marketplace (frontend/app/specialties.js).
   Locks the catalog's integrity (every built-in is well-formed + ids are unique), that compose()
   hands App.applyAgentConfig exactly the {purpose,manual} patch shape it consumes, that personas
   referenced by the catalog are real, and that the save-your-own custom round-trip (save → list →
   remove) behaves — including a unique-id collision against a built-in id. Runs under node with no
   DOM and no localStorage, so the custom store lives in-memory here (the browser persists it). */
'use strict';
const A = require('./_assert.js');
const S = require('../frontend/app/specialties.js');

/* personas.js is a browser IIFE (a module-scoped `Personas` const, exports nothing under node), so we
   can't require its id set here. Mirror it explicitly: a specialty that references a persona NOT in
   this set is a typo / dangling ref and fails the gate. Keep in sync with personas.js PRESETS. */
const PERSONA_IDS = ['professional', 'friendly', 'direct', 'witty', 'calm'];

/* ---------- catalog integrity ---------- */
const builtins = S.builtins();
A.ok(builtins.length >= 8, 'catalog ships a real roster (>= 8 specialists), got ' + builtins.length);

const seen = {};
const TIERS = Object.keys(S.TIERS);
for (const b of builtins) {
  A.ok(!seen[b.id], 'built-in id is unique: ' + b.id);
  seen[b.id] = true;
  A.ok(typeof b.id === 'string' && b.id.length > 0, 'has id');
  A.ok(typeof b.name === 'string' && b.name.length > 0, b.id + ' has a name');
  A.ok(typeof b.emoji === 'string' && b.emoji.length > 0, b.id + ' has an emoji');
  A.ok(typeof b.tagline === 'string' && b.tagline.length > 0, b.id + ' has a tagline');
  A.ok(b.purpose.length > 20, b.id + ' has a real purpose');
  A.ok(b.manual.length > 20, b.id + ' has real standing orders');
  A.ok(TIERS.indexOf(b.model) >= 0, b.id + ' model tier is a known tier: ' + b.model);
  A.ok(Array.isArray(b.starters) && b.starters.length >= 1, b.id + ' offers starter tasks');
  A.eq(b.custom, false, b.id + ' is a built-in (custom=false)');
  A.ok(PERSONA_IDS.indexOf(b.persona) >= 0, b.id + ' recommends a REAL persona: ' + b.persona);
  // ranking tags: the recommender's fuel — at least one positive weight over the known interest lanes, frozen.
  A.ok(b.tags && typeof b.tags === 'object', b.id + ' carries ranking tags');
  const tagKeys = Object.keys(b.tags);
  A.ok(tagKeys.length >= 1, b.id + ' has at least one interest lane');
  A.ok(tagKeys.every(k => ['code', 'research', 'general'].indexOf(k) >= 0), b.id + ' tags use only the known lanes');
  A.ok(tagKeys.every(k => b.tags[k] > 0), b.id + ' tag weights are all positive');
  A.throws(() => { b.tags.general = 9; }, b.id + ' tags are frozen (catalog is immutable)');
}

/* built-ins are frozen — a stray mutation must not poison the shared catalog */
A.throws(() => { builtins[0].name = 'hacked'; }, 'a built-in spec is frozen');
A.ok(S.exists(S.DEFAULT_ID), 'DEFAULT_ID resolves to a real specialty');

/* ---------- compose(): the deploy patch shape ---------- */
const patch = S.compose('researcher');
A.eq(Object.keys(patch).sort(), ['manual', 'purpose'], 'compose() yields exactly {purpose,manual} — the applyAgentConfig patch');
A.ok(patch.purpose.length > 0 && patch.manual.length > 0, 'compose() carries the real text');
A.eq(S.compose('no-such-id'), null, 'compose() of an unknown id is null');
// compose accepts a spec object directly too (the marketplace passes either)
A.eq(S.compose(builtins[1]).purpose, builtins[1].purpose, 'compose() accepts a spec object, not just an id');

/* ---------- custom (save-your-own) round-trip ----------
   NB: the persona strings here ('deadpan-bot' below, 'gremlin' further down) are deliberately LEGACY ids —
   saveCustom/fromAgent pass persona through verbatim without validating it against PRESETS, so these double
   as back-compat coverage that an old persona id survives the round-trip (it resolves via personas.js ALIASES). */
A.eq(S.customs().length, 0, 'no customs at first (node has no localStorage)');
const saved = S.saveCustom({ name: 'Night Owl', emoji: '🦉', tagline: 'after-hours ops', purpose: 'Run things while the Commander sleeps.', manual: '- Be quiet.', persona: 'deadpan-bot' });
A.ok(saved.id.indexOf('custom-') === 0, 'a saved custom gets a custom- id: ' + saved.id);
A.eq(saved.custom, true, 'a saved custom is flagged custom=true');
A.ok(saved.tags && Object.keys(saved.tags).length >= 1, 'a saved custom carries ranking tags (classified in-browser; general fallback under node)');
A.ok(S.exists(saved.id), 'the custom is now in the registry');
A.eq(S.customs().length, 1, 'exactly one custom after one save');
A.eq(S.list().length, builtins.length + 1, 'list() = built-ins + customs');

// editing the same id upserts (no duplicate)
const edited = S.saveCustom(Object.assign({}, saved, { tagline: 'changed' }));
A.eq(edited.id, saved.id, 'editing keeps the same id');
A.eq(S.customs().length, 1, 'upsert does not duplicate');
A.eq(S.get(saved.id).tagline, 'changed', 'the edit persisted');

// a missing name is rejected
A.throws(() => S.saveCustom({ name: '' }), 'a nameless specialty is rejected');

// id collision against a BUILT-IN must not clobber it — saving a custom literally named "Researcher"
const clash = S.saveCustom({ name: 'Researcher', purpose: 'mine', manual: '- mine' });
A.ok(clash.id !== 'researcher', 'a custom never steals a built-in id (' + clash.id + ' != researcher)');
A.eq(S.get('researcher').custom, false, 'the built-in Researcher is untouched');

// remove
A.eq(S.removeCustom(saved.id), true, 'removeCustom returns true when it removed one');
A.ok(!S.exists(saved.id), 'the removed custom is gone');
A.eq(S.removeCustom('nope'), false, 'removeCustom returns false for an unknown id');

/* ---------- fromAgent(): capture a live agent into a draft spec ---------- */
const draft = S.fromAgent({ name: 'ULTRON', personaId: 'gremlin', color: '#abc', docs: { purpose: 'do the thing', manual: '- rule one' } }, { name: 'Ultron Mk II', emoji: '🤖' });
A.eq(draft.name, 'Ultron Mk II', 'fromAgent honors a provided name');
A.eq(draft.purpose, 'do the thing', 'fromAgent pulls purpose from agent.docs');
A.eq(draft.manual, '- rule one', 'fromAgent pulls the manual from agent.docs');
A.eq(draft.persona, 'gremlin', 'fromAgent carries the agent persona');
A.eq(draft.accent, '#abc', 'fromAgent carries the agent suit color');

A.report('specialties');
