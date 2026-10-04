/* node test/update-preparation.http.test.js — real route wiring for freeze, snapshot receipt, and cancel. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const INDEX = path.resolve(__dirname, '..', 'sidecar', 'index.js');
const TOKEN = 'update-preparation-http-token-32-bytes';

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : resolve(p)); });
  });
}
function waitFor(fn, ms, label) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start >= ms) return reject(new Error(label));
      setTimeout(tick, 25);
    };
    tick();
  });
}
async function call(base, route, method, body) {
  const r = await fetch(base + route, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-StarNet-Token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null; try { json = await r.json(); } catch (_) {}
  return { status: r.status, body: json };
}

(async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-update-http-'));
  const workspace = path.join(sandbox, 'workspaces');
  fs.mkdirSync(workspace);
  const sentinel = path.join(workspace, 'canonical-user-state.json');
  const bytes = JSON.stringify({ agents: 4, workstreams: 33, marker: 'transactional-update' });
  fs.writeFileSync(sentinel, bytes);
  const port = await freePort();
  const child = spawn(process.execPath, [INDEX], {
    env: Object.assign({}, process.env, {
      SKYNET_WORKSPACES: workspace, SKYNET_PORT: String(port), SKYNET_API_TOKEN: TOKEN,
      SKYNET_LIVE_PRICES: '0', SKYNET_QUEST_REFRESH: '0', SKYNET_CRON: '0',
      SKYNET_OPENROUTER_KEY: '', STARNET_OPENROUTER_KEY: ''
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', d => { output += d.toString(); });
  child.stderr.on('data', d => { output += d.toString(); });
  try {
    await waitFor(() => output.includes('http://127.0.0.1:' + port), 12000, 'sidecar boot timeout:\n' + output);
    const base = 'http://127.0.0.1:' + port;
    const prepared = await call(base, '/api/update/prepare', 'POST', {
      targetVersion: '9.9.9', browserStore: { 'starnet.save': JSON.stringify({ version: 5, updatedAt: 123 }) }
    });
    A.eq(prepared.status, 200, 'real prepare route succeeds');
    A.eq(prepared.body && prepared.body.ok, true, 'route returns a verified receipt');
    A.ok(fs.existsSync(prepared.body.receipt.snapshot.file), 'receipt names a real recovery bundle');
    A.eq(fs.readFileSync(sentinel, 'utf8'), bytes, 'snapshot preparation preserves canonical bytes');

    const blocked = await call(base, '/api/activity', 'POST', { at: Date.now() });
    A.eq(blocked.status, 423, 'mutation after snapshot is locked');
    A.eq(blocked.body && blocked.body.code, 'UPDATE_MUTATIONS_FROZEN', 'locked response is machine-readable');
    const status = await call(base, '/api/update/status', 'GET');
    A.eq(status.body && status.body.frozen, true, 'read-only status remains available while frozen');
    const cancelled = await call(base, '/api/update/cancel', 'POST', {});
    A.eq(cancelled.body && cancelled.body.frozen, false, 'native install failure can explicitly unfreeze');
    const after = await call(base, '/api/activity', 'POST', { at: Date.now() });
    A.ok(after.status !== 423, 'normal mutation routing resumes after cancel');
    A.report('update-preparation.http.test');
  } finally {
    try { child.kill('SIGKILL'); } catch (_) {}
    await new Promise(resolve => { if (child.exitCode != null || child.signalCode != null) resolve(); else child.once('exit', resolve); });
    const snapshots = path.join(sandbox, 'update-snapshots');
    try { for (const name of fs.existsSync(snapshots) ? fs.readdirSync(snapshots) : []) fs.chmodSync(path.join(snapshots, name), 0o666); } catch (_) {}
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
