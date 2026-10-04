/* dev/rec-evidence-live.mjs — DEV-ONLY live proof for the W2 evidence seam.

   The claim under test is about a PROMPT the browser never sees: does an internal reason-only run that asks for
   `evidence:true` actually receive the Commander evidence pack, and does one that does NOT ask still get the bare
   verbatim prompt? A unit test can only lock the source; this drives the REAL sidecar over REAL HTTP and reads
   what the provider was actually sent.

   Same in-process mock-provider pattern as dev/onboard-mock.js, with one difference: this mock ECHOES nothing
   useful back — it CAPTURES the system message it received. Every real module runs (route, runOnce, prompt
   assembly, commander-context); only the model at the far side of the HTTP boundary is canned.

   Zero credits, zero writes outside its own scratch workspace. Not part of any test/build.
   Run: node dev/rec-evidence-live.mjs */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const SCRATCH = path.join(REPO, '.dev-workspaces-rec-evidence');
const FIXTURE = path.join(HERE, 'fixtures', 'seed-workspace');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = 9688;
const TOKEN = 'rec-evidence-live-token';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };

let lastSystem = '';
function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 64000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          try {
            const body = JSON.parse(b); const msgs = Array.isArray(body.messages) ? body.messages : [];
            const sys = msgs.find(m => m && m.role === 'system');
            lastSystem = sys ? String(sys.content || '') : '';
          } catch (_) { lastSystem = ''; }
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'PITCH: a thing\nWHY: because\nBUILD: workflow\nGAP: taste' } }] }) + '\n\n');
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

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Starnet-Token': TOKEN }, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, text };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  // a real active goal + a real open thread, written the way the station stores them, so the pack has
  // something true to carry. Nothing here is invented at read time — these are the station's own files.
  fs.writeFileSync(path.join(SCRATCH, '_commander.goals.json'),
    JSON.stringify({ goal: { text: 'ship StarNet to a thousand real users', at: Date.now() } }, null, 2));

  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: String(PORT), SKYNET_API_TOKEN: TOKEN,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: ['ignore', 'ignore', 'inherit'] });
  const done = () => { try { child.kill(); } catch (_) {} };
  process.on('SIGINT', () => { done(); process.exit(1); });

  try {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/api/health'); if (r.ok) break; } catch (_) {}
      await sleep(500);
    }
    const URL_CHAT = 'http://127.0.0.1:' + PORT + '/api/run';
    const SYSTEM = 'You are NOVA. Reply in EXACTLY the requested format.';
    const call = (extra) => post(URL_CHAT, Object.assign({
      system: SYSTEM, messages: [{ role: 'user', content: 'INTERNAL — THE FIRST PITCH. Reply in the exact format.' }],
      agentId: 'agent', isTask: false, placed: [], internal: true, model: 'test/model', provider: 'openrouter'
    }, extra));

    console.log('\n1. an internal run WITHOUT evidence:true — the bare verbatim prompt (unchanged behaviour)');
    lastSystem = '';
    const r0 = await call({});
    if (r0.status !== 200) { console.log('   [setup] chat route answered ' + r0.status + ': ' + r0.text.slice(0, 200)); }
    await sleep(400);
    ok(lastSystem.indexOf(SYSTEM) === 0, 'the caller’s system prompt is sent verbatim');
    ok(lastSystem.indexOf('<commander_context') < 0, 'NO commander context block');
    ok(lastSystem.indexOf('<active_goal') < 0, 'NO active goal block');
    ok(lastSystem.trim() === SYSTEM, 'nothing at all is appended — byte-identical to the pre-W2 behaviour');
    const bare = lastSystem;

    console.log('\n2. the SAME run with evidence:true — the pack arrives');
    lastSystem = '';
    await call({ evidence: true });
    await sleep(400);
    ok(lastSystem.indexOf(SYSTEM) === 0, 'the caller’s prompt still leads (the format instruction is not buried)');
    ok(lastSystem.length > bare.length, 'the prompt genuinely grew');
    ok(lastSystem.indexOf('<active_goal provenance="commander-confirmed">') >= 0, 'the active GOAL reaches the generator');
    ok(lastSystem.indexOf('thousand real users') >= 0, '…with its real text, from the station’s own store');
    ok(lastSystem.indexOf('<commander_context provenance="commander-dossier">') >= 0, 'the dossier reaches it');
    ok(lastSystem.indexOf('building and testing StarNet') >= 0, '…with its real text');

    console.log('\n3. the internal path is otherwise UNTOUCHED (no manual, no capability summary, no skills)');
    ok(!/OPERATOR MANUAL|FIELD MANUAL/i.test(lastSystem), 'no operator manual');
    ok(lastSystem.indexOf('Capabilities you actually have') < 0, 'no capability summary');
    ok(!/SKILL LIBRARY|skills you can load/i.test(lastSystem), 'no skill catalog');
    ok(lastSystem.indexOf('RECALLED MEMORY') < 0, 'no memory fence');
  } finally {
    done();
  }

  console.log('\nrec-evidence-live: ' + (fail ? fail + ' problem(s), ' + pass + ' ok' : 'OK (' + pass + ' checks)'));
  process.exit(fail ? 1 : 0);
})();
