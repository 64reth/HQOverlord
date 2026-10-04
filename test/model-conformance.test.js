/* node test/model-conformance.test.js — the pure core of the per-model conformance smoke
   (scripts/qa/model-conformance.mjs, model-consistency lane 2026-07-17). Proves tallyRun folds a bus
   stream correctly and scoreCard classifies the known model-quirk signatures: clean GPT-style run =
   all PASS; text-rescued calls = WARN tool.wire; repaired JSON = WARN args.clean; no usage = FAIL
   cost.reported; a consent prompt on the read-only probe = FAIL no.consent.stall; a non-'done' end =
   FAIL run.completes. No sidecar, no network, no spend. */
'use strict';
const A = require('./_assert.js');

(async () => {
  const { tallyRun, scoreCard, CHECKS } = await import('../scripts/qa/model-conformance.mjs');

  const ev = (name, payload, at) => ({ name, payload, at: at == null ? 10 : at });
  const cleanToolRun = [
    ev('agent.run.start', { agentId: 'a', runId: 'r', trigger: 'directive', model: 'm' }),
    ev('agent.token', { agentId: 'a', runId: 'r', delta: 'ok' }, 420),
    ev('agent.tool_call', { agentId: 'a', runId: 'r', callId: 'call_0', name: 'fs.list', argsSummary: '{}' }),
    ev('agent.tool_result', { agentId: 'a', runId: 'r', callId: 'call_0', ok: true, ms: 5, summary: 'ok', isError: false }),
    ev('agent.cost', { agentId: 'a', runId: 'r', usd: 0.001, tokensIn: 100, tokensOut: 20, reconciled: true, model: 'm' }),
    ev('agent.run.end', { agentId: 'a', runId: 'r', reason: 'done', turns: 2, usd: 0.001 })
  ];
  const cleanChatRun = [
    ev('agent.token', { agentId: 'a', runId: 'r2', delta: 'PONG' }, 300),
    ev('agent.cost', { agentId: 'a', runId: 'r2', usd: 0.0002, tokensIn: 20, tokensOut: 3, reconciled: true, model: 'm' }),
    ev('agent.run.end', { agentId: 'a', runId: 'r2', reason: 'done', turns: 1, usd: 0.0002 })
  ];

  // ---- tallyRun folds the stream ----
  {
    const t = tallyRun(cleanToolRun);
    A.eq(t.end.reason, 'done', 'end captured');
    A.eq(t.toolCalls.length, 1, 'tool call captured');
    A.eq(t.toolResults.filter(r => r.ok).length, 1, 'ok result captured');
    A.ok(t.costOk && t.tokens === 120, 'reconciled usage captured');
    A.eq(t.firstTokenAt, 420, 'first-token latency from the first non-empty delta');
  }

  // ---- clean run: every check PASS ----
  {
    const card = scoreCard(tallyRun(cleanToolRun), tallyRun(cleanChatRun));
    A.eq(card.fail, 0, 'clean run has no FAIL');
    A.eq(card.warn, 0, 'clean run has no WARN');
    for (const k of CHECKS) A.eq(card.checks[k].status, 'PASS', k + ' is PASS on a clean run');
  }

  // ---- quirk signatures classify as designed ----
  {
    // tool-call markup streamed as text -> WARN tool.wire (scrubbed + nudged, never executed)
    const withMarkup = cleanToolRun.concat([ev('agent.token', { agentId: 'a', runId: 'r', delta: '<tool_call>{"name":"fs.list"}</tool_call>' }, 500)]);
    const c1 = scoreCard(tallyRun(withMarkup), tallyRun(cleanChatRun));
    A.eq(c1.checks['tool.wire'].status, 'WARN', 'markup in stream -> WARN tool.wire');
    A.eq(c1.fail, 0, 'markup is a WARN, not a FAIL');

    // repaired argument JSON -> WARN args.clean
    const c2 = scoreCard(tallyRun(cleanToolRun.concat([ev('tool.args.repaired', { agentId: 'a', runId: 'r', callId: 'call_0', name: 'fs.list', before: '{', after: '{}' })])), tallyRun(cleanChatRun));
    A.eq(c2.checks['args.clean'].status, 'WARN', 'repair event -> WARN args.clean');

    // no reconciled usage -> FAIL cost.reported (cost/compaction blind)
    const noUsage = cleanToolRun.filter(e => e.name !== 'agent.cost');
    const c3 = scoreCard(tallyRun(noUsage), tallyRun(cleanChatRun));
    A.eq(c3.checks['cost.reported'].status, 'FAIL', 'missing usage -> FAIL cost.reported');

    // consent prompt on the read-only probe -> FAIL no.consent.stall
    const c4 = scoreCard(tallyRun(cleanToolRun.concat([ev('permission.prompt', { promptId: 'p1' })])), tallyRun(cleanChatRun));
    A.eq(c4.checks['no.consent.stall'].status, 'FAIL', 'consent prompt -> FAIL no.consent.stall');

    // a non-'done' ending -> FAIL run.completes
    const errEnd = cleanToolRun.map(e => e.name === 'agent.run.end' ? ev(e.name, Object.assign({}, e.payload, { reason: 'error' })) : e);
    const c5 = scoreCard(tallyRun(errEnd), tallyRun(cleanChatRun));
    A.eq(c5.checks['run.completes'].status, 'FAIL', 'error end -> FAIL run.completes');

    // provider failover mid-run -> WARN no.fallback
    const c6 = scoreCard(tallyRun(cleanToolRun.concat([ev('provider.fallback', { fromModel: 'm', toModel: 'n', reason: 'overloaded' })])), tallyRun(cleanChatRun));
    A.eq(c6.checks['no.fallback'].status, 'WARN', 'failover -> WARN no.fallback');
  }

  console.log('model-conformance.test: OK');
  // report() settles the assertion counter — the .catch below only fires on a THROWN error, so
  // without this a failed assertion still exits 0 and the gate scores it green.
  A.report('model-conformance.test');
})().catch(e => { console.error(e); process.exit(1); });
