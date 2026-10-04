/* node test/zones.test.js — the IDLE-CONTAINMENT primitive. Pure geometry: derive the area an
   agent may roam while idle from room rects + props, with zero world/DOM/RNG state.

   Contract under test (plan A2 / invariants I2,I3):
     • an agent anchored inside a room -> a 'room' zone = the SMALLEST enclosing rect
     • an agent on open floor (no enclosing rect) -> a bounded 'leash' zone around the anchor
     • an unassigned / unplaced agent (no anchor) -> null (it does NOT roam)
     • a SOLO agent whose room spans the station -> a LARGE room zone (no regression)
     • inZone(null,..) is false; clampPickable filters candidates to the zone, preserving order. */
'use strict';
const A = require('./_assert.js');
const Z = require('../frontend/app/zones.js');

// ---- the module surface ----
A.ok(typeof Z.computeZone === 'function', 'exports computeZone');
A.ok(typeof Z.inZone === 'function', 'exports inZone');
A.ok(typeof Z.clampPickable === 'function', 'exports clampPickable');

// a tiny station: one big room (z0) and a small side room (z1), LOCAL inclusive rects
const RECTS = [
  { z: 0, x1: 0,  y1: 0,  x2: 20, y2: 12 },   // big main room, area 21*13 = 273
  { z: 1, x1: 22, y1: 0,  x2: 27, y2: 5  },   // small side room, area 6*6 = 36
];
// props: agent 'a1' has a bay foot tile inside the side room; 'a2' has a workstation in the big room
const PROPS = [
  { id: 'p1', t: 'bay',         x: 24, y: 3, w: 1, h: 1, agentId: 'a1' },
  { id: 'p2', t: 'workstation', x: 8,  y: 6, w: 2, h: 1, agentId: 'a2' },
  { id: 'p3', t: 'couch',       x: 5,  y: 5, w: 1, h: 1, agentId: null },   // unbound
  // 'a3' has TWO bound props: a non-bay (workstation) that comes BEFORE its bay. anchorFromProps
  // must PREFER the bay, discriminating the `bay || any` selection (not just take the first bound).
  { id: 'p4', t: 'workstation', x: 1,  y: 1, w: 1, h: 1, agentId: 'a3' },   // earlier, non-bay
  { id: 'p5', t: 'bay',         x: 24, y: 4, w: 1, h: 1, agentId: 'a3' },   // later, the bay (preferred)
];

// ---- room-anchored zone (explicit anchorTile) ----
const zSide = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1', anchorTile: { x: 24, y: 3 } });
A.eq(zSide.kind, 'room', 'agent in the side room gets a room zone');
A.eq(zSide.rect, { x1: 22, y1: 0, x2: 27, y2: 5 }, 'room zone is the enclosing side-room rect');

// the room zone is a COPY, not an alias of the source rect (purity — mutating result must not touch input)
zSide.rect.x1 = 999;
A.eq(RECTS[1].x1, 22, 'computeZone returns a rect COPY — source allRects untouched');

// ---- room-anchored zone resolved from a bound PROP (no explicit anchorTile) ----
const zFromProp = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1' });
A.eq(zFromProp.kind, 'room', 'anchor resolved from the bay prop when no anchorTile given');
A.eq(zFromProp.rect.x1, 22, 'prop-derived anchor lands in the side room');

// ---- bay preference: an earlier non-bay bound prop must NOT win over a later bay ----
// 'a3' is bound to a workstation at (1,1) in the BIG room AND a bay at (24,4) in the SIDE room,
// workstation first. If anchorFromProps took the first bound prop it would resolve the big room;
// preferring the bay resolves the side room. This discriminates the `bay || any` branch.
const zBayPref = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a3' });
A.eq(zBayPref.kind, 'room', 'a3 anchor resolves to a room via its bay');
A.eq(zBayPref.rect, { x1: 22, y1: 0, x2: 27, y2: 5 }, 'anchor resolves from the BAY (side room), not the earlier workstation (big room)');

// ---- workstation-ONLY agent resolved from a bound PROP (no bay, no anchorTile) ----
// 'a2' is bound to a single NON-bay prop (a workstation at (8,6) in the big room). With no
// anchorTile, anchorFromProps has no bay to take, so it MUST fall through to the `any` bound
// prop and resolve the workstation's room. This exercises the `bay || any` fallback through the
// public computeZone API: mutating `const p = bay || any` -> `const p = bay` makes a3-style
// agents still pass but resolves a2 to null here (so this case kills that mutant).
const zWorkOnly = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a2' });
A.eq(zWorkOnly.kind, 'room', 'workstation-only agent (no bay) resolves a room via the `any` bound-prop fallback');
A.eq(zWorkOnly.rect, { x1: 0, y1: 0, x2: 20, y2: 12 }, 'a2 anchor resolves from its only prop (the big-room workstation), not null');

// agent in the big room
const zMain = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a2', anchorTile: { x: 8, y: 6 } });
A.eq(zMain.kind, 'room', 'agent in the big room gets a room zone');
A.eq(zMain.rect, { x1: 0, y1: 0, x2: 20, y2: 12 }, 'big-room zone is the big rect');

// ---- smallest-enclosing tie-break: a nested rect wins over the room it sits in ----
const NESTED = [
  { z: 0, x1: 0, y1: 0, x2: 30, y2: 30 },   // outer, area 31*31
  { z: 1, x1: 5, y1: 5, x2: 9, y2: 9 },     // inner nook, area 5*5 = 25
];
const zNook = Z.computeZone({ rects: NESTED, anchorTile: { x: 7, y: 7 } });
A.eq(zNook.rect, { x1: 5, y1: 5, x2: 9, y2: 9 }, 'tightest enclosing rect wins (the nook, not the hall)');

// ---- equal-area tie-break: strict < keeps the FIRST of equal-area ties (stable / deterministic) ----
// two distinct rects of identical area (5*10 = 50) both enclose the anchor (4,5). The documented
// rule (zones.js: strict < / earliest array index) must return the FIRST. Changing < to <= would
// return the second — this case locks the stable tie-break so determinism (I3) cannot regress.
const TIE = [
  { z: 0, x1: 0, y1: 0, x2: 4, y2: 9 },   // first, area 5*10 = 50, contains (4,5)
  { z: 1, x1: 3, y1: 0, x2: 7, y2: 9 },   // second, area 5*10 = 50, also contains (4,5)
];
A.ok(Z.rectArea(TIE[0]) === Z.rectArea(TIE[1]), 'tie-break fixture: the two rects are equal-area');
const zTie = Z.computeZone({ rects: TIE, anchorTile: { x: 4, y: 5 } });
A.eq(zTie.rect, { x1: 0, y1: 0, x2: 4, y2: 9 }, 'equal-area tie -> the FIRST in array order wins (stable tie-break)');

// ---- leash fallback: anchor on open floor with NO enclosing rect ----
const zLeash = Z.computeZone({ rects: RECTS, anchorTile: { x: 40, y: 40 }, leashR: 4 });
A.eq(zLeash.kind, 'leash', 'no enclosing room -> leash zone');
A.eq(zLeash.cx, 40, 'leash centered on the anchor x');
A.eq(zLeash.cy, 40, 'leash centered on the anchor y');
A.eq(zLeash.r, 4, 'leash honors the supplied radius');

const zLeashDefault = Z.computeZone({ rects: [], anchorTile: { x: 3, y: 3 } });
A.eq(zLeashDefault.kind, 'leash', 'empty rects -> leash');
A.eq(zLeashDefault.r, Z.DEFAULT_LEASH, 'leash falls back to DEFAULT_LEASH when none supplied');

// ---- leash-from-current-tile: the deskless placed crew body (world.js anchorFor fallback) ----
// A freshly-summoned worker is PLACED (unplaced:false) but has no workstation/bay yet, so world.js
// anchorFor() falls back to the body's OWN foot tile (tileOf(px,py)) as the anchor. If that tile sits
// on open floor outside every room rect, computeZone must yield a BOUNDED leash centered there — NOT
// null. This is what restores BR-4 'summoned agents move' (a null zone froze the body permanently in
// crewWander). Here the worker stands at (40,40), outside both RECTS rooms.
const zDeskless = Z.computeZone({ rects: RECTS, anchorTile: { x: 40, y: 40 } });
A.eq(zDeskless.kind, 'leash', 'deskless placed crew body (anchored on its own off-room foot tile) gets a leash, not null');
A.ok(zDeskless != null, 'a placed deskless body is NEVER null-zoned (would freeze it — the P2 regression)');
A.eq(zDeskless.cx, 40, 'leash centers on the body foot tile x');
A.eq(zDeskless.cy, 40, 'leash centers on the body foot tile y');
A.eq(Z.inZone(zDeskless, 40, 40), true, 'the body can stand on its own anchor tile (so crewWander has at least one in-zone target)');
A.eq(Z.inZone(zDeskless, 40 + Z.DEFAULT_LEASH, 40), true, 'the leash extends DEFAULT_LEASH tiles so the body can actually stroll a little');
A.eq(Z.inZone(zDeskless, 40 + Z.DEFAULT_LEASH + 1, 40), false, 'but the deskless body stays bounded near its spawn spot (lane discipline)');
// if that same foot tile DOES sit inside a room, the body gets that room (the room path still wins)
const zDesklessInRoom = Z.computeZone({ rects: RECTS, anchorTile: { x: 8, y: 6 } });
A.eq(zDesklessInRoom.kind, 'room', 'a deskless body whose foot tile is inside a room is caged to that room, not a leash');

// ---- LEASH DOES NOT DRIFT as the body walks (the b5c3580 ratchet regression) ----
// world.js anchorFor() must feed computeZone a STABLE home tile (b.home), NOT the body's transient
// live foot tile. If it fed the live tile, then each crewWander cycle would re-center the leash on
// wherever the body now stands, so the body could step up to DEFAULT_LEASH tiles, re-center there,
// and ratchet across the whole floor in 5-tile hops — defeating A2 'bounded leash'. We simulate the
// two anchor strategies here at the primitive level: a body SPAWNED at (40,40) then walked to the
// leash edge (45,40). The STABLE-home strategy keeps the leash fixed at the spawn spot; the buggy
// live-tile strategy would have moved it. We assert the bounded edge does not advance.
const HOME = { x: 40, y: 40 };
const zAtSpawn = Z.computeZone({ rects: RECTS, anchorTile: HOME });        // anchorFor returns b.home
A.eq(zAtSpawn.cx, 40, 'leash centered on the STABLE home, not wherever the body currently stands');
// the body strolls to the far in-zone edge (40 + DEFAULT_LEASH, 40), then a new wander cycle recomputes
const farEdgeX = 40 + Z.DEFAULT_LEASH;
A.eq(Z.inZone(zAtSpawn, farEdgeX, 40), true, 'the body can reach the leash edge while strolling');
// CORRECT (stable home): recompute with the SAME home tile -> leash unchanged, edge does NOT advance
const zNextStable = Z.computeZone({ rects: RECTS, anchorTile: HOME });
A.eq(zNextStable.cx, 40, 'after the body walked to the edge, the stable-home leash STILL centers at the spawn spot (no drift)');
A.eq(Z.inZone(zNextStable, farEdgeX + 1, 40), false, 'the bounded edge does NOT advance past the spawn-centered leash (A2 holds over time)');
// BUG (live tile): had anchorFor read the live foot tile (now at the edge), the leash would re-center
// there and a tile that MUST stay out-of-zone would become reachable — locking why home must be stable.
const zNextLive = Z.computeZone({ rects: RECTS, anchorTile: { x: farEdgeX, y: 40 } });
A.eq(Z.inZone(zNextLive, farEdgeX + Z.DEFAULT_LEASH, 40), true,
  'control: a leash recomputed from the LIVE tile WOULD ratchet outward — proving anchorFor must use b.home, not px/py');
A.ok(zNextLive.cx !== zNextStable.cx, 'stable-home vs live-tile anchors diverge once the body has moved — the drift the fix prevents');

// ---- non-positive leashR falls back to DEFAULT_LEASH (the `> 0` guard) ----
// A 0/negative radius would yield a degenerate single-tile leash (r:0) the agent can't roam in,
// so the guard must reject it and use DEFAULT_LEASH. Mutating `opts.leashR > 0` -> `>= 0` lets
// leashR:0 produce r:0 — these cases lock the guard.
A.eq(Z.computeZone({ rects: [], anchorTile: { x: 5, y: 5 }, leashR: 0 }).r, Z.DEFAULT_LEASH,
  'leashR:0 is non-positive -> falls back to DEFAULT_LEASH (not a degenerate r:0)');
A.eq(Z.computeZone({ rects: [], anchorTile: { x: 5, y: 5 }, leashR: -3 }).r, Z.DEFAULT_LEASH,
  'negative leashR -> falls back to DEFAULT_LEASH');

// ---- fractional leashR is floored to an integer tile count (Math.floor) ----
// A radius is a count of tiles; a fractional input must normalize down. Mutating
// `Math.floor(opts.leashR)` -> `opts.leashR` would leak the 4.9 — this locks the flooring.
A.eq(Z.computeZone({ rects: [], anchorTile: { x: 0, y: 0 }, leashR: 4.9 }).r, 4,
  'fractional leashR (4.9) is floored to an integer radius (4)');

// ---- unassigned / unplaced -> null (no anchor at all) ----
A.eq(Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'ghost' }), null, 'unknown agent with no anchor -> null');
A.eq(Z.computeZone({ rects: RECTS }), null, 'no agentId, no anchorTile, no props -> null');
A.eq(Z.computeZone({}), null, 'empty opts -> null');
A.eq(Z.computeZone(), null, 'no opts -> null');

// ---- SOLO agent whose room spans the station -> a LARGE room zone (no regression / A3,I2) ----
const SOLO_RECTS = [{ z: 0, x1: 0, y1: 0, x2: 63, y2: 47 }];   // whole-floor single room
const zSolo = Z.computeZone({ rects: SOLO_RECTS, anchorTile: { x: 30, y: 24 } });
A.eq(zSolo.kind, 'room', 'solo agent gets a room zone, not a leash');
A.eq(zSolo.rect, { x1: 0, y1: 0, x2: 63, y2: 47 }, 'solo zone spans the whole station rect');
A.ok(Z.rectArea(zSolo.rect) === 64 * 48, 'solo zone is large (whole floor) — rich behavior preserved');
// every corner of the floor is in-zone for the solo agent (no idle beat stripped)
A.ok(Z.inZone(zSolo, 0, 0) && Z.inZone(zSolo, 63, 47) && Z.inZone(zSolo, 63, 0) && Z.inZone(zSolo, 0, 47),
  'solo zone admits all four station corners (gaze-out / vigil unaffected)');

// ---- SOLE OWNERSHIP (solo) in a MULTI-ROOM station -> a 'multi' zone spanning every room (A3/I2) ----
// The realistic solo case the I2-regression fix targets: a lone hero in a BUILT-OUT station whose
// desk room is only ONE of several rooms. Without solo widening, computeZone would resolve the
// SMALLEST enclosing room (the side room here) and cage the hero out of the big room — stripping
// previously-valid cross-room idle targets. With solo:true the zone is the UNION of all rects.
const zSoloMulti = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1', anchorTile: { x: 24, y: 3 }, solo: true });
A.eq(zSoloMulti.kind, 'multi', 'sole owner in a multi-room station gets a multi zone (whole floor), not its desk room');
A.eq(zSoloMulti.rects.length, 2, 'multi zone unions EVERY room rect');
// every rect is a normalized COPY — mutating the result must not touch geo's source array
zSoloMulti.rects[0].x1 = 999;
A.eq(RECTS[0].x1, 0, 'multi zone rects are COPIES — source allRects untouched');
// in-zone across BOTH rooms (the cross-room targets a single-room zone would have dropped)
const zSoloMulti2 = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1', anchorTile: { x: 24, y: 3 }, solo: true });
A.eq(Z.inZone(zSoloMulti2, 8, 6), true, 'solo hero anchored in the side room is STILL in-zone in the big room (no I2 regression)');
A.eq(Z.inZone(zSoloMulti2, 24, 3), true, 'solo hero is in-zone in its own desk room too');
A.eq(Z.inZone(zSoloMulti2, 50, 50), false, 'off-floor tile (in no room rect) is out-of-zone even for the sole owner');
// clampPickable spans rooms for the sole owner: a candidate in EITHER room survives
const soloCands = [{ x: 8, y: 6, tag: 'big' }, { x: 24, y: 3, tag: 'side' }, { x: 50, y: 50, tag: 'off' }];
A.eq(Z.clampPickable(zSoloMulti2, soloCands).map(c => c.tag), ['big', 'side'],
  'clampPickable keeps in-zone candidates across ALL rooms for the sole owner, dropping only off-floor');

// solo with NO rects (degenerate) -> falls back (null here since the anchor also has no room/leash basis...
// actually open-floor leash): solo widening only applies when there IS a rect to span.
const zSoloNoRects = Z.computeZone({ rects: [], anchorTile: { x: 5, y: 5 }, solo: true });
A.eq(zSoloNoRects.kind, 'leash', 'solo with no room rects falls back to the leash (nothing to span)');

// solo never overrides the unassigned->null rule (no anchor still means no zone)
A.eq(Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'ghost', solo: true }), null,
  'solo:true does NOT grant a zone to an unplaced/unassigned agent (no anchor -> still null)');

// ---- inZone: room membership (inclusive) ----
A.eq(Z.inZone(null, 5, 5), false, 'inZone(null,..) is false — no zone, no roaming');
A.eq(Z.inZone(zMain, 0, 0), true, 'room corner (0,0) is in-zone (inclusive)');
A.eq(Z.inZone(zMain, 20, 12), true, 'room far corner (20,12) is in-zone (inclusive)');
A.eq(Z.inZone(zMain, 21, 12), false, 'one tile past the east edge is out-of-zone');
A.eq(Z.inZone(zMain, 10, 13), false, 'one tile past the south edge is out-of-zone');
A.eq(Z.inZone(zMain, -1, 5), false, 'negative tile is out-of-zone');
A.eq(Z.inZone(zMain, 10, 0), true, 'room top edge (10,0) is in-zone at a non-corner X (inclusive)');
A.eq(Z.inZone(zMain, 10, -1), false, 'one tile north of the room top edge is out-of-zone (ly low-Y guard)');

// ---- COUCH STRADDLE: a 5-wide couch whose left corner is in-zone but whose right cushions and
// their approach tiles spill past the room wall must report those out-of-zone (the predicate the
// planCouchSit cage relies on: gate the cushion sx,sy AND the approach ax,ay, NOT the prop corner).
// Room: a side room x:[22..27]. Couch at (24,3) w:5 -> cushions (couch.x+slot) for slot 1..3 =
// columns 25,26,27; the right cushion 27 is the room's last in-zone column, but column 28 (a slot
// that a wider couch / different anchor would reach) and the EAST approach (sx+1) of column 27 fall
// outside the wall. We assert: the corner is in-zone (so the OLD corner-only gate passed), yet a
// cushion/approach past the east wall is out-of-zone (so the corner gate was the WRONG tile).
const COUCH_ZONE = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1', anchorTile: { x: 24, y: 3 } });
A.eq(Z.inZone(COUCH_ZONE, 24, 3), true, 'couch LEFT corner (the prop x,y) is in-zone — the old corner-only gate would accept the couch');
A.eq(Z.inZone(COUCH_ZONE, 27, 3), true, 'rightmost in-wall cushion (col 27) is in-zone');
A.eq(Z.inZone(COUCH_ZONE, 28, 3), false, 'a cushion column past the east wall is OUT-of-zone (cushion sx,sy must be gated, not the corner)');
A.eq(Z.inZone(COUCH_ZONE, 28, 3), false, 'the EAST approach (sx+1) of the rightmost cushion is OUT-of-zone (approach ax,ay must be gated too)');

// ---- TRUE ROAM RADIUS (2026-08-08): station floor ∩ Chebyshev radius around the DESK ----
// Room identity is irrelevant once roamR is present. Walkability/pathfinding remains the caller's
// reachability gate; this primitive owns only the stable distance boundary and floor membership.
A.eq(Z.ROAM_RADIUS, 14, 'exports the bounded 14-tile station roam radius');
A.eq(zMain.roam, undefined, 'a zone computed WITHOUT roamR carries no roam field (original caging preserved)');
A.eq(Z.inZone(zMain, 25, 2), false, 'and without roamR a tile in the NEXT room stays out-of-zone');

const zRoamFar = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a2', anchorTile: { x: 8, y: 6 }, roamR: 14 });
A.eq(zRoamFar.kind, 'room', 'a roam zone is still kind:room — zoneRect()/border-meeting consumers keep working');
A.eq(zRoamFar.rect, { x1: 0, y1: 0, x2: 20, y2: 12 }, 'the home room rect is unchanged by roamR');
A.eq(zRoamFar.roam, { cx: 8, cy: 6, r: 14, rects: [{ x1: 0, y1: 0, x2: 20, y2: 12 }, { x1: 22, y1: 0, x2: 27, y2: 5 }] },
  'roam is centered on the desk and considers every station floor plate');
A.eq(Z.inZone(zRoamFar, 20, 12), true, 'a home-room tile inside the radius is in-zone');
A.eq(Z.inZone(zRoamFar, 22, 2), true, 'another room is admitted exactly by distance, without a room-identity clip');
A.eq(Z.inZone(zRoamFar, 23, 2), false, 'one tile past the desk radius is out even when it belongs to a room plate');

const zRoamNear = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1', anchorTile: { x: 24, y: 3 }, roamR: 9 });
A.eq(Z.inZone(zRoamNear, 24, 3), true, 'the body stands in-zone on its own desk tile');
A.eq(Z.inZone(zRoamNear, 27, 5), true, 'a home-room tile inside the radius is in-zone');
A.eq(Z.inZone(zRoamNear, 18, 3), true, 'a different room inside the radius is in-zone regardless of room identity');
A.eq(Z.inZone(zRoamNear, 15, 3), true, 'the exact west radius edge is admitted');
A.eq(Z.inZone(zRoamNear, 14, 3), false, 'one tile past the radius is out');
A.eq(Z.inZone(zRoamNear, 24, 12), false, 'off-room floor is not admitted merely because it is close');
A.eq(Z.inZone(zRoamNear, 24, 13), false, 'one tile past the radius to the south is out (both axes gate the roam)');
A.eq(Z.inZone(zRoamNear, 15, 13), false, 'in-range X but out-of-range Y is out (both axes required)');
A.eq(Z.inZone(zRoamNear, 21, 3), false, 'a gap/wall between rooms is never part of a room zone');

// A typical 18x11 home room now reaches across its seam by radius alone. The whole home plate is
// NOT automatically admitted: the far edge must also remain inside the configured distance.
const ABUT = [
  { z: 0, x1: 0,  y1: 0, x2: 17, y2: 10 },   // home
  { z: 1, x1: 18, y1: 0, x2: 27, y2: 10 },   // next door, sharing the x=17|18 seam
];
const zAcross = Z.computeZone({ rects: ABUT, anchorTile: { x: 4, y: 5 }, roamR: 14 });
A.eq(Z.inZone(zAcross, 18, 5), true, 'the adjacent room begins exactly on the radius edge and is admitted');
A.eq(Z.inZone(zAcross, 19, 5), false, 'one tile beyond the radius remains out even in the adjacent room');
A.eq(Z.inZone(zAcross, 17, 10), true, 'the in-radius edge of the home room remains available');
const zWideHome = Z.computeZone({ rects: [{ x1: 0, y1: 0, x2: 30, y2: 10 }], anchorTile: { x: 4, y: 5 }, roamR: 14 });
A.eq(Z.inZone(zWideHome, 18, 5), true, 'the exact radius edge remains in-zone inside the home room');
A.eq(Z.inZone(zWideHome, 19, 5), false, 'the home room itself grants no exception one tile past the radius');

// guards: a non-positive / fractional roamR
A.eq(Z.computeZone({ rects: RECTS, anchorTile: { x: 8, y: 6 }, roamR: 0 }).roam, undefined, 'roamR:0 adds no roam field');
A.eq(Z.computeZone({ rects: RECTS, anchorTile: { x: 8, y: 6 }, roamR: -4 }).roam, undefined, 'a negative roamR adds no roam field');
A.eq(Z.computeZone({ rects: RECTS, anchorTile: { x: 8, y: 6 }, roamR: 6.9 }).roam.r, 6, 'a fractional roamR is floored to whole tiles');

// an OFF-ROOM anchor with roamR widens the leash instead (same distance from the desk either way)
const zRoamLeash = Z.computeZone({ rects: RECTS, anchorTile: { x: 40, y: 40 }, roamR: 9 });
A.eq(zRoamLeash.kind, 'leash', 'an anchor outside every room is still a leash zone');
A.eq(zRoamLeash.r, 9, 'roamR widens the open-floor leash to the same roam distance');
A.eq(Z.computeZone({ rects: RECTS, anchorTile: { x: 40, y: 40 }, leashR: 12, roamR: 9 }).r, 12, 'an explicitly LARGER leashR wins over roamR (max, never a downgrade)');

// roamR never grants a zone to an unplaced agent. When explicitly present it also wins over the
// legacy solo whole-floor widening: every placed body follows the same distance rule.
A.eq(Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'ghost', roamR: 9 }), null, 'roamR does NOT grant a zone to an unanchored agent');
const zSoloRoam = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1', anchorTile: { x: 24, y: 3 }, solo: true, roamR: 9 });
A.eq(zSoloRoam.kind, 'room', 'an explicit roam radius replaces the solo whole-floor widening');
A.eq(zSoloRoam.roam.r, 9, 'the sole owner receives the same configured radius as every crew body');
A.eq(Z.inZone(zSoloRoam, 8, 3), false, 'a far station tile outside that radius remains out for the sole owner');

// ---- inZone: leash membership (Chebyshev square) ----
const lz = { kind: 'leash', cx: 10, cy: 10, r: 3 };
A.eq(Z.inZone(lz, 10, 10), true, 'leash center is in-zone');
A.eq(Z.inZone(lz, 13, 13), true, 'leash corner (cx+r,cy+r) is in-zone (Chebyshev)');
A.eq(Z.inZone(lz, 14, 10), false, 'one tile past the leash radius is out-of-zone');
A.eq(Z.inZone(lz, 7, 10), true, 'leash reaches r tiles to the west');
A.eq(Z.inZone(lz, 6, 10), false, 'r+1 to the west is out');
// vary Y while holding X centered — exercises the ty branch of the Chebyshev containment so an
// asymmetric/broken leash that lets agents roam vertically out of zone cannot ship green
A.eq(Z.inZone(lz, 10, 13), true, 'leash reaches r tiles to the south (Y branch)');
A.eq(Z.inZone(lz, 10, 14), false, 'one tile past the leash radius to the south is out');
A.eq(Z.inZone(lz, 10, 7), true, 'leash reaches r tiles to the north (Y branch)');
A.eq(Z.inZone(lz, 10, 6), false, 'r+1 to the north is out');
// a true diagonal miss: in-range on X but out-of-range on Y -> out (both axes required)
A.eq(Z.inZone(lz, 13, 14), false, 'in-range X but out-of-range Y is out (both axes gate the leash)');

// ---- clampPickable: filter candidates to the zone, preserving order ----
const cands = [
  { x: 0,  y: 0,  tag: 'A' },   // in big room
  { x: 25, y: 2,  tag: 'B' },   // NOT in big room (side room)
  { x: 20, y: 12, tag: 'C' },   // in big room (far corner)
  { x: 50, y: 50, tag: 'D' },   // off-floor
  { x: 5,  y: 5,  tag: 'E' },   // in big room
];
const kept = Z.clampPickable(zMain, cands);
A.eq(kept.map(c => c.tag), ['A', 'C', 'E'], 'clampPickable keeps only in-zone candidates, in original order');

// keyFn extracts the tile from a richer candidate shape. The tile is NESTED under .tile so the
// default identity keyFn (c => c) reads undefined coords — this candidate shape can only be
// filtered correctly if keyFn is actually honored, making the keyFn path load-bearing (not vacuous).
const nested = [
  { id: 'q1', tile: { x: 3,  y: 3 } },    // in big room
  { id: 'q2', tile: { x: 26, y: 1 } },    // side room — out
];
const keptProps = Z.clampPickable(zMain, nested, c => c.tile);
A.eq(keptProps.map(p => p.id), ['q1'], 'clampPickable uses keyFn to read each candidate tile');
// companion: the SAME nested candidates under the DEFAULT keyFn yield [] (top-level x/y are
// undefined → inZone false), proving the keyFn above is what makes filtering succeed.
A.eq(Z.clampPickable(zMain, nested), [], 'default identity keyFn cannot read nested tiles — keyFn is load-bearing');

// null zone / bad input -> empty (caller falls through to an in-place beat)
A.eq(Z.clampPickable(null, cands), [], 'clampPickable(null,..) is empty — nothing to pick, no roaming');
A.eq(Z.clampPickable(zMain, null), [], 'clampPickable with non-array candidates is empty');
A.eq(Z.clampPickable(zMain, []), [], 'clampPickable of an empty list is empty');

// ---- determinism guard: same inputs -> identical output (no RNG/clock inside) ----
const z1 = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1' });
const z2 = Z.computeZone({ rects: RECTS, props: PROPS, agentId: 'a1' });
A.eq(z1, z2, 'computeZone is deterministic — identical inputs yield identical zones');

A.report('zones.test');
