/* node test/ledger.test.js — the append-only spend ledger, fed an in-memory io + a controllable clock
   (zero disk). Asserts: record stamps ts + persists, totals/day-window/per-run/per-agent queries, a
   prior log is loaded on construction, and corrupt io degrades to empty (never throws into a run). */
'use strict';
const A = require('./_assert.js');
const { makeLedger } = require('../sidecar/ledger.js');

// a fake io with an inspectable backing array + a clock we step by hand
function fakeIo(seed) { const rows = (seed || []).slice(); return { rows, readAll() { return rows.slice(); }, append(e) { rows.push(e); } }; }
let t = 1_000_000;
const clock = { now: () => t };

// ---- record stamps ts, persists through io, returns the entry ----
{
  const io = fakeIo();
  const L = makeLedger({ io, clock });
  const e = L.record({ runId: 'r1', agentId: 'a', turns: 3, usd: 0.5, tokens: 1200 });
  A.eq(e.ts, t, 'record stamps the injected clock time');
  A.eq(e.usd, 0.5, 'usd preserved');
  A.eq(e.model, '(unknown)', 'missing model records explicit unknown');
  A.eq(e.unmetered, false, 'metered by default');
  A.eq(io.rows.length, 1, 'entry persisted through io.append');
  A.eq(L.count(), 1, 'count reflects the recorded run');
  A.eq(io.rows[0].runId, 'r1', 'persisted entry carries the runId');
}

// ---- an explicit ts wins over the clock; missing/garbage fields coerce to safe zeros/strings ----
{
  const L = makeLedger({ io: fakeIo(), clock });
  A.eq(L.record({ runId: 'r', usd: 1, ts: 42 }).ts, 42, 'explicit ts is honored');
  const z = L.record({});
  A.eq([z.runId, z.agentId, z.turns, z.usd, z.tokens], ['', '', 0, 0, 0], 'absent fields coerce to safe defaults');
  A.eq(z.model, '(unknown)', 'absent model coerces to explicit unknown');
  A.eq(z.ts, t, 'absent ts falls back to the clock');
}

// ---- model + unmetered are persisted on spend rows ----
{
  const io = fakeIo();
  const L = makeLedger({ io, clock });
  const e = L.record({ runId: 'codex-run', agentId: 'a', usd: 0, tokens: 900000, model: '  gpt-5.3-codex  ', unmetered: true });
  A.eq(e.model, 'gpt-5.3-codex', 'model is trimmed and recorded');
  A.eq(e.unmetered, true, 'unmetered flag recorded');
  A.eq(io.rows[0].model, 'gpt-5.3-codex', 'persisted row carries model');
  A.eq(L.all()[0].unmetered, true, 'all() surfaces unmetered');
}

// ---- totals + scoped queries ----
{
  const L = makeLedger({ io: fakeIo(), clock });
  L.record({ runId: 'r1', agentId: 'alice', usd: 1.0, ts: t });
  L.record({ runId: 'r2', agentId: 'bob', usd: 2.0, ts: t });
  L.record({ runId: 'r1', agentId: 'alice', usd: 0.5, ts: t });   // same run, second turn-batch
  A.ok(Math.abs(L.totalUsd() - 3.5) < 1e-9, 'totalUsd sums every entry');
  A.ok(Math.abs(L.usdForRun('r1') - 1.5) < 1e-9, 'usdForRun sums one run across entries');
  A.ok(Math.abs(L.usdForAgent('alice') - 1.5) < 1e-9, 'usdForAgent sums one agent');
  A.ok(Math.abs(L.usdForAgent('bob') - 2.0) < 1e-9, 'usdForAgent isolates agents');
  A.eq(L.usdForRun('nope'), 0, 'unknown run -> 0');
}

// ---- usdForDay: only spend inside the trailing dayMs window counts ----
{
  const dayMs = 1000;   // tiny window for the test
  const L = makeLedger({ io: fakeIo(), clock, dayMs });
  L.record({ runId: 'old', usd: 5, ts: 100 });      // far in the past
  L.record({ runId: 'recent', usd: 2, ts: 9500 });  // inside the last 1000ms before now=10000
  t = 10_000;
  A.ok(Math.abs(L.usdForDay() - 2) < 1e-9, 'only spend within the trailing day window counts (now from clock)');
  A.eq(L.usdForDay(12000), 0, 'a later explicit "now" slides the window past every entry');
  A.ok(Math.abs(L.totalUsd() - 7) < 1e-9, 'totalUsd ignores the window');
  t = 1_000_000;
}

// ---- a prior on-disk log is loaded on construction ----
{
  const io = fakeIo([{ runId: 'pre', agentId: 'a', turns: 1, usd: 4, tokens: 10, ts: 5 }]);
  const L = makeLedger({ io, clock });
  A.eq(L.count(), 1, 'pre-existing rows loaded');
  A.eq(L.totalUsd(), 4, 'pre-existing spend counted');
  A.eq(L.usdForRun('pre'), 4, 'pre-existing run queryable');
}

// ---- corrupt io degrades to empty; a failing append never throws into the run ----
{
  const bad = { readAll() { throw new Error('disk gone'); }, append() { throw new Error('disk gone'); } };
  let L;
  A.notThrows(() => { L = makeLedger({ io: bad, clock }); }, 'construction tolerates a throwing readAll');
  A.eq(L.count(), 0, 'corrupt readAll -> empty ledger');
  A.notThrows(() => L.record({ runId: 'r', usd: 1 }), 'a throwing append does not crash record');
  A.eq(L.count(), 1, 'the RAM mirror still answers after an append failure');
  A.eq(L.totalUsd(), 1, 'in-memory total holds even when persistence failed');
}

// ---- strict record is available for paid-credit paths that must fail closed on durable append failure ----
{
  const bad = { readAll() { return []; }, append() { throw new Error('disk gone'); } };
  const L = makeLedger({ io: bad, clock });
  A.throws(() => L.recordStrict({ runId: 'r', usd: 1 }), 'recordStrict throws on append failure');
  A.eq(L.count(), 0, 'recordStrict does not update the RAM mirror when append fails');

  const io = fakeIo();
  const ok = makeLedger({ io, clock });
  const e = ok.recordStrict({ runId: 'strict', agentId: 'a', usd: 2 });
  A.eq(e.runId, 'strict', 'recordStrict returns the persisted entry');
  A.eq(ok.count(), 1, 'recordStrict updates the RAM mirror after append succeeds');
  A.eq(io.rows.length, 1, 'recordStrict persists through io.append');
}

/* ---- UNMETERED rows are excluded from the metered USD aggregates ------------------------------
   The flag was stamped at record time and had zero readers here, so one run read two different amounts:
   /api/insights said $0.00 "subscription / unmetered" while /api/budget's spentToday + lifetime and the
   budget governor's day/global pools counted the full provider-reported figure — and that phantom spend then
   blocked a later REAL run with reason 'budget'. The run is still counted; only the dollars are not. */
{
  const io2 = { rows: [], readAll: () => io2.rows.slice(), append: (e) => io2.rows.push(e) };
  const L = makeLedger({ io: io2, clock: { now: () => 5000 } });
  L.record({ runId: 'r-sub', agentId: 'hero', usd: 0.42, tokens: 42000, model: 'grok-4', unmetered: true, ts: 5000 });
  L.record({ runId: 'r-byok', agentId: 'hero', usd: 0.10, tokens: 1000, model: 'gpt', ts: 5000 });
  A.eq(L.totalUsd(), 0.10, 'totalUsd counts only metered dollars');
  A.eq(L.usdForDay(5000), 0.10, 'usdForDay too — this is what the day cap reads');
  A.eq(L.usdSince(0), 0.10, 'and usdSince');
  A.eq(L.usdForAgent('hero'), 0.10, 'and the per-agent fold');
  A.eq(L.usdForRun('r-sub'), 0, 'a subscription run contributes no metered spend');
  A.eq(L.usdForRun('r-byok'), 0.10, 'a BYOK run still does');
  A.eq(L.count(), 2, 'BOTH runs are still counted — the work happened');
  A.eq(L.all().length, 2, 'and both rows are still readable');
  A.eq(L.all().find(r => r.runId === 'r-sub').unmetered, true, 'the flag survives the round-trip');
  A.eq(L.reportedUsd(), 0.52, 'reportedUsd still exposes what the provider claimed, for a surface that wants it');
  A.eq(L.reportedUsdForRun('r-sub'), 0.42, 'per-run too');
}

/* ---- ...and the budget governor therefore cannot be blocked by subscription dollars ---- */
{
  const io3 = { rows: [], readAll: () => io3.rows.slice(), append: (e) => io3.rows.push(e) };
  const L = makeLedger({ io: io3, clock: { now: () => 5000 } });
  L.record({ runId: 'r-sub', agentId: 'hero', usd: 0.42, tokens: 42000, model: 'grok-4', unmetered: true, ts: 5000 });
  const { makeBudget } = require('../sidecar/budget.js');
  const B = makeBudget({ caps: { day: 0.30 }, ledger: L, clock: { now: () => 5000 } });
  const v = B.check ? B.check() : null;
  A.ok(!v || v.ok !== false, 'a day cap of $0.30 is NOT tripped by $0.42 of subscription spend');
}

A.report('ledger.test');
