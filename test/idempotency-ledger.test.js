/* node test/idempotency-ledger.test.js — the durable connector-write idempotency ledger (SOP lane, 2026-08-21).
   Proves: write classification, scope precedence, key stability under arg reordering, hit/miss, successes-only
   discipline is the caller's (record is explicit), TTL expiry, row bound, restart round-trip, replay result shape. */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const { makeIdempotencyLedger, scopeFor, keyFor, defaultClassify, connectorOf } = require('../sidecar/idempotency-ledger.js');

function memFs() {
  const files = new Map();
  return {
    _files: files,
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, d) { files.set(String(f), String(d)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); }, mkdirSync() {}, unlinkSync(f) { files.delete(String(f)); },
    statSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return { size: files.get(String(f)).length }; },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => fs.writeFileSync(file, data);

(async () => {
  // ---- classification: only custom-connector MUTATIONS are writes ----
  A.eq(defaultClassify('mcp__gmail__send_email'), 'mutate', 'send is a write');
  A.eq(defaultClassify('mcp__gmail__list_messages'), 'observe', 'list is an observation');
  A.eq(defaultClassify('mcp__sheets__append_row'), 'mutate', 'append is a write');
  A.eq(defaultClassify('fs_write'), '', 'a host tool is not a connector call');
  A.eq(defaultClassify('mcp__x__frobnicate'), 'mutate', 'unknown verbs lean conservative (write)');
  A.eq(connectorOf('mcp__google_drive__create_file'), 'google_drive', 'connector id is between the first and last __');

  // ---- scope precedence: explicit (cron tick) > recovered source run > the run itself; NEVER the stream ----
  A.eq(scopeFor({ runId: 'r1', taskKey: 'stream:s1' }), 'run:r1', 'a plain run scopes to itself (not the COMMS stream)');
  A.eq(scopeFor({ runId: 'r2', recovery: { sourceRunId: 'r1' } }), 'run:r1', 'a resumed run inherits its source scope');
  A.eq(scopeFor({ runId: 'r3', idempotencyScope: 'cron:j1:1700000000000' }), 'cron:j1:1700000000000', 'an explicit scope wins');

  // ---- key: stable under arg key ordering, distinct across scope / tool / any arg change ----
  const k1 = keyFor('run:r1', 'mcp__gmail__send_email', JSON.stringify({ to: 'a@b.c', subject: 'hi', body: 'x' }));
  const k2 = keyFor('run:r1', 'mcp__gmail__send_email', JSON.stringify({ body: 'x', subject: 'hi', to: 'a@b.c' }));
  A.eq(k1, k2, 'reordered JSON keys hash to the same write');
  A.ok(k1 !== keyFor('run:r9', 'mcp__gmail__send_email', JSON.stringify({ to: 'a@b.c', subject: 'hi', body: 'x' })), 'a different scope is a different key');
  A.ok(k1 !== keyFor('run:r1', 'mcp__gmail__send_email', JSON.stringify({ to: 'a@b.c', subject: 'hi', body: 'y' })), 'a changed argument is a different write');
  A.ok(k1 !== keyFor('run:r1', 'mcp__gmail__draft_email', JSON.stringify({ to: 'a@b.c', subject: 'hi', body: 'x' })), 'a different tool is a different write');

  // ---- ledger: miss -> record -> hit; TTL; bound; restart round-trip ----
  const fs = memFs();
  let now = 1000;
  const L = makeIdempotencyLedger({ fs, path, workspaces: '/ws', writeDurable, clock: () => now, ttlMs: 10000, maxRows: 3 });
  for (const leaf of ['fixture_run_command', 'execute_command', 'exec_command', 'execute_code', 'terminal']) {
    A.eq(L.isWrite('mcp__demo__' + leaf), false, 'command executions are never replayed as completed writes: ' + leaf);
  }
  A.eq(L.isWrite('mcp__demo__send_message'), true, 'duplicate external sends remain protected');
  A.eq(L.isWrite('mcp__demo__create_shell'), true, 'creating an execution resource is still a protected write');
  A.eq(L.isWrite('mcp__demo__create_run_command'), true, 'creating a command is not executing it');
  A.eq(L.lookup(k1), null, 'empty ledger misses');
  await L.record(k1, { scope: 'run:r1', runId: 'r1', tool: 'mcp__gmail__send_email', summary: 'sent', content: 'Message id 42' });
  const hit = L.lookup(k1);
  A.ok(!!hit && hit.tool === 'mcp__gmail__send_email' && hit.at === 1000 && hit.connector === 'gmail', 'a recorded write is found with its facts');
  const rr = L.replayResult(hit);
  A.ok(rr.ok === true && rr.isError === false && rr.summary === 'idempotent-replay', 'the replay result is an honest ok with a distinct summary');
  A.ok(/\[idempotent replay\]/.test(rr.content) && /Message id 42/.test(rr.content) && /run r1/.test(rr.content), 'the replay body names the prior effect and run');

  // restart: a fresh instance over the same fs sees the row
  const L2 = makeIdempotencyLedger({ fs, path, workspaces: '/ws', writeDurable, clock: () => now, ttlMs: 10000, maxRows: 3 });
  A.ok(!!L2.lookup(k1), 'the ledger survives a restart');

  // TTL: past the window the work item is over
  now = 1000 + 10000;
  A.eq(L2.lookup(k1), null, 'an expired row misses');
  now = 5000;
  A.ok(!!L2.lookup(k1), 'inside the window it still hits');

  // bound: maxRows 3 — the oldest falls off
  await L2.record('k-a', { tool: 't', scope: 's', runId: 'r', summary: '', content: '' }); now = 5001;
  await L2.record('k-b', { tool: 't', scope: 's', runId: 'r', summary: '', content: '' }); now = 5002;
  await L2.record('k-c', { tool: 't', scope: 's', runId: 'r', summary: '', content: '' });
  A.eq(L2.size(), 3, 'the ledger is bounded');
  A.eq(L2.lookup(k1), null, 'the oldest row (k1 @1000) was evicted first');
  A.ok(!!L2.lookup('k-c'), 'the newest row stays');

  // content clamp
  await L2.record('k-big', { tool: 't', scope: 's', runId: 'r', summary: 's', content: 'x'.repeat(10000) });
  A.ok(L2.lookup('k-big').content.length === 4000, 'replay content is clamped to 4000 chars');

  // injected classifier wins
  const L3 = makeIdempotencyLedger({ fs, path, workspaces: '/ws2', writeDurable, clock: () => 1, classify: n => n === 'special' ? 'mutate' : 'observe' });
  A.ok(L3.isWrite('special') && !L3.isWrite('mcp__gmail__send_email'), 'the host-injected classifier is the authority');

  A.report();
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
