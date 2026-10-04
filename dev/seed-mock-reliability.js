/* DEV-ONLY live proof for durable reliability boundaries.
 *
 * Boots the real seeded app against a controlled OpenRouter-compatible provider. The first model turn settles
 * the Task Brief and writes one file; the final turn pauses long enough to inspect `.run-journal` while the run
 * is active. `--keep` reuses the workspace for restart/read-back proof. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-mock-reliability');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8947');
const KEEP = process.argv.includes('--keep');
const FINAL_DELAY_MS = Math.max(0, Number(process.env.SKYNET_MOCK_FINAL_DELAY_MS) || 8000);

function sse(res, events, delayMs) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  setTimeout(() => {
    for (const event of events) res.write('data: ' + JSON.stringify(event) + '\n\n');
    res.write('data: [DONE]\n\n'); res.end();
  }, delayMs || 0);
}

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
          let messages = [];
          try { messages = JSON.parse(raw).messages || []; } catch (_) {}
          const toolResults = messages.filter(m => m && m.role === 'tool').length;
          if (toolResults === 0) {
            sse(res, [
              { choices: [{ delta: { tool_calls: [
                { index: 0, id: 'brief-live-1', type: 'function', function: { name: 'brief_proceed', arguments: JSON.stringify({ objective: 'Write the reliability live-proof marker into the workspace' }) } }
              ] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
            ]);
          } else if (toolResults === 1) {
            sse(res, [
              { choices: [{ delta: { tool_calls: [
                { index: 0, id: 'write-live-1', type: 'function', function: { name: 'fs_write', arguments: JSON.stringify({ path: 'reliability-live-proof.txt', content: 'prepared-dispatched-settled' }) } }
              ] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }
            ]);
          } else {
            sse(res, [
              { choices: [{ delta: { content: 'The marker file was written through the live production dispatch path.' } }] },
              { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } }
            ], FINAL_DELAY_MS);
          }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

(async () => {
  if (!KEEP) fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const kept = KEEP && fs.existsSync(path.join(SCRATCH, 'agent.save.json'));
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true, force: !kept, errorOnExist: false });
  if (!kept) {
    const now = Date.now();
    const savePath = path.join(SCRATCH, 'agent.save.json');
    const save = JSON.parse(fs.readFileSync(savePath, 'utf8'));
    save.updatedAt = now; save.savedAt = now; save.doc.updatedAt = now; save.doc.agent.model = 'test/model';
    fs.writeFileSync(savePath, JSON.stringify(save, null, 2));
    const rosterPath = path.join(SCRATCH, 'agent.roster.json');
    const roster = JSON.parse(fs.readFileSync(rosterPath, 'utf8'));
    for (const agent of (roster.agents || [])) agent.model = 'test/model';
    fs.writeFileSync(rosterPath, JSON.stringify(roster, null, 2));
  }
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1', SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-reliability-proof', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-mock-reliability] ' + base + ' -> http://127.0.0.1:' + PORT + (KEEP ? ' [kept]' : ' [fresh]'));
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  const stop = signal => { try { child.kill(signal); } catch (_) {} };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  child.on('exit', code => process.exit(code == null ? 0 : code));
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
