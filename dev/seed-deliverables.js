/* dev/seed-deliverables.js — DEV-ONLY live-proof launcher for the organized DELIVERABLES area.

   Same shape as seed-mock-comms.js: a REAL sidecar + REAL frontend + an in-process mock OpenRouter. The mock
   scripts TOOL CALLS rather than prose, so the runs it drives are real all the way down — fs.write really writes
   through the fs jail, sidecar/artifacts.js really folds those tool results into the run's artifact ledger, the
   deliverable_note tool really records the agent's prose, and the library rows are derived by the same
   deliverableRows() the shipped app uses. Nothing here fabricates a deliverable row; it fabricates a MODEL.

   That distinction is the point. A fixture full of hand-written library rows would prove the CSS and nothing else.

   What it stages (three runs, deliberately different shapes):
     1. a NAMED doc deliverable, scoped to a blessed project  -> title + summary + project + hero file
     2. a NAMED page deliverable, scoped to a second project  -> a different project in the rail
     3. an UNNAMED run (never calls deliverable_note)         -> the honest basename-titled row

   Run:  node dev/seed-deliverables.js          (add --keep to reuse the previous scratch workspace)
   Then: open the printed URL and open WORK -> DELIVERABLES.
   Dev-only: SKYNET_DEV never ships. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
const SCRATCH = path.join(__dirname, '.scratch-deliverables');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8733');
const KEEP = process.argv.includes('--keep');
// A fixed per-launch API token so this script can drive the SAME token-guarded routes the browser uses.
// Dev-only and loopback-only, exactly like the rest of this seed.
const TOKEN = 'dev-deliverables-seed-token';

/* ---------- the scripted runs ----------
   Each scenario is a list of TURNS the mock plays back in order for that conversation. A turn is either
   { tool, args } (an assistant tool call) or { text } (the final assistant message). The mock picks the turn by
   counting how many tool results the conversation already carries, so it stays in step with the real loop. */
const SCENARIOS = [
  {
    project: 'churn-study',
    prompt: 'Look at the Q3 signups and tell me where people are dropping off.',
    turns: [
      { tool: 'fs.write', args: { path: 'churn-notes.md', content: '# Q3 churn\n\nThree cohorts, split by signup month.\n\n- Jun: steady through week 8\n- Jul: sharp drop at week 6\n- Aug: too early to call\n\nThe week-6 cliff is the whole story.\n' } },
      { tool: 'fs.write', args: { path: 'cohorts.csv', content: 'cohort,week,retained\njun,4,0.81\njun,6,0.78\njul,4,0.79\njul,6,0.41\naug,4,0.83\n' } },
      { tool: 'deliverable_note', args: { title: 'Q3 churn analysis', summary: 'Three signup cohorts compared week by week; the July group falls off a cliff at week six.', kind: 'doc', main: 'churn-notes.md' } },
      { text: 'Done — the July cohort loses about half its users at week six. Notes and the raw cohort table are saved.' }
    ]
  },
  {
    project: 'coffee-site',
    prompt: 'Build me a small landing page for the coffee shop.',
    turns: [
      { tool: 'fs.write', args: { path: 'index.html', content: '<!doctype html>\n<title>Ember Coffee</title>\n<style>body{background:#120d0a;color:#f3e6d8;font:16px/1.6 system-ui;display:grid;place-items:center;min-height:100vh;margin:0}h1{font-size:3rem;margin:0 0 .3em}p{opacity:.75}</style>\n<main><h1>Ember Coffee</h1><p>Roasted on Tuesdays. Open from six.</p></main>\n' } },
      { tool: 'deliverable_note', args: { title: 'Coffee shop landing page', summary: 'A single dark page with the shop name, the roasting day and the opening time.', kind: 'page', main: 'index.html' } },
      { text: 'The page is built — one file, no dependencies. Open it to see it.' }
    ]
  },
  {
    // NAMED but FILELESS — the agent declares a deliverable without writing anything to disk. Exercises the path
    // that used to drop such a run silently (the note vanished with no trace); the row must survive and the
    // drawer must say plainly that there are no files rather than showing an empty list.
    project: '', slug: 'pricing',
    prompt: 'Compare the three competitor pricing pages and tell me what you find.',
    turns: [
      { tool: 'deliverable_note', args: { title: 'Competitor pricing comparison', summary: 'All three anchor on a mid tier; only one publishes per-seat pricing.', kind: 'doc' } },
      { text: 'All three lead with a mid tier. Only one publishes per-seat pricing; the others gate it behind a call.' }
    ]
  },
  {
    project: '', slug: 'cleanup',
    prompt: 'Write me a quick script to tidy up old log files.',
    turns: [
      { tool: 'fs.write', args: { path: 'cleanup.py', content: 'import os, time\n\nCUTOFF = 30 * 86400\n\nfor name in os.listdir("logs"):\n    p = os.path.join("logs", name)\n    if os.path.isfile(p) and time.time() - os.path.getmtime(p) > CUTOFF:\n        os.remove(p)\n' } },
      // deliberately NO deliverable_note — this is the honest unnamed row the library has to handle well
      { text: 'Here is the script. It deletes anything in logs/ older than 30 days.' }
    ]
  }
];

/* The WORKSHOP shift is not one of our scripted asks — the sidecar generates its prompt, and that prompt names
   the run's own output folder and runId. So the mock does what a real model does: read the folder out of the
   instructions and write there. This is what produces a genuinely PENDING deliverable (validateWorkshopManifest
   proves every listed file off disk), which is the only way to exercise KEEP / DISCARD and the "needs a decision"
   route for real instead of hand-writing a fixture. */
const WORKSHOP_ASK = /private workshop while the Commander is away/;
const SKILL_REVIEW = /background skill review/i;
function workshopTurns(text) {
  const m = text.match(/"runId":\s*"([^"]+)"/);
  if (!m) return null;
  const dir = 'workshop/' + m[1];
  const doc = [
    '# First-week onboarding checklist',
    '',
    '1. Confirm the account is provisioned.',
    '2. Walk the shared drive layout.',
    '3. Pair on one real ticket end to end.',
    '4. Book the week-two review.',
    ''
  ].join('\n');
  const manifest = {
    v: 1, runId: m[1], agentId: 'agent', backlogId: '',
    title: 'First-week onboarding checklist', kind: 'doc',
    summary: 'A four-step checklist for a new hire’s first week. Read it top to bottom on day one.',
    files: [{ path: 'onboarding-checklist.md', bytes: doc.length }],
    howToUse: 'Open it and work down the list.',
    notVerified: ['check the steps match how your team actually onboards']
  };
  return [
    { tool: 'fs.write', args: { path: dir + '/onboarding-checklist.md', content: doc } },
    { tool: 'fs.write', args: { path: dir + '/deliverable.json', content: JSON.stringify(manifest, null, 2) } },
    { text: 'Built the onboarding checklist and wrote its manifest.' }
  ];
}

function scenarioFor(messages) {
  /* Match the CURRENT ask — the LAST user turn — exactly, never by keyword and never the first turn.

     Two things made earlier versions of this pick the wrong script, and both are real StarNet behaviour:
       1. a BACKGROUND SKILL REVIEW fork runs after each completed run through this same mock, and its prompt
          EMBEDS the run it reviews, so keyword matching hit the fork too;
       2. two runs sharing a streamId make the sidecar REPLAY the stream's earlier turns into the request, so
          the first user message is the PREVIOUS ask, not this one.
     Exact equality against the last user turn is immune to both. Anything unrecognised gets the neutral
     "Nothing to do." reply, which is the right answer for a background fork. */
  const users = messages.filter(m => m && m.role === 'user');
  const text = String((users[users.length - 1] || {}).content || '').trim();
  return SCENARIOS.find(s => s.prompt === text) || null;
}

/* How many tool results this ASK has already collected. Counted only since the last user turn, for the same
   replay reason above — older tool results belong to a previous scenario and would skip this one's steps. */
function stepOf(messages) {
  let i = messages.length - 1;
  for (; i >= 0; i--) if (messages[i] && messages[i].role === 'user') break;
  let n = 0;
  for (let k = i + 1; k < messages.length; k++) if (messages[k] && messages[k].role === 'tool') n++;
  return n;
}

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') < 0) { res.writeHead(404); res.end(); return; }
      let b = ''; req.on('data', d => b += d); req.on('end', () => {
        let turn = { text: 'Nothing to do.' };
        try {
          const body = JSON.parse(b);
          const msgs = Array.isArray(body.messages) ? body.messages : [];
          // step = how many tool RESULTS the loop has already fed back, so the mock never gets out of phase
          const done = stepOf(msgs);
          const users = msgs.filter(m => m && m.role === 'user');
          const lastUser = String((users[users.length - 1] || {}).content || '');
          // A WORKSHOP shift first: its prompt is generated by the sidecar, not one of our scripted asks. Never
          // the skill-review fork, which QUOTES the run it reviews and would otherwise look like whatever it quotes.
          const wt = (WORKSHOP_ASK.test(lastUser) && !SKILL_REVIEW.test(lastUser)) ? workshopTurns(lastUser) : null;
          if (wt) turn = wt[Math.min(done, wt.length - 1)];
          else { const sc = scenarioFor(msgs); if (sc) turn = sc.turns[Math.min(done, sc.turns.length - 1)]; }
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (turn.tool) {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + Math.random().toString(36).slice(2, 9), type: 'function', function: { name: turn.tool, arguments: '' } }] } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(turn.args) } }] } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } }) + '\n\n');
        } else {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: turn.text } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 140, completion_tokens: 55, total_tokens: 195 } }) + '\n\n');
        }
        res.write('data: [DONE]\n\n'); res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

const api = (p, body) => new Promise((resolve, reject) => {
  const data = body == null ? null : Buffer.from(JSON.stringify(body));
  const req = http.request({ host: '127.0.0.1', port: Number(PORT), path: p, method: data ? 'POST' : 'GET', headers: Object.assign({ 'x-starnet-token': TOKEN }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
    res => { let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (_) { resolve({ raw: s.slice(0, 400), status: res.statusCode }); } }); });
  req.on('error', reject);
  if (data) req.write(data);
  req.end();
});

async function waitForBoot() {
  for (let i = 0; i < 120; i++) {
    try { const j = await api('/api/health'); if (j) return true; } catch (_) {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  if (!KEEP) { fs.rmSync(SCRATCH, { recursive: true, force: true }); fs.mkdirSync(SCRATCH, { recursive: true }); fs.cpSync(FIXTURE, SCRATCH, { recursive: true }); }
  const now = Date.now();
  try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    w.updatedAt = now; w.savedAt = now;
    if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}

  // Two REAL folders on disk to bless as projects — the project axis is only honest for a root the grant layer
  // actually holds, so these have to exist and go through the real /api/projects/bless route.
  const projectDir = {};
  for (const sc of SCENARIOS) {
    if (!sc.project) continue;
    // OUTSIDE the worktree on purpose: blessPath resolves a path UP to its enclosing git repo root, so a folder
    // inside this checkout would bless the whole repo and both demo projects would collapse into one root.
    const dir = path.join(os.tmpdir(), 'starnet-deliverables-demo', sc.project);
    fs.mkdirSync(dir, { recursive: true });
    projectDir[sc.project] = dir;
  }

  const base = await startMock();
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT, SKYNET_API_TOKEN: TOKEN,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  console.log('[seed-deliverables] mock provider at ' + base);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));

  if (KEEP) { console.log('[seed-deliverables] --keep: reusing the previous library, not re-running the scenarios.'); return; }
  if (!await waitForBoot()) { console.error('[seed-deliverables] sidecar did not answer /api/health'); return; }

  for (const sc of SCENARIOS) {
    let root = '';
    if (sc.project) {
      const r = await api('/api/projects/bless', { path: projectDir[sc.project] });
      // Use the root the grant layer actually recorded (it resolves realpath + walks to a repo root), never the
      // path we asked for — sending an unblessed leaf is exactly what makes a run file as UNFILED.
      root = (r && r.ok && r.root) ? r.root : '';
      console.log('[seed-deliverables] bless ' + sc.project + ' -> ' + (r && r.ok ? 'ok' : JSON.stringify(r)) + ' sent=' + projectDir[sc.project]);
      const known = await api('/api/projects');
      console.log('[seed-deliverables] known roots -> ' + JSON.stringify((known && known.projects || []).map(p => p.path || p.root)));
    }
    const out = await api('/api/run', {
      agentId: 'agent',
      model: 'test/model', key: 'sk-or-v1-mock',   // the browser build sends both; the mock provider accepts anything
      messages: [{ role: 'user', content: sc.prompt }],
      placed: ['cabinet'],                 // a placed CABINET is what grants fs.* — same projection the floor uses
      projectRoot: root || undefined,
      streamId: 'seed-' + (sc.project || sc.slug)   // one stream per scenario: a shared stream replays the previous ask into this one
    });
    console.log('[seed-deliverables] run "' + sc.prompt.slice(0, 40) + '…" -> ' + JSON.stringify(out).slice(0, 500));
  }
  /* A REAL Workshop build, so the library has a genuinely PENDING row. This is the only shape that exercises
     "needs a decision", KEEP and DISCARD, and it is produced the same way the shipped app produces it: grant the
     workshop, queue an item, run the shift. The manifest the mock writes is proven off disk by
     validateWorkshopManifest exactly as a real model's would be — nothing here is hand-placed into the library. */
  const wsGrant = await api('/api/workshop/grant', { agentId: 'agent', on: true });
  const wsQueue = await api('/api/workshop/queue', { agentId: 'agent', title: 'A first-week onboarding checklist for a new hire' });
  const wsShift = await api('/api/workshop/shift', { agentId: 'agent' });
  console.log('[seed-deliverables] workshop grant=' + JSON.stringify(wsGrant && wsGrant.ok) +
    ' queue=' + JSON.stringify(wsQueue && wsQueue.ok) + ' shift=' + JSON.stringify(wsShift && (wsShift.reason || wsShift.ok || wsShift)).slice(0, 160));

  console.log('\n[seed-deliverables] READY -> http://127.0.0.1:' + PORT + '   (open WORK -> DELIVERABLES)\n');
})();
