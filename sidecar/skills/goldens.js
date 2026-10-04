/* sidecar/skills/goldens.js — GOLDENS PER SKILL (consistency loop, slice 4, 2026-08-22).

   "Consistency" only matters once the Commander is satisfied: a `great` verdict FREEZES what they liked, a
   `miss` REWRITES the procedure (skillreview.js). This module is the freeze half — pure, clock-injected,
   no filesystem: index.js owns the file, scripts/eval/skills.mjs owns the runner.

   A golden = one great-rated run, reduced to what a later run of the same directive can be measured against:
     { id, skillId, agentId, runId, directive, reference: { text (capped), words, chars, keywords[] }, mintedAt }
   check(golden, outputText) is DETERMINISTIC and model-free: the candidate must land within a length band of
   the reference and share enough of the reference's distinctive keywords (bag-of-words overlap). That is an
   honest *shape + content* consistency measure — it is NOT a judgment of quality (the Commander already gave
   that: `great`). Thresholds are explicit and reported alongside the verdict, never hidden in a boolean. */
'use strict';

const STOP = new Set(('a an the and or but if then than that this those these of to in on at by for with from as is are was were be been being it its ' +
  'i you he she we they me him her us them my your our their not no yes do does did done have has had will would can could should may might ' +
  'so such very just also more most less least only own same other into over under again further here there when where why how all any both each ' +
  'few some such out up down off about above below between through during before after while because until').split(/\s+/));

const REF_TEXT_CAP = 4000;
const MAX_KEYWORDS = 40;
const MAX_GOLDENS_PER_SKILL = 5;

function str(v) { return v == null ? '' : String(v); }
function words(text) { return str(text).toLowerCase().replace(/[`*_#>|\[\]()]/g, ' ').split(/[^a-z0-9%$.-]+/).map(w => w.replace(/^[.-]+|[.-]+$/g, '')).filter(w => w.length >= 3 && !STOP.has(w)); }
function wordCount(text) { return str(text).trim() ? str(text).trim().split(/\s+/).length : 0; }

// the reference's DISTINCTIVE vocabulary: most frequent content words, ties by first appearance (deterministic).
function keywordsOf(text, max) {
  const freq = new Map(); let i = 0;
  for (const w of words(text)) { const r = freq.get(w); if (r) r.n++; else freq.set(w, { n: 1, first: i++ }); }
  return Array.from(freq.entries()).sort((a, b) => (b[1].n - a[1].n) || (a[1].first - b[1].first)).slice(0, max || MAX_KEYWORDS).map(e => e[0]);
}

/* mint — turn a great-rated run into a golden. Returns null when there is nothing measurable (no directive or
   an output too short to carry shape). `now` is injected. */
function mint(input, now) {
  input = input || {};
  const directive = str(input.directive).replace(/\s+/g, ' ').trim();
  const text = str(input.outputText).trim();
  if (!directive || wordCount(text) < 8) return null;
  const ref = text.slice(0, REF_TEXT_CAP);
  return {
    id: 'g_' + str(input.runId || '').slice(0, 12) + '_' + (Number.isFinite(now) ? now : 0),
    skillId: str(input.skillId), agentId: str(input.agentId || 'agent'), runId: str(input.runId),
    directive: directive.slice(0, 600),
    reference: { text: ref, words: wordCount(text), chars: text.length, keywords: keywordsOf(text) },
    mintedAt: Number.isFinite(now) ? now : 0
  };
}

/* check — grade a candidate output against a golden. Deterministic; thresholds explicit.
     lengthRatio  = candidate words / reference words   (pass band: [0.5, 1.6] — a great 150-word brief that comes
                    back at 400 words is not the same deliverable, even if every fact is right)
     overlap      = |candidate keywords ∩ reference keywords| / |reference keywords|   (pass: ≥ 0.35) */
const LENGTH_MIN = 0.5, LENGTH_MAX = 1.6, OVERLAP_MIN = 0.35;
function check(golden, outputText, opts) {
  opts = opts || {};
  const lengthMin = Number.isFinite(opts.lengthMin) ? opts.lengthMin : LENGTH_MIN;
  const lengthMax = Number.isFinite(opts.lengthMax) ? opts.lengthMax : LENGTH_MAX;
  const overlapMin = Number.isFinite(opts.overlapMin) ? opts.overlapMin : OVERLAP_MIN;
  const ref = golden && golden.reference ? golden.reference : null;
  if (!ref || !Array.isArray(ref.keywords) || !ref.keywords.length || !(ref.words > 0)) return { pass: false, reason: 'golden has no measurable reference', lengthRatio: 0, overlap: 0 };
  const out = str(outputText);
  const cw = wordCount(out);
  const lengthRatio = cw / ref.words;
  const cset = new Set(words(out));
  let hit = 0; for (const k of ref.keywords) if (cset.has(k)) hit++;
  const overlap = hit / ref.keywords.length;
  const lengthOk = lengthRatio >= lengthMin && lengthRatio <= lengthMax;
  const overlapOk = overlap >= overlapMin;
  const reasons = [];
  if (!lengthOk) reasons.push('length ' + cw + 'w vs reference ' + ref.words + 'w (ratio ' + lengthRatio.toFixed(2) + ', band ' + lengthMin + '–' + lengthMax + ')');
  if (!overlapOk) reasons.push('keyword overlap ' + (overlap * 100).toFixed(0) + '% < ' + (overlapMin * 100).toFixed(0) + '%');
  return { pass: lengthOk && overlapOk, lengthRatio: Number(lengthRatio.toFixed(3)), overlap: Number(overlap.toFixed(3)), candidateWords: cw, reason: reasons.join('; ') };
}

/* fold — add a golden to a skill's list; newest first, capped, one per runId. Pure (returns a new array). */
function fold(list, golden) {
  const cur = Array.isArray(list) ? list.filter(g => g && g.runId !== golden.runId) : [];
  return [golden].concat(cur).slice(0, MAX_GOLDENS_PER_SKILL);
}

module.exports = { mint, check, fold, keywordsOf, words, wordCount, REF_TEXT_CAP, MAX_KEYWORDS, MAX_GOLDENS_PER_SKILL, LENGTH_MIN, LENGTH_MAX, OVERLAP_MIN };
