/* node test/transcript.compaction.e2e.test.js — the durable transcript survives a REAL compaction.

   The unit tests in transcript.test.js simulate a fold by rewriting the array themselves. This one drives
   the ACTUAL machinery: a real makeContext, the real runAgentLoop, the real maybeCompact() rebuild, and the
   real summarize() wiring runOnce uses (drain the folded slice, then summarize it). It exists because the
   bug it guards was invisible to every existing test — a positional boundary captured before the loop is
   silently invalidated when compaction rebuilds the messages array SHORTER, and the whole run's dialogue is
   dropped with no error. Backend law calls a restart round-trip the top recurring bug class, so the last
   assertions replay the on-disk log into a fresh store exactly as a sidecar restart would. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeContext } = require('../sidecar/context.js');
const { makeTranscriptStore } = require('../sidecar/transcriptstore.js');

(async () => {
  const STREAM = 's1', AGENT = 'a';
  const lines = [];
  const store = makeTranscriptStore({ io: { readAll: () => lines.slice(), append: (e) => lines.push(e) }, clock: { now: () => 1000 } });
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  const emit = makeEmitter(bus, () => {});

  // a RESUMED session: prior dialogue already on disk, replayed back into the prompt
  const msgs = [];
  for (let i = 0; i < 40; i++) msgs.push({ role: i % 2 ? 'assistant' : 'user', content: 'prior turn ' + i + ' ' + 'x'.repeat(200) });
  msgs.push({ role: 'user', content: 'the new directive' });
  const startLen = msgs.length;
  store.markPersisted(msgs);              // exactly what runOnce does before handing the prompt to the loop

  // a small window so the REAL shouldCompact() fires after the first turn
  const ctxMgr = makeContext({ contextLimit: 2000, compactAt: 0.65, keepTail: 4 });
  // summarize wired exactly like index.js: drain the slice about to be deleted, THEN summarize it
  let compactions = 0;
  async function summarize(older) {
    store.appendNew(STREAM, AGENT, older);
    compactions++;
    return { summary: 'folded ' + older.length + ' turns', usd: 0, tokens: 0 };
  }

  let turn = 0;
  const provider = {
    priceOf: () => null,
    contextLimit: () => 2000,
    stream: async function* () {
      turn++;
      if (turn < 4) {                     // three tool-using turns, each big enough to trip the threshold
        yield { type: 'tool_start', index: 0, id: 'c' + turn, name: 'noop' };
        yield { type: 'tool_args', index: 0, chunk: '{}' };
        yield { type: 'text', delta: 'working step ' + turn };
        yield { type: 'usage', usage: { prompt_tokens: 1900, completion_tokens: 10, total_tokens: 1910 } };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text', delta: 'FINAL ANSWER' };
      yield { type: 'usage', usage: { prompt_tokens: 500, completion_tokens: 10, total_tokens: 510 } };
      yield { type: 'done', finishReason: 'stop' };
    }
  };

  const res = await runAgentLoop({
    messages: msgs, provider, emit, cost: makeCostEngine({ priceOf: () => null }),
    dispatch: async () => ({ ok: true, content: 'TOOL RESULT ' + turn }),
    tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }],
    context: ctxMgr, summarize,
    model: 'm', agentId: AGENT, runId: 'r', limits: { maxIters: 10 }
  });
  // REGRESSION WITNESS — run the PRE-FIX code path against this same real fold before doing it properly.
  // `startLen` is exactly what runOnce used to capture as `_txStart`. If this ever stops returning 0, the
  // fold stopped happening and every assertion below has quietly become vacuous.
  const preFix = makeTranscriptStore({ io: { readAll: () => [], append() {} }, clock: { now: () => 0 } });
  A.eq(preFix.appendTurns(STREAM, AGENT, res.messages, startLen), 0,
    'the pre-fix positional boundary records ZERO turns after a real compaction — the bug, reproduced');

  store.appendNew(STREAM, AGENT, res.messages);   // exactly what runOnce does at run end

  // ---- the fold really happened (this test is worthless if it silently didn't) ----
  A.eq(res.reason, 'done', 'the run completed');
  A.ok(compactions >= 1, 'a REAL compaction fired — not a hand-simulated one');
  A.ok(seq.some(e => e.name === 'agent.compact'), 'the loop emitted agent.compact');
  A.ok(res.messages.length < startLen, 'the live messages array really did shrink below its pre-run length');

  // ---- the dialogue is COMPLETE despite the fold ----
  const h = store.history(STREAM, { limit: 500 });
  const texts = h.map(r => r.content).join('\n');
  A.ok(/FINAL ANSWER/.test(texts), 'the final answer reached the durable transcript');
  for (let t = 1; t <= 3; t++) A.ok(texts.indexOf('working step ' + t) >= 0, 'assistant turn ' + t + ' survived (it was folded away mid-run)');
  A.ok(/TOOL RESULT/.test(texts), 'tool results survived the fold');
  A.ok(h.every(r => String(r.content).indexOf('prior turn') !== 0), 'already-persisted history was never re-appended');

  // ---- draining at BOTH the fold and run end must not double-write ----
  const seen = new Set();
  let dup = 0;
  for (const r of h) { const k = r.role + '|' + r.content; if (seen.has(k)) dup++; seen.add(k); }
  A.eq(dup, 0, 'no turn was written twice despite draining at both the fold and run end');

  // ---- RESTART ROUND-TRIP: replay the on-disk log into a fresh store, as a sidecar restart does ----
  const reborn = makeTranscriptStore({ io: { readAll: () => lines.slice(), append() {} }, clock: { now: () => 0 } });
  const after = reborn.history(STREAM, { limit: 500 }).map(r => r.content).join('\n');
  A.ok(/FINAL ANSWER/.test(after), 'the dialogue survives a sidecar restart (replayed from disk)');
  A.ok(/working step 1/.test(after), 'including the turns that were folded out of context mid-run');
  const rebuilt = reborn.reconstruct(STREAM, { limit: 500 });
  A.ok(rebuilt.length >= 4, 'and it reconstructs into a replayable OpenAI-format prompt for the next run');

  // ---- STRICT ROTATION BARRIER: a failed durable drain prevents the fold instead of losing history ----
  const guardedMessages = [];
  for (let i = 0; i < 40; i++) guardedMessages.push({ role: i % 2 ? 'assistant' : 'user', content: 'guarded prior ' + i + ' ' + 'y'.repeat(200) });
  guardedMessages.push({ role: 'user', content: 'keep the guarded history' });
  const guardedStore = makeTranscriptStore({
    io: { readAll: () => [], append() {}, appendDurable() { throw new Error('injected fsync failure'); } },
    clock: { now: () => 2000 }
  });
  const guardedEvents = [];
  let guardedTurn = 0, strictAttempts = 0;
  const guardedResult = await runAgentLoop({
    messages: guardedMessages,
    provider: { priceOf: () => null, contextLimit: () => 2000, stream: async function* () {
      guardedTurn++;
      if (guardedTurn === 1) {
        yield { type: 'tool_start', index: 0, id: 'guard-call', name: 'noop' };
        yield { type: 'tool_args', index: 0, chunk: '{}' };
        yield { type: 'usage', usage: { prompt_tokens: 1900, completion_tokens: 5, total_tokens: 1905 } };
        yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text', delta: 'GUARDED FINAL' };
      yield { type: 'done', finishReason: 'stop' };
    } },
    emit: (name, payload) => guardedEvents.push({ name, payload }),
    dispatch: async () => ({ ok: true, content: 'guard result' }),
    tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }],
    context: makeContext({ contextLimit: 2000, compactAt: 0.65, keepTail: 4 }),
    summarize: async older => { strictAttempts++; guardedStore.appendNewStrict('guard', AGENT, older, { sourceRunId: 'guard-run' }); return { summary: 'must not commit' }; },
    model: 'm', agentId: AGENT, runId: 'guard-run', limits: { maxIters: 4 }
  });
  A.eq(guardedResult.reason, 'done', 'a transcript fsync failure does not crash the run');
  A.ok(strictAttempts >= 1, 'the real compaction path attempted the strict transcript barrier');
  A.eq(guardedEvents.filter(e => e.name === 'agent.compact').length, 0, 'the loop never commits a fold whose durable transcript drain failed');
  A.ok(guardedResult.messages.some(m => /guarded prior 0/.test(String(m.content || ''))), 'the unfurled live history remains available after the refused fold');

  A.report('transcript.compaction.e2e.test');
})();
