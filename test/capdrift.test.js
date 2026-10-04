/* test/capdrift.test.js — guards the prop⇄capability seam against silent drift.
   Three parallel structures describe "what a placed prop grants": the PropSprites CATALOG
   (what the palette sells), WorldModel.CAP_PROP_MAP (what the station projects to the sidecar),
   and CAP_REGISTRY (what resolveTools actually grants). A prop present in one but missing from
   the next fails SILENTLY in the live app — the palette promises a power the run never gets.
   This test makes that drift fail HERE instead. */
'use strict';
const A = require('./_assert.js');
const PS = require('../frontend/app/propsprites.js');
const WM = require('../frontend/app/worldmodel.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const MAP = WM.CAP_PROP_MAP;
const REG_TYPES = Object.keys(CAP_REGISTRY);

/* ---- 1. every power the frontend projects is one the backend actually grants ---- */
for (const [propId, objectType] of Object.entries(MAP)) {
  A.ok(REG_TYPES.includes(objectType),
    'CAP_PROP_MAP ' + propId + ' -> "' + objectType + '" exists in CAP_REGISTRY');
}

/* ---- 2. every prop SOLD as a capability actually maps to a grant ----
   A CATALOG entry with cat:'capability' whose id is missing from CAP_PROP_MAP renders, places,
   and says "CAPABILITY —" in its desc while granting nothing: the exact UI lie the product law bans. */
for (const c of PS.CATALOG) {
  if (c.cat === 'capability') {
    A.ok(!!MAP[c.id], 'capability prop "' + c.id + '" is in CAP_PROP_MAP (grants something real)');
  }
  if (c.cat === 'workstation') {
    const t = MAP[c.id];
    A.ok(t === 'computer' || t === 'workbench',
      'workstation prop "' + c.id + '" projects compute or terminal (got ' + t + ')');
  }
}

/* ---- 3. every mapped prop id is a real, placeable CATALOG prop ---- */
for (const propId of Object.keys(MAP)) {
  A.ok(PS.CATALOG.some(c => c.id === propId), 'CAP_PROP_MAP key "' + propId + '" exists in the CATALOG');
}

/* ---- 4. registry objectTypes unreachable from a placed prop are the KNOWN conferrals only ----
   orchestrator: conferred by role (the overseer), never by a placeable object.
   (jukebox is now a placeable grant via CAP_PROP_MAP — a placed JUKEBOX projects the spotify tools,
   inert until Spotify is connected in TOOLSETS — so it is reachable, not a conferral.)
   Anything else unreachable = a grant family no station can ever earn = dead registry weight. */
const CONFERRED = ['orchestrator'];
const reachable = new Set(Object.values(MAP));
for (const t of REG_TYPES) {
  A.ok(reachable.has(t) || CONFERRED.includes(t),
    'registry objectType "' + t + '" is reachable from a placeable prop (or a documented conferral)');
}

A.report('capdrift');
