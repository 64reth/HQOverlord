/* shared/clock-rng.js — deterministic time + randomness, injected (never ambient).
   Backend logic must take a clock and rng from here instead of touching Date.now /
   performance.now / Math.random, so the same seed + same inputs produce a
   byte-identical run (the basis of the headless replay tests).

   makeClock(startMs) -> { now(), advance(ms), set(ms) }
   makeRng(seed)      -> { next()=[0,1), int(a,b), float(a,b), pick(arr) }   // mulberry32
   fnv(str)           -> uint32 hash (lets a string be used as a seed) */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).clockRng = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function fnv(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function makeClock(startMs) {
    let t = startMs || 0;
    return {
      now() { return t; },
      advance(ms) { t += (ms || 0); return t; },
      set(ms) { t = ms || 0; return t; }
    };
  }

  function makeRng(seed) {
    let s = (typeof seed === 'string' ? fnv(seed) : (seed >>> 0)) || 1;
    function next() {                       // mulberry32
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      int(a, b) { return a + Math.floor(next() * (b - a + 1)); },
      float(a, b) { return a + next() * (b - a); },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; }
    };
  }

  return { makeClock, makeRng, fnv };
});
