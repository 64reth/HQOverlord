/* node test/provider.replay.test.js — the zero-spend replay provider. */
'use strict';
const A = require('./_assert.js');
const { makeReplayProvider } = require('../sidecar/providers/replay.js');

async function drain(it) { const out = []; for await (const ev of it) out.push(ev); return out; }

(async () => {
  const fx = {
    turns: [
      [{ type: 'text', delta: 'a' }, { type: 'done', finishReason: 'stop' }],
      [{ type: 'text', delta: 'b' }, { type: 'done', finishReason: 'stop' }]
    ],
    models: [{ id: 'm1', context_length: 1234, pricing: { prompt: '0.000002', completion: '0.000004' }, supportsTools: true }]
  };
  const p = makeReplayProvider(fx);

  const t1 = await drain(p.stream({ model: 'm1' }));
  A.eq(t1.map(e => e.type), ['text', 'done'], 'turn 1 events');
  A.eq(t1[0].delta, 'a', 'turn 1 text');
  const t2 = await drain(p.stream({ model: 'm1' }));
  A.eq(t2[0].delta, 'b', 'turn 2 advances cursor');
  A.eq(p.callCount(), 2, 'callCount tracks stream() calls');

  const t3 = await drain(p.stream({ model: 'm1' }));
  A.eq(t3.map(e => e.type), ['done'], 'exhausted fixture -> graceful stop');

  const aborted = await drain(p.stream({ model: 'm1', signal: { aborted: true } }));
  A.eq(aborted.length, 0, 'aborted signal -> yields nothing');

  // catalog helpers
  A.eq(p.contextLimit('m1'), 1234, 'contextLimit from model');
  A.eq(p.contextLimit('nope'), 8000, 'contextLimit default for unknown');
  const pr = p.priceOf('m1');
  A.ok(Math.abs(pr.in - 2) < 1e-9 && Math.abs(pr.out - 4) < 1e-9, 'priceOf is per-million USD');
  A.eq(p.priceOf('nope'), null, 'priceOf unknown -> null');
  A.eq(p.listModels()[0].id, 'm1', 'listModels');
  A.ok(p.listModels()[0] !== fx.models[0], 'listModels returns copies (no mutation leak)');

  p.reset();
  A.eq(p.callCount(), 0, 'reset clears state');

  A.report('provider.replay.test');
})();
