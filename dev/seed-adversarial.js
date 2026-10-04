/* dev/seed-adversarial.js — DEV-ONLY adversarial-QA launcher.

   Same shape as seed-mock-comms.js (real sidecar + real frontend + in-process mock OpenRouter),
   but the mock streams a LONG, SLOW reply (default ~200 chunks at ~300ms = ~60s) so interrupt
   seams — E-STOP, reload-mid-run, sidecar kill, panel-open-during-stream — are observable and
   raceable. Knobs: SKYNET_MOCK_CHUNKS, SKYNET_MOCK_INTERVAL_MS, SKYNET_MOCK_FIRST_DELAY_MS.
   Not part of any test/build; SKYNET_DEV never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-adversarial');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8932');
const CHUNKS = Math.max(1, parseInt(process.env.SKYNET_MOCK_CHUNKS || '200', 10) || 200);
const INTERVAL = Math.max(10, parseInt(process.env.SKYNET_MOCK_INTERVAL_MS || '300', 10) || 300);
const FIRST_DELAY = Math.max(0, parseInt(process.env.SKYNET_MOCK_FIRST_DELAY_MS || '1200', 10) || 1200);

const WORDS = ['station', 'telemetry', 'harness', 'truthful', 'orbit', 'module', 'docking', 'crew', 'signal', 'relay'];

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
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          let i = 0;
          const timer = setInterval(() => {
            if (res.writableEnded || res.destroyed) { clearInterval(timer); return; }
            if (i < CHUNKS) {
              const w = WORDS[i % WORDS.length] + (i % 12 === 11 ? '.\n' : ' ');
              res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: w } }] }) + '\n\n');
              i++;
            } else {
              clearInterval(timer);
              res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 25, completion_tokens: CHUNKS, total_tokens: 25 + CHUNKS } }) + '\n\n');
              res.write('data: [DONE]\n\n'); res.end();
            }
          }, INTERVAL);
          // NB: res 'close', not req 'close' — Node 22 fires req close at body completion (before first write).
          res.on('close', () => { clearInterval(timer); });
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

(async () => {
  const keep = process.argv.includes('--keep');
  if (!keep) fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const kept = keep && fs.existsSync(path.join(SCRATCH, 'agent.save.json'));
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true, force: !kept, errorOnExist: false });
  const now = Date.now();
  if (!kept) {
    try {
      const sp = path.join(SCRATCH, 'agent.save.json');
      const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
      w.updatedAt = now; w.savedAt = now;
      if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
      fs.writeFileSync(sp, JSON.stringify(w, null, 2));
    } catch (_) {}
    try {
      const rp = path.join(SCRATCH, 'agent.roster.json');
      const r = JSON.parse(fs.readFileSync(rp, 'utf8'));
      for (const a of (r.agents || [])) a.model = 'test/model';
      fs.writeFileSync(rp, JSON.stringify(r, null, 2));
    } catch (_) {}
  }
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-adversarial] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT +
    ' (chunks=' + CHUNKS + ' interval=' + INTERVAL + 'ms)');
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
