'use strict';
/* dossier-persona-ui.test.js — source-lock that the AGENT DOSSIER's per-agent PERSONALITY card is actually
   WIRED (not decorative). Until this card, the ONLY post-create way to change a personality was /personality
   in COMMS. Grep-style guards (mirror settings-p1-ui.test.js):
     - the CONFIG tab renders a personality card built from Personas.list() (never a hardcoded set)
     - a chip pick reaches access.config.setPersona → App.setAgentPersona
     - setAgentPersona recomposes the agent's live prompt AND pushes the roster (delegation/cron speak it too)
     - the UNHINGED chip keeps the house two-press confirm (it swears for real)
     - the applied highlight comes from a rerender off recorded truth, never an optimistic class flip */
const assert = require('assert');
const fs = require('fs'); const path = require('path');
const app = (f) => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', f), 'utf8');
const ui = app('stationui.js'), appjs = app('app.js');

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// ---- the card exists and is composed into the CONFIG tab ----
ok(/function personaCard\(/.test(ui), 'the dossier renders a per-agent PERSONALITY card');
ok(/function agConfig\(a\)[\s\S]*?personaCard\(a\)/.test(ui), 'personaCard is composed into agConfig');
ok(/Personas\.list\(\)\.map/.test(ui), 'the chips are built from Personas.list() — new presets appear automatically');
ok(/id="ag-persona-chips"/.test(ui), 'the chip row is addressable for wiring');
ok(/ov-vchip/.test(ui), 'the chips reuse the genesis .ov-vchip vocabulary');

// ---- a pick reaches a real App path (not decorative) ----
ok(/access\.config\.setPersona/.test(ui), 'a chip pick calls config.setPersona');
ok(/function setAgentPersona\(/.test(appjs), 'App implements setAgentPersona');
ok(/setPersona:\s*setAgentPersona/.test(appjs), 'setPersona is exposed on the config access surface');
ok(/setAgentPersona[\s\S]{0,900}composeSystemPrompt\(a\)/.test(appjs), 'the pick recomposes the agent’s live prompt (personality is prompt text)');
ok(/setAgentPersona[\s\S]{0,1500}pushRoster\(\)/.test(appjs), 'the recomposed prompt reaches the sidecar roster (delegated + cron runs)');
ok(/setAgentPersona[\s\S]{0,1500}persist\(\)/.test(appjs), 'the pick persists');

// ---- honesty details ----
ok(/UNHINGED — SURE\? it swears, for real/.test(ui), 'UNHINGED keeps the two-press confirm in the dossier');
ok(/setPersona\(a && a\.id, id\);[\s\S]{0,400}rerender\('agents'\)/.test(ui), 'the applied state re-renders from recorded truth, never an optimistic highlight');

console.log('dossier-persona-ui.test.js OK —', n, 'assertions');
