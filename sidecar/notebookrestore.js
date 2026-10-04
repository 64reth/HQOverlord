/* sidecar/notebookrestore.js — pure helpers for restoring an agent's memory from a backup (M-save P2).

   A browser cache wipe does NOT touch the notebook (it lives on the sidecar's disk). But MOVING an agent to
   a fresh machine — export a backup on A, import it on B — needs the memory to come along, or the moved agent
   has identity + XP but amnesia. The export bundle (backup.js) carries a snapshot of the notebook; this module
   folds it back in.

   Two pure functions, no I/O (the route does the fs via notebookStore):
     sanitizeNotes(arr)            -> well-formed [{id,title,body,ts, ...}]   (drops junk, fills missing ids)
     mergeNotes(existing, incoming)-> existing ∪ incoming, keyed by id, ADDITIVE: an incoming note whose id is
                                      already present is IGNORED, never overwrites. So an import can only ADD
                                      memory the target lacks — it can never destroy or mutate notes the agent
                                      already formed. (Restore onto a fresh machine = empty target = full copy.)

   Deterministic: ids for note-without-id are derived from (ts, index), never rng — replays identically. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.notebookrestore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function sanitizeNotes(arr) {
    if (!Array.isArray(arr)) return [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const n = arr[i];
      if (!n || typeof n !== 'object') continue;
      const title = typeof n.title === 'string' ? n.title : '';
      const body = typeof n.body === 'string' ? n.body : '';
      if (!title && !body) continue;   // an empty note carries nothing — drop it
      const ts = Number.isFinite(Number(n.ts)) ? Number(n.ts) : 0;
      const id = (typeof n.id === 'string' && n.id) ? n.id : ('mem_r' + ts + '_' + i);   // deterministic fallback id
      // preserve any richer cortex fields the bundle happens to carry, but normalize the four core ones
      out.push(Object.assign({}, n, { id: id, title: title, body: body, ts: ts }));
    }
    return out;
  }

  // ADDITIVE union by id: existing always wins on a collision (never clobber memory formed since the backup).
  function mergeNotes(existing, incoming) {
    const ex = sanitizeNotes(existing);
    const inc = sanitizeNotes(incoming);
    const seen = new Set();
    const merged = [];
    for (const n of ex) { if (!seen.has(n.id)) { seen.add(n.id); merged.push(n); } }
    for (const n of inc) { if (!seen.has(n.id)) { seen.add(n.id); merged.push(n); } }   // only ids the target lacks
    return merged;
  }

  return { sanitizeNotes, mergeNotes };
});
