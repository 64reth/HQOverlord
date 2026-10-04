'use strict';
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
rl.on('line', line => {
  let row; try { row = JSON.parse(line); } catch (_) { return; }
  if (row.method === 'initialize') return send({ jsonrpc: '2.0', id: row.id, result: { protocolVersion: 1, agentInfo: { name: 'fake' } } });
  if (row.method === 'session/new') return send({ jsonrpc: '2.0', id: row.id, result: { sessionId: 'fake-session' } });
  if (row.method === 'session/set_model') return send({ jsonrpc: '2.0', id: row.id, result: {} });
  if (row.method === 'session/prompt') {
    send({ jsonrpc: '2.0', id: 'permission-1', method: 'session/request_permission', params: { options: [{ optionId: 'once' }] } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: row.params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'fixture read', kind: 'read', status: 'in_progress' } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: row.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP-' } } } });
    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: row.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'OK' } } } });
    return send({ jsonrpc: '2.0', id: row.id, result: { stopReason: 'end_turn' } });
  }
});
