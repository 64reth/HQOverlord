/* sidecar/autonomy-ledger.js — the durable AUTONOMY DECISION LEDGER (NS-0, 2026-07-07).

   Andrew left the station overnight at max autonomy and got ~nothing back, and separately the cron engine
   duplicate-fired — because autonomy decisions across the harness are SILENT. A run that did NOT act (deferred
   past the cap, skipped for no capability, suppressed because paused) left no durable trace, so there was no
   way to answer "what did the station decide overnight, and why?". This is that trace: an append-only,
   fsync-backed JSONL of every autonomous DECISION — fire / skip / defer (cron today; night-shift beats next).

   Same determinism split as runstore.js / the spend ledger: PURE given an injected `io` (readAll/append — the
   HOST owns the fsync'd disk append + rotation) and `clock`. No ambient time/IO here, so it passes
   lint-determinism and tests headlessly with an in-memory io. A missing/corrupt log -> empty ledger (fail-open;
   an autonomy decision is telemetry, never load-bearing — a broken log must NEVER crash a run).

   The API is deliberately SMALL + STABLE (a parallel night-shift lane consumes it): an exported record()/append
   function + a read list(). The record shape (all optional except ts/source/kind — a decision always has those):
     { ts, source:'cron'|'nightshift'|…, kind:'fire'|'skip'|'defer'|'act'|'earn'|'decline',
       jobId?, agentId?, runId?, reason?, binding?, detail? }
   `binding` = the mechanism that bound the decision (e.g. 'concurrency-cap', 'no-capability', 'paused',
   'schedule'); `detail` = a small sanitized object bag for anything structured (capped, no blobs, no secrets).

   makeAutonomyLedger({ io, clock, limit?, ramMax? }) -> {
     record(entry) -> entry,           // clamps + stamps ts, appends durably, returns the stored row
     list({ source?, kind?, limit }?) -> entry[],   // newest-first; optionally filtered; capped
     all() -> entry[],  count() -> int
   } */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).autonomyLedger = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // the known vocab — kept as ALLOW-lists so a garbage/foreign write can't poison the log, but tolerant: an
  // unknown source/kind is clamped to 'other'/'note' rather than dropped (we never want to LOSE a real decision
  // just because a new lane added a verb before this enum caught up — additive-friendly, like runstore's reason).
  // Sets, not object literals: `({a:1})['constructor']` is truthy, so an object-literal allowlist
  // silently admits every Object.prototype key — and these keys come off persisted/model-supplied data.
  const SOURCES = new Set(['cron', 'nightshift', 'loop', 'reflection', 'channel', 'other']);
  const KINDS = new Set(['fire', 'skip', 'defer', 'act', 'earn', 'decline', 'note']);
  const DEFAULT_LIMIT = 200;
  const STR_MAX = 200;            // a reason/binding is a short label, never a blob
  const DETAIL_KEYS_MAX = 20;     // a detail bag is small structured context, not a document
  const DETAIL_STR_MAX = 260;
  const RAM_ROWS_MAX = 3000;      // bound the in-process mirror on a 24/7 process (disk keeps the full log)

  function str(v) { return v == null ? '' : String(v); }
  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
  function clampStr(v, max) { const s = str(v); return s ? s.slice(0, max) : ''; }

  // sanitize the caller's `detail` bag at the persistence boundary: a shallow plain object of primitives,
  // key- and value-bounded. Anything nested/functional/oversized is dropped (defense in depth — this log is
  // append-only + served over an API, so a foreign caller must never write an unbounded/secret-bearing blob).
  function detailBag(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (n >= DETAIL_KEYS_MAX) break;
      const val = v[k];
      if (val == null || typeof val === 'function' || typeof val === 'object') continue;   // primitives only
      out[String(k).slice(0, 60)] = (typeof val === 'string') ? val.slice(0, DETAIL_STR_MAX) : val;
      n++;
    }
    return n ? out : undefined;
  }

  function makeAutonomyLedger(opts) {
    opts = opts || {};
    const io = opts.io || { readAll() { return []; }, append() {} };
    const clock = opts.clock || { now() { return 0; } };
    const cap = num(opts.limit) > 0 ? num(opts.limit) : DEFAULT_LIMIT;
    const ramMax = num(opts.ramMax) > 0 ? num(opts.ramMax) : RAM_ROWS_MAX;

    // in-memory mirror loaded once; append keeps RAM + disk in lockstep so list() is O(n) over RAM.
    let rows = [];
    try { const raw = io.readAll(); if (Array.isArray(raw)) rows = raw.filter(r => r && typeof r === 'object'); }
    catch (_) { rows = []; }
    if (rows.length > ramMax) rows = rows.slice(rows.length - ramMax);

    function record(e) {
      e = e || {};
      const entry = {
        ts: num(e.ts) || clock.now(),
        source: SOURCES.has(e.source) ? e.source : 'other',
        kind: KINDS.has(e.kind) ? e.kind : 'note'
      };
      // optional identity / cause fields — only stored when present so a row stays compact.
      if (e.jobId != null && str(e.jobId)) entry.jobId = clampStr(e.jobId, STR_MAX);
      if (e.agentId != null && str(e.agentId)) entry.agentId = clampStr(e.agentId, STR_MAX);
      if (e.runId != null && str(e.runId)) entry.runId = clampStr(e.runId, STR_MAX);
      if (e.reason != null && str(e.reason)) entry.reason = clampStr(e.reason, STR_MAX);
      if (e.binding != null && str(e.binding)) entry.binding = clampStr(e.binding, STR_MAX);
      const detail = detailBag(e.detail);
      if (detail) entry.detail = detail;

      rows.push(entry);
      if (rows.length > ramMax) rows.splice(0, rows.length - ramMax);
      try { io.append(entry); } catch (_) { /* persistence failure must never crash the caller; RAM mirror still answers */ }
      return entry;
    }

    function list(o) {
      o = o || {};
      const limit = num(o.limit) > 0 ? num(o.limit) : cap;
      const wantSource = o.source == null ? null : str(o.source);
      const wantKind = o.kind == null ? null : str(o.kind);
      const out = [];
      for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {   // newest-first
        const r = rows[i];
        if (wantSource != null && r.source !== wantSource) continue;
        if (wantKind != null && r.kind !== wantKind) continue;
        out.push(Object.assign({}, r));
      }
      return out;
    }

    return {
      record, list,
      all() { return rows.map(r => Object.assign({}, r)); },
      count() { return rows.length; }
    };
  }

  return { makeAutonomyLedger };
});
