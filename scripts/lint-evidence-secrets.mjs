#!/usr/bin/env node
// lint-evidence-secrets.mjs - fail if shareable evidence/log packs contain key-shaped secrets.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = process.argv.slice(2).length
  ? process.argv.slice(2).map(p => resolve(ROOT, p))
  : [resolve(ROOT, '.dogfood')];

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SECRET_PATTERNS = [
  { id: 'openrouter-v1-key', re: /\bsk-or-v1-[A-Za-z0-9_-]{8,}\b/g },
  { id: 'openrouter-key', re: /\bsk-or-[A-Za-z0-9_-]{8,}\b/g },
  { id: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{8,}\b/g },
  { id: 'telegram-bot-token', re: /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g }
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Frozen comparator/source checkouts are inputs, not shareable StarNet evidence. Their own
      // upstream fixtures may intentionally contain key-shaped examples; scan the receipts around
      // them, but do not recursively lint a nested Git worktree or clone as if StarNet authored it.
      if (existsSync(join(full, '.git'))) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function rel(file) {
  return file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
}

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function looksBinary(buf) {
  const limit = Math.min(buf.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

const findings = [];

for (const root of roots) {
  for (const file of walk(root)) {
    const st = statSync(file);
    if (st.size > MAX_FILE_BYTES) continue;
    const buf = readFileSync(file);
    if (looksBinary(buf)) continue;
    const text = buf.toString('utf8');
    for (const pattern of SECRET_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(text))) {
        findings.push({ file: rel(file), line: lineNumber(text, match.index), pattern: pattern.id });
      }
    }
  }
}

if (findings.length) {
  console.error('lint-evidence-secrets: found key-shaped secrets in shareable evidence:');
  for (const f of findings.slice(0, 50)) {
    console.error('- ' + f.file + ':' + f.line + ' [' + f.pattern + ']');
  }
  if (findings.length > 50) console.error('- ... ' + (findings.length - 50) + ' more');
  process.exit(1);
}

console.log('lint-evidence-secrets: OK');
