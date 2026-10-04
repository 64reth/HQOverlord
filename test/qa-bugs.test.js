/* node test/qa-bugs.test.js — the DURABLE BUG REGISTER (scripts/qa/bugs.mjs), fed an
   in-memory io + a fixed clock (zero disk). Asserts the laws that make a ten-lane parallel
   hunt honest: identity is (surface+slug) so a re-worded title never re-keys a bug; the same
   defect files once; a KNOWN_ISSUES fingerprint never re-files as fresh work; every bug
   carries Evidence AND Repro; `status: fixed` is refused without the commit that closed it;
   wontfix/duplicate are refused without a written verdict; the filename IS the key.
   Pure + deterministic — `found` always comes from the injected clock, never a real date. */
'use strict';
const A = require('./_assert.js');
const { makeBugRegister, slugify, fingerprintFor, SURFACES } = require('../scripts/qa/bugs.mjs');

// an in-memory io: bug files live in an inspectable array, upserted by filename exactly like a
// real directory write. `known` is a Set we control (the KNOWN_ISSUES.md baseline).
function memIo(seed, knownSet) {
  const files = (seed || []).slice();
  const known = knownSet || new Set();
  return {
    files, known,
    listBugs() { return files.map(f => Object.assign({}, f)); },
    writeBug(file, text) {
      const at = files.findIndex(f => f.file === file);
      if (at >= 0) files[at] = { file, text };
      else files.push({ file, text });
    },
    knownFingerprints() { return known; }
  };
}
const clock = { today: () => '2026-07-28' };
const mk = (io) => makeBugRegister({ io: io || memIo(), clock });

// A fully-filled bug, written the way a lane would leave it (so it PASSES validate()).
function filled(reg, over) {
  const res = reg.create(Object.assign({ title: 'the thing lies', surface: 'channels' }, over || {}));
  if (!res.ok || res.status !== 'created') throw new Error('fixture create failed: ' + res.reason);
  const bug = res.bug;
  bug.sections = {
    Symptom: 'The chat reports four tools.',
    Repro: '1. /approvals on  2. ask /tools',
    Evidence: '.bugloops/x/wire.log line 44',
    Verdict: ''
  };
  return bug;
}

// ---- A. identity is (surface + slug), frozen into the filename ----
{
  const io = memIo();
  const reg = mk(io);
  const res = reg.create({ title: '/approvals ON strips the office', surface: 'channels', severity: 'P0' });
  A.eq(res.ok, true, 'create accepted');
  A.eq(res.status, 'created', 'a fresh bug is created');
  const bug = res.bug;
  A.eq(bug.slug, 'approvals-on-strips-the-office', 'slug is derived from the title');
  A.eq(bug.fingerprint, fingerprintFor({ surface: 'channels', slug: bug.slug }), 'fingerprint is derived from surface+slug');
  A.eq(bug.file, bug.fingerprint + '-' + bug.slug + '.md', 'filename is <fingerprint>-<slug>.md');
  A.eq(bug.status, 'open', 'a new bug starts open');
  A.eq(bug.found, '2026-07-28', 'found comes from the injected clock, not a real date');
  A.eq(io.files.length, 1, 'exactly one file was written');

  // the SAME slug on a DIFFERENT surface is a different bug — surface is part of the key.
  A.ok(fingerprintFor({ surface: 'world', slug: bug.slug }) !== bug.fingerprint, 'surface participates in the identity');
}

// ---- B. the same defect files ONCE; re-wording the title never re-keys it ----
{
  const io = memIo();
  const reg = mk(io);
  const first = reg.create({ title: 'voice dies after the first word', surface: 'voice' });
  A.eq(first.status, 'created', 'first file created');

  const again = reg.create({ title: 'voice dies after the first word', surface: 'voice' });
  A.eq(again.ok, true, 'a re-find is still ok (idempotent)');
  A.eq(again.status, 'duplicate', 'the same defect does not file twice');
  A.eq(io.files.length, 1, 'still exactly one file on disk');
  A.ok(/already filed as/.test(again.reason), 'the refusal names the existing file');

  // A lane that re-words the title but passes the ORIGINAL slug still lands on the same row —
  // this is the property that stops a backlog from growing a duplicate every time it is edited.
  const reworded = reg.create({ title: 'agent voice is silent after ~4 words', surface: 'voice', slug: first.bug.slug });
  A.eq(reworded.status, 'duplicate', 're-wording the title does not mint a second bug');
  A.eq(io.files.length, 1, 'no second file written after the re-word');
}

// ---- C. a KNOWN_ISSUES baseline fingerprint is REFUSED, never re-filed (anti-nag law) ----
{
  const slug = 'undimmed-floor-behind-centered-modals';
  const fp = fingerprintFor({ surface: 'world', slug });
  const io = memIo([], new Set([fp]));
  const reg = mk(io);
  const res = reg.create({ title: 'undimmed floor behind centered modals', surface: 'world', slug });
  A.eq(res.ok, false, 'a known-baseline defect is refused');
  A.eq(res.status, 'refused', 'refusal is loud, not a silent duplicate');
  A.ok(/KNOWN_ISSUES/.test(res.reason), 'the refusal names the baseline file');
  A.eq(io.files.length, 0, 'nothing was written for a known defect');
}

// ---- D. EVIDENCE LAW + REPRO LAW: a scaffolded-but-unfilled bug FAILS validate ----
{
  const io = memIo();
  const reg = mk(io);
  reg.create({ title: 'a real defect', surface: 'sessions' });
  const v = reg.validate();
  A.eq(v.ok, false, 'a bug with only template placeholders is invalid');
  A.ok(v.errors.some(e => /## Evidence` is empty/.test(e)), 'the Evidence Law is enforced');
  A.ok(v.errors.some(e => /## Repro` is empty/.test(e)), 'the Repro Law is enforced');

  // fill it in the way a lane would, and it passes.
  const bug = filled(mk(memIo()), { title: 'a real defect', surface: 'sessions' });
  const io2 = memIo();
  const reg2 = mk(io2);
  io2.writeBug(bug.file, reg2.render(bug));
  const v2 = reg2.validate();
  A.eq(v2.ok, true, 'a filled bug validates: ' + v2.errors.join(' | '));
  A.eq(v2.bugs.length, 1, 'one bug parsed back off disk');
  A.eq(v2.bugs[0].sections.Repro, '1. /approvals on  2. ask /tools', 'the repro round-trips through render+parse');
}

// ---- E. NO-FAKE-FIXED: `status: fixed` is refused without the commit that closed it ----
{
  const io = memIo();
  const reg = mk(io);
  const bug = filled(reg);
  io.writeBug(bug.file, reg.render(bug));

  const bad = reg.set(bug.fingerprint, { status: 'fixed' });
  A.eq(bad.ok, false, 'fixed-without-a-commit is refused at the write seam');
  A.ok(/no-fake-fixed/.test(bad.reason), 'the refusal names the law');

  const good = reg.set(bug.fingerprint, { status: 'fixed', fix: 'deadbeef' });
  A.eq(good.ok, true, 'fixed WITH a commit is accepted');
  A.eq(good.bug.status, 'fixed', 'status moved to fixed');
  A.eq(good.bug.fix, 'deadbeef', 'the closing commit is recorded');
  A.eq(io.files.length, 1, 'the update rewrote the same file, it did not fork a second row');
  A.eq(reg.validate().ok, true, 'a properly-closed bug still validates');
  A.eq(reg.counts().open, 0, 'a fixed bug no longer counts as open');
}

// ---- F. VERDICT LAW: wontfix/duplicate need a written reason ----
{
  const io = memIo();
  const reg = mk(io);
  const bug = filled(reg, { title: 'cosmetic scrim gap', surface: 'world' });
  io.writeBug(bug.file, reg.render(bug));

  const bad = reg.set(bug.fingerprint, { status: 'wontfix' });
  A.eq(bad.ok, false, 'wontfix without a verdict is refused');
  A.ok(/verdict-required/.test(bad.reason), 'the refusal names the law');

  const good = reg.set(bug.fingerprint, { status: 'wontfix', verdict: 'Accepted: cosmetic, tracked in KNOWN_ISSUES.' });
  A.eq(good.ok, true, 'wontfix WITH a verdict is accepted');
  A.eq(reg.validate().ok, true, 'an argued-away bug validates');
  A.eq(reg.counts().open, 0, 'wontfix no longer counts as open');
}

// ---- G. FILENAME AUTHORITY: a hand-renamed file is a corrupt key, caught loudly ----
{
  const reg0 = mk(memIo());
  const bug = filled(reg0, { title: 'renamed by hand', surface: 'skills' });
  const io = memIo([{ file: 'i-renamed-this.md', text: reg0.render(bug) }]);
  const reg = mk(io);
  const v = reg.validate();
  A.eq(v.ok, false, 'a hand-renamed bug file is invalid');
  A.ok(v.errors.some(e => /filename must be/.test(e)), 'the error says what the filename must be');
}

// ---- H. two files on ONE fingerprint is a lie about how many bugs exist ----
{
  const reg0 = mk(memIo());
  const bug = filled(reg0, { title: 'double filed', surface: 'autonomy' });
  const text = reg0.render(bug);
  const io = memIo([{ file: bug.file, text }, { file: bug.file, text }]);
  const reg = mk(io);
  const v = reg.validate();
  A.eq(v.ok, false, 'a duplicated fingerprint is invalid');
  A.ok(v.errors.some(e => /duplicate fingerprint/.test(e)), 'the duplicate is named');
}

// ---- I. an OPEN bug that is also on the KNOWN baseline must be resolved one way or the other ----
{
  const reg0 = mk(memIo());
  const bug = filled(reg0, { title: 'known but still open', surface: 'providers' });
  const io = memIo([{ file: bug.file, text: reg0.render(bug) }], new Set([bug.fingerprint]));
  const reg = mk(io);
  const v = reg.validate();
  A.eq(v.ok, false, 'open + known-baseline is a contradiction the register refuses to hold');
  A.ok(v.errors.some(e => /KNOWN_ISSUES\.md baseline but is still open/.test(e)), 'the contradiction is named');
}

// ---- J. bad surface / severity / status are rejected, not coerced ----
{
  const reg = mk(memIo());
  const badSurface = reg.create({ title: 'x', surface: 'nonsense' });
  A.eq(badSurface.ok, false, 'an unknown surface is rejected');
  A.ok(/surface-required/.test(badSurface.reason), 'the rejection names the field');

  const badSev = reg.create({ title: 'x', surface: 'world', severity: 'P9' });
  A.eq(badSev.ok, false, 'an unknown severity is rejected');

  const noTitle = reg.create({ title: '   ', surface: 'world' });
  A.eq(noTitle.ok, false, 'an empty title is rejected');

  const emptySlug = reg.create({ title: '!!!', surface: 'world' });
  A.eq(emptySlug.ok, false, 'a title that slugifies to nothing is rejected, not silently keyed as ""');

  A.eq(reg.set('nosuchfp', { status: 'fixed', fix: 'x' }).status, 'not-found', 'setting an unknown fingerprint is not-found');
}

// ---- K. the index is deterministic, generated, and worst-first ----
{
  const io = memIo();
  const reg = mk(io);
  for (const [title, surface, severity] of [
    ['a p2 nit', 'world', 'P2'],
    ['a p0 lie', 'providers', 'P0'],
    ['a p1 seam', 'sessions', 'P1']
  ]) {
    const b = filled(reg, { title, surface, severity });
    io.writeBug(b.file, reg.render(b));
  }
  const rows = reg.list();
  A.eq(rows.map(r => r.severity), ['P0', 'P1', 'P2'], 'list is worst-first');
  const md = reg.index();
  A.ok(/GENERATED — do not hand-edit/.test(md), 'the index announces it is generated');
  A.ok(/\*\*3\*\* open \(open\+claimed\) of 3 total/.test(md), 'the index counts open bugs');
  A.ok(md.indexOf('a p0 lie') < md.indexOf('a p2 nit'), 'the P0 row is rendered above the P2 row');
  A.eq(reg.index(), md, 'the index is deterministic — two renders are byte-identical');
  for (const s of SURFACES) A.ok(md.includes('| ' + s + ' |'), 'the per-surface roll-up lists ' + s);

  A.eq(reg.list({ severity: 'P0' }).length, 1, 'filtering by severity works');
  A.eq(reg.list({ surface: 'world' }).length, 1, 'filtering by surface works');
  A.eq(reg.list({ status: 'fixed' }).length, 0, 'filtering by status works');
}

// ---- L. a corrupt / unparseable file is reported, never silently dropped ----
{
  const io = memIo([{ file: 'abcd1234-broken.md', text: 'no frontmatter at all\n' }]);
  const reg = mk(io);
  const v = reg.validate();
  A.eq(v.ok, false, 'a file with no frontmatter is invalid');
  A.ok(v.errors.some(e => /frontmatter fence/.test(e)), 'the parse failure is explained');
}

// ---- M. only the EXACT scaffold text reads as empty — real italic prose is content ----
// Regression: an earlier draft dropped ANY line matching /^_.*_$/, so a lane writing its
// evidence as a single italic note lost it silently and then failed the gate with "is empty"
// against text it could plainly see in the file.
{
  const reg0 = mk(memIo());
  const bug = filled(reg0, { title: 'italic evidence survives', surface: 'world' });
  bug.sections.Evidence = '_see .bugloops/x/shot.png_';
  bug.sections.Repro = '_1. boot  2. click_';
  const io = memIo([{ file: bug.file, text: reg0.render(bug) }]);
  const reg = mk(io);
  const v = reg.validate();
  A.eq(v.ok, true, 'italic prose counts as content: ' + v.errors.join(' | '));
  A.eq(v.bugs[0].sections.Evidence, '_see .bugloops/x/shot.png_', 'the italic evidence round-trips intact');

  // ...while the untouched scaffold still reads as empty.
  const io2 = memIo();
  const reg2 = mk(io2);
  reg2.create({ title: 'never filled in', surface: 'world' });
  A.eq(reg2.validate().ok, false, 'an untouched scaffold still fails the Evidence/Repro laws');
}

// ---- N. slugify is total and bounded ----
{
  A.eq(slugify('  Hello, World!  '), 'hello-world', 'punctuation and edges are stripped');
  A.eq(slugify('a'.repeat(200)).length <= 48, true, 'a slug is bounded');
  A.eq(slugify(''), '', 'an empty title slugifies to empty, not to a crash');
  A.eq(slugify(null), '', 'null slugifies to empty, not to "null"');
  A.ok(!/-$/.test(slugify('x'.repeat(47) + ' tail')), 'a truncated slug never ends in a dangling dash');
}

// ---- O. Law 7: a NEW record must carry a machine-checkable anchor; old ones are grandfathered ----
{
  const { extractAnchors, anchorLawApplies, ANCHOR_LAW_SINCE } = require('../scripts/qa/bugs.mjs');
  A.eq(ANCHOR_LAW_SINCE, '2026-08-21', 'the anchor law has a fixed start date');

  // anchor extraction: tests, files[:line], code snippets bound to the nearest cited file, commits.
  const a = extractAnchors({
    fingerprint: 'abcdef12', fix: 'f4d03511',
    sections: {
      Evidence: '`frontend/app/tooltip.js:136`\n\nThe handler opens with `if (!anchor) return;` (tooltip.js:136). ' +
        'test/station-tooltip.test.js never drives init(). Also `sidecar/loop.js` — `let activeCredKey = (o.credKey != null) ? o.credKey : null` seeds it.',
      Verdict: 'Fixed in `f4d03511`; regression in test/tooltip-pending.test.js. Not the fingerprint abcdef12.'
    }
  });
  A.eq(a.commits, ['f4d03511'], 'the fix commit is an anchor once (fix: and Verdict agree); the fingerprint is never a commit');
  A.eq(a.tests, ['test/station-tooltip.test.js', 'test/tooltip-pending.test.js'], 'every named test path is a test anchor');
  A.eq(a.regressionTests, ['test/tooltip-pending.test.js'], 'only a Verdict-named test is the regression left by the fix');
  A.eq(a.files.map(f => f.file + ':' + f.line), ['frontend/app/tooltip.js:136', 'sidecar/loop.js:null'], 'file[:line] citations are file anchors');
  A.eq(a.snippets.map(s => s.file + ' ' + s.text), [
    'frontend/app/tooltip.js if (!anchor) return;',
    'sidecar/loop.js let activeCredKey = (o.credKey != null) ? o.credKey : null'
  ], 'code snippets bind to the nearest cited file above them');
  A.eq(a.count, 6, 'count = tests + files + snippets (commits are closure evidence, not creation anchors)');

  // a snippet quoted from a TEST binds to the test and is not a file anchor
  const t = extractAnchors({ sections: { Evidence: 'test/x.test.js:52 — `A.eq(order([1,2]), [2,1], "cooled")` passes vacuously.' } });
  A.eq(t.files.length, 0, 'a test citation is not a file anchor');
  A.eq(t.snippets[0].file, 'test/x.test.js', 'but it still binds the snippet quoted after it');

  // prose in backticks is NOT an anchor
  const p = extractAnchors({ sections: { Evidence: 'The `SPEND TODAY instrument` reads wrong and `status: fixed` is cheap.' } });
  A.eq(p.count, 0, 'backticked prose is not a code anchor');

  A.eq(anchorLawApplies({ found: '2026-08-20' }), false, 'a record found the day before the law is grandfathered');
  A.eq(anchorLawApplies({ found: '2026-08-21' }), true, 'a record found on the law date is covered');
  A.eq(anchorLawApplies({ found: 'garbage' }), false, 'an unparseable date never silently triggers the law (the date law catches it)');

  // validate(): an anchor-less record found after the law FAILS; the same text found before passes.
  const reg0 = mk(memIo());
  const bug = filled(reg0, { title: 'prose only bug', surface: 'world', found: '2026-09-01' });
  bug.sections.Evidence = 'Saw it happen twice on the dev box. Screenshot in .bugloops/prose/shot.png';
  const reg = mk(memIo([{ file: bug.file, text: reg0.render(bug) }]));
  const v = reg.validate();
  A.eq(v.ok, false, 'an anchor-less record found after the law date is refused');
  A.ok(v.errors.some(e => /no machine-checkable anchor/.test(e)), 'the violation names the law: ' + v.errors.join(' | '));

  const old = Object.assign({}, bug, { found: '2026-07-28' });
  const regOld = mk(memIo([{ file: old.file, text: reg0.render(old) }]));
  A.eq(regOld.validate().ok, true, 'the same anchor-less record found before the law is grandfathered');

  bug.sections.Evidence = 'Repro test: test/prose-only.test.js (red on trunk).';
  const regAnch = mk(memIo([{ file: bug.file, text: reg0.render(bug) }]));
  const va = regAnch.validate();
  A.eq(va.ok, true, 'naming one repro test satisfies the law: ' + va.errors.join(' | '));
  A.eq(va.bugs[0].anchors.tests, ['test/prose-only.test.js'], 'parse() exposes the anchors it found');
}

A.report('qa-bugs.test');
