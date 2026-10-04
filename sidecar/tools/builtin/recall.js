/* sidecar/tools/builtin/recall.js — the recall_conversation tool (H1.3).

   The parity gap vs the reference harness: it exposes a message-search tool (BM25 FTS5) to the agent ITSELF so
   it can pull weeks-old dialogue back into context on demand. StarNet already writes a durable per-workstream transcript
   (transcriptstore.js) and has BM25 recall — but only over the curated NOTEBOOK, never the conversation. This
   tool closes that: the agent searches its OWN past dialogue by keyword and gets the most relevant earlier
   messages back.

   THREE SHAPES, inferred from the args (no mode parameter — parity with the reference harness's session search):
     SEARCH  `query`               — ranked matching turns. Scoped to the active workstream by default; `scope:'all'`
                                     spans every workstream, and a zero-hit stream search AUTO-WIDENS to all (and
                                     says so), because "I found nothing" is a lie when the answer is one stream over.
     SCROLL  `around` (+ `stream`) — the turns surrounding a hit, so a match can be read IN CONTEXT rather than as
                                     one orphaned line. Anchored on the `t=` stamp printed next to every hit.
     BROWSE  (no args)             — the workstreams that exist, newest-active first, with a topic preview. For when
                                     the agent does not yet know WHICH workstream holds the answer.

   Joins the NOTEBOOK (memory) capability — granted by the placed NOTEBOOK object alongside notebook.read/write,
   so it appears exactly when durable memory does. Read-only, no consent (it only reads the agent's own
   transcript, which is already redacted on write).

     makeRecallTool({ transcriptStore }) -> { recallTool, register(registry) }
   At call time, ctx supplies streamId (the active workstream) — the default scope for search and scroll. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).recall = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SNIPPET = 600;   // per-turn clip in a result list — enough to judge relevance, not a transcript dump

  // YYYY-MM-DD for a stamp the model can reason about ("that was three weeks ago"). PURE: formats the PASSED ts,
  // never reads the clock (test/lint-determinism.js bans argless `new Date()` across sidecar/). A missing/0 stamp
  // renders empty rather than 1970 — a fake date is worse than no date.
  function day(ts) {
    const n = Number(ts);
    if (!isFinite(n) || n <= 0) return '';
    try { return new Date(n).toISOString().slice(0, 10); } catch (_) { return ''; }
  }
  function oneLine(s, max) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max || SNIPPET);
  }

  function makeRecallTool(deps) {
    const d = deps || {};
    const transcriptStore = d.transcriptStore;

    const recallTool = {
      name: 'recall_conversation', capability: 'memory', scope: 'read', requiresConsent: false,
      description: 'Search your OWN earlier conversation by keyword and get the most relevant past messages back — ' +
        'use it to remember what was discussed earlier (days/weeks ago) that has scrolled out of context. ' +
        'Three ways to call it: (1) `query` searches THIS workstream, and widens to all of them if nothing matches — ' +
        'pass scope:"all" to search everywhere up front; (2) `around` (a t= stamp from a result) reads the turns ' +
        'surrounding that moment, so you can see a match in context; (3) no arguments lists your workstreams with a ' +
        'topic preview, for when you do not know where to look. Not the same as notebook (durable facts you chose to ' +
        'save) — this searches the raw dialogue history.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'words or a phrase to find in your earlier dialogue' },
          scope: { type: 'string', enum: ['stream', 'all'], description: 'search THIS workstream (default) or every workstream' },
          anchor: { type: 'string', description: 'a stable id=tx-N anchor from a search result (preferred when timestamps collide)' },
          around: { type: 'integer', description: 'a t= stamp from an earlier result — returns the turns surrounding it' },
          stream: { type: 'string', description: 'workstream id for `around` (defaults to the active one)' },
          limit: { type: 'integer', description: 'max matches to return (default 5)' }
        }
      },
      run: async (args, ctx) => {
        const a = args || {};
        const streamId = ctx && ctx.streamId ? String(ctx.streamId) : null;
        if (!transcriptStore || typeof transcriptStore.search !== 'function') return { content: 'Conversation recall is unavailable.', summary: 'unavailable' };
        const limit = (Number(a.limit) > 0) ? Math.min(Number(a.limit), 20) : 5;

        // ---- SCROLL: read around an anchor stamp ----
        if ((a.anchor || (a.around != null && a.around !== '')) && typeof transcriptStore.around === 'function') {
          const stable = a.anchor == null ? '' : String(a.anchor);
          const anchor = stable || Number(a.around);
          if ((!stable && (!isFinite(anchor) || anchor <= 0)) || (stable && !/^tx-\d+$/.test(stable))) return { content: 'Pass `anchor` as an id=tx-N value or `around` as a t= stamp copied from an earlier result.', summary: 'bad anchor' };
          const where = a.stream ? String(a.stream) : streamId;
          let win = [];
          try { win = transcriptStore.around(where, anchor, { window: limit }) || []; } catch (_) { win = []; }
          if (!win.length) return { content: 'No turns found around ' + (stable ? 'id=' : 't=') + anchor + (where ? ' in workstream "' + where + '"' : '') + '.', summary: '0 turns' };
          const body = win.map(r => '[' + r.role + ' · t=' + r.ts + '] ' + oneLine(r.content, SNIPPET)).join('\n');
          return { content: 'Turns around ' + (stable ? 'id=' : 't=') + anchor + (where ? ' in "' + where + '"' : '') + ':\n' + body, summary: win.length + ' turn(s)' };
        }

        // ---- BROWSE: which workstreams exist ----
        const q = a.query == null ? '' : String(a.query);
        if (!q.trim()) {
          if (typeof transcriptStore.streams !== 'function') return { content: 'Provide a `query` (words to find in your earlier conversation).', summary: 'no query' };
          let list = [];
          try { list = transcriptStore.streams({ limit: Math.max(limit, 10) }) || []; } catch (_) { list = []; }
          if (!list.length) return { content: 'No recorded conversation yet.', summary: '0 workstreams' };
          const body = list.map(s => {
            const when = day(s.lastAt);
            return '- [' + s.streamId + '] ' + s.turns + ' turn(s)' + (when ? ', last ' + when : '') + (s.preview ? ' — "' + s.preview + '"' : '');
          }).join('\n');
          return {
            content: 'Your workstreams (most recently active first):\n' + body + '\n\nSearch one with query + scope:"all", or read around a moment with `around`.',
            summary: list.length + ' workstream(s)'
          };
        }

        // ---- SEARCH: this workstream, widening if it comes up empty ----
        const explicit = a.scope === 'all' || a.scope === 'stream';
        const wantAll = a.scope === 'all';
        let hits = [];
        try { hits = transcriptStore.search(streamId, q, { limit, scope: wantAll ? 'all' : 'stream' }) || []; } catch (_) { hits = []; }
        // AUTO-WIDEN: a zero-hit search in ONE workstream is not evidence the conversation never happened — the
        // reference harness searches every session by default, and answering "we never discussed that" off a
        // single-stream miss is exactly the confidently-wrong claim this project treats as a defect. Only when the
        // caller did not pin the scope itself.
        let widened = false;
        if (!hits.length && !explicit) {
          try { hits = transcriptStore.search(streamId, q, { limit, scope: 'all' }) || []; } catch (_) { hits = []; }
          widened = hits.length > 0;
        }
        if (!hits.length) {
          const where = wantAll ? 'any workstream' : 'your earlier conversation';
          return { content: 'No messages in ' + where + ' match "' + q + '".', summary: '0 matches' };
        }
        // label the source workstream whenever the results can span more than one — an unattributed cross-stream
        // quote reads as if it belonged to the current task.
        const crossStream = wantAll || widened;
        const body = hits.map((h, i) => {
          const tag = (crossStream && h.streamId ? '[' + h.streamId + ' · ' : '[') + h.role + ' · t=' + h.ts + (day(h.ts) ? ' · ' + day(h.ts) : '') + ']';
          return (i + 1) + '. ' + tag + (h.rowId ? ' [id=tx-' + h.rowId + ']' : '') + ' ' + oneLine(h.content, SNIPPET);
        }).join('\n');
        const lead = widened
          ? 'Nothing matched in this workstream, so I searched all of them:\n'
          : (wantAll ? 'Matches across all workstreams:\n' : '');
        return {
          content: lead + body + '\n\nPass `anchor` with an id=tx-N above (stable), or `around` with a t= stamp, to read the surrounding turns.',
          summary: hits.length + ' match(es)' + (crossStream ? ' (all workstreams)' : '')
        };
      }
    };

    return {
      recallTool,
      register(registry) { if (registry && typeof registry.register === 'function') registry.register(recallTool); return this; }
    };
  }

  return { makeRecallTool };
});
