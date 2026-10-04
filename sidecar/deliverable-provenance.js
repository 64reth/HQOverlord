/* sidecar/deliverable-provenance.js — WHO made a deliverable, and WHAT it belongs to.

   Both answers are DERIVED from the append-only run log, never stored on the deliverable and never authored by a
   model. That split is the whole point: a card's prose (title/summary) comes from the agent, but its attribution
   and its project come from harness truth, so the card can never claim a collaborator or a folder the run log
   can't back.

   Two derivations, one index:

   - projectOf(runId)      -> the blessed project folder the work was scoped to, or '' when unscoped. A DELEGATED
                              worker carries no projectRoot of its own (team.dispatch threads parentRunId, not the
                              project), so this walks up the parent chain to the lead rather than filing a worker's
                              output as unscoped. The walk is depth-bounded: a corrupt log with a parent cycle must
                              not hang the library.
   - contributorsOf(runId) -> [{ agentId, role:'lead'|'worker', identityFallback }] — the lead run plus every
                              non-internal child run that named a different agent. Deduped by agentId (three
                              dispatches to the same specialist is one contributor), lead always first.
                              `identityFallback` rides along because a run that fell back to the station persona
                              was NOT the named specialist — the UI has to be able to say so.

   PURE: given rows in, answers out. No ambient IO/time, so it unit-tests headlessly. `isInternal` is injected
   because "which streams are internal harness self-talk" is the caller's knowledge (contextpack), not ours. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).deliverableProvenance = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PARENT_HOPS_MAX = 8;      // a lead->worker chain is 1 deep in practice; this only bounds a corrupt log
  const CONTRIBUTORS_MAX = 12;    // a card names a crew, not a phone book

  function str(v) { return v == null ? '' : String(v); }

  // A run row is "hidden work" when the harness marked it internal, or when the caller's stream classifier says
  // its stream is harness self-talk. Neither is a contributor to a deliverable the Commander asked for.
  function hidden(row, isInternal) {
    if (!row) return true;
    if (row.internal) return true;
    try { return !!(isInternal && isInternal(row.streamId)); } catch (_) { return false; }
  }

  function makeProvenanceIndex(rows, opts) {
    opts = opts || {};
    const isInternal = typeof opts.isInternal === 'function' ? opts.isInternal : null;
    const byId = new Map();
    const kids = new Map();
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (!r || !r.runId) continue;
      byId.set(str(r.runId), r);
      const parent = str(r.parentRunId);
      if (!parent) continue;
      const list = kids.get(parent) || [];
      list.push(r);
      kids.set(parent, list);
    }

    function projectOf(runId) {
      let cur = byId.get(str(runId));
      const seen = new Set();
      for (let hop = 0; cur && hop < PARENT_HOPS_MAX; hop++) {
        const project = str(cur.projectRoot);
        if (project) return project;
        const parent = str(cur.parentRunId);
        if (!parent || seen.has(parent)) break;   // no parent, or a cycle — stop rather than spin
        seen.add(parent);
        cur = byId.get(parent);
      }
      return '';
    }

    function contributorsOf(runId) {
      const lead = byId.get(str(runId));
      if (!lead) return [];
      const leadId = str(lead.agentId) || 'agent';
      const out = [{ agentId: leadId, role: 'lead', identityFallback: !!lead.identityFallback }];
      const seen = new Set([leadId]);
      for (const child of (kids.get(str(runId)) || [])) {
        if (out.length >= CONTRIBUTORS_MAX) break;
        if (hidden(child, isInternal)) continue;
        const id = str(child.agentId) || 'agent';
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ agentId: id, role: 'worker', identityFallback: !!child.identityFallback });
      }
      return out;
    }

    /* What a card needs ABOUT THE WORK — and deliberately nothing about the machinery.
       An earlier draft returned model, cost, tokens, turns, tool counts and duration. Andrew cut all of it:
       a person opening this area wants to know what they asked for, what came back, and what they can open —
       run metrics are the LOGBOOK's job, and repeating them here bought confusion, not detail. So this returns
       exactly two things, both of which are about the OUTPUT: the agent's closing message, and the session it
       belongs to (so the card can offer to open the full conversation). Read straight off the durable run row. */
    function factsOf(runId) {
      const row = byId.get(str(runId));
      if (!row) return null;
      return {
        streamId: str(row.streamId),           // lets a card offer "open the session this came from"
        // the agent's closing message for this run — real recorded output, not a summary anyone generated
        deliveryText: str(row.deliveryText)
      };
    }

    return { projectOf, contributorsOf, factsOf };
  }

  return { makeProvenanceIndex, PARENT_HOPS_MAX, CONTRIBUTORS_MAX };
});
