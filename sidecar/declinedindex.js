/* sidecar/declinedindex.js — the SHARED DECLINED INDEX (NS-8 lite): a read-side unification of the per-engine
   declined/denylist collections, so an idea the Commander EXPLICITLY declined in ONE surface is not re-proposed in
   ANOTHER. Each engine still WRITES its own store (no migration, no shared event) — this only READS them at
   propose-time and answers one question: "did the user already wave this exact idea off somewhere?"

   THE PROBLEM THIS CLOSES: reflection, study, thread-mining, the scout, and the quest refresher each kept their own
   decline/denylist, deduped only against THEMSELVES. So a belief discarded at a memory turn-in could come straight
   back as a mined thread; a north star declined in the quest panel could reappear as a study belief. This index is
   the cross-engine read-side that every propose-time filter consults in addition to its own store.

   NORMALIZATION: lowercase, punctuation (and any non-alphanumeric) → space, collapse whitespace, trim. EXACT
   normalized-key match ONLY — no fuzzy / token-overlap matching. A FALSE suppression (silently dropping a
   legitimately different idea) is worse than an occasional duplicate, so the bar is a byte-exact normalized key.

   ONLY EXPLICIT DECLINES: the host feeds it user-decline collections only (notebook declined:, studyDeclined,
   declined thread titles, quest deniedTitles, declined north stars) — NEVER TTL expiries. Scout drafts expire
   WITHOUT denylisting (an interest may legitimately recur); that non-suppression is deliberately preserved because
   an expiry is never handed to this index.

   PURE: a transform over the passed-in text lists — no clock/rng/fs/network (lint-determinism-clean, node-testable).
   The ambient half (reading each engine's store) lives ONLY in sidecar/index.js (buildDeclinedIndex). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).declinedIndex = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // normalize one candidate to its match key: lowercase, every non-alphanumeric run → single space, trim. '' means
  // "no key" — an empty / punctuation-only candidate never matches anything (fail toward NOT suppressing).
  function normKey(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')   // strip punctuation/unicode to spaces — EXACT normalized match, no token fuzz
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* build — fold any number of declined-text collections into ONE normalized key Set. `lists` is an array of arrays
     (each inner array = one engine's declined TEXTS: belief lines, thread/quest titles, north-star text). Non-array
     collections, and non-string / empty entries, are skipped. Returns an index: { has(text), size, keys() }. */
  function build(lists) {
    const keys = new Set();
    const src = Array.isArray(lists) ? lists : [];
    for (const list of src) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item !== 'string') continue;   // declined stores hold TEXT — skip non-strings (never coerce a number/object into a phantom key)
        const k = normKey(item);
        if (k) keys.add(k);
      }
    }
    return {
      // has(candidateText) — true iff the candidate normalizes to a key some engine EXPLICITLY declined. An empty
      // normalized candidate is NEVER a hit (never suppress on nothing).
      has: function (text) { const k = normKey(text); return !!k && keys.has(k); },
      size: keys.size,
      keys: function () { return Array.from(keys); }
    };
  }

  return { build: build, normKey: normKey };
});
