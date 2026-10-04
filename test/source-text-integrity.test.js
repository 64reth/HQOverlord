'use strict';

// Source files must stay ordinary UTF-8 text. A literal NUL makes tools such as rg treat a
// critical composition root as binary and silently skip merge/security scans even though
// Node still parses it. Runtime NUL delimiters belong in source as escaped \\x00 spellings.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.js', '*.mjs'], {
  cwd: root,
  encoding: 'utf8'
}).split('\0').filter(Boolean);

assert.ok(tracked.length > 0, 'tracked JavaScript source inventory is non-empty');

const offenders = tracked.filter(file => fs.readFileSync(path.join(root, file)).includes(0));
assert.deepEqual(offenders, [], 'tracked JavaScript source files contain no literal NUL bytes');

console.log('source-text-integrity.test: OK (' + tracked.length + ' tracked JS/MJS files)');
