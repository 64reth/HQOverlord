/* node test/confbeats.test.js — the CONFIDENCE NARRATIVE beats (G3a): fire-once state + the decide gate.
   The contract: nothing speaks before calibration (comp.known), each moment speaks ONCE ever, TRUSTED
   outranks CALIBRATED (both latch when the bigger one speaks), and a confidence dip/re-climb after TRUSTED
   never re-fires. The DOM/beat-slot half rides Chat.nudge and is proven by the headless visual gate. */
'use strict';
const A = require('./_assert.js');
const { ConfBeats } = require('../frontend/app/confbeats.js');

const comp = (o) => Object.assign({ known: true, confidence: 60, samples: 3 }, o || {});
const fresh = () => ConfBeats._hydrate(null);

// ---- hydrate: sane fire-once ledger from null / corrupt blobs ----
let s = fresh();
A.eq(s.calibrated, false, 'a fresh ledger has not spoken the calibration moment');
A.eq(s.trusted, false, 'a fresh ledger has not spoken the TRUSTED moment');
s = ConfBeats._hydrate({ calibrated: 'yes', trusted: 0, junk: 1 });
A.eq(s.calibrated, true, 'truthy persisted calibrated survives hydrate');
A.eq(s.trusted, false, 'falsy persisted trusted stays unspoken');

// ---- decide: the honesty gate — nothing before calibration ----
A.eq(ConfBeats.decide(fresh(), comp({ known: false, confidence: 99 })), null,
  'an uncalibrated meter (known:false) speaks NOTHING — no fabricated-number moment, whatever the raw EWMA says');
A.eq(ConfBeats.decide(fresh(), null), null, 'a missing meter speaks nothing');
A.eq(ConfBeats.decide(null, comp()), null, 'a missing ledger speaks nothing');

// ---- the calibration moment: first time confidence becomes SHOWN ----
A.eq(ConfBeats.decide(fresh(), comp({ confidence: 60 })), 'calibrated',
  'the first calibrated meter fires the calibration-complete moment');

// ---- TRUSTED outranks: both due on the same verdict → only the bigger moment speaks ----
A.eq(ConfBeats.decide(fresh(), comp({ confidence: 90 })), 'trusted',
  'calibrating straight into >=85 speaks TRUSTED, not the smaller calibration line');

// ---- latch semantics: fire-once, and trusted latches BOTH ----
s = ConfBeats.latch(fresh(), 'calibrated');
A.eq(ConfBeats.decide(s, comp({ confidence: 60 })), null, 'the calibration moment never speaks twice');
A.eq(ConfBeats.decide(s, comp({ confidence: 90 })), 'trusted', 'TRUSTED still fires later, after calibration already spoke');
s = ConfBeats.latch(s, 'trusted');
A.eq(ConfBeats.decide(s, comp({ confidence: 99 })), null, 'the TRUSTED moment never speaks twice');
s = ConfBeats.latch(fresh(), 'trusted');
A.eq(s.calibrated, true, 'speaking TRUSTED latches the calibration moment too (the smaller line never follows the bigger)');
A.eq(ConfBeats.decide(s, comp({ confidence: 60 })), null, 'after TRUSTED spoke, a dip back to 60 raises no late calibration line');

// ---- dip + re-climb after TRUSTED: silence forever (fire-once is persisted, not threshold-edge) ----
s = ConfBeats.latch(fresh(), 'trusted');
A.eq(ConfBeats.decide(s, comp({ confidence: 70 })), null, 'a dip below 85 after TRUSTED speaks nothing');
A.eq(ConfBeats.decide(s, comp({ confidence: 92 })), null, 're-crossing 85 after TRUSTED speaks nothing — once, ever');

// ---- the threshold is the same band the TRUSTED milestone uses ----
A.eq(ConfBeats.TRUSTED_AT, 85, 'the spoken TRUSTED threshold matches the milestone band (85)');
A.eq(ConfBeats.decide(fresh(), comp({ confidence: 84.9 })), 'calibrated', 'just under the band → only calibration is due');
A.eq(ConfBeats.decide(ConfBeats.latch(fresh(), 'calibrated'), comp({ confidence: 85 })), 'trusted', 'exactly 85 crosses the band');

// ---- the copy: lowercase, concrete, no XP language (a light guard on the aesthetic law) ----
for (const k of ['calibrated', 'trusted']) {
  const line = ConfBeats._lines[k];
  A.ok(line && line.length > 20, k + ' line exists');
  A.ok(!/\bXP\b/i.test(line), k + ' line promises no XP (these beats mint nothing)');
  A.ok(/GROWTH/.test(line), k + ' line points at the GROWTH readout (concrete, not vague)');
  A.ok(line.slice(2, 3) === line.slice(2, 3).toLowerCase(), k + ' line speaks lowercase (the eerie register)');
}

A.report('confbeats.test');
