/* sidecar/providers/ratelimits.js — PROACTIVE rate-limit accounting.

   Until now quota was learned only by hitting it: errorClass.js reads `retry-after` / `x-ratelimit-*reset*`
   off a 429 and nothing else was kept. Every provider's SUCCESS path did `if (res.ok && res.body) return res`
   and dropped the headers on the floor — including the `*-remaining` counters that say how close the next call
   is to failing. So the station could only ever report a wall it had already walked into.

   That is the wrong shape for a product whose core promise is truthful telemetry, and it is the root of the
   [[codex-429-quota-copy-lies]] complaint: with no remaining-count, every 429 renders as "wait a few seconds"
   even when the real answer is "this meter is spent for the next four hours".

   This is a pure store. It ingests response headers from EVERY call (success and failure alike) and keeps the
   most recent bucket per provider+resource. It decides nothing and blocks nothing — callers read `snapshot()`
   for display and `advise()` for a "you are nearly out" hint.

     makeRateLimits({ clock?, maxProviders? }) ->
       { observe(providerId, headers, {model?}), snapshot(), get(providerId), advise(providerId), wrapFetch(providerId, fetchImpl), reset() }

   THREE header dialects, all live:
     - Anthropic  `anthropic-ratelimit-{requests,tokens,input-tokens,output-tokens}-{limit,remaining,reset}`
     - OpenAI     `x-ratelimit-{limit,remaining,reset}-{requests,tokens}`
     - OpenRouter `x-ratelimit-{limit,remaining,reset}` (unqualified)
   and `reset` is variously an RFC3339 timestamp, a Go duration ("6m0s"), epoch seconds, or epoch ms. Guessing
   one shape and applying it everywhere would silently mis-report the other two, so all four are parsed.
*/
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.providers = root.SK.providers || {}).ratelimits = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // failopen.note — the tagged SYNC swallow (per-tag count + throttled warn): a fail-open catch must never be invisible.
  const { note: failNote } = (typeof require === 'function') ? require('../failopen.js') : { note: function (tag, e) { console.warn('[failopen] ' + tag + ':', (e && e.message) || e); } };

  const RESOURCES = ['requests', 'tokens', 'input-tokens', 'output-tokens'];

  // Headers arrive as a fetch Headers object, a plain object, or a Map. Normalize to lowercase-keyed lookup.
  function headerGet(headers, name) {
    if (!headers) return null;
    const k = String(name).toLowerCase();
    try {
      if (typeof headers.get === 'function') { const v = headers.get(k); return v == null ? null : String(v); }
    } catch (_) { /* fall through */ }
    if (typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (String(key).toLowerCase() === k) { const v = headers[key]; return v == null ? null : String(v); }
      }
    }
    return null;
  }

  function num(v) {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  }

  /* `reset` has four live encodings and they are not distinguishable by "is it a number".
     A bare `20` is twenty SECONDS from now on OpenAI and would be epoch-1970 read as a timestamp; a bare
     1900000000 is epoch seconds. The magnitude split is the only signal available, so it is stated once here
     rather than re-guessed at each call site. Returns absolute epoch-ms, or null when unparseable. */
  function parseReset(raw, nowMs) {
    if (raw == null || String(raw).trim() === '') return null;
    const s = String(raw).trim();

    // Go-style duration, as OpenAI sends: "6m0s", "1.5s", "20ms", "1h30m"
    if (/^(\d+(\.\d+)?(ms|h|m|s))+$/i.test(s)) {
      let ms = 0;
      const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/gi;
      let m;
      while ((m = re.exec(s))) {
        const v = parseFloat(m[1]), u = m[2].toLowerCase();
        ms += u === 'ms' ? v : u === 's' ? v * 1000 : u === 'm' ? v * 60000 : v * 3600000;
      }
      return nowMs + Math.round(ms);
    }

    const n = num(s);
    if (n != null) {
      if (n > 1e12) return Math.round(n);            // epoch ms
      if (n > 1e9) return Math.round(n * 1000);      // epoch seconds
      return nowMs + Math.round(n * 1000);           // small bare number = delta seconds
    }

    const t = Date.parse(s);                          // RFC3339, as Anthropic sends
    return isNaN(t) ? null : t;
  }

  function makeRateLimits(deps) {
    deps = deps || {};
    // Clock is INJECTED (lint-determinism): a module that reads the wall clock itself cannot be replayed.
    // The host wires the real one in index.js; a bare instance reads time 0, which keeps tests deterministic.
    const now = (deps.clock && typeof deps.clock.now === 'function') ? deps.clock.now : () => 0;
    const MAX_PROVIDERS = deps.maxProviders || 24;
    // Fraction of the limit at or below which a bucket is "tight". A single big turn can consume a meaningful
    // slice of a token bucket, so the warning has to come well before zero to be worth anything.
    const TIGHT = (deps.tightFraction != null) ? deps.tightFraction : 0.15;

    const byProvider = new Map();   // providerId -> { buckets: {resource: bucket}, model, at }

    function readBucket(headers, prefixes, nowMs) {
      let limit = null, remaining = null, reset = null;
      for (const p of prefixes) {
        if (limit == null) limit = num(headerGet(headers, p.limit));
        if (remaining == null) remaining = num(headerGet(headers, p.remaining));
        if (reset == null) reset = headerGet(headers, p.reset);
      }
      if (limit == null && remaining == null && reset == null) return null;
      const resetAt = parseReset(reset, nowMs);
      return {
        limit, remaining, resetAt,
        resetInMs: resetAt == null ? null : Math.max(0, resetAt - nowMs),
        observedAt: nowMs
      };
    }

    function observe(providerId, headers, meta) {
      const id = String(providerId || 'unknown');
      if (!headers) return null;
      const nowMs = now();
      const buckets = {};

      for (const r of RESOURCES) {
        const b = readBucket(headers, [
          { limit: 'anthropic-ratelimit-' + r + '-limit', remaining: 'anthropic-ratelimit-' + r + '-remaining', reset: 'anthropic-ratelimit-' + r + '-reset' },
          { limit: 'x-ratelimit-limit-' + r, remaining: 'x-ratelimit-remaining-' + r, reset: 'x-ratelimit-reset-' + r }
        ], nowMs);
        if (b) buckets[r] = b;
      }
      // OpenRouter's unqualified triple. Only used when nothing more specific was present — an unqualified
      // header alongside a qualified one is the same budget counted twice, and would show up as two rows.
      if (!Object.keys(buckets).length) {
        const b = readBucket(headers, [{ limit: 'x-ratelimit-limit', remaining: 'x-ratelimit-remaining', reset: 'x-ratelimit-reset' }], nowMs);
        if (b) buckets.requests = b;
      }
      if (!Object.keys(buckets).length) return null;   // provider sends no quota headers — record nothing rather than a row of nulls

      const prior = byProvider.get(id);
      /* MERGE, never replace. A provider may send only the buckets relevant to one request (a cached call can
         omit token counters entirely), and wholesale replacement would make an existing bucket vanish from the
         readout as though the limit had been lifted. */
      const merged = Object.assign({}, prior && prior.buckets, buckets);
      byProvider.set(id, { buckets: merged, model: (meta && meta.model) || (prior && prior.model) || null, at: nowMs });

      if (byProvider.size > MAX_PROVIDERS) {
        let oldestId = null, oldestAt = Infinity;
        for (const [k, v] of byProvider) if (v.at < oldestAt) { oldestAt = v.at; oldestId = k; }
        if (oldestId != null) byProvider.delete(oldestId);
      }
      return merged;
    }

    function get(providerId) {
      const e = byProvider.get(String(providerId || 'unknown'));
      if (!e) return null;
      const nowMs = now();
      const buckets = {};
      for (const k of Object.keys(e.buckets)) {
        const b = e.buckets[k];
        // resetInMs is recomputed on READ. A stored countdown is a lie the moment it is stored.
        buckets[k] = Object.assign({}, b, { resetInMs: b.resetAt == null ? null : Math.max(0, b.resetAt - nowMs) });
      }
      return { provider: String(providerId), model: e.model, observedAt: e.at, ageMs: Math.max(0, nowMs - e.at), buckets };
    }

    function snapshot() {
      const out = [];
      for (const id of byProvider.keys()) { const g = get(id); if (g) out.push(g); }
      return out.sort((a, b) => b.observedAt - a.observedAt);
    }

    /* "Are we about to hit a wall?" — the readout a UI or a copy string should key on instead of inferring
       urgency from a 429 it has not seen yet. Returns null when nothing is tight (never a fake all-clear:
       null also means "no data", which the caller must not render as "plenty left"). */
    function advise(providerId) {
      const g = get(providerId);
      if (!g) return null;
      let worst = null;
      for (const k of Object.keys(g.buckets)) {
        const b = g.buckets[k];
        if (b.remaining == null) continue;
        if (b.remaining <= 0) { const c = { resource: k, remaining: 0, limit: b.limit, resetInMs: b.resetInMs, exhausted: true, fraction: 0 };
          if (!worst || worst.fraction > 0) worst = c; continue; }
        if (!b.limit || b.limit <= 0) continue;                 // a remaining with no limit gives no fraction to judge
        const fraction = b.remaining / b.limit;
        if (fraction > TIGHT) continue;
        if (!worst || fraction < worst.fraction) worst = { resource: k, remaining: b.remaining, limit: b.limit, resetInMs: b.resetInMs, exhausted: false, fraction };
      }
      return worst ? Object.assign({ provider: g.provider, tight: true }, worst) : null;
    }

    /* The ONE wiring point. Every provider adapter receives its fetch by injection, so wrapping it here
       instruments all five at once — and, unlike editing each adapter's success path, it cannot be forgotten
       by the sixth. Observation never affects the response: a throw inside is swallowed, and the original
       promise result is handed back untouched. */
    function wrapFetch(providerId, fetchImpl) {
      if (typeof fetchImpl !== 'function') return fetchImpl;
      return function (url, init) {
        const p = fetchImpl(url, init);
        if (!p || typeof p.then !== 'function') return p;
        return p.then(function (res) {
          try { if (res && res.headers) observe(providerId, res.headers, null); } catch (e) { failNote('providers.ratelimits.observe', e); }
          return res;
        });
      };
    }

    function reset() { byProvider.clear(); }

    return { observe, get, snapshot, advise, wrapFetch, reset, _internals: { parseReset, headerGet, RESOURCES } };
  }

  return { makeRateLimits, _internals: { parseReset, headerGet, RESOURCES } };
});
