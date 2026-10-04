/* sidecar/agent-affinity.js — WHICH AGENTS ACTUALLY WORK TOGETHER.

   The station's idle life leans on this: two agents the Commander really does use together
   should be seen together. So the bond has to be DERIVED from the append-only run log, never
   assigned, never random. If the world shows two sprites as inseparable, this module has to be
   able to point at the runs that made them so — same rule as deliverable-provenance: prose comes
   from the agent, attribution comes from harness truth.

   TWO SIGNALS, both provable off a run row, deliberately weighted differently:

   - CREW  (weight CREW_W) — two agents in the same RUN TREE: a lead run plus the non-internal
                             child runs that `parentRunId` hangs off it. That is literal
                             collaboration on one job, so it is the strongest thing we can read.
                             Crew membership reuses deliverable-provenance's contributorsOf so
                             "who was on this run" has exactly ONE definition in the codebase and
                             the two can never drift.
   - SHIFT (weight SHIFT_W) — two agents whose runs STARTED within SHIFT_WINDOW_MS of each other.
                             Weaker and inferred, but it is the signal that actually exists: on a
                             real 643-row station log, 0 runs carried a parentRunId and 0 pairs
                             overlapped literally (runs serialize), while 22 pairs clustered in
                             time — engineer|writer 20x, researcher|writer 15x. That clustering is
                             a true fact about how the Commander works, not a guess: these agents
                             get reached for in the same stretch of work.

   Weighted so one real delegation outranks a few coincidental adjacencies, and so a station that
   never delegates still grows bonds instead of staying inert.

   STRENGTH is saturating, not relative: strength = score / (score + HALF_SCORE). A pair's number
   never moves because some OTHER pair spiked, which matters because the world reads these as
   steady dispositions. It approaches 1 and never reaches it — no pair becomes an absolute.

   PURE: rows in, answers out. No ambient IO, no ambient clock (recency is deliberately NOT
   decayed in v1 — the run log is already a bounded window, and a second time-dependence would
   make this untestable headlessly for no behavioural gain). `isInternal` is injected because
   which streams are harness self-talk is the caller's knowledge (contextpack), not ours. */
'use strict';
(function (root, factory) {
  const api = factory(
    (typeof module !== 'undefined' && module.exports)
      ? require('./deliverable-provenance.js')
      : ((root.SK || {}).deliverableProvenance)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).agentAffinity = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (provenance) {
  'use strict';

  const SHIFT_WINDOW_MS = 5 * 60 * 1000;  // "reached for in the same stretch of work" — measured against the real log, where 5min separated clustered work from unrelated sessions
  const CREW_W = 3;                       // one proven delegation outranks a handful of coincidental adjacencies
  const SHIFT_W = 1;
  const HALF_SCORE = 6;                   // score at which strength = 0.5 (≈ six shared shifts, or two delegations)
  const PAIRS_MAX = 240;                  // a station has a social graph, not a phone book — bounds the payload
  const SHIFT_PAIRS_PER_ROW_MAX = 24;     // a burst of parallel runs must not turn one row into an O(n) fan-out

  function str(v) { return v == null ? '' : String(v); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

  // Same hidden-work rule deliverable-provenance applies: harness self-talk is not collaboration.
  function hidden(row, isInternal) {
    if (!row) return true;
    if (row.internal) return true;
    try { return !!(isInternal && isInternal(row.streamId)); } catch (_) { return false; }
  }

  function pairKey(a, b) { return a < b ? (a + '|' + b) : (b + '|' + a); }

  /* rows: durable run rows (runStore.all()). opts: { isInternal?, shiftWindowMs? } */
  function makeAffinityIndex(rows, opts) {
    opts = opts || {};
    const isInternal = typeof opts.isInternal === 'function' ? opts.isInternal : null;
    const shiftWindow = num(opts.shiftWindowMs) > 0 ? num(opts.shiftWindowMs) : SHIFT_WINDOW_MS;
    const list = Array.isArray(rows) ? rows : [];

    // acc: pairKey -> { a, b, crew, shift }
    const acc = new Map();
    function bump(aId, bId, field) {
      if (!aId || !bId || aId === bId) return;
      const k = pairKey(aId, bId);
      let e = acc.get(k);
      if (!e) { e = { a: k.split('|')[0], b: k.split('|')[1], crew: 0, shift: 0 }; acc.set(k, e); }
      e[field]++;
    }

    // ---- CREW: every pair inside one run tree ----
    // Walk LEAD rows only (no parentRunId); contributorsOf expands each into its full crew, so a
    // three-agent job contributes all three pairs rather than only lead->worker spokes.
    const index = provenance && provenance.makeProvenanceIndex
      ? provenance.makeProvenanceIndex(list, { isInternal: isInternal })
      : null;
    if (index) {
      for (const r of list) {
        if (!r || !r.runId || str(r.parentRunId)) continue;   // children are reached THROUGH their lead
        if (hidden(r, isInternal)) continue;
        const crew = index.contributorsOf(r.runId) || [];
        if (crew.length < 2) continue;                        // a solo run is not a collaboration
        for (let i = 0; i < crew.length; i++) {
          for (let j = i + 1; j < crew.length; j++) bump(str(crew[i].agentId), str(crew[j].agentId), 'crew');
        }
      }
    }

    // ---- SHIFT: runs that started within the window of each other ----
    // Sorted sweep with a trailing window, so this stays O(n log n + pairs) instead of O(n^2) on a
    // large log. The per-row fan-out cap keeps one dense burst from dominating the whole graph.
    const timed = list
      .filter(r => r && str(r.agentId) && num(r.startedAt) > 0 && !hidden(r, isInternal))
      .map(r => ({ agentId: str(r.agentId), startedAt: num(r.startedAt) }))
      .sort((x, y) => x.startedAt - y.startedAt);
    let lo = 0;
    for (let i = 0; i < timed.length; i++) {
      while (lo < i && (timed[i].startedAt - timed[lo].startedAt) > shiftWindow) lo++;
      let fan = 0;
      for (let j = lo; j < i && fan < SHIFT_PAIRS_PER_ROW_MAX; j++) {
        if (timed[j].agentId === timed[i].agentId) continue;
        bump(timed[i].agentId, timed[j].agentId, 'shift');
        fan++;
      }
    }

    // ---- score + saturating strength ----
    const pairs = [];
    for (const e of acc.values()) {
      const score = e.crew * CREW_W + e.shift * SHIFT_W;
      if (score <= 0) continue;
      pairs.push({
        a: e.a, b: e.b, crew: e.crew, shift: e.shift, score: score,
        strength: Math.round((score / (score + HALF_SCORE)) * 1000) / 1000
      });
    }
    pairs.sort((x, y) => (y.score - x.score) || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
    const kept = pairs.slice(0, PAIRS_MAX);

    const byKey = new Map();
    for (const p of kept) byKey.set(pairKey(p.a, p.b), p);

    /* strengthOf — 0 when the log can't prove these two have ever worked together. The world MUST
       read a 0 as "no bond", never as "weak bond": an unproven pair gets baseline treatment. */
    function strengthOf(aId, bId) {
      const p = byKey.get(pairKey(str(aId), str(bId)));
      return p ? p.strength : 0;
    }

    // every proven companion of one agent, strongest first
    function forAgent(agentId) {
      const id = str(agentId);
      return kept
        .filter(p => p.a === id || p.b === id)
        .map(p => ({ agentId: p.a === id ? p.b : p.a, strength: p.strength, crew: p.crew, shift: p.shift }));
    }

    return {
      pairs: () => kept.slice(),
      strengthOf,
      forAgent,
      stats: () => ({ pairs: kept.length, truncated: Math.max(0, pairs.length - kept.length), timedRows: timed.length })
    };
  }

  return { makeAffinityIndex, SHIFT_WINDOW_MS, CREW_W, SHIFT_W, HALF_SCORE, PAIRS_MAX };
});
