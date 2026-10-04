/* node test/qa-bugs-register.test.js — validates the REAL on-disk bug register (qa/bugs/)
   against the same core the CLI uses, plus the generated index (qa/BUGS.md).

   WHY THIS IS A SEPARATE FILE FROM qa-bugs.test.js: that test proves the register's LOGIC
   with an in-memory io and never touches disk. This one proves the register's CONTENT — that
   what ten sweep lanes actually committed still parses, still carries evidence and a repro,
   never claims `fixed` without a commit, and that qa/BUGS.md is genuinely regenerated rather
   than hand-edited into a lie. Logic tests pass forever while the backlog rots; only reading
   the real bytes catches that. Runs in test:fast, so a lane that commits a malformed bug file
   or a stale index turns the gate red in its own branch, not on trunk. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const { makeBugRegister, SURFACES } = require('../scripts/qa/bugs.mjs');
const { makeCoverageChecker } = require('../scripts/qa/bug-lifecycle.mjs');

const ROOT = path.resolve(__dirname, '..');
const BUGS_DIR = path.join(ROOT, 'qa', 'bugs');
const INDEX_FILE = path.join(ROOT, 'qa', 'BUGS.md');
const KNOWN_FILE = path.join(ROOT, 'qa', 'KNOWN_ISSUES.md');
const SWEEP_DIR = path.join(ROOT, 'loops', 'sweep');

// Mirror the CLI's real io exactly — same README skip, same sort, same baseline scrape. If these
// drift apart the test stops guarding what the CLI actually reads.
function readKnownFingerprints() {
  try {
    const txt = fs.readFileSync(KNOWN_FILE, 'utf8');
    const out = new Set();
    const re = /fingerprint[:=]\s*`?([0-9a-fA-F]{6,})`?/g;
    let m;
    while ((m = re.exec(txt))) out.add(m[1].toLowerCase());
    return out;
  } catch (_) { return new Set(); }
}

const io = {
  checkCoverage: makeCoverageChecker(ROOT),
  listBugs() {
    let names;
    try { names = fs.readdirSync(BUGS_DIR); } catch (_) { return []; }
    const out = [];
    for (const n of names.sort()) {
      if (!n.endsWith('.md') || n === 'README.md') continue;
      out.push({ file: n, text: fs.readFileSync(path.join(BUGS_DIR, n), 'utf8') });
    }
    return out;
  },
  writeBug() { throw new Error('this test is READ-ONLY — it must never write a bug file'); },
  knownFingerprints() { return readKnownFingerprints(); }
};

// The clock is irrelevant for validation (nothing here creates a bug), but injecting a fixed one
// keeps the test deterministic and honors the no-ambient-time house rule.
const reg = makeBugRegister({ io, clock: { today: () => '1970-01-01' } });

// ---- 1. the directory itself is intact ----
{
  A.ok(fs.existsSync(BUGS_DIR), 'qa/bugs/ exists');
  A.ok(fs.existsSync(path.join(BUGS_DIR, 'README.md')), 'qa/bugs/README.md is tracked so a fresh clone explains itself');
}

// ---- 2. every committed bug file obeys the register laws ----
{
  const v = reg.validate();
  if (!v.ok) for (const e of v.errors) console.log('  register violation: ' + e);
  A.eq(v.ok, true, 'every file in qa/bugs/ is valid (' + v.errors.length + ' violation(s))');
}

// ---- 3. qa/BUGS.md is GENERATED, not hand-edited ----
// Regenerating must be a no-op. If it isn't, someone edited the index by hand or filed a bug
// without rebuilding — either way the index is no longer a truthful view of the directory.
{
  const expected = reg.index() + '\n';
  const actual = fs.existsSync(INDEX_FILE) ? fs.readFileSync(INDEX_FILE, 'utf8') : '';
  A.eq(actual.replace(/\r\n/g, '\n'), expected,
    'qa/BUGS.md is up to date — run `npm run qa:bugs:index` after filing or closing a bug');
}

// ---- 4. the roll-up is readable (and prints the backlog, so a red gate shows WHAT is open) ----
{
  const c = reg.counts();
  A.ok(typeof c.open === 'number' && c.open >= 0, 'counts().open is a number');
  A.ok(c.open <= c.total, 'open never exceeds total');
  console.log('  register: ' + c.open + ' open of ' + c.total + ' total — ' +
    c.bySeverity.P0 + ' P0 · ' + c.bySeverity.P1 + ' P1 · ' + c.bySeverity.P2 + ' P2');
  for (const b of reg.list({ status: 'open' })) {
    console.log('    ' + b.severity + ' ' + b.surface.padEnd(11) + ' ' + b.title);
  }
}

// ---- 5. every surface the register accepts has a lane brief, and vice versa ----
// The surface list is what routes a bug to an owner during a fan-out. If it drifts from
// loops/sweep/, a bug can be filed against a surface nobody is hunting — it lands in the
// backlog and is never picked up, which is the exact failure the register exists to prevent.
{
  let briefs = [];
  try {
    briefs = fs.readdirSync(SWEEP_DIR)
      .filter(n => n.endsWith('.md') && n !== 'README.md')
      .map(n => n.replace(/\.md$/, ''))
      .sort();
  } catch (_) { /* reported by the assertion below */ }
  A.eq(briefs, SURFACES.slice().sort(),
    'loops/sweep/<surface>.md exists for exactly the surfaces scripts/qa/bugs.mjs accepts');
  A.ok(fs.existsSync(path.join(SWEEP_DIR, 'README.md')), 'loops/sweep/README.md carries the shared protocol');
}

A.report('qa-bugs-register.test');
