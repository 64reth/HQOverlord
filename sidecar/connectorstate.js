/* sidecar/connectorstate.js — pure transactional state for MCP connector configuration + OAuth secrets.

   Connector configuration and OAuth credentials form ONE user-owned object: removing a connector must remove
   both, while a failed write must preserve both. Keeping them in separate files made that impossible to prove
   across a crash. This module owns the versioned single-envelope shape; index.js owns durable I/O.

   No function mutates its input. Secret values are deliberately opaque here and are never projected publicly. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.mcp = root.SK.mcp || {}).connectorState = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 2;

  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function copy(v) { return JSON.parse(JSON.stringify(v == null ? null : v)); }

  function normalize(raw, legacy) {
    const r = obj(raw), l = obj(legacy);
    const oauth = obj(r.oauth);
    const legacyOauth = obj(l.oauth);
    return {
      version: VERSION,
      configs: copy(arr(Array.isArray(r.configs) ? r.configs : l.configs)),
      oauth: {
        byId: copy(obj(oauth.byId && typeof oauth.byId === 'object' ? oauth.byId : legacyOauth.byId)),
        clients: copy(obj(oauth.clients && typeof oauth.clients === 'object' ? oauth.clients : legacyOauth.clients))
      }
    };
  }

  function envelope(configs, oauth) {
    return normalize({ configs: configs, oauth: oauth });
  }

  function upsertConfig(state, config) {
    const s = normalize(state), c = copy(obj(config));
    const id = String(c.id || '').trim();
    if (!id) return s;
    s.configs = s.configs.filter(x => String((x && x.id) || '') !== id).concat([c]);
    return s;
  }

  function removeConnector(state, id) {
    const s = normalize(state), want = String(id || '').trim();
    s.configs = s.configs.filter(x => String((x && x.id) || '') !== want);
    const old = s.oauth.byId[want];
    const authServer = old && old.authorizationServer;
    delete s.oauth.byId[want];
    if (authServer) delete s.oauth.clients[authServer];
    return s;
  }

  function withOauthEntry(state, id, entry) {
    const s = normalize(state), want = String(id || '').trim();
    if (!want) return s;
    if (entry == null) delete s.oauth.byId[want];
    else s.oauth.byId[want] = copy(obj(entry));
    return s;
  }

  function withOauthClient(state, authServer, client) {
    const s = normalize(state), want = String(authServer || '').trim();
    if (!want) return s;
    if (client == null) delete s.oauth.clients[want];
    else s.oauth.clients[want] = copy(obj(client));
    return s;
  }

  function same(a, b) {
    try { return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b)); }
    catch (_) { return false; }
  }

  return { VERSION, normalize, envelope, upsertConfig, removeConnector, withOauthEntry, withOauthClient, same };
});
