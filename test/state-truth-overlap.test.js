/* Candidate-specific locks for the non-overlapping product hunks proven by the state-truth journey. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

const world = read('frontend/app/world.js');
const station = read('frontend/app/stationui.js');

A.ok(/function workerFoot\([\s\S]{0,700}seen\.add\(ht\.x \+ ',' \+ ht\.y\)/.test(world),
  'summoned-worker occupancy includes the hero, so the first worker cannot hide underneath it');
A.ok(/function agHead\(a, act\)[\s\S]{0,500}const live = !!\(a && agentLive\(a\.id\)\)[\s\S]{0,700}live \? 'WORKING'/.test(station),
  'the dossier headline derives WORKING from the selected agent');
A.ok(/x\.id === focusedId && act === 'talk' \? 'talking' : 'working'/.test(station),
  'a different worker never inherits the focused agent conversation label');
A.ok(/const selectedLive = !!\(selected && agentLive\(selected\.id\)\)[\s\S]{0,500}selectedLive \? 'WORKING'/.test(station),
  'live dossier repaint remains scoped to the selected worker');
// Exercise the crew projection instead of locking the old presentation wording.
// Three concurrent agents include one pending approval; a fourth agent is idle.
const crewIds = ['hero', 'worker', 'approval', 'idle'];
const crewRows = Object.fromEntries(crewIds.map(id => [id, { hidden: false, classList: { toggle() {} } }]));
const crewLabels = Object.fromEntries(crewIds.map(id => [id, { textContent: '', closest: () => crewRows[id] }]));
const crewContext = vm.createContext({
  present: crewIds.map(id => ({ id })), runningAgents: new Map(), runSeenAt: new Map(),
  activity: () => 'talk', App: { currentAgent: () => ({ id: 'hero' }) },
  agentLive: id => id !== 'idle', crewQuery: '',
  Channels: { pendingIds: () => ['approval-session'] },
  Workstreams: { get: () => ({ agentId: 'approval' }) },
  $: selector => selector.startsWith('#cs-') ? crewLabels[selector.slice(4)] : null
});
vm.runInContext(A.fnBody(station, 'function crewTick()') + '\ncrewTick();', crewContext);
A.eq(crewLabels.hero.textContent, 'IN CONVERSATION', 'the focused running agent owns the conversation label');
A.eq(crewLabels.worker.textContent, 'WORKING', 'a background worker never inherits the conversation label');
A.eq(crewLabels.approval.textContent, 'WORKING', 'crew keeps its activity summary; approval details belong to the session');
A.eq(crewLabels.idle.textContent, 'IDLE', 'an idle agent does not inherit a different agent’s run or approval');
crewContext.crewQuery = 'work'; vm.runInContext('crewTick()', crewContext);
A.eq(crewIds.filter(id => !crewRows[id].hidden), ['worker'], 'search narrows the roster by identity');
crewContext.crewQuery = 'idle'; vm.runInContext('crewTick()', crewContext);
A.eq(crewIds.filter(id => !crewRows[id].hidden), ['idle'], 'search can find an idle agent without an activity filter');
crewContext.crewQuery = ''; vm.runInContext('crewTick()', crewContext);
A.ok(crewIds.every(id => !crewRows[id].hidden), 'closing search restores the entire roster');
A.ok(/const unhealthyChannels = new Set\(\)[\s\S]*?state === 'up'[\s\S]*?reconnected[\s\S]*?key: toastKey/.test(world),
  'a proven channel recovery replaces the active outage claim instead of leaving a stale red toast');
A.ok(/const toastKey = String\(\(opts && opts\.key\)[\s\S]*?dataset\.toastKey === toastKey[\s\S]*?prior\.remove\(\)/.test(station),
  'keyed transient toasts remove the prior live-state card before rendering its replacement');

A.eq(read('website/app/app/world.js'), world, 'website world mirror carries worker spawn truth exactly');
A.eq(read('website/app/app/stationui.js'), station, 'website dossier mirror carries per-worker status truth exactly');

A.report('state-truth-overlap');
