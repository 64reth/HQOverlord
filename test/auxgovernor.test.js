/* node test/auxgovernor.test.js — the PURE aux-spend governor (aux-budget lane).

   Proves the JOINT-ceiling decision the post-run seam relies on: the LOCKED beat priority
   (reflection > study > threadmine > scout > skill-review > skill-curator) wins scarce slots;
   the budget cap is honored; 0 = unlimited (governor off); zero candidates → nothing spends;
   dups collapse; unknown passes deprioritize but stay eligible (never silently dropped);
   SKYNET_AUX_BUDGET parsing is fail-safe (garbage/negative/blank → default, never unlimited);
   and the whole thing is DETERMINISTIC (same inputs → identical output, no clock/rng). The
   run-end BOUND itself is proven live in test/auxbudget.e2e.test.js — this file proves the math. */
'use strict';
const A = require('./_assert.js');
const G = require('../sidecar/auxgovernor.js');

(async () => {
  // ---- the locked priority + default budget are what we expect ----
  A.eq(G.PRIORITY, ['reflection', 'failure-review', 'study', 'threadmine', 'scout', 'skill-review', 'skill-curator'], 'locked beat priority (failure-review directly after reflection)');
  A.eq(G.DEFAULT_BUDGET, 2, 'default budget is 2 (never 0)');
  A.eq(G.PRIORITY.length, 7, 'exactly the seven aux passes');

  // ---- budget CAP + PRIORITY order: the top-`budget` passes by priority spend, the rest defer ----
  {
    // deliberately out of priority order on input — the governor must re-sort.
    const p = G.decide({ candidates: ['skill-curator', 'scout', 'reflection', 'study', 'skill-review', 'threadmine'], budget: 2 });
    A.eq(p.spend, ['reflection', 'study'], 'budget 2 grants the two highest-priority passes');
    A.eq(p.deferred, ['threadmine', 'scout', 'skill-review', 'skill-curator'], 'the rest defer in priority order');
    A.eq(p.unlimited, false, 'a positive budget is not unlimited');
    A.eq(p.spend.length + p.deferred.length, 6, 'every candidate is accounted for (spent or deferred)');
  }

  // ---- the JOINT BOUND: for ANY candidate set, spend count never exceeds the budget ----
  {
    const all = G.PRIORITY.slice();
    for (let b = 0; b <= all.length; b++) {
      for (let mask = 0; mask < (1 << all.length); mask++) {
        const cand = all.filter((_, i) => (mask >> i) & 1);
        const p = G.decide({ candidates: cand, budget: b });
        if (b === 0) { A.ok(p.spend.length === cand.length, 'budget 0 = unlimited: all ' + cand.length + ' spend'); }
        else { A.ok(p.spend.length <= b, 'spend (' + p.spend.length + ') never exceeds budget ' + b); }
        A.ok(p.spend.length + p.deferred.length === cand.length, 'no candidate lost for mask ' + mask + ' budget ' + b);
      }
    }
    A.ok(true, 'exhaustive: across all ' + (1 << all.length) + ' candidate sets × budgets 0..' + all.length + ' the bound holds');
  }

  // ---- budget 0 = UNLIMITED (governor off): every candidate spends, nothing defers ----
  {
    const p = G.decide({ candidates: ['reflection', 'study', 'threadmine', 'scout', 'skill-review', 'skill-curator'], budget: 0 });
    A.eq(p.spend.length, 6, 'budget 0 spends all six');
    A.eq(p.deferred, [], 'budget 0 defers nothing');
    A.eq(p.unlimited, true, 'budget 0 reports unlimited');
  }

  // ---- ZERO candidates: nothing to spend regardless of budget ----
  {
    const p = G.decide({ candidates: [], budget: 2 });
    A.eq(p.spend, [], 'no candidates -> no spend');
    A.eq(p.deferred, [], 'no candidates -> no deferrals');
  }
  A.eq(G.decide({}).spend, [], 'missing candidates arg -> empty (fail-safe)');

  // ---- budget >= candidate count: everyone spends, no deferrals ----
  {
    const p = G.decide({ candidates: ['reflection', 'scout'], budget: 5 });
    A.eq(p.spend, ['reflection', 'scout'], 'budget above candidate count spends all, in priority order');
    A.eq(p.deferred, [], 'nothing deferred when budget covers all');
  }

  // ---- duplicates collapse (a pass named twice spends at most once) ----
  {
    const p = G.decide({ candidates: ['study', 'study', 'reflection', 'reflection'], budget: 3 });
    A.eq(p.spend, ['reflection', 'study'], 'dups collapse; still priority-ordered');
    A.eq(p.deferred, [], 'no phantom deferrals from dups');
  }

  // ---- unknown passes deprioritize but stay ELIGIBLE (never silently dropped) ----
  {
    const p = G.decide({ candidates: ['mystery', 'reflection'], budget: 2 });
    A.eq(p.spend, ['reflection', 'mystery'], 'known pass ranks first; unknown sorts last but is eligible');
    const p2 = G.decide({ candidates: ['mystery', 'reflection'], budget: 1 });
    A.eq(p2.spend, ['reflection'], 'under tight budget the known pass wins the slot');
    A.eq(p2.deferred, ['mystery'], 'the unknown defers rather than vanishing');
  }

  // ---- custom priority override (used by tests) is honored ----
  {
    const p = G.decide({ candidates: ['reflection', 'scout'], budget: 1, priority: ['scout', 'reflection'] });
    A.eq(p.spend, ['scout'], 'an overridden priority reorders the winners');
  }

  // ---- parseBudget: default when unset/blank/garbage/negative/float; literal 0 honored ----
  A.eq(G.parseBudget(undefined), 2, 'unset -> default 2');
  A.eq(G.parseBudget(null), 2, 'null -> default 2');
  A.eq(G.parseBudget(''), 2, 'blank -> default 2');
  A.eq(G.parseBudget('   '), 2, 'whitespace -> default 2');
  A.eq(G.parseBudget('nope'), 2, 'garbage -> default 2 (never silent-unlimited)');
  A.eq(G.parseBudget('-1'), 2, 'negative -> default 2');
  A.eq(G.parseBudget('2.5'), 2, 'float -> default 2');
  A.eq(G.parseBudget('0'), 0, 'literal 0 honored (explicit unlimited/off)');
  A.eq(G.parseBudget('1'), 1, 'literal 1 honored');
  A.eq(G.parseBudget('3'), 3, 'literal 3 honored');
  A.eq(G.parseBudget(' 4 '), 4, 'surrounding whitespace trimmed');
  A.eq(G.parseBudget('nope', 5), 5, 'custom default honored on garbage');
  A.eq(G.parseBudget(undefined, -3), 2, 'invalid custom default falls back to module default');

  // ---- DETERMINISM: identical inputs -> byte-identical output, and the input array is not mutated ----
  {
    const input = ['scout', 'reflection', 'skill-curator'];
    const a = G.decide({ candidates: input, budget: 2 });
    const b = G.decide({ candidates: input, budget: 2 });
    A.eq(a, b, 'same inputs -> identical output (pure)');
    A.eq(input, ['scout', 'reflection', 'skill-curator'], 'decide does not mutate the caller\'s candidate array');
    A.eq(G.PRIORITY, ['reflection', 'failure-review', 'study', 'threadmine', 'scout', 'skill-review', 'skill-curator'], 'PRIORITY export is a copy — decide never mutates it');
  }

  A.report('auxgovernor.test');
})().catch(e => { console.log('FAIL: auxgovernor.test threw - ' + (e && e.stack || e)); process.exit(1); });
