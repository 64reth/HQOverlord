/* node test/provider-recovery.e2e.test.js — production-composed provider recovery proof.

   Boots the actual sidecar and drives /api/run over real HTTP against a loopback Anthropic wire. It locks the
   three provider regressions closed together at their production seams:
     1. a failed primary credential is cooled, so the next run starts on a warm alternate;
     2. after that rotation, context compaction calls the live alternate provider rather than the dead primary;
     3. a persisted unmetered row is visible as activity but excluded from /api/budget and cannot trip the day cap.

   No external network and no provider spend. Part of test:http because it owns child processes and sockets. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const HOST = '127.0.0.1';
const PRIMARY = 'anthropic-primary-e2e';
const BACKUP = 'anthropic-backup-e2e';

function anthropicSse(blocks) {
  return blocks.map(v => 'data: ' + JSON.stringify(v)).join('\n') + '\n';
}

function startProvider() {
  return new Promise(resolve => {
    const calls = [];
    let firstRunFinished = false;
    const server = http.createServer((req, res) => {
      if (/\/models(?:\?|$)/.test(req.url || '')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'claude-test', context_window: 200000 }] }));
      }
      let raw = '';
      req.on('data', d => { raw += d; });
      req.on('end', () => {
        const key = String(req.headers['x-api-key'] || '');
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (_) {}
        const isSummary = /compress an earlier slice|PREVIOUS SUMMARY/.test(JSON.stringify(body.system || ''));
        calls.push({ key, isSummary, body });

        if (key === PRIMARY) {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'rate limited for recovery e2e' } }));
        }
        if (key !== BACKUP) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: { message: 'unknown test credential' } }));
        }

        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (isSummary) {
          return res.end(anthropicSse([
            { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 0 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'RECOVERED SUMMARY' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
            { type: 'message_stop' }
          ]));
        }

        const hasToolResult = (body.messages || []).some(m => Array.isArray(m && m.content)
          && m.content.some(b => b && b.type === 'tool_result'));
        if (!firstRunFinished && !hasToolResult) {
          return res.end(anthropicSse([
            // 140k > 65% of Anthropic's 200k default context: the next loop iteration must compact.
            { type: 'message_start', message: { usage: { input_tokens: 140000, output_tokens: 0 } } },
            { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'inspect_1', name: 'station_inspect', input: {} } },
            { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } },
            { type: 'content_block_stop', index: 0 },
            { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
            { type: 'message_stop' }
          ]));
        }

        firstRunFinished = true;
        return res.end(anthropicSse([
          { type: 'message_start', message: { usage: { input_tokens: 50, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'recovered on backup' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
          { type: 'message_stop' }
        ]));
      });
    });
    server.listen(0, HOST, () => resolve({
      server, calls,
      baseUrl: 'http://' + HOST + ':' + server.address().port + '/v1'
    }));
  });
}

async function eventsOf(response) {
  const text = await response.text();
  return text.split('\n').map(line => { try { return JSON.parse(line); } catch (_) { return null; } }).filter(Boolean);
}

(async () => {
  const provider = await startProvider();
  const sidecar = SidecarFixture.create({
    prefix: 'starnet-provider-recovery-',
    env: {
      // The request supplies both credentials and the loopback base URL. Clear ambient credentials so no
      // unrelated background path can escape the fixture.
      OPENROUTER_KEY: '', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '',
      SKYNET_BUDGET_PER_RUN: '10', SKYNET_BUDGET_PER_AGENT: '0',
      SKYNET_BUDGET_PER_DAY: '0.30', SKYNET_BUDGET_GLOBAL: '0',
      SKYNET_EDGE_TTS: '0', STARNET_EDGE_TTS: '0'
    }
  });
  const ws = sidecar.workspace;
  const now = Date.now();
  fs.writeFileSync(path.join(ws, 'ledger.jsonl'), [
    { runId: 'subscription', agentId: 'hero', usd: 0.42, tokens: 42000, model: 'grok-4', unmetered: true, ts: now },
    { runId: 'metered', agentId: 'hero', usd: 0.10, tokens: 1000, model: 'paid/model', unmetered: false, ts: now }
  ].map(row => JSON.stringify(row)).join('\n') + '\n');

  await sidecar.start();
  const base = sidecar.baseUrl;
  const token = sidecar.token;
  const api = async (method, route, body) => fetch(base + route, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-StarNet-Token': token } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  try {
    // Ledger rows remain durable activity, but only the metered $0.10 reaches the budget/cap surface.
    const budget = await (await api('GET', '/api/budget/status')).json();
    A.ok(Math.abs(budget.spentToday - 0.10) < 1e-9, '/api/budget excludes the $0.42 subscription row');
    A.ok(Math.abs(budget.lifetime - 0.10) < 1e-9, 'lifetime metered spend excludes it too');
    A.eq(budget.runs, 2, 'both persisted runs still count as activity');

    const history = [];
    for (let i = 0; i < 8; i++) history.push({ role: i % 2 ? 'assistant' : 'user', content: 'history turn ' + i + ' with enough content to fold' });
    history.push({ role: 'user', content: 'finish this after inspecting the station' });
    const request = {
      provider: 'anthropic', model: 'claude-test', key: PRIMARY, keyPool: [BACKUP],
      baseUrl: provider.baseUrl, internal: true, isTask: false, messages: history
    };
    const firstResponse = await api('POST', '/api/run', request);
    A.eq(firstResponse.status, 200, 'first production /api/run streams');
    const firstEvents = await eventsOf(firstResponse);
    A.ok(firstEvents.some(e => e.name === 'provider.fallback' && e.payload && e.payload.rotate === true), 'primary 429 caused a real credential rotation');
    A.ok(firstEvents.some(e => e.name === 'agent.compact'), 'the failed-over run performed real context compaction');
    A.ok(firstEvents.some(e => e.name === 'agent.run.end' && e.payload && e.payload.reason === 'done'), 'the failed-over run completed');
    A.eq(firstEvents.filter(e => e.name === 'agent.run.error').length, 0, 'no dead-primary compaction error escaped');

    const summaries = provider.calls.filter(c => c.isSummary);
    A.ok(summaries.length >= 1, 'the provider wire observed a summarizer request');
    A.ok(summaries.every(c => c.key === BACKUP), 'every summarizer request used the live backup credential');
    const beforeSecond = provider.calls.length;

    const secondResponse = await api('POST', '/api/run', Object.assign({}, request, {
      messages: [{ role: 'user', content: 'second run during the primary cooldown' }]
    }));
    const secondEvents = await eventsOf(secondResponse);
    A.ok(secondEvents.some(e => e.name === 'agent.run.end' && e.payload && e.payload.reason === 'done'), 'the next run completed during cooldown');
    const secondWire = provider.calls.slice(beforeSecond);
    A.ok(secondWire.length >= 1, 'the next run reached the provider wire');
    A.eq(secondWire[0].key, BACKUP, 'the next run started on the warm backup, not the cooling primary');
    A.eq(secondWire.filter(c => c.key === PRIMARY).length, 0, 'the cooled primary was not retried after backup success');

    // The $0.42 unmetered row exceeds the $0.30 day cap. Both real runs completing proves it never blocked them.
    A.ok(firstEvents.concat(secondEvents).every(e => !(e.name === 'agent.run.end' && e.payload && e.payload.reason === 'budget')),
      'subscription dollars did not trip the production day governor');
  } finally {
    await sidecar.dispose();
    await new Promise(resolve => provider.server.close(resolve));
  }

  A.report('provider-recovery.e2e');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
