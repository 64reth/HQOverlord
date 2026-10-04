'use strict';
// Loaded only by connector-oauth-refresh-race.e2e.test.js. It intercepts the synthetic audit host so the test
// drives the real sidecar OAuth boundary without external DNS or network access.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns');
const lookup = dns.promises.lookup;
dns.promises.lookup = function (host, options) {
  if (host === 'audit.example.com') return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
  return lookup.call(this, host, options);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (raw, options) {
  const u = new URL(String(raw));
  if (u.hostname !== 'audit.example.com') return originalFetch(raw, options);
  const root = process.env.STARNET_WORKSPACES;
  if (u.pathname === '/token') {
    fs.writeFileSync(path.join(root, 'refresh-started'), '1');
    await new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (fs.existsSync(path.join(root, 'refresh-release'))) { clearInterval(timer); resolve(); }
        else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error('test release timed out')); }
      }, 20);
    });
    return new Response(JSON.stringify({
      access_token: 'AUDIT_REFRESHED_OLD_GRANT', refresh_token: 'AUDIT_ROTATED', token_type: 'Bearer', expires_in: 3600
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  let msg = {}; try { msg = JSON.parse(options.body); } catch (_) {}
  const result = msg.method === 'initialize'
    ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'audit', version: '1' } }
    : { tools: [] };
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
