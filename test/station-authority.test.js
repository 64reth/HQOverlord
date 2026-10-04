/* node test/station-authority.test.js - pure sidecar Station authority store.
   Covers accepting SaveDoc.station without trusting renderer-posted capability lists. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const { makeStationStore } = require('../sidecar/station-store.js');

function hasCap(objects, cap) {
  return objects.some(o => o === cap || (o && o.objectType === cap));
}

function stationDoc(agentId, withWorkstation) {
  const doc = WM.defaultDoc();
  doc.props.push({ id: 'bay1', t: 'bay', x: 4, y: 1, w: 2, h: 2, agentId });
  if (withWorkstation) doc.props.push({ id: 'pc1', t: 'console', x: 7, y: 1, w: 2, h: 1, agentId });
  doc._nid = 3;
  return doc;
}

{
  const store = makeStationStore();
  const accepted = store.setSaveDoc({ schema: 'starnet.save', station: stationDoc('coder', true) });
  A.ok(accepted.ok, 'a SaveDoc with a valid station is accepted');
  A.ok(store.hasStation(), 'accepted SaveDoc.station installs the authoritative station');
  const objs = store.bayObjects('coder');
  A.ok(Array.isArray(objs), 'bayObjects derives from the installed station');
  A.ok(hasCap(objs, 'computer'), 'derived bay objects include the real workstation');
}

{
  const store = makeStationStore();
  const accepted = store.setSaveDoc({ station: stationDoc('coder', true) });
  A.ok(accepted.ok, 'valid SaveDoc.station installs as last-good');
  const bad = store.setSaveDoc({ station: { schema: 'starnet.station', version: 1, rooms: {}, order: [], props: [] } });
  A.ok(!bad.ok, 'invalid SaveDoc.station is refused');
  A.ok(hasCap(store.bayObjects('coder'), 'computer'), 'last-good station survives invalid SaveDoc update');
}

{
  const store = makeStationStore();
  const missing = store.setSaveDoc({ schema: 'starnet.save' });
  A.ok(!missing.ok, 'SaveDoc without station is refused for authority installation');
  A.ok(!store.hasStation(), 'missing SaveDoc.station does not install authority');
}

A.report('station-authority');
