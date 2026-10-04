'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');
const start = src.indexOf('  const ROOM_LIGHTING_STEPS =');
const end = src.indexOf('  // TEXT SIZE steps', start);
assert.ok(start >= 0 && end > start);
const bake = require('../frontend/app/stationbake.js');
const original = { ...bake.LIGHT };
let rebakes = 0;
const api = new Function('StationBake', 'World', src.slice(start, end) +
  '\nreturn { steps: ROOM_LIGHTING_STEPS, resolve: resolveRoomLighting, apply: applyRoomLighting };')(
  bake, { rebake() { rebakes++; } });
assert.equal(api.steps.length, 3);
for (const value of [undefined, null, '', 'future-mode', {}, 9]) {
  assert.equal(api.resolve(value), 'low');
  api.apply(value);
  assert.deepEqual(bake.LIGHT, original, 'old or invalid settings retain the approved look');
}
assert.equal(rebakes, 0, 'unrelated settings do not trigger unnecessary rebakes');
let previous = original.ambient;
for (const level of ['medium', 'high']) {
  api.apply(level);
  assert.ok(bake.LIGHT.ambient < previous, 'each higher level exposes more of the station');
  previous = bake.LIGHT.ambient;
  assert.deepEqual({ ...bake.LIGHT, ambient: original.ambient }, original,
    'fixture layout, falloff, warmth and glow remain unchanged');
  const count = rebakes;
  api.apply(level);
  assert.equal(rebakes, count, 'reselecting the same level does not rebake');
}
assert.equal(rebakes, 2, 'both brightness changes reach the renderer');
api.apply('low');
assert.deepEqual(bake.LIGHT, original, 'LOW restores the exact approved light controls');
assert.match(src, /roomLighting: 'low'/);
assert.match(src, /applyRoomLighting\(s\.roomLighting\)/);
assert.match(src, /roomLighting: resolveRoomLighting\(store\.settings\.roomLighting\)/, 'backup includes lighting');
assert.match(src, /applyRoomLighting\(s\.roomLighting\); save\(\)/, 'selection is applied and persisted');
assert.match(src, /x\.setAttribute\('aria-pressed', String\(on\)\)/);
assert.equal(src, fs.readFileSync(path.join(__dirname, '../website/app/app/stationui.js'), 'utf8'));
console.log('room-lighting-settings: three levels, renderer updates, default/fallback and mirror passed');
