/* sidecar/skills/prefs.js — persistence of the user's ENABLE/DISABLE choices for bundled library skills.

   Append-only JSONL folded to latest-per-slug — same discipline as skillstore.js (the host owns the fsync'd disk
   append via an injected `io`). STATION-WIDE: a choice applies to every agent. Per-AGENT availability is NOT here
   — that's the capability gate (catalog.isAvailable, derived from placed objects), kept deliberately separate so
   "is this recipe turned on" and "can this desk run it" stay orthogonal. Fail-open: a persistence hiccup never
   crashes a run; the in-memory mirror still answers. PURE given io+clock (no Date/Math.random/fs of its own). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).skillsPrefs = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function makeSkillPrefs(opts) {
    opts = opts || {};
    const io = opts.io || { readAll() { return []; }, append() {} };
    const clock = opts.clock || { now() { return 0; } };
    const map = new Map();   // slug -> bool (the explicit user choice; absence ⇒ fall back to the skill's frontmatter default)
    try { const raw = io.readAll(); if (Array.isArray(raw)) for (const r of raw) { if (r && typeof r.slug === 'string') map.set(r.slug, !!r.enabled); } }
    catch (_) { /* corrupt log -> no overrides (defaults win) */ }

    function set(slug, enabled) {
      slug = String(slug || '').trim();
      if (!slug) return { ok: false, error: 'a skill slug is required' };
      const e = !!enabled;
      map.set(slug, e);
      try { io.append({ slug: slug, enabled: e, at: clock.now() }); } catch (_) { /* persistence failure must never crash a run */ }
      return { ok: true, slug: slug, enabled: e };
    }
    function overrides() { const o = {}; for (const [k, v] of map) o[k] = v; return o; }

    /* compact — rewrite the JSONL keeping ONLY the latest choice per slug (`map` already holds exactly that).
       Bounds a file that a user toggling the same recipe repeatedly would otherwise grow without limit. Needs an
       io that can atomically replace the whole file (io.rewrite); without it, a no-op (the bounded boot loader
       still caps memory). Never throws. Returns { ok, kept }. */
    function compact() {
      const entries = []; for (const [slug, enabled] of map) entries.push({ slug: slug, enabled: enabled, at: clock.now() });
      if (!io || typeof io.rewrite !== 'function') return { ok: false, reason: 'io has no rewrite', kept: entries.length };
      try { io.rewrite(entries); return { ok: true, kept: entries.length }; }
      catch (e) { return { ok: false, reason: (e && e.message) || 'rewrite failed', kept: entries.length }; }
    }

    return { set, overrides, compact, get(slug) { return map.get(slug); }, has(slug) { return map.has(slug); }, count() { return map.size; } };
  }

  return { makeSkillPrefs };
});
