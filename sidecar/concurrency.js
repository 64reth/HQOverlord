/* sidecar/concurrency.js — the admission gate that bounds how many DISTINCT agents may have paid
   runs in flight at once. Multi-agent's one genuinely new runaway-cost hole: N summoned agents each
   burning tokens concurrently. The cross-run budget pools (budget.js) already cap aggregate $ — this
   caps the FAN-OUT, so a Commander who summons a crew can't accidentally light up ten parallel loops.

   Gate semantics (load-bearing): the cap is on the number of distinct agentIds with ≥1 in-flight run,
   NOT on total runs. A second run of an ALREADY-admitted agent is always allowed (it consumes no new
   slot) — so a single agent's own back-to-back/queued work never self-blocks. Only a NEW agent that
   would push the distinct-agent count over `max` is refused.

   makeConcurrencyGate({ max }) -> {
     tryEnter(agentId) -> boolean,   // refcount++ for agentId; false ONLY if a NEW agent exceeds max
     leave(agentId),                 // refcount--; drops the agent's slot at zero
     active() -> int,                // distinct agents currently in flight
     inFlight(agentId) -> int,       // this agent's in-flight run count
     max() -> int                    // 0 = unlimited
   }
   PURE/stateful-local: no clock, no IO, no emit. The host pairs tryEnter (admission) with leave (in a
   finally) so a slot is always released, even on an early-return or a throw. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).concurrency = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeConcurrencyGate(opts) {
    opts = opts || {};
    // 0 / Infinity / absent / non-positive = UNLIMITED (mirrors budget.js capOf: a missing cap never governs).
    const max = (typeof opts.max === 'number' && isFinite(opts.max) && opts.max > 0) ? Math.floor(opts.max) : 0;
    const counts = new Map();   // agentId -> in-flight run count (the slot is the KEY, not the count)

    function tryEnter(agentId) {
      agentId = String(agentId == null ? '' : agentId);
      if (counts.has(agentId)) { counts.set(agentId, counts.get(agentId) + 1); return true; }  // already admitted → no new slot
      if (max && counts.size >= max) return false;                                              // a NEW distinct agent over the cap
      counts.set(agentId, 1);
      return true;
    }

    function leave(agentId) {
      agentId = String(agentId == null ? '' : agentId);
      const n = counts.get(agentId);
      if (n == null) return;                       // unbalanced leave (e.g. a refused run) is a harmless no-op
      if (n <= 1) counts.delete(agentId); else counts.set(agentId, n - 1);
    }

    function active() { return counts.size; }
    function inFlight(agentId) { return counts.get(String(agentId == null ? '' : agentId)) || 0; }

    return { tryEnter, leave, active, inFlight, max() { return max; } };
  }

  return { makeConcurrencyGate };
});
