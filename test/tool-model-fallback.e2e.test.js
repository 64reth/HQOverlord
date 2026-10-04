/* Real sidecar proof: a task selected on a catalog-proven tool-less model must promote the first configured
   tool-capable fallback before admission, report the switch, and call only the effective model. */
'use strict';

const A = require('./_assert.js');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

function startProvider() {
  return new Promise(resolve => {
    const calls = [];
    const server = http.createServer((req, res) => {
      if (/\/models(?:\?|$)/.test(req.url || '')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [
          { id: 'plain/chat', context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
          { id: 'tools/worker', context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }
        ] }));
        return;
      }
      if (/\/chat\/completions(?:\?|$)/.test(req.url || '')) {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          let body = {}; try { body = JSON.parse(raw); } catch (_) {}
          calls.push(body);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Completed on the tool-capable route.' } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 6, total_tokens: 14 } }) + '\n\n');
          res.end('data: [DONE]\n\n');
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({
      server, calls, baseUrl: 'http://127.0.0.1:' + server.address().port + '/api/v1'
    }));
  });
}

function eventsOf(text) {
  return String(text || '').split('\n').map(line => { try { return JSON.parse(line); } catch (_) { return null; } }).filter(Boolean);
}

(async () => {
  const provider = await startProvider();
  const fixture = SidecarFixture.create({
    prefix: 'starnet-tool-model-fallback-',
    env: {
      SKYNET_OPENROUTER_BASE: provider.baseUrl,
      STARNET_OPENROUTER_BASE: provider.baseUrl,
      SKYNET_OPENROUTER_KEY: 'sk-or-v1-tool-fallback-fake',
      STARNET_OPENROUTER_KEY: 'sk-or-v1-tool-fallback-fake',
      SKYNET_QUEST_REFRESH: '0'
    }
  });
  try {
    await fixture.start();
    const catalog = await fixture.json('GET', '/api/models/openrouter');
    A.eq(catalog.status, 200, 'the production model endpoint warms the live provider catalog');
    A.ok(Array.isArray(catalog.body.models) && catalog.body.models.length === 2, 'catalog contains both test routes');

    const response = await fixture.request('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'openrouter', key: 'sk-or-v1-tool-fallback-fake', model: 'plain/chat',
        fallbackModels: ['tools/worker'], agentId: 'agent', isTask: true,
        messages: [{ role: 'user', content: 'Inspect the station and complete this task.' }]
      })
    });
    A.eq(response.status, 200, 'the production /api/run path admits the task');
    const events = eventsOf(await response.text());
    const names = events.map(event => event.name);
    A.eq(names.slice(0, 2), ['agent.run.start', 'provider.fallback'], 'lifecycle reports admission then the preflight route switch');
    const fallback = events.find(event => event.name === 'provider.fallback');
    A.eq(fallback.payload.fromModel, 'plain/chat', 'receipt names the selected tool-less model');
    A.eq(fallback.payload.toModel, 'tools/worker', 'receipt names the promoted model');
    A.eq(fallback.payload.reason, 'tool_support', 'receipt identifies the capability reason');
    A.ok(events.some(event => event.name === 'agent.run.end' && event.payload && event.payload.reason === 'done'), 'the promoted task completes');
    A.eq(provider.calls.length, 1, 'only one provider generation was needed');
    A.eq(provider.calls[0].model, 'tools/worker', 'the incapable model was never called');
  } finally {
    await fixture.dispose();
    await new Promise(resolve => provider.server.close(resolve));
  }
  A.report('tool-model-fallback.e2e.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
