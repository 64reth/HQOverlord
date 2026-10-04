/* node test/clock-rng.test.js — determinism harness unit tests. */
'use strict';
const A = require('./_assert.js');
const { makeClock, makeRng, fnv } = require('../shared/clock-rng.js');

// ---- clock ----
const c = makeClock(1000);
A.eq(c.now(), 1000, 'clock starts at start');
A.eq(c.advance(50), 1050, 'advance returns the new time');
A.eq(c.now(), 1050, 'advance persists');
A.eq(c.set(0), 0, 'set works');
A.eq(makeClock().now(), 0, 'default clock starts at 0');

// ---- rng determinism (the whole point) ----
function seq(seed, n) { const r = makeRng(seed); const out = []; for (let i = 0; i < n; i++) out.push(r.next()); return out; }
A.eq(seq(42, 32), seq(42, 32), 'same numeric seed -> byte-identical sequence');
A.eq(seq('hello', 32), seq('hello', 32), 'same string seed -> byte-identical sequence');
A.ok(JSON.stringify(seq(1, 32)) !== JSON.stringify(seq(2, 32)), 'different seeds -> different sequence');

// ---- range bounds ----
const r = makeRng('ranges');
let allIn = true, sawLo = false, sawHi = false;
for (let i = 0; i < 2000; i++) { const v = r.int(1, 6); if (v < 1 || v > 6) allIn = false; if (v === 1) sawLo = true; if (v === 6) sawHi = true; }
A.ok(allIn, 'int(a,b) stays within [a,b]');
A.ok(sawLo && sawHi, 'int(a,b) reaches both bounds');

const r2 = makeRng(7);
let inUnit = true;
for (let i = 0; i < 2000; i++) { const v = r2.next(); if (v < 0 || v >= 1) inUnit = false; }
A.ok(inUnit, 'next() stays in [0,1)');

const r3 = makeRng(7);
const arr = ['a', 'b', 'c'];
let pickOk = true;
for (let i = 0; i < 200; i++) if (!arr.includes(r3.pick(arr))) pickOk = false;
A.ok(pickOk, 'pick() returns an element of the array');

// ---- fnv ----
A.eq(fnv('starnet'), fnv('starnet'), 'fnv is deterministic');
A.ok(fnv('a') !== fnv('b'), 'fnv distinguishes inputs');

A.report('clock-rng.test');
