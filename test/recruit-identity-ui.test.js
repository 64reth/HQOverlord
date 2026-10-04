/* node test/recruit-identity-ui.test.js — PU-08 display identity wiring.
   Locks the Recruitment Bay candidate, validation, summon, and duplicate-rendering seams. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs'); const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('frontend/app/app.js');
const mkt = read('frontend/app/marketplace.js');
const ui = read('frontend/app/stationui.js');
const chat = read('frontend/app/chat.js');
const world = read('frontend/app/world.js');

A.ok(/AgentId\.allocName\([^\n]+liveAgents\(\)/.test(app), 'summon derives a collision-free default display name from the live roster');
A.ok(/nextAgentName:/.test(app), 'the bay receives the same live default-name allocator used by summon');
A.ok(/function summonCandidateName\(/.test(mkt), 'the bay has one candidate-name resolver for summary, CTA, and payload');
A.ok(/agentName:\s*summonCandidateName\(s\)/.test(mkt), 'the exact visible candidate is handed to summon');
A.ok(!/id="mkt-summon-name"[^>]*maxlength="18"/.test(mkt), 'the summon input does not silently truncate pasted text');
A.ok(/mkt-name-count/.test(mkt) && /NAME_MAX/.test(mkt), 'the summon input renders a live used / 18 counter');
A.ok(/nameIssue/.test(mkt) && /too long/i.test(mkt), 'over-cap names receive clear inline validation');
A.ok(/nameConflict/.test(mkt) && /duplicate/i.test(mkt), 'explicit duplicate names receive an inline warning and confirmation path');
A.ok(/duplicateAgentName/.test(ui), 'crew roster duplicate labels include a stable secondary id');
A.ok(/duplicateAgentName/.test(chat), 'COMMS duplicate labels include a stable secondary id');
A.ok(/floorDisplayName/.test(world) && /\[/.test(world), 'floor hover labels disambiguate historical duplicate names without renaming them');
A.ok(/serializeAgentLite[\s\S]{0,180}name:\s*a\.name/.test(app), 'the distinct summoned display name persists in the saved roster');
A.ok(/function rehydrateRoster[\s\S]{0,700}name:\s*s\.name/.test(app), 'reload restores the exact persisted display name');

A.report('recruit-identity-ui.test');
