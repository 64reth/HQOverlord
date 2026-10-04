/* dev/seed-free-chain.js — DEV-ONLY live proof of FREE (FULLY AUTONOMOUS) finishing the job.

   Boots the REAL sidecar (real frontend) with an in-process MOCK provider, so a whole night-shift beat runs
   end to end with NO API key and NO spend. The mock deliberately returns a PLAN for a workshop shift — the
   exact shape that used to land on the Commander's desk as "here is a backlog describing the work" — so you
   can watch the top rung refuse to stop there and chain straight into the build.

   What it sets up:
     • a scratch workspace copied from the golden seed (never the real station),
     • autonomy posture = FREE (initiative 'free'),
     • two queued jobs: one is fired automatically so a finished build is already waiting when you open the
       app, the other is left so you can press BUILD NOW in AGENTS ▸ AWAY and watch the chain live.

   Expected: the card in your rail is the BUILT thing ("PC snapshot script"), NOT the plan. The plan is
   recorded as its provenance and shows as IMPLEMENTED in DELIVERABLES.

   node dev/seed-free-chain.js            # default port 9814
   SKYNET_PORT=9820 node dev/seed-free-chain.js                                                            */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-free-chain');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '9814');
const HOST = 'http://127.0.0.1:' + PORT;
const IMPLEMENT_MARK = '[IMPLEMENT_BUILD]';
const WORKSHOP_MARK = '[WORKSHOP_SHIFT]';

const PLAN_MD = `# Automation backlog

1. **Machine snapshot (PowerShell)** — answers "what graphics card is in this thing?" in one command.
2. **Disk pressure report** — top 20 directories by size, with a delta against the previous run.

Build order: 1 before 2 (they share the formatting helper).
`;
const SCRIPT_PS1 = `# snapshot.ps1 — one-screen machine summary
Get-ComputerInfo | Select-Object CsName, OsName, OsBuildNumber, CsTotalPhysicalMemory
Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion
`;

// the mock provider. Two build branches keyed on the prompt sentinel — a WORKSHOP shift returns a PLAN, an
// IMPLEMENT run returns the real artifact. Same shape the e2e drives, so what you see here is what it proves.
function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 16000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          let msgs = []; try { msgs = (JSON.parse(b).messages) || []; } catch (_) {}
          const prompt = String(((msgs.find(m => m && m.role === 'user')) || {}).content || '');
          const runId = (prompt.match(/manifest to "workshop\/([A-Za-z0-9-]+)\/deliverable\.json"/) || [])[1] || 'run';
          const turns = msgs.filter(m => m && m.role === 'tool').length;
          const dir = 'workshop/' + runId;
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
          const tool = (id, name, args) => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) + '\n\n');
            res.write('data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: {} }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } }) + '\n\n');
          };
          const text = t => {
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
            res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 } }) + '\n\n');
          };
          if (prompt.indexOf(IMPLEMENT_MARK) === 0) {
            if (turns === 0) tool('i1', 'fs_write', { path: dir + '/snapshot.ps1', content: SCRIPT_PS1 });
            else if (turns === 1) tool('i2', 'fs_write', { path: dir + '/deliverable.json', content: JSON.stringify({
              v: 1, runId, agentId: 'agent', backlogId: 'x', title: 'PC snapshot script', kind: 'tool', planOnly: false,
              summary: 'A PowerShell one-liner that prints your machine summary — CPU, RAM, GPU, OS build. Covers item 1 of the backlog.',
              files: [{ path: 'snapshot.ps1', bytes: SCRIPT_PS1.length }], howToUse: 'Run snapshot.ps1 in PowerShell.',
              notVerified: ['run it once and compare with Windows Settings'] }) });
            else text('Built the snapshot script from the plan.');
          } else if (prompt.indexOf(WORKSHOP_MARK) === 0) {
            if (turns === 0) tool('w1', 'fs_write', { path: dir + '/automation-backlog.md', content: PLAN_MD });
            else if (turns === 1) tool('w2', 'fs_write', { path: dir + '/deliverable.json', content: JSON.stringify({
              v: 1, runId, agentId: 'agent', backlogId: 'x', title: 'Recent-work automation backlog', kind: 'doc', planOnly: true,
              summary: 'A backlog turning repeated workstation questions into automation candidates.',
              files: [{ path: 'automation-backlog.md', bytes: PLAN_MD.length }], howToUse: 'Open automation-backlog.md.',
              notVerified: ['choose which candidate to build first'] }) });
            else text('Wrote the backlog.');
          } else text('ok');
          res.write('data: [DONE]\n\n'); res.end();
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const now = Date.now(); w.updatedAt = now; w.savedAt = now;
    if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}

  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1', SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let boot = '';
  child.stdout.on('data', d => { boot += d; process.stdout.write(d); });
  child.stderr.on('data', d => { boot += d; process.stderr.write(d); });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));

  for (let i = 0; i < 60 && boot.indexOf(HOST) < 0; i++) await sleep(500);
  const { bootToken } = require(path.join(REPO, 'test', '_httpToken.js'));
  const tok = await bootToken(HOST, HOST);
  const H = { 'Content-Type': 'application/json', 'X-StarNet-Token': tok, Origin: HOST };
  const post = (p, body) => fetch(HOST + p, { method: 'POST', headers: H, body: JSON.stringify(body) });

  await post('/api/autonomy/posture', { posture: { initiative: 'free', reach: 'sandbox' } });
  await post('/api/workshop/grant', { agentId: 'agent', on: true });
  await post('/api/workshop/queue', { agentId: 'agent', id: 'free-demo-1', title: 'Answer the repeated PC-spec questions' });
  await post('/api/workshop/queue', { agentId: 'agent', id: 'free-demo-2', title: 'Answer the repeated disk-space questions' });

  // fire ONE beat now, so a finished build is already waiting when the browser opens.
  const r = await post('/api/workshop/shift', { agentId: 'agent' });
  const lines = (await r.text()).split('\n').filter(Boolean).map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
  const out = ((lines.find(e => e.name === 'workshop.shift.result') || {}).payload) || {};
  const rung = ((await (await fetch(HOST + '/api/autonomy/posture', { headers: H })).json()).summary || {}).initiative;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  FREE-CHAIN PREVIEW   ' + HOST);
  console.log('  rung            : ' + rung + '   (free = FULLY AUTONOMOUS)');
  console.log('  shift outcome   : ' + out.reason);
  console.log('  delivered       : "' + ((out.manifest || {}).title || '?') + '"   planOnly=' + ((out.manifest || {}).planOnly));
  console.log('  chained from    : ' + (out.chainedFrom || '(did not chain)'));
  if (out.autoBuildFailed) console.log('  auto-build      : FAILED (' + out.autoBuildFailed + ') — the plan was delivered instead');
  console.log('');
  console.log('  The agent WROTE a plan and then BUILT it without being asked.');
  console.log('  Open the ⚒ session in the rail: the card is the SCRIPT, not the backlog.');
  console.log('  One job is still queued — AGENTS ▸ AWAY ▸ BUILD NOW to watch it happen live.');
  console.log('══════════════════════════════════════════════════════════\n');
})();
