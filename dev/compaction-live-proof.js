/* node dev/compaction-live-proof.js — LIVE proof that a compacted run keeps its memory (Lane A).

   Drives the REAL sidecar (hermetic SidecarFixture) against a REAL model through a local forwarding proxy to
   OpenRouter whose only edit is the catalog's context_length (so the fold fires on a 30-file task), plus
   STARNET_CONTEXT_LIMIT_OVERRIDE as the belt to that brace. The task reads 30 small files, each holding one
   unique token, then lists every token read. Proof = the FINAL answer (produced after >= 1 fold) names the
   tokens from the FIRST files, which on trunk were the ones the summarizer never saw; agent.compact events
   are captured with their chunk counts.

   Needs SKYNET_OPENROUTER_KEY (dev/.env.dev is read like dev/seed.js does). Optional: SKYNET_DEFAULT_MODEL,
   PROOF_RUNS (default 1), PROOF_WINDOW (default 60000 tokens — must exceed the real fixed prefix, ~30k with tool
   schemas), STARNET_COMPACT_CHUNK_CHARS (default 6000 — 3000 overflows the 12-chunk cap on this task, live-seen), PROOF_MICRO=1 to leave the free elision tier on (the
   default proof turns it off so the paid CHUNKED fold is the path under test). */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { SidecarFixture } = require('../test/helpers/sidecar-fixture.js');

const REPO = path.resolve(__dirname, '..');
for (const envFile of [path.join(__dirname, '.env.dev'), path.join(os.homedir(), 'Desktop', 'gen', 'dev', '.env.dev')]) {
  if (!fs.existsSync(envFile)) continue;
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line[0] === '#') continue;
    const eq = line.indexOf('='); if (eq < 0) continue;
    const k = line.slice(0, eq).trim(); let v = line.slice(eq + 1).trim();
    if ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'"))) v = v.slice(1, -1);
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
  break;
}
const KEY = String(process.env.SKYNET_OPENROUTER_KEY || '').trim();
const MODEL = String(process.env.SKYNET_DEFAULT_MODEL || 'anthropic/claude-haiku-4.5').trim();
const WINDOW = parseInt(process.env.PROOF_WINDOW || '60000', 10);
const RUNS = parseInt(process.env.PROOF_RUNS || '1', 10);
const CHUNK = process.env.STARNET_COMPACT_CHUNK_CHARS || '6000';
const UPSTREAM = 'https://openrouter.ai/api/v1';
if (!KEY) { console.error('no SKYNET_OPENROUTER_KEY'); process.exit(2); }

// ---- forwarding proxy: /models rewritten (context_length -> WINDOW), everything else piped to OpenRouter ----
function startProxy() {
  const stat = { chat: 0, summaries: 0, summaryInputs: [] };
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const url = UPSTREAM + req.url.replace(/^\/api\/v1/, '');
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!/^(host|content-length|connection)$/i.test(k)) headers[k] = v;
      if (req.url.indexOf('/chat/completions') >= 0) {
        stat.chat++;
        try { const j = JSON.parse(body.toString('utf8')); const txt = body.toString('utf8'); if (txt.indexOf('Summarize this earlier part of the conversation') >= 0) { stat.summaries++; stat.summaryInputs.push(j.messages.map(m => String(m && m.content)).join(String.fromCharCode(10))); } } catch (_) {}
      }
      let up;
      try { up = await fetch(url, { method: req.method, headers, body: req.method === 'GET' ? undefined : body }); }
      catch (e) { res.writeHead(502); res.end(String(e && e.message)); return; }
      if (req.url.indexOf('/models') >= 0 && up.ok) {
        const j = await up.json();
        for (const m of (j.data || [])) if (m && m.id === MODEL) m.context_length = WINDOW;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); return;
      }
      const h = {}; up.headers.forEach((v, k) => { if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(k)) h[k] = v; });
      res.writeHead(up.status, h);
      if (!up.body) { res.end(); return; }
      const reader = up.body.getReader();
      while (true) { const { value, done } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
      res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve({ base: 'http://127.0.0.1:' + server.address().port + '/api/v1', stat, close: () => server.close() }));
  });
}

// a CHAIN: start.txt names file 1, file i names file i+1 by a random name — so the reads cannot be batched
// into one turn; every read is its own model turn and the prompt grows past the (shrunken) window.
function makeFiles(dir, n) {
  fs.mkdirSync(dir, { recursive: true });
  const tokens = [], names = [];
  for (let i = 1; i <= n; i++) names.push('node-' + Math.random().toString(36).slice(2, 8) + '.txt');
  for (let i = 1; i <= n; i++) {
    const tok = 'TOKEN-' + String(i).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    tokens.push(tok);
    const next = i < n ? 'NEXT FILE TO READ: ' + names[i] : 'END OF CHAIN. You have now read all ' + n + ' files.';
    fs.writeFileSync(path.join(dir, names[i - 1]), ['step ' + i + ' of ' + n, 'secret token: ' + tok, next, 'filler line for realism. '.repeat(60), ''].join(String.fromCharCode(10)));
  }
  fs.writeFileSync(path.join(dir, 'start.txt'), 'NEXT FILE TO READ: ' + names[0] + String.fromCharCode(10));
  return tokens;
}

async function oneRun(idx) {
  const proxy = await startProxy();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-proof-'));
  const tokens = makeFiles(dir, 30);
  const fixture = SidecarFixture.create({
    prefix: 'compaction-proof-', timeoutMs: 20000,
    env: { SKYNET_OPENROUTER_BASE: proxy.base, STARNET_COMPACT_CHUNK_CHARS: CHUNK, STARNET_CONTEXT_LIMIT_OVERRIDE: String(WINDOW), STARNET_COMPACT_MICRO: process.env.PROOF_MICRO || '0', SKYNET_FULL_ACCESS: '1', SKYNET_QUEST_REFRESH: '0', SKYNET_AUX_BUDGET: '0' }
  });
  await fixture.start();
  const task = 'In the folder ' + dir + ' read start.txt with the file read tool. It names the next file to read; each file names the one after it, and each carries one line "secret token: TOKEN-NN-XXXXXX". Follow the chain to the end (30 files). The file names are unknown until you read the previous file, so read them one at a time. Do not stop early. Write NO text between tool calls (no narration, no running notes) — just make the next read. Only when you reach END OF CHAIN, reply with the complete list of every token you read, one per line, in order. Nothing else.';
  let events = [], text = '';
  try {
    const r = await fixture.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: KEY, model: MODEL, agentId: 'proof-' + idx, isTask: true, placed: ['cabinet'], messages: [{ role: 'user', content: task }] }) });
    const raw = await r.text();
    events = raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    for (const ev of events) if (ev.name === 'agent.token') text += (ev.payload && ev.payload.delta) || '';
    const finals = events.filter(e => e.name === 'agent.final' || e.name === 'agent.run.end');
    const finalText = events.filter(e => e.payload && typeof e.payload.text === 'string').map(e => e.payload.text).join('\n');
    const hay = text + '\n' + finalText;
    const compacts = events.filter(e => e.name === 'agent.compact').map(e => e.payload);
    const reads = events.filter(e => e.name === 'agent.tool_call' && /fs[._]read/.test(e.payload.name)).length;
    const found = tokens.filter(t => hay.indexOf(t) >= 0);
    const firstFive = tokens.slice(0, 5).filter(t => hay.indexOf(t) >= 0);
    const end = events.find(e => e.name === 'agent.run.end');
    const out = {
      run: idx, model: MODEL, window: WINDOW, chunkChars: CHUNK, reason: end && end.payload.reason, turns: end && end.payload.turns, usd: end && end.payload.usd,
      fsReads: reads, compacts: compacts.map(c => ({ reason: c.reason, chunks: c.chunks, before: c.beforeTokens, after: c.afterTokens, elided: c.elided, truncatedChars: c.truncatedChars })),
      summarizerRequests: proxy.stat.summaries, chatRequests: proxy.stat.chat, maxPromptTokens: Math.max(0, ...events.filter(e => e.name === 'agent.cost' && e.payload.tokensIn).map(e => e.payload.tokensIn)),
      tokensFound: found.length + '/30', firstFiveFound: firstFive.length + '/5', missing: tokens.filter(t => hay.indexOf(t) < 0).map(t => t.slice(0, 8)),
      // what the SUMMARIZER was shown (proxy-recorded): on trunk only the oldest 16k chars — here every chunk
      summarizerSawFirstFive: tokens.slice(0, 5).filter(t => proxy.stat.summaryInputs.some(x => x.indexOf(t) >= 0)).length + '/5',
      summarizerSawAll: tokens.filter(t => proxy.stat.summaryInputs.some(x => x.indexOf(t) >= 0)).length + '/30',
      narrationChars: text.replace(/TOKEN-\d\d-[A-Z0-9]{6}\s*/g, '').length
    };
    const llmFolds = compacts.filter(c => c.reason === 'context');
    out.PASS = !!(end && end.payload.reason === 'done' && llmFolds.length >= 1 && llmFolds.some(c => (c.chunks || 0) >= 3) && firstFive.length === 5 && found.length >= 27);
    if (!out.PASS && process.env.PROOF_DEBUG) { out.answer = hay.slice(-3000); out.eventNames = Array.from(new Set(events.map(e => e.name))); }
    return out;
  } finally {
    await fixture.dispose(); proxy.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

(async () => {
  const results = [];
  for (let i = 1; i <= RUNS; i++) {
    const r = await oneRun(i);
    results.push(r);
    console.log(JSON.stringify(r));
  }
  const pass = results.filter(r => r.PASS).length;
  console.log('compaction-live-proof: ' + pass + '/' + RUNS + ' PASS');
  process.exit(pass === RUNS ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
