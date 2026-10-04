/* node test/scout.http.test.js — SCOUT routes, boot-level (mirrors roster-envelope.http.test.js's boot).

   Boots the real sidecar against a PRE-SEEDED workspace (a warm interest histogram + one staged recipe
   draft + a ledger entry) and proves:
     - the stores HYDRATE across a restart (warm:true, the staged draft + ledger survive) — the whole point
       of moving the scout server-side;
     - GET /api/scout derives everything from real persisted state (interests carry their evidence);
     - the routes are token-gated like every other /api data route;
     - POST /api/scout/context accepts a bounded push;
     - POST /api/scout/decide dismiss removes the draft, records the verdict in the ledger, AND persists the
       denylisted fingerprint to disk (dismiss = never again must survive a restart);
     - an unknown id answers ok:false (stale shelf), never a throw.
   ZERO model spend: no key is ever configured, and no run fires — the scout cycle only triggers post-run.
   Part of test:http (child-process boot tests don't gate the fast lane). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

(async () => {
  const fixture = SidecarFixture.create({
    prefix: 'sk-scout-',
    env: { OPENROUTER_KEY: '', STARNET_OPENROUTER_KEY: '', SKYNET_OPENROUTER_KEY: '' }
  });
  const ws = fixture.workspace;
  const now = Date.now();

  // PRE-SEED: a warm interest (fresh lastAt so decay hasn't eaten it) with its evidence, and one staged
  // recipe draft + one ledger row — the exact state a prior session's scout cycle would have persisted.
  fs.writeFileSync(path.join(ws, 'scout.interests.json'), JSON.stringify({
    v: 1,
    state: {
      v: 1,
      topics: { 'stock-research': { label: 'stock research', w: 3.2, n: 4, lastAt: now - 3600000, ev: [{ q: 'NVDA earnings and the market reaction', at: now - 3600000 }] } },
      lastPassAt: now - 3600000, runsSincePass: 1
    }
  }));
  const FP = 'movers radar stock watchlist why with';   // sorted-token fingerprint shape (content irrelevant to the routes)
  fs.writeFileSync(path.join(ws, 'scout.state.json'), JSON.stringify({
    v: 1,
    state: {
      v: 1,
      staged: [{
        id: 'draft-1', kind: 'recipe', why: 'you asked about semiconductor stocks repeatedly', fingerprint: FP, at: now - 3600000,
        draft: { name: 'Stock Radar', emoji: '⊙', tagline: 'Watchlist movers with the why', blurb: 'b', category: 'research', tags: { research: 1 }, params: [{ key: 'tickers', label: 'Watchlist', placeholder: 'NVDA' }], task: 'Check {tickers} today.', gear: ['dish'], source: 'scout' }
      }],
      denylist: [], ledger: [{ at: now - 3600000, kind: 'recipe', outcome: 'staged', reason: 'seed', title: 'Stock Radar' }],
      runsSinceMint: 0, lastMintAt: now - 3600000, lastKind: 'recipe', context: null
    }
  }));

  await fixture.start();
  const B = fixture.baseUrl;
  let apiToken = '';
  const j = async (m, p, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (apiToken) headers['X-StarNet-Token'] = apiToken;
    const r = await fetch(B + p, { method: m, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); let v; try { v = JSON.parse(t); } catch (_) { v = t; }
    return { status: r.status, body: v };
  };

  try {
    // token gate: the scout read is a data route like any other — no token, no state.
    const noTok = await fetch(B + '/api/scout');
    A.eq(noTok.status, 403, 'GET /api/scout without a token -> 403');

    apiToken = fixture.token;

    // hydration across a restart: the pre-seeded state IS the response (the client-session-bound bug this lane kills).
    const g1 = await j('GET', '/api/scout');
    A.eq(g1.status, 200, 'GET /api/scout -> 200');
    A.eq(g1.body.warm, true, 'a persisted warm interest survives a restart');
    A.eq(g1.body.staged.length, 1, 'a persisted staged draft survives a restart');
    A.eq(g1.body.staged[0].draft.name, 'Stock Radar', 'the draft round-trips intact');
    A.ok(g1.body.staged[0].why.indexOf('semiconductor') >= 0, 'the draft carries its WHY');
    A.eq(g1.body.interests[0].topic, 'stock-research', 'interests rank by decayed weight');
    A.ok(g1.body.interests[0].evidence.length > 0, 'interests carry their evidence quotes (truthful telemetry)');
    A.ok(g1.body.gate && typeof g1.body.gate.binding !== 'undefined', 'the live gate binding is reported');
    A.eq(g1.body.ledger.length, 1, 'the attempt ledger survives a restart');

    // context push: bounded accept.
    const cx = await j('POST', '/api/scout/context', { customRecipes: [{ name: 'My Recipe', tagline: 't' }], worksignalSummary: 'dish-heavy', topRecommendation: 'researcher' });
    A.eq(cx.status, 200, 'POST /api/scout/context -> 200');
    A.eq(cx.body.ok, true, 'the context push is accepted');

    // decide: dismiss removes + records + denylists durably.
    const bad = await j('POST', '/api/scout/decide', { id: 'draft-1', decision: 'shred' });
    A.eq(bad.status, 400, 'an illegal decision -> 400');
    const dis = await j('POST', '/api/scout/decide', { id: 'draft-1', decision: 'dismiss' });
    A.eq(dis.status, 200, 'POST /api/scout/decide dismiss -> 200');
    A.eq(dis.body.ok, true, 'the dismiss is acknowledged');
    A.eq(dis.body.item.draft.name, 'Stock Radar', 'the decided item is echoed');
    const g2 = await j('GET', '/api/scout');
    A.eq(g2.body.staged.length, 0, 'the dismissed draft is gone from the shelf');
    A.eq(g2.body.ledger[g2.body.ledger.length - 1].outcome, 'dismissed', 'the verdict lands in the ledger');
    // the denylist reached DISK (dismiss = never again must survive a restart).
    const onDisk = JSON.parse(fs.readFileSync(path.join(ws, 'scout.state.json'), 'utf8'));
    A.ok(onDisk.state.denylist.indexOf(FP) >= 0, 'the dismissed fingerprint is persisted to the denylist');

    const stale = await j('POST', '/api/scout/decide', { id: 'draft-1', decision: 'dismiss' });
    A.eq(stale.body.ok, false, 'deciding an already-decided id answers ok:false, never a throw');

    console.log('scout.http.test: OK');
  } finally {
    await fixture.dispose();
  }
  // report() settles the assertion counter — the .catch below only fires on a THROWN error, so
  // without this a failed assertion still exits 0 and the gate scores it green.
  A.report('scout.http.test');
})().catch(e => { console.error(e); process.exit(1); });
