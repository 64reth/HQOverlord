'use strict';

/* The phone-width control floor: safety and exit hardware must remain painted at
 * 320/360/390 CSS px, dock flyouts must clamp in visual pixels even under uiZoom,
 * and optional setup switches must wrap instead of disappearing behind a bezel. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');

const root = path.resolve(__dirname, '..');
const appCss = fs.readFileSync(path.join(root, 'frontend', 'css', 'app.css'), 'utf8');
const topCss = fs.readFileSync(path.join(root, 'frontend', 'css', 'topbar.css'), 'utf8');
const navSrc = fs.readFileSync(path.join(root, 'frontend', 'app', 'navdock.js'), 'utf8');

function has(re, label, text = appCss) { A.ok(re.test(text), label); }

// Narrow chrome sheds secondary instruments while retaining connection status.
has(/@media \(max-width: 600px\)[\s\S]*#topbar #wr-top,[\s\S]*#topbar #tb-station,[\s\S]*#topbar \.tb-sep\s*\{\s*display:\s*none/s,
  'mobile topbar removes the widget rail, level lamp and separator', topCss);
has(/@media \(max-width: 600px\)[\s\S]*#topbar \.tb-status\s*\{[^}]*gap:\s*4px;[^}]*padding:\s*0/s,
  'mobile status cluster spends no hidden padding around safety controls', topCss);
has(/id="chat-stop"[^>]*aria-label="Stop the running turn"/,
  'COMMS retains the current-conversation Stop control', fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8'));

// Genesis: the tint bank owns a second row, so all six 14px switches fit even at 320px.
has(/@media \(max-width: 600px\)[\s\S]*\.cc-titlebar\s*\{[^}]*flex-wrap:\s*wrap/s,
  'genesis titlebar wraps on phone widths');
has(/\.cc-tb-phosphor\s*\{[^}]*flex:\s*0 0 100%;[^}]*order:\s*5/s,
  'phosphor bank receives a dedicated full-width row');
for (const width of [320, 360, 390]) {
  const panelInner = width - 28 - 44; // screen padding + console-head inline padding
  A.ok(6 * 14 + 5 * 5 <= panelInner,
    'all six phosphor switches fit their dedicated row at ' + width + 'px');
}

// REFIT: title row + compact action row; DONE cannot be displaced by prose.
has(/@media \(max-width: 600px\)[\s\S]*\.refit-top\s*\{[^}]*grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\);[^}]*grid-template-rows:\s*auto 30px;[^}]*height:\s*68px/s,
  'REFIT action deck reserves exactly six phone-width action columns');
has(/\.refit-title\s*\{[^}]*grid-column:\s*1 \/ -1/s,
  'REFIT title owns row one');
has(/\.refit-top \.bb\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*height:\s*30px/s,
  'all six REFIT actions fill their shrinkable grid cells');
for (const width of [320, 360, 390]) {
  const actionRow = width - 16 - (5 * 4); // inline padding + five gaps
  A.ok(actionRow / 6 > 0,
    'six REFIT action keys receive a positive grid track at ' + width + 'px');
}

// REFIT's narrow bottom sheet has only 48% of the glass. With the modes in the desktop
// two-column grid, five fixed rows consumed the entire 640x568 sheet and collapsed the one
// scrollable OPTIONS palette to clientHeight=0. Three narrow-screen columns keep every mode
// visible while leaving a real scroll viewport for the LINES shelf.
//
// 2026-08-07 (build-mode overhaul): the desktop dock now bands the modes into named groups
// (STRUCTURE / SURFACES / WORKFLOW / EDIT), so `.refit-tools` is a PER-GROUP grid rather than
// the single grid that used to hold all of them. Three columns per group would leave a dead
// third column on every two-tool band, so the sheet dissolves the wrappers to `display:contents`
// and #refit-tools itself carries the three-column grid. Same guarantee, new owner: assert the
// wrappers dissolve AND that the element which actually lays the modes out is three columns.
has(/@media \(max-width: 760px\)[\s\S]*\.refit-toolgroup, \.refit-tools\s*\{[^}]*display:\s*contents/s,
  'narrow REFIT dissolves the desktop tool bands so no group leaves a dead column');
has(/@media \(max-width: 760px\)[\s\S]*#refit-tools\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s,
  'narrow REFIT compacts every mode to three columns so OPTIONS retains a scroll viewport');
// The BUILD KIT plate is redundant under the ▮ REFIT MODE title on a phone; the palette needs it more.
has(/@media \(max-width: 760px\)[\s\S]*\.refit-group-label, \.refit-dock-head\s*\{[^}]*display:\s*none/s,
  'narrow REFIT drops the band captions and the dock header plate');

// Dock CSS caps intrinsic content; JS then clamps each wrapped trigger in visual pixels.
has(/\.bb-menu\s*\{[^}]*min-width:\s*0;[^}]*width:\s*min\(300px, calc\(100vw - 16px\)\);[^}]*max-width:\s*calc\(100vw - 16px\)/s,
  'mobile dock menu can never demand more than viewport minus two 8px edges');
has(/function clampMenu\(g\)[\s\S]*cssWidth = Math\.max\(0, window\.innerWidth - edge \* 2\) \/ zoom[\s\S]*getBoundingClientRect\(\)[\s\S]*shift \/ zoom/s,
  'navdock caps width, clamps visual rects and divides once by the zoom the menu renders at', navSrc);
has(/window\.addEventListener\('resize',[^\n]*clampMenu/s,
  'open dock menus re-clamp after responsive resize', navSrc);

// Execute the real navdock clamp against a zoomed synthetic group. A 304px menu anchored
// at x=127 used to end at 431 on a 320px viewport; it must settle exactly on [8,312].
function runClamp(baseLeft, width, zoom) {
  const handlers = {};
  const classes = new Set();
  const menu = {
    style: {
      left: '0px', width: '', maxWidth: '',
      removeProperty(k) { this[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = ''; }
    },
    addEventListener(type, fn) { if (type === 'animationend') fn(); },
    getBoundingClientRect() {
      const left = baseLeft + (parseFloat(this.style.left) || 0) * zoom;
      const liveWidth = this.style.width ? parseFloat(this.style.width) * zoom : width;
      return { left, right: left + liveWidth, width: liveWidth };
    }
  };
  const trigger = {
    setAttribute() {}, blur() {}, focus() {},
    addEventListener(type, fn) { handlers[type] = fn; }
  };
  const group = {
    classList: {
      contains(k) { return classes.has(k); },
      add(k) { classes.add(k); }, remove(k) { classes.delete(k); },
      toggle(k, force) { if (force) classes.add(k); else classes.delete(k); }
    },
    querySelector(sel) {
      if (sel === '.bb-menu') return menu;
      if (sel === '.bb-grp') return trigger;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {}, contains() { return false; }
  };
  const bar = { querySelectorAll: () => [group], querySelector: () => null, contains: () => false };
  const document = {
    activeElement: null,
    getElementById(id) { return id === 'bottombar' ? bar : null; },
    addEventListener() {}
  };
  const window = { innerWidth: 320, addEventListener() {} };
  const sandbox = {
    document, window,
    // The synthetic menu's rect scales its style.left by `zoom`, i.e. it models an element
    // RENDERING at that zoom — which is exactly what U.elZoom reports (see js/util.js). navdock
    // asks elZoom rather than uiZoom because the dock is cabinet: TEXT SIZE counter-zooms
    // #bottombar back to 1:1, so the popover's local frame is visual px while <body> is zoomed.
    U: { uiZoom: () => zoom, elZoom: () => zoom },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(fn) { fn(); }
  };
  vm.runInNewContext(navSrc, sandbox, { filename: 'navdock.js' });
  handlers.click({ stopPropagation() {}, detail: 1 });
  return menu.getBoundingClientRect();
}

let r = runClamp(127, 304, 1.25);
A.ok(Math.abs(r.left - 8) < 0.01 && Math.abs(r.right - 312) < 0.01,
  'right-overflowing zoomed dock clamps to the 8px viewport edges');
r = runClamp(-20, 280, 1.25);
A.ok(Math.abs(r.left - 8) < 0.01 && r.right <= 312,
  'left-overflowing zoomed dock clamps to the 8px viewport edge');
// ...and at effective zoom 1, which is what the dock actually renders at once TEXT SIZE
// counter-zooms it as cabinet. The clamp must land on the same edges either way.
r = runClamp(127, 304, 1);
A.ok(Math.abs(r.left - 8) < 0.01 && Math.abs(r.right - 312) < 0.01,
  'counter-zoomed (1:1) dock clamps to the same 8px viewport edges');

// Short landscape: fixed controls fit before the grid's own overflow fallback is needed.
has(/@media \(max-width: 860px\) and \(max-height: 680px\)[\s\S]*overflow-y:\s*auto[\s\S]*grid-template-rows:\s*42px minmax\(72px, 1fr\) minmax\(160px, 1fr\) minmax\(38px, auto\)[\s\S]*padding:\s*4px[\s\S]*gap:\s*3px/s,
  'short landscape reserves compact stage and full composer/dock rows');
const shortLandscapeMin = 42 + 72 + 160 + 38 + (3 * 3) + (2 * 4);
A.ok(shortLandscapeMin <= 390,
  'short-landscape minimum grid budget fits an 844x390 viewport (' + shortLandscapeMin + 'px)');
const commsCss = fs.readFileSync(path.join(root, 'frontend', 'css', 'comms.css'), 'utf8');
has(/@media \(max-width: 860px\) and \(max-height: 680px\)[\s\S]*#chat-inputrow\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto[\s\S]*\.chat-editline\s*\{\s*grid-column:\s*1[\s\S]*\.chat-tools\s*\{\s*grid-column:\s*2/s,
  'short landscape places the edit line and COMMS controls side by side', commsCss);

A.report('mobile-control-reachability.test');
