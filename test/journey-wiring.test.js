/* node test/journey-wiring.test.js — end-to-end source seams for the six-part leveling foundation. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const index = read('frontend/index.html'), app = read('frontend/app/app.js'), goals = read('frontend/app/goalstore.js');
const ui = read('frontend/app/stationui.js'), world = read('frontend/app/world.js'), props = read('frontend/app/propsprites.js');
const host = read('sidecar/index.js'), xp = read('frontend/app/xp.js'), ratings = read('sidecar/growthratings.js');
const journeyStore = read('frontend/app/journeystore.js'), spine = read('frontend/app/queryspine.js');

A.ok(index.indexOf('app/journey.js') < index.indexOf('app/journeystore.js'), 'pure journey helper loads before its state citizen');
A.ok(app.indexOf('JourneyStore.init') >= 0 && app.indexOf('JourneyStore.reset') >= 0, 'journey lifecycle initializes and clears for a new Commander');
A.ok(goals.indexOf('JourneyStore.noteMilestone') >= 0, 'verified goal milestones fold into durable journey evidence');
A.ok(host.indexOf("exact: '/api/journey'") >= 0 && host.indexOf('journeyStore.adaptationBlock(agentId)') >= 0, 'HTTP proof and per-agent adaptation are wired into the real host');
A.ok(ui.indexOf('AGENT GROWTH') >= 0 && ui.indexOf('COMMANDER JOURNEY') >= 0 && ui.indexOf('STATION EVOLUTION') >= 0, 'the UI keeps all three progression tracks distinct');
A.ok(ui.indexOf('STOP USING THIS') >= 0 && ui.indexOf('RESUME ADAPTATION') >= 0, 'adaptation receipts have Commander correction controls');
A.ok(world.indexOf('PropSprites.setJourneyStage') >= 0 && props.indexOf('journeyStage') >= 0, 'distinct reached goals physically transform the trophy case crown');
A.ok(xp.indexOf('SIZE_MULT') < 0 && ratings.indexOf('const verdictDelta = 3') >= 0, 'tool/spend size can no longer weight new XP verdicts upstream or downstream');
A.ok(!/capabilit(?:y|ies).*evolution/i.test(read('sidecar/journey-store.js')), 'journey storage does not advertise capability gates');
A.ok(host.indexOf('station generation changed; reload before updating journey') >= 0 && host.indexOf('journeyStore.currentEpoch') >= 0,
  'stale tabs cannot write journey progress into a different Commander generation');
A.ok(/define\('journey',[\s\S]*path:\s*'\/api\/journey'/.test(spine), 'QuerySpine owns the canonical Journey GET resource');
A.ok(/QuerySpine/.test(journeyStore) && !/fetch\(\s*'\/api\/journey'\s*,\s*\{\s*cache:\s*'no-store'/.test(journeyStore),
  'JourneyStore owns no private GET cache or poller outside QuerySpine');
A.ok(/journey snapshot is unconfirmed/i.test(ui), 'cached journey proof is visibly labeled unconfirmed after a read failure');
A.report('journey-wiring.test');
