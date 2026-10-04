/* Host-side policy for Task Brief decisions. This is the reliability boundary: models may
   propose a question or a settled brief, but only this module decides whether it is usable. */
'use strict';
const TaskIntent = require('../frontend/app/fork.js').TaskIntent;   // the shared decision-protocol module (index.js already speaks it)
const Context = require('./taskbrief-context.js');

const DIMENSIONS = new Set(['objective', 'audience', 'deliverable', 'scope', 'constraints', 'sources', 'acceptance', 'safety']);
const VAGUE = /\b(what does good look like|tell me more|can you elaborate|any preferences|what do you want|how should i proceed)\b/i;
const CANCEL = /^\s*(cancel|stop|never\s*mind|nevermind|forget\s+(?:it|that)|drop\s+(?:it|that))\s*[.!]?\s*$/i;
const REPLACE = /^\s*(?:new\s+task\s*:|instead\s*,?|forget\s+that\s*[,;:]?|change\s+of\s+plan\s*[:,]?)\s*(.+)$/i;

function clean(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }

// RECOMMENDATION MATCHING (2026-07-24). The model writes `recommended` as free text and near-misses its own
// option list constantly — a trailing period, a leading article, a smart quote, an "A." enumerator. Requiring
// byte-equality made every one of those a HARD REJECT, and because brief_ask is a hidden tool the failure was
// invisible in both the transcript and the logs; the retry advice then steers the model to the plain marker
// path, which stores NO recommendation at all. So a formatting slip silently cost the Commander the ★ chip and
// looked identical to "the agent had no opinion".
// Matching is EQUALITY-ONLY, on the normalized form. It always returns the CANONICAL option text.
//
// A substring tier used to live here to rescue enumerators ("A. keep it" vs "keep it"). It was removed
// 2026-07-24 after review: substring containment silently INVERTS negations, because the negated option
// contains the positive one but not the reverse. Every one of these resolved to the OPPOSITE of the intent:
//     ["publish" | "do not publish"]      + "don't publish"        -> "publish"
//     ["include tests" | "skip tests"]    + "do not include tests" -> "include tests"
//     ["operators" | "executives"]        + "not operators"        -> "operators"
// The per-tier uniqueness guard could not catch it — exactly one option matches, it is just the wrong one.
// Enumerator prefixes are handled inside `loosen` instead (fork.js), which is meaning-preserving. Anything
// that is not an equality match after normalization is a genuine miss and fails closed.
const loosen = TaskIntent.loosen;
function matchOption(options, candidate) {
  const list = Array.isArray(options) ? options.filter(Boolean) : [];
  const c = clean(candidate, 72);
  if (!list.length || !c) return '';
  const exact = list.find(o => o.toLowerCase() === c.toLowerCase());
  if (exact) return exact;                                        // tier 1 — unchanged legacy behaviour
  const lc = loosen(c);
  if (!lc) return '';
  const near = list.filter(o => loosen(o) === lc);                // tier 2 — punctuation/quote/article/enumerator
  return near.length === 1 ? near[0] : '';                        // ambiguous or absent -> fail closed
}
function routeReply(text, explicit) {
  const raw = clean(text, 4000);
  const action = clean(explicit, 16).toLowerCase();
  if (action === 'cancel') return { action: 'cancel', text: raw };
  if (action === 'replace') return { action: 'replace', text: raw };
  if (action === 'answer') return { action: 'answer', text: raw };
  if (CANCEL.test(raw)) return { action: 'cancel', text: raw };
  const m = REPLACE.exec(raw);
  if (m && clean(m[1], 4000)) return { action: 'replace', text: clean(m[1], 4000) };
  return { action: 'answer', text: raw };
}

// Per-question field rules, shared by the single and batched paths. `call` carries call-level
// attestations (discoverable) so a batch attests once, not per item.
function validateQuestionFields(c, call) {
  const dimension = clean(c.dimension, 24).toLowerCase();
  const question = clean(c.question || c.text, 240);
  // Dedupe on the LOOSENED form: exact-string dedupe let "operators" / "operators." / "the operators" through
  // as three distinct chips, which is the same choice offered three times dressed as a real decision. Collapsing
  // them means such a question now fails the >=2 check below instead of rendering a fake trilemma.
  const multiSelect = c.multiSelect === true;
  const options = TaskIntent.dedupeOptions(c.options, TaskIntent.maxOptionsFor(multiSelect));
  const recommended = clean(c.recommended || c.defaultOption, 72);
  const reason = clean(c.reason, 240);
  if (!DIMENSIONS.has(dimension)) return { ok: false, error: 'dimension must be one of: ' + Array.from(DIMENSIONS).join(', ') };
  if (!question || VAGUE.test(question)) return { ok: false, error: 'ask one concrete, non-vague question' };
  const conversational = c.mode === 'conversation';
  if (!conversational && options.length < 2) return { ok: false, error: multiSelect ? 'provide 2-6 genuinely different options' : 'provide 2-3 genuinely different options' };
  const pick = matchOption(options, recommended);
  if ((!conversational || recommended) && !pick) return { ok: false, error: 'recommended must match one option (copy it verbatim from options)' };
  if (!reason) return { ok: false, error: 'state why this decision materially changes the result' };
  if ((call || c).discoverable !== false) return { ok: false, error: 'inspect available context first; discoverable must be false' };
  return { ok: true, question: { dimension, question, text: question, options, recommended: pick, reason,
    multiSelect, newBlocker: (call || c).newBlocker === true,
    mode:conversational ? 'conversation' : 'choice', sample:conversational ? String(c.sample || '').trim().slice(0,2400) : '' } };
}
// How many brief_ask calls this brief has spent. Legacy briefs persisted before batching carry no
// askCalls field; for them every stored question WAS its own call, so the count is the honest backfill.
function askCallsOf(brief) {
  const n = brief && Number(brief.askCalls);
  if (Number.isFinite(n) && n > 0) return n;
  return brief && Array.isArray(brief.questions) ? brief.questions.length : 0;
}
// The budget is now counted in ASK CALLS (interruptions), not questions: one call may bundle up to
// three questions on distinct dimensions, so related unknowns cost the Commander ONE moment, not three.
function validateQuestions(candidate, brief) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const extra = Array.isArray(c.also) ? c.also : [];
  const raw = [c].concat(extra).filter(x => x && typeof x === 'object');
  if (raw.length > 3) return { ok: false, error: 'ask at most 3 questions in one call — keep only the material ones' };
  const prior = brief && Array.isArray(brief.questions) ? brief.questions : [];
  const calls = askCallsOf(brief);
  if (c.mode === 'conversation') {
    if(raw.length !== 1) return {ok:false,error:'Ask one conversational question, then listen before choosing the next.'};
    if(prior.some(q=>!q.answer)) return {ok:false,error:'Wait for the pending answer before asking again.'};
    if(Context.delegate(brief && brief.originalDirective) || prior.some(q=>Context.delegate(q.answer)))
      return {ok:false,error:'The Commander delegated the remaining choices. Update your understanding and proceed with reversible assumptions.'};
    if(calls >= 6) return {ok:false,error:'Stop discovery now. Produce a useful draft or proceed with stated assumptions; do not keep interviewing.'};
    if(calls && !Context.current(brief)) return {ok:false,error:'Call brief.update to incorporate the entire latest answer before choosing a follow-up.'};
    if(prior.some(q=>clean(q.text,240).toLowerCase()===clean(c.question,240).toLowerCase()))
      return {ok:false,error:'This question was already asked. Use the answer or choose the next useful action.'};
    const v=validateQuestionFields(c,c); return v.ok ? {ok:true,questions:[v.question]} : v;
  }
  if (calls >= 2) return { ok: false, error: 'this task already used its two-question limit' };
  if (calls === 1 && (c.newBlocker !== true || prior.some(q => !q.answer))) return { ok: false, error: 'a second question requires an answered first question and a newly exposed blocker' };
  const out = []; const dims = new Set();
  for (const q of raw) {
    const v = validateQuestionFields(q, c);
    if (!v.ok) return v;
    if (dims.has(v.question.dimension)) return { ok: false, error: 'each bundled question must cover a DIFFERENT dimension — merge same-dimension unknowns into one question' };
    dims.add(v.question.dimension);
    out.push(v.question);
  }
  return { ok: true, questions: out };
}
function validateQuestion(candidate, brief) {
  const r = validateQuestions(candidate && typeof candidate === 'object' ? Object.assign({}, candidate, { also: [] }) : candidate, brief);
  return r.ok ? { ok: true, question: r.questions[0] } : r;
}

/* TASTE-FILLER CEILING (2026-08-14, live-caught by Andrew). The doctrine used to order a STYLE + TONE +
   AESTHETIC read on EVERY task, so "can you see my PC specs?" — a lookup with no authored artifact and no
   look to choose — produced three invented chips ("Style: brief, direct, and practical", "Tone: friendly
   with a small spark", "Aesthetic: plain readable summary") and buried the one real assumption (omitting
   serial numbers) at the bottom. The directive now makes taste CONDITIONAL, but a prompt is a hope; this is
   the boundary. Two conservative rules, both fail-open — an assumption is never destroyed on a guess:
     1. a labelled taste line whose every word is generic filler is a restatement of our own defaults, not
        a decision the Commander can overturn — drop it;
     2. taste is at most ONE line of a read, never its body — keep the first, drop the rest.
   An unlabelled assumption, or one carrying task-specific words, is left completely alone. */
const TASTE_LABEL = /^(?:style|tone|aesthetic|voice|register|presentation|formatting)\s*[:—-]\s*(.+)$/i;
const GENERIC_WORD = new Set(('a an the and or but not no with without very quite fairly rather somewhat small light subtle extra much more less over under any all its is are be stay keep remain use using it i will its'
  + ' brief short concise direct practical clear plain readable legible scannable simple straightforward'
  + ' friendly warm approachable polite respectful natural human calm neutral professional helpful honest'
  + ' accurate factual technical informative organized structured clean minimal tidy easy accessible'
  + ' conversational casual summary report answer prose text spark ceremony fluff jargon decoration'
  + ' unnecessary elaborate decorative flowery verbose formal informal nonsense point matter fact tone style').split(/\s+/));
function tasteFiller(s) {
  const m = TASTE_LABEL.exec(String(s == null ? '' : s).trim());
  if (!m) return false;                                   // unlabelled -> never touched
  const words = m[1].toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every(w => GENERIC_WORD.has(w));
}
function isTaste(s) { return TASTE_LABEL.test(String(s == null ? '' : s).trim()); }
function trimAssumptions(list) {
  const kept = []; let taste = 0;
  for (const a of list) {
    if (tasteFiller(a)) continue;                         // rule 1: our own defaults, restated
    if (isTaste(a)) { if (taste >= 1) continue; taste++; }  // rule 2: taste is a line, not the body
    kept.push(a);
  }
  return kept;
}

function validateProceed(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const objective = clean(c.objective, 500);
  if (objective.length < 4) return { ok: false, error: 'objective is required before consequential work' };
  const out = { objective };
  for (const k of ['deliverable', 'audience', 'success']) { const v = clean(c[k], 500); if (v) out[k] = v; }
  out.assumptions = Array.isArray(c.assumptions) ? trimAssumptions(c.assumptions.map(x => clean(x, 300)).filter(Boolean)).slice(0, 8) : [];
  out.sources = Array.isArray(c.sources) ? c.sources.map(x => clean(x, 300)).filter(Boolean).slice(0, 8) : [];
  return { ok: true, brief: out };
}

function canMutate(brief, tool) {
  if (!brief || !tool) return { ok: true };
  // Built-in reads are non-consequential, but MCP tools are deliberately `external-unknown` even when an
  // untrusted server advertises readOnlyHint. That annotation may shape grants; it cannot bypass the brief gate.
  if (tool.scope === 'read' && tool.impact !== 'external-unknown') return { ok: true };
  return brief.status === 'executing'
    ? { ok: true }
    : { ok: false, reason: 'settle the Task Brief with brief_proceed, or ask the one material question with brief_ask, before consequential work' };
}

module.exports = { DIMENSIONS, routeReply, validateQuestion, validateQuestions, askCallsOf, validateProceed, canMutate, clean, matchOption, tasteFiller, trimAssumptions, maxOptionsFor: TaskIntent.maxOptionsFor };
