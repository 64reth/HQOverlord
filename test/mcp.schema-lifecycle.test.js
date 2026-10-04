/* node test/mcp.schema-lifecycle.test.js - G3 lazy stdio schemas and bounded process lifetime. */
'use strict';
const A = require('./_assert.js');
const crypto = require('crypto');
const cacheMod = require('../sidecar/mcp/schema-cache.js');
const { makeConnectorManager } = require('../sidecar/mcp/manager.js');

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function memoryCache() {
  const rows = new Map();
  return {
    rows,
    load: id => rows.get(id) || null,
    save: (id, value) => { rows.set(id, JSON.parse(JSON.stringify(value))); return true; },
    remove: id => rows.delete(id)
  };
}
function managerHarness(opts) {
  opts = opts || {};
  const made = [], calls = [];
  let catalog = opts.catalog || [{ name: 'old_tool', inputSchema: { type: 'object' } }];
  const manager = makeConnectorManager({
    makeTransport: cfg => { const t = { cfg, closed: 0, close() { t.closed++; } }; made.push(t); return t; },
    makeClient: ({ transport }) => {
      const client = {
        serverCapabilities: {},
        initialize: async () => ({}),
        listTools: async () => catalog,
        callTool: async (name, args) => { calls.push({ name, args }); return { content: [{ type: 'text', text: name }] }; },
        close: () => transport.close()
      };
      return client;
    },
    makeToolDef: ({ mcpTool, call }) => ({ name: mcpTool.name, run: args => call(mcpTool.name, args) }),
    makeAuxDefs: null,
    clock: opts.clock,
    schemaCache: opts.cache,
    fingerprintConfig: cfg => cacheMod.fingerprint(cfg, digest),
    validateConfig: () => opts.validRef && opts.validRef.ok === false ? 'Safe Cell owner changed' : '',
    stdioIdleMs: opts.idleMs || 100,
    stdioMaxLifetimeMs: opts.maxMs || 1000
  });
  return { manager, made, calls, setCatalog: next => { catalog = next; } };
}

(async () => {
  const a = { transport: 'stdio', command: 'npx', args: ['-y', '@scope/server@1'], env: { B: '2', A: '1' }, agentId: 'safe' };
  const b = { agentId: 'safe', env: { A: '1', B: '2' }, args: ['-y', '@scope/server@1'], command: 'npx', transport: 'stdio' };
  A.eq(cacheMod.fingerprint(a, digest), cacheMod.fingerprint(b, digest), 'fingerprint is canonical across object/env key ordering');
  A.ok(cacheMod.fingerprint(a, digest) !== cacheMod.fingerprint(Object.assign({}, a, { env: { A: 'changed', B: '2' } }), digest), 'env changes invalidate schemas');
  A.ok(cacheMod.fingerprint(a, digest) !== cacheMod.fingerprint(Object.assign({}, a, { args: ['-y', '@scope/server@2'] }), digest), 'package argument changes invalidate schemas');
  A.ok(cacheMod.fingerprint(a, digest) !== cacheMod.fingerprint(Object.assign({}, a, { command: 'node' }), digest), 'command changes invalidate schemas');

  const cache = memoryCache();
  const clock = { value: 0, now() { return this.value; } };
  const first = managerHarness({ cache, clock });
  const cfg = Object.assign({ id: 'local' }, a);
  A.eq((await first.manager.configure('local', cfg)).ok, true, 'initial explicit configure discovers schemas');
  A.eq(first.made.length, 1, 'initial discovery opens one transport');
  await first.manager.close();

  const boot = managerHarness({ cache, clock });
  const restored = await boot.manager.configure('local', cfg, { deferConnect: true });
  A.eq(restored.state, 'cached', 'warm boot projects a matching disk cache');
  A.eq(boot.made.length, 0, 'warm boot does not start a child transport');
  A.eq(boot.manager.status('local').processState, 'stopped', 'status truthfully says the cached process is stopped');
  const oldDef = boot.manager.toolDefsFor('local')[0];
  await oldDef.run({ x: 1 });
  A.eq(boot.made.length, 1, 'the first projected tool call starts the child');
  A.eq(boot.calls.length, 1, 'the first call executes after live schema refresh');

  const ownerValidity = { ok: true };
  const ownerChange = managerHarness({ cache, clock, validRef: ownerValidity });
  await ownerChange.manager.configure('local', cfg, { deferConnect: true });
  ownerValidity.ok = false;
  A.eq(ownerChange.manager.status('local').state, 'error', 'a later Safe Cell ownership change invalidates cached-ready status');
  A.eq(ownerChange.manager.toolDefsFor('local').length, 0, 'invalid owner state withdraws cached schemas before dispatch');

  clock.value = 101;
  A.eq(boot.manager.sweepLifecycle().recycled, 1, 'idle limit recycles the stdio process');
  A.eq(boot.manager.status('local').state, 'cached', 'idle recycle retains verified schemas with stopped status');
  await boot.manager.toolDefsFor('local')[0].run({ x: 2 });
  A.eq(boot.made.length, 2, 'a call after idle recycle starts a fresh child');

  const stale = managerHarness({ cache, clock });
  await stale.manager.configure('local', cfg, { deferConnect: true });
  const staleDef = stale.manager.toolDefsFor('local')[0];
  stale.setCatalog([{ name: 'new_tool', inputSchema: { type: 'object' } }]);
  let staleError = '';
  try { await staleDef.run({}); } catch (e) { staleError = e.message; }
  A.ok(/no longer published/.test(staleError), 'a cached tool removed by the live server is never called as current');
  A.eq(stale.calls.length, 0, 'stale schema rejection occurs before tools/call');

  const changed = managerHarness({ cache, clock });
  const changedCfg = Object.assign({}, cfg, { args: ['-y', '@scope/server@2'] });
  const invalid = await changed.manager.configure('local', changedCfg, { deferConnect: true });
  A.eq(invalid.state, 'down', 'changed package identity invalidates the old cache');
  A.eq(changed.made.length, 0, 'cache invalidation itself starts no child at boot');
  A.eq(changed.manager.toolDefsFor('local').length, 0, 'invalidated schemas are not projected');

  const maxCache = memoryCache();
  const maxClock = { value: 1, now() { return this.value; } };
  const maxed = managerHarness({ cache: maxCache, clock: maxClock, idleMs: 1000, maxMs: 20 });
  await maxed.manager.configure('max', Object.assign({}, cfg, { id: 'max' }));
  maxClock.value = 22;
  A.eq(maxed.manager.sweepLifecycle().recycled, 1, 'maximum lifetime recycles even a non-idle stdio process');

  await boot.manager.close(); await ownerChange.manager.close(); await stale.manager.close(); await changed.manager.close(); await maxed.manager.close();
  A.report('mcp.schema-lifecycle');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
