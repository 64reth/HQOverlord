#!/usr/bin/env node
// t4-update-delivery.mjs - update/reinstall-over-existing-state proof gate.

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
import { findCurrentNsisInstaller } from './lib/release-installer.mjs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { makeSaveStore } = require('../sidecar/savestore.js');
const { makeMemoryStore } = require('../sidecar/memory-store.js');
const { makeDurableJsonStore } = require('../sidecar/durable-store.js');
const { makeLedger } = require('../sidecar/ledger.js');
const { makeRunStore } = require('../sidecar/runstore.js');
const { makeTranscriptStore } = require('../sidecar/transcriptstore.js');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const argSet = new Set(rawArgs);
const LOOP_ARG = rawArgs.find(a => /^--loop(=|$)/.test(a));
const LOOP_MAX = LOOP_ARG ? Math.max(1, Number(LOOP_ARG.split('=')[1] || process.env.STARNET_T4_LOOPS || 3) || 3) : 1;
const REQUIRE_LIVE = argSet.has('--require-live') || truthy(process.env.STARNET_T4_REQUIRE_LIVE);
const STAMP = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').replace(/Z$/, '') + '-' + process.pid;
const OUT = resolve(process.env.STARNET_T4_UPDATE_DELIVERY_DIR || join(ROOT, '.dogfood', 't4-update-delivery-' + STAMP));
const LATEST = resolve(process.env.STARNET_T4_UPDATE_DELIVERY_LATEST_DIR || join(ROOT, '.dogfood', 't4-update-delivery-latest'));
const MAX_UPDATE_MS = Math.max(1000, Number(process.env.STARNET_T4_UPDATE_TIMEOUT_MS || 600000) || 600000);
const MAX_WORKLOAD_MS = Math.max(1000, Number(process.env.STARNET_T4_WORKLOAD_TIMEOUT_MS || 600000) || 600000);
const PROOF_SCHEMA = 'starnet.t4-update-delivery-proof.v1';
const REQUIRED_BUCKETS = ['save', 'notebook', 'todo', 'channels', 'ledger', 'runs', 'transcript', 'update-settings'];
const REQUIRED_TOOLS = ['fs_write', 'notebook_write'];
const TERMINAL_TOOLS = ['shell_exec', 'verify_run'];
const UPDATE_MODES = new Set(['manual-nsis-reinstall', 'tauri-updater', 'windows-sandbox-reinstall', 'clean-vm-reinstall', 'physical-windows-reinstall']);

function truthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1 || String(v || '').toLowerCase() === 'yes';
}
function ensureDir(p) { mkdirSync(p, { recursive: true }); }
function nowIso() { return new Date().toISOString(); }
function stripJsonBom(text) { return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; }
function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch (_) { return ''; }
}
function readJson(file, fallback = null) {
  try { return JSON.parse(stripJsonBom(readFileSync(file, 'utf8'))); } catch (_) { return fallback; }
}
function writeJson(file, value) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
function sha256Bytes(buf) {
  const h = createHash('sha256');
  h.update(buf);
  return h.digest('hex');
}
function sha256(file) {
  return sha256Bytes(readFileSync(file));
}
function fileInfo(file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return null;
  const st = statSync(file);
  return { path: resolve(file), bytes: st.size, sha256: sha256(file), mtime: st.mtime.toISOString() };
}
function mdEscape(s) {
  return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}
function statusIcon(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'fail') return 'FAIL';
  if (status === 'blocked') return 'BLOCKED';
  return 'SKIP';
}
function copyLatest() {
  rmSync(LATEST, { recursive: true, force: true });
  ensureDir(LATEST);
  for (const name of readdirSync(OUT)) {
    const src = join(OUT, name);
    if (statSync(src).isFile()) copyFileSync(src, join(LATEST, name));
  }
}
function argValue(name) {
  const eq = rawArgs.find(a => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const idx = rawArgs.indexOf(name);
  return idx >= 0 ? rawArgs[idx + 1] : '';
}
function installerPath() {
  const raw = process.env.STARNET_T4_INSTALLER_EXE || process.env.STARNET_T3_INSTALLER_EXE || process.env.STARNET_T0_INSTALLER_EXE || '';
  if (raw) return resolve(raw);
  return findCurrentNsisInstaller(ROOT);
}
function updateProofPath() {
  const raw = process.env.STARNET_T4_UPDATE_PROOF || argValue('--update-proof') || '';
  return raw ? resolve(raw) : '';
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function step(id, phase, title, status, reason, extra = {}) {
  return Object.assign({ id, phase, title, status, required: true, reason }, extra);
}
function runStep(id, phase, title, fn) {
  const startedAt = nowIso();
  try {
    const evidence = fn() || {};
    return step(id, phase, title, 'pass', evidence.reason || 'T4 proof step passed.', {
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

function readJsonLines(file) {
  try {
    const text = readFileSync(file, 'utf8').trim();
    if (!text) return [];
    return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch (_) {
    return [];
  }
}
function jsonlIo(file) {
  return {
    readAll() { return readJsonLines(file); },
    append(entry) {
      ensureDir(dirname(file));
      appendFileSync(file, JSON.stringify(entry) + '\n');
    }
  };
}

function currentSave(overrides = {}) {
  return Object.assign({
    schema: 'starnet.save',
    version: 5,
    updatedAt: 5000,
    agent: { id: 'agent', name: 'NOVA', stats: { xp: 42, level: 3 } },
    usage: { inputTokens: 100, outputTokens: 200, costUsd: 0.25 },
    workstreams: [{ id: 'general', title: 'General', messages: [{ role: 'user', content: 'post-update state check' }] }],
    activeId: 'general',
    generalId: 'general',
    stationStats: { xp: 42, level: 3 },
    profile: { v: 1, tags: { beta: 1 }, seed: null, enabled: true, total: 1 },
    dossier: { v: 1, dims: { identity: ['builder'], stack: ['desktop'], goals: ['replace legacy harness'], style: [], standing_orders: [], pain: [], ambition: [] }, seededFrom: {}, updatedAt: 0 }
  }, overrides);
}
function protectedFilesFor(root) {
  return {
    save: ['agent.save.json'],
    notebook: ['agent.notebook.json'],
    todo: ['agent.todo.json'],
    channels: ['protected-channels.json', 'protected-channels.json.bak'],
    ledger: ['ledger.jsonl'],
    runs: ['runs.jsonl'],
    transcript: ['transcript.jsonl'],
    'update-settings': ['desktop-update-settings.json']
  };
}
function bucketHash(root, rels) {
  const h = createHash('sha256');
  let bytes = 0;
  const files = [];
  for (const rel of rels) {
    const file = join(root, rel);
    assert(existsSync(file), 'fixture missing protected file: ' + rel);
    const buf = readFileSync(file);
    bytes += buf.length;
    h.update(rel);
    h.update('\0');
    h.update(buf);
    files.push({ path: rel, bytes: buf.length, sha256: sha256Bytes(buf) });
  }
  return { sha256: h.digest('hex'), bytes, files };
}
function snapshotState(root) {
  const files = protectedFilesFor(root);
  const out = {};
  for (const bucket of REQUIRED_BUCKETS) out[bucket] = bucketHash(root, files[bucket]);
  return out;
}
function seedExistingStateFixture(loop) {
  const root = join(OUT, 'existing-state-fixture', 'loop-' + loop);
  rmSync(root, { recursive: true, force: true });
  ensureDir(root);

  const clock = { now: () => 1700000000000 + loop };
  const saveStore = makeSaveStore({ fs: fsMod, pathMod, root, clock });
  const saved = saveStore.save('agent', currentSave());
  assert(saved.ok === true, 'fixture save should persist');

  const memory = makeMemoryStore({ fs: fsMod, path: pathMod, workspaces: root });
  memory.set('notebook:agent', { entries: [{ id: 'n1', text: 'durable notebook memory survives update' }] });
  memory.set('todo:agent', { items: [{ id: 't1', text: 'ship update delivery gate', done: false }] });

  const channelFile = join(root, 'protected-channels.json');
  const channelStore = makeDurableJsonStore({ fs: fsMod, path: pathMod, fileFor: () => channelFile });
  channelStore.set('channels', { version: 1, channels: ['desktop'] });
  channelStore.set('channels', { version: 2, channels: ['desktop', 'updates'] });

  const ledger = makeLedger({ io: jsonlIo(join(root, 'ledger.jsonl')), clock });
  ledger.record({ runId: 'pre-update-run', agentId: 'agent', turns: 2, usd: 0.012, tokens: 321, model: 'test/pre-update' });

  const runs = makeRunStore({ io: jsonlIo(join(root, 'runs.jsonl')), clock });
  runs.record({ runId: 'pre-update-run', agentId: 'agent', reason: 'done', turns: 2, tokens: 321, usd: 0.012, title: 'Pre-update survival run', streamId: 'general', model: 'test/pre-update' });

  const transcripts = makeTranscriptStore({ io: jsonlIo(join(root, 'transcript.jsonl')), clock, redact: s => s });
  transcripts.append({ streamId: 'general', agentId: 'agent', role: 'user', content: 'remember the update delivery proof' });
  transcripts.append({ streamId: 'general', agentId: 'agent', role: 'assistant', content: 'I will preserve this across update.' });

  writeJson(join(root, 'desktop-update-settings.json'), {
    v: 1,
    autoCheck: true,
    lastCheckAt: 1700000000000,
    nextCheckAt: 1700021600000,
    ignoredVersion: '',
    notifiedVersion: '0.1.0',
    failureCount: 0
  });

  const freshSave = makeSaveStore({ fs: fsMod, pathMod, root, clock });
  const freshMemory = makeMemoryStore({ fs: fsMod, path: pathMod, workspaces: root });
  const freshLedger = makeLedger({ io: jsonlIo(join(root, 'ledger.jsonl')), clock });
  const freshRuns = makeRunStore({ io: jsonlIo(join(root, 'runs.jsonl')), clock });
  const freshTranscripts = makeTranscriptStore({ io: jsonlIo(join(root, 'transcript.jsonl')), clock, redact: s => s });
  assert(freshSave.load('agent').agent.name === 'NOVA', 'fixture save reload should preserve agent');
  assert(freshMemory.get('notebook:agent').entries[0].text.indexOf('survives update') >= 0, 'fixture notebook should reload');
  assert(freshMemory.get('todo:agent').items[0].text.indexOf('update delivery') >= 0, 'fixture todo should reload');
  assert(freshLedger.count() === 1, 'fixture ledger should reload');
  assert(freshRuns.count() === 1, 'fixture runs should reload');
  assert(freshTranscripts.count() === 2, 'fixture transcript should reload');

  const snapshot = snapshotState(root);
  writeJson(join(OUT, 'existing-state-fixture-snapshot.json'), { root, protectedBuckets: REQUIRED_BUCKETS, snapshot });
  return {
    fixtureRoot: root,
    protectedBuckets: REQUIRED_BUCKETS,
    snapshot,
    reason: 'Existing-state fixture covers save, memory, channels, ledgers, transcripts, and update settings.'
  };
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
    history: [{ role: 'user', content: 'old state survives failed migration' }]
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
function localRollbackProof() {
  const backupKey = 'starnet.save.pre-migrate.backup';
  const oldRaw = JSON.stringify(v1Save());
  const storage = new MemoryStorage({ 'starnet.save': oldRaw });
  const Save = loadSaveApi(storage, workstreamsMigrator());
  const loaded = Save.load();
  assert(loaded && loaded.version === Save.CURRENT, 'old save should migrate in memory');
  assert(storage.getItem('starnet.save') === oldRaw, 'load-time migration should not overwrite persisted save');
  assert(storage.getItem(backupKey) === oldRaw, 'pre-migration backup should preserve exact original');

  const failing = new MemoryStorage({ 'starnet.save': oldRaw });
  const FailingSave = loadSaveApi(failing, { migrateV1() { throw new Error('injected migration failure'); } });
  const failed = FailingSave.load();
  assert(failed === null, 'failed migration should return null');
  assert(failing.getItem('starnet.save') === oldRaw, 'failed migration should leave original untouched');
  assert(failing.getItem(backupKey) === oldRaw, 'failed migration should leave backup');
  return { backupKey, backupBytes: oldRaw.length };
}

function hashValue(v) {
  if (typeof v === 'string') return v.trim().toLowerCase();
  if (v && typeof v === 'object') return String(v.sha256 || '').trim().toLowerCase();
  return '';
}
function hasItems(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => String(x == null ? '' : x).trim());
}
function hasLedgerRows(v) {
  return Array.isArray(v) && v.length > 0 && v.every(row => row && typeof row === 'object' && String(row.model || '').trim());
}
function hasTool(toolCalls, name) {
  return Array.isArray(toolCalls) && toolCalls.includes(name);
}
function hasAnyTool(toolCalls, names) {
  return names.some(name => hasTool(toolCalls, name));
}
function validateUpdateProof(doc, installerInfo) {
  const updateErrors = [];
  const stateErrors = [];
  const workloadErrors = [];
  const evidenceErrors = [];
  if (!doc || typeof doc !== 'object') {
    return {
      ready: false,
      updateReady: false,
      stateReady: false,
      workloadReady: false,
      evidenceReady: false,
      errors: ['Update delivery evidence is not valid JSON.'],
      updateErrors: ['Update delivery evidence is not valid JSON.'],
      stateErrors,
      workloadErrors,
      evidenceErrors,
      proof: null
    };
  }
  if (doc.schema !== PROOF_SCHEMA) updateErrors.push('schema must be ' + PROOF_SCHEMA);
  const gotHash = String(doc.installer && doc.installer.sha256 || '').toLowerCase();
  const gotBytes = Number(doc.installer && doc.installer.bytes || 0);
  if (!gotHash) updateErrors.push('installer.sha256 is missing');
  if (installerInfo && gotHash && gotHash !== String(installerInfo.sha256).toLowerCase()) updateErrors.push('installer.sha256 does not match current installer');
  if (installerInfo && gotBytes && gotBytes !== installerInfo.bytes) updateErrors.push('installer.bytes does not match current installer');

  const upd = doc.update || {};
  if (!UPDATE_MODES.has(String(upd.mode || ''))) updateErrors.push('update.mode must be a supported installed update/reinstall mode');
  if (upd.launchedBefore !== true) updateErrors.push('update.launchedBefore must be true');
  if (upd.launchedAfter !== true) updateErrors.push('update.launchedAfter must be true');
  if (upd.exitCode != null && Number(upd.exitCode) !== 0) updateErrors.push('update.exitCode must be 0 when provided');
  const updateDurationMs = Number(upd.durationMs || 0);
  const updateTimeoutMs = Number(upd.timeoutMs || MAX_UPDATE_MS);
  if (!updateDurationMs || updateDurationMs <= 0) updateErrors.push('update.durationMs must be positive');
  if (!updateTimeoutMs || updateTimeoutMs <= 0) updateErrors.push('update.timeoutMs must be positive');
  if (updateDurationMs && updateTimeoutMs && updateDurationMs > updateTimeoutMs) updateErrors.push('update.durationMs exceeds update.timeoutMs');
  if (updateDurationMs > MAX_UPDATE_MS) updateErrors.push('update.durationMs exceeds T4 max timeout');

  const st = doc.state || {};
  const protectedBuckets = Array.isArray(st.protectedBuckets) ? st.protectedBuckets.map(String) : [];
  for (const bucket of REQUIRED_BUCKETS) {
    if (!protectedBuckets.includes(bucket)) stateErrors.push('state.protectedBuckets missing ' + bucket);
    const beforeHash = hashValue(st.before && st.before[bucket]);
    const afterHash = hashValue(st.after && st.after[bucket]);
    if (!beforeHash) stateErrors.push('state.before.' + bucket + '.sha256 is missing');
    if (!afterHash) stateErrors.push('state.after.' + bucket + '.sha256 is missing');
    if (beforeHash && afterHash && beforeHash !== afterHash) stateErrors.push('state hash changed for ' + bucket);
  }
  if (st.unchanged !== true) stateErrors.push('state.unchanged must be true');
  if (st.backupBeforeMigrate !== true) stateErrors.push('state.backupBeforeMigrate must be true');
  if (st.failurePreservesOriginal !== true) stateErrors.push('state.failurePreservesOriginal must be true');

  const w = doc.workload || {};
  if (w.completed !== true) workloadErrors.push('workload.completed must be true');
  const workloadDurationMs = Number(w.durationMs || 0);
  const workloadTimeoutMs = Number(w.timeoutMs || MAX_WORKLOAD_MS);
  if (!workloadDurationMs || workloadDurationMs <= 0) workloadErrors.push('workload.durationMs must be positive');
  if (!workloadTimeoutMs || workloadTimeoutMs <= 0) workloadErrors.push('workload.timeoutMs must be positive');
  if (workloadDurationMs && workloadTimeoutMs && workloadDurationMs > workloadTimeoutMs) workloadErrors.push('workload.durationMs exceeds workload.timeoutMs');
  if (workloadDurationMs > MAX_WORKLOAD_MS) workloadErrors.push('workload.durationMs exceeds T4 max timeout');
  if (!hasItems(w.runIds)) workloadErrors.push('workload.runIds[] is required');
  if (!hasItems(w.transcriptIds)) workloadErrors.push('workload.transcriptIds[] is required');
  if (!hasLedgerRows(w.ledgerRows)) workloadErrors.push('workload.ledgerRows[] with model is required');
  if (!hasItems(w.modelNames)) workloadErrors.push('workload.modelNames[] is required');
  if (!hasItems(w.artifactPaths)) workloadErrors.push('workload.artifactPaths[] is required');
  if (!Array.isArray(w.toolCalls)) workloadErrors.push('workload.toolCalls[] is required');
  for (const name of REQUIRED_TOOLS) if (!hasTool(w.toolCalls, name)) workloadErrors.push('workload.toolCalls[] missing ' + name);
  if (!hasAnyTool(w.toolCalls, TERMINAL_TOOLS)) workloadErrors.push('workload.toolCalls[] missing shell_exec or verify_run');
  if (REQUIRE_LIVE) {
    const paid = w.paidSmoke || {};
    const ledgerRows = Array.isArray(w.ledgerRows) ? w.ledgerRows : [];
    if (w.liveProvider !== true) workloadErrors.push('workload.liveProvider must be true when live proof is required');
    if (paid.succeeded !== true) workloadErrors.push('workload.paidSmoke.succeeded must be true when live proof is required');
    if (Number(paid.spendUsd || 0) <= 0 && !ledgerRows.some(row => Number(row.spendUsd || row.usd || 0) > 0)) workloadErrors.push('paid live smoke spend must be positive');
  }

  const proof = {
    schema: doc.schema || '',
    generatedAt: doc.generatedAt || '',
    sourceMachine: doc.sourceMachine || {},
    installer: doc.installer || {},
    update: {
      mode: upd.mode || '',
      previousVersion: upd.previousVersion || '',
      targetVersion: upd.targetVersion || '',
      existingInstallPath: upd.existingInstallPath || '',
      updatedInstallPath: upd.updatedInstallPath || '',
      launchedBefore: upd.launchedBefore === true,
      launchedAfter: upd.launchedAfter === true,
      exitCode: upd.exitCode == null ? null : Number(upd.exitCode),
      durationMs: updateDurationMs,
      timeoutMs: updateTimeoutMs
    },
    state: {
      protectedBuckets,
      before: st.before || {},
      after: st.after || {},
      unchanged: st.unchanged === true,
      backupBeforeMigrate: st.backupBeforeMigrate === true,
      failurePreservesOriginal: st.failurePreservesOriginal === true
    },
    workload: {
      completed: w.completed === true,
      durationMs: workloadDurationMs,
      timeoutMs: workloadTimeoutMs,
      runIds: Array.isArray(w.runIds) ? w.runIds : [],
      transcriptIds: Array.isArray(w.transcriptIds) ? w.transcriptIds : [],
      ledgerRows: Array.isArray(w.ledgerRows) ? w.ledgerRows : [],
      modelNames: Array.isArray(w.modelNames) ? w.modelNames : [],
      toolCalls: Array.isArray(w.toolCalls) ? w.toolCalls : [],
      artifactPaths: Array.isArray(w.artifactPaths) ? w.artifactPaths : [],
      liveProvider: w.liveProvider === true,
      paidSmoke: w.paidSmoke || null
    },
    notes: Array.isArray(doc.notes) ? doc.notes : []
  };
  const errors = updateErrors.concat(stateErrors, workloadErrors, evidenceErrors);
  return {
    ready: errors.length === 0,
    updateReady: updateErrors.length === 0,
    stateReady: stateErrors.length === 0,
    workloadReady: workloadErrors.length === 0,
    evidenceReady: evidenceErrors.length === 0,
    errors,
    updateErrors,
    stateErrors,
    workloadErrors,
    evidenceErrors,
    proof
  };
}
function loadProofValidation(installerInfo) {
  const file = updateProofPath();
  if (!file) return { file: '', missing: true, validation: null };
  if (!existsSync(file)) return { file, missing: true, reason: 'Update delivery proof file does not exist: ' + file, validation: null };
  const doc = readJson(file);
  const validation = validateUpdateProof(doc, installerInfo);
  writeJson(join(OUT, 'imported-update-delivery-proof.json'), validation.proof || { path: file, errors: validation.errors });
  return { file, missing: false, validation };
}

function checkPlan(loop) {
  const file = join(ROOT, 'docs', 'STARNET_T4_UPDATE_DELIVERY.md');
  const text = readText(file).toLowerCase();
  const required = [
    'manual reinstall/update',
    PROOF_SCHEMA,
    'update-over-existing-state proof is missing',
    'public signed auto-update',
    'updateDeliveryReady=true'.toLowerCase()
  ];
  const missing = required.filter(term => text.indexOf(term.toLowerCase()) < 0);
  return step('t4.0-loop-spec', 'T4.0', 'T4 update-delivery loop is documented', existsSync(file) && !missing.length ? 'pass' : 'fail', missing.length ? 'Missing terms: ' + missing.join(', ') : 'T4 update-delivery spec exists.', { loop, evidenceFile: file });
}
function checkFixture(loop) {
  return Object.assign({ loop }, runStep('t4.1-existing-state-fixture', 'T4.1', 'Existing-state fixture covers protected user state', () => seedExistingStateFixture(loop)));
}
function checkReinstallProof(loop, installerInfo, proofState) {
  if (!installerInfo) {
    return step('t4.2-reinstall-over-state-proof', 'T4.2', 'Current installer was run over an existing install', 'blocked', 'Build or provide the current NSIS installer first.', { loop, artifacts: { installer: null }, evidenceFile: proofState.file || '' });
  }
  if (proofState.missing) {
    return step('t4.2-reinstall-over-state-proof', 'T4.2', 'Current installer was run over an existing install', 'blocked', proofState.reason || 'No update delivery proof JSON was provided. Set STARNET_T4_UPDATE_PROOF or pass --update-proof.', { loop, artifacts: { installer: installerInfo }, evidenceFile: proofState.file || '' });
  }
  const v = proofState.validation;
  return step('t4.2-reinstall-over-state-proof', 'T4.2', 'Current installer was run over an existing install', v.updateReady ? 'pass' : 'fail', v.updateReady ? 'Imported proof shows the current installer updated/reinstalled over an existing install and launched afterward.' : v.updateErrors.join('; '), { loop, artifacts: { installer: installerInfo }, evidenceFile: proofState.file, updateProof: v.proof && { installer: v.proof.installer, update: v.proof.update }, errors: v.updateErrors });
}
function checkRollback(loop, proofState) {
  const local = runStep('t4.3-rollback-preservation', 'T4.3', 'Backup and rollback protection is proven', localRollbackProof);
  if (local.status !== 'pass') return local;
  if (proofState.missing) {
    return step('t4.3-rollback-preservation', 'T4.3', 'Backup and rollback protection is proven', 'blocked', 'Local rollback proof passed; import update proof with backupBeforeMigrate and failurePreservesOriginal evidence.', { loop, local: local.evidence, evidenceFile: proofState.file || '' });
  }
  const v = proofState.validation;
  return step('t4.3-rollback-preservation', 'T4.3', 'Backup and rollback protection is proven', v.stateReady ? 'pass' : 'fail', v.stateReady ? 'Protected state hashes match and backup/rollback flags are present.' : v.stateErrors.join('; '), { loop, local: local.evidence, evidenceFile: proofState.file, state: v.proof && v.proof.state, errors: v.stateErrors });
}
function checkPostUpdateWorkload(loop, proofState) {
  if (proofState.missing) {
    return step('t4.4-post-update-installed-workload', 'T4.4', 'Installed app completed a post-update workload', 'blocked', 'Import update delivery proof with a post-update installed-app workload.', { loop, evidenceFile: proofState.file || '', liveRequired: REQUIRE_LIVE });
  }
  const v = proofState.validation;
  return step('t4.4-post-update-installed-workload', 'T4.4', 'Installed app completed a post-update workload', v.workloadReady ? 'pass' : 'fail', v.workloadReady ? 'Post-update workload completed before timeout with run, transcript, ledger, model, tool, and artifact evidence.' : v.workloadErrors.join('; '), { loop, evidenceFile: proofState.file, liveRequired: REQUIRE_LIVE, workload: v.proof && v.proof.workload, errors: v.workloadErrors });
}
function checkEvidence(loop, proofState) {
  if (proofState.missing) {
    return step('t4.5-evidence-gate', 'T4.5', 'Update-delivery evidence is importable and redacted', 'blocked', 'No imported proof exists yet, so the shareable evidence pack cannot be sealed.', { loop, evidenceFile: proofState.file || '' });
  }
  const v = proofState.validation;
  return step('t4.5-evidence-gate', 'T4.5', 'Update-delivery evidence is importable and redacted', v.ready ? 'pass' : 'fail', v.ready ? 'Imported proof was normalized into shareable T4 evidence.' : v.errors.join('; '), { loop, evidenceFile: proofState.file, importedEvidenceFile: join(OUT, 'imported-update-delivery-proof.json'), errors: v.errors });
}
function runOnce(loop) {
  const results = [];
  results.push(checkPlan(loop));
  results.push(checkFixture(loop));
  const installerInfo = fileInfo(installerPath());
  const proofState = loadProofValidation(installerInfo);
  results.push(checkReinstallProof(loop, installerInfo, proofState));
  results.push(checkRollback(loop, proofState));
  results.push(checkPostUpdateWorkload(loop, proofState));
  results.push(checkEvidence(loop, proofState));
  return results;
}
function signature(results) {
  return results.map(r => r.id + ':' + r.status + ':' + (r.reason || '')).join('|');
}
function chooseNextAction(latest) {
  const nonPass = latest.filter(r => r.status === 'fail' || r.status === 'blocked');
  if (!nonPass.length) return null;
  const failed = nonPass.find(r => r.status === 'fail');
  if (failed) return failed;
  const priority = [
    't4.2-reinstall-over-state-proof',
    't4.3-rollback-preservation',
    't4.4-post-update-installed-workload',
    't4.5-evidence-gate',
    't4.1-existing-state-fixture',
    't4.0-loop-spec'
  ];
  for (const id of priority) {
    const match = nonPass.find(r => r.id === id);
    if (match) return match;
  }
  return nonPass[0];
}
function writeArtifactHashes(files) {
  const hashes = {};
  for (const file of files) {
    const p = join(OUT, file);
    if (existsSync(p)) hashes[file] = { sha256: sha256(p), bytes: statSync(p).size };
  }
  writeJson(join(OUT, 'artifact-hashes.json'), hashes);
}
function writeSummary(allResults, loopsRun, stableIterations) {
  ensureDir(OUT);
  const latest = allResults.filter(r => r.loop === loopsRun);
  const pass = latest.filter(r => r.status === 'pass').length;
  const fail = latest.filter(r => r.status === 'fail').length;
  const blocked = latest.filter(r => r.status === 'blocked').length;
  const skipped = latest.filter(r => r.status === 'skip').length;
  const nextAction = chooseNextAction(latest);
  const updateDeliveryReady = fail === 0 && blocked === 0 && latest.length > 0 && latest.every(r => r.status === 'pass' || r.status === 'skip');
  const verdict = fail ? 'red' : (blocked ? 'blocked' : 'green');
  const status = {
    schema: 'starnet.t4-update-delivery-status.v1',
    generatedAt: nowIso(),
    lane: 'T4-update-delivery',
    verdict,
    updateDeliveryReady,
    liveRequired: REQUIRE_LIVE,
    loopsRun,
    stableIterations,
    outDir: OUT,
    counts: { pass, blocked, fail, skipped },
    nextAction: nextAction ? { id: nextAction.id, status: nextAction.status, reason: nextAction.reason } : null,
    results: latest,
    history: allResults.map(r => ({ loop: r.loop, id: r.id, status: r.status, reason: r.reason || '' }))
  };
  writeJson(join(OUT, 't4-update-delivery-status.json'), status);

  let md = '# StarNet T4 Update Delivery Evidence\n\n';
  md += '- Generated: `' + status.generatedAt + '`\n';
  md += '- Verdict: `' + status.verdict + '`\n';
  md += '- Update delivery ready: `' + status.updateDeliveryReady + '`\n';
  md += '- Live proof required this run: `' + status.liveRequired + '`\n';
  md += '- Loops run: `' + status.loopsRun + '`\n\n';
  md += '| Status | Phase | Step | Notes |\n|---|---|---|---|\n';
  for (const r of latest) md += '| ' + statusIcon(r.status) + ' | `' + mdEscape(r.phase) + '` | `' + r.id + '` ' + mdEscape(r.title) + ' | ' + mdEscape(r.reason) + ' |\n';
  md += '\n## Next Action\n\n';
  if (nextAction) md += 'Work `' + nextAction.id + '`: ' + nextAction.reason + '\n';
  else md += 'T4 update delivery is ready.\n';
  md += '\nEvidence is synthetic/imported and redacted. No API keys, OAuth tokens, or user secrets should be written by this gate.\n';
  writeFileSync(join(OUT, 'summary.md'), md);
  writeArtifactHashes(['t4-update-delivery-status.json', 'summary.md', 'existing-state-fixture-snapshot.json', 'imported-update-delivery-proof.json']);
  copyLatest();
  return status;
}

ensureDir(OUT);
let allResults = [];
let loopsRun = 0;
let prevSig = '';
let stableIterations = 0;
for (let i = 1; i <= LOOP_MAX; i += 1) {
  console.log('[t4-update-delivery] loop ' + i + ' starting');
  const results = runOnce(i);
  loopsRun = i;
  allResults = allResults.concat(results);
  for (const r of results) console.log('[t4-update-delivery]   ' + statusIcon(r.status) + ' ' + r.id);
  const sig = signature(results);
  stableIterations = sig === prevSig ? stableIterations + 1 : 1;
  if (!results.some(r => r.status === 'fail' || r.status === 'blocked')) break;
  if (prevSig && prevSig === sig) break;
  prevSig = sig;
}

const summary = writeSummary(allResults, loopsRun, stableIterations);
console.log('[t4-update-delivery] evidence: ' + OUT);
console.log('[t4-update-delivery] latest: ' + LATEST);
console.log('[t4-update-delivery] updateDeliveryReady=' + summary.updateDeliveryReady);
if (summary.verdict === 'red') process.exit(1);
if (!summary.updateDeliveryReady) process.exit(2);
process.exit(0);
