/* dev/seed-mock-login.js — DEV-ONLY live-proof launcher for ATTENDED BROWSER LOGIN (browser.login).

   Same shape as seed-mock-comms.js (real sidecar + real frontend + in-process mock OpenRouter), but the
   mock model's FIRST reply is a tool call to browser_login for SKYNET_MOCK_LOGIN_URL (default
   https://example.com/), so a single "log in" chat drives the REAL takeover path end-to-end:
   permission.prompt card -> headed Chrome on the persistent station profile -> done-wait card -> headless
   restore -> the tool result streams back as the final answer. Not part of any test/build; SKYNET_DEV
   never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-mock-login');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8933');
const LOGIN_URL = process.env.SKYNET_MOCK_LOGIN_URL || 'https://example.com/';

// The golden seed intentionally has no station document; the UI builds its bare starter station on first boot.
// This proof needs the real object=capability grant BEFORE that boot so the first run can actually reach
// browser.login. Seed the exact persisted starter shape plus a real comms_dish (never a fake `t:'dish'` prop,
// which worldmodel rejects). Kept pure/exported so the fast suite locks the proof fixture against going stale.
function ensureLoginStation(save) {
  if (!save || !save.doc) return save;
  const st = save.doc.station;
  if (st && Array.isArray(st.props)) {
    if (!st.props.some(p => p && p.t === 'comms_dish')) {
      const next = Math.max(1, Number(st._nid) || 1);
      st.props.push({ id: 'p' + next, t: 'comms_dish', x: 3, y: 3, w: 2, h: 2 });
      st._nid = next + 1;
    }
    return save;
  }
  save.doc.station = {
    schema: 'starnet.station', version: 1, _nid: 4,
    meta: { name: 'STARNET STATION', createdAt: 1, tier: 0, spawnRoomId: 'r1', trunkRoomId: 'r1' },
    rooms: { r1: { id: 'r1', kind: 'hab', name: 'HAB-01', rects: [{ x1: 0, y1: 0, x2: 17, y2: 10 }], floorStyle: 'hull', floorMat: null, wallStyle: null, wallMat: null, hullStyle: null, hullMat: null, tier: 0, floorPaint: {} } },
    order: ['r1'],
    props: [
      { id: 'p2', t: 'desk', x: 8, y: 1, w: 2, h: 1, agentId: 'agent' },
      { id: 'p3', t: 'comms_dish', x: 3, y: 3, w: 2, h: 2 }
    ],
    belts: {}, edges: []
  };
  return save;
}

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const e of events) res.write('data: ' + JSON.stringify(e) + '\n\n');
  res.write('data: [DONE]\n\n'); res.end();
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
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          let sawToolResult = false;
          try {
            const body = JSON.parse(b);
            sawToolResult = (body.messages || []).some(m => m && m.role === 'tool');
          } catch (_) {}
          let sawLoginResult = false;
          try {
            const body = JSON.parse(b);
            sawLoginResult = (body.messages || []).some(m => m && m.role === 'tool' && /login|Commander|declined|unavailable|COMMS/i.test(String(m.content || '')));
          } catch (_) {}
          if (!sawToolResult) {
            // turn 1: settle the Task Brief (real models do this), then browser_login (wire name; dots->underscores)
            sse(res, [
              { choices: [{ delta: { tool_calls: [
                { index: 0, id: 'call_brief_1', type: 'function', function: { name: 'brief_proceed', arguments: JSON.stringify({ objective: 'Log in to the target site as the Commander and research it' }) } },
                { index: 1, id: 'call_login_1', type: 'function', function: { name: 'browser_login', arguments: JSON.stringify({ url: LOGIN_URL }) } }
              ] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }
            ]);
          } else if (!sawLoginResult) {
            // brief settled but the login tool has not returned yet -> call it now
            sse(res, [
              { choices: [{ delta: { tool_calls: [
                { index: 0, id: 'call_login_2', type: 'function', function: { name: 'browser_login', arguments: JSON.stringify({ url: LOGIN_URL }) } }
              ] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }
            ]);
          } else {
            // turn 2: relay the tool result honestly as the final answer
            let toolText = '';
            try { const body = JSON.parse(b); toolText = String(([...body.messages].reverse().find(m => m && m.role === 'tool') || {}).content || ''); } catch (_) {}
            sse(res, [
              { choices: [{ delta: { content: 'LOGIN TOOL RESULT: ' + toolText } }] },
              { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }
            ]);
          }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

async function main() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  const now = Date.now();
  try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    w.updatedAt = now; w.savedAt = now;
    if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
    // THE MOAT: interactive runs grant only what is ON THE FLOOR. Seed a comms dish (-> web capability) so
    // the takeover proof can reach browser.login without hand-placing a prop each launch.
    ensureLoginStation(w);
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-mock-login] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT + ' (login URL: ' + LOGIN_URL + ')');
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
}

module.exports = { ensureLoginStation };
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
