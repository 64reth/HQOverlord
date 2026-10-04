/* dev/seed-mock-cron.js — DEV-ONLY live-proof launcher for the cron-SESSIONS work.

   Boots the REAL sidecar (serving the real frontend) with:
     - a tiny in-process MOCK OpenRouter (so a cron run produces deterministic reply text with no real key),
     - the golden seed workspace copied to a scratch dir (pre-onboarded station, dev auto-boot),
     - SKYNET_CRON_ENABLED + full access so a routine can be created and fired live.

   Prints the URL. Not part of any test/build; SKYNET_DEV never ships. Used to drive preview_* DOM
   round-trips proving cron.fire adds a busy rail row and cron.result folds the durable transcript. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-mock-cron');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8783');
const REPLY = 'Digest complete: reviewed 3 sources, 2 action items flagged.';

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', async () => {
          // dev-only: SKYNET_MOCK_DELAY_MS holds the reply open so a live proof can catch the run IN FLIGHT
          const hold = Number(process.env.SKYNET_MOCK_DELAY_MS || 0);
          if (hold > 0) await new Promise(r => setTimeout(r, hold));
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: REPLY } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }) + '\n\n');
          res.write('data: [DONE]\n\n'); res.end();
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

(async () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  const now = Date.now();
  try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    w.updatedAt = now; w.savedAt = now;
    if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1', SKYNET_CRON_ENABLED: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-mock-cron] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
