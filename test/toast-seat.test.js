'use strict';

/* toast-seat.test.js — WHERE THE TOAST RACK IS BOLTED.
 *
 * The bug (Andrew, 2026-08-15: "EXTREMELY ugly, will phase through windows, is not aligned
 * correctly"): #toast-stack was pinned by two literal numbers — `left: 268px * --cz` and
 * `bottom: 128px * --cz` — that lined up with nothing. Measured live at 1440x900: the columns
 * run x 11→1429 and end at y 836, so the rack floated 257px right of the cabinet's left edge and
 * 64px above the floor line, in the middle of the stage tube where every floating window is
 * centred. And because the CREW seam is DRAGGABLE (--crew-w, leftrail.js), a wide rail walked the
 * stage out from under the rack and the card ended up sitting ON the crew list.
 *
 * The fix is a MEASURED seat (StationUI.seatToastRack, the syncTermBand idiom): read the real
 * cabinet rects, divide by the TEXT SIZE zoom exactly once, publish --toast-x / --toast-b /
 * --toast-cap. This test locks both halves so neither can quietly regress to arithmetic:
 *   1. the sheet consumes the vars and carries no hard-coded anchor for the rack
 *   2. the positioner exists, measures the chrome, converts once, and runs at both the moments
 *      that matter (a card being emitted, and the frame being resized)
 * Proof harness + before/after renders: dev/toast-seat-shots.mjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const root = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const motion = read('frontend', 'css', 'motion.css');
const ui = read('frontend', 'app', 'stationui.js');
const motionMirror = read('website', 'app', 'css', 'motion.css');
const uiMirror = read('website', 'app', 'app', 'stationui.js');

// pull the #toast-stack rule body out of the sheet by exact selector
function ruleFor(css, selector) {
  const re = new RegExp('(^|\\})\\s*' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(css);
  return m ? m[2] : null;
}

// ---- 1 · the sheet takes its anchor from the measured vars -------------------------------
const rack = ruleFor(motion, '#toast-stack');
A.ok(rack, 'motion.css still declares a #toast-stack rule');
A.ok(/left:\s*var\(--toast-x/.test(rack), 'the rack takes its left edge from the measured --toast-x');
A.ok(/bottom:\s*var\(--toast-b/.test(rack), 'the rack takes its bottom edge from the measured --toast-b');
A.ok(/width:\s*min\([^)]*var\(--toast-cap/.test(rack), 'the rack caps its width against the measured --toast-cap');
A.ok(/z-index:\s*var\(--z-toast/.test(rack), 'the rack keeps the toast z tier (audit P0 #13: it must beat every overlay)');

// The exact numbers that pinned it to nothing. Named individually so a regression says WHICH
// magic number came back rather than just "the rule changed".
A.ok(!/\b268px\b/.test(rack), 'the 268px left anchor is gone — it lined up with no edge of the cabinet');
A.ok(!/\b128px\b/.test(rack), 'the 128px bottom anchor is gone — it floated the rack above the floor line');

// the 1120px fork existed only to hand-guess "never reach COMMS" one breakpoint at a time;
// --toast-cap is measured against the stage's real right edge, so the fork must not come back.
A.ok(!/@media[^{]*1120px[^{]*\{[^}]*#toast-stack/.test(motion.replace(/\s+/g, ' ')),
  'no per-breakpoint #toast-stack fork — the cap is measured, not guessed');

// ---- 2 · the positioner ------------------------------------------------------------------
A.ok(/function seatToastRack\(/.test(ui), 'StationUI defines seatToastRack()');

// brace-counted, not char-sliced (the _assert.js fnBody note) — plus the length guard that
// catches a mis-scan running long into the neighbouring toast().
const body = A.fnBody(ui, 'function seatToastRack(');
A.ok(body.length > 200 && body.length < 3000, 'seatToastRack() body scanned cleanly (not empty, not run long)');

A.ok(/getElementById\('screen-game'\)[\s\S]*classList\.contains\('active'\)/.test(body),
  'it refuses to seat against a hidden screen (no geometry there)');
A.ok(/box\('bottombar'\)/.test(body), "the left edge is measured off #bottombar — the cabinet's outer padding line");
A.ok(/box\('stage-wrap'\)/.test(body), "the bottom edge and the room cap are measured off #stage-wrap");
A.ok(/if \(!bar \|\| !stage\) return;/.test(body), 'it fails OPEN — a degenerate rect leaves the CSS fallback alone');
A.ok(/uiZoom\(\)/.test(body), 'it converts VISUAL rects into the body-zoomed px a <body> child styles in');
// the uiZoom law: exactly one division per published length, never zero and never twice.
['--toast-x', '--toast-b', '--toast-cap'].forEach(v => {
  A.ok(new RegExp('setProperty\\(\'' + v + '\'').test(body), 'it publishes ' + v);
});
A.ok(/\/ z\) \+ 'px'/.test(body), 'the published anchors are divided by the zoom exactly once');
A.ok(/\.nav-coach/.test(body),
  'it clears the one-time .nav-coach mark — a first-run instruction with a dismiss button is never buried');

// ---- 3 · it actually runs at the two moments that matter ---------------------------------
A.ok(/seatToastRack\(stack\);/.test(ui),
  'toast() re-seats the rack before the card is visible (a rail drag may have moved the seam)');
A.ok(/function reseatToasts\(\)[^\n]*seatToastRack\(document\.getElementById\('toast-stack'\)\)/.test(ui),
  'reseatToasts() re-seats a card that is already on screen');
A.ok(/addEventListener\('resize'[\s\S]{0,900}reseatToasts\(\)/.test(ui),
  'the resize path calls it (a TEXT SIZE flip dispatches a synthetic resize, so that is covered too)');

// ---- 4 · the downloadable website mirror carries the same seat ---------------------------
const rackMirror = ruleFor(motionMirror, '#toast-stack');
A.ok(rackMirror && /left:\s*var\(--toast-x/.test(rackMirror) && /bottom:\s*var\(--toast-b/.test(rackMirror),
  'the website mirror carries the measured anchor too');
A.ok(/function seatToastRack\(/.test(uiMirror), 'the website mirror carries the positioner too');

A.report('toast-seat.test');
