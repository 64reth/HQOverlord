/* node test/seedreuse.test.js — the pure seed-reuse AGGREGATE engine (frontend/app/seedreuse.js).
   Locks the G3b contract: per-seed run counts over a rolling 7-day window AND lifetime; the once-per-window
   crest callout fires exactly at N=5 (never again until the window rolls past it); provenance-only (a blank
   name is a no-op); the living-tools shelf reports honest counts. Pure + deterministic — the clock is injected. */
'use strict';
const A = require('./_assert.js');
const SR = require('../frontend/app/seedreuse.js');

const DAY = 24 * 60 * 60 * 1000;
A.eq(SR.THRESHOLD, 5, 'the window-crest threshold is 5 runs');
A.eq(SR.WINDOW_MS, 7 * DAY, 'the window is a rolling 7 days');

/* ---------- fresh / hydrate defensive ---------- */
let s = SR.hydrate(null);
A.ok(s && s.v === 1 && s.seeds, 'hydrate(null) → a fresh well-formed state');
const junk = SR.hydrate({ seeds: { a: null, b: 5, ok: { name: 'ok', lifetime: '3', stamps: ['x', 100, -2, 200], firedAt: 'nope' } } });
A.eq(Object.keys(junk.seeds), ['ok'], 'hydrate drops malformed seed entries');
A.eq(junk.seeds.ok.stamps, [100, 200], '…and sanitizes the stamp ring (drops non-numeric / non-positive)');

/* ---------- lifetime + window counting, and the N=5 crest fires ONCE ---------- */
{
  let st = SR.hydrate(null);
  const t0 = 1_000_000_000_000;
  let crossedCount = 0;
  for (let i = 0; i < 4; i++) {
    const r = SR.record(st, 'morning brief', t0 + i * 1000);
    st = r.state;
    if (r.crossed) crossedCount++;
  }
  A.eq(crossedCount, 0, 'four runs in the window do NOT cross the threshold yet');
  A.eq(SR.windowCount(st, 'morning brief', t0 + 5000), 4, 'the window count reflects four real runs');

  const r5 = SR.record(st, 'morning brief', t0 + 5000); st = r5.state;
  A.eq(r5.crossed, 'morning brief', 'the FIFTH run crosses the crest — the callout fires with the seed name');
  A.eq(SR.windowCount(st, 'morning brief', t0 + 5000), 5, 'window count is now 5');

  const r6 = SR.record(st, 'morning brief', t0 + 6000); st = r6.state;
  A.eq(r6.crossed, null, 'a SIXTH run in the same window does NOT re-fire (fire-once per window crest)');

  // matched by name case-insensitively / whitespace-tolerantly (the SeedCredit key idiom)
  const rCase = SR.record(st, '  Morning   Brief ', t0 + 7000); st = rCase.state;
  A.eq(rCase.crossed, null, 'the same seed under different casing/spacing is the SAME seed (still no re-fire)');
  const tools = SR.livingTools(st, t0 + 7000);
  A.eq(tools.length, 1, 'one living tool tracked');
  A.eq(tools[0].runs, 7, 'lifetime run count is the honest total (7)');
  A.eq(tools[0].sevenDay, 7, '…and all 7 are within the current window');
}

/* ---------- the rolling window drops stale runs AND re-arms the callout past a crest ---------- */
{
  let st = SR.hydrate(null);
  const t0 = 2_000_000_000_000;
  // five runs cross the crest at t0
  let last;
  for (let i = 0; i < 5; i++) { last = SR.record(st, 'weekly recap', t0 + i * 1000); st = last.state; }
  A.eq(last.crossed, 'weekly recap', 'the crest fires at 5');
  // 8 days later: the five old runs have rolled out of the window
  const t8 = t0 + 8 * DAY;
  A.eq(SR.windowCount(st, 'weekly recap', t8), 0, 'eight days on, no runs remain in the rolling window');
  const toolsLater = SR.livingTools(st, t8);
  A.eq(toolsLater[0].runs, 5, 'lifetime count is NEVER pruned — the tool has run 5× over its life');
  A.eq(toolsLater[0].sevenDay, 0, '…but its 7-day count has honestly decayed to 0');
  // five NEW runs in the fresh window re-cross the crest (the callout re-arms once the old window rolled past)
  let last2;
  for (let i = 0; i < 5; i++) { last2 = SR.record(st, 'weekly recap', t8 + i * 1000); st = last2.state; }
  A.eq(last2.crossed, 'weekly recap', 'a NEW window crest fires again — fire-once is per window, not forever');
  A.eq(SR.livingTools(st, t8 + 5000)[0].runs, 10, 'lifetime total is now 10 (honest cumulative)');
}

/* ---------- provenance-only: a blank/absent name is never tallied ---------- */
{
  let st = SR.hydrate(null);
  const r = SR.record(st, '', 1000); st = r.state;
  A.eq(r.crossed, null, 'recording a blank name is a no-op (never tally an unmatched run)');
  A.eq(SR.livingTools(st, 2000), [], 'no seed was created for the blank name');
  const r2 = SR.record(st, '   ', 1000);
  A.eq(SR.livingTools(r2.state, 2000), [], 'whitespace-only is also a no-op');
}

/* ---------- two distinct seeds tracked independently ---------- */
{
  let st = SR.hydrate(null);
  const t0 = 3_000_000_000_000;
  for (let i = 0; i < 5; i++) st = SR.record(st, 'price watch', t0 + i).state;
  for (let i = 0; i < 2; i++) st = SR.record(st, 'inbox triage', t0 + i).state;
  const tools = SR.livingTools(st, t0 + 10);
  A.eq(tools.map(t => t.name), ['price watch', 'inbox triage'], 'sorted by lifetime runs desc (5 above 2)');
  A.eq(SR.windowCount(st, 'inbox triage', t0 + 10), 2, 'the second seed counts independently');
}

/* ---------- JSON round-trip preserves the tally ---------- */
{
  let st = SR.hydrate(null);
  for (let i = 0; i < 3; i++) st = SR.record(st, 'daily digest', 4_000_000_000_000 + i).state;
  const back = SR.hydrate(JSON.parse(JSON.stringify(st)));
  A.eq(SR.livingTools(back, 4_000_000_000_100)[0].runs, 3, 'lifetime count survives a persist round-trip');
}

A.report('seedreuse.test');
