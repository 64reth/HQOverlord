/* sidecar/capability/resolve.js — resolveTools: the PURE projection of placed objects onto
   the tools an agent may use THIS turn. Capability follows the agent's ASSIGNED room (the desk),
   not its body tile. room.capabilities is derived, never hand-stored. Called fresh every turn so
   placing/reclaiming an object changes the agent's reach on the very next model call.

   station = {
     rooms:  { <roomId>: { id, objects: [ { instanceId, objectType } ] } },
     agents: { <agentId>: { id, room: <roomId> } }
   }
   resolveTools(agentId, station, capRegistry?, opts?) ->
     { agentId, room, hasCompute, tools[], grants[], approvalRules{}, networkCaps{} }

   opts.disabledCaps: an object/Set of capIds the user has switched OFF in the TOOLSETS console (the
   toolset kill-switch layered on top of object=capability). A disabled family's grants are DROPPED here
   before they ever reach the tool gate. `compute` is NEVER filtered (the COMPUTE GATE freebie — disabling
   it would make the agent unable to think). MCP connector tools are projected separately by the caller and
   never pass through this map, so their own per-connector `enabled` flag stays authoritative. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./registry.js'));
  else { root.SK = root.SK || {}; root.SK.capability = root.SK.capability || {}; root.SK.capability.resolve = factory(root.SK.capability.registry); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (capReg) {
  'use strict';

  const DEFAULT = capReg.CAP_REGISTRY;

  function resolveTools(agentId, station, capRegistry, opts) {
    capRegistry = capRegistry || DEFAULT;
    // disabledCaps may be a Set, an array, or a plain map { capId: true }. Normalise to a has(capId) probe.
    const dc = opts && opts.disabledCaps;
    const isDisabled = !dc ? (() => false)
      : (typeof dc.has === 'function') ? (c => dc.has(c))
      : Array.isArray(dc) ? (c => dc.indexOf(c) >= 0)
      : (c => !!dc[c]);
    const agent = station && station.agents && station.agents[agentId];
    const roomId = agent && agent.room;
    const room = roomId && station.rooms && station.rooms[roomId];
    const objects = (room && room.objects) || [];

    const tools = [], deferred = [], grants = [], approvalRules = {}, networkCaps = {};
    let hasCompute = false;
    const seen = {};

    for (const obj of objects) {
      const list = capRegistry[obj.objectType] || [];
      for (const g of list) {
        if (g.capId === 'compute') { hasCompute = true; continue; } // gates the run; not a callable tool — never filtered
        if (isDisabled(g.capId)) continue;                          // TOOLSET kill-switch: family switched OFF in the console
        if (seen[g.tool]) continue;
        seen[g.tool] = true;
        tools.push(g.tool);
        // DEFERRED is an ADVERTISING decision, never a capability one: the tool stays in `tools`, so the gate,
        // consent broker, approvalRules and the toolset kill-switch all see it exactly as before. Only the
        // caller's WIRE list narrows — see index.js, which advertises tools minus deferred and hands the rest
        // to tool.search. Keeping the two apart is what stops a deferred tool becoming an ungranted one.
        if (g.deferred) deferred.push(g.tool);
        grants.push(g);
        approvalRules[g.tool] = { requiresConsent: !!g.requiresConsent, scope: g.scope, network: !!g.network };
        networkCaps[g.tool] = !!g.network;
      }
    }

    return { agentId, room: roomId || null, hasCompute, tools, deferred, grants, approvalRules, networkCaps };
  }

  return { resolveTools };
});
