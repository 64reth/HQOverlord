/* sidecar/mcp/oauth-target.js — resolve an OAuth sign-in id to a trusted connector target.

   Catalog OAuth can start before a config exists. Custom OAuth is different: the URL is user-supplied, so the
   sign-in route accepts it only after the normal connector route has validated + durably saved an HTTPS config
   carrying oauth:true. The start request contains only the id — never an arbitrary probe URL. */
'use strict';

function sameEndpoint(a, b) {
  try {
    const left = new URL(String(a || '')), right = new URL(String(b || ''));
    const key = u => u.protocol.toLowerCase() + '//' + u.host.toLowerCase()
      + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '')) + u.search;
    return key(left) === key(right);
  } catch (_) { return false; }
}

function resolveConnectorOauthTarget(id, catalog, configs) {
  id = String(id || '').trim();
  const list = Array.isArray(configs) ? configs : [];
  const saved = list.find(c => c && String(c.id || '') === id) || null;
  const catalogEntry = catalog && typeof catalog.get === 'function' ? catalog.get(id) : null;
  // A first-party preview connection can be re-authorized onto the stable local
  // adapter without treating Google's old endpoint as an arbitrary custom server.
  const legacyGoogle = !!(catalogEntry && catalogEntry.googleApi && saved && ({
    gmail: 'https://gmailmcp.googleapis.com/mcp/v1', 'google-drive': 'https://drivemcp.googleapis.com/mcp/v1',
    'google-calendar': 'https://calendarmcp.googleapis.com/mcp/v1', 'google-docs': 'https://docsmcp.googleapis.com/mcp/v1',
    'google-sheets': 'https://sheetsmcp.googleapis.com/mcp/v1'
  })[id] === saved.url);
  const savedIsCustom = !!(!legacyGoogle && saved && saved.oauth === true && saved.transport === 'http' && saved.url
    && (!catalogEntry || !sameEndpoint(saved.url, catalogEntry.url)));

  if (!savedIsCustom && catalogEntry) {
    if (catalogEntry.authType !== 'oauth') return { error: 'this connector does not use OAuth', status: 400 };
    if (!catalogEntry.url) return { error: 'this connector has no endpoint configured yet', status: 400 };
    return { entry: catalogEntry, custom: false, config: saved };
  }

  if (!saved) return { error: 'unknown connector', status: 400 };
  if (saved.transport !== 'http' || saved.oauth !== true) return { error: 'this connector does not use OAuth', status: 400 };
  let parsed;
  try { parsed = new URL(String(saved.url || '')); } catch (_) { parsed = null; }
  if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password) return { error: 'custom OAuth connectors require an https:// server URL without embedded credentials', status: 400 };
  return {
    custom: true,
    config: saved,
    entry: { id: id, name: String(saved.label || id), url: parsed.href, authType: 'oauth', staticOauth: null }
  };
}

module.exports = { sameEndpoint, resolveConnectorOauthTarget };
