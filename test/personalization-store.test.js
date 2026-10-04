'use strict';
const A = require('./_assert.js');
const P = require('../sidecar/personalization-store.js');

const files = new Map();
const memfs = {
  readFileSync: file => { if (!files.has(file)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; } return files.get(file); },
  mkdirSync: () => {}, writeFileSync: (file, body) => files.set(file, String(body)),
  renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); }, openSync: () => 1, fsyncSync: () => {}, closeSync: () => {},
  copyFileSync: (a, b) => files.set(b, files.get(a)), unlinkSync: file => files.delete(file)
};
const path = require('path').win32;

(async () => {
  const store = P.makePersonalizationStore({ fs: memfs, path, workspaces: 'C:\\ws', writeDurable: (_deps, file, body) => files.set(file, String(body)) });
  A.eq(store.read().enabled, true, 'personalization defaults on for existing stations');
  const paused = await store.setEnabled(false, 10);
  A.eq(paused.enabled, false, 'pause is durable sidecar authority');
  A.eq(store.read().revision, 1, 'pause advances the auditable revision');
  const forgotten = await store.markForgotten(20);
  A.eq(forgotten.enabled, false, 'forget does not silently undo the Commander pause');
  A.eq(forgotten.revision, 2, 'forget advances the auditable revision');
  A.report('personalization-store.test');
})().catch(e => { A.ok(false, e.stack || e); A.report('personalization-store.test'); });
