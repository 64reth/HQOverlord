/* node test/workstreams.search-perf.test.js — deterministic session-search regression.
   Search runs on every rail keystroke, so an absent/late query must not run the credential
   scrubber across the whole transcript corpus. The gate is relative to the old eager-scrub
   algorithm on the same process/fixture, avoiding a machine-specific millisecond budget. */
'use strict';

const { performance } = require('node:perf_hooks');
const A = require('./_assert.js');
const W = require('../frontend/app/workstreams.js');

const SECRET_RES = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:xox[baprs]-|ghp_|gho_|github_pat_)[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
  /\b[A-Fa-f0-9]{32,}\b/g
];
function scrubSecrets(value) {
  let out = String(value == null ? '' : value);
  for (const re of SECRET_RES) out = out.replace(re, '[redacted]');
  return out;
}
function visibleMessages(w) {
  return (w.history || []).filter(m => m && !m.sys && !m.hidden && !m.internal
    && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
}

const common = ('lorem ipsum deterministic fixture '.repeat(10)).slice(0, 300);
const workstreams = [];
for (let i = 0; i < 1000; i++) {
  const history = [];
  for (let j = 0; j < 20; j++) history.push({
    role: j % 2 ? 'assistant' : 'user',
    content: common
      + (i === 999 && j === 19 ? ' needle-zeta-999' : '')
      + (i === 500 && j === 10 ? ' sk-abcdefghijklmnopQRSTUV' : '')
  });
  workstreams.push({
    id: 'ws_' + i, title: 'Synthetic ' + i, agentId: 'agent', lane: 'active', kind: 'chat',
    history, runIds: [], deliverables: [], cost: {}, createdAt: 1700000000000 + i,
    lastActiveAt: 1700000000000 + i, lastReadAt: 1700000000000 + i
  });
}
W.init({ workstreams, activeId: 'ws_0', generalId: 'ws_0' });

// Reference implementation of the pre-fix behavior: scrub every visible message before
// discovering that the raw text does not contain the query.
function eagerSearch(query) {
  const q = String(query).toLowerCase();
  const out = [];
  for (const w of workstreams) {
    if (String(w.title || '').toLowerCase().indexOf(q) >= 0) { out.push(w.id); continue; }
    for (const m of visibleMessages(w)) {
      if (scrubSecrets(m.content).toLowerCase().indexOf(q) < 0) continue;
      out.push(w.id); break;
    }
  }
  return out;
}
function medianMs(fn, query) {
  const samples = [];
  fn(query); // warm JIT and regex state
  for (let i = 0; i < 7; i++) {
    const start = performance.now(); fn(query); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

A.eq(W.search('needle-zeta-999').map(x => x.id), ['ws_999'], 'late transcript hit remains correct');
A.eq(W.search('abcdefghijklmnop').length, 0, 'a query cannot discover text hidden inside a credential');

const eagerMiss = medianMs(eagerSearch, 'absent-omega-404');
const actualMiss = medianMs(q => W.search(q), 'absent-omega-404');
A.ok(actualMiss < eagerMiss * 0.45,
  'absent-query search avoids eager corpus-wide secret scrubbing (actual ' + actualMiss.toFixed(2)
  + 'ms vs eager ' + eagerMiss.toFixed(2) + 'ms)');

A.report('workstreams.search-perf.test');
