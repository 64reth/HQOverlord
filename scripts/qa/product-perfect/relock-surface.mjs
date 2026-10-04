#!/usr/bin/env node
/* Regenerate only qa/product-perfect/claims.json.releaseSurface for the exact clean HEAD.
   The claims inventory and verdicts remain hand-reviewed; this utility updates the mechanical
   candidate-bound byte/path lock after that reviewed source has been committed. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildReleaseSurface } from './claims.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const LEDGER = path.join(ROOT, 'qa', 'product-perfect', 'claims.json');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain');
if (dirty) throw new Error('re-lock requires a clean worktree; commit reviewed source changes first');
const candidate = git('rev-parse', 'HEAD');
const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
if (!ledger.releaseSurface || !Array.isArray(ledger.releaseSurface.files)) {
  throw new Error('claims ledger has no reviewed releaseSurface to replace');
}

ledger.releaseSurface = buildReleaseSurface(ROOT, { candidateCommit: candidate });
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
console.log(`re-locked ${ledger.releaseSurface.files.length} release-surface files @ ${candidate}`);
