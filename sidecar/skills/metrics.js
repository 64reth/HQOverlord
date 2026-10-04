'use strict';

const ALLOWED_EVENTS = new Set(['inspect', 'install', 'update', 'check', 'export', 'import', 'rollback', 'registry', 'discover']);
function str(v) { return v == null ? '' : String(v); }
function makeSkillMetrics(deps) {
  deps = deps || {}; const load = deps.load, save = deps.save, now = typeof deps.now === 'function' ? deps.now : () => 0;
  let state = { version: 1, counters: {}, recent: [] };
  try { const prior = load && load(); if (prior && prior.version === 1) state = prior; } catch (_) {}
  function reasonClass(message) {
    const m = str(message).toLowerCase();
    if (/partial|missing|no files|directory listing/.test(m)) return 'package-incomplete';
    if (/larger|more than|limit/.test(m)) return 'package-oversized';
    if (/timed out|unavailable|http|fetch|network|source returned/.test(m)) return 'source-unreachable';
    if (/unsafe|escape|traversal|private host|https|credential/.test(m)) return 'source-refused';
    if (/digest|base64|utf-8|format|json/.test(m)) return 'package-integrity';
    if (/blocked|dangerous/.test(m)) return 'quarantined-block';
    return m ? 'operation-refused' : '';
  }
  function record(event, status, detail) {
    event = str(event); status = status === 'success' ? 'success' : 'failed';
    if (!ALLOWED_EVENTS.has(event)) return false;
    const key = event + '.' + status; state.counters[key] = (Number(state.counters[key]) || 0) + 1;
    const row = { at: now(), event, status };
    detail = detail || {};
    if (detail.guardAction) row.guardAction = ['allow', 'ask', 'block'].includes(detail.guardAction) ? detail.guardAction : '';
    if (detail.fileCount >= 0) row.fileCount = Number(detail.fileCount) || 0;
    if (detail.bytes >= 0) row.bytes = Number(detail.bytes) || 0;
    if (status === 'failed') row.reason = reasonClass(detail.error);
    state.recent.push(row); if (state.recent.length > 100) state.recent = state.recent.slice(-100);
    try { if (save) save(state); } catch (_) { return false; }
    return true;
  }
  function summary(skills) {
    const used = (Array.isArray(skills) ? skills : []).filter(s => s && s.sourceFetchedAt > 0 && s.lastUsedAt >= s.sourceFetchedAt);
    const delays = used.map(s => s.lastUsedAt - s.sourceFetchedAt).sort((a, b) => a - b);
    return {
      version: 1, counters: Object.assign({}, state.counters), recent: state.recent.slice(),
      timeToFirstUse: { measured: delays.length, medianMs: delays.length ? delays[Math.floor(delays.length / 2)] : null },
      contentCollected: false
    };
  }
  return { record, summary, reasonClass };
}
module.exports = { makeSkillMetrics };
