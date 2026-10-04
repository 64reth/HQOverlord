/* node test/launchmemory.test.js — LaunchMemory (frontend/app/launchmemory.js), lane C of the recipe-system
   upgrade: last-used recipe inputs. Locks the save/get round-trip, the LRU bound, the per-value clip, the
   blank-form clear semantics, corrupt-storage fail-open, and the reset. Runs under node with a storage shim
   (the module's injectable seam). Also source-locks the marketplace wiring: prefill routes through esc() and
   every launch handler saves. */
'use strict';
const A = require('./_assert.js');
const LM = require('../frontend/app/launchmemory.js');

// a minimal localStorage shim (the injectable seam)
function shim(initial) {
  const m = Object.assign({}, initial || {});
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; },
    _dump: () => m
  };
}

/* ---------- save / get round-trip ---------- */
let s = shim(); LM._setStoreForTest(s);
A.eq(LM.get('morning-brief'), null, 'nothing remembered at first');
LM.save('morning-brief', { topic: 'AI agents', window: 'the last 24 hours' }, 1000);
A.eq(LM.get('morning-brief').topic, 'AI agents', 'a saved value round-trips');
A.eq(LM.get('morning-brief').window, 'the last 24 hours', 'every filled param is remembered');
A.eq(LM.get('no-such'), null, 'an unknown recipe has no memory');
A.eq(LM.get(''), null, 'an empty id has no memory');

// a re-save replaces (latest launch wins)
LM.save('morning-brief', { topic: 'quantum chips' }, 2000);
A.eq(LM.get('morning-brief').topic, 'quantum chips', 'a later launch replaces the memory');
A.eq(LM.get('morning-brief').window, undefined, 'params left blank on the later launch are not carried over');

/* ---------- sanitize: blanks dropped, non-strings dropped, values clipped ---------- */
LM.save('x', { a: '   ', b: 42, c: 'real' }, 3000);
const xv = LM.get('x');
A.eq(xv.a, undefined, 'a whitespace-only value is not remembered');
A.eq(xv.b, undefined, 'a non-string value is not remembered');
A.eq(xv.c, 'real', 'the real value survives');
LM.save('y', { big: 'z'.repeat(LM.VALUE_MAX + 500) }, 3100);
A.eq(LM.get('y').big.length, LM.VALUE_MAX, 'an oversized value is clipped, not dropped');

// an ALL-blank save clears the entry (a no-setup launch never leaves a stale lie behind)
LM.save('x', { a: '', c: '   ' }, 3200);
A.eq(LM.get('x'), null, 'an all-blank save clears the remembered entry');

/* ---------- LRU bound ---------- */
s = shim(); LM._setStoreForTest(s);
for (let i = 0; i < LM.MAX_RECIPES + 10; i++) LM.save('r' + i, { v: 'val' + i }, 10000 + i);
const kept = JSON.parse(s._dump()[LM.KEY]).byRecipe;
A.ok(Object.keys(kept).length <= LM.MAX_RECIPES, 'the store is bounded at MAX_RECIPES');
A.eq(LM.get('r0'), null, 'the oldest entry was evicted');
A.ok(!!LM.get('r' + (LM.MAX_RECIPES + 9)), 'the newest entry survives');

/* ---------- corrupt storage fails open ---------- */
s = shim({ [LM.KEY]: '{{{not json' }); LM._setStoreForTest(s);
A.eq(LM.get('anything'), null, 'corrupt storage reads as empty (never a crash)');
LM.save('fresh', { topic: 'ok' }, 5000);
A.eq(LM.get('fresh').topic, 'ok', 'a save over corrupt storage recovers cleanly');
s = shim({ [LM.KEY]: JSON.stringify({ v: 1, byRecipe: 'nope' }) }); LM._setStoreForTest(s);
A.eq(LM.get('anything'), null, 'a malformed byRecipe reads as empty');

/* ---------- clear + reset ---------- */
s = shim(); LM._setStoreForTest(s);
LM.save('a', { t: '1' }, 1); LM.save('b', { t: '2' }, 2);
LM.clear('a');
A.eq(LM.get('a'), null, 'clear removes one recipe\'s memory');
A.eq(LM.get('b').t, '2', 'clear leaves the others');
LM.reset();
A.eq(LM.get('b'), null, 'reset wipes the whole store (new-hero discipline)');

/* ---------- marketplace wiring (source-lock: browser-flow file, node can't execute it) ---------- */
const fs = require('fs'), path = require('path');
const mkt = fs.readFileSync(path.join(__dirname, '../frontend/app/marketplace.js'), 'utf8');
A.ok(/LaunchMemory\.get\(r\.id\)/.test(mkt), 'the launch form reads LaunchMemory for prefill');
A.ok(/\+ esc\(val\) \+ '<\/textarea>/.test(mkt), 'the prefilled value routes through esc() (no textarea breakout)');
A.eq((mkt.match(/LaunchMemory\.save\(r\.id,\s*values\)/g) || []).length, 3, 'all three launch handlers (RUN NOW / RUN NOW INSTEAD / SCHEDULE IT) save the used values');
A.ok(/mkt-prefill-hint/.test(mkt), 'the form shows the using-your-last-inputs hint when prefilled');
const idx = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
A.ok(/app\/launchmemory\.js/.test(idx), 'launchmemory.js is loaded by index.html (a missing tag fails silently — locked here)');
const appSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
A.ok(/LaunchMemory\.reset\(\)/.test(appSrc), 'the new-hero reset clears LaunchMemory (no inherited inputs)');

A.report('launchmemory');
