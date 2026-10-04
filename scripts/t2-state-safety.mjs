#!/usr/bin/env node
// t2-state-safety.mjs - thin reinstall/update state-safety proof gate.

import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import * as fsMod from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import * as pathMod from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const LegacyMigrate = require('../frontend/app/legacymigrate.js');
const { makeSaveStore } = require('../sidecar/savestore.js');
const { makeMemoryStore } = require('../sidecar/memory-store.js');
const { makeDurableJsonStore } = require('../sidecar/durable-store.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_T2_LOOPS || 3) || 3) : 1;
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace(/Z$/, '') + '-' + process.pid;
const OUT = resolve(process.env.STARNET_T2_STATE_SAFETY_DIR || join(ROOT, '.dogfood', 't2-state-safety-' + STAMP));
const LATEST = resolve(process.env.STARNET_T2_STATE_SAFETY_LATEST_DIR || join(ROOT, '.dogfood', 't2-state-safety-latest'));
const SAVE_KEY = 'starnet.save';
const PRE_MIGRATE_BACKUP_KEY = 'starnet.save.pre-migrate.backup';

function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function sha256(file) {
  const h = createHash('sha256');
  h.update(readFileSync(file));
  return h.digest('hex');
}
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  return status === 'pass' ? 'PASS' : 'FAIL';
}
function copyLatest() {
  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    const src = join(OUT, name);
    if (statSync(src).isFile()) copyFileSync(src, join(LATEST, name));
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function deepClone(v) {
  return JSON.parse(JSON.stringify(v));
}
function step(id, phase, title, status, reason, extra = {}) {
  return Object.assign({ id, phase, title, status, required: true, reason }, extra);
}
function runStep(id, phase, title, fn) {
  const startedAt = nowIso();
  try {
    const evidence = fn() || {};
    return step(id, phase, title, 'pass', evidence.reason || 'State-safety proof passed.', {
      startedAt,
      finishedAt: nowIso(),
      evidence
    });
  } catch (e) {
    return step(id, phase, title, 'fail', (e && e.message) || String(e), {
      startedAt,
      finishedAt: nowIso()
    });
  }
}

class MemoryStorage {
  constructor(seed) {
    this.map = new Map();
    for (const [k, v] of Object.entries(seed || {})) this.map.set(String(k), String(v));
  }
  get length() { return this.map.size; }
  key(i) { return Array.from(this.map.keys())[i] || null; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  snapshot() { return Object.fromEntries(this.map); }
}

function loadSaveApi(storage, workstreams) {
  const code = readFileSync(join(ROOT, 'frontend', 'app', 'save.js'), 'utf8');
  const sandbox = {
    localStorage: storage,
    Workstreams: workstreams,
    console: { warn() {}, log() {}, error() {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.__Save = Save;', sandbox, { filename: 'frontend/app/save.js' });
  return sandbox.__Save;
}

function v1Save(overrides = {}) {
  return Object.assign({
    schema: 'starnet.save',
    version: 1,
    updatedAt: 101,
    agent: { id: 'agent', name: 'NOVA' },
    usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.03 },
    history: [{ role: 'user', content: 'preserve this turn' }]
  }, overrides);
}

function currentSave(overrides = {}) {
  return Object.assign({
    schema: 'starnet.save',
    version: 5,
    updatedAt: 5000,
    agent: { id: 'agent', name: 'NOVA', stats: { xp: 42, level: 3 } },
    usage: { inputTokens: 100, outputTokens: 200, costUsd: 0.25 },
    workstreams: [{ id: 'general', title: 'General', messages: [{ role: 'user', content: 'still here' }] }],
    activeId: 'general',
    generalId: 'general',
    stationStats: { xp: 42, level: 3 },
    profile: { v: 1, tags: {}, seed: null, enabled: true, total: 0 },
    dossier: { v: 1, dims: { identity: [], stack: [], goals: [], style: [], standing_orders: [], pain: [], ambition: [] }, seededFrom: {}, updatedAt: 0 }
  }, overrides);
}

function workstreamsMigrator() {
  return {
    migrateV1(doc) {
      return {
        workstreams: [{
          id: 'general',
          title: 'General',
          messages: Array.isArray(doc.history) ? doc.history.slice() : []
        }],
        activeId: 'general',
        generalId: 'general'
      };
    }
  };
}

function legacyCopyForwardStep() {
  const legacySave = JSON.stringify({ schema: 'skynet.save', agent: { id: 'old' } });
  const currentSaveRaw = JSON.stringify(currentSave({ agent: { id: 'agent', name: 'CURRENT' } }));
  const stationRaw = JSON.stringify({ slots: ['alpha'] });
  const storage = new MemoryStorage({
    'skynet.save': legacySave,
    'skynet.station.v1': stationRaw,
    'starnet.save': currentSaveRaw
  });
  const copied = LegacyMigrate.run(storage);
  assert(copied === 1, 'legacy migration should copy only missing starnet targets');
  assert(storage.getItem('starnet.save') === currentSaveRaw, 'existing starnet.save must not be clobbered');
  assert(storage.getItem('starnet.station.v1') === stationRaw, 'missing starnet station key should be copied forward');
  assert(storage.getItem('skynet.station.v1') === stationRaw, 'legacy key should remain for rollback');
  return {
    copied,
    protectedKeys: ['starnet.save'],
    rollbackKeysLeftInPlace: ['skynet.station.v1'],
    reason: 'Skynet localStorage keys copy forward without clobbering StarNet keys.'
  };
}

function preMigrationBackupStep() {
  const oldDoc = v1Save();
  const oldRaw = JSON.stringify(oldDoc);
  const storage = new MemoryStorage({ [SAVE_KEY]: oldRaw });
  const Save = loadSaveApi(storage, workstreamsMigrator());
  const loaded = Save.load();
  assert(loaded && loaded.version === Save.CURRENT, 'old save should migrate to the current version in memory');
  assert(loaded.agent && loaded.agent.id === 'agent', 'migrated save should preserve agent identity');
  assert(loaded.workstreams && loaded.workstreams.length === 1, 'v1 history should migrate into a workstream');
  assert(storage.getItem(SAVE_KEY) === oldRaw, 'load-time migration must not overwrite the persisted save');
  assert(storage.getItem(PRE_MIGRATE_BACKUP_KEY) === oldRaw, 'pre-migration backup should preserve the exact old save');
  return {
    backupKey: PRE_MIGRATE_BACKUP_KEY,
    backupBytes: oldRaw.length,
    migratedVersion: loaded.version,
    reason: 'Save.load() writes an exact pre-migration backup before migrating.'
  };
}

function failedMigrationPreservesStateStep() {
  const oldDoc = v1Save({ updatedAt: 202 });
  const oldRaw = JSON.stringify(oldDoc);
  const storage = new MemoryStorage({ [SAVE_KEY]: oldRaw });
  const Save = loadSaveApi(storage, {
    migrateV1() { throw new Error('injected migration failure'); }
  });
  const loaded = Save.load();
  assert(loaded === null, 'failed migration should return null instead of a partial document');
  assert(storage.getItem(SAVE_KEY) === oldRaw, 'failed migration should leave the original save untouched');
  assert(storage.getItem(PRE_MIGRATE_BACKUP_KEY) === oldRaw, 'failed migration should still leave a recovery backup');
  return {
    backupKey: PRE_MIGRATE_BACKUP_KEY,
    originalBytes: oldRaw.length,
    reason: 'Injected migration failure leaves the original save and backup intact.'
  };
}

function reinstallWorkspaceSurvivalStep(loop) {
  const workspaces = join(OUT, 'fixture-workspaces', 'loop-' + loop);
  rmSync(workspaces, { recursive: true, force: true });
  ensureDir(workspaces);

  const clock = { now: () => 9000 + loop };
  const saveStore = makeSaveStore({ fs: fsMod, pathMod, root: workspaces, clock });
  const doc = currentSave();
  const stale = currentSave({ updatedAt: 1000, agent: { id: 'agent', name: 'STALE' } });
  const saved = saveStore.save('agent', doc);
  const staleResult = saveStore.save('agent', stale);
  assert(saved.ok === true, 'current save should persist');
  assert(staleResult.ok === false && staleResult.stale === true, 'older save should be rejected');
  assert(saveStore.load('agent').agent.name === 'NOVA', 'stale save must not clobber current save');

  const memory = makeMemoryStore({ fs: fsMod, path: pathMod, workspaces });
  memory.set('notebook:agent', { entries: [{ id: 'n1', text: 'durable notebook memory' }] });
  memory.set('todo:agent', { items: [{ id: 't1', text: 'ship beta gate', done: false }] });

  const channelFile = join(workspaces, 'protected-channels.json');
  const recoveries = [];
  const protectedStore = makeDurableJsonStore({
    fs: fsMod,
    path: pathMod,
    fileFor: () => channelFile,
    onRecover: (key, file) => recoveries.push({ key, file })
  });
  protectedStore.set('channels', { version: 1, channels: ['alpha'] });
  protectedStore.set('channels', { version: 2, channels: ['alpha', 'beta'] });
  protectedStore.set('channels', { version: 3, channels: ['alpha', 'beta', 'gamma'] });
  writeFileSync(channelFile, '{corrupt main');
  const recovered = protectedStore.readKey('channels');
  assert(recovered.status === 'recovered', 'protected store should recover from .bak when main is corrupt');
  assert(recovered.value && recovered.value.version === 2, 'recovery should return the last known good backup');

  appendFileSync(join(workspaces, 'ledger.jsonl'), JSON.stringify({ ts: 1, model: 'test-model', spendUsd: 0.01 }) + '\n');
  appendFileSync(join(workspaces, 'runs.jsonl'), JSON.stringify({ id: 'run-1', status: 'ok' }) + '\n');
  appendFileSync(join(workspaces, 'transcript.jsonl'), JSON.stringify({ role: 'assistant', content: 'state survives' }) + '\n');

  const freshSaveStore = makeSaveStore({ fs: fsMod, pathMod, root: workspaces, clock });
  const freshMemory = makeMemoryStore({ fs: fsMod, path: pathMod, workspaces });
  const freshProtected = makeDurableJsonStore({ fs: fsMod, path: pathMod, fileFor: () => channelFile });
  assert(freshSaveStore.load('agent').updatedAt === doc.updatedAt, 'fresh save store should load the same save after reinstall');
  assert(freshSaveStore.load('agent').agent.name === 'NOVA', 'fresh save store should preserve agent identity');
  assert(freshMemory.get('notebook:agent').entries[0].text === 'durable notebook memory', 'fresh memory store should preserve notebook');
  assert(freshMemory.get('todo:agent').items[0].text === 'ship beta gate', 'fresh memory store should preserve todo');
  assert(freshProtected.readKey('channels').status === 'recovered', 'fresh protected store should still detect recovery');
  assert(readFileSync(join(workspaces, 'ledger.jsonl'), 'utf8').trim().length > 0, 'ledger jsonl should survive');
  assert(readFileSync(join(workspaces, 'runs.jsonl'), 'utf8').trim().length > 0, 'runs jsonl should survive');
  assert(readFileSync(join(workspaces, 'transcript.jsonl'), 'utf8').trim().length > 0, 'transcript jsonl should survive');

  return {
    workspaces,
    saveUpdatedAt: doc.updatedAt,
    staleWriteRejected: true,
    protectedRecoveryStatus: recovered.status,
    recoveredVersion: recovered.value.version,
    recoveredEvents: recoveries.length,
    logs: ['ledger.jsonl', 'runs.jsonl', 'transcript.jsonl'],
    reason: 'A fresh store instance over the same workspace preserves protected state and rejects stale saves.'
  };
}

function runOnce(loop) {
  return [
    runStep('t2.1-legacy-copy-forward', 'T2.1', 'Legacy Skynet keys copy forward without clobber', legacyCopyForwardStep),
    runStep('t2.2-pre-migration-backup', 'T2.2', 'Save migrations leave an exact pre-migration backup', preMigrationBackupStep),
    runStep('t2.3-failed-migration-preserves-state', 'T2.3', 'Failed migrations preserve the original save and backup', failedMigrationPreservesStateStep),
    runStep('t2.4-reinstall-workspace-survival', 'T2.4', 'Reinstall over an existing workspace preserves protected state', () => reinstallWorkspaceSurvivalStep(loop))
  ];
}

function signature(results) {
  return results.map(r => r.id + ':' + r.status + ':' + (r.reason || '')).join('|');
}
function renderSummary(status) {
  const lines = [
    '# T2 State Safety Gate',
    '',
    '- Generated: ' + status.generatedAt,
    '- Verdict: ' + status.verdict,
    '- State safety ready: ' + String(status.stateSafetyReady),
    '- Loops run: ' + status.loopsRun,
    '',
    '| Step | Status | Reason |',
    '| --- | --- | --- |'
  ];
  for (const r of status.steps) lines.push('| ' + mdEscape(r.id) + ' | ' + statusIcon(r.status) + ' | ' + mdEscape(r.reason) + ' |');
  lines.push('');
  lines.push('Evidence is synthetic and redacted. No API keys, OAuth tokens, or user secrets are written by this gate.');
  lines.push('');
  return lines.join('\n');
}
function writeArtifactHashes(files) {
  const hashes = {};
  for (const file of files) {
    hashes[file] = { sha256: sha256(join(OUT, file)), bytes: statSync(join(OUT, file)).size };
  }
  writeJson(join(OUT, 'artifact-hashes.json'), hashes);
}

async function main() {
  ensureDir(OUT);
  const allResults = [];
  let latest = [];
  let stable = 0;
  let prev = '';
  for (let loop = 1; loop <= LOOP_MAX; loop++) {
    latest = runOnce(loop);
    allResults.push(...latest.map(r => Object.assign({ loop }, r)));
    const sig = signature(latest);
    stable = sig === prev ? stable + 1 : 1;
    prev = sig;
    if (latest.every(r => r.status === 'pass')) break;
  }
  const pass = latest.every(r => r.status === 'pass');
  const status = {
    schema: 'starnet.t2-state-safety-status.v1',
    generatedAt: nowIso(),
    verdict: pass ? 'green' : 'red',
    stateSafetyReady: pass,
    loopsRun: latest.length ? Math.max(...allResults.map(r => r.loop)) : 0,
    stableIterations: stable,
    latestSignature: prev,
    steps: latest,
    allResults,
    nextAction: pass ? null : latest.find(r => r.status !== 'pass')
  };
  writeJson(join(OUT, 't2-state-safety-status.json'), status);
  writeFileSync(join(OUT, 'summary.md'), renderSummary(status));
  writeArtifactHashes(['t2-state-safety-status.json', 'summary.md']);
  copyLatest();
  console.log('t2-state-safety: ' + status.verdict + ' (' + status.steps.filter(s => s.status === 'pass').length + '/' + status.steps.length + ' pass)');
  if (!pass) {
    console.error('t2-state-safety next action: ' + status.nextAction.id + ' - ' + status.nextAction.reason);
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
