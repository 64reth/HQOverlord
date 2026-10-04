/* node test/mcp.manager-race.test.js — deterministic connector lifecycle races. */
'use strict';
const A = require('./_assert.js');
const { makeConnectorManager } = require('../sidecar/mcp/manager.js');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(scripts) {
  const made = [];
  let next = 0;
  const manager = makeConnectorManager({
    makeTransport: () => ({ close() {} }),
    makeClient: ({ transport }) => {
      const script = scripts[next++] || {};
      const client = {
        serverCapabilities: {},
        closeCount: 0,
        initialize: () => script.initialize ? script.initialize.promise : Promise.resolve({}),
        listTools: () => Promise.resolve(script.tools || []),
        callTool: () => Promise.resolve({ content: [] }),
        close() { client.closeCount++; }
      };
      made.push(client);
      return client;
    },
    makeToolDef: () => ({})
  });
  return { manager, made };
}

(async () => {
  // A late failure from an older refresh cannot turn a newer successful refresh red.
  {
    const slow = deferred();
    const newer = deferred();
    const h = harness([
      { tools: [{ name: 'initial' }] },
      { initialize: slow, tools: [{ name: 'stale' }] },
      { initialize: newer, tools: [{ name: 'newer' }] }
    ]);
    await h.manager.configure('race', { url: 'https://example.test/mcp' });
    const oldRefresh = h.manager.refresh('race');
    const newRefresh = h.manager.refresh('race');
    newer.resolve({});
    A.eq((await newRefresh).ok, true, 'newer refresh connects');
    slow.reject(new Error('late stale failure'));
    const staleResult = await oldRefresh;
    A.eq(staleResult.superseded, true, 'late failure is reported as superseded, not current error');
    A.eq(h.manager.status('race').state, 'up', 'late stale failure cannot overwrite newer success');
    A.eq(h.manager.status('race').tools, ['newer'], 'newer tool catalog remains authoritative');
    A.ok(h.made[1].closeCount > 0, 'superseded refresh client is closed');
  }

  // Removing while initialize is pending cannot resurrect the connector.
  {
    const slow = deferred();
    const h = harness([{ initialize: slow, tools: [{ name: 'ghost' }] }]);
    const connecting = h.manager.configure('gone', { url: 'https://example.test/mcp' });
    await h.manager.remove('gone');
    slow.resolve({});
    const result = await connecting;
    A.eq(result.superseded, true, 'remove supersedes the pending connect');
    A.eq(h.manager.status('gone'), null, 'pending connect cannot resurrect a removed connector');
    A.ok(h.made[0].closeCount > 0, 'remove closes the pending client');
  }

  // configure, refresh, and a replacement configure may overlap; only the replacement publishes.
  {
    const configuring = deferred();
    const refreshing = deferred();
    const h = harness([
      { initialize: configuring, tools: [{ name: 'old-config' }] },
      { initialize: refreshing, tools: [{ name: 'old-refresh' }] },
      { tools: [{ name: 'replacement' }] }
    ]);
    const oldConfigure = h.manager.configure('mix', { url: 'https://old.test/mcp', label: 'old' });
    const oldRefresh = h.manager.refresh('mix');
    const replacement = await h.manager.configure('mix', { url: 'https://new.test/mcp', label: 'new' });
    A.eq(replacement.ok, true, 'replacement configure succeeds while prior work is pending');
    configuring.resolve({});
    refreshing.resolve({});
    A.eq((await oldConfigure).superseded, true, 'older configure cannot commit');
    A.eq((await oldRefresh).superseded, true, 'older refresh cannot commit');
    A.eq(h.manager.status('mix').label, 'new', 'replacement config identity remains current');
    A.eq(h.manager.status('mix').tools, ['replacement'], 'replacement catalog remains current');
    A.ok(h.made[0].closeCount > 0 && h.made[1].closeCount > 0, 'both superseded clients are closed');
  }

  A.report('mcp.manager-race');
})().catch(e => { console.log('FAIL: mcp.manager-race threw - ' + (e && e.stack || e)); process.exit(1); });
