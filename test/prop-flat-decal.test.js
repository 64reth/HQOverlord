/* test/prop-flat-decal.test.js — FLOOR DECALS (catalog `flat`: rug / cable run / hazard pad).

   A decal is deck PAINT, not furniture, and two things followed from the catalog never saying so:
     1. placement — a 4x3 rug was a 12-tile exclusion zone. checkProp treated it as a solid prop, so
        "put a lamp on the rug" answered OVERLAP, and a rug could not be unrolled under a room that
        was already dressed. The exemption has to run in BOTH directions, which is why the two halves
        below (place ON a decal / place a decal UNDER props) are separate assertions.
     2. rendering — a decal y-sorted with the bodies sorts at its SOUTH edge, so an agent standing on
        the rug's northern rows sorted FIRST and the rug painted over the agent. world.js/build.js now
        draw decals in a floor pass; the catalog-shape assertions at the bottom are what keep a new
        decal row from silently re-entering the y-sort with the wrong flags. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const fs = require('node:fs');
const path = require('node:path');

/* the catalog is INJECTED, never imported by the model — mirror the real app.js seam */
const RULES = {
  rug: { flat: true },
  hazardpad: { flat: true },
  sidetable: { surface: true },
  plant: { stack: true },
  gachapon: {},                     // deck only, solid
};
WM.setPropRules(t => RULES[t] || null);

function station() {
  const s = WM.create();
  A.ok(s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 44, y2: 8 } }).ok, 'test room placed');
  return s;
}

/* ---- a prop may stand ON a decal ---- */
{
  const s = station();
  A.ok(s.addProp({ t: 'rug', x: 32, y: 2, w: 4, h: 3, block: false }).ok, 'rug unrolls on bare deck');
  A.eq(s.canPlaceProp('gachapon', 33, 3, 1, 1).ok, true, 'a solid prop places on the rug');
  A.eq(s.canPlaceProp('plant', 32, 2, 1, 1).ok, true, 'a stack prop places on the rug corner');
  A.eq(s.canPlaceProp('sidetable', 35, 4, 1, 1).ok, true, 'a table places on the rug');
  A.ok(s.addProp({ t: 'gachapon', x: 33, y: 3, w: 1, h: 1 }).ok, 'and the placement really lands');
  // ...but the thing standing on it is still solid to the NEXT prop
  A.eq(s.canPlaceProp('gachapon', 33, 3, 1, 1).error, 'OVERLAP', 'the prop on the rug is still an obstacle');
}

/* ---- a decal may be unrolled UNDER props that are already there ---- */
{
  const s = station();
  A.ok(s.addProp({ t: 'gachapon', x: 33, y: 3, w: 1, h: 1 }).ok, 'a solid prop stands on the deck');
  A.eq(s.canPlaceProp('rug', 32, 2, 4, 3).ok, true, 'the rug unrolls under it');
  const r = s.addProp({ t: 'rug', x: 32, y: 2, w: 4, h: 3, block: false });
  A.ok(r.ok, 'and the placement really lands');
  A.eq(s.moveProp(r.id, 1, 0).ok, true, 'a laid decal still moves under standing props');
  A.eq(s.canPlaceProp('hazardpad', 33, 3, 2, 1).ok, true, 'decal over decal is fine too');
}

/* ---- a decal is not a table: it hosts nothing, it only stops blocking ---- */
{
  const s = station();
  A.ok(s.addProp({ t: 'rug', x: 32, y: 2, w: 4, h: 3, block: false }).ok, 'rug down');
  const v = s.canPlaceProp('plant', 33, 3, 1, 1);
  A.eq(v.ok, true, 'the plant places');
  A.eq(v.host, null, 'and it is standing on the DECK, not mounted on the rug');
}

/* ---- off-deck still wins: an exemption from OVERLAP is not an exemption from the floor ---- */
{
  const s = station();
  A.eq(s.canPlaceProp('rug', 60, 40, 4, 3).error, 'OFF_DECK', 'a decal still has to lie on a deck');
}

/* ---- with NO rules installed a decal is just a prop again (plain node callers / older saves) ---- */
WM.setPropRules(null);
{
  const s = station();
  A.ok(s.addProp({ t: 'rug', x: 32, y: 2, w: 4, h: 3, block: false }).ok, 'rug down');
  A.eq(s.canPlaceProp('gachapon', 33, 3, 1, 1).error, 'OVERLAP', 'no rules => no decal exemption');
}

/* ---- the catalog's own rows obey the axis ---- */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'propsprites.js'), 'utf8');
  const rows = [...src.matchAll(/\{ id: "([a-zA-Z_0-9]+)", label: "[^"]+", cat: "\w+", tier: "\w+"([^\n]*)/g)]
    .map(m => ({ id: m[1], rest: m[2] }));
  A.ok(rows.length > 100, 'parsed the catalog (' + rows.length + ' rows)');

  const flats = rows.filter(r => /flat: true/.test(r.rest));
  A.ok(flats.length >= 3, 'the floor decals are still tagged flat:true (' + flats.length + ')');
  A.ok(flats.some(r => r.id === 'rug'), 'the RUG is one of them');
  for (const f of flats) {
    // paint cannot block: a decal that still blocks would be an invisible obstacle agents path around
    A.ok(/blocks: false/.test(f.rest), f.id + ' is walkable (blocks:false)');
    // a decal has no top surface and nothing to walk over and use — it IS the deck
    A.ok(!/surface: true/.test(f.rest), f.id + ' is not a table');
    A.ok(!/mount: "surface"/.test(f.rest) && !/stack: true/.test(f.rest), f.id + ' does not mount on one either');
    A.ok(!/use: \{/.test(f.rest), f.id + ' carries no use row (nobody walks over to stand on paint)');
  }
}

A.report('prop-flat-decal');
