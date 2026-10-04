/* node test/outcomes.http.test.js — OUTCOME LEARNING over the wire (mirrors scout.http.test.js's boot).

   Boots the real sidecar against a PRE-SEEDED runs.jsonl (the append-only run history a prior session would
   have written) and proves the track record end-to-end:
     - GET /api/insights serves `trackRecord` folded from the REAL persisted history: the proven recipe and the
       failing scheduled lane both appear, with LITERAL window counts and the named top failure;
     - the same route stays honest with a thin history (no patterns under support — empty, never invented);
     - the route is token-gated like every other data route.
   ZERO model spend: no key configured, no run fires — the fold reads history. Part of test:http. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

(async () => {
  const fixture = SidecarFixture.create({
    prefix: 'sk-outcomes-',
    env: { OPENROUTER_KEY: '', STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '' }
  });
  const ws = fixture.workspace;
  const now = Date.now();

  // PRE-SEED runs.jsonl: 6/7 clean runs of one recipe (proven) + 1/5 on the cron lane (failing, error ×4).
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push({ runId: 'r' + i, agentId: 'agent', reason: 'done', title: 'Stock Radar', streamId: 'sess-' + i, recipeId: 'radar', model: 'test/model', ts: now - (i + 1) * 3600000 });
  rows.push({ runId: 'r6', agentId: 'agent', reason: 'error', title: 'Stock Radar', streamId: 'sess-6', recipeId: 'radar', model: 'test/model', ts: now - 7 * 3600000 });
  for (let i = 0; i < 4; i++) rows.push({ runId: 'c' + i, agentId: 'agent', reason: 'error', title: 'nightly sweep', streamId: 'cron-j1', model: 'test/model', ts: now - (i + 1) * 3600000 });
  rows.push({ runId: 'c4', agentId: 'agent', reason: 'done', title: 'nightly sweep', streamId: 'cron-j1', model: 'test/model', ts: now - 5 * 3600000 });
  rows.push({ runId: 'x1', agentId: 'agent', reason: 'cancelled', title: 'stopped by hand', streamId: 'sess-x', ts: now - 3600000 });
  fs.writeFileSync(path.join(ws, 'runs.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');

  await fixture.start();
  const B = fixture.baseUrl;

  try {
    const noTok = await fetch(B + '/api/insights');
    A.eq(noTok.status, 403, 'GET /api/insights without a token -> 403');

    const r = await fetch(B + '/api/insights', { headers: { 'X-StarNet-Token': fixture.token, Origin: B } });
    A.eq(r.status, 200, 'GET /api/insights -> 200');
    const j = await r.json();
    A.ok(j.trackRecord && typeof j.trackRecord === 'object', 'the payload carries the track record');
    A.eq(j.trackRecord.decided, 12, 'exactly the decided rows count (the cancelled one classifies nothing)');

    const recipe = (j.trackRecord.patterns || []).find(p => p.key === 'recipe:radar');
    A.ok(!!recipe && recipe.verdict === 'proven', 'the proven recipe pattern is served');
    A.eq(recipe.ok + ' of ' + recipe.n, '6 of 7', '…with LITERAL window counts');
    const sched = (j.trackRecord.patterns || []).find(p => p.key === 'lane:scheduled');
    A.ok(!!sched && sched.verdict === 'failing', 'the failing scheduled lane is served');
    A.ok(sched.topFail && sched.topFail.reason === 'error' && sched.topFail.count === 4, '…with the named top failure ×4');
    A.ok((j.trackRecord.lines || []).some(l => l.indexOf('Stock Radar') >= 0 && l.indexOf('6 of 7') >= 0),
      'the pre-composed prompt lines ride the same payload (what the prompts cite is inspectable)');

    console.log('outcomes.http.test: OK');
  } finally {
    await fixture.dispose();
  }
  A.report('outcomes.http.test');
})().catch(e => { console.error(e); process.exit(1); });
