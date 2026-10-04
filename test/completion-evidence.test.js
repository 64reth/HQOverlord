'use strict';
const A = require('./_assert.js');
const { makeCompletionEvidence } = require('../sidecar/completion-evidence.js');

function success(summary, extra) { return Object.assign({ ok: true, isError: false, summary: summary || 'ok' }, extra || {}); }

// Exact fs read-back proves only the written effect. It never promotes itself into whole-task completion.
{
  const e = makeCompletionEvidence();
  e.observe({ callId: 'w1', name: 'fs.write', scope: 'write', args: { path: 'src/a.js', content: 'secret body is never persisted here' }, result: success('saved', { mutationReceipt: { state: 'read-back-verified' } }) });
  const s = e.snapshot();
  A.eq(s.effectVerdict, 'mechanically_verified', 'read-back receipt mechanically verifies the exact write effect');
  A.eq(s.completionVerdict, 'not_assessed', 'effect evidence never guesses whole-task completion');
  A.eq(s.effects[0].target, 'src/a.js', 'bounded target identity is retained');
  A.ok(JSON.stringify(s).indexOf('secret body') < 0, 'tool content is never copied into completion telemetry');
}

// Code mutation without a check is unverified; a typed verify.run PASS covers prior workspace effects. A
// transport-successful verify.run whose own verdict is FAILED does not count.
{
  const e = makeCompletionEvidence();
  e.observe({ callId: 'w1', name: 'fs.edit', scope: 'write', args: { path: 'src/a.js' }, result: success('edited') });
  A.eq(e.snapshot().effectVerdict, 'unverified_effects', 'successful mutation is not verification');
  e.observe({ callId: 'v1', name: 'verify.run', scope: 'execute', args: { cmd: 'npm test' }, result: success('verify FAILED (10ms)') });
  A.eq(e.snapshot().effectVerdict, 'unverified_effects', 'failed check cannot clear an obligation');
  e.observe({ callId: 'v2', name: 'verify.run', scope: 'execute', args: { cmd: 'npm test' }, result: success('verify passed (12ms)') });
  A.eq(e.snapshot().effectVerdict, 'mechanically_verified', 'typed passing check covers preceding workspace effects');
  A.eq(e.snapshot().completionVerdict, 'not_assessed', 'passing tests still do not prove every requested outcome');
}

// Browser and external read-backs are retained, but semantic matching remains a judgment call.
{
  const e = makeCompletionEvidence();
  e.observe({ callId: 'b1', name: 'browser.click', scope: 'write', args: { target: '#save' }, result: success('clicked') });
  e.observe({ callId: 'b2', name: 'browser.snapshot', scope: 'read', args: {}, result: success('snapshot') });
  let s = e.snapshot();
  A.eq(s.effectVerdict, 'judgment_required', 'browser observation does not become a boolean postcondition');
  A.ok(s.effects[0].evidence.length === 1, 'later browser observation is linked as candidate evidence');
  A.eq(s.completionVerdict, 'not_assessed', 'requested browser state remains unassessed');

  const x = makeCompletionEvidence();
  x.observe({ callId: 'x1', name: 'mcp__notion__update_page', scope: 'write', args: { pageId: 'p1' }, result: success('updated') });
  x.observe({ callId: 'x2', name: 'mcp__notion__get_page', scope: 'read', args: { pageId: 'p1' }, result: success('read') });
  s = x.snapshot();
  A.eq(s.effectVerdict, 'judgment_required', 'connector read-back also requires semantic judgment');
  A.ok(s.effects[0].evidence.length === 1, 'same-connector observation is linked to its effect');
  x.observe({ callId: 'x3', name: 'mcp__custom_server__frobnicate', scope: 'read', args: {}, result: success('server claimed read') });
  A.ok(x.snapshot().effects.some(row => row.callId === 'x3'), 'unknown connector verb stays an effect despite untrusted read-only scope');
}

// Failed calls prove no effect; read-only work with no mutation makes no completion claim.
{
  const e = makeCompletionEvidence();
  e.observe({ callId: 'bad', name: 'fs.write', scope: 'write', args: { path: 'x' }, result: { ok: false, isError: true } });
  e.observe({ callId: 'r1', name: 'fs.read', scope: 'read', args: { path: 'x' }, result: success('read') });
  const s = e.snapshot();
  A.eq(s.effectVerdict, 'no_observed_effects', 'failed mutations do not fabricate effects');
  A.eq(s.effects, [], 'read-only work creates no effect obligation');
}

A.report('completion-evidence.test');
