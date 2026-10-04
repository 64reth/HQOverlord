'use strict';
// The truth auditor and journeys share this probe. Delayed Commander data must
// not produce an invented level, and an inflated DOM level must never pass.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let journey = null, stale = true, label = { textContent: '—' };
const ctx = vm.createContext({
  window: { __STARNET_DEV__: true }, console: { log() {} }, setTimeout() {},
  document: { getElementById: id => id === 'gt-station' ? label : null },
  U: { bus: { emit() {} } },
  JourneyStore: { status: () => journey, state: () => ({ stale }) },
  Xp: { fresh: () => ({}), compute: () => ({ level: 77 }) }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/app/testapi.js'), 'utf8'), ctx);
const probe = ctx.window.__SKYNET_TEST__;
assert.equal(probe.hud().allOk, true, 'unknown Commander level is honestly shown as a dash');
label.textContent = 'Lv 1';
assert.equal(probe.hud().allOk, false, 'no fabricated initial level before backend data');
label = null;
assert.equal(probe.hud().allOk, false, 'missing HUD node is still a hard failure');
label = { textContent: '' };
assert.equal(probe.hud().allOk, false, 'empty node cannot masquerade as unknown');
journey = { progression: { level: 3 } }; stale = false; label.textContent = 'Lv 3';
assert.equal(probe.hud().allOk, true, 'Commander proof wins over unrelated crew XP');
probe.captureBaseline();
label.textContent = 'Lv 999';
assert.equal(probe.hud().allOk, false, 'inflated displayed level fails exact parity');
label.textContent = 'Lv 2';
assert.equal(probe.hud().allOk, false, 'understated level also fails');
label.textContent = '—';
assert.equal(probe.hud().allOk, false, 'missing display with available proof fails');
label.textContent = 'Lv 3'; stale = true;
assert.equal(probe.hud().allOk, false, 'last-good data must be visibly marked saved');
label.textContent = 'Lv 3 · saved';
assert.equal(probe.hud().allOk, true, 'stale saved value matches its actual provenance');
stale = false;
assert.equal(probe.hud().allOk, false, 'stale marker must clear after recovery');
journey = { progression: { level: 1 } }; label.textContent = 'Lv 1';
assert.equal(probe.hud().allOk, true, 'authoritative reset is not constrained by an old baseline');
journey = { progression: { level: '1' } }; label.textContent = '—';
assert.equal(probe.hud().allOk, true, 'invalid source data must not invent a numeric level');
console.log('testapi-commander-hud: OK (13 delayed, exact, stale, reset and missing-display assertions)');
