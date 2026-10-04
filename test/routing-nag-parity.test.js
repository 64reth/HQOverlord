/* test/routing-nag-parity.test.js — the two floor-callout tables must cover the same compiler codes.

   REFIT (frontend/app/build.js VAL_LABEL) and the live world (frontend/app/world.js NAG_LABEL) each turn a
   compiled routing error into a short callout painted on the broken machine. They are two tables, and the
   world's projector does `if (!label) continue` — so a code present in one and missing from the other is a
   real finding that the live floor SILENTLY DROPS. The Commander then sees a dead line and no reason
   anywhere: the exact failure this pair of tables exists to prevent. ORPHAN_JUNCTION shipped that way
   (2026-08-07 conveyor audit) — REFIT named it, the world said nothing.

   The WORDING is deliberately NOT asserted equal: REFIT has room to spell out a gesture ("MOVE IT ONTO THE
   LINE") that the world's 8px in-world label does not. Coverage is the law; phrasing is per-surface.

   Read out of the SOURCE on purpose. Neither table is exported, and both files are browser IIFEs that pull
   in a DOM/canvas — a test that required them would prove nothing about the shipped constants. String
   literals are stripped before keys are read, so a label containing a colon ("BELT: CLICK IT") can't be
   mistaken for a key. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', f), 'utf8');

// pull `const <NAME> = { … };` out of a source file and return its KEY set
function tableKeys(src, name, where) {
  const start = src.indexOf('const ' + name + ' = {');
  A.ok(start >= 0, name + ' is still declared in ' + where);
  let i = src.indexOf('{', start), depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) { end = j; break; } }
  }
  A.ok(end > i, name + ' has a balanced body in ' + where);
  const body = src.slice(i, end + 1)
    .replace(/'(?:\\.|[^'\\])*'/g, "''")     // strip single-quoted labels FIRST (they contain colons and commas)
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')       // …then the comments between entries (they contain colons too,
    .replace(/\/\/[^\n]*/g, ' ');            //    and a commented entry must not read as the next key's lead-in)
  const keys = [];
  const re = /(?:[{,])\s*([A-Z][A-Z0-9_]*)\s*:/g;
  let m;
  while ((m = re.exec(body))) keys.push(m[1]);
  return keys;
}

const VAL = tableKeys(read('build.js'), 'VAL_LABEL', 'build.js');
const NAG = tableKeys(read('world.js'), 'NAG_LABEL', 'world.js');

A.ok(VAL.length >= 10, 'REFIT names at least ten routing findings (' + VAL.length + ')');
A.ok(NAG.length >= 10, 'the live world names at least ten routing findings (' + NAG.length + ')');

// THE LAW: every finding REFIT can explain, the live world can also explain.
const missing = VAL.filter(k => NAG.indexOf(k) < 0);
A.eq(missing.join(',') , '', 'every VAL_LABEL code has a NAG_LABEL entry — else the live world drops the finding silently');

// the regression that named this file
A.ok(VAL.indexOf('ORPHAN_JUNCTION') >= 0, 'ORPHAN_JUNCTION is a REFIT callout');
A.ok(NAG.indexOf('ORPHAN_JUNCTION') >= 0, '…and the live world calls it out too (it used to be dropped)');

// and the other direction is worth knowing about: the world must not invent codes REFIT can't explain
const orphaned = NAG.filter(k => VAL.indexOf(k) < 0);
A.eq(orphaned.join(','), '', 'and no NAG_LABEL code is unknown to REFIT');

// no duplicate keys in either table (a duplicate silently wins and hides the earlier wording)
const dupes = t => t.filter((k, i) => t.indexOf(k) !== i);
A.eq(dupes(VAL).join(','), '', 'VAL_LABEL has no duplicate keys');
A.eq(dupes(NAG).join(','), '', 'NAG_LABEL has no duplicate keys');

A.report('routing-nag-parity');
