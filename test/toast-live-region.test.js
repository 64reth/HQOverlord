'use strict';
/* toast-live-region.test.js — transient status cards must be announced, not just painted.
   The live region has to exist before stationui.js can emit the first toast; creating and
   populating it in the same turn is not a reliable assistive-technology announcement. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('frontend/index.html');
const mirror = read('website/app/index.html');
const ui = read('frontend/app/stationui.js');

let n = 0;
const ok = (condition, message) => { assert.ok(condition, message); n++; };
const region = /<div id="toast-stack"\s+role="status"\s+aria-live="polite"\s+aria-atomic="false"\s+aria-relevant="additions text"><\/div>/;

ok(region.test(app), 'the shipped shell exposes transient notifications as a polite status live region');
ok(app.indexOf('id="toast-stack"') < app.indexOf('<script src="app/app.js">'),
  'the live region exists before app startup can emit the first toast');
ok(/document\.getElementById\('toast-stack'\)/.test(ui),
  'StationUI appends toast cards to that exact live region');
ok(/stack\.appendChild\(t\)/.test(ui), 'the transient card is added as a live-region change');
ok(/while \(stack\.children\.length > 4\)/.test(ui), 'the existing bounded toast stack remains intact');
ok(region.test(mirror), 'the downloadable website mirror carries the same live-region semantics');
ok(app.includes('aria-relevant="additions text"'), 'only new/changed notification text is announced, not removals');

console.log('toast-live-region.test.js OK —', n, 'assertions');
