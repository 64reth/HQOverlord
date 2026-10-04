/* sidecar/auxgovernor.js — the PURE AUX-SPEND GOVERNOR for the post-run seam (aux-budget lane).

   THE PROBLEM THIS CLOSES: after ONE hot task run, up to SIX independent aux model passes can fire
   (sidecar/index.js run-end: reflection · study · thread-mine · scout-cycle · skill-review · skill-curator).
   Each has its OWN salience gate + cooldown + cost cap — good in isolation — but there was NO JOINT ceiling:
   a single substantive run could touch off five or six billable model calls back-to-back, and no test bounded
   the aggregate. This module is the one JOINT decision: given the passes whose OWN gates already cleared THIS
   run-end (the candidates), a priority order, and a budget, it decides which passes may SPEND and which are
   DEFERRED. It NEVER fires anything and holds NO state — the ambient half (reading the gates, firing the
   granted passes, logging the deferrals) lives in sidecar/index.js.

   PRIORITY is LOCKED to the product's beat order (highest first):
     reflection > failure-review > study > threadmine > scout > skill-review > skill-curator
   so when the budget is scarce the station keeps the turn-in beat + belief updates the Commander actually sees,
   and yields the quieter background passes to the NEXT qualifying run. (failure-review fires only on FAILED
   run-ends, where reflection never qualifies — the two are mutually exclusive per run, never rivals.)

   DEFERRED ≠ SUPPRESSED: a deferred pass simply is not fired this run-end; the caller arms NO cooldown for it,
   so its own gate re-qualifies and it retries on the next run. Truthful telemetry: the caller records the
   deferral (which passes yielded) so a reader can see the ceiling bit, not just its effect.

   DETERMINISM SPLIT (mirrors nightshift.js / nightfocus.js / cron-store.js): every function here is a pure
   transform over its inputs — NO Date.now / new Date() / Math.random / performance.now / fs — so it passes
   test/lint-determinism.js and is headless-testable. There is no `now` parameter because the decision has no
   time dependence: the caller has ALREADY resolved each pass's own time-based gate before handing us the
   candidate list. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).auxgovernor = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // The LOCKED beat-order priority: earlier index = higher priority = wins a scarce budget slot.
  // 'failure-review' sits directly after 'reflection': a failed run's lesson is the most valuable thing that
  // run can produce. The two never actually compete — reflection gates on reason 'done' and failure-review on
  // a failure reason, so per run-end at most ONE of them is a candidate (asserted in test/failreview.test.js).
  const PRIORITY = ['reflection', 'failure-review', 'study', 'threadmine', 'scout', 'skill-review', 'skill-curator'];
  // Default JOINT ceiling: at most this many aux passes may SPEND per run-end. 0 means "no ceiling"
  // (governor OFF / unlimited) — an explicit opt-out only; 0 is NEVER the default (see parseBudget).
  const DEFAULT_BUDGET = 2;

  // parseBudget(raw, dflt) -> integer >= 0. `raw` is the env string (SKYNET_AUX_BUDGET); `dflt` overrides the
  // module default. A missing / blank / non-integer / negative value falls back to the default — we never
  // silently drop to "unlimited" on garbage input. A literal, well-formed "0" IS honored (unlimited/off) —
  // but only when the operator wrote it, never as the fallback.
  function parseBudget(raw, dflt) {
    const d = (Number.isInteger(dflt) && dflt >= 0) ? dflt : DEFAULT_BUDGET;
    if (raw == null) return d;
    const s = String(raw).trim();
    if (s === '' || !/^\d+$/.test(s)) return d;   // reject '', negatives, floats, junk -> default (fail-safe, not unlimited)
    const n = parseInt(s, 10);
    return (Number.isInteger(n) && n >= 0) ? n : d;
  }

  // rank(name, priority) -> its index in the priority list, or Infinity for an unknown pass (sorts last but is
  // still eligible — the governor never silently drops a pass it doesn't recognize; it just deprioritizes it).
  function rank(name, priority) {
    const p = Array.isArray(priority) ? priority : PRIORITY;
    const i = p.indexOf(name);
    return i < 0 ? Infinity : i;
  }

  // decide({ candidates, budget, priority }) -> { spend:[names], deferred:[names], budget, unlimited }
  //   candidates : pass-names whose OWN gates ALREADY cleared this run-end (input order irrelevant — we re-sort).
  //   budget     : integer (typically from parseBudget); 0 = unlimited (every candidate spends, nothing deferred).
  //   priority   : optional override of PRIORITY (tests); defaults to the locked order.
  // Pure: same inputs -> same output, always. Dups are collapsed; unknown names sort last but stay eligible.
  function decide(o) {
    o = o || {};
    const priority = Array.isArray(o.priority) ? o.priority : PRIORITY;
    const budget = (Number.isInteger(o.budget) && o.budget >= 0) ? o.budget : DEFAULT_BUDGET;
    const src = Array.isArray(o.candidates) ? o.candidates : [];
    const seen = new Set();
    const list = [];
    for (let i = 0; i < src.length; i++) {
      const name = String(src[i]);
      if (seen.has(name)) continue;   // collapse duplicates (a pass named twice still spends at most once)
      seen.add(name);
      list.push({ name, i });
    }
    // sort by priority; stable tiebreak on first-seen index so the output is fully deterministic across engines.
    list.sort((a, b) => (rank(a.name, priority) - rank(b.name, priority)) || (a.i - b.i));
    const ordered = list.map(x => x.name);
    if (budget === 0) return { spend: ordered.slice(), deferred: [], budget: 0, unlimited: true };
    return { spend: ordered.slice(0, budget), deferred: ordered.slice(budget), budget: budget, unlimited: false };
  }

  return { PRIORITY: PRIORITY.slice(), DEFAULT_BUDGET, parseBudget, rank, decide };
});
