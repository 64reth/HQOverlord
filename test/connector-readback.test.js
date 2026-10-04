/* node test/connector-readback.test.js — the typed CONNECTOR READ-BACK postcondition (2026-08-22).
   Proves: contract rules (slugs, args bound, contains|regex required, regex must compile); the run must have ACTED
   on that connector (a pre-existing external state is not proof); the proof is a FRESH host read-back (never the
   model's observation); a read error / unavailable reader / non-read tool fail closed with named codes; a matched
   read-back SETTLES that connector's effects so an external-write workflow can reach completed_verified; and the
   memoized second pass never re-reads. */
'use strict';
const A = require('./_assert.js');
const { normalizeContract, assessPostconditions } = require('../sidecar/task-postconditions.js');
const { makeCompletionEvidence } = require('../sidecar/completion-evidence.js');

// ---- contract rules ----
{
  const ok = normalizeContract({ requirements: [{ id: 'rb', type: 'connector_readback', connector: 'gmail', tool: 'search_messages', args: { q: 'subject:Invoice 42' }, contains: 'Invoice 42' }] });
  A.eq(ok.errors, [], 'a well-formed read-back row is accepted');
  A.eq(ok.contract.requirements[0], { id: 'rb', type: 'connector_readback', connector: 'gmail', tool: 'search_messages', args: { q: 'subject:Invoice 42' }, contains: 'Invoice 42' }, 'row is carried verbatim (args deep-copied)');
  const bad = (row) => normalizeContract({ requirements: [Object.assign({ id: 'x', type: 'connector_readback' }, row)] }).errors[0] || '';
  A.ok(/connector id/.test(bad({ tool: 't', contains: 'a' })), 'connector required');
  A.ok(/connector id/.test(bad({ connector: 'bad id!', tool: 't', contains: 'a' })), 'connector must be a slug');
  A.ok(/tool name/.test(bad({ connector: 'c', contains: 'a' })), 'tool required');
  A.ok(/contains or regex/.test(bad({ connector: 'c', tool: 't' })), 'an expectation is required');
  A.ok(/does not compile/.test(bad({ connector: 'c', tool: 't', regex: '(' })), 'a broken regex is refused');
  A.ok(/args must be an object/.test(bad({ connector: 'c', tool: 't', contains: 'a', args: [1] })), 'array args refused');
  A.ok(/exceed 2000/.test(bad({ connector: 'c', tool: 't', contains: 'a', args: { big: 'x'.repeat(2100) } })), 'args are bounded');
}

const contract = { requirements: [{ id: 'rb', type: 'connector_readback', connector: 'gmail', tool: 'search_messages', args: { q: 'Invoice 42' }, contains: 'Invoice 42' }] };
const sentEffect = { callId: 'c1', tool: 'mcp__gmail__send_email', domain: 'external', connector: 'gmail', target: '', state: 'judgment_required', evidence: [] };

(async () => {
  // ---- acted-on rule ----
  {
    let reads = 0;
    const r = await assessPostconditions({ contract, reason: 'done', artifacts: [], evidence: [], effects: [], readConnector: async () => { reads++; return { ok: true, text: 'Invoice 42' }; } });
    A.eq(r.checks[0].code, 'connector_not_acted_on_by_run', 'a run that never touched the connector cannot pass by pre-existing state');
    A.eq(reads, 0, 'and the host never even reads');
    A.eq(r.completionVerdict, 'incomplete', 'verdict incomplete');
  }
  // ---- fresh read-back is the proof; failure codes are named ----
  {
    const none = await assessPostconditions({ contract, reason: 'done', effects: [sentEffect], evidence: [] });
    A.eq(none.checks[0].code, 'connector_reader_unavailable', 'no host reader -> named failure');
    const err = await assessPostconditions({ contract, reason: 'done', effects: [sentEffect], evidence: [], readConnector: async () => { throw new Error('socket hang up'); } });
    A.eq(err.checks[0].code, 'connector_readback_error', 'a thrown read is a named failure, never a pass');
    const notRead = await assessPostconditions({ contract, reason: 'done', effects: [sentEffect], evidence: [], readConnector: async () => ({ ok: false, code: 'connector_tool_not_readonly' }) });
    A.eq(notRead.checks[0].code, 'connector_tool_not_readonly', 'the host refusing a non-read tool surfaces its own code');
    const miss = await assessPostconditions({ contract, reason: 'done', effects: [sentEffect], evidence: [], readConnector: async () => ({ ok: true, text: 'no such message' }) });
    A.eq(miss.checks[0].code, 'connector_readback_mismatch', 'a read that does not contain the text fails');
    const hit = await assessPostconditions({ contract, reason: 'done', effects: [sentEffect], evidence: [], readConnector: async (req) => ({ ok: true, text: 'Results: ' + req.args.q + ' (1 message)' }) });
    A.eq(hit.checks[0].code, 'connector_readback_matched', 'a fresh read containing the text passes');
    A.eq(hit.checks[0].status, 'passed', 'status passed');
    const rx = await assessPostconditions({ contract: { requirements: [{ id: 'rx', type: 'connector_readback', connector: 'sheets', tool: 'get_values', regex: '^acme,\\d+' }] }, reason: 'done', effects: [{ domain: 'external', connector: 'sheets', state: 'judgment_required', evidence: [] }], evidence: [], readConnector: async () => ({ ok: true, text: 'acme,1200' }) });
    A.eq(rx.checks[0].status, 'passed', 'regex expectation works');
  }
  // ---- settlement: through completion-evidence, a matched read-back upgrades the connector's effects ----
  {
    const ce = makeCompletionEvidence({ authority: 'commander' });
    ce.observe({ name: 'mcp__gmail__send_email', callId: 'c1', args: { to: 'ops@x.com' }, result: { ok: true, isError: false, summary: 'sent' } });
    A.eq(ce.snapshot().effectVerdict, 'judgment_required', 'before: an external write is judgment_required');
    let reads = 0;
    const snap = await ce.assess({ contract, reason: 'done', artifacts: [], readConnector: async () => { reads++; return { ok: true, text: 'Invoice 42 delivered' }; } });
    A.eq(snap.checks[0].status, 'passed', 'the check passed');
    A.eq(snap.effectVerdict, 'mechanically_verified', 'after: the typed read-back SETTLED the connector effect');
    A.eq(snap.effects[0].state, 'mechanically_verified', 'the effect row itself is settled');
    A.ok(snap.evidence.some(e => e.kind === 'typed_connector_readback' && e.strength === 'mechanical'), 'a mechanical evidence row records the read-back');
    A.eq(snap.completionVerdict, 'completed_verified', 'an external-write workflow can now reach completed_verified');
    A.eq(reads, 1, 'the second (recompute) pass did NOT re-read the connector');
    // a mismatch settles nothing
    const ce2 = makeCompletionEvidence({ authority: 'commander' });
    ce2.observe({ name: 'mcp__gmail__send_email', callId: 'c1', args: {}, result: { ok: true, isError: false, summary: 'sent' } });
    const snap2 = await ce2.assess({ contract, reason: 'done', artifacts: [], readConnector: async () => ({ ok: true, text: 'nothing here' }) });
    A.eq(snap2.effectVerdict, 'judgment_required', 'a mismatched read-back leaves the effect unsettled');
    A.eq(snap2.completionVerdict, 'incomplete', 'and the run is incomplete');
  }
  A.report('connector-readback');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
