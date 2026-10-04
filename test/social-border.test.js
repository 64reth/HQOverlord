/* node test/social-border.test.js — TIER D · D3 border-meeting pure geometry (containment law).

   world.js is a browser IIFE (can't require under node), so this test extracts the marked
   D3-PURE-GEOMETRY block (sharedEdge + borderTileFor — pure: Math.* + params only, walkability
   injected) from the SOURCE and executes it — the shipped code is under test, not a copy
   (the same eval-the-engine-source spirit as test/test_world.js). Zones.rectHas (the real
   zone-membership primitive) is the containment oracle.

   Contract under test (plan D3 / guardrail G3):
     • two rects abutting along a line → a shared edge with the overlapping span
     • each body's border tile is INSIDE ITS OWN rect and NOT inside the partner's —
       they meet ACROSS the line, never crossing (containment staged, not hidden)
     • the picked tile is the nearest walkable edge tile to the body; blocked tiles skipped
     • non-adjacent rects (a gap) → no shared edge → not border-meeting candidates */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const Zones = require('../frontend/app/zones.js');

// ---- extract + execute the marked pure block from the real source ----
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const BEGIN = 'D3-PURE-GEOMETRY-BEGIN', END = 'D3-PURE-GEOMETRY-END';
const i0 = src.indexOf(BEGIN), i1 = src.indexOf(END);
A.ok(i0 >= 0 && i1 > i0, 'world.js carries the D3-PURE-GEOMETRY extraction markers');
const block = src.slice(src.indexOf('*/', i0) + 2, src.lastIndexOf('/*', i1));
A.ok(/function sharedEdge\(/.test(block) && /function borderTileFor\(/.test(block), 'the marked block holds sharedEdge + borderTileFor');
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');   // purity is a CODE property — comments may name geo/U freely
A.ok(!/\bgeo\.|\bself\.|\bU\.|\bZones\.|\bdocument\b|\bwindow\b/.test(codeOnly), 'the block is PURE (no module state / RNG / DOM — safe to execute standalone)');
const { sharedEdge, borderTileFor } = eval('(function(){' + block + '\nreturn { sharedEdge, borderTileFor };})()');

// ---- the geometry contract ----
const allWalk = () => true;

// two rooms side by side sharing the wall between col 9 and 10, rows 0..9
const Ra = { x1: 0, y1: 0, x2: 9, y2: 9 }, Rb = { x1: 10, y1: 0, x2: 19, y2: 9 };
const e = sharedEdge(Ra, Rb);
A.ok(e && e.axis === 'v', 'side-by-side rooms yield a vertical shared edge');
const tA = borderTileFor(Ra, e, { x: 2, y: 2 }, allWalk);
const tB = borderTileFor(Rb, e, { x: 15, y: 5 }, allWalk);
A.ok(tA && Zones.rectHas(Ra, tA.x, tA.y), 'A\'s border tile is inside A\'s own rect');
A.ok(tB && Zones.rectHas(Rb, tB.x, tB.y), 'B\'s border tile is inside B\'s own rect');
A.ok(tA && !Zones.rectHas(Rb, tA.x, tA.y), 'A\'s tile is NOT inside B (containment — G3)');
A.ok(tB && !Zones.rectHas(Ra, tB.x, tB.y), 'B\'s tile is NOT inside A (containment — G3)');
A.eq(tA.x, 9, 'A meets at its OWN edge column (9)');
A.eq(tB.x, 10, 'B meets at its OWN edge column (10)');
A.eq(Math.abs(tA.x - tB.x), 1, 'they face each other ACROSS the line (adjacent columns)');
A.eq(tA.y, 2, 'A picks the edge tile nearest its own row (cur.y=2)');

// two rooms stacked vertically sharing the wall between row 9 and 10
const Rc = { x1: 0, y1: 0, x2: 9, y2: 9 }, Rd = { x1: 0, y1: 10, x2: 9, y2: 19 };
const e2 = sharedEdge(Rc, Rd);
A.ok(e2 && e2.axis === 'h', 'stacked rooms yield a horizontal shared edge');
const tC = borderTileFor(Rc, e2, { x: 3, y: 5 }, allWalk);
const tD = borderTileFor(Rd, e2, { x: 7, y: 15 }, allWalk);
A.ok(tC && Zones.rectHas(Rc, tC.x, tC.y) && !Zones.rectHas(Rd, tC.x, tC.y), 'C\'s tile in C only');
A.ok(tD && Zones.rectHas(Rd, tD.x, tD.y) && !Zones.rectHas(Rc, tD.x, tD.y), 'D\'s tile in D only');
A.ok(tC.y === 9 && tD.y === 10, 'stacked pair meets across rows 9|10');

// non-adjacent rooms (a gap) → no shared edge → not border-meeting candidates
const Rf = { x1: 0, y1: 0, x2: 9, y2: 9 }, Rg = { x1: 15, y1: 0, x2: 24, y2: 9 };
A.eq(sharedEdge(Rf, Rg), null, 'far-apart rooms (gap of 5) have NO shared edge');

// partial vertical overlap: the edge spans only the overlapping rows
const Rh = { x1: 0, y1: 5, x2: 9, y2: 14 }, Ri = { x1: 10, y1: 0, x2: 19, y2: 9 };
const e3 = sharedEdge(Rh, Ri);
A.ok(e3 && e3.axis === 'v' && e3.lo === 5 && e3.hi === 9, 'partial-overlap edge spans exactly rows 5..9');

// walkability respected: blocked edge tiles are skipped for the next-nearest walkable one
const blockedSet = new Set(['9,0', '9,1', '9,2']);
const tAblk = borderTileFor(Ra, e, { x: 0, y: 0 }, (x, y) => !blockedSet.has(x + ',' + y));
A.ok(tAblk && tAblk.x === 9 && tAblk.y === 3, 'skips blocked edge tiles → first walkable (y=3)');

// fully blocked edge → null (planBorderMeeting then skips the pair; nothing strands)
A.eq(borderTileFor(Ra, e, { x: 0, y: 0 }, () => false), null, 'a fully-blocked edge yields null (pair skipped, no strand)');

// ---- source locks: the wiring exists as designed (browser flow, per the repo's world.js test pattern) ----
A.ok(/planBorderMeeting/.test(src) && /borderTileFor\(ra, edge, tileOf\(a\.px, a\.py\), walk\)/.test(src), 'planBorderMeeting injects the live walkable predicate');
A.ok(/_dbgSocialGeom/.test(src), 'the pure helpers are exposed read-only on the World API for the DEV harness');
// The hard timeout must survive any future field added to the slot (W4 added startedAt), so this
// pins the timeout itself rather than the exact object literal — the old exact-shape regex broke on
// an addition that could not possibly have removed the timeout.
A.ok(/socialBeat = \{ kind, aId: a\.id, bId: b\.id, until: now \+ SOCIAL_HARD_MS[,}]/.test(src), 'encounters carry the whole-encounter hard timeout');
// ...and every slot-set site stamps the encounter's own start clock, which is what the two bodies of
// a two-sided beat read to take TURNS (test/talk-turn.test.js owns the alternation itself). Without
// it each body measured from its own arrival and both could speak at once.
const slotSites = src.match(/socialBeat = \{ kind[^}]*\}/g) || [];
A.ok(slotSites.length >= 3, 'all the slot-set sites are found (startEncounter + the two one-sided beats)');
A.ok(slotSites.every(s => /startedAt: now/.test(s)), 'every encounter stamps startedAt — the ONE clock both turn-takers read');

A.report('social-border.test');
