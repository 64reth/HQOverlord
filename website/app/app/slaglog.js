/* STARNET — slaglog.js : the SLAG post-mortem — wasted-spend, turned into a lesson.

   The standout teaching mechanic of the floor economy. Every run that burns real dollars
   without producing a deliverable (agent.run.end reason ∈ max_iters | budget | error |
   refusal) is diagnosed into a plain-English { title, cause, fix } pointing at a REAL,
   actionable cause — so the factory "optimise the line" instinct gets aimed at the genuinely
   valuable skill: operating real agents cheaply and well. (You don't get punished for the
   waste; you get told why it happened and what to change.)

   Pure heuristic over the signals already on the bus — the run's end reason, its turn count
   (agent.run.end.turns), and the most recent reconciled cache ratio (agent.cost.cachedTokens
   / tokensIn, the prompt-cache "smelter" temperature). No fabricated specifics: when a signal
   is unknown the wording stays general rather than inventing a number.

   Dependency-free + deterministic (no DOM / time / rng): a `SlagLog` global in the browser,
   module.exports under node — unit-testable headless like floorstats.js / ctxgauge.js. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SlagLog = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COLD_CACHE = 0.15;   // below this the prompt-cache is basically cold (the smelter is dark)

  function clampFrac(n) { n = Number(n); if (!isFinite(n) || n < 0) return 0; return n > 1 ? 1 : n; }

  // reason + run signals -> a real, fixable post-mortem. ctx = { cacheFrac, turns, usd }, all optional.
  function diagnose(reason, ctx) {
    ctx = ctx || {};
    const turns = Math.max(0, ctx.turns | 0);
    const cacheKnown = ctx.cacheFrac != null && isFinite(Number(ctx.cacheFrac));
    const cachePct = Math.round(clampFrac(ctx.cacheFrac) * 100);
    switch (reason) {
      case 'max_iters':
        return { reason, title: 'looped without finishing',
          cause: 'The agent ran ' + (turns ? 'all ' + turns + ' turns' : 'its full iteration budget') + ' but never closed out the task.',
          fix: 'Tighten the ask, or give its bay the tool it kept reaching for — a cabinet for files, a console for compute.' };
      case 'budget':
        if (cacheKnown && Number(ctx.cacheFrac) < COLD_CACHE)
          return { reason, title: 'budget cap on a cold cache',
            cause: 'The run hit its cap with the prompt-cache cold (' + cachePct + '%), so repeated input could not reuse much cache.',
            fix: 'Keep the system prompt + memory fence STABLE so repeated input can reuse cache.' };
        return { reason, title: 'hit the budget cap',
          cause: 'The run reached its envelope before it delivered.',
          fix: 'Raise the budget for this kind of order, or split it into smaller work-items.' };
      case 'error':
        return { reason, title: 'errored out',
          cause: 'The run failed partway, so no useful work was produced.',
          fix: 'Check the agent log for the failing tool or step, then fix the cause before re-running.' };
      case 'refusal':
        return { reason, title: 'the model refused',
          cause: 'The model declined the task, so no work was produced.',
          fix: 'Rephrase the request, or route this lane to an agent equipped for it.' };
      default:
        return { reason: reason || 'unknown', title: 'unproductive run',
          cause: 'A run ended without a deliverable.',
          fix: 'Review the run and adjust the task or the bay.' };
    }
  }

  // a single-line summary for a notification/HUD line: "looped without finishing — Tighten the ask…"
  function line(diag) {
    if (!diag) return '';
    return diag.title + ' — ' + diag.fix;
  }

  // a small ring of the most-recent post-mortems (for a reviewable SLAG LOG surface).
  function create(cap) {
    cap = cap > 0 ? (cap | 0) : 20;
    let recent = [];
    function record(reason, ctx) {
      const d = diagnose(reason, ctx);
      recent.push(d);
      if (recent.length > cap) recent = recent.slice(-cap);
      return d;
    }
    function reset() { recent = []; }
    return { record, recent: () => recent.slice(), reset };
  }

  return { diagnose, line, create, COLD_CACHE };
});
