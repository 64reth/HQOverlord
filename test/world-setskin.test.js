/* node test/world-setskin.test.js — the machine assertion the Atlas skin cluster (ui/crew/aria-<skin>,
   finding d2121f51) was missing. The AGENT DOSSIER › BRIEF › CHANGE SKIN tiles promise: clicking a tile
   calls World.setSkin so the floor sprite swaps live, the .sel marker follows, and the skin persists as a
   roster property (survives reload). Two of those three halves are honestly headless-testable:

     1. THE CATALOG is the single source of truth both pickers read (DATA.SKINS in data-shim.js). It is a
        pure literal — extract + eval it and assert every advertised tile resolves to a well-formed set.
     2. THE VALIDATE→PERSIST→RE-RENDER WIRING in the two setters is source-locked: an unknown skin is
        refused, a known skin is written onto the record (a.skin / b.skin), World.setSkin repoints the live
        body, StationUI.setRoster repaints the picker, and persist() writes it for reload.

   HONESTLY OUT OF HEADLESS SCOPE: the actual canvas sprite swap and the .sel selected-tile marker move are
   rAF/canvas-only (world.js is not node-loadable) — those stay covered by the live Atlas sweep, not here.
   data-shim.js / world.js / app.js are all browser-flow (no module.exports), so the catalog is eval-extracted
   and the setters are source-locked (the chat-linkify / settings-p1-ui house pattern). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const app = f => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', f), 'utf8');
const shimSrc = app('data-shim.js'), worldSrc = app('world.js'), appSrc = app('app.js');

/* ---- 1. THE CATALOG: extract + eval the pure DATA.SKINS literal and prove its shape ---- */
const m = /DATA\.SKINS = (\{[\s\S]*?\n\});/.exec(shimSrc);
A.ok(m, 'data-shim.js still defines the DATA.SKINS literal');
// eslint-disable-next-line no-new-func
const SKINS = new Function('return ' + m[1] + ';')();
A.ok(SKINS && typeof SKINS === 'object', 'DATA.SKINS eval-extracts to an object');
const keys = Object.keys(SKINS);
A.ok(keys.length >= 20, 'the catalog carries the full genesis skin set (' + keys.length + ' skins)');
for (const k of keys) {
  const e = SKINS[k];
  A.ok(e && typeof e.name === 'string' && e.name.trim(), 'skin "' + k + '" has a display name');
  A.ok(e && typeof e.set === 'string' && e.set.trim(), 'skin "' + k + '" names a sprite set');
  A.ok(e && typeof e.scale === 'number' && e.scale > 0 && e.scale < 1, 'skin "' + k + '" has a sane downscale');
}
// the DEFAULT_SKIN must itself be a real catalog entry (the create screen falls back to it)
const dm = /DATA\.DEFAULT_SKIN = '([^']+)';/.exec(shimSrc);
A.ok(dm && SKINS[dm[1]], 'DATA.DEFAULT_SKIN points at a real catalog skin (' + (dm && dm[1]) + ')');

// the named tiles the crew.json cluster asserts (aria-<name> buttons) each resolve by DISPLAY NAME
const namesLc = new Set(keys.map(k => SKINS[k].name.toLowerCase()));
for (const name of ['Alien', 'Cadet', 'Blank Amber', 'Blank Blue', 'Blank Green', 'Blank Red', 'Capybara', 'Crewmate', 'Robot']) {
  A.ok(namesLc.has(name.toLowerCase()), 'the "' + name + '" cluster tile resolves to a catalog skin');
}

/* ---- 2. WORLD.SETSKIN: validate against the catalog, write the body skin, return the outcome ---- */
const wm = /function setSkin\(agentId, skin\)\s*\{([\s\S]*?)\n  \}/.exec(worldSrc);
A.ok(wm, 'world.js still defines setSkin(agentId, skin)');
const wBody = wm ? wm[1] : '';
A.ok(/!DATA\.SKINS\[sk\][\s\S]*return false/.test(wBody), 'world.setSkin refuses a skin not in DATA.SKINS (no phantom sprite)');
A.ok(/bodyForAgent\(agentId\)/.test(wBody) && /return false/.test(wBody), 'world.setSkin refuses an unknown agent body');
A.ok(/b\.skin = sk/.test(wBody), 'world.setSkin repoints the live body skin (the sprite-swap seam)');
A.ok(/setSkin\b/.test(worldSrc) && /return \{[\s\S]*\bsetSkin\b/.test(worldSrc), 'world.js exports setSkin on the World surface');

/* ---- 2b. BAY-BOUND REHYDRATE: loadStation creates these bodies before spawnAgent restores the roster. ---- */
const sm = /function spawnAgent\(a\)\s*\{([\s\S]*?)\n  \}/.exec(worldSrc);
A.ok(sm, 'world.js still defines spawnAgent(a)');
const existing = sm && /const ex = crew\.find\([^;]+\);[\s\S]*?if \(ex\)\s*\{([\s\S]*?)return;\s*\}/.exec(sm[1]);
A.ok(existing, 'spawnAgent has the existing bay-body rehydrate path');
const exBody = existing ? existing[1] : '';
A.ok(/ex\.skin\s*=\s*a\.skin/.test(exBody), 'a bay-bound body restores its persisted skin before spawnAgent returns');
A.ok(/ex\.name\s*=\s*a\.name/.test(exBody), 'a bay-bound body restores its persisted display name before spawnAgent returns');
A.ok(/ex\.color\s*=\s*a\.color/.test(exBody), 'a bay-bound body restores its persisted suit color before spawnAgent returns');

/* ---- 3. APP.SETAGENTSKIN: the full round-trip — validate → persist-as-roster-property → live → re-render ---- */
const am = /function setAgentSkin\(agentId, skin\)\s*\{([\s\S]*?)\n  \}/.exec(appSrc);
A.ok(am, 'app.js still defines setAgentSkin(agentId, skin)');
const aBody = am ? am[1] : '';
A.ok(/!DATA\.SKINS\[sk\][\s\S]*return false/.test(aBody), 'setAgentSkin refuses a skin absent from the catalog (returns false)');
A.ok(/a\.skin = sk/.test(aBody), 'setAgentSkin persists the skin onto the agent RECORD (the roster property that survives reload)');
A.ok(/World\.setSkin\(a\.id, sk\)/.test(aBody), 'setAgentSkin live-updates the floor sprite via World.setSkin');
A.ok(/StationUI\.setRoster\(/.test(aBody), 'setAgentSkin repaints the dossier picker (the re-rendered selected value)');
A.ok(/\bpersist\(\)/.test(aBody), 'setAgentSkin persists so the skin survives a reload');
A.ok(/setSkin:\s*setAgentSkin/.test(appSrc), 'setAgentSkin is exposed on the dossier config access surface (access.config.setSkin)');

A.report('world-setskin');
