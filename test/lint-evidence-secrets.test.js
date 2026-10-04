#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'lint-evidence-secrets.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-secret-lint-'));

try {
  fs.mkdirSync(path.join(tmp, 'clean'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clean', 'phase5-status.json'), '{"model":"anthropic/test","usd":0.01}\n');
  fs.mkdirSync(path.join(tmp, 'clean', 'frozen-reference', '.git'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'clean', 'frozen-reference', 'upstream-fixture.txt'), 'key=sk-or-v1-upstreamfixture12345\n');
  {
    const res = spawnSync(process.execPath, [script, path.relative(ROOT, path.join(tmp, 'clean'))], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /OK/);
    assert.doesNotMatch(res.stdout + res.stderr, /upstream-fixture/, 'nested source checkouts are not treated as authored evidence');
  }

  fs.mkdirSync(path.join(tmp, 'dirty'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dirty', 'phase5.log'), 'key=sk-or-v1-abc123456789xyz\n');
  {
    const res = spawnSync(process.execPath, [script, path.relative(ROOT, path.join(tmp, 'dirty'))], {
      cwd: ROOT,
      encoding: 'utf8'
    });
    assert.equal(res.status, 1, res.stderr || res.stdout);
    assert.match(res.stderr, /openrouter-v1-key/);
    assert.doesNotMatch(res.stderr, /abc123456789xyz/, 'lint output redacts by omission');
    assert.doesNotMatch(res.stderr, /upstreamfixture12345/, 'upstream fixture text never leaks');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('lint-evidence-secrets.test: OK (8 assertions)');
