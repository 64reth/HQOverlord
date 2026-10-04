/* node test/lint-emits.js — CI lint: every literal emit('NAME') / bus.emit('NAME')
   in backend + app source must reference an event in the frozen registry.
   Scans shared/, sidecar/, frontend/app/ (NOT the untouched v7 engine, NOT test/).
   Dynamic emits (emit(name, …)) carry no literal and are skipped by design. */
'use strict';
const fs = require('fs');
const path = require('path');
const events = require('../shared/events.js');

const base = path.join(__dirname, '..');
const ROOTS = ['shared', 'sidecar', path.join('frontend', 'app')];

let fail = 0;
const err = m => { fail++; console.log('FAIL: ' + m); };

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; } // dir may not exist yet
  for (const e of entries) {
    const p = path.join(dir, e.name);
    // skip agent-generated runtime scratch (sidecar/workspaces/**) and deps — they are not project source
    if (e.isDirectory()) { if (e.name === 'workspaces' || e.name === 'node_modules') continue; walk(p, out); }
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = [];
for (const r of ROOTS) walk(path.join(base, r), files);

// blank out /* */ comments (keep newlines) and // line comments (preserve :// in URLs),
// so a comment mentioning emit('foo') is not a false positive.
function decomment(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').map(ln => ln.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
}

// match emit('NAME') AND prefixed emitters like chanEmit('NAME') (the trailing string arg keeps wiring like
// `emit: chanEmit` or makeEmitter(...) out); the literal NAME is then checked against the frozen registry.
const re = /\b\w*emit\s*\(\s*(['"])([\w.\-]+)\1/gi;
let found = 0;
for (const f of files) {
  const src = decomment(fs.readFileSync(f, 'utf8'));
  let m;
  while ((m = re.exec(src))) {
    const name = m[2];
    found++;
    if (!events.isKnown(name)) err(name + ' (in ' + path.relative(base, f) + ') is not in the event registry');
  }
}

console.log('lint-emits: scanned ' + files.length + ' file(s), ' + found + ' literal emit(s); ' + (fail ? (fail + ' problem(s)') : 'OK'));
process.exit(fail ? 1 : 0);
