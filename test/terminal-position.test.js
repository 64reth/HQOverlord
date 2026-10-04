'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { visibleTerminalRect } = require('../frontend/app/stationui.js');

function invariant(rect, viewport, label) {
  const padX = Math.min(8, viewport.width / 4);
  const padY = Math.min(8, viewport.height / 4);
  A.ok(rect.top >= (Number(viewport.top) || 0) + padY, label + ': titlebar remains vertically reachable');
  A.ok(rect.left < viewport.width - padX, label + ': titlebar intersects the viewport');
  A.ok(rect.left + rect.width <= viewport.width - padX, label + ': right-side close control remains reachable');
}

// PU-04: Settings was persisted at x:-996 while desktop-wide, then reopened in a phone-sized
// viewport. The old clamp pins an oversized pre-responsive rect to x:8, leaving its right-side
// close control hundreds of pixels beyond the viewport.
const phone = { width: 390, height: 844 };
const staleWide = visibleTerminalRect(
  { left: -996, top: -40, width: 1060, height: 720 },
  phone
);
invariant(staleWide, phone, 'desktop-wide Settings restored on phone');

// The delayed responsive pass sees Settings at 94vw and rebases it to an ordinary inset.
const responsivePhone = visibleTerminalRect(
  { left: staleWide.left, top: staleWide.top, width: 366, height: 709 },
  phone
);
invariant(responsivePhone, phone, 'responsive phone Settings');
A.eq(responsivePhone.left, 8, 'responsive width is rebased to the normal left inset');

const desktop = { width: 1440, height: 900 };
const backOnDesktop = visibleTerminalRect(
  { left: responsivePhone.left, top: responsivePhone.top, width: 1060, height: 720 },
  desktop
);
invariant(backOnDesktop, desktop, 'phone Settings restored to desktop');
A.eq(backOnDesktop.left, 8, 'desktop restore keeps the repaired coordinate');

const negativeSaved = visibleTerminalRect(
  { left: -5000, top: -5000, width: 480, height: 320 },
  desktop
);
invariant(negativeSaved, desktop, 'negative saved position');
A.eq(negativeSaved.left, 8, 'negative saved X is repaired');
A.eq(negativeSaved.top, 8, 'negative saved Y is repaired');

const oversized = visibleTerminalRect(
  { left: 900, top: 900, width: 1200, height: 1200 },
  phone
);
invariant(oversized, phone, 'oversized terminal');
A.eq(oversized.left + oversized.width, phone.width - 8, 'oversized terminal aligns its close edge inside viewport');
A.eq(oversized.top, 8, 'oversized terminal keeps its titlebar at the top inset');

const tiny = { width: 12, height: 12 };
invariant(visibleTerminalRect({ left: -996, top: -996, width: 480, height: 320 }, tiny), tiny, 'viewport smaller than terminal minimum');

/* ================= THE WINDOW BAND (2026-08-06 report) =================
   "the top of the popup windows get cut off under the header bar (I'm using the largest possible
   font)". A window's viewport is NOT the glass: #topbar owns the top of the frame, #bottombar the
   bottom, and on the Windows desktop shell #sn-titlebar is a <body> child at z930 — a .screen is a
   z-index:10 stacking context, so no window can out-stack it and it swallows whatever it covers,
   title chip and ✕ included. Measured live at 1600x900 / TEXT SIZE 150% before the fix: SETTINGS
   sat at y12..888 with elementFromPoint over its own ✕ returning the app's CLOSE button.
   So the viewport handed to this clamp starts at the band's top, and `top` must be honored. */
const band = { top: 126, width: 1600, height: 719 };
const bandPad = 8;

const shovedUp = visibleTerminalRect({ left: 400, top: -400, width: 900, height: 500 }, band);
invariant(shovedUp, band, 'window dragged above the frame');
A.eq(shovedUp.top, band.top + bandPad, 'a window dragged at the ceiling stops below the chrome, not under it');

const shovedDown = visibleTerminalRect({ left: 400, top: 99999, width: 900, height: 500 }, band);
A.eq(shovedDown.top, band.top + band.height - bandPad - 500, 'a window dragged at the floor stops above the dock');

// Taller than the band (a console at the largest TEXT SIZE): the titlebar is the part that must
// stay reachable, so it parks at the band top and the overflow goes out the bottom.
const tallerThanBand = visibleTerminalRect({ left: 400, top: -900, width: 900, height: 2000 }, band);
A.eq(tallerThanBand.top, band.top + bandPad, 'an over-tall window keeps its titlebar inside the band');

// Back-compat: a plain {width,height} viewport (no band measured yet) behaves exactly as before.
const noBand = visibleTerminalRect({ left: 0, top: -50, width: 480, height: 320 }, { width: 1600, height: 900 });
A.eq(noBand.top, bandPad, 'a viewport with no top offset still clamps to the plain 8px inset');

const source = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');
A.ok((source.match(/visibleTerminalRect\(/g) || []).length >= 4, 'shared clamp drives drag, placement, and repair paths');

// The band is MEASURED — hardcoding either bar's height is the bug this replaces (they are
// counter-zoomed, they re-flow per breakpoint, and F11 removes the desktop one outright).
A.ok(/function measureTermBand\(\)[\s\S]{0,1200}getElementById\('sn-titlebar'\)/.test(source),
  'the band measures the desktop shell titlebar, the one bar that paints OVER windows');
for (const id of ['topbar', 'bottombar']) {
  A.ok(new RegExp("measureTermBand\\(\\)[\\s\\S]{0,1200}getElementById\\('" + id + "'\\)").test(source),
    `the band measures #${id}`);
}
A.ok(/function terminalViewport\(\)\s*\{\s*return termBandCache \|\| syncTermBand\(\);\s*\}/.test(source),
  'every clamp reads the band as its viewport');
// …and it is re-measured on each event that can move a bar, or a window is placed against chrome
// that has since moved (the desktop titlebar mounts AFTER this module loads).
for (const [label, re] of [
  ['window open', /sfx\('open'\);[\s\S]{0,400}syncTermBand\(\)/],
  ['browser resize', /addEventListener\('resize'[\s\S]{0,700}syncTermBand\(\)/],
  ['TEXT SIZE change', /priorZoom[\s\S]{0,400}syncTermBand\(\)/],
  ['init', /function init\(\)\s*\{\s*applySettings\(\);\s*syncTermBand\(\);/]
]) A.ok(re.test(source), `the band is re-measured on ${label}`);
A.ok(/requestAnimationFrame\(\(\) => fitTermInViewport\(w, key, true\)\)/.test(source), 'open/restore reruns the clamp after responsive layout');
A.ok(/rememberTermPosition\(resolvedKey, repaired\.left, repaired\.top\)/.test(source), 'repaired coordinates are persisted');
A.ok(!/Math\.max\(64 - ww/.test(source), 'legacy 64px drag-only clamp is removed');

A.report('terminal-position.test');
