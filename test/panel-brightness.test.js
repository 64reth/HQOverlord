/* node test/panel-brightness.test.js — the BRIGHTNESS knob (Settings › APPEARANCE, 2026-08-05).
   Andrew's directive after scrapping two bright-ground themes (light mode 07-31, paper mode 08-05):
   panels may get BRIGHTER, but never via a white/bright ground. BRIGHTNESS is the knob a real tube
   has — it lifts the BLACK LEVEL of the panel glass toward the phosphor in force, so the ground
   brightens in the theme's own light. These lock that promise:
     · the lift mixes toward the ACCENT and is hard-capped well short of it (never toward white)
     · only the three ground tokens lift — --bg (the page/room) and the station feed stay dark
     · 0 (the default) writes nothing inline: an untouched station is byte-identical to shipped
     · the override lands on document.body (the bezel-var trap side), and persists/exports */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const uiSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

/* ---- the setting exists, defaults OFF, and persists ---- */
A.ok(/panelBright: 0,/.test(uiSrc), "defaults() seeds panelBright: 0 — a save written before this knob merges to the exact look it had");
A.ok(/panelBright: store\.settings\.panelBright/.test(uiSrc), 'backup export carries panelBright (settings round-trip through backup/restore)');

/* ---- the lift math: capped, accent-directed, ground-tokens only ---- */
const liftBlock = /const lift = clampN\(s\.panelBright, 0, 100, 0\) \/ 100 \* (0\.\d+);[\s\S]*?for \(const tok of \[([^\]]+)\]\)/.exec(uiSrc);
A.ok(liftBlock, 'applySettings carries the BRIGHTNESS lift block (clamped slider → capped mix factor)');
const CAP = liftBlock ? Number(liftBlock[1]) : 1;
A.ok(CAP <= 0.25, 'the lift is hard-capped at ≤25% of the way to the accent (got ' + CAP + ') — panels can never trend toward white');
const toks = liftBlock ? liftBlock[2] : '';
A.ok(/--panel'/.test(toks) && /--panel2'/.test(toks) && /--ph-faint'/.test(toks), 'the lift covers the three ground tokens (--panel/--panel2/--ph-faint)');
A.ok(!/--bg/.test(toks), 'THE ROOM STAYS DARK: --bg is never lifted — panel/page separation is structural, not tuned');
A.ok(/if \(lift > 0\.001\)/.test(uiSrc), 'at BRIGHTNESS 0 no inline override is written — the shipped look leaves no residue');
A.ok(/phRgb\[i\] - v\) \* lift/.test(uiSrc), 'the mix target is the phosphor in force (--ph-rgb), not a hardcoded colour or white');

/* ---- worst case stays dark: full knob on the brightest stock accent ---- */
// amber --panel ground (5,3,1) lifted CAP toward amber --ph (255,170,51): even at 100% the panel's
// WCAG relative luminance must stay far below a mid gray — "brighter, never bright".
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const lifted = [5, 3, 1].map((v, i) => Math.round(v + ([255, 170, 51][i] - v) * CAP));
A.ok(lum(lifted) < 0.08, 'amber panel at FULL brightness stays a dark surface (relative luminance ' + lum(lifted).toFixed(3) + ' < 0.08)');

/* ---- the bezel-var trap: the override lands on body, never the root ---- */
A.ok(!/documentElement\.style\.setProperty/.test(uiSrc), 'no token is ever written on documentElement — the body-level composite recipes must keep resolving');

/* ---- the control renders and wires ---- */
A.ok(/id="set-bright"/.test(uiSrc), 'the BRIGHTNESS slider renders in Settings › APPEARANCE');
A.ok(/wireSlider\(brightIn, v => \{ s\.panelBright = clampN\(v, 0, 100, 0\)/.test(uiSrc), 'the slider instant-applies + clamps + persists through the shared wireSlider idiom');

A.report('panel-brightness');
