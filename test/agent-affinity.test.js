/* node test/agent-affinity.test.js — the station's social graph is DERIVED, never assigned.

   The world biases who talks to whom during idle beats. That bias is only honest if every bond can be
   pointed back at real runs, so these assertions are all one law: a pair the run log cannot vouch for
   has no bond, and a pair it can has a bond proportional to what the log actually shows. */
'use strict';
const A = require('./_assert.js');
const { makeAffinityIndex, CREW_W, SHIFT_W, HALF_SCORE, PAIRS_MAX } = require('../sidecar/agent-affinity.js');

const run = (o) => Object.assign({ runId: '', parentRunId: '', agentId: 'agent', internal: false, streamId: '', startedAt: 0, endedAt: 0 }, o);
const T = 1770000000000;   // fixed epoch — these fixtures are relative-ordering, never compared to now

/* ---- CREW: a shared run tree is the strongest bond ---- */
{
  const ix = makeAffinityIndex([
    run({ runId: 'lead1', agentId: 'atlas' }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'vessel' }),
    run({ runId: 'w2', parentRunId: 'lead1', agentId: 'pike' })
  ]);
  A.eq(ix.strengthOf('atlas', 'vessel') > 0, true, 'lead and worker on one job are bonded');
  A.eq(ix.strengthOf('vessel', 'pike') > 0, true, 'two WORKERS on the same job are bonded to each other, not just to the lead');
  A.eq(ix.pairs().length, 3, 'a three-agent job yields all three pairs');
  A.eq(ix.strengthOf('atlas', 'nobody'), 0, 'an agent the log never paired us with has NO bond');
  A.eq(ix.strengthOf('atlas', 'atlas'), 0, 'an agent is never its own companion');
}

/* a solo run is not a collaboration */
{
  const ix = makeAffinityIndex([run({ runId: 'a', agentId: 'atlas' }), run({ runId: 'b', agentId: 'vessel' })]);
  A.eq(ix.pairs().length, 0, 'two agents who never shared a job or a shift have no bond');
}

/* ---- SHIFT: runs reached for in the same stretch of work ---- */
{
  const ix = makeAffinityIndex([
    run({ runId: 'r1', agentId: 'engineer', startedAt: T }),
    run({ runId: 'r2', agentId: 'writer', startedAt: T + 60000 }),          // 1 min later — same stretch
    run({ runId: 'r3', agentId: 'stranger', startedAt: T + 9 * 60000 })     // 9 min later — a different sitting
  ]);
  A.eq(ix.strengthOf('engineer', 'writer') > 0, true, 'runs minutes apart count as working together');
  A.eq(ix.strengthOf('engineer', 'stranger'), 0, 'a run outside the window is NOT a shared shift');
  A.eq(ix.strengthOf('writer', 'stranger'), 0, 'the window is measured PAIRWISE — writer and stranger are 8 min apart, so no bond chains through engineer');
}

/* the window is exclusive at both ends, measured pairwise (not from the first row) */
{
  const ix = makeAffinityIndex([
    run({ runId: 'r1', agentId: 'a1', startedAt: T }),
    run({ runId: 'r2', agentId: 'a2', startedAt: T + 4 * 60000 })
  ], { shiftWindowMs: 5 * 60 * 1000 });
  A.eq(ix.strengthOf('a1', 'a2') > 0, true, 'inside the window');
  const out = makeAffinityIndex([
    run({ runId: 'r1', agentId: 'a1', startedAt: T }),
    run({ runId: 'r2', agentId: 'a2', startedAt: T + 6 * 60000 })
  ], { shiftWindowMs: 5 * 60 * 1000 });
  A.eq(out.strengthOf('a1', 'a2'), 0, 'outside the window');
}

/* a row with no startedAt cannot prove a shift and must not invent one */
{
  const ix = makeAffinityIndex([
    run({ runId: 'r1', agentId: 'a1', startedAt: 0 }),
    run({ runId: 'r2', agentId: 'a2', startedAt: 0 })
  ]);
  A.eq(ix.pairs().length, 0, 'untimed rows yield no shift bond');
  A.eq(ix.stats().timedRows, 0, 'and the stats say so honestly');
}

/* ---- weighting: one delegation outranks one adjacency ---- */
{
  const crew = makeAffinityIndex([
    run({ runId: 'lead1', agentId: 'atlas' }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'vessel' })
  ]);
  const shift = makeAffinityIndex([
    run({ runId: 'r1', agentId: 'atlas', startedAt: T }),
    run({ runId: 'r2', agentId: 'vessel', startedAt: T + 1000 })
  ]);
  A.eq(crew.strengthOf('atlas', 'vessel') > shift.strengthOf('atlas', 'vessel'), true,
    'proven collaboration outweighs mere adjacency');
  A.eq(CREW_W > SHIFT_W, true, 'and the constants say the same thing');
}

/* ---- hidden work is not collaboration ---- */
{
  const ix = makeAffinityIndex([
    run({ runId: 'lead1', agentId: 'atlas' }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'ghost', internal: true })
  ]);
  A.eq(ix.strengthOf('atlas', 'ghost'), 0, 'an INTERNAL child run is harness self-talk, not a companion');

  const streamed = makeAffinityIndex([
    run({ runId: 'r1', agentId: 'atlas', startedAt: T, streamId: 'sys' }),
    run({ runId: 'r2', agentId: 'ghost', startedAt: T + 1000, streamId: 'sys' })
  ], { isInternal: sid => sid === 'sys' });
  A.eq(streamed.strengthOf('atlas', 'ghost'), 0, 'the injected internal-stream rule also excludes SHIFT bonds');
}

/* ---- strength is saturating and pair-local ---- */
{
  const many = [];
  for (let i = 0; i < 40; i++) many.push(run({ runId: 'x' + i, agentId: i % 2 ? 'a1' : 'a2', startedAt: T + i * 1000 }));
  const ix = makeAffinityIndex(many);
  const s = ix.strengthOf('a1', 'a2');
  A.eq(s > 0.9 && s < 1, true, 'strength approaches 1 but never reaches it — no pair is an absolute');

  // a THIRD pair spiking must not move the first pair's number (the world reads these as steady dispositions)
  const before = makeAffinityIndex([
    run({ runId: 'p1', agentId: 'a1', startedAt: T }),
    run({ runId: 'p2', agentId: 'a2', startedAt: T + 1000 })
  ]).strengthOf('a1', 'a2');
  const rows = [
    run({ runId: 'p1', agentId: 'a1', startedAt: T }),
    run({ runId: 'p2', agentId: 'a2', startedAt: T + 1000 })
  ];
  for (let i = 0; i < 30; i++) {
    rows.push(run({ runId: 'q' + i, agentId: i % 2 ? 'b1' : 'b2', startedAt: T + 3600000 + i * 1000 }));
  }
  A.eq(makeAffinityIndex(rows).strengthOf('a1', 'a2'), before,
    "a different pair's activity never changes this pair's strength");
  A.eq(HALF_SCORE > 0, true, 'the half-strength score is a real constant');
}

/* ---- forAgent: companions, strongest first ---- */
{
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(run({ runId: 'w' + i, agentId: i % 2 ? 'hero' : 'bestbud', startedAt: T + i * 1000 }));
  rows.push(run({ runId: 'z1', agentId: 'hero', startedAt: T + 7200000 }));
  rows.push(run({ runId: 'z2', agentId: 'acquaintance', startedAt: T + 7200000 + 1000 }));
  const list = makeAffinityIndex(rows).forAgent('hero');
  A.eq(list[0].agentId, 'bestbud', 'the strongest companion comes first');
  A.eq(list.some(c => c.agentId === 'hero'), false, 'an agent is never listed as its own companion');
  A.eq(list[0].strength > list[list.length - 1].strength, true, 'ordered by real strength');
}

/* ---- bounded: a busy station has a social graph, not a phone book ---- */
{
  const rows = [];
  for (let i = 0; i < 90; i++) rows.push(run({ runId: 'r' + i, agentId: 'ag' + i, startedAt: T + i * 100 }));
  const ix = makeAffinityIndex(rows);
  A.eq(ix.pairs().length <= PAIRS_MAX, true, 'the pair list is capped');
  A.eq(ix.stats().truncated >= 0, true, 'and truncation is reported rather than hidden');
}

/* ---- a corrupt / empty log fails to an empty graph, never a crash ---- */
{
  A.eq(makeAffinityIndex(null).pairs().length, 0, 'no rows -> no bonds');
  A.eq(makeAffinityIndex([null, undefined, {}, { runId: 'x' }]).pairs().length, 0, 'junk rows -> no bonds');
  A.eq(makeAffinityIndex([run({ runId: 'a', parentRunId: 'b' }), run({ runId: 'b', parentRunId: 'a' })]).pairs().length, 0,
    'a parent cycle does not hang or invent a bond');
}

A.report('agent-affinity.test');
