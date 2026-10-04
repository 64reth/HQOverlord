/* sidecar/threadmine.js — the PURE post-run THREAD-MINING producer (NS-6). Given a finished run's conversation +
   an INJECTED aux-model `propose(prompt) -> text`, it asks "which ideas did the Commander float here but never
   act on?", parses the model's tagged blocks into thread candidates, and guardrails them (a VERBATIM evidence
   quote that must actually appear in the conversation — the grounding veto; fingerprint dedup vs the live ledger
   AND the permanent declined denylist; length + count caps). The turn-in beat then offers Keep / Edit / Discard.

   Mirrors reflect.js / study.js exactly: NO IO, NO ambient clock/rng — `clock`, `propose` are injected, so it is
   deterministic and replay-safe (passes lint-determinism). Candidates are CANDIDATES ONLY: this module NEVER
   writes to the ledger. Nothing becomes an open thread until the Commander keeps it at turn-in (index.js turn-in
   route → threadsStore.add). That is the "stash, not auto-commit" law, ported from the memory/study turn-in.

   THE GROUNDING VETO (the anti-slop heart, ported from autopilot.parseCandidates): a thread is only as real as its
   evidence. The model must return a VERBATIM quote of where the Commander raised the idea; a candidate whose quote
   does NOT appear (normalized) in the actual conversation is DROPPED. An idea the model invented — "the user
   wanted a CRM" when they never said it — has no real quote, so it dies. This is what keeps "you mentioned X" honest.

   THE SUBSTANCE VETO (added after the 2026-07-08 escape: real-provider mining offered a banter line — "I'm gonna be
   throwing some real chaos at you" — back as a "thread", which is exactly the ridiculous ask that erodes trust in
   the whole turn-in surface): grounded is NOT enough. A thread must also be actionable work: the model must supply
   a DO: line naming a concrete first deliverable AND stake CONFIDENCE: high that the Commander genuinely wants it
   picked up; anything less is dropped. The prompt states the bar explicitly ("would being asked about this seem
   ridiculous?") with banter/hype/jokes as named non-examples, caps the list at 2, and defaults to NONE. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).threadmine = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_TITLE = 120;          // a thread title is a one-line idea, not a paragraph
  const MAX_SPEC = 400;           // the evidence quote, clamped
  const MIN_TITLE = 6;            // below this it isn't an idea — a value floor against noise
  const DEFAULT_MAX = 2;          // asking is expensive (a turn-in beat interrupts) — few, high-bar proposals only
  const PROMPT_CAP = 6000;        // chars of recent exchange fed to the aux model (ideas hide in longer context)
  const MIN_QUOTE = 8;            // a verbatim quote below this can't be reliably located → treat as ungrounded
  const MIN_DO = 12;              // the DO line must name a real deliverable; shorter means the model had nothing

  // strip a recall fence the model may have echoed (parity with reflect.js) so a forged block can't be mined.
  const RECALL_FENCE = /<recalled-memory>[\s\S]*?<\/recalled-memory>|<\/?recalled-memory>/gi;
  // the tagged block format the prompt demands: THREAD / QUOTE / DO / CONFIDENCE. Tolerant of bullet prefixes.
  const THREAD_LINE = /^\s*[-*•]?\s*THREAD\s*[:\-—]\s*(.+?)\s*$/i;
  const QUOTE_LINE = /^\s*[-*•]?\s*QUOTE\s*[:\-—]\s*(.+?)\s*$/i;
  const DO_LINE = /^\s*[-*•]?\s*DO\s*[:\-—]\s*(.+?)\s*$/i;
  const CONF_LINE = /^\s*[-*•]?\s*CONFIDENCE\s*[:\-—]\s*(\w+)/i;

  // a stable FINGERPRINT of a title — IDENTICAL to threads-store.fingerprint / suggeststore.fingerprint so the
  // three agree on what "the same idea" is (kept inline so this module stays standalone / dependency-light).
  function fingerprint(title) {
    const toks = String(title == null ? '' : title).toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3);
    return Array.from(new Set(toks)).sort().join(' ');
  }

  // normalize text for the VERBATIM-quote check: lowercase, collapse all whitespace. A "verbatim" quote the model
  // returns rarely matches byte-for-byte (it re-spaces / re-cases), so we compare on this normalized form — strict
  // enough that an INVENTED quote (words never spoken) still fails, tolerant enough that real re-spacing passes.
  function normText(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  const KNOWN_MAX = 20;           // how many already-tracked titles the prompt may list (bounded, newest-first)
  // the "we already have this one" block, or '' when there is nothing to say. Bounded on every axis.
  function knownBlock(titles) {
    const list = (Array.isArray(titles) ? titles : [])
      .map(t => String(t == null ? '' : t).replace(/\s+/g, ' ').trim())
      .filter(Boolean).slice(-KNOWN_MAX).reverse()
      .map(t => t.length > MAX_TITLE ? (t.slice(0, MAX_TITLE - 1) + '…') : t);
    if (!list.length) return '';
    return 'ALREADY ON THE BOARD — these threads are already tracked. Do NOT list any of them again, or a ' +
      'restatement of one:\n' + list.map(t => '- ' + t).join('\n') + '\n';
  }

  // build the mining prompt: the recent USER/AGENT exchange (system + tool turns stripped), tail-capped. Also
  // returns the flat conversation text used for the verbatim-quote veto (so the caller need not rebuild it).
  function buildPrompt(messages, cap, knownTitles) {
    cap = cap || PROMPT_CAP;
    const turns = [];
    for (const msg of (Array.isArray(messages) ? messages : [])) {
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
      const c = typeof msg.content === 'string' ? msg.content.replace(RECALL_FENCE, '') : '';
      if (c) turns.push((msg.role === 'user' ? 'USER: ' : 'AGENT: ') + c);
    }
    let body = turns.join('\n');
    if (body.length > cap) body = body.slice(body.length - cap);   // keep the most recent exchange
    // the Commander's OWN turns, separately — a mined quote is located in the whole exchange (which includes the
    // AGENT's words), so the turn-in card may only claim "you said" when the quote is found in THIS blob.
    const userTurns = [];
    for (const msg of (Array.isArray(messages) ? messages : [])) {
      if (!msg || msg.role !== 'user') continue;
      const c = typeof msg.content === 'string' ? msg.content.replace(RECALL_FENCE, '') : '';
      if (c) userTurns.push(c);
    }
    const prompt =
      'Read this conversation. Find CONCRETE WORK the Commander explicitly wanted but that was never acted on ' +
      'here — a "thread" a colleague could genuinely pick up later (a tool they asked for, a project they ' +
      'described wanting built, a follow-up left hanging).\n' +
      'THE BAR: a thread is a real, actionable piece of work with a clear deliverable. Before listing anything, ' +
      'apply this test: if the Commander were later asked "you floated this idea — keep the thread?", would the ' +
      'question seem ridiculous to them? If yes, it is NOT a thread.\n' +
      'NEVER list: jokes, banter, hype, or trash-talk (e.g. "I\'m gonna throw some real chaos at you" is banter, ' +
      'not an idea); emotional or rhetorical remarks; vague intentions with no concrete subject; compliments or ' +
      'complaints; meta-comments about you or this conversation; hypotheticals raised only to make a point; ' +
      'anything already done here; or your own suggestions — only work the COMMANDER asked for or described wanting.\n' +
      'For EACH thread reply EXACTLY:\nTHREAD: <short title of the work>\n' +
      'QUOTE: <verbatim words the Commander used — copy word-for-word from the text; never paraphrase or invent>\n' +
      'DO: <the concrete first deliverable someone could produce for it>\n' +
      'CONFIDENCE: <high | medium | low — that the Commander would genuinely want this picked up>\n' +
      'List at most 2, best first. Most conversations contain NO real threads — when in doubt, reply NONE.\n' +
      /* ALREADY-TRACKED RIDES THE PROMPT (2026-08-05). mine() has always held a fingerprint map of every live
         thread and every permanently-declined one — and used it ONLY to drop candidates after the reply landed.
         A long conversation that re-mentions a thread already on the board therefore paid for a mining call that
         could only ever return duplicates. The model gets the list now. The post-hoc fingerprint filter is
         untouched and still authoritative — it is the thing that actually protects the board, and it also covers
         the DECLINED half, which is stored as fingerprints with no title to show and so cannot be listed here. */
      knownBlock(knownTitles) + '\n' + body;
    return { prompt: prompt, conversation: body, userText: userTurns.join('\n') };
  }

  // parse the model reply into { title, quote, starter, confidence } candidates. A THREAD line opens a block; the
  // QUOTE / DO / CONFIDENCE lines that follow fill it. Untagged lines are ignored (conservative — no tag, no data).
  function parse(raw) {
    const out = [];
    const lines = String(raw == null ? '' : raw).split('\n');
    let cur = null;
    for (const ln of lines) {
      const tm = THREAD_LINE.exec(ln);
      if (tm) { if (cur && cur.title) out.push(cur); cur = { title: tm[1].trim(), quote: '', starter: '', confidence: '' }; continue; }
      if (!cur) continue;
      const qm = QUOTE_LINE.exec(ln);
      if (qm) { if (!cur.quote) cur.quote = qm[1].trim(); continue; }
      const dm = DO_LINE.exec(ln);
      if (dm) { if (!cur.starter) cur.starter = dm[1].trim(); continue; }
      const cm = CONF_LINE.exec(ln);
      if (cm) { if (!cur.confidence) cur.confidence = cm[1].toLowerCase(); continue; }
    }
    if (cur && cur.title) out.push(cur);
    return out;
  }

  /* mine(run, opts) -> { proposals[], prompt }
     run  : { agentId, runId, messages, streamId?, date? }
     opts : { propose, clock, redact?, known?:{fp:reason}, max? }
       · propose — injected aux-model fn(prompt)->text (may throw; a failed mine never hurts the run).
       · clock   — { now() } injected (deterministic timestamps).
       · redact  — secret scrubber applied to title + quote (defense in depth).
       · known   — fingerprint→reason map from threadsStore.knownFingerprints() (live threads + declined denylist);
                   a candidate whose fingerprint is present is dropped (dedup at the source, like study's declined).
       · knownTitles — the READABLE titles of the live threads (threadsStore.read().threads). Listed in the prompt
                   so the model does not spend the call re-mining the board. Titles only: the declined half is
                   stored as bare fingerprints, so it has nothing to show and stays post-hoc-only (honestly).
       · max     — cap on proposals.
     proposals: { id, title, spec (the quote), fingerprint, sourceRef, sourceRunId, createdAt }. */
  async function mine(run, opts) {
    run = run || {}; opts = opts || {};
    const clock = opts.clock || { now: () => 0 };
    const redact = typeof opts.redact === 'function' ? opts.redact : (x => x);
    const max = Number.isFinite(opts.max) ? opts.max : DEFAULT_MAX;
    const known = (opts.known && typeof opts.known === 'object') ? opts.known : {};
    const propose = opts.propose;
    if (typeof propose !== 'function') return { proposals: [] };

    const built = buildPrompt(run.messages, PROMPT_CAP, opts.knownTitles);
    const convo = normText(built.conversation);   // the haystack for the verbatim-quote veto
    const spoken = normText(built.userText || '');   // the Commander's OWN words (the "you said" bar)
    let raw;
    try { raw = await propose(built.prompt); } catch (_) { return { proposals: [], prompt: built.prompt }; }

    const now = clock.now();
    const seen = {};                 // fingerprints accepted THIS batch (intra-batch dedup)
    const proposals = [];
    for (const cand of parse(raw)) {
      let title = redact(String(cand.title || '')).trim();
      let quote = redact(String(cand.quote || '')).trim();
      if (title.length > MAX_TITLE) title = title.slice(0, MAX_TITLE - 1) + '…';
      if (quote.length > MAX_SPEC) quote = quote.slice(0, MAX_SPEC - 1) + '…';
      if (title.length < MIN_TITLE) continue;                         // value floor
      // THE GROUNDING VETO: the quote must be substantial AND actually appear in the conversation. An invented
      // idea has no real quote, so it never survives. (Redaction can mangle a quote that was pure secret — that's
      // fine, such a "thread" shouldn't be minted anyway.)
      const nq = normText(quote);
      if (nq.length < MIN_QUOTE || convo.indexOf(nq) < 0) continue;
      // THE SUBSTANCE VETO (post-escape 2026-07-08: banter minted as a thread): grounded is not enough — the model
      // must also name a concrete deliverable (DO:) and stake HIGH confidence the Commander wants it picked up.
      // A joke/hype line can pass the quote check (it was really said); it cannot honestly carry a deliverable +
      // high confidence, and anything below that bar is not worth interrupting the Commander to ask about.
      const starter = redact(String(cand.starter || '')).trim();
      if (starter.length < MIN_DO) continue;
      if (String(cand.confidence || '').toLowerCase() !== 'high') continue;
      const fp = fingerprint(title);
      if (!fp) continue;
      if (seen[fp]) continue;                                         // intra-batch dupe
      if (known[fp]) continue;                                        // already a live thread OR permanently declined
      seen[fp] = 1;
      proposals.push({
        id: 'thread_' + (proposals.length + 1),
        title: title, spec: quote, starter: starter, fingerprint: fp,
        // WHO said it: 'user' only when the quote is located in the Commander's own turns. The turn-in card cites
        // anything else as "from the conversation" rather than putting the agent's words in the Commander's mouth.
        speaker: (nq && spoken.indexOf(nq) >= 0) ? 'user' : 'other',
        sourceRef: { streamId: run.streamId || null, runId: run.runId || null, date: now },
        sourceRunId: run.runId || null, createdAt: now
      });
      if (proposals.length >= max) break;
    }
    return { proposals: proposals, prompt: built.prompt };
  }

  // SALIENCE GATE — is this run worth one mining call? Reuses the "real exchange" shape reflect.reflectSalient
  // uses (a user turn + a reply OR real tool work), so mining rides the same isTask/done/salience gate. Ideas
  // surface in substantive conversation, so the char floor matters; a trivial "thanks" run never burns a call.
  const MIN_MINE_CHARS = 200;   // matches reflect's real-exchange floor; ideas surface in substantive conversation
  function mineSalient(messages) {
    const arr = Array.isArray(messages) ? messages : [];
    let chars = 0, hasUser = false, hasAgent = false, tools = false;
    for (const m of arr) {
      if (!m) continue;
      if (m.role === 'tool' || (Array.isArray(m.tool_calls) && m.tool_calls.length)) tools = true;
      if (typeof m.content !== 'string') continue;
      if (m.role === 'user') { hasUser = true; chars += m.content.length; }
      else if (m.role === 'assistant') { hasAgent = true; chars += m.content.length; }
    }
    if (!hasUser || (!hasAgent && !tools)) return false;
    return chars >= MIN_MINE_CHARS;
  }

  return { mine, buildPrompt, parse, mineSalient, fingerprint, normText, DEFAULT_MAX, MIN_MINE_CHARS };
});
