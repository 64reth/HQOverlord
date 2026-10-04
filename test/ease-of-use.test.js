'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const W = require('../frontend/app/workstreams');

const run = (id, job, extra = {}) => ({ id, title: 'Same title', agentId: 'nova', lastRunOk: true,
  automation: { kind: 'routine', id: job, name: 'Morning report' }, ...extra });
const rows = [run('new', 'a'), run('failed', 'a', { lastRunOk: false }), run('old', 'a'), run('other', 'b'),
  { id: 'chat', title: 'Morning report', agentId: 'nova' }, run('unknown1', ''), run('unknown2', '')];
const original = JSON.stringify(rows);
let groups = W.railGroups(rows, { view: 'all' });
assert.equal(groups.length, 5, 'same titles never collapse distinct jobs or unknown parents');
assert.deepEqual(groups[0].visible.map(w => w.id), ['new', 'failed'], 'failure stays visible in collapsed history');
assert.equal(groups[0].rows.length, 3);
assert.deepEqual(W.railGroups(rows, { urgent: ['old'] })[0].visible.map(w => w.id), ['new', 'failed', 'old']);
assert.equal(W.railGroups(rows, { expanded: [groups[0].key] })[0].visible.length, 3);
assert.equal(W.railGroups(rows, { activeId: 'old' })[0].visible.length, 3);
assert.deepEqual(W.railGroups([run('pinned-old', 'a', { pinned: true, lastActiveAt: 1 }), run('latest', 'a', { lastActiveAt: 10 }), run('middle', 'a', { lastActiveAt: 5 })], {})[0].visible.map(w => w.id), ['pinned-old', 'latest'], 'pinned sort order never hides the latest result');
assert.equal(W.railGroups(rows, { view: 'conversations' }).some(g => g.type === 'session' && g.w.id === 'chat'), true);
assert.equal(W.railGroups(rows, { view: 'conversations' })[0].visible[0].id, 'failed', 'errors remain findable in chat view');
assert.equal(W.railGroups(rows, { view: 'automated' }).some(g => g.type === 'session' && g.w.id === 'chat'), false);
const ordinary = [{ id: 'active-chat' }, { id: 'pinned-chat', pinned: true }, { id: 'failed-chat', lastRunOk: false }, { id: 'waiting-chat' }];
assert.deepEqual(W.railGroups(ordinary, { view: 'automated', activeId: 'active-chat', urgent: ['waiting-chat'] }), [], 'automation filter never mixes in ordinary sessions');
assert.equal(W.railGroups(ordinary, { view: 'all' }).length, 4, 'all restores every ordinary session');
assert.equal(JSON.stringify(rows), original, 'view changes cannot mutate or discard history');
assert.equal(W.automationOf({ id: 'ordinary', title: 'Routine' }), null, 'human naming is not automation provenance');
assert.equal(W.automationOf({ id: 'cron-old' }).id, '', 'legacy unknown parents stay separate');
W.init({ workstreams: [] });
W.adopt({ ...run('cron-one', 'job-one'), history: [{ role: 'assistant', content: 'needle in older output' }] });
W.adopt({ id: 'cron-one', automation: { kind: 'routine', id: 'job-one', name: 'Renamed routine' } });
const saved = JSON.parse(JSON.stringify(W.serialize()));
W.init(saved);
assert.equal(W.get('cron-one').automation.name, 'Renamed routine');
assert.equal(W.get('cron-one').history[0].content, 'needle in older output');
assert.ok(W.search('needle').some(r => r.id === 'cron-one'), 'collapsed history stays searchable after restart');

// Exercise the actual async renderer at its backend seam, including overrides and failed reads.
const source = fs.readFileSync(require.resolve('../frontend/app/stationui.js'), 'utf8');
const accessFn = source.slice(source.indexOf('  function loadEffectiveAccess('), source.indexOf('  function fileCard('));
async function renderAccess(response, rejects = false, connected = true) {
  const actions = {}, target = { innerHTML: '', textContent: '', querySelector(s) { return actions[s] ||= {}; } };
  const summary = { textContent: 'checking' }, paths = [];
  const context = { World: { heroCaps: () => [{ objectType: 'cabinet' }] }, esc: s => String(s),
    Harness: { api: { get: path => { paths.push(path); return rejects ? Promise.reject(Error('offline')) : Promise.resolve(response); } } },
    openTerm() {} };
  vm.createContext(context); vm.runInContext(accessFn, context);
  context.loadEffectiveAccess({ isConnected: connected, querySelectorAll: () => [target], querySelector: s => s.includes('ag-setup-val') ? summary : null }, { id: 'nova' });
  await new Promise(resolve => setImmediate(resolve));
  return { target, summary, paths };
}
(async () => {
  let out = await renderAccess({ authority: { unrestricted: true, approvalLabel: 'FULL ACCESS', filesystemLabel: 'Whole computer', profileLabel: 'STATION GEAR', revoke: 'Turn off override' },
    toolsets: [{ label: 'FILES', available: true, enabled: false, consentGated: false, grantSource: 'Full Access' }] });
  assert.match(out.paths[0], /agent=nova&placed=cabinet/);
  assert.match(out.target.innerHTML, /AVAILABLE/);
  assert.doesNotMatch(out.target.innerHTML, /SWITCHED OFF|risky actions may ask/);
  assert.equal(out.summary.textContent, 'Full Power · no prompts');
  out = await renderAccess(null, true);
  assert.match(out.target.textContent, /could not be checked/);
  assert.equal(out.summary.textContent, 'unavailable');
  out = await renderAccess({}, false, false);
  assert.equal(out.target.innerHTML, '', 'late responses cannot repaint a closed or switched dossier');
  console.log('ease-of-use: grouping, persistence, search and effective access passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
