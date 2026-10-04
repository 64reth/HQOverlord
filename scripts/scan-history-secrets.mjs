#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.STARNET_GITLEAKS_BIN || 'gitleaks';
const result = spawnSync(binary, ['git', '.', '--no-banner', '--redact'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: 'inherit'
});

if (result.error) {
  const detail = result.error.code === 'ENOENT'
    ? 'Gitleaks is not installed. Install it from https://github.com/gitleaks/gitleaks/releases or set STARNET_GITLEAKS_BIN.'
    : 'Could not run Gitleaks: ' + result.error.message;
  console.error('[security:secrets] ' + detail);
  process.exit(2);
}

if (result.status !== 0) {
  console.error('[security:secrets] BLOCKED — review every finding before making the repository public.');
  process.exit(result.status || 1);
}

console.log('[security:secrets] PASS — full reachable Git history has no unreviewed findings.');
