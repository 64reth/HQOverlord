/* sidecar/fallbackchain.js — the PURE resolve+validate helper behind the SETTINGS → Models fallback chain (P0-3).
   Splits the two decisions out of the Node host so they're testable headlessly, mirroring budgetcaps.js:

   • resolveChain(envChain, savedChain) -> the ordered list of fallback model slugs actually in force.
     PRECEDENCE (additive, never breaks an env deploy): a persisted chain that is PRESENT wins outright; an ABSENT
     persisted chain (null / not-yet-saved) falls back to the env default (SKYNET_FALLBACK_MODELS). A SAVED-EMPTY
     chain ([]) is a REAL choice — "no fallback" — and beats a non-empty env default (that's how the UI turns the
     chain OFF, the same way a saved 0 turns a budget cap off). An explicit per-RUN request list (o.fallbackModels
     from the browser) still overrides everything — the host layers that on top, so this helper only decides the
     saved-vs-env default.

   • cleanChain(list) -> normalize any stored/incoming list to trimmed, de-duplicated, non-empty string slugs under
     a sane length cap. A corrupt persisted blob can never inject junk or an unbounded chain.

   • validateChainPatch(patch, opts) -> { ok, chain?, present?, error?, warnings? }. Strictly parses an incoming
     { models: [...] | null } patch: null/absent `models` = CLEAR (fall back to env); an array = SET that ordered
     chain (cleaned). Unknown ids (not in the passed catalog) are WARNED, never refused — catalogs go stale and a
     brand-new model must still be settable. No IO, no clock — trivially testable. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).fallbackchain = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_ENTRIES = 8;       // a fallback chain longer than this is almost surely a mistake (each entry is one paid retry)
  const MAX_SLUG_LEN = 200;    // a model slug longer than this is junk (real slugs are provider/model[:tag])

  function isStr(v) { return typeof v === 'string'; }

  // normalize any list (stored, env-split, or an incoming patch) to trimmed, de-duplicated, non-empty slugs,
  // bounded to MAX_ENTRIES. Order is preserved (fallback order is meaningful); the FIRST occurrence of a dup wins.
  function cleanChain(list) {
    const out = [];
    const seen = Object.create(null);
    if (Array.isArray(list)) {
      for (const raw of list) {
        if (!isStr(raw)) continue;
        const s = raw.trim().slice(0, MAX_SLUG_LEN);
        if (!s) continue;
        if (seen[s]) continue;
        seen[s] = true;
        out.push(s);
        if (out.length >= MAX_ENTRIES) break;
      }
    }
    return out;
  }

  // parse the env default (SKYNET_FALLBACK_MODELS comma list) into a clean chain. A missing/empty env is [].
  function parseEnvChain(envValue) {
    return cleanChain(String(envValue == null ? '' : envValue).split(','));
  }

  // effective fallback chain = the SAVED chain when one is PRESENT (even the empty "no fallback" choice), else the
  // env default. `savedChain` is null/undefined when the user has never saved (fall back to env); an array (incl.
  // []) means the user made an explicit choice that wins. envChain may be a comma-string or an array.
  function resolveChain(envChain, savedChain) {
    const env = Array.isArray(envChain) ? cleanChain(envChain) : parseEnvChain(envChain);
    if (savedChain == null) return env;              // never saved -> env default
    return cleanChain(savedChain);                   // saved (incl. empty) is an explicit choice that wins
  }

  // A task cannot make progress on a model the provider catalog definitively says has no tool calling.
  // If the Commander already configured an ordered fallback chain, promote the first model that is not
  // definitively tool-less instead of refusing the whole task at admission. `null`/unknown support remains
  // eligible: a cold or stale catalog must never false-refuse a capable model. The original incapable model
  // is deliberately not appended to the remaining chain—it cannot become more capable after a failover.
  function promoteToolCapable(primary, chain, supportsTools) {
    const current = String(primary == null ? '' : primary).trim();
    const remaining = cleanChain(chain).filter(id => id !== current);
    if (typeof supportsTools !== 'function') return { model: current, fallbacks: remaining, promoted: false };
    let primarySupport = null;
    try { primarySupport = supportsTools(current); } catch (_) { primarySupport = null; }
    if (primarySupport !== false) return { model: current, fallbacks: remaining, promoted: false };
    let pick = -1;
    for (let i = 0; i < remaining.length; i++) {
      let support = null;
      try { support = supportsTools(remaining[i]); } catch (_) { support = null; }
      if (support !== false) { pick = i; break; }
    }
    if (pick < 0) return { model: current, fallbacks: remaining, promoted: false };
    const model = remaining.splice(pick, 1)[0];
    return { model, fallbacks: remaining, promoted: true, fromModel: current };
  }

  // strict parse of a POST /api/models/fallback body into the next persisted chain. Shapes:
  //   { models: ["a","b"] } -> SET that ordered chain (cleaned; present:true)
  //   { models: null } or { clear:true } or {} -> CLEAR the saved chain (present:false -> fall back to env)
  // opts.catalog (optional): a Set/array of known model ids. Unknown ids are WARNED, never rejected (stale catalog).
  function validateChainPatch(patch, opts) {
    opts = opts || {};
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'body must be an object like { models: ["slug", …] }' };
    // explicit clear
    if (patch.clear === true || patch.models === null || (!('models' in patch) && !('clear' in patch))) {
      return { ok: true, present: false, chain: [], warnings: [] };
    }
    const raw = patch.models;
    if (!Array.isArray(raw)) return { ok: false, error: 'models must be an array of slugs (or null to clear)' };
    // reject any non-string entry LOUDLY (a stray number/object is a client bug, not a stale slug)
    for (const e of raw) { if (!isStr(e)) return { ok: false, error: 'every fallback entry must be a model-id string' }; }
    if (raw.length > MAX_ENTRIES) return { ok: false, error: 'a fallback chain may hold at most ' + MAX_ENTRIES + ' models' };
    const chain = cleanChain(raw);
    const warnings = [];
    const cat = opts.catalog;
    const known = cat ? (typeof cat.has === 'function' ? cat : new Set(Array.isArray(cat) ? cat : [])) : null;
    if (known) { for (const id of chain) { if (!known.has(id)) warnings.push(id); } }
    return { ok: true, present: true, chain: chain, warnings: warnings };
  }

  return { MAX_ENTRIES, MAX_SLUG_LEN, cleanChain, parseEnvChain, resolveChain, promoteToolCapable, validateChainPatch };
});
