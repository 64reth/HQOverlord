#!/usr/bin/env node
'use strict';

/* Deterministic, disposable 30-90 day storage audit.
 *
 * This generator never reads the user's StarNet data root. Every run creates its own
 * mkdtemp workspace, fills it with schema-compatible synthetic state, measures the real
 * sidecar plus the frontend Workstreams store, and removes the temp tree unless --keep is
 * supplied. The fixed seed/content makes before/after receipts comparable.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, m => m.slice(1))), '..');
const { makeSegmentedTranscriptIo } = require('../sidecar/transcript-history.js');
const { makeRunJournal } = require('../sidecar/run-journal.js');
const { makeDeliverableStore, normalize: normalizeDeliverables } = require('../sidecar/deliverable-store.js');
const Workstreams = require('../frontend/app/workstreams.js');

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const jsonOnly = args.includes('--json');
const scalesArg = (args.find(a => a.startsWith('--scales=')) || '').slice('--scales='.length);
const scales = (scalesArg || '250,1000,3000').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
const outArg = (args.find(a => a.startsWith('--out=')) || '').slice('--out='.length);
const enforceBudgets = args.includes('--enforce-budgets');
const baseRoot = outArg ? path.resolve(outArg) : fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-longhaul-'));
const token = 'longhaul-audit-token';
const BUDGETS_AT_3000 = Object.freeze({
  startupMs: 2500, rssBytes: 130 * 1024 * 1024, shutdownMs: 250,
  shellMs: 100, runsMs: 100, deliverablesMs: 150, recoveryMs: 150,
  recoveryResponseBytes: 128 * 1024, uiSearchMs: 50, uiSerializeMs: 75,
  transcriptSearchMs: 100, deliverableRecordMs: 100, backupBytes: 6.5 * 1024 * 1024,
  diskBytes: 30 * 1024 * 1024, corruptionRecoveryMs: 250, saveWriteFailures: 0
});

function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
function writeJsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); }
function percentile(values, p) {
  const a = values.slice().sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : 0;
}
async function timed(fn, samples = 1) {
  const values = [];
  let value;
  for (let i = 0; i < samples; i++) { const start = performance.now(); value = await fn(); values.push(performance.now() - start); }
  return { value, medianMs: +percentile(values, 0.5).toFixed(2), p95Ms: +percentile(values, 0.95).toFixed(2) };
}
function body(i, kind) {
  const marker = i % 997 === 0 ? ' deterministic-needle-' + i : '';
  return (kind + ' synthetic evidence ' + String(i).padStart(6, '0') + marker + ' ').padEnd(420, String(i % 10));
}
function makeWorkstreams(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const t = 1710000000000 + i * 60000;
    rows.push({
      id: 'ws_' + String(i).padStart(7, '0'), title: 'Synthetic conversation ' + i,
      agentId: 'agent-' + (i % 12), roomId: null, lane: i % 11 === 0 ? 'shipped' : 'active',
      kind: i % 11 === 0 ? 'task' : 'chat', projectRoot: null, pinned: i % 101 === 0,
      archived: i % 5 === 0, createdAt: t, lastActiveAt: t + 30000, unread: 0,
      runIds: ['run-' + i], deliverables: i % 3 === 0 ? ['deliverable-' + i] : [],
      cost: { tokens: 300 + i % 100, usd: +(0.001 + (i % 17) / 10000).toFixed(4), calls: 1 },
      history: [
        { role: 'user', content: body(i, 'user'), ts: t },
        { role: 'assistant', content: body(i, 'assistant'), ts: t + 1000 },
        { role: 'tool', content: body(i, 'tool-result'), tool_call_id: 'call-' + i, ts: t + 2000 }
      ]
    });
  }
  return rows;
}
function envelope(workstreams, now) {
  return {
    schemaVersion: 2, updatedAt: now,
    agent: { id: 'agent', name: 'LONGHAUL', role: 'synthetic audit', model: 'replay/audit' },
    usage: { calls: workstreams.length, tokens: workstreams.length * 400, cost: workstreams.length * 0.001 },
    workstreams, activeId: workstreams.length ? workstreams[workstreams.length - 1].id : null,
    generalId: workstreams.length ? workstreams[0].id : null, sessionUndo: null, deletedIds: []
  };
}
function directorySize(root) {
  let bytes = 0, files = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(file);
      else if (ent.isFile()) { files++; bytes += fs.statSync(file).size; }
    }
  }
  return { bytes, files };
}

function generate(root, count) {
  fs.mkdirSync(root, { recursive: true });
  const now = 1710000000000 + count * 60000;
  const workstreams = makeWorkstreams(count);
  const doc = envelope(workstreams, now);
  writeJson(path.join(root, 'agent.save.json'), { version: 1, agentId: 'agent', updatedAt: now, savedAt: now, doc });
  writeJson(path.join(root, 'agent.roster.json'), { version: 1, agents: Array.from({ length: 12 }, (_, i) => ({ id: 'agent-' + i, name: 'Worker ' + i, role: 'synthetic', model: 'replay/audit' })) });
  writeJson(path.join(root, 'agent.notebook.json'), { version: 1, notes: Array.from({ length: Math.max(1, Math.floor(count / 4)) }, (_, i) => ({ id: 'memory-' + i, kind: i % 3 ? 'fact' : 'preference', title: 'Memory ' + i, body: body(i, 'memory'), ts: now - i * 60000 })) });
  writeJson(path.join(root, 'cron.jobs.json'), { version: 1, jobs: Array.from({ length: Math.max(1, Math.floor(count / 20)) }, (_, i) => ({ id: 'routine-' + i, name: 'Routine ' + i, agentId: 'agent-' + (i % 12), enabled: i % 7 !== 0, schedule: '0 ' + (i % 24) + ' * * *', lastRunAt: now - i * 3600000 })) });

  const runs = [], ledger = [], autonomy = [];
  for (let i = 0; i < count; i++) {
    const ts = 1710000000000 + i * 60000;
    runs.push({ runId: 'run-' + i, parentRunId: i % 4 ? '' : 'run-' + Math.max(0, i - 1), agentId: 'agent-' + (i % 12), reason: i % 17 === 0 ? 'error' : 'done', turns: 3, tokens: 400, usd: 0.001, title: 'Synthetic run ' + i, streamId: 'ws_' + String(i).padStart(7, '0'), model: 'replay/audit', toolTrace: [{ callId: 'call-' + i, name: 'fs.read', ok: i % 17 !== 0, ms: 4, summary: 'synthetic' }], ts });
    ledger.push({ runId: 'run-' + i, agentId: 'agent-' + (i % 12), tokens: 400, usd: 0.001, ts });
    autonomy.push({ id: 'auto-' + i, source: i % 2 ? 'routine' : 'nightshift', kind: i % 5 ? 'run' : 'skip', reason: 'synthetic decision', ts });
  }
  writeJsonl(path.join(root, 'runs.jsonl'), runs);
  writeJsonl(path.join(root, 'ledger.jsonl'), ledger);
  writeJsonl(path.join(root, 'autonomy.ledger.jsonl'), autonomy);

  const deliverableRows = Array.from({ length: count }, (_, i) => ({
    id: 'deliverable-' + i, agentId: 'agent-' + (i % 12), runId: 'run-' + i,
    title: 'Deliverable ' + i, source: 'workshop', status: i % 13 === 0 ? 'failed' : (i % 7 === 0 ? 'discarded' : 'kept'),
    kind: 'files', summary: body(i, 'deliverable'), files: [{ path: 'outputs/item-' + i + '.md', bytes: 420 }],
    createdAt: now - (count - i) * 60000, updatedAt: now - (count - i) * 60000
  }));
  writeJson(path.join(root, 'deliverables.library.json'), { v: 1, rows: deliverableRows, undo: [] });

  // Generation is disposable setup, not a durability benchmark. Avoid thousands of physical
  // flushes while retaining the exact production write/read-back and file shapes.
  const fastFs = Object.create(fs); fastFs.fsyncSync = function () {};
  const transcript = makeSegmentedTranscriptIo({ fs: fastFs, path, root: path.join(root, 'transcript-history-v2'), segmentBytes: 256 * 1024, recentPerStream: 1200 });
  for (let i = 0; i < count; i++) for (let m = 0; m < 3; m++) transcript.appendDurable({ streamId: 'ws_' + String(i).padStart(7, '0'), agentId: 'agent-' + (i % 12), role: m === 0 ? 'user' : (m === 1 ? 'assistant' : 'tool'), content: body(i, 'transcript-' + m), ts: 1710000000000 + i * 60000 + m });

  const journal = makeRunJournal({ fs: fastFs, path, dir: path.join(root, '.run-journal'), clock: { now: () => now }, redact: s => s });
  const journalCount = Math.max(1, Math.floor(count / 2));
  for (let i = 0; i < journalCount; i++) {
    const runId = 'journal-' + i;
    journal.begin({ runId, agentId: 'agent-' + (i % 12), streamId: 'ws_' + String(i).padStart(7, '0'), startedAt: now - i * 1000, userTitle: 'Synthetic journal ' + i });
    journal.checkpoint(runId, { phase: 'initial', turn: 0, messages: [{ role: 'user', content: body(i, 'journal') }] });
    journal.toolIntent(runId, { callId: 'jcall-' + i, name: 'fs.write', argsRaw: '{"path":"synthetic-' + i + '"}' });
    if (i % 5 !== 0) journal.toolResult(runId, { callId: 'jcall-' + i, name: 'fs.write', ok: true, content: 'done' });
    if (i % 3 === 0) journal.finish(runId, { reason: i % 5 === 0 ? 'error' : 'done', transcriptAck: false });
  }

  for (let i = 0; i < 12; i++) {
    const cp = path.join(root, '.checkpoints', 'agent-' + i);
    fs.mkdirSync(cp, { recursive: true });
    writeJson(path.join(cp, 'index.json'), { version: 1, entries: Array.from({ length: 50 }, (_, j) => ({ id: String(j).padStart(40, 'a'), runId: 'run-' + (i * 50 + j), turn: j, label: 'Synthetic checkpoint', files: 2, bytes: 840, ts: now - j * 60000 })) });
  }
  const profile = path.join(root, '.browser-profile', 'Default', 'Cache');
  fs.mkdirSync(profile, { recursive: true });
  for (let i = 0; i < Math.max(1, Math.ceil(count / 500)); i++) fs.writeFileSync(path.join(profile, 'artifact-' + i + '.bin'), Buffer.alloc(128 * 1024, i % 251));

  return { doc, workstreams, deliverableRows, transcript, journalCount };
}

async function rssBytes(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8', windowsHide: true });
    return Number(String(r.stdout || '').trim()) || 0;
  }
  try {
    const status = fs.readFileSync('/proc/' + pid + '/status', 'utf8');
    const m = /^VmRSS:\s+(\d+)\s+kB/im.exec(status); return m ? Number(m[1]) * 1024 : 0;
  } catch (_) { return 0; }
}
async function waitHealth(port, child, timeoutMs = 60000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (child.exitCode != null) throw new Error('sidecar exited before health (code ' + child.exitCode + ')');
    try { const r = await fetch('http://127.0.0.1:' + port + '/api/health'); if (r.ok) return performance.now() - started; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('sidecar health timeout');
}
async function requestMs(port, url, samples = 5) {
  return timed(async () => {
    const r = await fetch('http://127.0.0.1:' + port + url, { headers: { 'X-StarNet-Token': token } });
    const text = await r.text(); if (!r.ok) throw new Error(url + ' -> ' + r.status + ' ' + text.slice(0, 120));
    return text.length;
  }, samples);
}
async function postSave(port, doc) {
  const start = performance.now();
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/api/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StarNet-Token': token }, body: JSON.stringify(doc)
    });
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch (_) {}
    return { ms: +(performance.now() - start).toFixed(2), status: r.status, ok: !!(r.ok && body && body.ok), response: body || text.slice(0, 200) };
  } catch (e) {
    return { ms: +(performance.now() - start).toFixed(2), status: 0, ok: false, error: String((e && e.cause && e.cause.code) || (e && e.message) || e) };
  }
}
async function measureSidecar(root, count, index, doc) {
  const port = 19200 + index;
  const env = Object.assign({}, process.env, {
    STARNET_WORKSPACES: root, STARNET_PORT: String(port), STARNET_API_TOKEN: token,
    STARNET_LIVE_PRICES: '0', SKYNET_QUEST_REFRESH: '0', STARNET_CRON_ARMED: '0',
    STARNET_OPENROUTER_KEY: '', STARNET_DEFAULT_MODEL: 'replay/audit'
  });
  const child = spawn(process.execPath, [path.join(repo, 'sidecar', 'index.js')], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '', stdout = '';
  child.stderr.on('data', b => { stderr += b.toString(); }); child.stdout.on('data', b => { stdout += b.toString(); });
  const startupMs = await waitHealth(port, child);
  const rss = await rssBytes(child.pid);
  const shell = await requestMs(port, '/', 3);
  const runs = await requestMs(port, '/api/runs?agent=*&limit=500', 5);
  const deliverables = await requestMs(port, '/api/deliverables?query=deterministic-needle', 5);
  const recoveries = await requestMs(port, '/api/run-recoveries', 3);
  const saveWrite = await postSave(port, doc);
  const shutdownStart = performance.now();
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 10000))]);
  if (child.exitCode == null) child.kill('SIGKILL');
  return {
    startupMs: +startupMs.toFixed(2), rssBytes: rss, shutdownMs: +(performance.now() - shutdownStart).toFixed(2),
    shellMs: shell.medianMs, runsMs: runs.medianMs, deliverablesMs: deliverables.medianMs,
    recoveryMs: recoveries.medianMs, recoveryResponseBytes: recoveries.value,
    saveWrite,
    warnings: (stderr + stdout).split(/\r?\n/).filter(line => /warn|error|corrupt|recover/i.test(line)).slice(0, 20)
  };
}

async function measureScale(count, index) {
  const root = path.join(baseRoot, 'scale-' + count);
  const generated = await timed(() => generate(root, count));
  const saveText = JSON.stringify(generated.value.doc);
  const backupText = JSON.stringify({ schema: 'starnet.backup', version: 1, app: 'starnet', exportedAt: 1710000000000, agentName: 'LONGHAUL', secretsIncluded: false, secretPolicy: 'credentials-excluded', store: { 'starnet.save': saveText }, notebook: [] });

  const uiInit = await timed(() => Workstreams.init({ workstreams: generated.value.workstreams, activeId: generated.value.workstreams[count - 1].id, generalId: generated.value.workstreams[0].id }), 3);
  const uiList = await timed(() => Workstreams.list({ archived: false }), 10);
  const uiSearch = await timed(() => Workstreams.search('deterministic-needle'), 10);
  const uiSerialize = await timed(() => JSON.stringify(Workstreams.serialize()), 5);
  const transcriptSearch = await timed(() => generated.value.transcript.search('global', 'deterministic-needle', { scope: 'all', limit: 10 }), 5);
  const deliverableBenchRoot = path.join(root, '.deliverable-bench');
  fs.mkdirSync(deliverableBenchRoot, { recursive: true });
  fs.copyFileSync(path.join(root, 'deliverables.library.json'), path.join(deliverableBenchRoot, 'deliverables.library.json'));
  const deliverableStore = makeDeliverableStore({ fs, path, workspaces: deliverableBenchRoot });
  const deliverableRecord = await timed(() => deliverableStore.record({ id: 'deliverable-new', agentId: 'agent', runId: 'run-new', title: 'New retained deliverable', status: 'kept', files: [{ path: 'outputs/new.md', bytes: 10 }] }, 1719999999999), 1);
  const deliverablesRetained = deliverableStore.list().length;
  const disk = directorySize(root);
  const sidecar = await measureSidecar(root, count, index, generated.value.doc);
  let corruptedRecoveryMs = 0, recovered = false;
  const saveFile = path.join(root, 'agent.save.json');
  fs.copyFileSync(saveFile, saveFile + '.bak'); fs.writeFileSync(saveFile, '{torn');
  const { makeSaveStore } = require('../sidecar/savestore.js');
  const saveStore = makeSaveStore({ fs, pathMod: path, root, clock: { now: () => 1710000000000 } });
  const recovery = await timed(() => saveStore.load('agent'), 1);
  corruptedRecoveryMs = recovery.medianMs; recovered = !!(recovery.value && recovery.value.workstreams && recovery.value.workstreams.length === count);

  return {
    scale: count,
    counts: { conversations: count, transcriptTurns: count * 3, runs: count, toolCalls: count, delegatedWorkers: Math.ceil(count / 4), deliverablesInput: count, memories: Math.max(1, Math.floor(count / 4)), routines: Math.max(1, Math.floor(count / 20)), runJournals: generated.value.journalCount, failedOrInterruptedRuns: Math.ceil(generated.value.journalCount * 0.46), checkpoints: 600 },
    generationMs: generated.medianMs, diskBytes: disk.bytes, diskFiles: disk.files, saveBytes: Buffer.byteLength(saveText), backupBytes: Buffer.byteLength(backupText),
    ui: { initMs: uiInit.medianMs, listMs: uiList.medianMs, searchMs: uiSearch.medianMs, serializeMs: uiSerialize.medianMs },
    transcriptSearchMs: transcriptSearch.medianMs, transcriptHits: transcriptSearch.value.length,
    deliverables: { normalizedBeforeWrite: normalizeDeliverables({ rows: generated.value.deliverableRows, undo: [] }).rows.length, retainedAfterOneWrite: deliverablesRetained, recordMs: deliverableRecord.medianMs },
    corruptionRecoveryMs: corruptedRecoveryMs, corruptionRecoveredAllConversations: recovered,
    sidecar
  };
}

function budgetViolations(result) {
  if (!result || result.scale !== 3000) return [];
  const actual = {
    startupMs: result.sidecar.startupMs, rssBytes: result.sidecar.rssBytes, shutdownMs: result.sidecar.shutdownMs,
    shellMs: result.sidecar.shellMs, runsMs: result.sidecar.runsMs, deliverablesMs: result.sidecar.deliverablesMs,
    recoveryMs: result.sidecar.recoveryMs, recoveryResponseBytes: result.sidecar.recoveryResponseBytes,
    uiSearchMs: result.ui.searchMs, uiSerializeMs: result.ui.serializeMs,
    transcriptSearchMs: result.transcriptSearchMs, deliverableRecordMs: result.deliverables.recordMs,
    backupBytes: result.backupBytes, diskBytes: result.diskBytes, corruptionRecoveryMs: result.corruptionRecoveryMs,
    saveWriteFailures: result.sidecar.saveWrite && result.sidecar.saveWrite.ok ? 0 : 1
  };
  return Object.keys(BUDGETS_AT_3000).filter(k => !(actual[k] <= BUDGETS_AT_3000[k])).map(k => ({ metric: k, actual: actual[k], budget: BUDGETS_AT_3000[k] }));
}

const report = { schema: 'starnet.longhaul-audit', version: 1, deterministicEpoch: 1710000000000, tempRoot: baseRoot, kept: keep, budgetsAt3000: BUDGETS_AT_3000, results: [] };
try {
  for (let i = 0; i < scales.length; i++) {
    if (!jsonOnly) process.stderr.write('[longhaul] generating + measuring scale ' + scales[i] + '\n');
    report.results.push(await measureScale(scales[i], i));
  }
  report.violations = report.results.flatMap(budgetViolations);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (enforceBudgets && report.violations.length) process.exitCode = 1;
} finally {
  if (!keep && !outArg) {
    const resolved = path.resolve(baseRoot), temp = path.resolve(os.tmpdir());
    if (resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith('starnet-longhaul-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
}
