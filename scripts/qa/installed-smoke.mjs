#!/usr/bin/env node
/* scripts/qa/installed-smoke.mjs — EL-4 / EL-8: the INSTALLED-EXE smoke.
 *
 * WHY THIS EXISTS: every other detector (Guardian / Beginner / Journeys / Cartographer) boots a
 * DEV sidecar and drives HEADLESS Chrome. None of them can ever see the WebView2-cache class of
 * bug (docs/MISTAKES.md "Desktop / installed-app traps"): the desktop UI is the frontend COMPILED
 * INTO THE EXE, served over `http://tauri.localhost`, and WebView2 caches it and never revalidates.
 * The ONLY proof of installed-UI behavior is a CDP-attach to the RUNNING packaged exe. This runner
 * is that proof, kept to a SMOKE (minutes, a handful of assertions) — not the full Atlas.
 *
 * HOW YOU RUN IT (operator, on Andrew's machine):
 *   1. Relaunch the installed StarNet with the WebView2 debug port open:
 *        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9333'
 *        & "$env:LOCALAPPDATA\..\StarNet.exe"     # or the Start-menu shortcut
 *      (9333 is the convention prior installed-exe CDP work used — desktop-bundles /
 *       voice-system memory. Override with STARNET_SMOKE_CDP_PORT.)
 *   2. Set STARNET_SMOKE_EXPECTED_HEAD (full candidate SHA) and STARNET_SMOKE_ARTIFACT (the exact executable being run).
 *   3. `npm run qa:smoke:installed`  → attaches to that port, sweeps, writes the stamp.
 *
 * THE STAMP CONTRACT (read by the qa:ready gate — scripts/qa/ready.mjs, lane agent/ready-gate):
 *   qa/installed/last-smoke.json = schema v3 with expected commit/tree, observed build kind,
 *   installed provenance kind, desktop origin, artifact SHA-256, result, and evidence. See
 *   qa/installed/README.md.
 *   result ∈ "GREEN" | "RED" | "BLOCKED". Do NOT change this shape without flagging the ready-gate lane.
 *
 * NO-FAKE-GREEN (Charter Part 5): can't attach, or can't PROVE the app version → result BLOCKED
 * + a P0 ledger finding (never a silent GREEN). A parity assertion that fails on the installed
 * build → result RED + a P1 finding. Only a real attach that proves the version AND passes every
 * assertion is GREEN. Findings go through scripts/qa/ledger.mjs (the ONE dedup/known authority).
 *
 * HOUSE PATTERN (matches scripts/qa/{ledger,cartographer}.mjs + the sidecar stores): the CORE is a
 * set of PURE, dependency-injected functions (attach / io / clock / expected candidate are all injected), so the
 * classifier + stamp writer/validator test headlessly with fakes (test/qa-installed-smoke.test.js).
 * The INVOKED_DIRECTLY block is the one place ambient effects (real CDP, real fs, real ledger CLI,
 * real git) live — exactly like ledger.mjs's CLI block.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { connectCDP, evalJS, collectDiagnostics } from '../lib/cdp.mjs';
import {
  KINDS,
  classifyProvenance,
  externallyVerifyOfficialEvidence,
  normalizeOfficialEvidence,
} from './product-perfect/provenance.mjs';

/* ─────────────────────────────── PURE CORE ─────────────────────────────── */

export const RESULTS = { GREEN: 'GREEN', RED: 'RED', BLOCKED: 'BLOCKED' };
const RESULT_SET = new Set([RESULTS.GREEN, RESULTS.RED, RESULTS.BLOCKED]);
export const SMOKE_CREW = 'Installed Smoke';
export const STAMP_SCHEMA = 3;
export const TAURI_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'app://localhost']);
export const REQUIRED_CHECKS = Object.freeze([
  'desktop/tauri-origin',
  'desktop/build-info',
  'desktop/executable-identity',
  'boot/api-token-present',
  'version/app-nonblank',
  'boot/world-present',
  'boot/stage-rendered',
  'store/workstreams-wellformed',
  'board/no-forever-running'
]);

// The board invariant is only meaningful against a rendered TASKS board. Installed smoke used to
// inspect the boot-default (closed) surface and report a product RED without ever operating the
// control whose contents it claimed to verify. Drive the real dock control first and wait for the
// panel to settle; SMOKE_PROBE remains the read-only assertion pass. A cold WebView can expose the
// dock DOM before StationUI.init() has attached its listener, so an unhandled first click is not
// evidence of a product failure. Retry while the board is absent. Opening TASKS creates .kb-cols
// synchronously, which makes the success check prevent a later retry from toggling it closed.
export const PREPARE_SMOKE_SURFACE = `(async () => {
  for (let i = 0; i < 120; i++) {
    if (document.querySelectorAll('.kb-cols').length === 1) return true;
    const trigger = document.querySelector('[data-term="tasks"]');
    if (trigger) trigger.click();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return document.querySelectorAll('.kb-cols').length === 1;
})()`;

function str(v) { return v == null ? '' : String(v); }

// The in-page probe. A self-contained async IIFE returning
// { appVersion, appSource, mode, bootSane, checks:[{name,ok,detail}], notes }.
// PRODUCTION-SAFE: unlike journeys' PARITY_PROBE it never touches window.__SKYNET_TEST__ (a dev/seed-
// only hook absent from the packaged build) — it is the smoke-scoped cousin of parityCheck, asserting
// only invariants a real production page exposes (the launch token, /api/version, /api/diagnostics,
// the world/canvas, and the Workstreams/Channels no-forever-running truth when the board is open).
//
// AUTH HEADER (ledger finding 4d9992d9) — the probe MUST send X-StarNet-Token, never an "Authorization: Bearer"
// header. The sidecar authenticates on X-StarNet-Token (a Bearer token is rejected as "forbidden token"), and its
// CORS Access-Control-Allow-Headers lists only Content-Type,X-StarNet-Token,X-Skynet-Token. On the packaged desktop
// exe the page origin is http://tauri.localhost while the sidecar is http://127.0.0.1:<port>, so every /api/* call is
// CROSS-ORIGIN: a stray Authorization header makes the OPTIONS preflight request a header the sidecar won't allow, the
// preflight is rejected, and fetch() dies with "Failed to fetch" BEFORE any response — appVersion reads blank and the
// smoke goes BLOCKED even though /api/version is serving the honest version. Same-origin dev/headless never preflights,
// which is why this only ever surfaced on the installed build. (Kept OUTSIDE the probe string so the auth-scheme name
// isn't part of SMOKE_PROBE — test/qa-installed-smoke.test.js A0 statically forbids those words appearing in it.)
export const SMOKE_PROBE = `(async () => {
  const out = {
    appVersion: '', appSource: '', harness: '', sidecarBuildSha: '', sidecarBuildDirty: null,
    mode: '', origin: String((location && location.origin) || ''), shell: null,
    bootSane: false, checks: [], notes: ''
  };
  const add = (name, ok, detail) => out.checks.push({ name: String(name), ok: !!ok, detail: String(detail == null ? '' : detail) });
  const tauriOrigins = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'app://localhost']);
  add('desktop/tauri-origin', tauriOrigins.has(out.origin), 'origin=' + (out.origin || '(blank)'));
  try {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') throw new Error('Tauri invoke unavailable');
    out.shell = await core.invoke('starnet_build_info');
    const knownKinds = new Set(['reproducible-source', 'custom', 'dirty-dev']);
    const known = !!(out.shell && /^[0-9a-f]{40}$/i.test(String(out.shell.sha || '')) &&
      /^[0-9a-f]{40}$/i.test(String(out.shell.sourceTree || '')) && knownKinds.has(String(out.shell.provenanceKind || '')));
    add('desktop/build-info', known, known
      ? ('commit=' + out.shell.sha + ' tree=' + out.shell.sourceTree + ' kind=' + out.shell.provenanceKind + ' describe=' + out.shell.describe + ' dirty=' + !!out.shell.dirty)
      : 'starnet_build_info returned no known commit/tree/provenance kind');
    const executableSha256 = String((out.shell && out.shell.executableSha256) || '').toLowerCase();
    const executableSize = Number(out.shell && out.shell.executableSize);
    const executableKnown = /^[0-9a-f]{64}$/.test(executableSha256) && Number.isSafeInteger(executableSize) && executableSize > 0;
    add('desktop/executable-identity', executableKnown, executableKnown
      ? ('sha256=' + executableSha256.slice(0, 12) + '… size=' + executableSize)
      : 'starnet_build_info returned no valid runtime executable SHA-256/size');
  } catch (e) {
    add('desktop/build-info', false, 'starnet_build_info failed: ' + (e && e.message));
    add('desktop/executable-identity', false, 'starnet_build_info failed before runtime executable identity was available');
  }
  const tok = (typeof window !== 'undefined' && window.__STARNET_API_TOKEN__) ? String(window.__STARNET_API_TOKEN__) : '';
  // X-StarNet-Token is the sidecar's auth header AND the only auth header its CORS allow-list accepts on the
  // cross-origin packaged build. See the long note above SMOKE_PROBE (finding 4d9992d9) before changing this.
  const authHeaders = tok ? { 'X-StarNet-Token': tok } : {};
  add('boot/api-token-present', !!tok, tok ? 'per-launch token injected into the page' : 'no window.__STARNET_API_TOKEN__ — is this the app page?');

  // ---- app version (token-gated GET /api/version): the whole point of the smoke — WHICH build is this? ----
  try {
    const r = await fetch('/api/version', { headers: authHeaders });
    if (r.ok) {
      const v = await r.json();
      out.appVersion = String((v && v.app) || '');
      out.appSource = String((v && v.appSource) || '');
      out.harness = String((v && v.harness) || '');
      out.sidecarBuildSha = String((v && v.buildSha) || '');
      out.sidecarBuildDirty = (v && typeof v.buildDirty === 'boolean') ? v.buildDirty : null;
      add('version/app-nonblank', !!out.appVersion, 'app=' + (out.appVersion || '(blank)') + ' source=' + out.appSource + ' harness=' + out.harness);
    } else {
      add('version/app-nonblank', false, 'GET /api/version -> HTTP ' + r.status);
    }
  } catch (e) { add('version/app-nonblank', false, 'fetch /api/version threw: ' + (e && e.message)); }

  // ---- diagnostics mode (desktop vs browser): additional proof + surfaces the exe origin ----
  try {
    const r = await fetch('/api/diagnostics', { headers: authHeaders });
    if (r.ok) { const d = await r.json(); const rep = (d && d.report) ? d.report : d; out.mode = String((rep && rep.mode) || ''); }
  } catch (e) { /* diagnostics is a nice-to-have; version is the load-bearing proof */ }

  // ---- boot state sane: the world actually rendered ----
  const hasWorld = (typeof window !== 'undefined') && (!!window.__world || !!window.__SKYNET_WORLD || !!document.querySelector('canvas'));
  add('boot/world-present', hasWorld, hasWorld ? 'world model / canvas present' : 'no __world and no <canvas> — app did not render');
  const hasStage = !!document.querySelector('#stage, canvas, .station, #app, .stage');
  add('boot/stage-rendered', hasStage, hasStage ? 'stage/app root present in DOM' : 'no stage/app root element');

  // ---- production-safe parity subset (cousin of journeys parityCheck; no __SKYNET_TEST__ needed) ----
  const WS = (typeof Workstreams !== 'undefined') ? Workstreams : null;
  const CH = (typeof Channels !== 'undefined') ? Channels : null;
  if (WS && WS.list) {
    let list = null; try { list = WS.list(); } catch (e) { /* fall through to well-formed=false */ }
    const wellFormed = Array.isArray(list);
    add('store/workstreams-wellformed', wellFormed, wellFormed ? (list.length + ' workstream(s) in the store') : 'Workstreams.list() did not return an array');
    // no forever-running: require proof that TASKS is open, then permit a legitimately empty board.
    // If nothing is busy, no rendered card may still show a RUNNING chip (same invariant as J5).
    const boardEls = Array.from(document.querySelectorAll('.kb-cols'));
    const boardOpen = boardEls.length === 1;
    const cardEls = Array.from(document.querySelectorAll('.kb-card'));
    const busyIds = (CH && CH.busyIds) ? CH.busyIds() : [];
    if (!boardOpen) {
      add('board/no-forever-running', false, 'TASKS board closed or ambiguous — expected exactly one .kb-cols, observed ' + boardEls.length);
    } else if (!Array.isArray(busyIds)) {
      add('board/no-forever-running', false, 'Channels.busyIds() did not return an array');
    } else if (busyIds.length === 0) {
      const stuck = cardEls.filter(c => c.querySelector('.kb-state.running')).map(c => c.dataset.id).filter(Boolean);
      add('board/no-forever-running', stuck.length === 0, stuck.length
        ? 'RUNNING chip with nothing busy: ' + stuck.join(',')
        : 'TASKS board open; ' + cardEls.length + ' card(s); no stuck RUNNING chip while idle');
    } else {
      add('board/no-forever-running', true, busyIds.length + ' run(s) legitimately in flight on the open TASKS board');
    }
  } else {
    add('store/workstreams-wellformed', false, 'Workstreams store unavailable — installed parity is unproven');
  }

  out.bootSane = hasWorld && hasStage;
  out.notes = 'checks=' + out.checks.length + ' mode=' + (out.mode || '?');
  return out;
})()`;

// Decide the smoke result from what we managed to observe. The order encodes no-fake-green:
// unreachable OR unversioned is BLOCKED (we proved nothing), a failed assertion is RED, all-pass GREEN.
export function classifyResult(obs) {
  obs = obs || {};
  if (!obs.attached) return RESULTS.BLOCKED;
  if (!str(obs.appVersion).trim()) return RESULTS.BLOCKED;
  if (str(obs.mode) !== 'desktop' || !TAURI_ORIGINS.has(str(obs.origin))) return RESULTS.BLOCKED;
  const shell = obs.shell && typeof obs.shell === 'object' ? obs.shell : null;
  const expectedHead = str(obs.expectedHead).trim().toLowerCase();
  const expectedTree = str(obs.expectedTree).trim().toLowerCase();
  const buildCommit = str(shell && (shell.sha || shell.fullCommit || obs.sidecarBuildSha)).trim().toLowerCase();
  const sourceTree = str(shell && shell.sourceTree).trim().toLowerCase();
  const buildKind = str(shell && shell.provenanceKind).trim().toLowerCase();
  if (!shell || !/^[0-9a-f]{40}$/.test(expectedHead) || !/^[0-9a-f]{40}$/.test(buildCommit) ||
      !/^[0-9a-f]{40}$/.test(expectedTree) || !/^[0-9a-f]{40}$/.test(sourceTree)) return RESULTS.BLOCKED;
  if (buildCommit !== expectedHead || str(obs.sidecarBuildSha).toLowerCase() !== expectedHead) return RESULTS.BLOCKED;
  if (sourceTree !== expectedTree) return RESULTS.BLOCKED;
  if (shell.dirty === true || obs.sidecarBuildDirty !== false) return RESULTS.BLOCKED;
  // The running binary reports only its base build class. `official` is never a build-time
  // assertion; it can be earned only when the host externally verifies exact release evidence.
  if (buildKind !== KINDS.REPRODUCIBLE_SOURCE && buildKind !== KINDS.CUSTOM) return RESULTS.BLOCKED;
  if (str(shell.version) !== str(obs.appVersion)) return RESULTS.BLOCKED;
  if (!str(shell.describe) || str(shell.describe) !== str(obs.harness)) return RESULTS.BLOCKED;
  const artifact = obs.artifact && typeof obs.artifact === 'object' ? obs.artifact : null;
  const executableSha256 = str(shell.executableSha256).trim().toLowerCase();
  const executableSize = Number(shell.executableSize);
  const artifactSha256 = str(artifact && artifact.sha256).trim().toLowerCase();
  const artifactSize = Number(artifact && artifact.size);
  if (!/^[0-9a-f]{64}$/.test(executableSha256) || !Number.isSafeInteger(executableSize) || executableSize <= 0) return RESULTS.BLOCKED;
  if (!artifact || !/^[0-9a-f]{64}$/.test(artifactSha256) || !Number.isSafeInteger(artifactSize) || artifactSize <= 0) return RESULTS.BLOCKED;
  if (artifactSha256 !== executableSha256 || artifactSize !== executableSize) return RESULTS.BLOCKED;
  const baseProvenance = classifyProvenance({
    commitSha: buildCommit,
    sourceTree,
    dirty: shell.dirty === true,
    declaredKind: buildKind,
    artifact,
  });
  if (baseProvenance.kind !== buildKind) return RESULTS.BLOCKED;
  if (obs.evidencePersisted !== true) return RESULTS.BLOCKED;
  const checks = Array.isArray(obs.checks) ? obs.checks : [];
  const byName = new Map(checks.filter(Boolean).map(check => [str(check.name), check]));
  if (REQUIRED_CHECKS.some(name => !byName.has(name))) return RESULTS.BLOCKED;
  const anyFail = checks.some(check => check && check.ok === false);
  return anyFail ? RESULTS.RED : RESULTS.GREEN;
}

// Coerce arbitrary input into the exact stamp shape ready-gate reads. An unknown/blank result clamps to
// BLOCKED (no-fake-green: a stamp that can't say GREEN honestly must not read GREEN).
function normalizeOfficialSummary(value) {
  const evidence = normalizeOfficialEvidence(value);
  const authority = str(value && value.authority).trim();
  const verificationId = str(value && value.verificationId).trim();
  if (!evidence || !authority || !verificationId) return null;
  return {
    schemaVersion: evidence.schemaVersion,
    candidateCommit: evidence.candidateCommit,
    sourceTree: evidence.sourceTree,
    artifact: { sha256: evidence.artifact.sha256, size: evidence.artifact.size },
    authority,
    verificationId,
  };
}

export function normalizeStamp(input, opts) {
  input = input || {}; opts = opts || {};
  const clock = opts.clock || {};
  const isoNow = typeof clock.nowIso === 'function' ? clock.nowIso() : '';
  const result = RESULT_SET.has(input.result) ? input.result : RESULTS.BLOCKED;
  const evidenceInput = Array.isArray(input.evidence) ? input.evidence : (input.evidence ? [input.evidence] : []);
  const evidence = evidenceInput.map(entry => entry && typeof entry === 'object' ? {
    path: str(entry.path).trim(),
    sha256: str(entry.sha256).trim().toLowerCase(),
    size: Number(entry.size) || 0
  } : null).filter(entry => entry && entry.path);
  return {
    schemaVersion: STAMP_SCHEMA,
    stampIso: str(input.stampIso || isoNow).trim(),
    expectedHead: str(input.expectedHead).trim().toLowerCase(),
    expectedTree: str(input.expectedTree).trim().toLowerCase(),
    buildCommit: str(input.buildCommit).trim().toLowerCase(),
    sourceTree: str(input.sourceTree).trim().toLowerCase(),
    buildDescribe: str(input.buildDescribe).trim(),
    buildDirty: input.buildDirty === true,
    buildKind: str(input.buildKind || KINDS.DIRTY_DEV).trim().toLowerCase(),
    provenanceKind: str(input.provenanceKind || KINDS.DIRTY_DEV).trim().toLowerCase(),
    officialEvidence: normalizeOfficialSummary(input.officialEvidence),
    appVersion: str(input.appVersion).trim(),
    sidecarHarness: str(input.sidecarHarness).trim(),
    mode: str(input.mode).trim(),
    origin: str(input.origin).trim(),
    artifact: input.artifact && typeof input.artifact === 'object' ? {
      path: str(input.artifact.path).trim(),
      sha256: str(input.artifact.sha256).trim().toLowerCase(),
      size: Number(input.artifact.size) || 0
    } : null,
    runtimeExecutable: input.runtimeExecutable && typeof input.runtimeExecutable === 'object' ? {
      sha256: str(input.runtimeExecutable.sha256).trim().toLowerCase(),
      size: Number(input.runtimeExecutable.size) || 0
    } : null,
    result,
    evidence,
    notes: str(input.notes).trim()
  };
}

// Validate a stamp against the contract the ready-gate depends on. Returns { ok, errors[] }.
export function validateStamp(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['stamp is not an object'] };
  if (obj.schemaVersion !== STAMP_SCHEMA) errors.push('schemaVersion must be ' + STAMP_SCHEMA);
  if (typeof obj.stampIso !== 'string' || !obj.stampIso.trim()) errors.push('stampIso missing/blank');
  else if (isNaN(Date.parse(obj.stampIso))) errors.push('stampIso is not a parseable ISO timestamp');
  if (!RESULT_SET.has(obj.result)) errors.push('result must be one of GREEN|RED|BLOCKED');
  if (typeof obj.appVersion !== 'string') errors.push('appVersion must be a string');
  if (typeof obj.expectedHead !== 'string') errors.push('expectedHead must be a string');
  if (typeof obj.expectedTree !== 'string') errors.push('expectedTree must be a string');
  if (typeof obj.buildCommit !== 'string') errors.push('buildCommit must be a string');
  if (typeof obj.sourceTree !== 'string') errors.push('sourceTree must be a string');
  if (typeof obj.buildDescribe !== 'string') errors.push('buildDescribe must be a string');
  if (typeof obj.buildDirty !== 'boolean') errors.push('buildDirty must be a boolean');
  if (!Object.values(KINDS).includes(obj.buildKind)) errors.push('buildKind must be a provenance kind');
  if (!Object.values(KINDS).includes(obj.provenanceKind)) errors.push('provenanceKind must be a provenance kind');
  if (obj.officialEvidence !== null && !normalizeOfficialSummary(obj.officialEvidence)) errors.push('officialEvidence must be an externally verified evidence summary or null');
  if (typeof obj.sidecarHarness !== 'string') errors.push('sidecarHarness must be a string');
  if (typeof obj.mode !== 'string') errors.push('mode must be a string');
  if (typeof obj.origin !== 'string') errors.push('origin must be a string');
  if (!Array.isArray(obj.evidence)) errors.push('evidence must be an array');
  else if (obj.evidence.some(entry => !entry || typeof entry !== 'object' || !str(entry.path).trim() || !/^[0-9a-f]{64}$/i.test(str(entry.sha256)) || !Number.isSafeInteger(Number(entry.size)) || Number(entry.size) <= 0))
    errors.push('evidence entries must carry path, SHA-256, and positive integer size');
  if (obj.runtimeExecutable !== null && (!obj.runtimeExecutable || typeof obj.runtimeExecutable !== 'object')) errors.push('runtimeExecutable must be an object or null');
  if (typeof obj.notes !== 'string') errors.push('notes must be a string');
  // A GREEN stamp that can't name the build or carry an artifact is a lie — reject it as invalid.
  if (obj.result === RESULTS.GREEN && (typeof obj.appVersion !== 'string' || !obj.appVersion.trim()))
    errors.push('GREEN requires a non-blank appVersion (no-fake-green)');
  if (obj.result === RESULTS.GREEN && (!Array.isArray(obj.evidence) || obj.evidence.length === 0))
    errors.push('GREEN requires at least one content-bound evidence file (no-fake-green)');
  if (obj.result === RESULTS.GREEN || obj.result === RESULTS.RED) {
    if (!/^[0-9a-f]{40}$/i.test(str(obj.expectedHead))) errors.push('proved result requires a full expectedHead');
    if (!/^[0-9a-f]{40}$/i.test(str(obj.buildCommit))) errors.push('proved result requires a full buildCommit');
    if (str(obj.expectedHead).toLowerCase() !== str(obj.buildCommit).toLowerCase()) errors.push('buildCommit must equal expectedHead');
    if (!/^[0-9a-f]{40}$/i.test(str(obj.expectedTree))) errors.push('proved result requires a full expectedTree');
    if (!/^[0-9a-f]{40}$/i.test(str(obj.sourceTree))) errors.push('proved result requires a full sourceTree');
    if (str(obj.expectedTree).toLowerCase() !== str(obj.sourceTree).toLowerCase()) errors.push('sourceTree must equal expectedTree');
    if (obj.buildDirty !== false) errors.push('proved result requires a clean build');
    if (obj.buildKind !== KINDS.REPRODUCIBLE_SOURCE && obj.buildKind !== KINDS.CUSTOM) errors.push('proved result requires reproducible-source or custom BuildInfo');
    if (obj.provenanceKind === KINDS.DIRTY_DEV) errors.push('proved result cannot be dirty-dev');
    if (obj.buildKind === KINDS.CUSTOM && obj.provenanceKind !== KINDS.CUSTOM) errors.push('an explicit custom build must stay custom');
    if (obj.buildKind === KINDS.REPRODUCIBLE_SOURCE && ![KINDS.REPRODUCIBLE_SOURCE, KINDS.OFFICIAL].includes(obj.provenanceKind)) errors.push('reproducible-source build has an invalid installed classification');
    if (obj.mode !== 'desktop' || !TAURI_ORIGINS.has(str(obj.origin))) errors.push('proved result requires a trusted desktop origin');
    const artifactSha256 = str(obj.artifact && obj.artifact.sha256).toLowerCase();
    const artifactSize = Number(obj.artifact && obj.artifact.size);
    const runtimeSha256 = str(obj.runtimeExecutable && obj.runtimeExecutable.sha256).toLowerCase();
    const runtimeSize = Number(obj.runtimeExecutable && obj.runtimeExecutable.size);
    if (!obj.artifact || !str(obj.artifact.path).trim() || !/^[0-9a-f]{64}$/.test(artifactSha256) || !Number.isSafeInteger(artifactSize) || artifactSize <= 0) errors.push('proved result requires a hashed artifact');
    if (!obj.runtimeExecutable || !/^[0-9a-f]{64}$/.test(runtimeSha256) || !Number.isSafeInteger(runtimeSize) || runtimeSize <= 0) errors.push('proved result requires the runtime executable identity');
    if (artifactSha256 !== runtimeSha256 || artifactSize !== runtimeSize) errors.push('artifact identity must equal the runtime executable identity');
    const official = normalizeOfficialSummary(obj.officialEvidence);
    if (obj.provenanceKind === KINDS.OFFICIAL) {
      if (!official) errors.push('official provenance requires official evidence');
      else {
        if (official.candidateCommit !== str(obj.buildCommit).toLowerCase() || official.sourceTree !== str(obj.sourceTree).toLowerCase()) errors.push('official evidence must match buildCommit and sourceTree');
        if (official.artifact.sha256 !== artifactSha256 || official.artifact.size !== artifactSize) errors.push('official evidence must match the executable artifact');
      }
    } else if (obj.officialEvidence !== null) {
      errors.push('non-official provenance must not carry official evidence');
    }
  }
  return { ok: errors.length === 0, errors };
}

// Build the ledger finding for a non-GREEN result. Pure so the test can assert its shape/severity.
export function buildFinding(result, notes, failedChecks, evidence, stampPath) {
  const fc = Array.isArray(failedChecks) ? failedChecks : [];
  const evidencePaths = Array.isArray(evidence)
    ? evidence.map(entry => typeof entry === 'string' ? entry : str(entry && entry.path)).map(s => s.trim()).filter(Boolean)
    : [];
  const ev = evidencePaths.length ? evidencePaths : [stampPath || 'qa/installed/last-smoke.json'];
  if (result === RESULTS.BLOCKED) {
    return {
      crew: SMOKE_CREW, severity: 'P0', checkId: 'installed-smoke',
      subject: 'installed-exe-unreachable-or-unversioned',
      title: ('Installed-exe smoke BLOCKED: ' + (notes || 'could not attach / could not prove app version')).slice(0, 160),
      detail: 'The installed-exe smoke could not prove installed-UI behavior: ' + notes +
        '. A detector that cannot run (or cannot prove the build) is a P0 (no-fake-green law) — treat as red until it runs clean.',
      evidence: ev, status: 'open'
    };
  }
  // RED — a real parity divergence on the installed build.
  return {
    crew: SMOKE_CREW, severity: 'P1', checkId: 'installed-smoke',
    subject: 'installed-exe-parity:' + fc.map(c => c.name).sort().join('|'),
    title: ('Installed-exe smoke RED: ' + fc.length + ' parity assertion(s) failed on the installed build').slice(0, 160),
    detail: notes + (fc.length ? ('\n' + fc.map(c => '- ' + c.name + ': ' + c.detail).join('\n')) : ''),
    evidence: ev, status: 'open'
  };
}

/* makeSmoke — the orchestrator, fully dependency-injected.
 *   attach()  -> Promise<session>  (rejects/throws when the exe is unreachable). session = {
 *                  probe() -> Promise<probeResult>,   // evaluates SMOKE_PROBE in the page
 *                  diagnostics?() -> { consoleMsgs, exceptions },
 *                  close?() -> void|Promise }
 *   io.writeEvidence(name, text) -> { path, sha256, size } (or null)
 *   io.writeStamp(stampObj)      -> repo-relative path (defaults to qa/installed/last-smoke.json)
 *   io.fileFinding(finding)      -> bool (true = handled by the ledger, incl. dedup/known)
 *   io.log(...args)              -> void
 *   clock.nowIso() -> ISO string ; expectedHead -> explicit candidate SHA ; artifact -> hashed binary
 */
export function makeSmoke(opts) {
  opts = opts || {};
  const attach = typeof opts.attach === 'function' ? opts.attach : async () => { throw new Error('no attach injected'); };
  const clock = opts.clock || { nowIso: () => new Date(0).toISOString() };
  const expectedHead = str(opts.expectedHead).trim().toLowerCase();
  const expectedTree = str(opts.expectedTree).trim().toLowerCase();
  const artifact = opts.artifact && typeof opts.artifact === 'object' ? opts.artifact : null;
  const io = opts.io || {};
  const log = typeof io.log === 'function' ? io.log : () => {};
  const writeEvidence = typeof io.writeEvidence === 'function' ? io.writeEvidence : () => null;
  const writeStamp = typeof io.writeStamp === 'function' ? io.writeStamp : () => '';
  const readStamp = typeof io.readStamp === 'function' ? io.readStamp : () => null;
  const fileFinding = typeof io.fileFinding === 'function' ? io.fileFinding : () => true;

  async function run() {
    const evidence = [];
    let attached = false, session = null, probe = null, blockReason = '';

    try { session = await attach(); attached = true; }
    catch (e) { blockReason = 'CDP attach failed: ' + (e && e.message ? e.message : str(e)); log('BLOCKED — ' + blockReason); }

    if (attached) {
      try { probe = await session.probe(); }
      catch (e) { blockReason = 'in-page probe threw: ' + (e && e.message ? e.message : str(e)); probe = null; log('BLOCKED — ' + blockReason); }
      let diag = null; try { diag = session.diagnostics ? session.diagnostics() : null; } catch (e) { /* diag optional */ }
      const proof = writeEvidence('probe.json', JSON.stringify({ probe, diagnostics: diag }, null, 2));
      if (proof) evidence.push(proof);
      try { if (session.close) await session.close(); } catch (e) { /* best-effort */ }
    } else {
      const proof = writeEvidence('smoke-blocked.txt', blockReason + '\n');
      if (proof) evidence.push(proof);
    }

    const appVersion = probe ? str(probe.appVersion) : '';
    const checks = probe ? (Array.isArray(probe.checks) ? probe.checks : []) : [];
    const officialVerification = externallyVerifyOfficialEvidence(opts.officialEvidence, opts.verifyOfficialEvidence);
    const provenance = classifyProvenance({
      commitSha: probe && probe.shell && (probe.shell.sha || probe.shell.fullCommit || probe.sidecarBuildSha),
      sourceTree: probe && probe.shell && probe.shell.sourceTree,
      dirty: !!(probe && probe.shell && probe.shell.dirty),
      declaredKind: probe && probe.shell && probe.shell.provenanceKind,
      artifact,
      verifiedOfficialEvidence: officialVerification.capability,
    });
    let result = (!attached || !probe)
      ? RESULTS.BLOCKED
      : classifyResult({
          attached, appVersion, checks, expectedHead, expectedTree, artifact,
          evidencePersisted: evidence.some(entry => entry && typeof entry === 'object' && str(entry.path).trim() && /^[0-9a-f]{64}$/i.test(str(entry.sha256)) && Number.isSafeInteger(Number(entry.size)) && Number(entry.size) > 0),
          mode: probe.mode, origin: probe.origin, shell: probe.shell,
          harness: probe.harness, sidecarBuildSha: probe.sidecarBuildSha,
          sidecarBuildDirty: probe.sidecarBuildDirty
        });

    const failedChecks = checks.filter(c => c && c.ok === false);
    const notes = (() => {
      if (!attached) return blockReason;
      if (!probe) return blockReason || 'probe returned nothing';
      const parts = ['appVersion=' + (appVersion || '(blank)') + ' mode=' + (probe.mode || '?') +
        ' build=' + str(probe.shell && (probe.shell.sha || probe.shell.fullCommit || probe.sidecarBuildSha)).slice(0, 12) +
        ' tree=' + str(probe.shell && probe.shell.sourceTree).slice(0, 12) +
        ' kind=' + provenance.kind +
        ' checks ' + (checks.length - failedChecks.length) + '/' + checks.length + ' pass'];
      if (failedChecks.length) parts.push('FAILED: ' + failedChecks.map(c => c.name).join(', '));
      return parts.join(' · ');
    })().slice(0, 500);

    let stamp = normalizeStamp({
      stampIso: clock.nowIso(), expectedHead, expectedTree,
      buildCommit: probe && probe.shell && (probe.shell.sha || probe.shell.fullCommit || probe.sidecarBuildSha),
      sourceTree: probe && probe.shell && probe.shell.sourceTree,
      buildDescribe: probe && probe.shell && probe.shell.describe,
      buildDirty: !!(probe && probe.shell && probe.shell.dirty),
      buildKind: probe && probe.shell && probe.shell.provenanceKind,
      provenanceKind: provenance.kind,
      officialEvidence: provenance.officialEvidence,
      appVersion, sidecarHarness: probe && probe.harness,
      mode: probe && probe.mode, origin: probe && probe.origin,
      artifact,
      runtimeExecutable: probe && probe.shell ? {
        sha256: probe.shell.executableSha256,
        size: probe.shell.executableSize
      } : null,
      result, evidence, notes
    }, { clock });
    const validation = validateStamp(stamp);
    if (!validation.ok && result !== RESULTS.BLOCKED) {
      result = RESULTS.BLOCKED;
      stamp = normalizeStamp(Object.assign({}, stamp, {
        result,
        notes: (notes + ' · invalid receipt: ' + validation.errors.join('; ')).slice(0, 500)
      }), { clock });
    }
    const stampPath = writeStamp(stamp);
    if (!stampPath) result = RESULTS.BLOCKED;
    else {
      let persisted = null;
      try { persisted = readStamp(); } catch (_) {}
      const persistedValidation = validateStamp(persisted);
      if (!persistedValidation.ok || JSON.stringify(persisted) !== JSON.stringify(stamp)) {
        result = RESULTS.BLOCKED;
        stamp = normalizeStamp(Object.assign({}, stamp, {
          result,
          notes: (stamp.notes + ' · receipt write/read-back failed').slice(0, 500)
        }), { clock });
        writeStamp(stamp);
      }
    }
    log('result=' + result + ' app=' + (appVersion || '(unproven)') + ' → ' + stampPath);

    if (result !== RESULTS.GREEN) {
      fileFinding(buildFinding(result, notes, failedChecks, evidence, stampPath));
    }
    return { result, stamp, stampPath, evidence, failedChecks };
  }

  return { run };
}

/* ─────────────────────────────── CLI (ambient effects) ─────────────────────────────── */

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
  catch (_) { return false; }
})();

if (INVOKED_DIRECTLY) (async () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const REPO = path.resolve(__dirname, '..', '..');          // scripts/qa/ -> repo root
  const LEDGER_CLI = path.join(REPO, 'scripts', 'qa', 'ledger.mjs');
  const OUT_DIR = path.join(REPO, 'qa', 'installed');
  const STAMP_FILE = path.join(OUT_DIR, 'last-smoke.json');
  const PORT = parseInt(process.env.STARNET_SMOKE_CDP_PORT || '9333', 10);
  const expectedHead = str(process.env.STARNET_SMOKE_EXPECTED_HEAD || process.env.STARNET_PRODUCT_PERFECT_CANDIDATE_SHA).trim().toLowerCase();
  const expectedTree = (() => {
    if (!/^[0-9a-f]{40}$/.test(expectedHead)) return '';
    const result = spawnSync('git', ['rev-parse', expectedHead + '^{tree}'], { cwd: REPO, encoding: 'utf8', windowsHide: true });
    const value = str(result.stdout).trim().toLowerCase();
    return result.status === 0 && /^[0-9a-f]{40}$/.test(value) ? value : '';
  })();
  const artifactPath = str(process.env.STARNET_SMOKE_ARTIFACT).trim();

  const stampIsoNow = new Date().toISOString();
  const RUN_DIR = path.join(OUT_DIR, 'smoke-' + stampIsoNow.replace(/[:.]/g, '-'));
  const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/');

  const artifact = (() => {
    if (!artifactPath) return null;
    try {
      const resolved = path.resolve(artifactPath);
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size <= 0) return null;
      const bytes = fs.readFileSync(resolved);
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      return { path: resolved, sha256: hash, size: bytes.length };
    } catch (_) { return null; }
  })();

  const io = {
    log: (...a) => console.log('[qa:smoke:installed]', ...a),
    writeEvidence(name, text) {
      try {
        fs.mkdirSync(RUN_DIR, { recursive: true });
        const file = path.join(RUN_DIR, name);
        fs.writeFileSync(file, text, 'utf8');
        const bytes = fs.readFileSync(file);
        return { path: rel(file), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
      }
      catch (e) { console.error('[qa:smoke:installed] evidence write failed:', e && e.message); return null; }
    },
    writeStamp(obj) {
      try { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(STAMP_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8'); return rel(STAMP_FILE); }
      catch (e) { console.error('[qa:smoke:installed] stamp write failed:', e && e.message); return ''; }
    },
    readStamp() {
      try { return JSON.parse(fs.readFileSync(STAMP_FILE, 'utf8')); }
      catch (_) { return null; }
    },
    fileFinding(finding) {
      const r = spawnSync(process.execPath, [LEDGER_CLI, '--add', '--json', JSON.stringify(finding)], { cwd: REPO, encoding: 'utf8', windowsHide: true });
      const out = String(r.stdout || '').trim(); const err = String(r.stderr || '').trim();
      if (out) io.log('ledger:', out);
      if (err) console.error('[qa:smoke:installed] ledger:', err);
      return (r.status === 0 || r.status === 2);   // exit 2 = refused/known — a HANDLED outcome, not our error
    }
  };

  // Real attach: connect to the ALREADY-RUNNING installed exe's WebView2 debug port (reuses cdp.mjs).
  const attach = async () => {
    const cdp = await connectCDP(PORT);                       // retries ~10s, throws if the port never answers
    try { await cdp.send('Runtime.enable', {}); } catch (_) {}
    const diag = collectDiagnostics(cdp);
    return {
      async probe() {
        await evalJS(cdp, PREPARE_SMOKE_SURFACE);
        return await evalJS(cdp, SMOKE_PROBE);
      },
      diagnostics() { return diag; },
      async close() { try { cdp.ws.close(); } catch (_) {} }
    };
  };

  io.log('attaching to installed exe CDP on 127.0.0.1:' + PORT + ' (relaunch it with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=' + PORT + ')');
  if (!expectedHead) io.log('BLOCKED — set STARNET_SMOKE_EXPECTED_HEAD to the full candidate commit SHA');
  if (!artifact) io.log('BLOCKED — set STARNET_SMOKE_ARTIFACT to the exact installed executable bytes being run');
  if (!expectedTree) io.log('BLOCKED - the expected candidate source tree could not be resolved');
  const smoke = makeSmoke({ attach, clock: { nowIso: () => stampIsoNow }, expectedHead, expectedTree, artifact, io });
  const { result } = await smoke.run();
  // Exit codes mirror the Cartographer: 0 clean (GREEN) · 1 red · 2 blocked.
  process.exit(result === RESULTS.GREEN ? 0 : (result === RESULTS.RED ? 1 : 2));
})();
