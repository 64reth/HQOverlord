/* sidecar/routing/line-spend.js — per-LINE daily spend ledger for the chain executor's `maxUsdPerDay` cap.

   A line's LINE BUDGET (pipeline.normalizeLineLimits) may carry a $ per DAY ceiling. Per-message spend is
   measured inside one advance(); a day's spend has to outlive the call AND a sidecar restart, or the cap is a
   claim the harness cannot prove after a reboot. This is the smallest durable thing that makes it true:
   { [lineId]: { day, usd } } — one bucket per line, keyed by the UTC day index, re-zeroed on day roll.

   PURE + INJECTED I/O (sidecar determinism law): `now` is injected, persistence is a { load(), save(value) }
   pair the host builds over its domain store (index.js: makeDomainStore -> line-spend.json). Uninjected it is
   memory-only — correct within a process, honest about not surviving one. Never throws: a ledger failure
   must not gate a reply (chain.js's first law); it degrades to "cannot prove, does not refuse". */
'use strict';

const { note: failNote } = require('../failopen.js');   // tagged fail-open: a failed ledger write must never be invisible
const DAY_MS = 24 * 60 * 60 * 1000;

function makeLineSpend(o) {
  o = o || {};
  const now = typeof o.now === 'function' ? o.now : function () { return 0; };
  const dayMs = (typeof o.dayMs === 'number' && o.dayMs > 0) ? o.dayMs : DAY_MS;
  const load = typeof o.load === 'function' ? o.load : function () { return null; };
  const save = typeof o.save === 'function' ? o.save : function () {};
  let table = null;
  const num = v => (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;
  const dayOf = t => Math.floor(num(t) / dayMs);
  function clean(v) {
    const out = {};
    if (!v || typeof v !== 'object') return out;
    for (const k of Object.keys(v)) {
      const r = v[k];
      if (!r || typeof r !== 'object') continue;
      const day = (typeof r.day === 'number' && isFinite(r.day)) ? r.day : null;
      if (day == null) continue;
      out[String(k)] = { day, usd: num(r.usd) };
    }
    return out;
  }
  function ensure() { if (!table) { try { table = clean(load()); } catch (_) { table = {}; } } return table; }
  function persist() { try { save(clean(table)); } catch (e) { failNote('line-spend.persist', e); } }

  // $ this line has spent TODAY (0 when nothing, or the bucket is from an earlier day)
  function spentToday(lineId) {
    if (lineId == null) return 0;
    const r = ensure()[String(lineId)];
    return (r && r.day === dayOf(now())) ? r.usd : 0;
  }
  // add reconciled spend to the line's bucket for today (a stale bucket rolls to zero first)
  function note(lineId, usd) {
    const u = num(usd);
    if (lineId == null || !u) return spentToday(lineId);
    const t = ensure(), k = String(lineId), day = dayOf(now());
    const r = t[k];
    t[k] = (r && r.day === day) ? { day, usd: r.usd + u } : { day, usd: u };
    persist();
    return t[k].usd;
  }
  function snapshot() { return clean(ensure()); }
  return { spentToday, note, snapshot, clean };
}

module.exports = { makeLineSpend, DAY_MS };
