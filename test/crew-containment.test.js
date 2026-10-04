/* node test/crew-containment.test.js — agent-in-the-void escape (2026-07-12) containment locks.

   THE BUG: rederive() re-framed only the HERO across a station origin shift (a room added/removed
   at the north/west edge moves the whole local pixel frame), so every crew body kept old-frame
   px/py + an old-frame path — rendering it adrift in the void until the next task seized it back.
   Two more holes compounded it: syncCrewFromPlan's no-bays early return skipped the stranded
   re-foot entirely, and nothing at tick time ever checked a body's feet against the floor.

   world.js is a browser IIFE (can't require under node), so — per this repo's world.js test
   pattern (social-border.test.js) — these are SOURCE LOCKS: they pin the wiring that closes each
   hole, so a refactor that drops any layer fails the fast gate with a named reason. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');

// ---- layer 1: rederive() re-frames EVERY crew body across an origin shift, like the hero ----
const red = src.slice(src.indexOf('function rederive('), src.indexOf('function rebake('));
A.ok(red.length > 0, 'rederive() and rebake() both exist (slice is non-empty)');
A.ok(/const cdx = \(oldOrigin\.tx - geo\.origin\.tx\) \* T/.test(red),
  'rederive computes the crew origin-shift delta (cdx) from oldOrigin');
A.ok(/for \(const b of crew\) \{[\s\S]*?b\.px \+= cdx; b\.py \+= cdy;/.test(red),
  'rederive shifts every crew body\'s px/py into the NEW frame');
A.ok(/b\.seatPx \+= cdx; b\.seatPy \+= cdy;/.test(red),
  'the seated render position rides the frame shift too');
A.ok(/if \(b\.home\) \{ b\.home\.x \+= oldOrigin\.tx - geo\.origin\.tx/.test(red),
  'the leash home tile is re-framed (tile delta, not pixel delta)');
A.ok(/b\.pathPts = null; b\.target = null;\s*\/\/ the in-flight path is in the OLD frame/.test(red),
  'crew in-flight paths are dropped on rederive (they were plotted in the OLD frame)');
// the crew re-frame must land BEFORE syncCrewFromPlan's walkable checks see the positions
A.ok(red.indexOf('b.px += cdx') < red.indexOf('syncCrewFromPlan()'),
  'the crew re-frame runs BEFORE syncCrewFromPlan (whose walkable checks need new-frame px/py)');

// ---- layer 2: the no-bays plan still re-foots stranded summoned bodies ----
const sync = src.slice(src.indexOf('function syncCrewFromPlan('), src.indexOf('function sweepAgentMaps('));
A.ok(/if \(geo\) refootStranded\(\);/.test(sync),
  'syncCrewFromPlan\'s no-bays early return still runs refootStranded (the old skip stranded bodies forever)');
A.ok(/refootStranded\(\);\s*\/\/ a refit may have moved the floor/.test(sync),
  'the main syncCrewFromPlan path re-foots stranded summoned bodies');
A.ok(/function refootStranded\(\)/.test(src) && /const f = workerFoot\(\); b\.px = f\.x; b\.py = f\.y; b\.home = tileOf\(f\.x, f\.y\);/.test(src),
  'refootStranded re-foots to a real floor tile AND re-pins the leash home');

// ---- layer 3: per-tick containment backstop — no standing body ever stays off the floor ----
A.ok(/function containBody\(b, now\)/.test(src), 'the containment backstop containBody exists');
const cb = src.slice(src.indexOf('function containBody('), src.indexOf('function stepCrew('));
A.ok(/if \(b\.seated \|\| b\.sitting\) return;/.test(cb),
  'seated/desk-sitting poses are exempt (their logical foot is already on a walkable tile)');
A.ok(/if \(geo\.walkable\(t\.x, t\.y, blocked\)\) return;/.test(cb),
  'a body on real floor is untouched (the backstop is a no-op in the healthy case)');
A.ok(/seizeFromIdle\(b\);/.test(cb),
  'an off-floor body drops its in-flight goal/seat claims before re-homing (they are in a broken frame)');
A.ok(/if \(!f\) f = workerFoot\(\);/.test(cb),
  'truly-in-the-void bodies (no floor in the local ring) re-home to the spawn room');
A.ok(/containBody\(b, now\);/.test(src.slice(src.indexOf('function stepCrew('))),
  'stepCrew runs the backstop on every placed body, every tick');
A.ok(/if \(!agent\.sitting && !agent\.seated\) ensureAgentValid\(\);/.test(src),
  'the HERO gets the same per-tick backstop (ensureAgentValid was rederive-only before)');

/* ---- layer 4: the backstop must NOT fire on a body that is mid-walk (phantom-teleport lock) ----
   footOf anchors a foot to the BOTTOM edge of its tile while tileOf floors py/T, so the segment between
   two legal feet reports the tile BELOW the destination in passing. Where that tile holds a blocking prop
   the backstop used to read a healthy walker as off-floor and re-home it to the spawn tile mid-stride —
   observed live as a 5.7-tile "teleport" on the seed floor (bar at local 4..7,4). Re-homing is now gated
   on the body NOT following a path. No coverage is lost: every real stranding (origin shift, floor
   reclaimed underfoot) drops pathPts/target in rederive first, so the backstop still fires the next tick. */
const eav = src.slice(src.indexOf('function ensureAgentValid('), src.indexOf('function spawn('));
A.ok(eav.length > 0, 'ensureAgentValid() and spawn() both exist (slice is non-empty)');
A.ok(/if \(agent\.target\) return;/.test(eav),
  'the HERO backstop skips a body that is mid-walk (transit tile readings are not strandings)');
A.ok(eav.indexOf('if (agent.target) return;') < eav.indexOf('placeAgent()'),
  'the hero mid-walk guard runs BEFORE the re-home (else it would re-home first and never reach the guard)');
A.ok(/if \(b\.target\) return;/.test(cb),
  'the CREW backstop skips a body that is mid-walk, exactly like the hero');
A.ok(cb.indexOf('if (b.target) return;') < cb.indexOf('seizeFromIdle(b);'),
  'the crew mid-walk guard runs BEFORE seizeFromIdle (a healthy walker must not lose its goal either)');
A.ok(/TRANSIT READING/.test(src),
  'the TRANSIT READING rationale stays in the source (why the guard exists, so it is not "simplified" away)');

A.report('crew-containment.test');
