/* node test/eval-acp-client.test.js — campaign ACP client preserves protocol, permissions, updates, and model pinning. */
'use strict';
const A = require('./_assert.js');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const { spawnAcpClient } = await import(pathToFileURL(resolve(__dirname, '../scripts/eval/campaign/acp-client.mjs')).href);
  const permissions = [];
  const client = spawnAcpClient({
    command: process.execPath, args: [resolve(__dirname, 'fixtures/fake-acp-agent.cjs')], cwd: resolve(__dirname, '..'),
    permission(method, params) { permissions.push({ method, params }); return 'once'; }
  });
  try {
    const init = await client.initialize();
    A.eq(init.agentInfo.name, 'fake', 'initialize response round-trips');
    const session = await client.newSession(resolve(__dirname), []);
    A.eq(session.sessionId, 'fake-session', 'session/new response round-trips');
    await client.setModel(session.sessionId, 'openai-codex:gpt-5.6-luna');
    const run = await client.prompt(session.sessionId, 'probe');
    A.eq(run.result.stopReason, 'end_turn', 'prompt stop reason round-trips');
    A.eq(run.text, 'ACP-OK', 'streamed text chunks are assembled');
    A.ok(run.updates.some(row => row.sessionUpdate === 'tool_call'), 'tool updates are retained');
    await new Promise(resolve => setTimeout(resolve, 20));
    A.eq(permissions.length, 1, 'agent permission request reaches host policy');
    A.eq(permissions[0].method, 'session/request_permission', 'permission method is preserved');
  } finally { await client.close(); }
  A.report('eval-acp-client.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
