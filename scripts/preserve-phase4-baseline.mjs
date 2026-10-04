#!/usr/bin/env node
// preserve-phase4-baseline.mjs - freeze the latest Phase 1-3 evidence for Phase 4 planning.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'STARNET_PHASE4_BASELINE.md');

function readMaybe(path) {
  try { return readFileSync(path, 'utf8').trim(); } catch (_) { return ''; }
}

function readJsonMaybe(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (_) { return null; }
}

function summarizeStatus(label, latestDir, jsonName) {
  const file = join(ROOT, '.dogfood', latestDir, jsonName);
  const json = readJsonMaybe(file);
  if (!json) return '- ' + label + ': missing latest evidence at `' + file + '`';
  const counts = json.counts || {};
  return '- ' + label + ': `' + json.verdict + '`'
    + ' pass=' + (counts.pass || 0)
    + ' fail=' + (counts.fail || 0)
    + ' blocked=' + (counts.blocked || 0)
    + ' skipped=' + (counts.skipped || 0)
    + ' evidence=`' + file + '`';
}

const phase2Summary = readMaybe(join(ROOT, '.dogfood', 'phase2-latest', 'summary.md'));
const phase3Summary = readMaybe(join(ROOT, '.dogfood', 'phase3-latest', 'summary.md'));
const dogfoodSummary = readMaybe(join(ROOT, '.dogfood', 'dogfood-latest', 'summary.md'));

let md = '# StarNet Phase 4 Baseline\n\n';
md += 'Generated: `' + new Date().toISOString() + '`\n\n';
md += 'This file preserves the latest Phase 1-3 evidence before Phase 4 planning. It is intentionally tracked in `docs/`; raw logs remain under `.dogfood/` and may be regenerated.\n\n';
md += '## Status Snapshot\n\n';
md += summarizeStatus('Phase 2', 'phase2-latest', 'phase2-status.json') + '\n';
md += summarizeStatus('Dogfood', 'dogfood-latest', 'dogfood-status.json') + '\n';
md += summarizeStatus('Phase 3', 'phase3-latest', 'phase3-status.json') + '\n\n';
md += '## Phase 4 Starting Line\n\n';
md += '- Treat live provider proof, attended UI dogfood, two-pass restart soak, and Cargo/Tauri build as Phase 4 work.\n';
md += '- Treat Phase 3.5 browser automation and Phase 3.6 computer-use as automated contract green, not ref-proven live parity.\n';
md += '- Keep `npm.cmd run phase3:seal` green before changing Phase 4 scope.\n\n';
md += '## Preserved Phase 2 Summary\n\n';
md += phase2Summary ? phase2Summary + '\n\n' : '_No Phase 2 summary found._\n\n';
md += '## Preserved Dogfood Summary\n\n';
md += dogfoodSummary ? dogfoodSummary + '\n\n' : '_No dogfood summary found._\n\n';
md += '## Preserved Phase 3 Summary\n\n';
md += phase3Summary ? phase3Summary + '\n' : '_No Phase 3 summary found._\n';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, md);
console.log('[phase4-baseline] wrote ' + OUT);
