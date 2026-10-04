/* node test/deliverable-store.test.js — durable lifecycle metadata + cleanup undo for the Deliverables library. */
'use strict';
const A = require('./_assert.js');
const path = require('path');
const { makeDeliverableStore } = require('../sidecar/deliverable-store.js');

function memFs() {
  const files = new Map();
  return {
    _files: files,
    readFileSync(f) { if (!files.has(String(f))) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(String(f)); },
    writeFileSync(f, d) { files.set(String(f), String(d)); },
    renameSync(a, b) { files.set(String(b), files.get(String(a))); files.delete(String(a)); },
    existsSync(f) { return files.has(String(f)); }, mkdirSync() {}, unlinkSync(f) { files.delete(String(f)); },
    openSync() { return 1; }, fsyncSync() {}, closeSync() {}
  };
}
const writeDurable = ({ fs }, file, data) => fs.writeFileSync(file, data);

(async () => {
  const fs = memFs();
  const s = makeDeliverableStore({ fs, path, workspaces: '/ws', writeDurable });
  A.eq(s.list(), [], 'new library starts empty');

  await s.record({ id: 'workshop:agent:r1', agentId: 'agent', runId: 'r1', title: 'Report', source: 'nightshift', status: 'kept', files: [{ path: 'report.md', bytes: 12 }] }, 100);
  await s.record({ id: 'workshop:agent:r2', agentId: 'agent', runId: 'r2', title: 'Old draft', source: 'queued', status: 'discarded', files: [{ path: 'draft.csv', bytes: 9 }] }, 200);
  A.eq(s.list().map(x => x.id), ['workshop:agent:r2', 'workshop:agent:r1'], 'list is newest-first');
  A.eq(s.list()[0].status, 'discarded', 'lifecycle status round-trips');

  const s2 = makeDeliverableStore({ fs, path, workspaces: '/ws', writeDurable });
  A.eq(s2.list().length, 2, 'records survive a fresh store instance');

  const preview = s2.previewCleanup({ statuses: ['discarded'] });
  A.eq(preview.targets.map(x => x.id), ['workshop:agent:r2'], 'cleanup preview names the exact eligible target');
  A.eq(preview.protected.map(x => x.id), ['workshop:agent:r1'], 'kept rows are protected by default');

  const applied = await s2.applyCleanup(preview, 'undo-1', 300);
  A.ok(applied.ok && applied.removed === 1 && applied.undoToken === 'undo-1', 'cleanup removes the previewed set and records undo');
  A.eq(s2.list().map(x => x.id), ['workshop:agent:r1'], 'only previewed rows leave the live index');
  const restored = await s2.undoCleanup('undo-1', 400);
  A.ok(restored.ok && restored.restored === 1, 'undo restores the removed lifecycle row');
  A.eq(s2.list().map(x => x.id), ['workshop:agent:r2', 'workshop:agent:r1'], 'undo restores exact metadata');

  const stale = s2.previewCleanup({ statuses: ['discarded'] });
  await s2.record({ id: 'workshop:agent:r3', agentId: 'agent', runId: 'r3', title: 'New', status: 'discarded', files: [] }, 500);
  const refused = await s2.applyCleanup(stale, 'undo-stale', 600);
  A.ok(refused.ok === false && refused.reason === 'preview-stale', 'apply refuses when the exact preview fingerprint is stale');

  A.report('deliverable-store.test');
})().catch(e => { console.error(e); process.exit(1); });
