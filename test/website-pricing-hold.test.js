/* node test/website-pricing-hold.test.js — the paid tier is held back by TWO scripts, and until now
   nothing tested either of them.

   WHAT IS ACTUALLY AT STAKE. `pricing.html` is written, reviewed, and deliberately unpublished
   (Andrew, 2026-08-02), along with the Credits clauses in the legal pages. The only thing standing
   between that and starnetos.com is `scripts/stage-website-deploy.mjs`. If its guard silently stops
   guarding, the failure is invisible: Cloudflare's catch-all answers 200 for every path, so nothing
   404s and nobody notices that a paid tier was announced early — with legal text citing a price
   list, on a domain where the price list resolves to the homepage.

   The mirrored risk is the day it goes live: `scripts/go-live-credits.mjs` makes eighteen edits, and
   an edit whose anchor text has drifted since it was written would leave the site HALF-LAUNCHED.
   That has already happened once by hand (docs pages fixed, legal pages missed on the same pass).
   So this test does not check that the launch works — it checks that the script still RECOGNISES
   every file it claims to edit, today, in this branch. That is the thing that rots. */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const ROOT = path.resolve(__dirname, '..');
const run = (script, args) => {
  try {
    return { out: execFileSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 };
  } catch (e) {
    return { out: String((e.stdout || '') + (e.stderr || '')), code: e.status == null ? -1 : e.status };
  }
};

/* ---- 1. the two halves agree, because there is only one of them now ---------------------------- */
const siteJs = fs.readFileSync(path.join(ROOT, 'website', 'site.js'), 'utf8');
const flag = /\bPRICING_LIVE\s*=\s*(true|false)\b/.exec(siteJs);
A.ok(flag, 'website/site.js declares PRICING_LIVE — stage-website-deploy.mjs reads it to decide what publishes');
const live = flag[1] === 'true';

const staged = run('stage-website-deploy.mjs', ['--check']);
A.eq(staged.code, 0, 'stage-website-deploy.mjs --check succeeds');
A.ok(staged.out.includes('PRICING_LIVE=' + flag[1]),
  'the staging script reports the SAME flag state site.js declares (it reads it, it does not keep a copy)');

if (!live) {
  // The hold, while it is on.
  A.ok(/holding back \d+:/.test(staged.out), 'it names what it is holding back rather than just a count');
  A.ok(staged.out.includes('- pricing.html'), 'pricing.html is held back while PRICING_LIVE is false');
  A.ok(staged.out.includes('~ legal/terms.html <- legal/_terms.nocredits.html'),
    'terms.html is substituted — it cites the pricing page as forming part of the terms');
  A.ok(staged.out.includes('~ legal/privacy.html <- legal/_privacy.nocredits.html'),
    'privacy.html is substituted — it describes the paid program');
} else {
  A.ok(!staged.out.includes('- pricing.html'), 'once PRICING_LIVE is true, pricing.html publishes with no second edit');
  A.ok(!staged.out.includes('~ legal/'), 'and the legal substitutions stop applying on their own');
}

// The no-credits variants are SOURCES, never pages. Publishing them would be two dead URLs in either
// state, so they stay held back whichever way the flag points.
A.ok(staged.out.includes('- legal/_terms.nocredits.html') && staged.out.includes('- legal/_privacy.nocredits.html'),
  'the no-credits legal variants are never published as pages of their own');

/* ---- 2. the substituted pages really are clean, on the bytes, not on the intent ----------------- */
if (!live) {
  const CREDITS_WORDS = /credit|stripe|gateway|billing|subscription/i;
  for (const f of ['_terms.nocredits.html', '_privacy.nocredits.html']) {
    const src = fs.readFileSync(path.join(ROOT, 'website', 'legal', f), 'utf8');
    const hit = src.match(CREDITS_WORDS);
    A.ok(!hit, 'website/legal/' + f + ' mentions no paid-tier wording' + (hit ? ' (found "' + hit[0] + '")' : ''));
  }
  // ...and the real ones DO, which is what makes the substitution necessary rather than decorative.
  const realTerms = fs.readFileSync(path.join(ROOT, 'website', 'legal', 'terms.html'), 'utf8');
  A.ok(/credit/i.test(realTerms), 'the REAL terms.html does describe Credits — otherwise the swap guards nothing');
}

/* ---- 3. the go-live script still recognises every file it claims to edit ------------------------ */
// This is the assertion that earns the test. It runs offline and asserts the shape of the plan, not
// the launch: eighteen edits, every one either already applied or matchable against the current tree.
const golive = run('go-live-credits.mjs', ['--check', '--no-probe']);
A.eq(golive.code, 0, 'go-live-credits.mjs --check --no-probe succeeds');
A.ok(!/UNRECOGNISED/.test(golive.out),
  'every go-live edit still matches the tree — an unrecognised one means an anchor drifted and launch day would half-apply');

const done = Number(/already live\s*:\s*(\d+)/.exec(golive.out)[1]);
const todo = Number(/to change\s*:\s*(\d+)/.exec(golive.out)[1]);

// Every docs page (recursively — docs/guides/ is a second level with the same topnav) and BOTH legal
// pages are enumerated. The last hand-run of this checklist fixed the docs family and missed the legal
// family; a count derived from the tree is what catches a family being dropped. The 5 = 3 flags +
// 2 cache keys.
function htmlUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(f =>
    f.isDirectory() ? htmlUnder(path.join(dir, f.name)) : (f.name.endsWith('.html') ? [path.join(dir, f.name)] : []));
}
const docsPages = htmlUnder(path.join(ROOT, 'website', 'docs'));
A.ok(docsPages.some(p => /[\\/]guides[\\/]/.test(p)), 'the enumeration reaches docs/guides/ (the Field Manual family)');
A.eq(done + todo, 5 + docsPages.length + 2,
  'the go-live plan covers every edit: 3 flags + 2 cache keys + a topnav link on every docs page and BOTH legal pages');
if (!live) A.eq(done, 0, 'with the tier held, none of the go-live edits are applied yet');
for (const f of ['terms.html', 'privacy.html']) {
  const src = fs.readFileSync(path.join(ROOT, 'website', 'legal', f), 'utf8');
  A.eq(/<a href="\.\.\/pricing\.html"[^>]*>PRICING<\/a>/.test(src), live,
    'website/legal/' + f + ' carries a PRICING topnav link exactly when pricing is live');
}

/* ---- 4. refusals, which are the only behaviour that matters when something is wrong -------------- */
const combo = run('go-live-credits.mjs', ['--apply', '--no-probe']);
A.eq(combo.code, 2, '--no-probe with --apply is refused: the probe is the whole guard');

const noMode = run('go-live-credits.mjs', []);
A.eq(noMode.code, 2, 'running with neither --check nor --apply refuses rather than guessing');

A.report('website-pricing-hold.test');
