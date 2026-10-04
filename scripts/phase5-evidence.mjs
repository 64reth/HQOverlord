#!/usr/bin/env node
// phase5-evidence.mjs - initialize and validate P5 ref-replacement evidence.

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

const evidenceRoot = resolve(argValue('--dir', process.env.STARNET_PHASE5_EVIDENCE_ROOT || join(ROOT, '.dogfood')));
const evidenceFile = join(evidenceRoot, 'phase5-evidence.json');
const decisionFile = join(evidenceRoot, 'phase5-decision.json');
const shouldInitDecision = argSet.has('--decision') || command === 'init-decision';
const force = argSet.has('--force');
const operatorName = argValue('--operator', process.env.USERNAME || process.env.USER || 'andro');

const SURFACE_ALLOWED = new Set(['ref-proven', 'contract-green', 'accepted-deferral', 'blocked']);
const DESKTOP_ALLOWED = new Set(['green', 'toolchain-blocked', 'accepted-deferral', 'blocked']);
const DECISIONS = new Set(['ready-to-replace', 'limited-pilot', 'blocked', 'not-ready']);

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
function evidenceTemplate() {
  return {
    generatedAt: nowIso(),
    operator: operatorName,
    workloads: {
      passed: false,
      proofLevel: '',
      screenshots: [],
      runIds: [],
      transcriptIds: [],
      artifactPaths: [],
      ledgerRows: [],
      modelNames: [],
      toolCalls: [],
      notes: ''
    },
    surface: {
      browser: { status: 'blocked', proofLevel: '', logs: [], notes: '' },
      computer: { status: 'blocked', proofLevel: '', logs: [], notes: '' }
    },
    soak: {
      phase4LiveGreen: false,
      phase5WorkloadGreen: false,
      restartPreserved: false,
      notes: ''
    },
    recovery: {
      phase4RecoveryGreen: false,
      phase5RecoveryGreen: false,
      notes: ''
    },
    desktop: {
      status: 'blocked',
      logs: [],
      notes: ''
    }
  };
}
function decisionTemplate() {
  return {
    decision: 'blocked',
    acceptedBy: operatorName,
    acceptedAt: nowIso(),
    notes: 'P5 decision is blocked until live workload, surface, soak, recovery, and desktop evidence are complete.',
    acceptedReplacementGaps: []
  };
}
function hasItems(v) {
  return Array.isArray(v) && v.length > 0 && v.every(x => String(x || '').trim());
}
function boolTrue(v) { return v === true; }
function nonEmpty(v) { return typeof v === 'string' && v.trim(); }
function addMissing(out, label, ok) {
  if (!ok) out.push(label);
}

function strictReadyEvidence(doc) {
  const browser = doc && doc.surface && doc.surface.browser;
  const computer = doc && doc.surface && doc.surface.computer;
  const desktop = doc && doc.desktop;
  return !!(doc
    && doc.workloads && doc.workloads.passed
    && browser && browser.status === 'ref-proven'
    && computer && computer.status === 'ref-proven'
    && desktop && desktop.status === 'green'
    && doc.soak && doc.soak.phase4LiveGreen && doc.soak.phase5WorkloadGreen && doc.soak.restartPreserved
    && doc.recovery && doc.recovery.phase4RecoveryGreen && doc.recovery.phase5RecoveryGreen);
}

function validateEvidence() {
  const missing = [];
  if (!existsSync(evidenceFile)) {
    return { ok: false, file: evidenceFile, missing: ['file does not exist; run `npm.cmd run phase5:evidence:init`'] };
  }
  const doc = readJson(evidenceFile);
  if (doc.__readError) return { ok: false, file: evidenceFile, missing: ['invalid JSON: ' + doc.__readError] };
  addMissing(missing, 'generatedAt', nonEmpty(doc.generatedAt));
  addMissing(missing, 'operator', nonEmpty(doc.operator));

  const w = doc.workloads || {};
  addMissing(missing, 'workloads.passed', boolTrue(w.passed));
  addMissing(missing, 'workloads.proofLevel', nonEmpty(w.proofLevel));
  addMissing(missing, 'workloads.screenshots[]', hasItems(w.screenshots));
  addMissing(missing, 'workloads.runIds[]', hasItems(w.runIds));
  addMissing(missing, 'workloads.transcriptIds[]', hasItems(w.transcriptIds));
  addMissing(missing, 'workloads.artifactPaths[]', hasItems(w.artifactPaths));
  addMissing(missing, 'workloads.ledgerRows[]', hasItems(w.ledgerRows));
  addMissing(missing, 'workloads.modelNames[]', hasItems(w.modelNames));
  addMissing(missing, 'workloads.toolCalls[]', hasItems(w.toolCalls));

  const browser = doc.surface && doc.surface.browser || {};
  const computer = doc.surface && doc.surface.computer || {};
  addMissing(missing, 'surface.browser.status', SURFACE_ALLOWED.has(browser.status));
  addMissing(missing, 'surface.browser.logs[]', hasItems(browser.logs));
  addMissing(missing, 'surface.browser.notes', nonEmpty(browser.notes));
  addMissing(missing, 'surface.computer.status', SURFACE_ALLOWED.has(computer.status));
  addMissing(missing, 'surface.computer.logs[]', hasItems(computer.logs));
  addMissing(missing, 'surface.computer.notes', nonEmpty(computer.notes));

  const soak = doc.soak || {};
  addMissing(missing, 'soak.phase4LiveGreen', boolTrue(soak.phase4LiveGreen));
  addMissing(missing, 'soak.phase5WorkloadGreen', boolTrue(soak.phase5WorkloadGreen));
  addMissing(missing, 'soak.restartPreserved', boolTrue(soak.restartPreserved));
  addMissing(missing, 'soak.notes', nonEmpty(soak.notes));

  const recovery = doc.recovery || {};
  addMissing(missing, 'recovery.phase4RecoveryGreen', boolTrue(recovery.phase4RecoveryGreen));
  addMissing(missing, 'recovery.phase5RecoveryGreen', boolTrue(recovery.phase5RecoveryGreen));
  addMissing(missing, 'recovery.notes', nonEmpty(recovery.notes));

  const desktop = doc.desktop || {};
  addMissing(missing, 'desktop.status', DESKTOP_ALLOWED.has(desktop.status));
  addMissing(missing, 'desktop.logs[]', hasItems(desktop.logs));
  addMissing(missing, 'desktop.notes', nonEmpty(desktop.notes));

  return { ok: missing.length === 0, file: evidenceFile, missing, doc, strictReady: strictReadyEvidence(doc) };
}

function validateDecision(ev) {
  const missing = [];
  if (!existsSync(decisionFile)) {
    return { ok: false, file: decisionFile, missing: ['file does not exist; run `npm.cmd run phase5:evidence:init:decision`'] };
  }
  const doc = readJson(decisionFile);
  if (doc.__readError) return { ok: false, file: decisionFile, missing: ['invalid JSON: ' + doc.__readError] };
  addMissing(missing, 'decision', DECISIONS.has(doc.decision));
  addMissing(missing, 'acceptedBy', nonEmpty(doc.acceptedBy));
  addMissing(missing, 'acceptedAt', nonEmpty(doc.acceptedAt));
  addMissing(missing, 'notes', nonEmpty(doc.notes));
  addMissing(missing, 'acceptedReplacementGaps[]', Array.isArray(doc.acceptedReplacementGaps));
  if (doc.decision === 'ready-to-replace') {
    addMissing(missing, 'ready-to-replace requires strict P5 evidence', !!(ev && ev.strictReady));
    addMissing(missing, 'ready-to-replace requires no accepted gaps', Array.isArray(doc.acceptedReplacementGaps) && doc.acceptedReplacementGaps.length === 0);
  }
  return { ok: missing.length === 0, file: decisionFile, missing, doc };
}

function printValidation(evidence, decision) {
  const rows = [evidence, decision];
  for (const row of rows) {
    console.log((row.ok ? 'PASS ' : 'MISSING ') + row.file);
    if (!row.ok) {
      for (const m of row.missing) console.log('  - ' + m);
    }
  }
  const ok = rows.every(r => r.ok);
  const replacementReady = ok && decision.doc && decision.doc.decision === 'ready-to-replace' && evidence.strictReady;
  console.log(ok ? '\nphase5:evidence: complete' : '\nphase5:evidence: incomplete');
  console.log('phase5:replacementReady: ' + (replacementReady ? 'true' : 'false'));
  return ok;
}

if (command === 'init' || command === 'init-decision') {
  const wroteEvidence = writeJsonIfMissing(evidenceFile, evidenceTemplate());
  console.log((wroteEvidence ? 'created ' : 'exists  ') + evidenceFile);
  if (shouldInitDecision) {
    const wroteDecision = writeJsonIfMissing(decisionFile, decisionTemplate());
    console.log((wroteDecision ? 'created ' : 'exists  ') + decisionFile);
  }
  console.log('No pass fields were set automatically. Fill or generate this from real P5 evidence.');
  process.exit(0);
}

if (command === 'check') {
  const evidence = validateEvidence();
  const decision = validateDecision(evidence);
  const ok = printValidation(evidence, decision);
  process.exit(ok ? 0 : 2);
}

console.error('usage: node scripts/phase5-evidence.mjs init [--decision] [--operator NAME] [--dir PATH] [--force]');
console.error('       node scripts/phase5-evidence.mjs init-decision [--operator NAME] [--dir PATH] [--force]');
console.error('       node scripts/phase5-evidence.mjs check [--dir PATH]');
process.exit(2);

