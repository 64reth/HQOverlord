'use strict';
const A = require('./_assert.js');
const { recoverToolResult } = require('../sidecar/tool-recovery.js');

(async () => {
  const attempts = [];
  let reads = 0;
  const recovered = await recoverToolResult({
    tool: { provenance: 'host', scope: 'read', readOnly: true }, call: { id: 'read-1' }, ctx: {},
    result: { ok: false, isError: true, summary: 'timeout', content: 'tool timed out' },
    dispatch: async () => { reads++; return { ok: true, isError: false, summary: 'ok', content: 'answer' }; },
    sleep: async () => {}, onRecovery: row => attempts.push(row)
  });
  A.eq(reads, 1, 'a transient host read runs one recovery attempt after the initial result');
  A.eq(recovered.content, 'answer', 'the recovered read result is returned');
  A.eq(attempts.map(x => [x.stage, x.action, x.reason, x.attempt]), [['tool_dispatch', 'retry', 'timeout', 1]], 'tool recovery emits stable telemetry');

  let mutations = 0;
  await recoverToolResult({
    tool: { provenance: 'host', scope: 'write', readOnly: false }, call: { id: 'write-1' }, ctx: {},
    result: { ok: false, isError: true, summary: 'timeout', content: 'timed out' },
    dispatch: async () => { mutations++; return { ok: false, isError: true, summary: 'timeout', content: 'timed out' }; },
    sleep: async () => { throw new Error('mutation retry delay must not run'); }
  });
  A.eq(mutations, 0, 'a mutation is never dispatched a second time');

  let connectorReads = 0;
  await recoverToolResult({
    tool: { provenance: 'connector', scope: 'read', readOnly: true }, call: { id: 'mcp-1' }, ctx: {},
    result: { ok: false, isError: true, summary: 'timeout', content: 'timed out' },
    dispatch: async () => { connectorReads++; return { ok: false, isError: true, summary: 'timeout', content: 'timed out' }; },
    sleep: async () => { throw new Error('connector retry delay must not run'); }
  });
  A.eq(connectorReads, 0, 'an unknown connector operation is never dispatched a second time');

  let cancelledReads = 0;
  const signal = { aborted: true };
  await recoverToolResult({
    tool: { provenance: 'host', scope: 'read', readOnly: true }, call: { id: 'read-cancelled' }, ctx: {}, signal,
    result: { ok: false, isError: true, summary: 'timeout', content: 'timed out' },
    dispatch: async () => { cancelledReads++; return { ok: false, isError: true, summary: 'timeout', content: 'timed out' }; }
  });
  A.eq(cancelledReads, 0, 'cancellation suppresses retry');

  A.report('tool-recovery.test');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
