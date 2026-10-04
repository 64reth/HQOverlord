/* sidecar/output-continuation.js — pure helpers for semantic output-limit continuation.
   A provider finish reason of `length` means the response is valid but incomplete. These helpers keep the
   retry policy bounded and remove a repeated prefix when the next generation restates the tail it was given. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.outputContinuation = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_MAX = 4;
  const MAX_OVERLAP_SCAN = 8192;
  const MIN_OVERLAP = 12;

  function maxFor(limits) {
    const setting = limits && limits.outputContinuation;
    if (setting === false) return 0;
    const raw = setting && typeof setting === 'object' ? setting.max : null;
    if (raw == null) return DEFAULT_MAX;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(16, Math.floor(n))) : DEFAULT_MAX;
  }

  function shouldContinue(finishReason, used, max) {
    return finishReason === 'length' && used < max;
  }

  function prompt(hadPartialToolCall) {
    const toolNote = hadPartialToolCall
      ? ' A tool call was cut off and was NOT executed. Reissue the complete tool call through the tool API; do not continue or assume the partial arguments.'
      : '';
    return '<output_continuation>The provider reached its output-token limit. Continue exactly where the previous response ended. Do not repeat text already produced.' + toolNote + '</output_continuation>';
  }

  // Return only the novel suffix of `next`. Models commonly restart the last sentence after a max-token stop;
  // the Commander has already seen that suffix in the live stream, so replaying it would corrupt the answer.
  function novelText(previous, next) {
    const before = String(previous == null ? '' : previous);
    const after = String(next == null ? '' : next);
    if (!before || !after) return { text: after, removed: 0 };
    // Some providers restart the whole response rather than only its last sentence. Check
    // that exact prefix before the bounded tail scan; startsWith adds no second unbounded
    // buffer and avoids duplicating an answer merely because it is larger than the scan cap.
    if (after.length >= before.length && after.startsWith(before)) {
      return { text: after.slice(before.length), removed: before.length };
    }
    const scan = before.slice(-MAX_OVERLAP_SCAN);
    const max = Math.min(scan.length, after.length);
    let overlap = 0;
    for (let n = max; n >= MIN_OVERLAP; n--) {
      if (scan.slice(scan.length - n) === after.slice(0, n)) { overlap = n; break; }
    }
    return { text: after.slice(overlap), removed: overlap };
  }

  // Preserve the provider's original token chunk boundaries after removing an overlap prefix.
  function novelChunks(chunks, removed) {
    const out = [];
    let skip = Math.max(0, Number(removed) || 0);
    for (const raw of (chunks || [])) {
      const chunk = String(raw == null ? '' : raw);
      if (!chunk) continue;
      if (skip >= chunk.length) { skip -= chunk.length; continue; }
      const kept = skip ? chunk.slice(skip) : chunk;
      skip = 0;
      if (kept) out.push(kept);
    }
    return out;
  }

  return { DEFAULT_MAX, maxFor, shouldContinue, prompt, novelText, novelChunks };
});
