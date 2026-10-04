/* node test/prop-awareness.test.js — agents step AROUND walkable props (prop awareness, 2026-07-13).

   THE BUG: chunky floor machinery ships as block:false (INBOX/BAY/OUTBOX 2x2, filter/merger/
   splitter, dropped decor) so bodies can dock on / cross those tiles — but every path planner
   treated them as open floor, so agents strolled straight THROUGH the machines.

   THE FIX: beltUnion() — the soft no-tread set the wander picker already preferred to avoid —
   now also carries every non-blocking prop footprint (rugs and airlocks excepted: those are
   MEANT to be crossed), and both goal-walk planners (setPathTo, stepCrewToSeat) try the
   soft-avoiding route first, falling back to the plain route when the machinery is the only
   way through (or the destination itself sits on a soft tile, e.g. a bay dock).

   world.js is a browser IIFE (can't require under node), so — per this repo's world.js test
   pattern (crew-containment.test.js) — these are SOURCE LOCKS: they pin the wiring so a
   refactor that drops any layer fails the fast gate with a named reason. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');

// ---- layer 1: beltUnion() carries non-blocking prop footprints (minus rug/airlock) ----
const bu = src.slice(src.indexOf('const SOFT_CROSS'), src.indexOf('/* ---------- IDLE ZONE'));
A.ok(bu.length > 0, 'SOFT_CROSS + beltUnion exist ahead of the idle-zone block');
/* Every RUG is freely crossable (a rug is floor) and so is the airlock (it is a door). This used to
   assert the set literal character-for-character, which meant adding a second rug to the catalog left
   agents stepping AROUND it with a green gate. Assert the invariant instead: the set is read out of the
   source and checked against the live catalog, so any future rug that isn't in it fails here. */
const softSet = (bu.match(/SOFT_CROSS = new Set\(\[([^\]]*)\]\)/) || [, ''])[1]
  .split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
A.ok(softSet.includes('airlock'), 'the airlock stays freely crossable (it is a door), got: ' + softSet.join('|'));
for (const c of require('../frontend/app/propsprites.js').CATALOG) {
  if (!/^rug(_|$)/.test(c.id)) continue;
  A.ok(softSet.includes(c.id), 'rug "' + c.id + '" is freely crossable (a rug is floor, not machinery to step around)');
}
A.ok(/if \(p\.block !== false \|\| SOFT_CROSS\.has\(p\.t\)\) continue;/.test(bu),
  'only NON-blocking props join the soft set (blocking props are already hard-blocked in geo.walkable)');
A.ok(/for \(let dy = 0; dy < \(p\.h \|\| 1\); dy\+\+\) for \(let dx = 0; dx < \(p\.w \|\| 1\); dx\+\+\) s\.add\(\(p\.x \+ dx\) \+ ',' \+ \(p\.y \+ dy\)\);/.test(bu),
  'the FULL footprint of each walkable prop is soft-blocked, not just its origin tile');

// ---- layer 2: the hero/crew goal planner prefers the machinery-avoiding route ----
const sp = src.slice(src.indexOf('function setPathTo('), src.indexOf('function nextWaypoint('));
A.ok(/geo\.path\(cur\.x, cur\.y, dest\.x, dest\.y, movementBlockers\(self, beltUnion\(\)\)\)\s*\|\| geo\.path\(cur\.x, cur\.y, dest\.x, dest\.y, blockers\)/.test(sp),
  'setPathTo tries the soft-avoiding route first, then falls back to the plain route (never strands a body)');

// ---- layer 3: the working walk to a chair gets the same preference ----
const cs = src.slice(src.indexOf('function stepCrewToSeat('), src.indexOf('/* ---------- per-body sentience engine'));
A.ok(/geo\.path\(cur\.x, cur\.y, s\.tx, s\.ty, movementBlockers\(b, beltUnion\(\)\)\)\s*\|\| geo\.path\(cur\.x, cur\.y, s\.tx, s\.ty, blockers\)/.test(cs),
  'stepCrewToSeat prefers the machinery-avoiding route to the chair, with the plain fallback');

A.report('prop-awareness.test');
