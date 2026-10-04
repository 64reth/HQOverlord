'use strict';
const A = require('./_assert.js');
const R = require('../sidecar/recommendation-ledger.js');

const raw = { entries: [
  { id: '1', surface: 'suggest', kind: 'research', title: 'Weekly GPU price brief', evidence: [{ id: 'topic:gpu', type: 'topic', quote: 'gpu prices' }], readiness: { ready: true }, state: 'completed', createdAt: 1 },
  { id: '2', surface: 'suggest', kind: 'research', title: 'GPU weekly price brief', evidence: [{ id: 'topic:gpu', type: 'topic' }], readiness: { ready: true }, state: 'accepted', createdAt: 2 },
  { id: '3', surface: 'suggest', kind: 'writing', title: 'Draft a blog post', evidence: [], readiness: { ready: false, reasons: ['too-thin'] }, state: 'declined', reason: 'wrong_thing', createdAt: 3 },
  { id: '4', surface: 'nightshift', kind: 'writing', title: 'Write release notes', evidence: [{ id: 'run:4', quote: 'release' }], readiness: { ready: true }, state: 'deferred', reason: 'wrong_time', createdAt: 4 }
] };
const n = R.normalize(raw);
A.eq(n.entries.length, 4, 'normalizes recommendation history');
A.eq(n.entries[2].reason, 'wrong_thing', 'preserves a typed verdict reason');
A.eq(n.entries[2].transitions.map(t => t.state), ['shown', 'declined'], 'legacy final-state rows backfill an honest bounded lifecycle');
const m = R.replay(raw);
A.eq(m.counts.shown, 4, 'replay counts shown recommendations');
A.eq(m.counts.accepted, 1, 'only an explicit accepted transition counts as user acceptance');
A.eq(m.counts.completed, 1, 'completion is measured separately');
A.eq(m.counts.declined, 1, 'declines remain distinct from deferrals');
A.eq(m.counts.deferred, 1, 'wrong-time deferrals do not poison relevance');
A.ok(m.kinds.research.weight > 0, 'two positive research outcomes shift research upward');
A.ok(m.kinds.writing.weight < 0, 'a declined writing idea shifts writing downward');
A.ok(m.repeatRate > 0, 'semantic fingerprint replay detects a repeated idea shape');
A.ok(m.evidenceCoverage === 0.75, 'evidence coverage is auditable');
A.eq(R.normalizeEntry({ id: 'x', title: 'x', state: 'constructor' }).state, 'shown', 'prototype keys never bypass state validation');

const badCompleted = R.replay({ entries: [{ id: 'bad', title: 'Unwanted completed work', kind: 'research', state: 'completed', outcome: { adopted: false, quality: -0.1 } }] });
A.ok(badCompleted.kinds.research.weight < 0, 'even weak negative quality cannot be outweighed by completed state');
const neutralCompleted = R.replay({ entries: [{ id: 'neutral', title: 'Completed only', kind: 'research', state: 'completed' }] });
A.eq(neutralCompleted.kinds.research.weight, 0, 'completion without user outcome is neutral for preferences');
A.eq(neutralCompleted.counts.accepted, 0, 'autonomous completion does not invent user acceptance');
const cycles = { entries: [] };
for (let i = 0; i < 7; i++) cycles.entries.push({ id: 'r' + i, surface: 'suggest', kind: 'research', title: 'Research topic ' + i, state: i < 5 ? 'completed' : 'accepted' });
for (let i = 0; i < 3; i++) cycles.entries.push({ id: 'w' + i, surface: 'suggest', kind: 'writing', title: 'Writing topic ' + i, state: 'declined', reason: 'wrong_thing' });
const shifted = R.replay(cycles);
A.ok(shifted.kinds.research.weight > shifted.kinds.writing.weight, 'ten-cycle replay shifts toward work the Commander kept');
A.ok(shifted.kinds.research.weight <= 0.75 && shifted.kinds.writing.weight >= -0.75, 'preference shifts stay bounded');

const effective = R.effectivePreferenceWeights({ kinds: { research: { weight: 0.4 }, writing: { weight: 0 } } },
  { research: -0.25, writing: 0.3, planning: 0.2 }, true);
A.eq(effective, { research: 0.4, writing: 0, planning: 0.2 }, 'shared evidence replaces legacy weight per kind while untouched legacy kinds remain compatible');
A.eq(R.effectivePreferenceWeights({ kinds: { research: { weight: 0.4 } } }, { planning: 0.2 }, false), {}, 'pause suppresses shared and legacy personalization weights');
A.eq(R.preferenceTallies({ research: 0.4, writing: -0.2, planning: 0 }),
  { research: { up: 0.4, down: 0 }, writing: { up: 0, down: 0.2 } }, 'context-pack preference directions derive from the effective model');

(async () => {
  // The durable writer retains every materially distinct transition instead of overwriting the prior verdict.
  const files = new Map();
  const memfs = {
    readFileSync: file => { if (!files.has(file)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; } return files.get(file); },
    mkdirSync: () => {},
    writeFileSync: (file, body) => { files.set(file, String(body)); },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    openSync: () => 1, fsyncSync: () => {}, closeSync: () => {}, copyFileSync: (a, b) => files.set(b, files.get(a)),
    unlinkSync: file => files.delete(file)
  };
  const path = require('path').win32;
  const store = R.makeRecommendationLedger({ fs: memfs, path, workspaces: 'C:\\ws', writeDurable: (_deps, file, body) => files.set(file, String(body)) });
  await store.record({ id: 'life', surface: 'suggest', title: 'Audit recommendations' }, 10);
  await store.verdict('life', 'deferred', 'wrong_time', 20);
  await store.verdict('life', 'accepted', 'accepted', 30);
  await store.verdict('life', 'completed', 'completed', 40);
  A.eq(store.list({ limit: 1 })[0].transitions.map(t => t.state), ['shown', 'deferred', 'accepted', 'completed'], 'shown-to-completed lifecycle survives durable updates');
  A.eq(await store.verdict('life', 'declined', 'wrong_thing', 50), null, 'terminal recommendations cannot be rewritten after completion');
  await store.outcome('life', { quality: 1, costUsd: 0.12, interventions: 1 }, 60);
  A.eq(store.list({ limit: 1 })[0].outcome.costUsd, 0.12, 'downstream outcome telemetry survives independently of lifecycle state');
  let learning = false;
  const pausedStore = R.makeRecommendationLedger({ fs: memfs, path, workspaces: 'C:\\paused', learningEnabled: () => learning, writeDurable: (_deps, file, body) => files.set(file, String(body)) });
  A.eq(await pausedStore.record({ id: 'paused', title: 'Must not fold' }, 70), null, 'pause blocks new recommendation learning at the durable seam');
  learning = true;
  A.ok(await pausedStore.record({ id: 'resumed', title: 'May fold' }, 80), 'resume re-opens the durable learning seam');
  A.report('recommendation-ledger.test');
})().catch(e => { A.ok(false, e.stack || e); A.report('recommendation-ledger.test'); });
