/* dev/seed-mock-comms.js — DEV-ONLY live-proof launcher for the COMMS honesty work.

   Same shape as seed-mock-cron.js (real sidecar + real frontend + in-process mock OpenRouter),
   but the mock STREAMS SLOWLY (first token after ~2.5s, done at ~4s) so the COMMS run-status
   transitions — connecting… → thinking… → streaming → RUN COMPLETE — are observable via
   preview_* DOM round-trips. Not part of any test/build; SKYNET_DEV never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-mock-comms');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8921');
const REPLY = process.env.SKYNET_MOCK_REPLY || 'Acknowledged. Work complete: reviewed the request and produced the answer.';
const FOLLOWUP_REPLY = process.env.SKYNET_MOCK_FOLLOWUP_REPLY || REPLY;
// stream pacing knobs (concurrent-sessions proof needs run A to stay LIVE while session B is driven by hand)
const FIRST_MS = Number(process.env.SKYNET_MOCK_FIRST_MS) > 0 ? Number(process.env.SKYNET_MOCK_FIRST_MS) : 2500;
const DONE_MS = Number(process.env.SKYNET_MOCK_DONE_MS) > 0 ? Number(process.env.SKYNET_MOCK_DONE_MS) : 1500;

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          let reply = REPLY;
          try {
            const body = JSON.parse(b); const msgs = Array.isArray(body.messages) ? body.messages : [];
            const lastUser = [...msgs].reverse().find(m => m && m.role === 'user');
            if (lastUser && /^(?:operators|executives|customers)$|use your judgment/i.test(String(lastUser.content || '').trim())) reply = FOLLOWUP_REPLY;
          } catch (_) {}
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          setTimeout(() => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: reply } }] }) + '\n\n');
            setTimeout(() => {
              res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }) + '\n\n');
              res.write('data: [DONE]\n\n'); res.end();
            }, DONE_MS);
          }, FIRST_MS);
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
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-mock-comms] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
