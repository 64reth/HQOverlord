#!/usr/bin/env node
// phase4-evidence.mjs - initialize and validate human-attended P4 evidence.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rawArgs = process.argv.slice(2);
const commands = new Set(['init', 'init-decision', 'check']);
const command = rawArgs.find(a => commands.has(a)) || 'check';
const argSet = new Set(rawArgs);

function argValue(name, fallback = '') {
  const eq = rawArgs.find(a => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const idx = rawArgs.indexOf(name);
  return idx >= 0 && rawArgs[idx + 1] ? rawArgs[idx + 1] : fallback;
}

const evidenceRoot = resolve(argValue('--dir', process.env.STARNET_PHASE4_EVIDENCE_ROOT || join(ROOT, '.dogfood')));
const attendedFile = join(evidenceRoot, 'phase4-attended-evidence.json');
const decisionFile = join(evidenceRoot, 'phase4-decision.json');
const shouldInitDecision = argSet.has('--decision') || command === 'init-decision';
const force = argSet.has('--force');
const operatorName = argValue('--operator', process.env.USERNAME || process.env.USER || 'andro');

function nowIso() { return new Date().toISOString(); }
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { return { __readError: (e && e.message) || String(e) }; }
}
function writeJsonIfMissing(file, value) {
  if (existsSync(file) && !force) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return true;
}
function attendedTemplate() {
  return {
    generatedAt: nowIso(),
    operator: operatorName,
    sameWorkTrial: {
      passed: false,
      screenshots: [],
      runIds: [],
      transcriptIds: [],
      artifactPaths: [],
      ledgerRows: [],
      notes: ''
    },
    soak: {
      freshPass: false,
      restartPass: false,
      transcriptPreserved: false,
      ledgerPreserved: false,
      artifactsPreserved: false,
      memoryPreserved: false,
      stationStatePreserved: false,
      notes: ''
    },
    failureRecovery: {
      cancelPassed: false,
      budgetPassed: false,
      deniedConsentPassed: false,
      toolErrorPassed: false,
      checkpointRestorePassed: false,
      notes: ''
    }
  };
}
function decisionTemplate() {
  return {
    decision: 'blocked',
    acceptedBy: operatorName,
    acceptedAt: nowIso(),
    notes: 'P4 decision is blocked until live provider and attended UI evidence are complete.',
    acceptedPilotGaps: []
  };
}
function hasItems(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => String(x || '').trim());
}
function boolTrue(v) { return v === true; }
function addMissing(out, label, ok) {
  if (!ok) out.push(label);
}

function validateAttended() {
  const missing = [];
  if (!existsSync(attendedFile)) {
    return { ok: false, file: attendedFile, missing: ['file does not exist; run `npm.cmd run phase4:evidence:init`'] };
  }
  const doc = readJson(attendedFile);
  if (doc.__readError) return { ok: false, file: attendedFile, missing: ['invalid JSON: ' + doc.__readError] };
  addMissing(missing, 'generatedAt', typeof doc.generatedAt === 'string' && doc.generatedAt.trim());
  addMissing(missing, 'operator', typeof doc.operator === 'string' && doc.operator.trim());

  const s = doc.sameWorkTrial || {};
  addMissing(missing, 'sameWorkTrial.passed', boolTrue(s.passed));
  addMissing(missing, 'sameWorkTrial.screenshots[]', hasItems(s.screenshots));
  addMissing(missing, 'sameWorkTrial.runIds[]', hasItems(s.runIds));
  addMissing(missing, 'sameWorkTrial.transcriptIds[]', hasItems(s.transcriptIds));
  addMissing(missing, 'sameWorkTrial.artifactPaths[]', hasItems(s.artifactPaths));
  addMissing(missing, 'sameWorkTrial.ledgerRows[]', hasItems(s.ledgerRows));

  const soak = doc.soak || {};
  for (const key of ['freshPass', 'restartPass', 'transcriptPreserved', 'ledgerPreserved', 'artifactsPreserved', 'memoryPreserved', 'stationStatePreserved']) {
    addMissing(missing, 'soak.' + key, boolTrue(soak[key]));
  }

  const fr = doc.failureRecovery || {};
  for (const key of ['cancelPassed', 'budgetPassed', 'deniedConsentPassed', 'toolErrorPassed', 'checkpointRestorePassed']) {
    addMissing(missing, 'failureRecovery.' + key, boolTrue(fr[key]));
  }
  return { ok: missing.length === 0, file: attendedFile, missing };
}

function validateDecision() {
  const missing = [];
  if (!existsSync(decisionFile)) {
    return { ok: false, file: decisionFile, missing: ['file does not exist; run `npm.cmd run phase4:evidence:init:decision`'] };
  }
  const doc = readJson(decisionFile);
  if (doc.__readError) return { ok: false, file: decisionFile, missing: ['invalid JSON: ' + doc.__readError] };
  const allowed = new Set(['ready-to-replace', 'limited-pilot', 'blocked', 'not-ready']);
  addMissing(missing, 'decision', allowed.has(doc.decision));
  addMissing(missing, 'acceptedBy', typeof doc.acceptedBy === 'string' && doc.acceptedBy.trim());
  addMissing(missing, 'acceptedAt', typeof doc.acceptedAt === 'string' && doc.acceptedAt.trim());
  addMissing(missing, 'notes', typeof doc.notes === 'string' && doc.notes.trim());
  addMissing(missing, 'acceptedPilotGaps[]', Array.isArray(doc.acceptedPilotGaps));
  return { ok: missing.length === 0, file: decisionFile, missing };
}

function printValidation(attended, decision) {
  const rows = [attended, decision];
  for (const row of rows) {
    console.log((row.ok ? 'PASS ' : 'MISSING ') + row.file);
    if (!row.ok) {
      for (const m of row.missing) console.log('  - ' + m);
    }
  }
  const ok = rows.every(r => r.ok);
  console.log(ok ? '\nphase4:evidence: complete' : '\nphase4:evidence: incomplete');
  return ok;
}

if (command === 'init' || command === 'init-decision') {
  const wroteAttended = writeJsonIfMissing(attendedFile, attendedTemplate());
  console.log((wroteAttended ? 'created ' : 'exists  ') + attendedFile);
  if (shouldInitDecision) {
    const wroteDecision = writeJsonIfMissing(decisionFile, decisionTemplate());
    console.log((wroteDecision ? 'created ' : 'exists  ') + decisionFile);
  }
  console.log('No pass fields were set automatically. Fill this from real attended P4 evidence.');
  process.exit(0);
}

if (command === 'check') {
  const ok = printValidation(validateAttended(), validateDecision());
  process.exit(ok ? 0 : 2);
}

console.error('usage: node scripts/phase4-evidence.mjs init [--decision] [--operator NAME] [--dir PATH] [--force]');
console.error('       node scripts/phase4-evidence.mjs init-decision [--operator NAME] [--dir PATH] [--force]');
console.error('       node scripts/phase4-evidence.mjs check [--dir PATH]');
process.exit(2);
