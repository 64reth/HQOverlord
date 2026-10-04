/* sidecar/verdictreview.js — VERDICT-TRIGGERED SKILL REVIEW (consistency loop, slice 1, 2026-08-22).

   The background skill review (skillreview.js) fires on run SIZE — ≥4 tool calls, ≥8 turns, ≥5000 chars. The
   Commander's own verdict on the work was never an input: a small run rated `miss` taught the skillbase nothing,
   which is exactly the consistency complaint ("it did it wrong, and next week it does it wrong again").

   This module is the pure half of the fix. At run end, a run that did NOT earn a size-review gets a compact
   REVIEW PACKET parked here (the transcript + the aux provider handles the review would need). When a verdict
   arrives on POST /api/growth/ratings and it is `ok` or `miss`, the packet is TAKEN (once) and index.js runs the
   same quiet review loop with the verdict in the prompt. `great` never triggers — praise is not a lesson.

   Bounded by construction: a capped LRU (oldest evicted), a TTL so a stale packet never reviews a run the
   Commander rated a day later against a skillbase that has since moved, and take() deletes. Pure + clock-injected
   (node-testable); index.js owns the provider objects and the loop. */
'use strict';

const { note: failNote } = require('./failopen.js');   // a swallowed error stays visible (repo fail-open ratchet)

const VERDICTS_THAT_TEACH = new Set(['ok', 'miss']);

function makeVerdictReview(opts) {
  opts = opts || {};
  const cap = Number.isFinite(opts.cap) && opts.cap > 0 ? Math.floor(opts.cap) : 40;
  const ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : 6 * 60 * 60 * 1000;
  const now = typeof opts.now === 'function' ? opts.now : () => 0;   // clock is INJECTED (repo determinism law); index.js passes the real one
  const packets = new Map();   // runId -> { at, packet }  (Map keeps insertion order = LRU by arrival)

  function sweep() {
    const t = now();
    for (const [id, row] of packets) if (t - row.at > ttlMs) packets.delete(id);
    while (packets.size > cap) packets.delete(packets.keys().next().value);
  }

  // park a run's review packet. Only runs that were NOT already reviewed belong here (the caller decides);
  // a second stash for the same runId replaces the first (latest state wins).
  function stash(runId, packet) {
    const id = String(runId || '').trim();
    if (!id || !packet || typeof packet !== 'object') return false;
    packets.delete(id);
    packets.set(id, { at: now(), packet });
    sweep();
    return true;
  }

  // does this verdict earn a review? praise never does; only a real run (reason done) with a packet on file.
  function shouldTrigger(runId, verdict) {
    const id = String(runId || '').trim();
    if (!id || !VERDICTS_THAT_TEACH.has(String(verdict || ''))) return false;
    sweep();
    return packets.has(id);
  }

  // take the packet (once). Returns null when there is none or the verdict does not teach.
  function take(runId, verdict) {
    if (!shouldTrigger(runId, verdict)) return null;
    const id = String(runId).trim();
    const row = packets.get(id);
    packets.delete(id);
    return row ? row.packet : null;
  }

  function size() { sweep(); return packets.size; }
  function has(runId) { sweep(); return packets.has(String(runId || '').trim()); }

  /* ---- CORRECTION GRACE (slice 2, 2026-08-22) ----
     A verdict alone says "this fell short"; the Commander's NEXT words say HOW. Firing the review the instant the
     verdict lands threw those words away. arm() takes the packet and holds it for `graceMs`; correct() attaches
     the Commander's correction — a chip tap (final:false) keeps waiting for the typed message, a typed message
     (final:true) fires the review NOW with their words; the timer fires with whatever arrived. One review per
     run either way (held map is keyed by runId; fire is single-shot). Timers are INJECTED (determinism law). */
  const setT = typeof opts.setTimeout === 'function' ? opts.setTimeout : (fn, ms) => setTimeout(fn, ms);
  const clearT = typeof opts.clearTimeout === 'function' ? opts.clearTimeout : (h) => clearTimeout(h);
  const graceMs = Number.isFinite(opts.graceMs) && opts.graceMs >= 0 ? opts.graceMs : 90 * 1000;
  const held = new Map();   // runId -> { packet, verdict, correction, timer, fire }

  function fireHeld(id, why) {
    const h = held.get(id); if (!h) return false;
    held.delete(id);
    try { clearT(h.timer); } catch (e) { failNote('verdictreview.clearTimer', e); }
    // the fire fn is the caller's review launcher; an exception here is a lost review — noted, never silent
    try { h.fire(Object.assign({}, h.packet, { runId: id, verdict: h.verdict, correction: h.correction, correctionSource: h.correctionSource || '', firedBy: why })); } catch (e) { failNote('verdictreview.fire', e); }
    return true;
  }
  // arm: take the packet for this verdict and hold it for the grace window. Returns false when nothing to review.
  //   fire(job) — the caller's review launcher; job = packet + { runId, verdict, correction, firedBy }
  function arm(runId, verdict, fire, initialCorrection) {
    const id = String(runId || '').trim();
    if (typeof fire !== 'function') return false;
    if (held.has(id)) return false;   // already armed (a duplicate verdict never double-arms)
    const packet = take(id, verdict);
    if (!packet) return false;
    const h = { packet, verdict: String(verdict), correction: String(initialCorrection || '').slice(0, 600), correctionSource: initialCorrection ? 'verdict' : '', timer: null, fire };
    held.set(id, h);
    if (graceMs === 0) { fireHeld(id, 'immediate'); return true; }
    h.timer = setT(() => fireHeld(id, 'grace'), graceMs);
    return true;
  }
  // correct: attach the Commander's words. final=true (a typed message) fires now; final=false (a chip) keeps waiting.
  function correct(runId, text, final, source) {
    const id = String(runId || '').trim();
    const h = held.get(id); if (!h) return { ok: false, reason: 'nothing held for this run' };
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    if (t) { h.correction = h.correction && !final ? (h.correction + ' · ' + t).slice(0, 600) : t; h.correctionSource = String(source || (final ? 'message' : 'chip')); }
    if (final) { fireHeld(id, 'correction'); return { ok: true, fired: true }; }
    return { ok: true, fired: false };
  }
  function holding(runId) { return held.has(String(runId || '').trim()); }
  // peek: read a parked packet WITHOUT consuming it (slice 4: a `great` verdict reads which skills the run loaded
  // to mint a golden; it never spends the packet — praise is not a review).
  function peek(runId) { sweep(); const row = packets.get(String(runId || '').trim()); return row ? row.packet : null; }

  return { stash, shouldTrigger, take, size, has, cap, ttlMs, arm, correct, holding, peek, graceMs };
}

module.exports = { makeVerdictReview, VERDICTS_THAT_TEACH };
