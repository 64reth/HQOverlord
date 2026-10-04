/* node test/recipe-drift.test.js — GOLDEN-RUN DRIFT (sidecar/recipe-drift.js, 2026-08-22).
   Proves: insufficient history says so (never a false "steady"); a clean repeat is steady; every named signal fires
   on exactly its condition (check_regressed, verdict_regressed, tool_dropped, tool_new, model_changed, cost_spike);
   a check that was flaky in the baseline does NOT count as regressed; the cost floor keeps pennies quiet; the
   baseline excludes bad runs and is bounded; assessAll groups by recipeId and ignores non-recipe rows. */
'use strict';
const A = require('./_assert.js');
const { assessDrift, assessAll, isGood } = require('../sidecar/recipe-drift.js');

let n = 0;
const run = (o) => Object.assign({
  runId: 'r' + (++n), ts: 1000 + n, recipeId: 'rec', reason: 'done', model: 'm1', usd: 0.02,
  toolTrace: [{ callId: 'c', name: 'fs_read' }, { callId: 'd', name: 'mcp__gmail__send_email' }],
  completionEvidence: { completionVerdict: 'completed_verified', checks: [{ id: 'sop-1', status: 'passed', code: 'artifact_exists' }] }
}, o || {});
const good = (o) => run(o);
const newestFirst = (...rows) => rows.slice().reverse();   // author oldest->newest, pass newest-first

// ---- insufficient ----
A.eq(assessDrift([]).status, 'insufficient', 'no rows -> insufficient');
A.eq(assessDrift(newestFirst(good(), good())).status, 'insufficient', 'one prior good run is not a baseline (MIN 2)');
A.eq(assessDrift(newestFirst(good(), good())).baselineRuns, 1, 'baseline count reported');
A.eq(assessDrift(newestFirst(good(), good(), good())).status, 'steady', 'two prior good runs + a clean latest -> steady');
A.eq(assessDrift(newestFirst(good(), good(), good())).streak, ['pass', 'pass', 'pass'], 'streak newest-first');

// ---- check_regressed ----
{
  const bad = run({ completionEvidence: { completionVerdict: 'incomplete', checks: [{ id: 'sop-1', status: 'failed', code: 'artifact_missing' }] } });
  const d = assessDrift(newestFirst(good(), good(), good(), bad));
  A.eq(d.status, 'drift', 'a regressed check is drift');
  A.ok(d.signals.some(s => s.code === 'check_regressed' && s.check === 'sop-1' && /3\/3 prior runs/.test(s.detail)), 'check_regressed names the check + how often it passed before');
  A.ok(d.signals.some(s => s.code === 'verdict_regressed'), 'and the verdict regressed too');
  A.eq(d.streak[0], 'fail', 'streak shows the failure first');
  // flaky-in-baseline check is NOT a regression
  const flakyBase = run({ completionEvidence: { completionVerdict: 'not_assessed', checks: [{ id: 'sop-1', status: 'failed', code: 'x' }] }, reason: 'done' });
  // (a baseline row with a failed check is not GOOD, so it is excluded from the baseline entirely)
  const d2 = assessDrift(newestFirst(good(), flakyBase, good(), good(), bad));
  A.eq(d2.baselineRuns, 3, 'a prior run with a failed check is excluded from the baseline');
}

// ---- verdict_regressed alone (no contract) ----
{
  const plain = (o) => run(Object.assign({ completionEvidence: { completionVerdict: 'not_assessed', checks: [] } }, o || {}));
  const d = assessDrift(newestFirst(plain(), plain(), plain({ reason: 'error' })));
  A.eq(d.signals.map(s => s.code), ['verdict_regressed'], 'a run that ended in error after clean finishes is verdict_regressed only');
  A.ok(/ended error/.test(d.signals[0].detail), 'detail says how it ended');
  A.ok(!isGood(plain({ reason: 'max_iters' })), 'max_iters is not good');
  A.ok(isGood(plain({ completionEvidence: { completionVerdict: 'verification_required', checks: [] } })), 'verification_required still counts as finished (good)');
}

// ---- tool shape ----
{
  const dropped = run({ toolTrace: [{ callId: 'c', name: 'fs_read' }] });
  const d = assessDrift(newestFirst(good(), good(), dropped));
  A.eq(d.signals.map(s => s.code), ['tool_dropped'], 'dropping a tool every prior run used is drift');
  A.eq(d.signals[0].tool, 'mcp__gmail__send_email', 'names the tool');
  const added = run({ toolTrace: [{ callId: 'c', name: 'fs_read' }, { callId: 'd', name: 'mcp__gmail__send_email' }, { callId: 'e', name: 'shell_exec' }] });
  const d2 = assessDrift(newestFirst(good(), good(), added));
  A.eq(d2.signals.map(s => s.code), ['tool_new'], 'a never-before-used tool is drift');
  // a tool used in SOME baseline runs but not all is neither dropped nor new
  const some = run({ toolTrace: [{ callId: 'c', name: 'fs_read' }, { callId: 'd', name: 'mcp__gmail__send_email' }, { callId: 'e', name: 'web_search' }] });
  const d3 = assessDrift(newestFirst(good(), some, good(), good()));
  A.eq(d3.status, 'steady', 'an optional tool (used in some prior runs) never signals');
}

// ---- model + cost ----
{
  const d = assessDrift(newestFirst(good(), good(), run({ model: 'm2' })));
  A.eq(d.signals.map(s => s.code), ['model_changed'], 'a model nobody used before is drift');
  const spike = assessDrift(newestFirst(good({ usd: 0.04 }), good({ usd: 0.04 }), run({ usd: 0.30 })));
  A.eq(spike.signals.map(s => s.code), ['cost_spike'], '7.5x the median is a cost spike');
  const pennies = assessDrift(newestFirst(good({ usd: 0.004 }), good({ usd: 0.004 }), run({ usd: 0.03 })));
  A.eq(pennies.status, 'steady', 'under the $0.05 floor a 7x ratio never pages');
  const mild = assessDrift(newestFirst(good({ usd: 0.10 }), good({ usd: 0.10 }), run({ usd: 0.20 })));
  A.eq(mild.status, 'steady', '2x is not a spike (threshold 2.5x)');
}

// ---- baseline bound + assessAll ----
{
  const many = []; for (let i = 0; i < 9; i++) many.push(good());
  many.push(good());
  const d = assessDrift(newestFirst(...many));
  A.eq(d.baselineRuns, 5, 'baseline is bounded to the newest 5 good prior runs');
  const all = assessAll(newestFirst(good({ recipeId: 'a' }), good({ recipeId: 'a' }), run({ recipeId: 'a', model: 'zz' }), good({ recipeId: 'b' }), run({ recipeId: '' })));
  A.eq(Object.keys(all).sort(), ['a', 'b'], 'grouped by recipeId; non-recipe rows ignored');
  A.eq(all.a.status, 'drift', 'recipe a drifted (model)');
  A.eq(all.b.status, 'insufficient', 'recipe b has no baseline');
}

A.report('recipe-drift');
