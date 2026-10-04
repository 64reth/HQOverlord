/* node test/recall.test.js — agent-callable conversation recall (H1.3).
   Proves transcriptStore.search() ranks the row containing a query phrase first (BM25-ish: distinct terms, then
   frequency, then recency), is stream-scoped, and that the recall_conversation tool returns the match / guards an
   empty query / degrades gracefully. Pure + deterministic (injected clock, in-memory io). */
'use strict';
const A = require('./_assert.js');
const { makeTranscriptStore } = require('../sidecar/transcriptstore.js');
const { makeRecallTool } = require('../sidecar/tools/builtin/recall.js');

function memIo() { const lines = []; return { lines, readAll() { return lines.slice(); }, append(e) { lines.push(e); } }; }
let clk = 1000; const clock = { now: () => clk };

(async () => {
  // ---- A. search(): a phrase from turn #3 ranks that turn FIRST among 50 ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    for (let i = 0; i < 50; i++) { clk = 1000 + i; s.append({ streamId: 's1', role: 'user', content: 'message number ' + i + ' about ' + (i === 3 ? 'the quarterly budget reconciliation plan' : 'misc topic ' + i) }); }
    const hits = s.search('s1', 'quarterly budget reconciliation', { limit: 5 });
    A.ok(hits.length >= 1, 'search returns matches');
    A.ok(hits[0].content.indexOf('number 3 ') >= 0, 'the turn containing the phrase ranks FIRST');
  }

  // ---- B. search() is stream-scoped (never leaks another workstream's dialogue) ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    s.append({ streamId: 'a', role: 'user', content: 'alpha secret pumpkin' });
    s.append({ streamId: 'b', role: 'user', content: 'beta pumpkin elsewhere' });
    const hits = s.search('a', 'pumpkin', { limit: 5 });
    A.eq(hits.length, 1, 'only the queried stream is searched');
    A.ok(hits[0].content.indexOf('alpha') >= 0, 'returns stream a, not stream b');
  }

  // ---- C. search(): empty/no-match queries are safe ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    s.append({ streamId: 'x', role: 'user', content: 'hello world' });
    A.eq(s.search('x', '', { limit: 5 }), [], 'empty query -> no matches');
    A.eq(s.search('x', 'zzzznomatch', { limit: 5 }), [], 'no-overlap query -> no matches');
  }

  // ---- D. the recall_conversation tool: returns matches, scoped by ctx.streamId ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    s.append({ streamId: 's9', role: 'user', content: 'we agreed to ship the airlock fix on friday' });
    s.append({ streamId: 's9', role: 'assistant', content: 'confirmed, airlock fix friday' });
    const { recallTool } = makeRecallTool({ transcriptStore: s });
    A.eq(recallTool.name, 'recall_conversation', 'tool name');
    A.eq(recallTool.capability, 'memory', 'joins the NOTEBOOK (memory) capability');
    A.eq(recallTool.requiresConsent, false, 'read-only, no consent');
    const r = await recallTool.run({ query: 'airlock friday' }, { streamId: 's9' });
    A.ok(r.content.indexOf('airlock') >= 0, 'tool surfaces the matching dialogue');
    A.ok(/match/.test(r.summary), 'summary reports match count');
    s.append({ streamId: 's9', role: 'user', content: '\u041f\u0440\u0438\u0432\u0435\u0442 \u043a\u043e\u043c\u0430\u043d\u0434\u0438\u0440 \u6771\u4eac\u8a08\u753b' });
    const unicode = await recallTool.run({ query: '\u041f\u0440\u0438\u0432\u0435\u0442' }, { streamId: 's9' });
    A.ok(unicode.content.indexOf('\u041f\u0440\u0438\u0432\u0435\u0442') >= 0, 'tool surfaces a matching Cyrillic dialogue turn');
    const cjk = await recallTool.run({ query: '\u6771\u4eac' }, { streamId: 's9' });
    A.ok(cjk.content.indexOf('\u6771\u4eac\u8a08\u753b') >= 0, 'tool surfaces a matching unspaced CJK phrase');
  }

  // ---- E. the tool guards an empty transcript + a missing store ----
  {
    const { recallTool } = makeRecallTool({ transcriptStore: makeTranscriptStore({ io: memIo(), clock }) });
    // an argument-less call is now BROWSE (list workstreams), so on an EMPTY store it must say there is no
    // recorded conversation — never invent one.
    const empty = await recallTool.run({ query: '   ' }, { streamId: 's1' });
    A.ok(/no recorded conversation/i.test(empty.content), 'empty store + no query -> honest "nothing recorded"');
    const noStore = makeRecallTool({}).recallTool;
    const r = await noStore.run({ query: 'x' }, { streamId: 's1' });
    A.ok(/unavailable/i.test(r.content), 'missing transcriptStore -> graceful "unavailable"');
  }

  // ---- F. store: scope:'all' spans every workstream, and every hit is ATTRIBUTED ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    clk = 2000; s.append({ streamId: 'a', role: 'user', content: 'alpha secret pumpkin' });
    clk = 2001; s.append({ streamId: 'b', role: 'user', content: 'beta pumpkin elsewhere' });
    const scoped = s.search('a', 'pumpkin', { limit: 5 });
    A.eq(scoped.length, 1, 'default scope is still ONE stream (no behaviour drift)');
    A.eq(scoped[0].streamId, 'a', 'a hit carries its own streamId');
    const all = s.search('a', 'pumpkin', { limit: 5, scope: 'all' });
    A.eq(all.length, 2, "scope:'all' searches every workstream");
    A.eq(all.map(h => h.streamId).sort(), ['a', 'b'], 'cross-stream hits are attributable to their workstream');
  }

  // ---- G. store: streams() browse + around() scroll ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    clk = 3000; s.append({ streamId: 'old', role: 'user', content: 'the docking clamp question' });
    clk = 4000; s.append({ streamId: 'new', role: 'user', content: 'the reactor question' });
    clk = 4001; s.append({ streamId: 'new', role: 'assistant', content: 'reactor answer' });
    const list = s.streams({ limit: 10 });
    A.eq(list.length, 2, 'browse lists every workstream');
    A.eq(list[0].streamId, 'new', 'most recently active workstream leads');
    A.eq(list[0].turns, 2, 'turn count is real');
    A.ok(list[0].preview.indexOf('reactor') >= 0, 'preview shows the last USER line (the topic)');
    A.ok(list[1].preview.indexOf('docking clamp') >= 0, 'each stream keeps its own preview');
    // scroll: anchored on a ts, returns the surrounding window of THAT stream only
    const win = s.around('new', 4001, { window: 5 });
    A.eq(win.length, 2, 'scroll returns the stream window around the anchor');
    A.ok(win.every(r => r.streamId === 'new'), 'scroll never leaks another workstream');
    A.eq(s.around('nope', 4001, { window: 5 }), [], 'scroll on an unknown stream -> empty, not a throw');
  }

  // ---- H. the tool: AUTO-WIDENS a zero-hit stream search instead of claiming it never happened ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    clk = 5000; s.append({ streamId: 'other', role: 'user', content: 'we decided to use postgres for the ledger' });
    clk = 5001; s.append({ streamId: 'here', role: 'user', content: 'unrelated chatter' });
    const { recallTool } = makeRecallTool({ transcriptStore: s });
    const r = await recallTool.run({ query: 'postgres ledger' }, { streamId: 'here' });
    A.ok(r.content.indexOf('postgres') >= 0, 'the answer one workstream over is FOUND, not denied');
    A.ok(/searched all of them/i.test(r.content), 'and the widening is stated, not silent');
    A.ok(r.content.indexOf('[other') >= 0, 'the cross-stream hit names its workstream');
    // an EXPLICIT stream scope is honoured — no surprise widening when the caller pinned it
    const pinned = await recallTool.run({ query: 'postgres ledger', scope: 'stream' }, { streamId: 'here' });
    A.ok(/no messages/i.test(pinned.content), "scope:'stream' does not auto-widen");
  }

  // ---- I. the tool: browse + scroll shapes ----
  {
    const s = makeTranscriptStore({ io: memIo(), clock });
    clk = 6000; s.append({ streamId: 'w1', role: 'user', content: 'first topic' });
    clk = 6001; s.append({ streamId: 'w1', role: 'assistant', content: 'first answer' });
    const { recallTool } = makeRecallTool({ transcriptStore: s });
    const browse = await recallTool.run({}, { streamId: 'w1' });
    A.ok(browse.content.indexOf('w1') >= 0, 'no-arg call browses the workstreams');
    A.ok(/workstream/i.test(browse.summary), 'browse summary counts workstreams');
    const scroll = await recallTool.run({ around: 6001 }, { streamId: 'w1' });
    A.ok(scroll.content.indexOf('first topic') >= 0, 'scroll reads the turns around the anchor');
    A.ok(/turn/i.test(scroll.summary), 'scroll summary counts turns');
    const bad = await recallTool.run({ around: 'nonsense' }, { streamId: 'w1' });
    A.ok(/t=/.test(bad.content), 'a bad anchor explains the t= stamp instead of crashing');
  }

  A.report('recall.test');
})();
