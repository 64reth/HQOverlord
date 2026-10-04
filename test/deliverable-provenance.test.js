/* node test/deliverable-provenance.test.js — a deliverable's PROJECT and its CREW are derived from the run log.

   These are the facts the Deliverables card renders as harness truth (pills and chips), as opposed to the agent's
   own title/summary prose. Every assertion here is really the same law: attribution and filing come from what the
   run log can prove, never from what a model said. */
'use strict';
const A = require('./_assert.js');
const { makeProvenanceIndex, PARENT_HOPS_MAX } = require('../sidecar/deliverable-provenance.js');

const run = (o) => Object.assign({ runId: '', parentRunId: '', agentId: 'agent', projectRoot: '', internal: false, streamId: '', identityFallback: false }, o);

/* ---- project ---- */
{
  const ix = makeProvenanceIndex([
    run({ runId: 'lead1', agentId: 'atlas', projectRoot: 'C:\\work\\churn' }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'vessel' }),
    run({ runId: 'solo', agentId: 'pike' })
  ]);
  A.eq(ix.projectOf('lead1'), 'C:\\work\\churn', 'a scoped run reports its own project');
  A.eq(ix.projectOf('w1'), 'C:\\work\\churn', 'a delegated worker INHERITS its lead project (dispatch does not thread it)');
  A.eq(ix.projectOf('solo'), '', 'an unscoped run is unfiled, never guessed');
  A.eq(ix.projectOf('nope'), '', 'a run that aged out of the log is unfiled, never invented');
}

/* a corrupt log must not hang the library */
{
  const ix = makeProvenanceIndex([
    run({ runId: 'a', parentRunId: 'b' }),
    run({ runId: 'b', parentRunId: 'a' })
  ]);
  A.eq(ix.projectOf('a'), '', 'a parent CYCLE terminates instead of spinning');
}
{
  const rows = [];
  for (let i = 0; i <= PARENT_HOPS_MAX + 3; i++) rows.push(run({ runId: 'r' + i, parentRunId: i ? 'r' + (i - 1) : '' }));
  rows[0].projectRoot = '/deep';
  const ix = makeProvenanceIndex(rows);
  A.eq(ix.projectOf('r1'), '/deep', 'a shallow chain still resolves');
  A.eq(ix.projectOf('r' + (PARENT_HOPS_MAX + 3)), '', 'the walk is depth-bounded rather than unbounded');
}

/* ---- contributors ---- */
{
  const ix = makeProvenanceIndex([
    run({ runId: 'lead1', agentId: 'atlas' }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'vessel' }),
    run({ runId: 'w2', parentRunId: 'lead1', agentId: 'pike' }),
    run({ runId: 'w3', parentRunId: 'lead1', agentId: 'vessel' }),
    run({ runId: 'other', agentId: 'ghost' })
  ]);
  const crew = ix.contributorsOf('lead1');
  A.eq(crew.map(c => c.agentId), ['atlas', 'vessel', 'pike'], 'lead first, workers after, deduped by agent');
  A.eq(crew[0].role, 'lead', 'the lead is marked lead');
  A.eq(crew[1].role, 'worker', 'a dispatched sub-run is marked worker');
  A.eq(ix.contributorsOf('w1').map(c => c.agentId), ['vessel'], 'a worker asked about itself is its own lead, and does not borrow its siblings');
  A.eq(ix.contributorsOf('missing'), [], 'an unknown run names nobody rather than fabricating a crew');
}

/* harness self-talk is not a collaborator */
{
  const ix = makeProvenanceIndex([
    run({ runId: 'lead1', agentId: 'atlas' }),
    run({ runId: 'i1', parentRunId: 'lead1', agentId: 'cortex', internal: true }),
    run({ runId: 'i2', parentRunId: 'lead1', agentId: 'summarizer', streamId: 'internal-recap' }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'vessel' })
  ], { isInternal: sid => String(sid || '').indexOf('internal-') === 0 });
  A.eq(ix.contributorsOf('lead1').map(c => c.agentId), ['atlas', 'vessel'], 'internal-flagged and internal-stream runs are excluded from the crew');
}

/* identityFallback rides along: a fallback run was NOT the named specialist, and the card must be able to say so */
{
  const ix = makeProvenanceIndex([
    run({ runId: 'lead1', agentId: 'atlas', identityFallback: true }),
    run({ runId: 'w1', parentRunId: 'lead1', agentId: 'vessel' })
  ]);
  const crew = ix.contributorsOf('lead1');
  A.eq(crew[0].identityFallback, true, 'a fallback lead is marked, never silently presented as the specialist');
  A.eq(crew[1].identityFallback, false, 'a real specialist is not marked');
}

/* a bad log never throws — the library degrades, it does not 500 */
{
  A.notThrows(() => makeProvenanceIndex(null), 'a null run log builds an empty index');
  A.notThrows(() => makeProvenanceIndex([null, undefined, {}, { runId: 'ok' }]), 'garbage rows are skipped');
  const ix = makeProvenanceIndex([{ runId: 'ok' }]);
  A.eq(ix.contributorsOf('ok').map(c => c.agentId), ['agent'], 'a row with no agentId falls back to the station agent');
}

A.report('deliverable-provenance.test');
