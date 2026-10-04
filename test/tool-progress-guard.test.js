/* node test/tool-progress-guard.test.js - evidence-based successful-tool loop guard.
   The replay fixture is the privacy-scrubbed SHAPE of the 156-call Drive incident: refs and limits change, but
   the agent keeps observing the same document row. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');
const { makeToolProgressGuard, _internals: T } = require('../sidecar/tool-progress-guard.js');
const { makeRunExecutionState } = require('../sidecar/run-execution-state.js');

const call = (name, args, id) => ({ id: id || name, name, args: args || {}, argsRaw: JSON.stringify(args || {}) });
const tool = scope => ({ scope: scope || 'read' });
const ok = (content, summary) => ({ ok: true, isError: false, content, summary: summary || 'ok' });

// Host-generated volatility must not manufacture evidence.
A.eq(T.normalizeEvidence('b12 [button] X ref b9 .output/browser.snapshot-12345678-1234-1234-1234-123456789abc-9.txt'),
  'b<id> [button] X ref b<id> .output/<parked-result>.txt', 'refs and parked receipt ids normalize away');

// Identical successful calls warn, then block BEFORE another paid dispatch.
{
  const g = makeToolProgressGuard({ warnAfter: 2, exactBlockAfter: 4, routeBlockAfter: 20 });
  const c = call('browser.get_text', { selector: 'body' });
  A.eq(g.before(c, tool()).action, 'allow', 'first read admitted');
  A.eq(g.after(c, ok('same page', 'text'), tool()).action, 'allow', 'first read is evidence');
  A.eq(g.after(c, ok('same page', 'text'), tool()).action, 'warn', 'second identical success warns');
  g.after(c, ok('same page', 'text'), tool());
  g.after(c, ok('same page', 'text'), tool());
  const blocked = g.before(c, tool());
  A.eq(blocked.action, 'block', 'fifth identical successful read is blocked before dispatch');
  A.eq(blocked.code, 'repeated_success_no_progress', 'block names successful no-progress repetition');
}

// New evidence resets the old exact-call streak.
{
  const g = makeToolProgressGuard({ warnAfter: 2, exactBlockAfter: 4, routeBlockAfter: 20 });
  const c = call('browser.snapshot', { limit: 20 });
  g.after(c, ok('b1 [button] old'), tool());
  g.after(c, ok('b9 [button] old'), tool()); // same after ref normalization
  g.after(c, ok('b10 [button] new menu'), tool());
  A.eq(g.before(c, tool()).action, 'allow', 'changed page evidence clears the exact-repeat streak');
}

// Replay: changing refs and search limits cannot disguise one unchanged Drive state forever.
{
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'drive-docx-no-progress.json'), 'utf8'));
  const g = makeToolProgressGuard({ warnAfter: 3, exactBlockAfter: 8, routeBlockAfter: 6 });
  let warning = null;
  for (const [i, row] of fixture.calls.entries()) {
    const c = call(row.name, row.args, 'r' + i);
    const gate = g.before(c, tool('read'));
    if (gate.action === 'block') break;
    const decision = g.after(c, ok(row.content, row.summary), tool('read'));
    if (decision.action === 'warn') warning = warning || decision;
  }
  A.ok(warning && /change strategy|Re-plan/.test(warning.message), 'replay receives a fixed strategy-change warning');
  const finalProbe = g.before(call('browser.get_text', { selector: 'body' }, 'final'), tool('read'));
  A.eq(finalProbe.action, 'block', 'privacy-scrubbed Drive churn reaches the route circuit breaker');
  A.eq(finalProbe.code, 'strategy_route_exhausted', 'varied calls are blocked as one exhausted route');
  A.ok(!/Latest Resume|Drive/.test(finalProbe.message), 'guard guidance contains no page-authored text');
  // Escape routes remain available: the task is replanned, not killed.
  A.eq(g.before(call('fs.read', { path: 'downloads/resume.docx' }), tool('read')).action, 'allow', 'local document read remains available');
  A.eq(g.before(call('browser.navigate', { url: 'https://drive.example/download' }), tool('execute')).action, 'allow', 'state-changing browser route remains available');
}

// The run-state seam exposes one controller to nested and ordinary dispatch paths. code.run itself is not
// counted: its nested dispatches already cross this seam, and the composition may legitimately mutate state.
{
  const state = makeRunExecutionState({ progressLimits: { warnAfter: 2, exactBlockAfter: 3, routeBlockAfter: 10 } });
  const outer = call('code.run', { code: 'return tool("browser_get_text",{})' });
  for (let i = 0; i < 10; i++) state.observeProgress(outer, ok('same composed observation'), tool('read'));
  A.eq(state.beforeProgress(outer, tool('read')).action, 'allow', 'outer code.run remains available without double-counting nested reads');
  const c = call('browser.get_text', { selector: 'body' });
  state.observeProgress(c, ok('same nested observation'), tool('read'));
  const warning = state.observeProgress(c, ok('same nested observation'), tool('read'));
  A.eq(warning.action, 'warn', 'composed read participates in the same evidence ledger');
  state.observeProgress(c, ok('same nested observation'), tool('read'));
  A.eq(state.beforeProgress(c, tool('read')).action, 'block', 'composed read is blocked before another dispatch');
}

// State-changing browser calls remain capabilities even when their generic receipts are identical.
{
  const g = makeToolProgressGuard({ warnAfter: 2, exactBlockAfter: 3, routeBlockAfter: 4 });
  const c = call('browser.click', { ref: 'b7' });
  for (let i = 0; i < 20; i++) {
    A.eq(g.before(c, tool('execute')).action, 'allow', 'repeated browser actions are never suppressed');
    g.after(c, ok('clicked', 'clicked'), tool('execute'));
  }
}

// Untracked workspace mutations are never inferred safe or blocked from result text.
{
  const g = makeToolProgressGuard({ warnAfter: 1, exactBlockAfter: 2, routeBlockAfter: 2 });
  const c = call('fs.write', { path: 'x', content: 'x' });
  for (let i = 0; i < 10; i++) g.after(c, ok('wrote'), tool('write'));
  A.eq(g.before(c, tool('write')).action, 'allow', 'guard does not police unknown mutation semantics');
}

A.report('tool-progress-guard.test');
