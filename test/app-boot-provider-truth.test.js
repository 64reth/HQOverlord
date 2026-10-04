/* Focused regression for power-user loop PL-03 + PL-08.
   Pins the app-owned seams: one boot-connection gate across the visible status surfaces, and
   provider prerequisites before an asynchronously refreshed model catalog can speak. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');

// PL-03: app.js owns the entry ordering, so it must hold every visible idle claim at CONNECTING
// until World.linkState proves the EventSource bridge live. A just-created EventSource is not proof.
A.ok(/function bridgeAuthorityProven\s*\(/.test(src), 'app owns a bridge-authority predicate');
A.ok(/ls\s*&&\s*ls\.bridged\s*&&\s*!ls\.paused\s*&&\s*!ls\.down/.test(src), 'bridge authority requires bridged + unpaused + not down');
A.ok(/function paintBridgeConnecting\s*\(/.test(src), 'app owns the coherent connecting paint');
A.ok(/chat-status[\s\S]{0,180}connecting\u2026/.test(src), 'connecting paint covers the COMMS status');
A.ok(/status-pill[\s\S]{0,180}CONNECTING/.test(src), 'connecting paint covers the top status pill');
A.ok(/COMMS connecting\u2026/.test(src), 'connecting paint retires the premature COMMS-online empty copy');
A.ok(/sig[\s\S]{0,500}CONNECTING/.test(src), 'connecting paint covers the uplink instrument');
A.ok(/new MutationObserver\([\s\S]{0,240}paintBridgeConnecting/.test(src), 'independent status timers cannot paint a contradictory frame during the gate');
A.ok(/Chat\.init\([\s\S]{0,900}beginBridgeAuthorityGate\(\)/.test(src), 'bridge gate starts only after COMMS has mounted its boot DOM');

// PL-08: Custom has a required endpoint. That prerequisite must win BEFORE model validation, because
// selectProviderUI refreshes the model catalog asynchronously and can briefly leave a stale Codex slug.
const wake = src.slice(src.indexOf('async function onWakeAttempt'), src.indexOf('/* ---------- resume ---------- */'));
const endpointGate = wake.indexOf("enter your Custom /v1 base URL.");
const modelGate = wake.indexOf('if (!model)');
A.ok(endpointGate >= 0 && modelGate >= 0 && endpointGate < modelGate, 'Custom endpoint validation wins before model validation');

A.report('app-boot-provider-truth.test');
