/* sidecar/deliverable-store.js — durable lifecycle index for Workshop deliverables.

   Run artifacts already live in runs.jsonl and pending Workshop builds already live in the Workshop backlog.
   This store records only the truth those authorities otherwise erase: kept/discarded/failed lifecycle rows and
   bounded cleanup undo batches. It owns metadata, never artifact bytes. */
'use strict';

const { makeDurableJsonStore } = require('./durable-store.js');
const { note: failNote } = require('./failopen.js');   // tagged SYNC swallow: a fail-open catch must never be invisible
const { writeFileDurable } = require('./durable-write.js');

// Sets, not object literals: `({a:1})['constructor']` is truthy, so an object-literal allowlist
// silently admits every Object.prototype key — and these keys come off persisted/model-supplied data.
// 'implemented' = a PLAN the Commander pressed Implement on: it was acted on and produced a build, but nothing
// was copied out of the jail, so it is deliberately not 'kept' (which asserts files landed in a folder).
// NOTE: an unrecognised status is coerced to 'failed' below — a new status MUST be added here or the library
// will quietly report success as failure.
const STATUS = new Set(['kept', 'implemented', 'discarded', 'failed']);
const SOURCE_MAX = 40, TEXT_MAX = 260, UNDO_CAP = 20, FILE_CAP = 50;
const COMPACT_BYTES = 8 * 1024 * 1024;

function text(v, n) { return String(v == null ? '' : v).slice(0, n || TEXT_MAX); }
function filesOf(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, FILE_CAP).map(f => {
    const row = { path: text(f && f.path) };
    if (f && Number.isFinite(f.bytes) && f.bytes >= 0) row.bytes = Math.floor(f.bytes);
    return row;
  }).filter(f => f.path);
}
function rowOf(v, now) {
  v = v && typeof v === 'object' ? v : {};
  const id = text(v.id);
  if (!id) return null;
  return {
    id,
    agentId: text(v.agentId, 40), runId: text(v.runId, 80), title: text(v.title, 200),
    source: text(v.source || 'workshop', SOURCE_MAX), status: STATUS.has(v.status) ? v.status : 'failed',
    kind: text(v.kind || 'files', 20), summary: text(v.summary, 1000), files: filesOf(v.files),
    createdAt: Number(v.createdAt) || Number(now) || 0, updatedAt: Number(now) || Number(v.updatedAt) || 0
  };
}
function normalize(v) {
  const s = v && typeof v === 'object' ? v : {};
  // Never cap lifecycle rows: a kept row is the durable pointer to user-created work.
  // Growth is bounded by append-log compaction, not by deleting the oldest deliverable.
  const rows = Array.isArray(s.rows) ? s.rows.map(r => rowOf(r, r && r.updatedAt)).filter(Boolean) : [];
  const undo = Array.isArray(s.undo) ? s.undo.filter(x => x && x.token && Array.isArray(x.rows)).slice(-UNDO_CAP) : [];
  return { v: 2, appliedSeq: Math.max(0, Number(s.appliedSeq) || 0), rows, undo };
}
function fingerprint(rows) {
  return rows.map(r => [r.id, r.status, r.updatedAt].join(':')).sort().join('|');
}

function makeDeliverableStore(deps) {
  deps = deps || {};
  if (!deps.path || !deps.workspaces) throw new Error('makeDeliverableStore: path/workspaces required');
  const durable = makeDurableJsonStore({
    fs: deps.fs, path: deps.path,
    fileFor: () => deps.path.join(deps.workspaces, 'deliverables.library.json'),
    writeDurable: deps.writeDurable, onRecover: deps.onRecover, onCorrupt: deps.onCorrupt
  });
  const KEY = 'deliverables';
  const fs = deps.fs, pathMod = deps.path;
  const journalFile = pathMod.join(deps.workspaces, 'deliverables.library.jsonl');
  const durableWrite = typeof deps.writeDurable === 'function' ? deps.writeDurable : writeFileDurable;
  const canAppend = fs && typeof fs.openSync === 'function' && typeof fs.writeSync === 'function'
    && typeof fs.fsyncSync === 'function' && typeof fs.closeSync === 'function';
  let state = null, nextSeq = 1, journalOps = 0;

  function applyOp(s, op) {
    if (!op || Number(op.seq) <= Number(s.appliedSeq || 0)) return s;
    if (op.op === 'upsert') {
      const clean = rowOf(op.row, op.row && op.row.updatedAt);
      if (clean) {
        const i = s.rows.findIndex(r => r.id === clean.id);
        if (i >= 0) { clean.createdAt = s.rows[i].createdAt || clean.createdAt; s.rows[i] = clean; }
        else s.rows.push(clean);
      }
    } else if (op.op === 'cleanup') {
      const ids = new Set(Array.isArray(op.rows) ? op.rows.map(r => r && r.id).filter(Boolean) : []);
      s.rows = s.rows.filter(r => !ids.has(r.id));
      s.undo = s.undo.filter(b => b.token !== op.token);
      s.undo.push({ token: text(op.token, 100), at: Number(op.at) || 0, rows: (op.rows || []).map(r => rowOf(r, r && r.updatedAt)).filter(Boolean) });
      while (s.undo.length > UNDO_CAP) s.undo.shift();
    } else if (op.op === 'undo') {
      const i = s.undo.findIndex(b => b.token === op.token);
      if (i >= 0) {
        const batch = s.undo[i]; s.undo.splice(i, 1);
        for (const old of batch.rows) if (!s.rows.some(r => r.id === old.id)) {
          const row = rowOf(old, old.updatedAt || op.at); if (row) s.rows.push(row);
        }
      }
    }
    s.appliedSeq = Number(op.seq) || s.appliedSeq;
    return s;
  }
  function load() {
    if (state) return state;
    try { state = normalize(durable.get(KEY)); } catch (_) { state = normalize(null); }
    let raw = '';
    try { raw = fs.readFileSync(journalFile, 'utf8'); } catch (_) {}
    const validLines = [];
    let torn = false;
    for (const line of String(raw || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let op; try { op = JSON.parse(line); } catch (_) { torn = true; break; }
      if (!op || op.v !== 2 || !(Number(op.seq) > 0)) { torn = true; break; }
      validLines.push(line);
      nextSeq = Math.max(nextSeq, Number(op.seq) + 1); journalOps++;
      applyOp(state, op);
    }
    if (torn && canAppend) {
      // Preserve the forensic bytes, then repair the active append path to the proven prefix.
      // Otherwise every later valid append would sit after the torn line and disappear again
      // on the next restart because replay correctly stops at the first untrusted record.
      try { fs.copyFileSync(journalFile, journalFile + '.corrupt'); } catch (e) { failNote('deliverables.journal.quarantine', e); }
      durableWrite({ fs, path: pathMod }, journalFile, validLines.join('\n') + (validLines.length ? '\n' : ''));
    }
    nextSeq = Math.max(nextSeq, state.appliedSeq + 1);
    return state;
  }
  function appendLine(op) {
    fs.mkdirSync(deps.workspaces, { recursive: true });
    const data = Buffer.from(JSON.stringify(op) + '\n', 'utf8');
    let fd = null, at = 0;
    try {
      fd = fs.openSync(journalFile, 'a');
      while (at < data.length) { const n = fs.writeSync(fd, data, at, data.length - at, null); if (!(n > 0)) throw new Error('deliverable journal short write'); at += n; }
      fs.fsyncSync(fd);
    } finally { if (fd != null) try { fs.closeSync(fd); } catch (_) {} }
  }
  function maybeCompact(s) {
    if (!canAppend) return;
    let bytes = 0; try { bytes = fs.statSync(journalFile).size; } catch (_) {}
    // Compact only when both byte growth and duplicate-operation growth prove it useful.
    // The snapshot retains every live row and bounded undo batch; appliedSeq makes replay
    // idempotent if power fails between snapshot replacement and journal truncation.
    if (bytes < COMPACT_BYTES || journalOps < s.rows.length * 2 + 1000) return;
    durable.set(KEY, s);
    durableWrite({ fs, path: pathMod }, journalFile, '');
    journalOps = 0;
  }
  function commit(op) {
    const s = load(); op = Object.assign({ v: 2, seq: nextSeq++ }, op);
    if (canAppend) { appendLine(op); journalOps++; applyOp(s, op); maybeCompact(s); }
    else { applyOp(s, op); durable.set(KEY, s); }
    return s;
  }
  function read() {
    const s = load();
    return normalize({ appliedSeq: s.appliedSeq, rows: s.rows, undo: s.undo });
  }
  function list() { return read().rows.slice().sort((a, b) => (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id)).map(r => Object.assign({}, r, { files: r.files.map(f => Object.assign({}, f)) })); }
  function record(row, now) {
    const clean = rowOf(row, now);
    if (!clean) return Promise.reject(new Error('deliverable id required'));
    return durable.mutex.run(KEY, async () => { commit({ op: 'upsert', row: clean }); return clean; });
  }
  function previewCleanup(opts) {
    opts = opts || {};
    const wanted = Array.isArray(opts.statuses) && opts.statuses.length ? opts.statuses.filter(s => STATUS.has(s)) : ['discarded', 'failed'];
    const all = list();
    const targets = all.filter(r => wanted.indexOf(r.status) >= 0);
    const protectedRows = all.filter(r => wanted.indexOf(r.status) < 0);
    return { statuses: wanted, targets, protected: protectedRows, fingerprint: fingerprint(targets) };
  }
  function applyCleanup(preview, token, now) {
    preview = preview || {};
    token = text(token, 100);
    if (!token) return Promise.resolve({ ok: false, reason: 'undo-token-required' });
    let out = { ok: false, reason: 'preview-stale' };
    return durable.mutex.run(KEY, async () => {
      const s = load();
      const wanted = Array.isArray(preview.statuses) ? preview.statuses.filter(x => STATUS.has(x)) : [];
      const current = s.rows.filter(r => wanted.indexOf(r.status) >= 0);
      if (fingerprint(current) !== String(preview.fingerprint || '')) return out;
      commit({ op: 'cleanup', token, at: Number(now) || 0, rows: current });
      out = { ok: true, removed: current.length, undoToken: token };
      return out;
    });
  }
  function undoCleanup(token, now) {
    token = text(token, 100);
    let out = { ok: false, reason: 'not-found', restored: 0 };
    return durable.mutex.run(KEY, async () => {
      const s = load();
      const i = s.undo.findIndex(b => b.token === token);
      if (i < 0) return out;
      const restored = s.undo[i].rows.filter(old => !s.rows.some(r => r.id === old.id)).length;
      commit({ op: 'undo', token, at: Number(now) || 0 });
      out = { ok: true, restored };
      return out;
    });
  }
  return { read, list, record, previewCleanup, applyCleanup, undoCleanup, _durable: durable };
}

module.exports = { makeDeliverableStore, normalize };
