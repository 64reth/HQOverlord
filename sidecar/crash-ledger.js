/* sidecar/crash-ledger.js — the sidecar-side CRASH-LOOP CIRCUIT BREAKER's durable memory.

   Why (2026-09-03 audit): the fail-loud policy (process-fault.js) exits(1) on an uncaught exception and the
   desktop shell's guardian (src-tauri spawn_guardian) respawns the sidecar. A DETERMINISTIC throw at boot
   (corrupt store, bad env, stale workspace-owner claim → exit 73) therefore became an infinite exit/respawn loop
   and the user only ever saw "station unreachable". A process cannot know it is looping from inside one life —
   it needs a small ledger that outlives it. This module keeps that ledger under the WORKSPACES root:

     <WORKSPACES>/.crash-ledger.json   → { version: 1, entries: [{ ts, code, summary }, …] }   (newest last)

   Policy (read by the host): if THRESHOLD (3) or more fault exits landed within WINDOW (10 min) — counting the
   one being recorded — the breaker is TRIPPED: the process must NOT exit again; it stays alive in a degraded
   state (health 503 with the reason) so the frontend can show the truth instead of a dead port.

   Pure + injected (no ambient fs/clock): makeCrashLedger({ fs, path, dir, now, writeDurable, windowMs,
   threshold, keep, filename }). Writes go through the injected durable writer (durable-write.js: temp +
   fsync + rename), never an ad-hoc write. Every fs failure is reported through `note` and fails OPEN in the
   safe direction: an unreadable ledger counts as EMPTY (never trips), an unwritable ledger never blocks the
   exit policy. The ledger is diagnostic memory, not a user store — no other store reads it. */
'use strict';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_THRESHOLD = 3;
const DEFAULT_KEEP = 20;
const DEFAULT_FILENAME = '.crash-ledger.json';

function clip(s, n) {
  let msg = '';
  try { msg = String(s == null ? '' : s); } catch (_) { msg = 'unprintable'; }
  msg = msg.replace(/\s+/g, ' ').trim();
  return msg.length > n ? msg.slice(0, n) + '…' : msg;
}

function makeCrashLedger(deps) {
  const d = deps || {};
  const fs = d.fs;
  const path = d.path;
  if (!fs || typeof fs.readFileSync !== 'function') throw new Error('crash-ledger: an injected fs is required');
  if (!path || typeof path.join !== 'function') throw new Error('crash-ledger: an injected path is required');
  if (!d.dir) throw new Error('crash-ledger: dir is required');
  const now = typeof d.now === 'function' ? d.now : function () { return 0; };
  const writeDurable = typeof d.writeDurable === 'function' ? d.writeDurable : null;
  const note = typeof d.note === 'function' ? d.note : function () {};
  const windowMs = (typeof d.windowMs === 'number' && d.windowMs > 0) ? d.windowMs : DEFAULT_WINDOW_MS;
  const threshold = (typeof d.threshold === 'number' && d.threshold >= 1) ? Math.floor(d.threshold) : DEFAULT_THRESHOLD;
  const keep = (typeof d.keep === 'number' && d.keep >= threshold) ? Math.floor(d.keep) : DEFAULT_KEEP;
  const file = path.join(String(d.dir), String(d.filename || DEFAULT_FILENAME));

  function read() {
    let raw = null;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) {
      if (!e || e.code !== 'ENOENT') note('crash-ledger.read', e);
      return [];
    }
    try {
      const doc = JSON.parse(String(raw));
      const list = doc && Array.isArray(doc.entries) ? doc.entries : [];
      return list.filter(function (e) { return e && typeof e === 'object' && Number(e.ts) > 0; })
        .map(function (e) { return { ts: Number(e.ts), code: Number(e.code) || 0, summary: clip(e.summary, 200) }; });
    } catch (e) { note('crash-ledger.parse', e); return []; }   // a torn ledger counts as empty: never trips on garbage
  }

  function recent(entries, at) {
    const t = Number(at != null ? at : now()) || 0;
    const list = Array.isArray(entries) ? entries : read();
    return list.filter(function (e) { return e.ts <= t + 1000 && (t - e.ts) <= windowMs; });   // +1s slack: a clock that ticks backwards a hair must not hide the entry just written
  }

  function write(entries) {
    if (!writeDurable) { note('crash-ledger.write', new Error('no durable writer injected')); return false; }
    try { if (typeof fs.mkdirSync === 'function') fs.mkdirSync(String(d.dir), { recursive: true }); } catch (e) { note('crash-ledger.mkdir', e); }
    try {
      writeDurable({ fs: fs, path: path }, file, JSON.stringify({ version: 1, entries: entries.slice(-keep) }));
      return true;
    } catch (e) { note('crash-ledger.write', e); return false; }
  }

  /* record one fault exit → { entry, count, tripped }. `count` = fault exits inside the window INCLUDING this
     one, so the caller decides in one call: tripped ⇒ hold the process alive instead of exiting. */
  function record(fault) {
    const f = fault || {};
    const entry = { ts: Number(now()) || 0, code: Number(f.code) || 1, summary: clip(f.summary, 200) || 'unknown fault' };
    const all = read().concat([entry]);
    write(all);
    const inWindow = recent(all, entry.ts);
    return { entry: entry, count: inWindow.length, tripped: inWindow.length >= threshold };
  }

  function state(at) {
    const inWindow = recent(null, at);
    const last = inWindow.length ? inWindow[inWindow.length - 1] : null;
    return {
      file: file, windowMs: windowMs, threshold: threshold,
      count: inWindow.length, tripped: inWindow.length >= threshold,
      last: last ? { ts: last.ts, code: last.code, summary: last.summary } : null
    };
  }

  function tripped(at) { return recent(null, at).length >= threshold; }

  function clear() {
    try { fs.unlinkSync(file); return true; } catch (e) { if (!e || e.code !== 'ENOENT') note('crash-ledger.clear', e); return false; }
  }

  /* one human line for /api/health + the boot log: "crash-loop: 3 faults in 10m — last: <summary>" */
  function describe(at) {
    const s = state(at);
    const mins = Math.max(1, Math.round(s.windowMs / 60000));
    return 'crash-loop: ' + s.count + ' fault' + (s.count === 1 ? '' : 's') + ' in ' + mins + 'm' + (s.last ? ' — last: ' + s.last.summary : '');
  }

  return { record: record, read: read, recent: function (at) { return recent(null, at); }, state: state, tripped: tripped, describe: describe, clear: clear, file: file, windowMs: windowMs, threshold: threshold };
}

module.exports = { makeCrashLedger, DEFAULT_WINDOW_MS, DEFAULT_THRESHOLD, DEFAULT_KEEP, DEFAULT_FILENAME };
