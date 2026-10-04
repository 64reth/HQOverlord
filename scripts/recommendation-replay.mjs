#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { replay } = require('../sidecar/recommendation-ledger.js');
const { evaluate } = require('../sidecar/recommendation-eval.js');
const file = process.argv[2];
const surface = process.argv[3] || '';
if (!file) {
  console.error('usage: node scripts/recommendation-replay.mjs <recommendations.json> [surface]');
  process.exit(2);
}

const resolved = path.resolve(file);
let raw;
try { raw = JSON.parse(fs.readFileSync(resolved, 'utf8')); }
catch (e) { console.error('recommendation replay could not read ' + resolved + ': ' + e.message); process.exit(2); }

const source = raw && raw.recommendations ? raw.recommendations : raw;
const metrics = replay(source, surface ? { surface } : undefined);
const evaluation = evaluate(source, surface ? { surface } : undefined);
console.log(JSON.stringify({ file: resolved, surface: surface || 'all', metrics, evaluation }, null, 2));
