/* node test/station-inspect.test.js — tool registration, authority, and honest degradation. */
'use strict';
const A = require('./_assert.js');
const { makeStationInspectTool } = require('../sidecar/tools/builtin/station-inspect.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');

(async () => {
  const planted = {
    schemaVersion: 1,
    build: { status: 'confirmed', data: { harness: 'v-test' } },
    runtime: { status: 'confirmed', data: { runId: 'r1' } },
    scheduler: { status: 'confirmed', data: { jobCount: 2, healthy: true } },
    connectors: { status: 'confirmed', data: { count: 1 } },
    diagnostics: { status: 'confirmed', data: { errorCount: 1 } }
  };
  const made = makeStationInspectTool({ inspect: async () => planted });
  const out = await made.tool.run({}, { runId: 'r1' });
  A.eq(JSON.parse(out.content).scheduler.data.jobCount, 2, 'tool returns the planted authoritative snapshot');
  A.eq(out.summary, 'harness snapshot confirmed', 'all-confirmed state says so');
  A.eq(made.tool.scope, 'read', 'station.inspect is read-only');
  A.eq(made.tool.requiresConsent, false, 'station.inspect needs no approval');
  A.eq(made.tool.capability, 'stationinfo', 'station.inspect has a non-toggleable base capability');
  A.ok(/instead of guessing/.test(made.tool.description), 'tool description carries the anti-guessing rule');

  const missing = makeStationInspectTool({});
  const noReader = JSON.parse((await missing.tool.run({})).content);
  A.eq(noReader.status, 'unavailable', 'an unwired reader is explicit, never an empty-success lie');

  const partial = makeStationInspectTool({ inspect: () => Object.assign({}, planted, { connectors: { status: 'unavailable', reason: 'store down' } }) });
  A.ok(/connectors/.test((await partial.tool.run({})).summary), 'partial snapshots name unavailable sections');

  const station = {
    agents: { nova: { id: 'nova', room: 'bay' } },
    rooms: { bay: { id: 'bay', objects: [{ instanceId: 'desk-1', objectType: 'computer' }] } }
  };
  const resolved = resolveTools('nova', station);
  A.ok(resolved.hasCompute, 'the planted COMPUTER still grants model compute');
  A.ok(resolved.tools.indexOf('station.inspect') >= 0, 'COMPUTER grants station.inspect with no other prop');
  A.ok(resolved.tools.indexOf('fs.read') < 0 && resolved.tools.indexOf('shell.exec') < 0 && resolved.tools.indexOf('web_search') < 0,
    'self-inspection does not widen files, terminal, or network authority');

  const reg = { names: [], register(def) { this.names.push(def.name); } };
  made.register(reg);
  A.eq(reg.names.join(','), 'station.inspect', 'register installs exactly the inspect reader');

  A.report('station-inspect');
})().catch(error => { console.error(error); process.exit(1); });
