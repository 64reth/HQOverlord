'use strict';

/* control-floor-theming.test.js — THE white-HTML-control gate.
 *
 * The recurring bug (reported by Andrew 2026-07-27, and at least twice before that: the
 * SURFACE/REFIT bare <button>, the CHANNELS "RUNS AS" select, the DELIVERABLES status filter):
 * a new control ships without a surface class, so the browser paints it — buttonface white,
 * ButtonBorder grey, black Arial — inside a phosphor-terminal UI. There was no element-level
 * floor in the sheet, only per-surface skins (.btn / .bb / .mkt-in / .fbc-sel / .mp-model …),
 * so forgetting the class was all it took.
 *
 * frontend/css/app.css now carries a CONTROL FLOOR block. This test keeps it honest on both
 * sides, because BOTH failure modes have bitten:
 *   1. the floor gets deleted / hollowed out       -> white controls come back
 *   2. the floor gets "improved" with more properties or higher specificity -> it starts
 *      overriding real surface skins (a draft of it leaked border-radius + box-shadow onto
 *      id-styled class-less buttons like #ws-new and #estop-btn)
 */

const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'frontend', 'css', 'app.css'), 'utf8');

// ---- the block exists and is findable by name -------------------------------------------
A.ok(/CONTROL FLOOR/.test(css), 'app.css still carries the CONTROL FLOOR block');

// Pull one element-level rule body out of the sheet by exact selector. Element-level means the
// selector is JUST the element/attribute form — no class, no id — which is what keeps the floor
// underneath every surface skin.
function ruleBody(selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('(?:^|\\}|\\*/)\\s*' + esc + '\\s*\\{([^}]*)\\}', 'm').exec(css);
  return m ? m[1] : null;
}

// ---- 1. the floor must actually repaint every control the UA would otherwise paint --------
const FLOOR = [
  { sel: 'select', needs: ['color', 'background-color', 'border', 'font-family'] },
  { sel: 'textarea', needs: ['color', 'background-color', 'border', 'font-family'] },
  { sel: 'button, input[type=button], input[type=submit], input[type=reset]',
    needs: ['color', 'background-color', 'border', 'font-family'] },
  { sel: 'input[type=checkbox], input[type=radio], input[type=range], progress', needs: ['accent-color'] },
  { sel: 'input[type=file]::file-selector-button', needs: ['color', 'background-color', 'border', 'font-family'] },
];

for (const { sel, needs } of FLOOR) {
  const body = ruleBody(sel);
  A.ok(body, 'CONTROL FLOOR still declares an element-level rule for `' + sel + '`');
  if (!body) continue;
  for (const prop of needs) {
    A.ok(new RegExp('(?:^|;)\\s*' + prop + '\\s*:').test(body),
      '`' + sel + '` floor still sets ' + prop + ' (or the user agent paints it instead)');
  }
  // every colour it sets must come from the theme, never a literal the themes can't re-tint.
  // #000 / transparent are allowed: they are the absence of paint, not a colour choice.
  const colours = body.match(/(?:^|;)\s*(?:color|background-color|accent-color|border-color|border(?![-\w]))\s*:\s*([^;]+)/g) || [];
  for (const decl of colours) {
    const value = decl.split(':').slice(1).join(':');
    A.ok(/var\(--/.test(value) || /#000\b/.test(value) || /transparent/.test(value),
      '`' + sel + '` floor paints from theme vars, not a hardcoded colour — got' + value);
  }
}

// ---- 2. the floor must STAY a floor ------------------------------------------------------
// A floor may only replace what the user agent would have painted. Box metrics and shadows on
// the shared button rule leak onto skinned-but-partial buttons, so they are banned there.
const buttonFloor = ruleBody('button, input[type=button], input[type=submit], input[type=reset]') || '';
for (const banned of ['border-radius', 'box-shadow', 'padding', 'margin', 'letter-spacing', 'text-transform', 'font-size']) {
  A.ok(!new RegExp('(?:^|;)\\s*' + banned + '\\s*:').test(buttonFloor),
    'the shared button floor sets no ' + banned + ' — that leaks onto id-styled class-less buttons (#ws-new, #estop-btn)');
}

// The floor must not be promoted above the surface skins. `html select`-style boosting is the
// F1 chevron rule's job (it deliberately outranks legacy `background:` shorthands); the paint
// floor itself has to lose every tie.
A.ok(!/(?:^|\}|\*\/)\s*html\s+(?:select|button|textarea)\s*\{[^}]*background-color/.test(css),
  'the paint floor is not promoted with `html` — it must lose to every surface skin');

// ---- 3. no OS-chrome keyword may creep back into any frontend sheet ----------------------
const sheets = fs.readdirSync(path.join(root, 'frontend', 'css')).filter(f => f.endsWith('.css'));
for (const file of sheets) {
  const text = fs.readFileSync(path.join(root, 'frontend', 'css', file), 'utf8');
  // strip comments so prose about the bug does not trip its own gate
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const kw of ['buttonface', 'buttonborder', 'buttontext', '-webkit-appearance: button']) {
    A.ok(!new RegExp(kw.replace(/[-]/g, '\\-'), 'i').test(code),
      file + ' names no OS system-control colour (' + kw + ')');
  }
}

// ---- 4. the native select chevron survives (F1 rule, which the floor must not displace) ---
A.ok(/html select:not\(\.comms-agent-select\)\s*\{[^}]*appearance:\s*none/s.test(css),
  'native <select> still renders with appearance:none + the drawn phosphor chevron');

A.report('control-floor-theming.test');
