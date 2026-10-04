/* node test/capprop-map.contract.test.js — the per-prop-id contract for the object=capability spine.

   Closes Atlas finding e08db5b6: only STUDIO had a per-prop-id lock (test/g1bprops.test.js); the other
   20 cap-prop ids in frontend/app/worldmodel.js CAP_PROP_MAP were guarded only at the OBJECTTYPE level
   (test/capgate.test.js / test/routing.b5.test.js build synthetic stations from objectTypes, NOT from prop
   ids). So dropping e.g. `vault` or `comms_beacon` from CAP_PROP_MAP would ship silently — the objectType
   (cabinet/dish) still passes those tests. This table-driven lock fails BY NAME on any such drop/rename:

     (1) every CAP_PROP_MAP entry resolves to a real, registered CAP_REGISTRY objectType (no dangling cap), and
     (2) each documented cap-prop id maps to EXACTLY the objectType it is meant to (the DOCUMENTED table below),
         so a silent re-point (desk -> cabinet) or a dropped id fails here, not in a demo.

   Pure + fast (no DOM, no boot): the map is static data and the registry is a frozen object. */
'use strict';
const A = require('./_assert.js');

const WM = require('../frontend/app/worldmodel.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const MAP = WM.CAP_PROP_MAP;

// The DOCUMENTED prop-id -> objectType table (frontend/app/worldmodel.js CAP_PROP_MAP, mirrored here so a
// silent edit to the shipped map diverges from this lock and fails by the exact prop id). Keep in sync WITH
// intent: adding a genuinely-new cap prop means adding it here too (that's the point — new grants get a lock).
const EXPECTED = {
  // a workstation = compute
  console: 'computer', consoleL: 'computer', desk: 'computer', desk2: 'computer', pixelrig: 'computer', bench: 'computer',
  // a locked cabinet = files
  war_intelcab: 'cabinet', safe: 'cabinet', vault: 'cabinet', rack: 'cabinet', shelf: 'cabinet',
  // a comms dish = web
  comms_dish: 'dish', comms_uplink: 'dish', comms_beacon: 'dish',
  // a server/databank = memory
  gigs_servercart: 'notebook', bridge_relaystack: 'notebook', core: 'notebook',
  // dynamic / single-prop caps
  connector_portal: 'connector',
  workbench: 'workbench',
  studio: 'studio',
  jukebox: 'jukebox'
};

// (0) the two maps enumerate the SAME set of prop ids — a NEW cap prop added to the shipped map with no lock
// here (or a lock for a prop that no longer ships) fails loudly instead of sliding through unguarded.
const mapIds = Object.keys(MAP).sort();
const expIds = Object.keys(EXPECTED).sort();
A.eq(mapIds, expIds, 'CAP_PROP_MAP enumerates exactly the documented cap-prop ids (a new/removed grant must update this lock)');

// (1) every shipped CAP_PROP_MAP entry resolves to a REGISTERED CAP_REGISTRY objectType (no dangling capability).
for (const propId of mapIds) {
  const cap = MAP[propId];
  A.ok(cap && typeof cap === 'string', 'CAP_PROP_MAP.' + propId + ' names a capability objectType (non-empty string)');
  A.ok(Object.prototype.hasOwnProperty.call(CAP_REGISTRY, cap),
    'CAP_PROP_MAP.' + propId + ' -> ' + cap + ' is a REGISTERED CAP_REGISTRY objectType (a dropped/renamed objectType fails here)');
}

// (2) each cap-prop id maps to EXACTLY the documented objectType — a silent re-point fails by the prop id name.
for (const propId of expIds) {
  A.eq(MAP[propId], EXPECTED[propId], 'CAP_PROP_MAP.' + propId + ' maps to ' + EXPECTED[propId] + ' (documented object=capability contract)');
  // and grantLabelForProp resolves it (the placement toast / palette tile / Field Manual all say the same word)
  A.ok(WM.grantLabelForProp(propId), 'grantLabelForProp(' + propId + ') resolves a plain power word (no inert cap prop)');
}

// (3) the objectType->capId link the sidecar actually consumes is intact for every cap this map grants: the
// registry entry is a non-empty grant list (or the intentional dynamic-connector marker), never an empty stub
// that would silently grant nothing. `connector` is the one documented empty marker (its grants are per-instance).
for (const cap of [...new Set(Object.values(EXPECTED))]) {
  const grants = CAP_REGISTRY[cap];
  A.ok(Array.isArray(grants), 'CAP_REGISTRY.' + cap + ' is a grant array');
  if (cap === 'connector') {
    A.eq(grants.length, 0, 'CAP_REGISTRY.connector is the intentional dynamic marker (per-instance grants, empty in the static registry)');
  } else {
    A.ok(grants.length > 0, 'CAP_REGISTRY.' + cap + ' carries at least one real tool grant (never an empty stub)');
  }
}

A.report('capprop-map.contract');
