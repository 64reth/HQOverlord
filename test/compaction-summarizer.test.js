/* node test/compaction-summarizer.test.js — the chunked compaction summarizer sees the WHOLE foldable slice.

   On trunk (pre-extraction) runOnce's summarize() rendered the slice then `.slice(0, 16000)`: a 400k-char
   fold reached the model as its oldest ~16k chars and the rest of the run's memory vanished. Test (a) encodes
   that: one unique marker per message, and the concatenation of EVERY summarizer request must contain ALL of
   them. Run with COMPACTION_LEGACY_16K=1 to watch the old behaviour fail it (kept as an executable record). */
'use strict';
const A = require('./_assert.js');
const { makeSummarizer, partition } = require('../sidecar/compaction-summarizer.js');
const { makeCostEngine } = require('../sidecar/cost.js');

const LEGACY = !!process.env.COMPACTION_LEGACY_16K;
const pad = (n) => String(n).padStart(4, '0');

function fakeStream(opts) {
  opts = opts || {};
  const reqs = [];
  let n = 0;
  const streamFn = async function* (req) {
    reqs.push(req);
    n++;
    if (opts.throwOn && opts.throwOn(n, req)) throw new Error('boom');
    if (opts.abortAfter && n >= opts.abortAfter && opts.signal) opts.signal.aborted = true;
    yield { type: 'text', delta: 'SUM#' + n };
    yield { type: 'usage', usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0.003 } };   // provider-billed $ per chunk
  };
  return { reqs, streamFn, input: () => reqs.map(r => r.messages[1].content).join('\n') };
}
const cost = makeCostEngine({ priceOf: () => ({ prompt: '0.000001', completion: '0.000002' }) });

// a 400-message fold, ~1000 chars each (~400k chars), unique marker per message
function bigSlice() {
  const msgs = [];
  for (let i = 1; i <= 400; i++) {
    const marker = 'MARKER-' + pad(i);
    if (i % 2) msgs.push({ role: 'assistant', content: marker + ' ' + 'x'.repeat(990), tool_calls: [{ id: 'c' + i, type: 'function', function: { name: 'fs_read', arguments: '{}' } }] });
    else msgs.push({ role: 'tool', tool_call_id: 'c' + (i - 1), content: marker + ' ' + 'y'.repeat(990) });
  }
  return msgs;
}

(async () => {
  // ---- (a) ALL 400 markers reach the summarizer (≥ 8 requests at 48k chunks over ~400k chars) ----
  {
    const fs = fakeStream();
    let streamFn = fs.streamFn;
    let chunkChars;
    if (LEGACY) {   // trunk's behaviour: one request over the first 16k rendered chars
      chunkChars = 1e9;
      streamFn = async function* (req) { req.messages[1].content = req.messages[1].content.slice(0, 16000); yield* fs.streamFn(req); };
    }
    const summarize = makeSummarizer({ streamFn, cost, model: 'm', chunkChars, summaryPrompt: () => 'P' });
    const r = await summarize(bigSlice(), '', null);
    const all = fs.input();
    const missing = [];
    for (let i = 1; i <= 400; i++) if (all.indexOf('MARKER-' + pad(i)) < 0) missing.push(i);
    A.ok(fs.reqs.length >= 8, 'a 400k-char fold is sent as ≥ 8 chunk requests (got ' + fs.reqs.length + ')');
    A.eq(missing.length, 0, 'every one of the 400 markers reached the summarizer (missing ' + missing.length + ')');
    A.eq(r.chunks, fs.reqs.length, 'chunks reported = requests made');
    A.eq(r.truncatedChars, 0, 'no truncation under MAX_CHUNKS');
    A.eq(r.summary, 'SUM#' + fs.reqs.length, 'the final running summary is the last chunk\'s output');
  }

  // ---- (b) chunk N carries chunk N-1's summary as prevSummary (MERGE prompt), chunk 1 carries the caller's ----
  {
    const fs = fakeStream();
    const prompts = [];
    const summarize = makeSummarizer({ streamFn: fs.streamFn, cost, model: 'm', chunkChars: 50000, summaryPrompt: (o) => { prompts.push(!!o.prevSummary); return 'P'; } });
    await summarize(bigSlice(), 'CALLER-PREV', null);
    A.ok(fs.reqs.length >= 2, 'multiple chunks');
    A.ok(fs.reqs[0].messages[1].content.indexOf('PREVIOUS SUMMARY') >= 0 && fs.reqs[0].messages[1].content.indexOf('CALLER-PREV') >= 0, 'chunk 1 merges the caller\'s prevSummary');
    A.eq(prompts[0], true, 'chunk 1 uses the MERGE prompt when a prior summary exists');
    for (let i = 1; i < fs.reqs.length; i++) {
      A.ok(fs.reqs[i].messages[1].content.indexOf('PREVIOUS SUMMARY') >= 0 && fs.reqs[i].messages[1].content.indexOf('SUM#' + i) >= 0, 'chunk ' + (i + 1) + ' carries chunk ' + i + '\'s summary');
      A.eq(prompts[i], true, 'chunk ' + (i + 1) + ' uses the MERGE prompt');
    }
    // and with NO caller prevSummary, chunk 1 uses the fresh prompt
    const fs2 = fakeStream(); const p2 = [];
    await makeSummarizer({ streamFn: fs2.streamFn, cost, model: 'm', chunkChars: 50000, summaryPrompt: (o) => { p2.push(!!o.prevSummary); return 'P'; } })(bigSlice(), '', null);
    A.eq(p2[0], false, 'fresh prompt for chunk 1 without a prior summary');
    A.eq(p2[1], true, 'MERGE prompt from chunk 2 on');
  }

  // ---- (c) no chunk boundary splits an assistant tool_call from its tool result ----
  {
    const chunks = partition(bigSlice(), 5000);
    A.ok(chunks.length > 50, 'many small chunks');
    for (let i = 0; i < chunks.length; i++) {
      A.ok(chunks[i].indexOf('tool: ') !== 0, 'chunk ' + i + ' does not begin with an orphan tool result');
      const ids = chunks[i].match(/MARKER-\d{4}/g) || [];
      const first = parseInt(ids[0].slice(7), 10), last = parseInt(ids[ids.length - 1].slice(7), 10);
      A.ok(first % 2 === 1 && last % 2 === 0, 'chunk ' + i + ' starts on an assistant call and ends on its tool result');
    }
    const fs = fakeStream();
    await makeSummarizer({ streamFn: fs.streamFn, cost, model: 'm', chunkChars: 5000, maxChunks: 1000, summaryPrompt: () => 'P' })(bigSlice(), '', null);
    for (const r of fs.reqs) A.ok(!/\n\ntool: /.test(r.messages[1].content.split('replace the raw turns:')[1].slice(0, 8)), 'request does not open on a tool result');
  }

  // ---- (d) MAX_CHUNKS overflow: the remainder folds as one marked chunk and truncatedChars > 0 ----
  {
    const fs = fakeStream();
    const r = await makeSummarizer({ streamFn: fs.streamFn, cost, model: 'm', chunkChars: 20000, maxChunks: 4, summaryPrompt: () => 'P' })(bigSlice(), '', null);
    A.eq(fs.reqs.length, 4, 'bounded to MAX_CHUNKS requests');
    A.ok(r.truncatedChars > 0, 'truncatedChars reported (' + r.truncatedChars + ')');
    A.ok(/\[truncated \d+ chars\]/.test(fs.reqs[3].messages[1].content), 'the final chunk input carries the [truncated N chars] marker');
    A.eq(r.chunks, 4, 'chunks = 4');
  }

  // ---- (e) usd/tokens summed across chunks ----
  {
    const fs = fakeStream();
    const r = await makeSummarizer({ streamFn: fs.streamFn, cost, model: 'm', chunkChars: 50000, summaryPrompt: () => 'P' })(bigSlice(), '', null);
    const n = fs.reqs.length;
    A.ok(n >= 8, 'multi-chunk');
    A.eq(r.tokens, 110 * n, 'tokens summed over ' + n + ' chunks');
    A.ok(Math.abs(r.usd - n * 0.003) < 1e-9, 'usd summed over chunks (' + r.usd + ')');
  }

  // ---- (f) abort mid-chunk throws (the loop treats a throw as a skipped fold) ----
  {
    const signal = { aborted: false };
    const fs = fakeStream({ abortAfter: 2, signal });
    let threw = null;
    try { await makeSummarizer({ streamFn: fs.streamFn, cost, model: 'm', signal, chunkChars: 50000, summaryPrompt: () => 'P' })(bigSlice(), '', null); }
    catch (e) { threw = e; }
    A.ok(threw && threw.name === 'AbortError', 'abort mid-fold throws');
    A.eq(fs.reqs.length, 2, 'no further chunks after the abort');
  }

  // ---- (g) aux-tier floor: a cheap aux model failing retries ONCE on the run model, per chunk ----
  {
    const fs = fakeStream({ throwOn: (n, req) => req.model === 'aux' });
    const r = await makeSummarizer({ streamFn: fs.streamFn, cost, model: 'run', auxModelFor: () => 'aux', chunkChars: 50000, summaryPrompt: () => 'P' })(bigSlice(), '', null);
    const auxN = fs.reqs.filter(q => q.model === 'aux').length, runN = fs.reqs.filter(q => q.model === 'run').length;
    A.eq(auxN, runN, 'each aux failure retried exactly once on the run model');
    A.eq(r.chunks, runN, 'every chunk folded');
  }

  // ---- (h) transcript drain runs ONCE, before any model call; a strict-drain throw aborts the fold ----
  {
    const fs = fakeStream(); let drained = 0;
    await makeSummarizer({ streamFn: fs.streamFn, cost, model: 'm', chunkChars: 50000, summaryPrompt: () => 'P', transcriptDrain: () => { drained++; A.eq(fs.reqs.length, 0, 'drain precedes the first request'); } })(bigSlice(), '', null);
    A.eq(drained, 1, 'drained once');
    const fs2 = fakeStream(); let threw = false;
    try { await makeSummarizer({ streamFn: fs2.streamFn, cost, model: 'm', transcriptDrain: () => { throw new Error('fsync'); } })(bigSlice(), '', null); } catch (_) { threw = true; }
    A.ok(threw && fs2.reqs.length === 0, 'a strict-drain failure throws before any paid call');
  }

  A.report('compaction-summarizer.test');
})().catch(e => { console.error(e); process.exit(1); });
