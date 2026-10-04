// Local-only acceptance rig: real seeded app, mock model and mock MCP (no third-party account).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../scripts/lib/cdp.mjs';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const port = 18965, cdpPort = 19365;
const out = path.join(root, 'dev', '.platform-proof'); fs.mkdirSync(out, { recursive: true });
const log = fs.openSync(path.join(out, 'sidecar.log'), 'a');
const bodyOf = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(JSON.parse(b || '{}'))); });
let calls = 0;
const mock = http.createServer(async (req, res) => {
  if (req.url.includes('/models')) { res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 64000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] })); return; }
  const b = await bodyOf(req);
  if (req.url === '/mcp') {
    if (!b.id) { res.writeHead(202); res.end(); return; }
    const results = { initialize: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Local proof fixture', version: '1' } },
      'tools/list': { tools: [{ name: 'list_messages', description: 'Read local fixture inbox', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } }] },
      'resources/list': { resources: [] }, 'prompts/list': { prompts: [] }, 'tools/call': { content: [{ type: 'text', text: 'Fixture inbox: one message, subject Platform proof.' }] } };
    if (b.method === 'tools/call') calls++;
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: b.id, result: results[b.method] || {} })); return;
  }
  const msgs = b.messages || [], last = msgs.findLastIndex(m => m.role === 'user');
  const continued = String(msgs[last]?.content || '').includes('Continue the task above');
  const saw = msgs.slice(last + 1).some(m => m.role === 'tool');
  const tool = continued ? 'mcp__gmail__list_messages' : 'connectors_list';
  const args = continued ? {} : { goal: 'summarize my gmail inbox email', query: 'gmail' };
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const delta = saw ? { content: continued ? 'Fixture inbox summary: one message, Platform proof.' : 'Connect Gmail to continue this inbox task.' }
    : { tool_calls: [{ index: 0, id: 'brief_proof', type: 'function', function: { name: 'brief_proceed', arguments: JSON.stringify({ objective: 'Summarize the fixture inbox' }) } },
      { index: 1, id: 'connector_proof', type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }] };
  res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n');
  res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: saw ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6 } }) + '\n\n');
  res.end('data: [DONE]\n\n');
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + mock.address().port;
let seed, chrome, cdp;
function boot() { seed = spawn(process.execPath, ['dev/seed.js', '--keep'], { cwd: root, windowsHide: true, stdio: ['ignore', log, log], env: { ...process.env, SKYNET_PORT: String(port), SKYNET_DEFAULT_MODEL: 'test/model', SKYNET_OPENROUTER_KEY: 'mock-local-proof', SKYNET_OPENROUTER_BASE: base + '/api/v1' } }); }
function stopSeed() {
  if (!seed) return;
  // Only the direct child of THIS seed launcher, then the launcher; no name-based process killing.
  if (process.platform === 'win32') execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${seed.pid}" | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }`], { windowsHide: true });
  seed.kill(); seed = null;
}
async function until(fn, label, attempts = 120) { for (let i = 0; i < attempts; i++) { try { if (await fn()) return; } catch {} await sleep(500); } throw new Error('Timed out: ' + label); }
try {
  let occupied = false;
  try { await fetch('http://127.0.0.1:' + port + '/api/health'); occupied = true; } catch {}
  if (occupied) throw new Error('Proof port is already occupied; refusing to reuse another sidecar.');
  boot();
  await until(async () => (await fetch('http://127.0.0.1:' + port + '/api/health')).ok, 'sidecar');
  chrome = launchChrome({ cdpPort, profileDir: path.join(out, 'chrome') });
  cdp = await connectCDP(cdpPort); const diag = collectDiagnostics(cdp);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + port });
  await until(() => evalJS(cdp, "typeof Chat !== 'undefined' && typeof Workstreams !== 'undefined' && document.querySelector('#screen-game')?.classList.contains('active')"), 'live game');
  const ws = await evalJS(cdp, "(() => { const w = Workstreams.create('Platform proof', {agentId:'agent',activate:false}); App.openWorkstream(w.id); Chat.send('Summarize my Gmail inbox'); return w.id; })()");
  await until(() => evalJS(cdp, `!!Workstreams.connectorHandoff(${JSON.stringify(ws)}) && !Chat.isBusy()`), 'connector handoff');
  const initial = await evalJS(cdp, `({ handoff: Workstreams.connectorHandoff(${JSON.stringify(ws)}), chip: document.querySelector('#chat-log')?.textContent || document.body.textContent })`);
  assert.equal(initial.handoff.connectorId, 'gmail'); assert.match(initial.chip, /CONNECT GMAIL/);
  await evalJS(cdp, "StationUI.openTerm('connectors','catalog')");
  await until(() => evalJS(cdp, "document.body.textContent.includes('waiting for connection.')"), 'pending task banner');
  await evalJS(cdp, `Harness.api.post('/api/connectors', {id:'gmail', label:'Local Gmail proof fixture',transport:'http',url:${JSON.stringify(base + '/mcp')}})`);
  await evalJS(cdp, 'App.persist()'); await sleep(1500);
  stopSeed(); boot();
  await until(async () => (await fetch('http://127.0.0.1:' + port + '/api/health')).ok, 'restart');
  await evalJS(cdp, 'window.__platformBeforeReload = true');
  await cdp.send('Page.reload');
  await until(() => evalJS(cdp, `!window.__platformBeforeReload && typeof StationUI !== 'undefined' && typeof App !== 'undefined' && typeof Workstreams !== 'undefined' && !!Workstreams.connectorHandoff(${JSON.stringify(ws)}) && document.querySelector('#screen-game')?.classList.contains('active')`), 'durable handoff after restart');
  await evalJS(cdp, "StationUI.openTerm('connectors','catalog')");
  await until(() => evalJS(cdp, "Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'CONTINUE TASK')"), 'continue button');
  const paint = await evalJS(cdp, "getComputedStyle(Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'CONTINUE TASK')).backgroundColor");
  assert.ok(!['rgb(255, 255, 255)', 'rgb(239, 239, 239)'].includes(paint), 'continuation button uses station styling');
  const runCount = await evalJS(cdp, `Workstreams.get(${JSON.stringify(ws)}).runIds.length`);
  await evalJS(cdp, "(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'CONTINUE TASK'); b.click(); b.click(); })()");
  await until(() => evalJS(cdp, `Workstreams.get(${JSON.stringify(ws)}).runIds.length > ${runCount} && !Chat.isBusy()`), 'continued run');
  const final = await evalJS(cdp, `({runIds:Workstreams.get(${JSON.stringify(ws)}).runIds,history:Workstreams.get(${JSON.stringify(ws)}).history.map(m=>({role:m.role,content:m.content})),handoff:Workstreams.connectorHandoff(${JSON.stringify(ws)})})`);
  assert.equal(final.runIds.length, runCount + 1, 'double click starts one run');
  assert.equal(final.handoff, null); assert.ok(calls > 0, 'continued agent used live fixture MCP');
  assert.equal(diag.exceptions.length, 0, JSON.stringify(diag.exceptions));
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ mockProvider: true, mockMcp: true, thirdPartyConsent: false, initial: initial.handoff, final, continuationButtonPaint: paint, mcpCalls: calls, diagnostics: diag }, null, 2));
  console.log('LIVE PASS: connector offer -> saved handoff -> connect -> sidecar restart -> Continue task -> one run -> MCP read; receipt dev/.platform-proof/receipt.json');
} finally {
  try { cdp?.ws.close(); } catch {}
  chrome?.proc.kill(); stopSeed(); mock.close(); fs.closeSync(log);
}
