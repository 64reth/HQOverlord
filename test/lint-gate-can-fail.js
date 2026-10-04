/* node test/lint-gate-can-fail.js — every gate step that asserts must be ABLE to turn the gate red.

   THE HOLE THIS CLOSES (found 2026-07-25): test/_assert.js accumulates failures in a counter and ONLY
   `report()` calls process.exit(fail ? 1 : 0). A test that ends in a bare `console.log('... OK')` therefore
   prints "FAIL: ..." for every broken assertion and STILL exits 0 — the runner scores it green. SEVEN gate
   steps were in that state (diagnostics-support-email, interests, scout, run-truth, mcp.catalog, widgets,
   and servicekeys — the last one adopted INTO the gate while broken, by the very lane that found the others).
   None happened to be failing, so nothing was concealed at the time; the point is that none of them COULD
   have caught a future regression. A gate step that cannot fail is worse than no step: it reports safety.

   This lint enumerates the REAL gates (test/fast.list + test/http.list), keeps the
   steps that use the _assert.js helpers, and requires each to end its run by calling report() (or to own its
   exit explicitly via process.exit / fails()). It reads the SAME sources the runners read, so a step added to
   either gate is covered automatically — there is no second list to drift. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function fastSteps() {
  return read('test/fast.list').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}
function httpSteps() {
  return read('test/http.list').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

const steps = [...new Set([...fastSteps(), ...httpSteps()])];
if (steps.length < 300) {
  console.log('FAIL: only ' + steps.length + ' gate steps enumerated — the list sources moved, fix this lint');
  process.exit(1);
}

/* Comments MUST be stripped before looking for the settle call. Caught while testing this lint: the very
   comment added above each fixed test ("report() LAST — it is what calls process.exit(...)") contains both
   `report(` and `process.exit(`, so a naive scan matched the EXPLANATION and passed a file whose real code
   had been reverted to a bare console.log. A lint that reads its own documentation as proof is the same
   class of bug it exists to catch. */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');   // line comments (the [^:] keeps http:// in string literals intact)
}

const offenders = [];
let checked = 0;
for (const rel of steps) {
  let src;
  try { src = read(rel); } catch (_) { continue; }          // a step that does not exist is another test's problem
  if (!/_assert/.test(src)) continue;                        // not an _assert.js test (own runner / own exit)
  const code = stripComments(src);
  if (!/\b[A-Za-z_$][\w$]*\.(?:ok|eq|throws|notThrows)\s*\(/.test(code)) continue;   // imports it but asserts nothing
  checked++;
  /* A bare `process.exit(` is NOT evidence that the assertion counter is honoured. continuation-guard
     ended in `.catch(e => { console.error(e); process.exit(1) })`, which only fires on a THROWN error —
     all 16 of its assertions could fail and it still exited 0. The static lint passed it for months; the
     runtime guard in _assert.js is what caught it. So only two things count as settling: report(), or
     reading the counter yourself via fails(). */
  const settles = /\.report\s*\(/.test(code) || /\.fails\s*\(\s*\)/.test(code);
  if (!settles) offenders.push(rel);
}

if (offenders.length) {
  console.log('FAIL: ' + offenders.length + ' gate step(s) use _assert.js but can NEVER exit non-zero.');
  console.log('      They print FAIL and the runner still scores them green. End each with A.report(<name>):');
  for (const o of offenders) console.log('        ' + o);
  process.exit(1);
}

console.log('lint-gate-can-fail: ' + checked + ' asserting gate step(s) can all turn the gate red; OK');
