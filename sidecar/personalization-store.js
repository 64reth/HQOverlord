'use strict';

const { makeDurableJsonStore } = require('./durable-store.js');

const KEY = 'personalization';
function normalize(raw) {
  const x = raw && typeof raw === 'object' ? raw : {};
  return {
    v: 1,
    enabled: x.enabled !== false,
    updatedAt: Math.max(0, Number(x.updatedAt) || 0),
    revision: Math.max(0, Number(x.revision) || 0)
  };
}

function makePersonalizationStore(deps) {
  deps = deps || {};
  if (!deps.path || !deps.workspaces) throw new Error('makePersonalizationStore: path + workspaces required');
  const durable = makeDurableJsonStore({
    fs: deps.fs, path: deps.path,
    fileFor: () => deps.path.join(deps.workspaces, 'personalization.json'),
    writeDurable: deps.writeDurable, onRecover: deps.onRecover, onCorrupt: deps.onCorrupt
  });
  function read() { return normalize(durable.get(KEY)); }
  function setEnabled(enabled, now) {
    let out;
    return durable.update(KEY, cur => {
      const s = normalize(cur); s.enabled = enabled !== false; s.updatedAt = Number(now) || 0; s.revision++; out = s; return s;
    }).then(() => out);
  }
  function markForgotten(now) {
    let out;
    return durable.update(KEY, cur => {
      const s = normalize(cur); s.updatedAt = Number(now) || 0; s.revision++; out = s; return s;
    }).then(() => out);
  }
  return { read, setEnabled, markForgotten, _durable: durable };
}

module.exports = { makePersonalizationStore, normalize };
