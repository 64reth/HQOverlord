/* node test/slash.config.test.js -- static pins for Plan 4 slash config hooks. */
'use strict';

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
const chat = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
const voice = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'voice.js'), 'utf8');

A.ok(app.indexOf('currentAgent: () => agent') >= 0, 'App exposes the current agent for slash status/config commands');
A.ok(app.indexOf('agents: () => liveAgents().map(serializeAgentLite)') >= 0, 'App exposes a copied roster for slash agent status');
A.ok(app.indexOf('applyConfig: applyAgentConfig') >= 0, 'App exposes the existing config application path');
A.ok(app.indexOf("typeof patch.model === 'string'") >= 0, 'App config applies model changes');
A.ok(app.indexOf("typeof patch.personaId === 'string'") >= 0, 'App config applies personality changes');
A.ok(app.indexOf("typeof patch.approvalMode === 'string'") >= 0, 'App config applies approval mode changes');
A.ok(chat.indexOf('App.applyConfig') >= 0, 'chat slash commands use the App config seam');
A.ok(chat.indexOf('/api/skills?placed=') >= 0, 'skills command reads the sidecar skill catalog');
A.ok(voice.indexOf('function setSpeakReplies') >= 0 && voice.indexOf('setSpeakReplies,') >= 0, 'Voice exposes a safe setter for /voice');

// --- reasoning effort is a REAL dial, not a status readout (it used to answer "not a separate toggle yet") ---
A.ok(app.indexOf("typeof patch.reasoningEffort === 'string'") >= 0, 'App config applies reasoning-effort changes');
A.ok(app.indexOf('Harness.setReasoningEffort(eff)') >= 0, 'the effort patch reaches the harness store the run payload reads');
A.ok(app.indexOf('a.reasoningEffort = eff') >= 0, 'the effort is kept on the TARGETED agent so it persists and reaches the roster');
A.ok(chat.indexOf("App.applyConfig({ reasoningEffort: want })") >= 0, '/reasoning writes through the config seam');
A.ok(chat.indexOf("App.applyConfig({ reasoningEffort: 'minimal' })") >= 0, '/fast drives the same real dial instead of announcing a mode that does not exist');
A.ok(chat.indexOf('is not a reasoning level') >= 0, 'an unknown level is refused, never silently normalized to medium');
A.ok(chat.indexOf('MEDIUM_ALIASES') >= 0, 'the silent normalize-to-medium default is distinguished from a real request');
// truthful telemetry: the confirmation is only printed after the store agrees
A.ok(/const now = Harness\.getReasoningEffort/.test(chat), '/reasoning reads the level back before claiming it changed');
A.ok(chat.indexOf('Could not set reasoning effort to') >= 0, 'a write that did not land is reported as a failure');
A.ok(chat.indexOf("doesn't appear to expose a reasoning dial") >= 0, 'a model with no reasoning dial is warned about (warn-not-block)');
// The two lies that were there before must not come back. Needled on the localLine( call, not the bare phrase —
// the handlers quote the old wording in a comment explaining WHY they changed, and that must stay allowed.
A.ok(chat.indexOf("localLine('Reasoning effort is not a separate") === -1, 'the false "no reasoning toggle" claim is gone');
A.ok(chat.indexOf("localLine('Fast mode is not a separate") === -1, 'the dead fast-mode placeholder is gone');

A.report('slash.config.test');
