/* test/waitanchor.test.js — headless tests for frontend/app/waitanchor.js (the pure permission-blocked
   wait-anchor ladder, G4 feature 1). Verifies the fixed priority (airlock → mission board → own desk),
   the honest fallback, and zone containment (an out-of-zone anchor clamps to the nearest in-zone tile).

   Pure: WaitAnchor.resolve() takes injected props/anchorOf/seat/zone predicates — no DOM, time, or RNG. */
'use strict';
const A = require('./_assert.js');
const WA = require('../frontend/app/waitanchor.js');
const PA = require('../frontend/app/propanchor.js');

// a geo whose only unwalkable tiles are the prop footprints we add + an out-of-bounds guard.
function makeGeo(blocked, cols, rows) {
  return {
    walkable(x, y, extra) {
      if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
      const k = x + ',' + y;
      return !blocked.has(k) && !(extra && extra.has(k));
    }
  };
}
function footprints(props) {
  const s = new Set();
  for (const p of props) for (let yy = p.y; yy < p.y + (p.h || 1); yy++) for (let xx = p.x; xx < p.x + (p.w || 1); xx++) s.add(xx + ',' + yy);
  return s;
}
// build a resolve() ctx from a prop list, wiring anchorOf to the SHARED PropAnchor law (so the two modules can't drift).
function ctxFor(props, seat, zoneAllows, nearestInZone) {
  const geo = makeGeo(footprints(props), 40, 40);
  return {
    props,
    anchorOf: (prop) => PA.deriveAnchor(prop, geo, { approach: 'south' }),
    seat: seat || null,
    zoneAllows: zoneAllows || null,
    nearestInZone: nearestInZone || null
  };
}

const airlock = { t: 'airlock', x: 10, y: 3, w: 1, h: 1 };
const board = { t: 'missionboard', x: 5, y: 0, w: 3, h: 1 };
const seat = { tx: 20, ty: 20, face: 'north' };

/* ---- ladder priority ---- */
// 1) airlock present → wait beside the airlock (highest priority).
let r = WA.resolve(ctxFor([airlock, board], seat));
A.eq(r && r.source, 'airlock', 'an airlock wins the anchor ladder');
A.ok(r && Math.abs(r.tx - airlock.x) + Math.abs(r.ty - airlock.y) === 1, 'the airlock anchor is adjacent to the airlock');

// 2) no airlock, board present → wait beside the mission board.
r = WA.resolve(ctxFor([board], seat));
A.eq(r && r.source, 'missionboard', 'no airlock → the mission board is the anchor');
A.ok(r && Math.abs(r.tx - board.x) + Math.abs(r.ty - board.y) <= 3 && r.ty === board.y + 1, 'the board anchor is on its south edge');

// 3) neither prop → the honest fallback is the agent's own seat, facing the camera (south).
r = WA.resolve(ctxFor([], seat));
A.eq(r && r.source, 'desk', 'no props → wait at the own desk');
A.eq(r && r.tx, seat.tx, 'the desk anchor is the seat tile (x)');
A.eq(r && r.ty, seat.ty, 'the desk anchor is the seat tile (y)');
A.eq(r && r.face, 'south', 'at the desk the agent faces the camera (south) — the "waiting for you" read');

// 4) nothing at all (no props, no seat) → null (the caller stands in place).
A.eq(WA.resolve(ctxFor([], null)), null, 'no anchor resolvable → null');

/* ---- zone containment ---- */
// the airlock's south approach tile is (10,4). A zone that EXCLUDES it forces the clamp to the nearest in-zone tile.
const inZoneOnly = { tx: 12, ty: 6 };
r = WA.resolve(Object.assign(ctxFor([airlock], seat), {
  zoneAllows: (tx, ty) => !(tx === 10 && ty === 4),          // the airlock's own approach tile is out of zone
  nearestInZone: () => inZoneOnly                             // …so we wait at the zone edge nearest it
}));
A.eq(r && r.source, 'airlock', 'the airlock still sources the anchor when out of zone');
A.eq(r && r.tx, inZoneOnly.tx, 'an out-of-zone airlock anchor clamps to the nearest in-zone tile (x)');
A.eq(r && r.ty, inZoneOnly.ty, 'an out-of-zone airlock anchor clamps to the nearest in-zone tile (y)');

// when the airlock is out of zone AND nothing in-zone is near it, the ladder falls through to the next candidate.
r = WA.resolve(Object.assign(ctxFor([airlock, board], seat), {
  zoneAllows: (tx, ty) => !(tx === 10 && ty === 4),          // airlock approach out of zone
  nearestInZone: () => null                                  // …and nothing in-zone near it → skip the airlock
}));
A.eq(r && r.source, 'missionboard', 'an unusable airlock falls through to the mission board');

// a fully out-of-zone floor (everything excluded, nothing near) falls all the way through to null.
r = WA.resolve(Object.assign(ctxFor([airlock], seat), { zoneAllows: () => false, nearestInZone: () => null }));
A.eq(r, null, 'when nothing is in zone the anchor is null (caller stands in place)');

A.report('waitanchor');
