/* node test/dossier.test.js — the pure Commander Dossier engine (frontend/app/dossier.js).
   Locks the Phase-A promises: beliefs add/update/forget/pin per dimension with collision-proof ids;
   onboarding docs seed ONCE per doc (first-seed-wins, forgotten seeds don't resurrect, empty docs seed
   later); composeBlock() is durable-only + byte-stable + omits blank dimensions + '' when cold + capped;
   summary() reports honest per-dimension counts + a fraction-of-dimensions familiarity meter; and a
   malformed/old persisted blob hydrates to a valid, collision-proof dossier. Clock is injected. */
'use strict';
const A = require('./_assert.js');
const D = require('../frontend/app/dossier.js');

/* ---------- fresh shape ---------- */
const f = D.fresh();
A.eq(f.v, 1, 'fresh() is v1');
A.eq(Object.keys(f.dims).sort(), ['ambition', 'goals', 'identity', 'pain', 'people', 'schedule', 'stack', 'standing_orders', 'style'], 'fresh() has all nine dimensions, each empty');
A.eq(f.dims.identity, [], 'a fresh dimension is an empty array');
A.eq(f.seededFrom, {}, 'fresh() has seeded nothing');

/* ---------- upsert: add, provenance, collision-proof ids ---------- */
let d = D.fresh();
D.upsert(d, 'stack', { text: 'Mostly TypeScript and Node', source: 'commander' }, 100);
A.eq(d.dims.stack.length, 1, 'upsert adds a belief');
A.eq(d.dims.stack[0].id, 'cd_1', 'first belief gets id cd_1');
A.eq(d.dims.stack[0].source, 'commander', 'source is recorded');
A.eq(d.dims.stack[0].createdAt, 100, 'createdAt uses the injected clock');
D.upsert(d, 'goals', { text: 'Ship the dossier' }, 101);
A.eq(d.dims.goals[0].id, 'cd_2', 'ids are monotonic across the whole dossier');
A.eq(d.dims.goals[0].source, 'commander', 'source defaults to commander');

/* updating by id edits text in place (does not add a second belief) */
D.upsert(d, 'stack', { id: 'cd_1', text: 'TypeScript, Rust, and Node' }, 200);
A.eq(d.dims.stack.length, 1, 'upsert with an existing id updates in place');
A.eq(d.dims.stack[0].text, 'TypeScript, Rust, and Node', 'the belief text was updated');
A.eq(d.dims.stack[0].updatedAt, 200, 'updatedAt advances on edit');

/* empty / unknown-dimension guards */
D.upsert(d, 'stack', { text: '   ' }, 300);
A.eq(d.dims.stack.length, 1, 'blank text is a no-op (never store an empty belief)');
D.upsert(d, 'nonsense', { text: 'x' }, 300);
A.ok(!d.dims.nonsense, 'an unknown dimension is rejected');

/* text is clipped at TEXT_CHARS */
const long = 'x'.repeat(D.TEXT_CHARS + 50);
const dc = D.fresh(); D.upsert(dc, 'identity', { text: long }, 0);
A.eq(dc.dims.identity[0].text.length, D.TEXT_CHARS, 'a long belief is clipped to TEXT_CHARS');

/* ---------- forget: first-match-only ---------- */
const fg = D.fresh();
D.upsert(fg, 'goals', { text: 'a' }, 1); D.upsert(fg, 'goals', { text: 'b' }, 2);
D.forget(fg, 'goals', 'cd_1', 3);
A.eq(fg.dims.goals.length, 1, 'forget removes the matching belief');
A.eq(fg.dims.goals[0].text, 'b', 'forget removed the right one');
// a freed id is NOT reused (collision-proof): next add is cd_3, not cd_1
D.upsert(fg, 'goals', { text: 'c' }, 4);
A.eq(fg.dims.goals[fg.dims.goals.length - 1].id, 'cd_3', 'a forgotten id is never reused');

/* ---------- pin + deterministic read order ---------- */
const po = D.fresh();
D.upsert(po, 'style', { text: 'first' }, 10);
D.upsert(po, 'style', { text: 'second' }, 20);
D.upsert(po, 'style', { text: 'third' }, 30);
D.setPinned(po, 'style', 'cd_3', true, 40);   // pin the newest
const ord = D.beliefs(po, 'style').map(b => b.text);
A.eq(ord, ['third', 'first', 'second'], 'beliefs() sorts pinned-first, then oldest-first (deterministic)');

/* ---------- seedFromDocs: once-per-doc, first-seed-wins ---------- */
const s1 = D.fresh();
D.seedFromDocs(s1, { context: 'Builds AI tooling', purpose: 'Make the harness great', manual: 'Be concise' }, 1000);
A.eq(s1.dims.identity[0].text, 'Builds AI tooling', 'context.md seeds the identity dimension');
A.eq(s1.dims.goals[0].text, 'Make the harness great', 'purpose.md seeds goals');
A.eq(s1.dims.standing_orders[0].text, 'Be concise', 'manual seeds standing_orders');
A.eq(s1.dims.identity[0].source, 'onboarding', 'a seeded belief is sourced to onboarding');
// re-seeding with the SAME docs does nothing (once-per-doc)
D.seedFromDocs(s1, { context: 'Builds AI tooling', purpose: 'Make the harness great', manual: 'Be concise' }, 2000);
A.eq(s1.dims.identity.length, 1, 'a doc is never re-seeded (no duplication on reload)');

/* an empty doc at first init seeds LATER when the awakening fills it */
const s2 = D.fresh();
D.seedFromDocs(s2, { context: '', purpose: '', manual: '' }, 100);
A.eq(s2.dims.identity.length, 0, 'an empty doc seeds nothing yet');
A.eq(s2.seededFrom.context, undefined, 'an empty doc is not marked seeded');
D.seedFromDocs(s2, { context: 'now I know them', purpose: '', manual: '' }, 200);
A.eq(s2.dims.identity[0].text, 'now I know them', 'a later-authored doc seeds when it gains content');

/* a forgotten seed does NOT resurrect on the next seedFromDocs */
const s3 = D.fresh();
D.seedFromDocs(s3, { context: 'temp', purpose: '', manual: '' }, 100);
D.forget(s3, 'identity', s3.dims.identity[0].id, 150);
D.seedFromDocs(s3, { context: 'temp', purpose: '', manual: '' }, 200);
A.eq(s3.dims.identity.length, 0, 'a forgotten seeded belief never reappears');

/* ---------- composeBlock: durable-only, byte-stable, capped, omits blanks ---------- */
A.eq(D.composeBlock(D.fresh(), {}), '', 'a cold dossier composes to an empty string (adds nothing to the prompt)');
const cb = D.fresh();
D.upsert(cb, 'stack', { text: 'TypeScript' }, 1);
D.upsert(cb, 'goals', { text: 'Ship Phase A' }, 2);
const block1 = D.composeBlock(cb, {});
A.ok(block1.indexOf('Stack & tools: TypeScript') >= 0, 'composeBlock renders a known dimension');
A.ok(block1.indexOf('Goals: Ship Phase A') >= 0, 'composeBlock renders multiple known dimensions');
A.ok(block1.indexOf('Identity') < 0, 'composeBlock omits blank dimensions (never guesses)');
A.eq(D.composeBlock(cb, {}), block1, 'composeBlock is byte-identical for identical state (cache-warm)');
// the pain lead — the one hand-written, non-trivial lead — must compose so every agent SEES the Commander's pain (Slice 6)
D.upsert(cb, 'pain', { text: 'writing standup reports by hand' }, 3);
A.ok(D.composeBlock(cb, {}).indexOf('Pain points (what eats their time') >= 0, 'composeBlock renders the pain lead so downstream pitches see the Commander pain');
// the ambition lead — pain's matched pull — must compose too so pitches can aim at what the Commander actually wants (Slice 7)
D.upsert(cb, 'ambition', { text: 'launch a newsletter' }, 4);
A.ok(D.composeBlock(cb, {}).indexOf('Ambitions (what they keep meaning to do') >= 0, 'composeBlock renders the ambition lead so downstream pitches see the Commander ambitions');
// the cap backs off on a word boundary and never throws
const big = D.fresh();
for (let i = 0; i < 6; i++) D.upsert(big, 'identity', { text: 'word'.repeat(20) + ' ' + i }, i);
const capped = D.composeBlock(big, { maxChars: 120 });
A.ok(capped.length <= 120, 'composeBlock honors the maxChars cap');
// REGRESSION (Slice 8 #4/#5): all 7 dims populated at realistic lengths must NOT silently drop the pitch-critical
// pain+ambition from the prompt at the production DEFAULT cap — the whole arc depends on the agent SEEING them.
// (The old 800-char single tail-cut dropped the LAST dims, i.e. pain+ambition, in this exact steady-state case.)
const seven = D.fresh();
const longish = base => (base + ' ').repeat(20).trim();   // multi-word dim content (clipped to TEXT_CHARS by upsert)
D.upsert(seven, 'identity', { text: longish('builds AI tooling solo, content creator') }, 1);
D.upsert(seven, 'stack', { text: longish('typescript node rust vanilla js') }, 2);
D.upsert(seven, 'goals', { text: longish('ship the harness to thousands') }, 3);
D.upsert(seven, 'style', { text: longish('terse fast high signal run with it') }, 4);
D.upsert(seven, 'standing_orders', { text: longish('cite sources never irreversible without asking') }, 5);
D.upsert(seven, 'pain', { text: 'writing standup reports by hand every morning' }, 6);
D.upsert(seven, 'ambition', { text: 'finally launch the newsletter' }, 7);
D.upsert(seven, 'people', { text: longish('builds for a public audience of AI builders') }, 8);
D.upsert(seven, 'schedule', { text: longish('US eastern, nights and weekends mostly') }, 9);
const sevenBlock = D.composeBlock(seven, {});   // production DEFAULT cap (no maxChars)
A.ok(sevenBlock.indexOf('Pain points (what eats their time') >= 0, 'composeBlock keeps the PAIN lead with all 9 dims at the default cap (no silent drop)');
A.ok(sevenBlock.indexOf('Ambitions (what they keep meaning to do') >= 0, 'composeBlock keeps the AMBITION lead with all 9 dims at the default cap');
A.ok(sevenBlock.indexOf('People & audience (who they work with') >= 0, 'composeBlock keeps the PEOPLE lead with all 9 dims at the default cap');
A.ok(sevenBlock.indexOf('Schedule & cadence (timezone') >= 0, 'composeBlock keeps the SCHEDULE lead with all 9 dims at the default cap');

/* ---------- summary: honest counts + fraction-of-dimensions familiarity ---------- */
const sm0 = D.summary(D.fresh(), {});
A.eq(sm0.familiarity, 0, 'a cold dossier is 0% familiar');
A.eq(sm0.known, [], 'a cold dossier knows no dimensions');
A.eq(sm0.blank.length, 9, 'a cold dossier has nine blank dimensions');
const smX = D.fresh();
D.upsert(smX, 'identity', { text: 'a' }, 1);
D.upsert(smX, 'stack', { text: 'b' }, 2);
const sm = D.summary(smX, { observed: { dominant: 'code' } });
A.eq(sm.familiarity, 2 / 9, 'familiarity = fraction of dimensions with at least one belief');
A.eq(sm.counts.identity, 1, 'summary reports per-dimension counts');
A.eq(sm.total, 2, 'summary totals the beliefs');
A.eq(sm.observed.dominant, 'code', 'summary passes the observed affinity through for the panel');

/* ---------- hydrate: malformed/old blob -> valid, collision-proof ---------- */
A.eq(D.hydrate(null).v, 1, 'hydrate(null) returns a fresh dossier');
A.eq(D.hydrate('garbage').dims.identity, [], 'hydrate of garbage is a valid empty dossier');
const round = D.hydrate(JSON.parse(JSON.stringify(s1)));
A.eq(round.dims.goals[0].text, 'Make the harness great', 'hydrate round-trips a real dossier');
A.eq(round.seededFrom.context, true, 'hydrate preserves the seeded-doc marks');
// duplicate / missing ids are re-issued so nextId stays collision-proof
const messy = { v: 1, dims: { identity: [{ text: 'one', id: 'cd_1' }, { text: 'two', id: 'cd_1' }, { text: 'three' }], stack: [], goals: [], style: [], standing_orders: [] }, seededFrom: {} };
const fixed = D.hydrate(messy);
const ids = fixed.dims.identity.map(b => b.id);
A.eq(new Set(ids).size, 3, 'hydrate re-issues duplicate/missing ids so all are unique');
D.upsert(fixed, 'identity', { text: 'four' }, 9);
A.eq(new Set(fixed.dims.identity.map(b => b.id)).size, 4, 'a post-hydrate add never collides with a re-issued id');

/* ---------- V3 §5: evidence WEIGHT — the readiness gate's substrate ---------- */
{
  const d = D.fresh();
  D.upsert(d, 'pain', { text: 'typed by the commander', source: 'onboarding' }, 10);
  A.eq(d.dims.pain[0].weight, 'stated', 'a plain upsert defaults to weight stated (the Commander\'s words)');
  D.upsert(d, 'goals', { text: 'a synthesized mission', source: 'onboarding', weight: 'synth' }, 11);
  A.eq(d.dims.goals[0].weight, 'synth', 'a declared weight is honored');
  D.upsert(d, 'stack', { text: 'observed from work', source: 'study', observedAt: 12 }, 12);
  A.eq(d.dims.stack[0].weight, 'observed', 'a study/observed belief infers weight observed');
  D.upsert(d, 'style', { text: 'bad weight', weight: 'nonsense' }, 13);
  A.eq(d.dims.style[0].weight, 'stated', 'an invalid weight falls back to the honest inference, never stored raw');

  // doc seeds carry weight 'seed' (they inform the prompt but never open the readiness gate)…
  const d2 = D.fresh();
  D.seedFromDocs(d2, { purpose: 'Help me write, debug, and ship software.' }, 20);
  A.eq(d2.dims.goals[0].weight, 'seed', 'a doc-seeded belief is weight seed');
  // …and the seed DEDUPES against an identical belief the interview already wrote (no duplicate prompt line).
  const d3 = D.fresh();
  D.upsert(d3, 'goals', { text: 'Ship the real thing.', source: 'onboarding', weight: 'synth' }, 30);
  D.seedFromDocs(d3, { purpose: 'Ship the real thing.' }, 31);
  A.eq(d3.dims.goals.length, 1, 'seedFromDocs dedupes an identical pre-written belief (no double line)');
  A.eq(d3.dims.goals[0].weight, 'synth', 'the grounded belief survives; the seed adds nothing');
  A.ok(d3.seededFrom.purpose, 'the doc still counts as seeded (first-seed-wins holds)');

  // hydrate: a valid weight round-trips; a legacy record without one infers honestly.
  const h = D.hydrate({ dims: { goals: [{ id: 'cd_1', text: 'kept', weight: 'seed' }], pain: [{ id: 'cd_2', text: 'legacy typed' }], stack: [{ id: 'cd_3', text: 'legacy observed', source: 'study', observedAt: 5 }] } });
  A.eq(h.dims.goals[0].weight, 'seed', 'hydrate preserves a valid weight');
  A.eq(h.dims.pain[0].weight, 'stated', 'hydrate infers stated for a legacy commander-authored record');
  A.eq(h.dims.stack[0].weight, 'observed', 'hydrate infers observed for a legacy study record');
}

A.report('dossier.test');
