'use strict';
const A = require('./_assert.js');
const E = require('../sidecar/recommendation-eval.js');

const sim = E.simulateArc();
A.eq(sim.history.entries.length, 24, 'eight-week simulation preserves every candidate impression and outcome');
A.ok(sim.model.kinds.automation.weight > sim.model.kinds.research.weight, 'recent automation preference overtakes the earlier research preference');
A.ok(sim.metrics.precisionAt3 != null, 'ranked slates produce precision-at-three');
A.ok(sim.metrics.calibrationBrier != null, 'outcome-labelled predictions produce calibration error');
A.eq(sim.metrics.surfaces.simulation.shown, 24, 'surface scorecard covers the simulated history');

const perfect = E.evaluate({ entries: [
  { id: 'a', surface: 'recipe', kind: 'recipe', title: 'A', contextId: 'x', rank: 1, scoreComponents: { success: 0.9 }, state: 'completed', outcome: { adopted: true, quality: 1 } },
  { id: 'b', surface: 'recipe', kind: 'recipe', title: 'B', contextId: 'x', rank: 2, scoreComponents: { success: 0.1 }, state: 'declined', reason: 'wrong_thing' }
] });
A.eq(perfect.counterfactualRegret, 0, 'top-ranked adopted recommendation has zero regret');
A.eq(perfect.precisionAt3, 0.5, 'precision uses proven outcomes in the top-three slate');
A.ok(perfect.calibrationBrier < 0.02, 'well-calibrated predictions receive low Brier error');
const one = E.evaluate({ entries: [{ id: 'one', surface: 'quest', title: 'Only sample', state: 'completed' }] });
A.eq(one.temporal.improvement, null, 'a one-sample history reports insufficient temporal data instead of a fake decline');
const separation = E.evaluate({ entries: [
  { id: 'done', title: 'Executed without feedback', state: 'completed' },
  { id: 'bad', title: 'Executed but unwanted', state: 'completed', outcome: { adopted: false, quality: -1 } },
  { id: 'liked', title: 'Liked but not adopted', state: 'completed', outcome: { quality: 1 } }
] });
A.eq(separation.completionRate, 1, 'all execution completions remain measured');
A.eq(separation.adoptionRate, 0, 'neither execution nor satisfaction fabricates adoption');
A.eq(separation.satisfactionRate, 0.3333, 'satisfaction is distinct from adoption');
A.report('recommendation-eval.test');
