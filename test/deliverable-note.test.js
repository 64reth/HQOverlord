/* node test/deliverable-note.test.js — the deliverable_note tool lets an agent NAME its work and nothing else.

   This is the safety story for the whole Deliverables area: the card's prose comes from the model, its pills come
   from the harness, and the only thing standing between those two is this allowlist. So the tests that matter most
   here are the ones proving a model CANNOT smuggle a verdict, a crew, or a byte count into the authored layer. */
'use strict';
const A = require('./_assert.js');
const { makeDeliverableTool, KINDS, _internals } = require('../sidecar/tools/builtin/deliverable.js');

function bag() {
  const m = new Map();
  return { m, set(k, v) { m.set(String(k), v); }, get(k) { return m.get(String(k)) || null; } };
}
const toolFor = notes => makeDeliverableTool({ notes: notes }).deliverableTool;

/* ---- the allowlist is the product ---- */
{
  const note = _internals.noteOf({
    title: 'Q3 churn analysis', summary: 'Three cohorts, one chart.', kind: 'doc', main: 'churn.md',
    status: 'kept', verified: true, complete: true, contributors: ['atlas', 'ghost'], bytes: 99999, files: ['made-up.md']
  });
  A.eq(Object.keys(note).sort(), ['kind', 'main', 'summary', 'title'], 'exactly four keys survive — no status, crew, bytes or file list');
  A.eq(note.status, undefined, 'a model-supplied STATUS is dropped, not honored');
  A.eq(note.contributors, undefined, 'a model-supplied CREW is dropped — attribution is harness truth');
  A.eq(note.bytes, undefined, 'a model-supplied BYTE COUNT is dropped — the host stats the file itself');
}
{
  // the prototype-key trap this repo has been bitten by before
  const note = _internals.noteOf({ title: 'ok', kind: 'constructor' });
  A.eq(note.kind, 'files', 'a prototype key as a kind falls back instead of resolving through Object.prototype');
  A.ok(!KINDS.has('constructor'), 'the kind allowlist is a Set, so it cannot inherit a key');
}

/* ---- bounds and normalization ---- */
{
  A.eq(_internals.noteOf({ title: '  Deep   clean\n\nreport  ' }).title, 'Deep clean report', 'whitespace collapses so a title cannot smuggle layout');
  A.eq(_internals.noteOf({ title: 'x'.repeat(500) }).title.length, 80, 'title is capped');
  A.eq(_internals.noteOf({ title: 'ok', summary: 'y'.repeat(900) }).summary.length, 240, 'summary is capped');
  A.eq(_internals.noteOf({ title: 'ok', kind: 'DOC' }).kind, 'doc', 'kind is case-insensitive');
  A.eq(_internals.noteOf({ title: 'ok', kind: 'nonsense' }).kind, 'files', 'an unknown kind falls back rather than being stored raw');
  A.eq(_internals.noteOf({ title: '   ' }), null, 'a blank title records nothing');
  A.eq(_internals.noteOf(null), null, 'a null arg records nothing');
}

/* ---- the tool itself ---- */
(async () => {
  {
    const notes = bag(), tool = toolFor(notes);
    A.eq(tool.requiresConsent, false, 'naming your own work needs no consent — it has no outward effect');
    // Its own freebie capId — never one of the placed-hardware families (cabinet/dish/notebook/workbench).
    // That is what lets it ride the COMPUTER object in CAP_REGISTRY and so exist on the compute-only interactive
    // office: the surface most likely to write one file and least likely to have gear on the floor. The grant
    // itself is asserted in capgate.test.js; this pins that it never became a hardware-gated tool.
    A.eq(tool.capability, 'deliverable', 'carries its own freebie capability, like quest.update');
    A.ok(['cabinet', 'dish', 'notebook', 'workbench', 'studio'].indexOf(tool.capability) < 0, 'a plain chat run with no gear can still name what it made');
    A.ok(/do not judge it/i.test(tool.description), 'the description asks for a description, never a verdict');

    const out = await tool.run({ title: 'Q3 churn analysis', summary: 'Three cohorts.', kind: 'doc' }, { runId: 'r1' });
    A.eq(notes.get('r1').title, 'Q3 churn analysis', 'the note is filed under the run that made it');
    A.ok(/Recorded for the Deliverables library/.test(out.content), 'the agent is told what was kept');
    A.ok(/status, cost and crew|status, cost/i.test(out.content) || /crew from this run/.test(out.content), 'the agent is told the station supplies the facts');
  }
  {
    const notes = bag(), tool = toolFor(notes);
    const out = await tool.run({ title: 'orphan' }, {});
    A.eq(notes.m.size, 0, 'a note with no run id is filed nowhere rather than guessed at');
    A.ok(/no id/i.test(out.content), 'and the agent is told why');
  }
  {
    const notes = bag(), tool = toolFor(notes);
    await tool.run({ title: 'first' }, { runId: 'r1' });
    await tool.run({ title: 'second', summary: 'revised' }, { runId: 'r1' });
    A.eq(notes.get('r1').title, 'second', 'calling twice in one run replaces rather than duplicating');
  }
  {
    A.throws(() => makeDeliverableTool({}), 'the tool refuses to build without its notes bag');
  }
  A.report('deliverable-note.test');
})();
