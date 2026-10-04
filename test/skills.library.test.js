/* node test/skills.library.test.js — the BUNDLED skill library (capability-gated recipe packs).
   Distinct from skills.test.js (the agent's runtime-saved procedures). Locks the new pipeline:
   frontmatter parse, real loadDir over sidecar/skills/library, the object=capability gate
   (requires ⊆ placed objects), default/override enable logic, compose's no-op invariant (empty
   block byte-identical to a skill-less prompt, like dossierinject), the budget bound (no silent
   truncation), and prefs durability (append-only, latest-wins). Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const C = require('../sidecar/skills/catalog.js');
const { makeSkillPrefs } = require('../sidecar/skills/prefs.js');

// ---- A. parse: frontmatter (scalars, inline array, boolean) + body ----
{
  const text = [
    '---', 'name: Demo Skill', 'slug: demo', 'description: A demo.', 'category: Testing',
    'requires: [cabinet, workbench]', 'default: true', 'author: Someone', 'license: MIT',
    '---', '', 'Body line one.', 'Body line two.'
  ].join('\n');
  const s = C.parse(text, 'fallback');
  A.eq(s.slug, 'demo', 'slug taken from frontmatter');
  A.eq(s.name, 'Demo Skill', 'name parsed');
  A.eq(s.category, 'Testing', 'category parsed');
  A.eq(s.requires.length, 2, 'requires parsed as an array');
  A.ok(s.requires.indexOf('cabinet') >= 0 && s.requires.indexOf('workbench') >= 0, 'requires holds both objects');
  A.eq(s.default, true, 'default boolean parsed');
  A.ok(/Body line one/.test(s.body) && /Body line two/.test(s.body), 'body captured after frontmatter');
  A.ok(s.body.indexOf('---') === -1, 'frontmatter delimiters are not in the body');
}

// ---- B. parse: no frontmatter -> whole text is body, slug from filename, safe defaults ----
{
  const s = C.parse('Just a body, no frontmatter.', 'myfile');
  A.eq(s.slug, 'myfile', 'no frontmatter -> slug from the filename stem');
  A.ok(/Just a body/.test(s.body), 'no frontmatter -> the whole text is the body');
  A.eq(s.requires.length, 0, 'no requires -> empty array (always available)');
  A.eq(s.default, false, 'no default -> false (off until enabled)');
}

// ---- C. loadDir: the REAL bundled library on disk parses correctly ----
{
  const dir = path.join(__dirname, '..', 'sidecar', 'skills', 'library');
  const skills = C.loadDir(dir, fs, path);
  A.ok(skills.length >= 2, 'loadDir picks up the bundled .md recipes');
  const by = {}; for (const s of skills) by[s.slug] = s;
  A.ok(by['humanizer'], 'humanizer loaded');
  A.eq(by['humanizer'].requires.length, 0, 'humanizer needs no object (compute-only)');
  A.eq(by['humanizer'].default, true, 'humanizer ships enabled by default');
  A.ok(by['test-driven-development'], 'TDD loaded');
  A.ok(by['test-driven-development'].requires.indexOf('workbench') >= 0, 'TDD requires the workbench object');
  A.eq(by['test-driven-development'].default, false, 'TDD is off by default');

  // ---- C2. the EXPANDED bundled catalog (Lane B port: 15-25 reference-harness skills added) ----
  A.ok(skills.length >= 25, 'the bundled library is now a rich catalog (>=25 recipes), not the original 9');

  // every recipe on disk carries the required frontmatter fields and a real body
  for (const s of skills) {
    A.ok(s.name && s.description && s.category, s.slug + ': has name/description/category');
    A.ok(s.body && s.body.length > 40, s.slug + ': has a non-trivial body');
  }

  // requires: only maps to KNOWN capability objects (honest gating — no typo'd object silently ungates a skill)
  const KNOWN_OBJECTS = new Set(['computer', 'notebook', 'cabinet', 'dish', 'workbench', 'studio', 'jukebox', 'orchestrator', 'connector']);
  for (const s of skills) for (const r of s.requires) A.ok(KNOWN_OBJECTS.has(r), s.slug + ': requires only known objects (' + r + ')');

  // spot-check two NEW ports' gating maps to the right capability object
  A.ok(by['arxiv-research'], 'new port: arXiv Research loaded');
  A.ok(by['arxiv-research'].requires.indexOf('dish') >= 0, 'arXiv Research is web-gated (DISH)');
  A.eq(by['arxiv-research'].default, false, 'arXiv Research is off by default (protects the compose budget)');
  A.ok(by['spike'], 'new port: Spike loaded');
  A.ok(by['spike'].requires.indexOf('workbench') >= 0, 'Spike is execution-gated (WORKBENCH)');
  A.eq(by['spike'].default, false, 'Spike is off by default');
  A.ok(by['decision-1-3-1'], 'new port: 1-3-1 Decision loaded');
  A.eq(by['decision-1-3-1'].requires.length, 0, '1-3-1 is pure reasoning (no object required)');
  A.ok(by['meme-generation'] && by['meme-generation'].requires.indexOf('studio') >= 0, 'Meme Generation is image-gated (STUDIO)');

  // budget invariant: with the FULL expanded catalog default-on AND every object placed, compose HONORS the 12k
  // budget — it omit-flags the overflow instead of silently truncating (the growth from 9->28 recipes is exactly
  // why almost every port ships default:false; forcing them ALL on must degrade gracefully, never blow the window).
  const ALL_OBJECTS = ['computer', 'notebook', 'cabinet', 'dish', 'workbench', 'studio', 'jukebox', 'orchestrator', 'connector'];
  const forceOn = {}; for (const s of skills) forceOn[s.slug] = true;
  const full = C.compose(skills, { overrides: forceOn, placedTypes: ALL_OBJECTS, budget: 12000 });
  A.ok(/omitted here to keep the prompt lean/.test(full), 'the full expanded catalog exceeds 12k -> compose omit-flags the overflow (no silent truncation)');
  // the SHIPPED-DEFAULT set (frontmatter default:true only) fits under budget and omits nothing — proof the ports
  // didn't sneak anything on-by-default that eats the prompt window. The legibility redesign intentionally ships
  // EVERY no-gear (compute-only) recipe ON so a fresh station injects a useful set, not just 2; each is a small,
  // broadly-usable body, so the whole set still fits the 12k compose budget with no omission.
  const shipped = C.compose(skills, { overrides: {}, placedTypes: ALL_OBJECTS, budget: 12000 });
  A.ok(shipped.length < 12000 && !/omitted/.test(shipped), 'the default-on shipped skill set fits the compose budget with no omission');
  // pin the shipped default set: exactly the no-gear (compute-only) recipes ship ON. If a new gear-gated skill ever
  // flips default:true (eating the prompt window), or a no-gear one silently regresses to off, this catches it.
  const shippedOn = skills.filter(s => s.default).map(s => s.slug).sort();
  const expectedOn = ['ascii-art', 'creative-ideation', 'decision-1-3-1', 'humanizer', 'plan'].sort();
  A.eq(shippedOn.join(','), expectedOn.join(','), 'exactly the no-gear compute-only recipes ship enabled by default');
  // and every default-on recipe is genuinely gear-free (a gear-gated default would be dark on a fresh station AND eat budget)
  for (const s of skills) if (s.default) A.eq(s.requires.length, 0, s.slug + ': a shipped-default skill needs no gear');
}

// ---- D. isAvailable: object = capability — requires ⊆ placed objects ----
{
  const free = { slug: 'y', requires: [] };
  const cab = { slug: 'x', requires: ['cabinet'] };
  const both = { slug: 'z', requires: ['cabinet', 'workbench'] };
  A.ok(C.isAvailable(free, []), 'no requirement -> available anywhere');
  A.ok(!C.isAvailable(cab, []), 'cabinet recipe locked with no objects placed');
  A.ok(C.isAvailable(cab, ['cabinet']), 'cabinet recipe available once the cabinet is placed');
  A.ok(!C.isAvailable(both, ['cabinet']), 'needs ALL required objects, not just one');
  A.ok(C.isAvailable(both, ['cabinet', 'workbench', 'dish']), 'available when every requirement is met');
}

// ---- E. isEnabled: frontmatter default, overridden by an explicit user choice ----
{
  const on = { slug: 'a', default: true };
  const off = { slug: 'b', default: false };
  A.ok(C.isEnabled(on, {}), 'default:true -> enabled with no override');
  A.ok(!C.isEnabled(off, {}), 'default:false -> disabled with no override');
  A.ok(!C.isEnabled(on, { a: false }), 'an explicit false overrides a true default');
  A.ok(C.isEnabled(off, { b: true }), 'an explicit true overrides a false default');
  A.ok(!C.isEnabled(on, new Map([['a', false]])), 'override also works as a Map');
}

// ---- F. compose: injects enabled+available bodies; gates the rest; no-op when none ----
{
  const skills = [
    { slug: 'free', name: 'Free', description: 'd1', requires: [], default: true, body: 'FREEBODY' },
    { slug: 'wb', name: 'Bench', description: 'd2', requires: ['workbench'], default: true, body: 'BENCHBODY' }
  ];
  const b1 = C.compose(skills, { overrides: {}, placedTypes: [] });
  A.ok(/FREEBODY/.test(b1), 'compose injects an enabled + available recipe body');
  A.ok(b1.indexOf('BENCHBODY') === -1, 'a recipe whose required object is absent is NOT injected (capability-gated)');
  A.ok(/INSTALLED SKILLS/.test(b1), 'the block carries the section header');

  const b2 = C.compose(skills, { overrides: {}, placedTypes: ['workbench'] });
  A.ok(/BENCHBODY/.test(b2), 'placing the required object activates the recipe');

  A.eq(C.compose(skills, { overrides: { free: false, wb: false }, placedTypes: ['workbench'] }), '', 'all disabled -> empty block (strict no-op)');
  A.eq(C.compose([], { placedTypes: ['workbench'] }), '', 'no skills -> empty block');
  A.eq(C.compose([skills[1]], { overrides: {}, placedTypes: [] }), '', 'enabled-but-unavailable only -> empty block');
}

// ---- G. compose: budget bound, but never silently drop everything ----
{
  const big = 'X'.repeat(500);
  const skills = [
    { slug: 's1', name: 'S1', description: '', requires: [], default: true, body: big },
    { slug: 's2', name: 'S2', description: '', requires: [], default: true, body: big }
  ];
  const b = C.compose(skills, { overrides: {}, placedTypes: [], budget: 600 });
  A.ok(/omitted here to keep the prompt lean/.test(b), 'over-budget recipes are flagged as omitted (no silent truncation)');
  const b2 = C.compose([{ slug: 's', name: 'S', description: '', requires: [], default: true, body: 'Y'.repeat(2000) }], { budget: 100 });
  A.ok(/YYYY/.test(b2), 'a single oversized recipe is still included (never silently dropped)');
}

// ---- H. catalog: per-workstation enabled + available flags for the UI/API ----
{
  const skills = [
    { slug: 'free', name: 'Free', description: '', category: 'X', requires: [], default: true, body: 'b' },
    { slug: 'cab', name: 'Cab', description: '', category: 'X', requires: ['cabinet'], default: false, body: 'b' }
  ];
  const cat = C.catalog(skills, { overrides: { cab: true }, placedTypes: ['cabinet'] });
  const m = {}; for (const c of cat) m[c.slug] = c;
  A.ok(m.free.enabled && m.free.available, 'default-on, no-requirement recipe: enabled + available');
  A.ok(m.cab.enabled, 'override turned the cabinet recipe on');
  A.ok(m.cab.available, 'cabinet present -> the cabinet recipe is available');
  const cat2 = C.catalog(skills, { overrides: { cab: true }, placedTypes: [] });
  A.ok(!cat2.find(c => c.slug === 'cab').available, 'no cabinet -> the cabinet recipe reads as locked (honest)');
}

// ---- I. prefs store: round-trip + durable append-only, latest-wins ----
{
  function memIo() { const lines = []; return { lines, readAll() { return lines.slice(); }, append(e) { lines.push(e); } }; }
  let clk = 5; const clock = { now: () => clk };
  const io = memIo();
  let p = makeSkillPrefs({ io, clock });
  A.eq(p.count(), 0, 'fresh prefs: no overrides');
  p.set('humanizer', false);
  clk = 6; p.set('test-driven-development', true);
  A.eq(p.overrides()['humanizer'], false, 'override recorded (false)');
  A.eq(p.overrides()['test-driven-development'], true, 'override recorded (true)');

  p = makeSkillPrefs({ io, clock });   // simulate a RESTART, rebuilt from the same io
  A.eq(p.overrides()['humanizer'], false, 'replayed: the override survives a restart');
  p.set('humanizer', true);
  p = makeSkillPrefs({ io, clock });
  A.eq(p.overrides()['humanizer'], true, 'replayed: the latest choice wins (last-write-wins)');
  A.ok(!p.set('', true).ok, 'a blank slug is refused');
}

// ---- I2. prefs COMPACTION: rewrite keeps one line per slug (latest choice); boot after compaction is intact ----
{
  function rwIo() { let lines = []; return { get lines() { return lines; }, readAll() { return lines.slice(); }, append(e) { lines.push(e); }, rewrite(entries) { lines = entries.slice(); } }; }
  let clk = 1; const clock = { now: () => clk };
  const io = rwIo();
  let p = makeSkillPrefs({ io, clock });
  for (let i = 0; i < 8; i++) { clk = i; p.set('humanizer', i % 2 === 0); }   // toggle the SAME slug many times
  p.set('tdd', true);
  A.ok(io.lines.length >= 9, 'many appends accumulated');
  const r = p.compact();
  A.ok(r.ok, 'prefs compaction ran');
  A.eq(io.lines.length, 2, 'compacted to one line per distinct slug');
  p = makeSkillPrefs({ io, clock });   // boot after compaction
  A.eq(p.overrides()['humanizer'], false, 'the LATEST humanizer choice survived compaction (last set was i=7, odd -> false)');
  A.eq(p.overrides()['tdd'], true, 'the tdd choice survived');
  A.eq(p.count(), 2, 'boot after compaction sees both distinct slugs');
}

A.report('skills.library.test');
