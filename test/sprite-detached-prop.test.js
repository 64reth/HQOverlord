/* No shipped sprite frame may carry a DETACHED PROP — a dead-straight bar parked at the edge of
   the frame, clear of the body, while the character's hands hold nothing.

   voidwizard.walk.north-west shipped like this for weeks: a full-height 3px pole at x=33..35
   with the body starting at x=36 and the hand-grip 10px away. Andrew reported it repeatedly as
   "a stupid floating stick" and every automated check passed it —

     test/sprite-walk-motion.test.js   passes: right build, feet on the floor line
     a connected-component orphan scan passes: the hat brim's outline brushes the pole's right
                                               column for four rows, so it is ONE component

   which is why this test measures GEOMETRY rather than topology. A bar is a leading or trailing
   column group up to 3 wide whose ink spans at least half the content height while the column
   just inside it is nearly empty. A staff held vertically THROUGH the hand fails that last
   clause — the body is solid right next to it — so real art is not caught.

   ⛔ Do not relax minFrac or the inside-column clause to make a new asset pass. The pole scored
   45/45 with inside=6; there is a wide margin between it and anything legitimate. If a genuine
   prop trips this, the prop is drawn detached and the ART is what needs fixing. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const A = require('./_assert.js');

const ROOT = path.join(__dirname, '..', 'frontend', 'assets', 'sprites');
const SCAN = path.join(__dirname, '..', 'dev', 'skin-bar-scan.mjs');

const sets = fs.readdirSync(ROOT).filter(d => !d.startsWith('_') &&
  fs.statSync(path.join(ROOT, d)).isDirectory());
A.ok(sets.length >= 30, `found ${sets.length} sprite sets — the roster should be ~36`);

const out = execFileSync(process.execPath, [SCAN], { encoding: 'utf8', maxBuffer: 8 << 20 });
const hits = out.split('\n').filter(l => /^ {2}\S+\s+(left|right)\s+x=/.test(l));

A.ok(/DETACHED MARGIN BARS/.test(out), 'the bar scan ran and reported');
A.ok(hits.length === 0,
  `${hits.length} frame(s) carry a detached margin bar — a prop floating clear of the body:\n` +
  out.split('\n').filter(l => l.trim() && !/^=/.test(l)).slice(0, 20).join('\n'));

A.report('sprite-detached-prop.test');
