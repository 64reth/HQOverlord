/* sidecar/capability/office.js — composeOffice: the room objects an agent's run resolves against when NO explicit
   station is routed (the non-bay path). THE MOAT (FLOOR-REAL) lives here: on the INTERACTIVE (browser COMMS)
   surface the floor is REAL — the office starts COMPUTE-ONLY (compute is the single freebie, so an agent can ALWAYS
   think and a brand-new agent works out of the box — never a dead wall) and the agent's REAL placed caps off the
   floor (extraObjects: dish→web · cabinet→files · workbench→terminal · …) are appended, so it grants exactly what
   the Commander placed and nothing it didn't. AUTONOMOUS/headless surfaces (cron, Telegram, delegated workers) have
   no in-the-moment floor UI, so they keep the full default office — placing-grants-reach is taught where the
   beginner is (the browser); silently stripping a scheduled/delegated run's web+files would regress shipped work.

   composeOffice({ surface, lead, connectorIds, extraObjects }) -> [ { instanceId, objectType, connectorId? }, … ]
   Pure: same inputs -> same array. Fed straight into resolveTools as one room's objects. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.capability = root.SK.capability || {}).office = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // the full default office (the autonomous/headless baseline + the historical browser default before the moat).
  function fullOffice() {
    return [
      { instanceId: 'pc1', objectType: 'computer' },
      { instanceId: 'dish1', objectType: 'dish' },
      { instanceId: 'cab1', objectType: 'cabinet' },
      { instanceId: 'nb1', objectType: 'notebook' },
      { instanceId: 'studio1', objectType: 'studio' },      // STUDIO: image generation + vision analysis (OpenRouter)
      { instanceId: 'jukebox1', objectType: 'jukebox' }     // JUKEBOX: Spotify (inert until connected in TOOLSETS)
    ];
  }

  function composeOffice(o) {
    o = o || {};
    const interactive = (o.surface || 'interactive') === 'interactive';
    // interactive: compute is the only freebie — web/files/terminal must be PLACED (arrive via extraObjects).
    const objects = interactive ? [ { instanceId: 'pc1', objectType: 'computer' } ] : fullOffice();
    // every configured connector portal is account-level (not a placed floor prop), so it rides on both surfaces.
    for (const cid of (o.connectorIds || [])) objects.push({ instanceId: 'conn_' + cid, objectType: 'connector', connectorId: cid });
    // the LEAD (browser-commanded run) alone gets the orchestrator object -> team.dispatch; a delegated worker never does.
    if (o.lead) objects.push({ instanceId: 'orch1', objectType: 'orchestrator' });
    // ADDITIVE: the agent's REAL placed caps off the floor (THE MOAT). A connector entry carries its binding.
    for (const e of (o.extraObjects || [])) {
      if (!e || !e.objectType) continue;
      const ob = { instanceId: String(e.instanceId || ('extra_' + e.objectType)), objectType: String(e.objectType) };
      if (e.connectorId) ob.connectorId = e.connectorId;
      objects.push(ob);
    }
    return objects;
  }

  /* stationWithObject — return a station in which `agentId`'s room is guaranteed to contain one object of
     `objectType`, adding it only if absent. Used by the UNATTENDED CAPABILITY GRANT path: a granted routine
     must get the capability object in WHICHEVER room its run resolves against, and a bay-docked agent's run
     passes an explicit `station` that bypasses composeOffice entirely — so granting via extraObjects alone
     would silently no-op for exactly the agents that have a real room. Pure and NON-MUTATING: station/room
     objects are shared router+bay state, so every level touched is cloned. Unknown agent/room -> unchanged. */
  function stationWithObject(station, agentId, objectType) {
    if (!station || !station.rooms || !objectType) return station;
    const agent = station.agents && station.agents[agentId];
    const roomId = agent && agent.room;
    const room = roomId && station.rooms[roomId];
    if (!room) return station;
    const objects = Array.isArray(room.objects) ? room.objects : [];
    if (objects.some(o => o && o.objectType === objectType)) return station;   // already placed -> byte-identical
    const nextRoom = Object.assign({}, room, {
      objects: objects.concat([{ instanceId: 'granted_' + objectType, objectType: String(objectType) }])
    });
    return Object.assign({}, station, {
      rooms: Object.assign({}, station.rooms, { [roomId]: nextRoom })
    });
  }

  /* stationWithConnectors — guarantee `agentId`'s room carries a connector portal for each id in
     `connectorIds`, adding only the missing ones. The autonomous default office already gets these from
     composeOffice, but a BAY-docked agent's run passes an explicit station that bypasses composeOffice
     entirely — so without this a granted routine on a bay agent would resolve zero connector tools. Same
     non-mutating contract as stationWithObject (station/room objects are shared router+bay state). */
  function stationWithConnectors(station, agentId, connectorIds) {
    const ids = Array.isArray(connectorIds) ? connectorIds : [];
    if (!ids.length || !station || !station.rooms) return station;
    const agent = station.agents && station.agents[agentId];
    const roomId = agent && agent.room;
    const room = roomId && station.rooms[roomId];
    if (!room) return station;
    const objects = Array.isArray(room.objects) ? room.objects : [];
    const have = {};
    for (const o of objects) if (o && o.objectType === 'connector' && o.connectorId) have[o.connectorId] = true;
    const add = ids.filter(id => id && !have[id]).map(id => ({ instanceId: 'conn_' + id, objectType: 'connector', connectorId: id }));
    if (!add.length) return station;                                   // nothing missing -> byte-identical
    const nextRoom = Object.assign({}, room, { objects: objects.concat(add) });
    return Object.assign({}, station, { rooms: Object.assign({}, station.rooms, { [roomId]: nextRoom }) });
  }

  return { composeOffice, fullOffice, stationWithObject, stationWithConnectors };
});
