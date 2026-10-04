/* sidecar/routing/verdict.js — the VERDICT channel for LOOP gates (2026-08-22).

   A reviewer dock that sits before a LOOP gate ends its output with ONE line:
       VERDICT: approved        (the crate leaves on the DONE lane)
       VERDICT: revise          (the crate goes back round)
   parseVerdict() is the ONLY reader of that line. It is deliberately tolerant of what models actually emit —
   case, markdown emphasis (**VERDICT: Approved**), a trailing period, a bullet/quote prefix, a blank line or
   two after it — and deliberately strict about WHERE: the line must be among the LAST few non-empty lines,
   so a reviewer quoting "VERDICT: approved" in its reasoning does not pass its own draft by accident.
   PURE: strings in, a word or null out. No module state, no clock. */
'use strict';

const VERDICT_WORDS = ['approved', 'revise'];
// synonyms the model may reach for; each maps to the ONE canonical word the gate compares against
const SYN = { approved: 'approved', approve: 'approved', accepted: 'approved', pass: 'approved', lgtm: 'approved',
              revise: 'revise', revision: 'revise', rejected: 'revise', reject: 'revise', 'needs-work': 'revise', 'needs_work': 'revise' };
const TAIL_LINES = 3;   // how many trailing non-empty lines may carry the verdict

function isVerdictWord(w) { return typeof w === 'string' && VERDICT_WORDS.indexOf(w.toLowerCase()) >= 0; }

/* parseVerdict(text) -> 'approved' | 'revise' | null. The LAST verdict line within the tail wins. */
function parseVerdict(text) {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const tail = lines.slice(-TAIL_LINES);
  for (let i = tail.length - 1; i >= 0; i--) {
    // strip markdown / list / quote dressing on both ends
    const l = tail[i].replace(/^[\s>*\-_`#]+/, '').replace(/[\s*_`.!]+$/, '');
    const m = /^verdict\s*[:=\-–—]\s*([A-Za-z][A-Za-z_-]*)/i.exec(l);
    if (!m) continue;
    const w = SYN[m[1].toLowerCase().replace(/\s+/g, '-')];
    if (w) return w;
  }
  return null;
}

/* verdictBrief(when) -> the instruction a reviewer dock receives when its lane meets a LOOP gate keyed on a
   verdict word; '' when the gate is not verdict-keyed. Prompt text only. */
function verdictBrief(when) {
  if (!isVerdictWord(when)) return '';
  const other = when.toLowerCase() === 'approved' ? 'revise' : 'approved';
  return 'YOUR VERDICT DECIDES THE LOOP GATE AFTER YOU: end your reply with one final line, exactly '
    + '"VERDICT: ' + when.toLowerCase() + '" when the work should leave the loop, or "VERDICT: ' + other + '" when it should go '
    + 'back round. Nothing after that line. A reply with no VERDICT line is treated as "' + other + '".';
}

module.exports = { parseVerdict, isVerdictWord, verdictBrief, VERDICT_WORDS };
