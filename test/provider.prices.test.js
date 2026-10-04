/* node test/provider.prices.test.js — the list-rate table that reconnects the spend seatbelt.

   Anthropic's and Google's model APIs report no pricing, so both adapters returned null from priceOf().
   cost.js turns that into $0, `spentUsd` never moves, and loop.js's per-run ceiling (and the day/global
   pools) can never fire — the cap was structurally dead on two of the three biggest providers. These tests
   pin the table, prove the honest 'unpriced' path still exists for unknown models, and — the headline —
   drive a real loop to a 'budget' stop that previously ran to the iteration ceiling reporting $0.00. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const prices = require('../sidecar/providers/prices.js');

(async () => {
  // ---- A. known ids resolve to their published rate ----
  {
    A.eq(prices.priceOf('anthropic', 'claude-sonnet-4-5-20250929').in, 3.00, 'sonnet 4.5 input rate');
    A.eq(prices.priceOf('anthropic', 'claude-sonnet-4-5-20250929').out, 15.00, 'sonnet 4.5 output rate');
    A.eq(prices.priceOf('anthropic', 'claude-3-haiku-20240307').in, 0.25, 'haiku 3 input rate');
    A.eq(prices.priceOf('anthropic', 'claude-3-5-haiku-20241022').in, 0.80, 'haiku 3.5 input rate');
    A.eq(prices.priceOf('gemini', 'gemini-2.5-flash').out, 2.50, 'gemini 2.5 flash output rate');
    A.eq(prices.priceOf('gemini', 'gemini-2.5-pro').in, 1.25, 'gemini 2.5 pro input rate');
  }

  // ---- B. ORDER matters: a specific rule beats the family fallback it would otherwise hit ----
  {
    A.eq(prices.priceOf('anthropic', 'claude-opus-4-5-20251101').in, 5.00, 'opus 4.5 uses its own rate, not the generic opus fallback');
    A.eq(prices.priceOf('anthropic', 'claude-opus-4-1-20250805').in, 15.00, 'opus 4.1 keeps the standard opus rate');
    A.eq(prices.priceOf('gemini', 'gemini-2.5-flash-lite').out, 0.40, 'flash-lite beats the broader flash rule');
  }

  // ---- C. family fallback: an id the table has never seen still gets an approximately-right cap, because a
  //         rough number keeps the seatbelt connected where null silently unbuckles it ----
  {
    A.eq(prices.priceOf('anthropic', 'claude-sonnet-9-future').in, 3.00, 'an unseen sonnet falls back to the sonnet family rate');
    A.eq(prices.priceOf('gemini', 'gemini-9.0-flash-preview').in, 1.50, 'an unseen flash falls back to the flash family rate (3.5 flash tier, 2026-08-21)');
  }

  // ---- D. HONESTY PRESERVED: nothing recognizable stays unpriced rather than being guessed at ----
  {
    A.eq(prices.priceOf('anthropic', 'llama-3-70b'), null, 'an unrelated id is not force-fit to a rate');
    A.eq(prices.priceOf('anthropic', ''), null, 'empty id -> null');
    A.eq(prices.priceOf('nosuchfamily', 'claude-sonnet-4-5'), null, 'an unknown provider family -> null');
    A.eq(prices.pricingBlock('anthropic', 'llama-3-70b'), null, 'no pricing block for an unpriced model');
  }

  // ---- E. pricingBlock round-trips through the exact parseFloat(x) * 1e6 the other adapters already use,
  //         so listModels() and priceOf() can never disagree ----
  {
    const b = prices.pricingBlock('anthropic', 'claude-sonnet-4-5-20250929');
    A.eq(parseFloat(b.prompt) * 1e6, 3.00, 'prompt block round-trips to the per-million input rate');
    A.eq(parseFloat(b.completion) * 1e6, 15.00, 'completion block round-trips to the per-million output rate');
  }

  // ---- F. cost.js labels these as an ESTIMATE ('catalog'), never as a billed figure ('provider') ----
  {
    const cost = makeCostEngine({ priceOf: (id) => prices.priceOf('anthropic', id) });
    const usage = { prompt_tokens: 1000000, completion_tokens: 1000000, total_tokens: 2000000 };
    const r = cost.reconcile(usage, 'claude-sonnet-4-5-20250929');
    A.ok(Math.abs(r.usd - 18.00) < 1e-9, '1M in + 1M out at $3/$15 = $18.00');
    A.eq(r.costSource, 'catalog', 'a table-derived figure is labelled an estimate, not a billed amount');
    A.eq(r.unpriced, false, 'a priced model is no longer flagged unpriced');
    const u = cost.reconcile(usage, 'llama-3-70b');
    A.eq(u.costSource, 'unpriced', 'an unmatched model still reports honestly as unpriced');
  }

  // ---- G. THE HEADLINE: the per-run spend ceiling actually fires on a native Anthropic run ----
  function budgetRun(costEngine, model) {
    const bus = A.makeBus();
    A.collectBus(bus, events.names());
    const emit = makeEmitter(bus, () => {});
    const provider = {
      priceOf: (id) => prices.priceOf('anthropic', id),
      contextLimit: () => 0,
      // every turn calls a tool (so the loop keeps going) and burns 1M prompt tokens
      stream: async function* () {
        yield { type: 'tool_start', index: 0, id: 'c1', name: 'noop' };
        yield { type: 'tool_args', index: 0, chunk: '{}' };
        yield { type: 'usage', usage: { prompt_tokens: 1000000, completion_tokens: 0, total_tokens: 1000000 } };
        yield { type: 'done', finishReason: 'tool_calls' };
      }
    };
    return runAgentLoop({
      messages: [{ role: 'user', content: 'x' }], provider, emit, cost: costEngine,
      dispatch: async () => ({ ok: true, content: 'ok' }),
      tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }],
      model, agentId: 'a', runId: 'r',
      limits: { maxCostUsd: 1.00, maxIters: 10, grace: false }
    });
  }
  {
    const live = await budgetRun(makeCostEngine({ priceOf: (id) => prices.priceOf('anthropic', id) }), 'claude-opus-4-5-20251101');
    A.eq(live.reason, 'budget', 'the per-run spend ceiling now stops a native Anthropic run');
    A.ok(live.usd >= 5, 'spend accrued from the catalog rate (1M prompt tokens at $5/M) instead of staying $0.00');
    A.eq(live.budgetScope, 'run', 'the stop names WHICH cap fired');
    A.ok(live.turns < 10, 'it stopped on spend, well before the iteration ceiling');

    // REGRESSION WITNESS: the exact same run with the old null price never stops on budget and reports $0.00
    // for a run the provider absolutely does bill.
    const dead = await budgetRun(makeCostEngine({ priceOf: () => null }), 'claude-opus-4-5-20251101');
    A.eq(dead.reason, 'max_iters', 'with no price the cap never fires — the run only halts at the iteration ceiling');
    A.eq(dead.usd, 0, 'and the whole run reports $0.00 despite 10M billed prompt tokens');
  }

  A.report('provider.prices.test');
})();
