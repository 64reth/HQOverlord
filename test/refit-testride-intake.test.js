/* test/refit-testride-intake.test.js — the ▸ TEST ride and the auto-narrated first ride enter
   through a door that leads somewhere (conveyor-audit 2026-08-10, medium).

   THE SHIPPED BUG: build.js's intakeBeltTile() answered the FIRST intake in DOC order. On a floor
   with an older decorative/unfinished intake (belt-adjacent, lane to nowhere), the user stamps and
   crews a REAL line, the plan compiles complete — and the ONE-SHOT narrated first ride spawned at
   the decoy, captioned "③ SANK — no assigned dock on this line" at the exact teachable moment, and
   markRide() had already burned the latch before the crates even moved.

   THE LAW NOW: the ride's spawn mouth is reach-verified from the SAME compiled plan the sidecar
   routes by (Pipeline.sourceFor — the mouth whose lane actually REACHES the dock; the exact
   addressed-crate physics world.js rides). The auto first ride names the dock whose reach flipped
   true and rides THAT line's own mouth — and consumes its one shot only when the ride actually
   narrated (sendTestBoxes returned true), never on a sink, never on a decoy.

   Two layers, matching the repo's altitude split:
     1. FUNCTIONAL — the picker's primitive over a real two-intake station doc (worldmodel +
        pipeline are plain requires): sourceFor must name the crewed line's mouth, never the
        doc-order-first decoy's.
     2. SOURCE — build.js is a browser IIFE (not node-loadable; same rationale as
        refit-card-stack.test.js), so the wiring laws are asserted against the source. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

/* ---------- 1. FUNCTIONAL: a decoy intake first in doc order never owns the ride mouth ---------- */
{
  const s = WM.create();
  A.ok(s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 59, y2: 14 } }).ok, 'test deck placed');

  // the DECOY: an older decorative intake, FIRST in doc order, belt-adjacent (so the old
  // doc-order intakeBeltTile() picks it) — but its lane dead-ends at nothing.
  const decoy = s.addProp({ t: 'intake', x: 32, y: 2, w: 2, h: 2 });
  A.ok(decoy.ok, 'decoy intake placed');
  A.ok(s.setBelt(34, 3, 'E').ok && s.setBelt(35, 3, 'E').ok, 'decoy hooked to a lane that goes nowhere');

  // the REAL line: stamped + crewed AFTER the decoy (strictly later in doc order)
  A.ok(s.canPlaceBlueprint('research_line', 40, 4).ok, 'blueprint fits beside the decoy');
  A.ok(s.stampBlueprint('research_line', 40, 4).ok, 'research_line stamps');
  const bays = s.props().filter(p => p.t === 'bay');
  bays.forEach((b, i) => A.ok(s.assignPropAgent(b.id, 'crew' + i).ok, 'bay ' + i + ' binds'));

  const plan = P.compileRoutingPlan(s.projectGeometry());
  A.ok(P.ok(plan), 'the two-intake floor is deployable (the decoy is dressing, not a blocker)');
  A.eq(plan.sources.length, 2, 'both intakes compile as sources');
  const decoyId = s.props().find(p => p.t === 'intake' && p.x === 32).id;
  A.eq(plan.sources[0].propId, decoyId, 'the decoy IS first in plan order — the exact trap doc-order pickers fall into');
  A.ok(Object.keys(plan.reach).some(a => plan.reach[a]), 'the crewed line compiles COMPLETE (the first-ride arming condition)');

  const tilesOf = src => (src.tiles && src.tiles.length) ? src.tiles : (src.tile ? [src.tile] : []);
  const decoyTiles = tilesOf(plan.sources[0]);
  const realSrc = plan.sources.find(src => src.propId !== decoyId);
  const realTiles = tilesOf(realSrc);
  const inSet = (set, t) => set.some(m => m.x === t.x && m.y === t.y);

  // the line-under-test resolution — sourceFor per bound dock (what rideMouthFor(agentId) rides):
  // every dock the intake lane REACHES names the real line's mouth as its front door; a chain-fed
  // dock (research_line's WRITER — fed by the RESEARCHER's output, not the intake) honestly has
  // none (null — exactly why maybeFirstRide arms only on a reach-true dock); the decoy owns no
  // ride for ANY agent.
  let reachedDocks = 0;
  for (const b of bays) {
    const mouth = P.sourceFor(plan, b.agentId);
    if (plan.reach[b.agentId]) {
      reachedDocks++;
      A.ok(mouth, 'sourceFor answers a mouth for the intake-fed dock ' + b.agentId);
      A.ok(inSet(realTiles, mouth), b.agentId + "'s ride enters through the REAL line's own mouth");
      A.ok(!inSet(decoyTiles, mouth), b.agentId + "'s ride never spawns at the decoy");
    } else {
      A.eq(mouth, null, 'a chain-fed dock has no front door of its own (' + b.agentId + ')');
    }
  }
  A.ok(reachedDocks > 0, 'at least one dock is intake-fed — the ride has a line to narrate');

  // the LINELESS resolution (toolbar ▸ TEST): the reaching mouths, matched against plan order —
  // the decoy source owns none of them, so the first plan-order match is the real line's mouth.
  const reachingMouths = [];
  for (const a in plan.reach) if (plan.reach[a]) { const t = P.sourceFor(plan, a); if (t) reachingMouths.push(t); }
  A.ok(reachingMouths.length > 0, 'a complete floor always has a reaching mouth');
  A.ok(!decoyTiles.some(t => inSet(reachingMouths, t)), 'no reaching mouth is a decoy tile — plan-order scan cannot land on it');
  A.ok(realTiles.some(t => inSet(reachingMouths, t)), 'the real intake owns the first reaching mouth in plan order');
}

/* ---------- 2. SOURCE: build.js wires the picker, and the one-shot burns only on a real ride ---------- */
const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');

A.ok(/function rideMouthFor\(agentId\)/.test(build), 'the reach-aware ride-mouth picker exists (rideMouthFor)');
A.ok(/Pipeline\.sourceFor\(valPlan, agentId\)/.test(build), 'an addressed ride resolves through Pipeline.sourceFor — the compiled plan, never doc order');

// sendTestBoxes: reach-verified mouth first; doc order only as the MANUAL fallback; AUTO never falls back
const sendBlock = strip(build.slice(build.indexOf('function sendTestBoxes('), build.indexOf('THE FIRST CRATE NARRATES ITSELF')));
A.ok(/const t = rideMouthFor\(agentId\) \|\| \(auto \? null : intakeBeltTile\(\)\);/.test(sendBlock),
  'sendTestBoxes rides the reach-verified mouth; the doc-order intake only survives as the manual fallback');
A.ok(/return true;/.test(sendBlock) && /return false;/.test(sendBlock),
  'sendTestBoxes reports whether boxes actually rode (the auto one-shot keys on it)');

// maybeFirstRide: names the dock that powered on; no doc-order gate anywhere in it
const maybeBlock = strip(build.slice(build.indexOf('function maybeFirstRide('), build.indexOf('function fireFirstRide(')));
A.ok(!/intakeBeltTile\(\)/.test(maybeBlock), 'the first-ride arming no longer consults the doc-order intake at all');
A.ok(/rideAgentId = rideA;/.test(maybeBlock), 'the arm records WHICH dock powered on — the ride is line-addressed');
A.ok(/rideMouthFor\(rideA\)/.test(maybeBlock), '…and only arms when that line has its own reaching mouth');
A.ok(/if \(!prev\[a\]\)/.test(maybeBlock), 'the freshly-flipped reach is preferred — the ride narrates the line the user just completed');

// fireFirstRide: the latch burns AFTER a successful, line-addressed narration — never before
const fireBlock = strip(build.slice(build.indexOf('function fireFirstRide('), build.indexOf('function drawTestNotes(')));
A.ok(/if \(running && convey && sendTestBoxes\(null, true, rideAgentId\)\) markRide\(\);/.test(fireBlock),
  'markRide() is gated on the ride actually narrating the armed line — a decoy/sunk ride can never burn the one shot');
A.ok(fireBlock.indexOf('markRide') > fireBlock.indexOf('sendTestBoxes'), 'the burn strictly follows the ride');

A.report('refit-testride-intake');
