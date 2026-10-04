/* node test/seedstore.test.js — the seed-shelf wiring (frontend/app/seedstore.js).
   Decisions live in the pure seeds.js (tested separately); this verifies the wiring: pick() turns the top mint
   candidate into a seed; willPropose gates on a fresh candidate + session budget + the mint learning flag;
   propose() renders a gentle nudge and routes "save it" → Recipes.saveCustom (a recipe-with-required-gap) +
   MintStore.markMinted + a toast, and "not now" → MintStore.markDismissed; one offer per session; reset re-arms. */
'use strict';
const A = require('./_assert.js');
global.Seeds = require('../frontend/app/seeds.js');
global.Pitch = require('../frontend/app/pitch.js');   // for the loop-closure check: a saved seed becomes pitchable

let cands = [{ key: 'k1', count: 4, template: 'draft notes for {input}', hasToken: true, lastText: 'draft notes for v2' }];
let nudgeCands = null;   // when non-null, the NUDGE path (nudgeCandidates) returns this — the stop-forever filter
let minted = [], dismissed = [], proposed = [], enabled = true;
global.MintStore = {
  candidates: () => cands,
  nudgeCandidates: () => (nudgeCands === null ? cands : nudgeCands),
  markMinted: k => { minted.push(k); },
  markDismissed: k => { dismissed.push(k); },
  markProposed: k => { proposed.push(k); },
  enabled: () => enabled
};

let saved = [];
global.Recipes = {
  paramsFromTemplate: t => (/\{\w+\}/.test(t) ? [{ key: 'input', label: 'Input', placeholder: '', required: true }] : []),
  draft: o => Object.assign({ name: '', emoji: '▸', tagline: '', blurb: '', accent: '#7bc88a', tags: null, params: [], task: '' }, o),
  saveCustom: r => { if (!r.name) throw new Error('a recipe needs a name'); const s = Object.assign({ id: 'custom-recipe-x', custom: true }, r); saved.push(s); return s; },
  list: () => saved.map(r => ({ id: r.id, name: r.name, tagline: r.tagline }))   // the shelf the pitch/suggest engine offers from
};

const chat = { nudges: [], nudge(t, o, cb) { this.nudges.push({ t, o, cb }); } };
global.Chat = chat;
let notes = [];
global.StationUI = { notify: (m) => notes.push(m) };

const { SeedStore } = require('../frontend/app/seedstore.js');
function clearFakes() { chat.nudges = []; saved = []; minted = []; dismissed = []; proposed = []; notes = []; }

SeedStore.init();

/* ---------- pick + gate ---------- */
A.ok(SeedStore._pick() && SeedStore._pick().key === 'k1', 'pick() turns the top mint candidate into a seed');
A.eq(SeedStore.willPropose(), true, 'willPropose when a fresh candidate exists + budget free');

/* ---------- propose → nudge → "save it" authors the recipe-with-gap ---------- */
clearFakes();
SeedStore.propose();
A.eq(chat.nudges.length, 1, 'propose renders exactly one gentle nudge');
A.ok(/seed/i.test(chat.nudges[0].t), 'the nudge carries the seed offer');
A.eq(chat.nudges[0].o.length, 2, 'two choices — save / not now');
A.eq(proposed[0], 'k1', 'propose tallies the offer (Mint.markProposed) so an IGNORED nudge stops re-offering this shape');
chat.nudges[0].cb({ value: 'save' });
A.eq(saved.length, 1, '"save it" → Recipes.saveCustom');
A.eq(saved[0].name, 'Draft notes for …', 'the saved recipe is named from the seed title');
A.eq(saved[0].task, 'draft notes for {input}', 'the saved recipe keeps the {input} gap token');
A.ok(saved[0].params.some(p => p.required), 'the saved recipe has a REQUIRED gap param (Recipes derives it)');
A.eq(minted[0], 'k1', 'the minted shape is marked so it never re-proposes');
A.eq(notes.length, 0, 'notification diet (2026-08-18): the save confirms with its chime, never a bell entry');

/* ---------- LOOP CLOSURE (Slice 8 #16): a SAVED seed becomes PITCHABLE — it lands on Recipes.list(), the exact
   shelf the First Pitch / ongoing-suggestion engine offers from. usage → mint → seed → save → Recipes.list →
   the pitch directive can now propose it. This is the self-growing-shelf promise; nothing locked it before. */
const shelf = Recipes.list();
A.ok(shelf.some(r => r.id === saved[0].id), 'a saved seed lands on the Recipes shelf (Recipes.list)');
const loopDir = Pitch.buildDirective({ recipes: shelf, capabilities: [] });
A.ok(loopDir.indexOf('recipe:' + saved[0].id) >= 0, 'the saved seed is now offerable by the pitch/suggest engine (the loop closes)');

/* ---------- one offer per session (anti-nag) ---------- */
A.eq(SeedStore.willPropose(), false, 'budget spent → no second seed offer this session');
SeedStore.reset();
A.eq(SeedStore.willPropose(), true, 'reset re-arms the session budget');

/* ---------- "not now" waves the shape off (never re-raised) ---------- */
clearFakes(); SeedStore.reset();
SeedStore.propose();
chat.nudges[0].cb({ value: 'no' });
A.eq(dismissed[0], 'k1', '"not now" marks the shape dismissed');
A.eq(saved.length, 0, 'declining saves nothing');

/* ---------- no candidates → nothing to propose ---------- */
clearFakes(); SeedStore.reset(); cands = [];
A.eq(SeedStore.willPropose(), false, 'no candidates → nothing to propose');
A.eq(SeedStore._pick(), null, 'pick() is null with no candidates');
cands = [{ key: 'k1', count: 4, template: 'draft notes for {input}', hasToken: true }];

/* ---------- respects the mint learning pause ---------- */
clearFakes(); SeedStore.reset(); enabled = false;
A.eq(SeedStore.willPropose(), false, 'a paused mint detector → no seed offers');
enabled = true;

/* ---------- the NUDGE reads nudgeCandidates (stop-forever filter), NOT the unfiltered candidates() the Recipes tab uses ---------- */
clearFakes(); SeedStore.reset();
nudgeCands = [];   // this shape has been offered-and-ignored to the ceiling → filtered OUT of the nudge path
A.eq(SeedStore._pick(), null, 'pick() is null when the shape is filtered from the NUDGE path (offered-and-ignored)');
A.eq(SeedStore.willPropose(), false, 'no seed nudge for an ignored-to-the-ceiling shape…');
A.ok(MintStore.candidates().length === 1, '…even though the unfiltered candidates() (RECIPES tab) still lists it');
nudgeCands = null;   // restore the default (nudge path mirrors candidates)

A.report('seedstore.test');
