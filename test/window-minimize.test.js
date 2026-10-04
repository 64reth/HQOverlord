/* node test/window-minimize.test.js — the machine assertion the shared window MINIMIZE control
   (ui/system/aria-minimize-*, finding e9e4fab6) was missing. Every station window's –/MINIMIZE button
   (class term-min → minimizeTerm) promises a collapse-to-dock-chip that KEEPS the window alive and
   RESTORES it to the exact same geometry. The Atlas sweep's CLOSE helper only clicks term-x, so the
   collapse/restore round-trip had no committed guard.

   minimizeTerm/restoreTerm are DOM+layout driven (document.activeElement, offsetLeft, animation events,
   CSS.escape) inside the StationUI IIFE, and offsets read 0 under jsdom (no layout engine) — so the
   collapse/restore GEOMETRY round-trip is not honestly reproducible headlessly. We do two things:

     1. GENUINE unit — the exported clampTerminalSize (the geometry primitive the restore path runs a
        persisted rectangle through) preserves an in-range size and fails closed on a malformed one.
     2. SOURCE-LOCK the collapse/restore invariants (element kept alive, hidden-not-destroyed, geometry
        captured into termPos and re-applied via placeTerm on restore) — the outbox-window house pattern.

   OUT OF HEADLESS SCOPE: the live pixel collapse animation + the actual restored on-screen rectangle stay
   covered by the CDP journey scripts\qa\terminal-resize-journey.mjs, not here. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const { clampTerminalSize } = require('../frontend/app/stationui.js');

/* ---- 1. GENUINE: the geometry primitive restore leans on preserves a valid rect, clamps a bad one ---- */
const desktop = { width: 1440, height: 900 };
const limits = { minWidth: 560, minHeight: 360, maxWidth: 1200, maxHeight: 840 };
A.eq(clampTerminalSize({ width: 900, height: 640 }, limits, desktop), { width: 900, height: 640 }, 'a restored in-range size is preserved unchanged');
A.eq(clampTerminalSize({ width: 'bad', height: null }, limits, desktop), { width: 560, height: 360 }, 'a malformed persisted size fails closed to the usable minimum (no NaN rect on restore)');

/* ---- 2. SOURCE-LOCK the collapse/restore round-trip invariants ---- */
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');
function body(re, label) { const m = re.exec(src); A.ok(m, 'stationui.js still defines ' + label); return m ? m[0] : ''; }

// the entry point: no dedicated button (it read as a duplicate ✕, removed 2026-07-22) —
// header double-click is the minimize gesture, and it must never re-grow the button.
A.ok(!/mkEl\('button', 'term-min'/.test(src), 'no dedicated term-min button (removed — it duplicated the ✕)');
A.ok(/dblclick[\s\S]{0,300}?minimizeTerm\(key\)/.test(src), 'header double-click calls minimizeTerm(key)');

const minB = body(/function minimizeTerm\(key\)\s*\{[\s\S]*?\n  \}/, 'minimizeTerm(key)');
// geometry preserved: an explicitly-moved window's rect is captured into the SAME map restore reads
A.ok(/w\.classList\.contains\('term-moved'\)[\s\S]{0,80}termPos\[key\] = \{ left: w\.offsetLeft, top: w\.offsetTop \}/.test(minB),
  'minimizeTerm captures a moved window\'s position into termPos before hiding (geometry preserve)');
// element kept ALIVE, hidden not destroyed — the logical open state survives
A.ok(/minimized\[key\] = true/.test(minB), 'minimizeTerm marks the window minimized (logical open state kept)');
A.ok(/term-min-hidden/.test(minB) && /aria-hidden', 'true'/.test(minB), 'minimizeTerm hides via term-min-hidden + aria-hidden (element stays alive, not torn down)');
A.ok(/addChip\(key\)/.test(minB), 'minimizeTerm drops a dock chip to restore from');
A.ok(!/delete open\[key\]/.test(minB) && !/_onClose/.test(minB), 'minimizeTerm does NOT destroy the window or run its close teardown');

const resB = body(/function restoreTerm\(key\)\s*\{[\s\S]*?\n  \}/, 'restoreTerm(key)');
A.ok(/if \(!w \|\| !minimized\[key\]\) return/.test(resB), 'restoreTerm no-ops on a window that is not minimized');
A.ok(/delete minimized\[key\]/.test(resB) && /removeChip\(key\)/.test(resB), 'restoreTerm clears the minimized flag and removes the chip');
A.ok(/classList\.remove\('term-min-hidden'/.test(resB) && /removeAttribute\('aria-hidden'\)/.test(resB), 'restoreTerm un-hides the window');
A.ok(/if \(key === 'agents'\) rerender\('agents', false\)/.test(resB),
  'restoring the Agent Dossier refreshes its live counters through the swap:false form-preserving render — fresh counters AND a dirty CONFIG draft survive together (the earlier skip-while-dirty guard keyed off a data-dirty flag nothing cleared and froze the refresh)');
// the form-preservation mechanism the restore relies on must exist: capture before the builder, restore after
A.ok(/captureForms\(\)/.test(src) && /restoreForms\(keep\)/.test(src) && /swap === false \? captureForms\(\)/.test(src),
  '_render(false) captures input/textarea/select state before the innerHTML rebuild and restores it after');
// and the measurement primitive itself refuses a minimized/zero-size window (the 8,8 corner-teleport class)
A.ok(/minimized\[resolvedKey\] \|\| \(w\.classList && w\.classList\.contains\('term-min-hidden'\)\)/.test(src),
  'fitTermInViewport refuses to measure a minimized window at the primitive (marker-keyed), covering every caller');
A.ok(/placeTerm\(w, key\)/.test(resB), 'restoreTerm re-applies the remembered geometry via placeTerm (lands it back exactly)');

// placeTerm honours the captured termPos (the geometry round-trip completes)
A.ok(/function placeTerm\([\s\S]{0,400}const p = termPos\[key\]/.test(src), 'placeTerm reads termPos[key] to restore the exact rectangle');
A.ok(/function isMinimized\(key\)[\s\S]{0,60}!!minimized\[key\]/.test(src), 'isMinimized reflects the collapsed state truthfully');

A.report('window-minimize');
