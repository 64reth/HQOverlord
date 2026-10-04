/* node test/autonomy-ui.test.js — source-lock for the AUTONOMY DIAL in the SETTINGS panel (stationui.js).

   stationui.js is browser-flow (DOM/terminal panels), not node-loadable, so — like harness-internal.test.js /
   newhero-reset.test.js — we lock the dial's invariants by reading the source: it must offer every Initiative +
   Reach level the engine defines, WRITE through AutonomyStore (not ad-hoc state), and repaint the honest
   describe() posture line so the panel can never silently drift from the engine. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const Au = require('../frontend/app/autonomy.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

// the dial offers a button for EVERY level on both axes (data-init / data-reach), matching the engine enums — so a
// new rung added to autonomy.js can't be silently missing from the dial.
for (const lvl of Au.INITIATIVE) A.ok(new RegExp('data-init="' + lvl + '"').test(src), 'the dial has an Initiative button for "' + lvl + '"');
for (const lvl of Au.REACH) A.ok(new RegExp('data-reach="' + lvl + '"').test(src), 'the dial has a Reach button for "' + lvl + '"');

// the PACE row surfaces the leashPerDay knob: a #auto-pace container plus a button for each of the four presets
// (1/3/6/12) covering the engine's LEASH_MIN..LEASH_MAX span, written through AutonomyStore.setLeash.
A.ok(/id="auto-pace"/.test(src), 'the dial has a PACE row (#auto-pace)');
for (const n of [Au.LEASH_MIN, Au.DEFAULT_LEASH, 6, Au.LEASH_MAX]) A.ok(new RegExp('data-pace="' + n + '"').test(src), 'the PACE row has a button for ' + n + ' jobs/day');
A.eq((src.match(/data-pace="/g) || []).length, 4, 'the PACE row offers exactly four pace presets');

// it writes through the store (persisted, single source of truth) and repaints the live honest description.
A.ok(/AutonomyStore\.setInitiative\(/.test(src), 'the dial writes Initiative via AutonomyStore.setInitiative');
A.ok(/AutonomyStore\.setReach\(/.test(src), 'the dial writes Reach via AutonomyStore.setReach');
A.ok(/AutonomyStore\.setLeash\(Number\(/.test(src), 'the PACE row writes the daily pace via AutonomyStore.setLeash(Number(...))');
A.ok(/AutonomyStore\.describe\(\)/.test(src), 'the dial repaints the live describe() posture line (stays honest)');

A.report('autonomy-ui.test');
