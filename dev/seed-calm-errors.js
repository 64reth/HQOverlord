/* dev/seed-calm-errors.js — DEV-ONLY live-proof launcher for the calm-errors work.

   Same shape as seed-mock-comms.js (real sidecar + real frontend + in-process mock OpenRouter on a
   scratch workspace, $0), but the mock model CALLS TOOLS: turn 1 issues two web_fetch probes that hit
   ordinary web weather — a domain that does not resolve (.invalid → ENOTFOUND) and a dead link
   (real-web 404) — and turn 2 reports. Purpose: watch the REAL dispatch path answer web weather as
   information (green ok chips with 'domain not found' / 'dead link (404)' summaries, no red ✗ ticker
   line, run ends COMPLETE) instead of the pre-2026-07-31 wall of ERROR chips.
   Not part of any test/build; SKYNET_DEV never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-calm-errors');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8923');
const DEAD_DOMAIN_URL = 'https://starnet-calm-probe.invalid/page';
const DEAD_LINK_URL = 'https://example.com/starnet-calm-probe-definitely-404';

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const ev of events) res.write('data: ' + JSON.stringify(ev) + '\n\n');
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
          try { sawToolResult = ((JSON.parse(b).messages) || []).some(m => m && m.role === 'tool'); } catch (_) {}
          if (!sawToolResult) {
            // turn 1: probe both flavors of web weather (web_fetch is read-scope — no Task Brief needed)
            sse(res, [
              { choices: [{ delta: { tool_calls: [
                { index: 0, id: 'call_dead_domain', type: 'function', function: { name: 'web_fetch', arguments: JSON.stringify({ url: DEAD_DOMAIN_URL }) } },
                { index: 1, id: 'call_dead_link', type: 'function', function: { name: 'web_fetch', arguments: JSON.stringify({ url: DEAD_LINK_URL }) } }
              ] } }] },
              { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }
            ]);
          } else {
            // turn 2: relay both tool results verbatim so the transcript proves what the model was told
            let toolText = '';
            try {
              const msgs = (JSON.parse(b).messages) || [];
              toolText = msgs.filter(m => m && m.role === 'tool').map(m => String(m.content || '')).join(' || ');
            } catch (_) {}
            sse(res, [
              { choices: [{ delta: { content: 'PROBE RESULTS: ' + toolText } }] },
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

(async () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  const now = Date.now();
  try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    w.updatedAt = now; w.savedAt = now;
    if (w.doc) {
      w.doc.updatedAt = now;
      if (w.doc.agent) w.doc.agent.model = 'test/model';
      // the golden fixture carries NO station (it is built at first boot: spawn room + desk only), so a
      // freshly seeded station has no DISH and every web_* call is WITHHELD before it can reach web.js.
      // Pre-seed the exact station shape the app builds at first boot — verbatim from a real first-boot
      // save — plus one dish, so the web capability is genuinely granted (object = capability).
      // ⛔ the prop TYPE is `comms_dish` (2x2) — worldmodel maps comms_dish→'dish' CAPABILITY; a prop
      // with unknown type `t:'dish'` makes the whole seeded station fail load and get rebuilt bare.
      // (If pre-seeding ever regresses again, the fallback is the REAL flow from the page console:
      // `Build.open(); Build.__test__.placeCapProp('comms_dish'); Build.close();` — dev-gated.)
      const st = w.doc.station;
      if (st && Array.isArray(st.props)) {
        if (!st.props.some(p => p && p.t === 'comms_dish')) st.props.push({ id: 'p' + (++st._nid), t: 'comms_dish', x: 3, y: 3, w: 2, h: 2 });
      } else {
        w.doc.station = {
          schema: 'starnet.station', version: 1, _nid: 4,
          meta: { name: 'STARNET STATION', createdAt: 0, tier: 0, spawnRoomId: 'r1', trunkRoomId: 'r1' },
          rooms: { r1: { id: 'r1', kind: 'hab', name: 'HAB-01', rects: [{ x1: 0, y1: 0, x2: 17, y2: 10 }], floorStyle: 'hull', floorMat: null, wallStyle: null, wallMat: null, tier: 0, floorPaint: {} } },
          order: ['r1'],
          props: [
            { id: 'p2', t: 'desk', x: 8, y: 1, w: 2, h: 1, agentId: 'agent' },
            { id: 'p3', t: 'comms_dish', x: 3, y: 3, w: 2, h: 2 }
          ],
          belts: {}, edges: []
        };
      }
    }
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}
  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-calm-errors] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
