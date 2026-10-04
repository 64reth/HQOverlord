'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const nodes = {
  'gt-station': { textContent: '' },
  'tb-station': { classList: { remove() {}, add() {} } },
  '#tb-station .tb-xp-fill': { style: {} },
  '#tb-station .tb-xp': {}
};
let snapshot = null, sounds = 0;
const ctx = vm.createContext({ module: { exports: {} }, setInterval() {},
  document: { readyState: 'loading', addEventListener() {}, getElementById: id => nodes[id], querySelector: id => nodes[id] },
  JourneyStore: { status: () => snapshot }, SFX: { level: () => sounds++ },
  XpStore: { stationStats: () => { throw Error('Commander level must not read crew XP'); } }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/app/topbar.js'), 'utf8'), ctx);
const paint = ctx.module.exports.Topbar._paintXp;
paint(); assert.equal(nodes['gt-station'].textContent, '—');
snapshot = { progression: { level: 1, points: 30, levelStartsAt: 0, nextLevelAt: 100, pointsToNextLevel: 70 } };
paint(); assert.equal(nodes['gt-station'].textContent, 'Lv 1'); assert.equal(nodes['#tb-station .tb-xp-fill'].style.width, '30%'); assert.equal(sounds, 0);
snapshot = { progression: { level: 2, points: 130, levelStartsAt: 100, nextLevelAt: 200, pointsToNextLevel: 70 } };
paint(); paint(); assert.equal(nodes['gt-station'].textContent, 'Lv 2'); assert.equal(sounds, 1);
snapshot = null; paint(); assert.equal(nodes['gt-station'].textContent, '—');

const mem = {};
global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
global.Goals = require('../frontend/app/goals.js');
global.fetch = async () => ({ ok: true });
let available = false; const reported = [];
global.JourneyStore = {
  registerGoal: async () => ({ ok: true }),
  noteMilestone: async d => { reported.push(d); return { ok: available }; },
  confirmGoal: async () => ({ ok: available })
};
const { GoalStore } = require('../frontend/app/goalstore.js');
(async () => {
  GoalStore.init({ now: () => 1000 });
  const g = GoalStore.confirm({ id: null, text: 'Learn to play a song' }, ['Attend the first lesson', 'Practice the chorus slowly', 'Play the song for a friend']);
  await GoalStore.setSuccessCondition(g.id, 'Play the whole song without stopping');
  assert.equal((await GoalStore.reportMilestone(g.id, g.milestones[0].id, 'short')).ok, false);
  assert.equal((await GoalStore.reportMilestone(g.id, g.milestones[0].id, 'Attended my lesson today')).ok, false);
  assert.equal(g.milestones[0].status, 'open');
  available = true;
  assert.equal((await GoalStore.reportMilestone(g.id, g.milestones[0].id, 'Attended my lesson today')).ok, true);
  assert.equal(reported.at(-1).source, 'commander'); assert.equal(reported.at(-1).agentId, null);
  assert.equal(reported.at(-1).goalDone, false);
  assert.equal(GoalStore.quests().find(q => q.isNext).milestoneId, g.milestones[1].id);
  GoalStore.init({ now: () => 2000 });
  assert.equal(GoalStore.activeGoal().milestones[0].source, 'commander');
  assert.equal(GoalStore.activeGoal().successCondition, 'Play the whole song without stopping');
  for (const m of GoalStore.activeGoal().milestones.slice(1)) await GoalStore.reportMilestone(g.id, m.id, 'Completed this action today with my teacher');
  assert.equal(GoalStore.activeGoal().status, 'active');
  assert.equal(GoalStore.addStep(g.id, 'Practice the difficult transition'), true);
  assert.equal(GoalStore.quests().find(q => q.isNext).title, '▸ Practice the difficult transition');
  await GoalStore.confirmOutcome(g.id, 'Played the whole song without stopping for my friend');
  assert.equal(GoalStore.activeGoal(), null);
  GoalStore.init({ now: () => 3000 }); assert.equal(GoalStore.activeGoal(), null);
  let registeredId;
  global.JourneyStore.registerGoal = async d => { registeredId = d.id; throw Error('response lost'); };
  const lost = await GoalStore.createGoal('Learn a second song', 'Play it for my friend', ['Attend the first lesson']);
  assert.equal(lost.ok, false);
  assert.equal(GoalStore.activeGoal().id, registeredId);
  assert.equal(GoalStore.activeGoal().milestones.length, 1);
  GoalStore.init({ now: () => 4000 });
  assert.equal(GoalStore.activeGoal().id, registeredId, 'lost creation response retains stable goal id and plan on reload');
  global.JourneyStore.status = () => ({ goals: [{ id: registeredId, successCondition: 'Play it for my friend', status: 'active' }] });
  GoalStore.sync(); assert.equal(GoalStore.activeGoal().pendingRegistration, false);
  global.JourneyStore.registerGoal = async () => ({ ok: true });
  await GoalStore.createGoal('Join a local group', 'Attend my first meetup', ['Find a local group']);
  assert.notEqual(GoalStore.activeGoal().id, registeredId);
  assert.equal(GoalStore.focusGoal(registeredId), true); assert.equal(GoalStore.activeGoal().id, registeredId);
  GoalStore.init({ now: () => 5000 }); assert.equal(GoalStore.activeGoal().id, registeredId, 'chosen goal focus survives reload');
  const saved = JSON.parse(mem['starnet.goals.v1']);
  for (let i = 0; i < 30; i++) saved.goals.push({ ...saved.goals[0], id: 'historical-' + i, status: 'done', createdAt: 10000 + i });
  mem['starnet.goals.v1'] = JSON.stringify(saved); GoalStore.init({ now: () => 6000 });
  assert(GoalStore.listGoals().some(g => g.id === registeredId && g.status === 'active'), 'history cap never deletes an active plan');
  console.log('commander-progression-ui: OK (headline, offline report, chaining, goal confirmation, reload)');
})().catch(e => { console.error(e); process.exitCode = 1; });
