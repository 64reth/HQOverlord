#!/usr/bin/env node
/*
 * Candidate-owned W1 installed link transport probe.
 *
 * The product-perfect gate launches this file with a fresh challenge and an exact output
 * path.  This producer attaches to the already-running installed Tauri page, proves its
 * executable/source identity, observes the product's real EventSource over CDP for more
 * than forty seconds, kills only the exact bundled sidecar child, observes the UI's real
 * DOWN transition, then requires the Tauri watchdog to restore the same candidate before
 * returning.  It never creates an EventSource, replaces a page callback, or reads the
 * per-launch token.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CDP, evalJS, sleep } from '../lib/cdp.mjs';

export const LINK_RECEIPT_SCHEMA = 1;
export const LINK_PRODUCER = 'installed-link-transport-v2';
export const OBSERVATION_PRODUCER = 'installed-link-observation-v1';
export const MIN_HEALTHY_SPAN_MS = 40000;
export const PROBE_RELATIVE_PATH = 'scripts/qa/installed-link-transport.mjs';
export const TAURI_ORIGINS = new Set([
  'tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'app://localhost'
]);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const QA_INSTALLED = path.join(ROOT, 'qa', 'installed');
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const CHALLENGE = /^w1-[0-9a-f]{64}$/;
const SAFE_SESSION = /^[A-Za-z0-9._-]{8,128}$/;
const ALLOWED_KINDS = new Set(['reproducible-source', 'custom']);

const str = value => value == null ? '' : String(value);
const lower = value => str(value).trim().toLowerCase();

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function processInstanceSha(record) {
  const pid = Number(record && record.pid);
  const createdTicks = str(record && record.createdTicks);
  if (!Number.isInteger(pid) || pid <= 0 || !/^\d{8,32}$/.test(createdTicks)) return '';
  return sha256(pid + ':' + createdTicks);
}

function fileIdentity(file) {
  try {
    const bytes = fs.readFileSync(file);
    const stat = fs.statSync(file);
    if (!stat.isFile() || !bytes.length) return null;
    return { path: path.resolve(file), sha256: sha256(bytes), size: bytes.length };
  } catch (_) { return null; }
}

export function containsSecretMaterial(text) {
  const body = str(text);
  return /(?:sk|xox[baprs]|gh[pousr])-[A-Za-z0-9_\-]{12,}/i.test(body)
    || /(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*["'=:\s]+(?:bearer\s+)?[A-Za-z0-9._\-]{12,}/i.test(body)
    || /[?&](?:token|key|secret)=[^\s&#]+/i.test(body);
}

function outputInsideRuntimeNamespace(file) {
  if (!path.isAbsolute(file) || path.basename(file).toLowerCase() !== 'receipt.json') return false;
  const relative = path.relative(QA_INSTALLED, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const parts = relative.split(/[\\/]/);
  return parts.length === 2 && /^smoke-[A-Za-z0-9._-]+$/.test(parts[0]);
}

export function validateInvocation(input) {
  input = input || {};
  const errors = [];
  if (!CHALLENGE.test(str(input.challenge))) errors.push('challenge-invalid');
  if (!outputInsideRuntimeNamespace(str(input.outputPath))) errors.push('output-path-invalid');
  if (!SHA40.test(lower(input.candidateCommit))) errors.push('candidate-invalid');
  if (!SHA40.test(lower(input.candidateTree))) errors.push('tree-invalid');
  const artifact = input.artifact || {};
  // win32 semantics on purpose: the artifact descriptor names a path on the INSTALLED Windows
  // machine (C:\Program Files\…), and this validator must reach the same verdict on any host
  // (host path.isAbsolute rejected drive paths on the linux CI gate, v0.6.3 train run 3).
  if (!path.win32.isAbsolute(str(artifact.path)) || !SHA256.test(lower(artifact.sha256)) ||
      !Number.isSafeInteger(Number(artifact.size)) || Number(artifact.size) <= 0) errors.push('artifact-invalid');
  const probe = input.probe || {};
  if (str(probe.path).replace(/\\/g, '/') !== PROBE_RELATIVE_PATH ||
      !SHA256.test(lower(probe.expectedSha256)) || !SHA256.test(lower(probe.actualSha256)) ||
      lower(probe.expectedSha256) !== lower(probe.actualSha256)) errors.push('probe-hash-invalid');
  if (!Number.isInteger(Number(input.cdpPort)) || Number(input.cdpPort) < 1 || Number(input.cdpPort) > 65535) errors.push('cdp-port-invalid');
  return { ok: errors.length === 0, errors };
}

function loopbackApiPort(value) {
  try {
    const u = new URL(str(value));
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
        u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== '/')) return 0;
    const port = Number(u.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
  } catch (_) { return 0; }
}

export function validateInstalledObservation(observed, expected, options = {}) {
  observed = observed || {}; expected = expected || {};
  const errors = [];
  const shell = observed.shell || {};
  const version = observed.version || {};
  const artifact = expected.artifact || {};
  const apiPort = loopbackApiPort(observed.apiBase);
  if (!TAURI_ORIGINS.has(str(observed.origin)) || observed.mode !== 'desktop') errors.push('not-installed-desktop');
  if (lower(shell.sha || shell.fullCommit) !== lower(expected.candidateCommit)) errors.push('build-commit-mismatch');
  if (lower(shell.sourceTree) !== lower(expected.candidateTree)) errors.push('source-tree-mismatch');
  if (shell.dirty !== false || version.buildDirty !== false) errors.push('dirty-build');
  if (!ALLOWED_KINDS.has(lower(shell.provenanceKind))) errors.push('build-kind-invalid');
  if (lower(shell.executableSha256) !== lower(artifact.sha256) || Number(shell.executableSize) !== Number(artifact.size)) errors.push('executable-mismatch');
  if (lower(version.buildSha) !== lower(expected.candidateCommit)) errors.push('sidecar-commit-mismatch');
  if (!str(version.app).trim() || str(shell.version).trim() !== str(version.app).trim()) errors.push('version-mismatch');
  if (!str(shell.describe).trim() || str(shell.describe).trim() !== str(version.harness).trim()) errors.push('description-mismatch');
  if (!apiPort) errors.push('api-base-invalid');
  if (options.requireLink !== false && (!observed.link || observed.link.bridged !== true || observed.link.paused === true || observed.link.down === true)) errors.push('product-link-not-up');
  return { ok: errors.length === 0, errors, apiPort };
}

function eventAt(events, predicate, after = -1) {
  return events.find(item => Number(item && item.atMs) > after && predicate(item)) || null;
}

function endpointMatches(item, expectedPort) {
  if (!item || item.endpointPath !== '/api/channels/events') return false;
  try {
    const endpoint = new URL(str(item.endpointOrigin));
    return endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) &&
      Number(endpoint.port) === Number(expectedPort) && !endpoint.username && !endpoint.password &&
      !endpoint.search && !endpoint.hash && endpoint.pathname === '/';
  } catch (_) { return false; }
}

export function validateObservedTimeline(live, expected) {
  live = live || {}; expected = expected || {};
  const errors = [];
  const events = Array.isArray(live.observations) ? live.observations : [];
  const sessionId = str(live.sessionId);
  const wallElapsedMs = Number(expected.wallElapsedMs);
  if (!SAFE_SESSION.test(sessionId)) errors.push('session-invalid');
  let previous = -1;
  for (const item of events) {
    const at = Number(item && item.atMs);
    if (!item || str(item.sessionId) !== sessionId || !Number.isFinite(at) || at < previous || at < 0 || at > wallElapsedMs + 1000) {
      errors.push('timeline-invalid'); break;
    }
    previous = at;
  }
  if (!Number.isFinite(wallElapsedMs) || wallElapsedMs <= MIN_HEALTHY_SPAN_MS) errors.push('wall-time-insufficient');
  const firstUp = eventAt(events, item => item.kind === 'link-state' && item.state === 'UP' && item.recovered !== true);
  const data = events.filter(item => item && item.kind === 'transport-data' && item.source === 'message' &&
    item.cdpObserved === true && endpointMatches(item, expected.apiPort));
  const lastData = data[data.length - 1] || null;
  const continuousUp = lastData && eventAt(events, item => item.kind === 'link-state' && item.state === 'UP' && item.continuous === true,
    Number(lastData.atMs));
  if (!firstUp || data.length < 2 || !lastData || Number(lastData.atMs) - Number(data[0].atMs) <= MIN_HEALTHY_SPAN_MS || !continuousUp) errors.push('healthy-transport-unproven');
  const sidecar = lastData && eventAt(events, item => item.kind === 'sidecar-process' && Number.isInteger(Number(item.pid)) && Number(item.pid) > 0 &&
    item.parentVerified === true && item.bundledNodeVerified === true && item.apiListenerVerified === true &&
    SHA256.test(lower(item.instanceSha256)) && lower(item.candidateCommit) === lower(expected.candidateCommit), Number(lastData.atMs));
  const exited = sidecar && eventAt(events, item => item.kind === 'sidecar-exit' && item.observed === true && Number(item.pid) === Number(sidecar.pid), Number(sidecar.atMs));
  const networkError = sidecar && eventAt(events, item => item.kind === 'transport-error' && item.source === 'cdp-network-loading-failed' &&
    item.requestBound === true && endpointMatches(item, expected.apiPort), Number(sidecar.atMs));
  const lossObservedAt = exited && networkError ? Math.max(Number(exited.atMs), Number(networkError.atMs)) : Infinity;
  const down = Number.isFinite(lossObservedAt) && eventAt(events, item => item.kind === 'link-state' && item.state === 'DOWN' &&
    item.cause === 'eventsource-error', lossObservedAt);
  if (!sidecar) errors.push('sidecar-identity-unproven');
  if (!exited) errors.push('sidecar-exit-unproven');
  if (!networkError) errors.push('eventsource-error-unproven');
  if (!down) errors.push('link-down-unproven');
  const recovered = down && eventAt(events, item => item.kind === 'sidecar-recovery' && Number.isInteger(Number(item.pid)) && Number(item.pid) > 0 &&
    Number(item.pid) !== Number(sidecar && sidecar.pid) && item.parentVerified === true && item.bundledNodeVerified === true &&
    item.apiListenerVerified === true && item.versionVerified === true && item.watchdog === true &&
    SHA256.test(lower(item.instanceSha256)) && lower(item.instanceSha256) !== lower(sidecar && sidecar.instanceSha256) &&
    lower(item.candidateCommit) === lower(expected.candidateCommit), Number(down.atMs));
  const recoveryData = recovered && eventAt(events, item => item.kind === 'recovery-transport-data' && item.source === 'message' &&
    item.cdpObserved === true && item.requestBound === true && item.nativeReconnect === true &&
    endpointMatches(item, expected.apiPort), Number(recovered.atMs));
  const recoveredUp = recoveryData && eventAt(events, item => item.kind === 'link-state' && item.state === 'UP' &&
    item.recovered === true, Number(recoveryData.atMs));
  if (!recovered || !recoveryData || !recoveredUp) errors.push('watchdog-recovery-unproven');
  if (containsSecretMaterial(JSON.stringify(live))) errors.push('secret-bearing-observation');
  return { ok: errors.length === 0, errors };
}

function publicArtifact(artifact) {
  return { sha256: lower(artifact && artifact.sha256), size: Number(artifact && artifact.size) };
}

export function buildObservationDocument(live, invocation, times) {
  return {
    schemaVersion: LINK_RECEIPT_SCHEMA,
    producer: OBSERVATION_PRODUCER,
    challenge: invocation.challenge,
    candidateCommit: lower(invocation.candidateCommit),
    candidateTree: lower(invocation.candidateTree),
    artifact: publicArtifact(invocation.artifact),
    mode: 'desktop',
    origin: str(live.origin),
    cdpPort: Number(invocation.cdpPort),
    sessionId: str(live.sessionId),
    startedIso: new Date(times.startedAt).toISOString(),
    endedIso: new Date(times.endedAt).toISOString(),
    elapsedMs: Number(times.endedAt) - Number(times.startedAt),
    observations: live.observations
  };
}

export function buildReceipt(invocation, live, evidence, stampIso) {
  return {
    schemaVersion: LINK_RECEIPT_SCHEMA,
    producer: LINK_PRODUCER,
    stampIso,
    challenge: invocation.challenge,
    probe: { path: PROBE_RELATIVE_PATH, sha256: lower(invocation.probe.actualSha256) },
    candidateCommit: lower(invocation.candidateCommit),
    candidateTree: lower(invocation.candidateTree),
    artifact: publicArtifact(invocation.artifact),
    mode: 'desktop',
    origin: str(live.origin),
    cdpPort: Number(invocation.cdpPort),
    evidence: [evidence]
  };
}

export function makeInstalledLinkTransportProbe(options = {}) {
  const invocation = options.invocation || {};
  const driver = options.driver || {};
  const io = options.io || {};
  const now = options.clock && typeof options.clock.now === 'function' ? options.clock.now : () => Date.now();
  return {
    async run() {
      const invocationVerdict = validateInvocation(invocation);
      if (!invocationVerdict.ok) return { ok: false, code: invocationVerdict.errors[0], errors: invocationVerdict.errors };
      if (typeof driver.run !== 'function' || typeof io.writeEvidence !== 'function' || typeof io.writeReceipt !== 'function') {
        return { ok: false, code: 'probe-dependency-missing', errors: ['probe-dependency-missing'] };
      }
      const startedAt = now();
      let live;
      try { live = await driver.run(invocation, { now, startedAt }); }
      catch (error) { return { ok: false, code: str(error && error.code) || 'live-probe-failed', errors: [str(error && error.code) || 'live-probe-failed'] }; }
      live = live || {};
      const endedAt = now();
      const identity = validateInstalledObservation(live && live.identity, invocation);
      if (!identity.ok) return { ok: false, code: identity.errors[0], errors: identity.errors };
      live.origin = live.identity.origin;
      const timeline = validateObservedTimeline(live, {
        candidateCommit: invocation.candidateCommit, apiPort: identity.apiPort, wallElapsedMs: endedAt - startedAt
      });
      if (!timeline.ok) return { ok: false, code: timeline.errors[0], errors: timeline.errors };
      const document = buildObservationDocument(live, invocation, { startedAt, endedAt });
      const documentText = JSON.stringify(document);
      if (containsSecretMaterial(documentText)) return { ok: false, code: 'secret-bearing-observation', errors: ['secret-bearing-observation'] };
      let evidence;
      try { evidence = await io.writeEvidence(document); }
      catch (_) { return { ok: false, code: 'evidence-write-failed', errors: ['evidence-write-failed'] }; }
      if (!evidence || !SHA256.test(lower(evidence.sha256)) || !Number.isSafeInteger(Number(evidence.size)) || Number(evidence.size) <= 0) {
        return { ok: false, code: 'evidence-write-unverified', errors: ['evidence-write-unverified'] };
      }
      const receipt = buildReceipt(invocation, live, evidence, new Date(endedAt).toISOString());
      if (containsSecretMaterial(JSON.stringify(receipt))) return { ok: false, code: 'secret-bearing-receipt', errors: ['secret-bearing-receipt'] };
      try { await io.writeReceipt(receipt); }
      catch (_) { return { ok: false, code: 'receipt-write-failed', errors: ['receipt-write-failed'] }; }
      return { ok: true, receipt, evidence, document };
    }
  };
}

function trustedOrigin(url) {
  const value = str(url);
  for (const origin of TAURI_ORIGINS) {
    if (value === origin || value.startsWith(origin + '/') || value.startsWith(origin + '?') || value.startsWith(origin + '#')) return origin;
  }
  return '';
}

function trustedWebSocket(url, port) {
  try {
    const parsed = new URL(str(url));
    return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && Number(parsed.port) === Number(port);
  } catch (_) { return false; }
}

async function connectTrustedTarget(port) {
  let targets;
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/json/list', { cache: 'no-store' });
    if (!response.ok) throw new Error('cdp-list-http');
    targets = await response.json();
  } catch (_) { throw Object.assign(new Error('trusted-cdp-unavailable'), { code: 'trusted-cdp-unavailable' }); }
  const pages = Array.isArray(targets) ? targets.filter(target => target && target.type === 'page' && trustedOrigin(target.url)) : [];
  if (pages.length !== 1 || !trustedWebSocket(pages[0].webSocketDebuggerUrl, port)) {
    throw Object.assign(new Error('trusted-tauri-target-ambiguous'), { code: 'trusted-tauri-target-ambiguous' });
  }
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('trusted-cdp-timeout'), { code: 'trusted-cdp-timeout' })), 10000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(Object.assign(new Error('trusted-cdp-error'), { code: 'trusted-cdp-error' })); }, { once: true });
  });
  return new CDP(ws);
}

const IDENTITY_EXPRESSION = `(async () => {
  const origin = String((location && location.origin) || '');
  const out = { origin, mode: '', shell: null, version: null, apiBase: '', link: null };
  const allowed = new Set(['tauri://localhost','http://tauri.localhost','https://tauri.localhost','app://localhost']);
  out.mode = allowed.has(origin) ? 'desktop' : 'browser';
  out.apiBase = String(window.__STARNET_API__ || '');
  try {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (core && typeof core.invoke === 'function') out.shell = await core.invoke('starnet_build_info');
  } catch (_) {}
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    if (response.ok) out.version = await response.json();
  } catch (_) {}
  try { out.link = (typeof World !== 'undefined' && World.linkState) ? World.linkState() : null; } catch (_) {}
  return out;
})()`;

async function readIdentity(cdp) {
  return evalJS(cdp, IDENTITY_EXPRESSION);
}

async function readLink(cdp) {
  return evalJS(cdp, `(() => {
    try { return (typeof World !== 'undefined' && World.linkState) ? World.linkState() : null; }
    catch (_) { return null; }
  })()`);
}

async function cycleProductBridge(cdp) {
  const result = await evalJS(cdp, `(() => {
    if (typeof World === 'undefined' || !World.linkState || !World.pauseBridge || !World.resumeBridge) return { ok:false, code:'world-bridge-unavailable' };
    const before = World.linkState();
    if (!before || before.bridged !== true) return { ok:false, code:'world-bridge-not-entered' };
    World.pauseBridge();
    World.resumeBridge();
    return { ok:true };
  })()`);
  if (!result || result.ok !== true) throw Object.assign(new Error('world-bridge-not-entered'), { code: str(result && result.code) || 'world-bridge-not-entered' });
}

const PROCESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$mode = [string]$env:STARNET_QA_PROCESS_MODE
$artifact = [IO.Path]::GetFullPath([string]$env:STARNET_QA_ARTIFACT_PATH)
$port = [int]$env:STARNET_QA_API_PORT
$expectedPid = [int]$env:STARNET_QA_EXPECTED_PID
$expectedCreatedTicks = [string]$env:STARNET_QA_EXPECTED_CREATED_TICKS
$all = @(Get-CimInstance Win32_Process)
$desktop = @($all | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath([string]$_.ExecutablePath) -ieq $artifact) })
if ($desktop.Count -ne 1) { @{ok=$false;code='desktop-process-count'} | ConvertTo-Json -Compress; exit 0 }
$root = [IO.Path]::GetDirectoryName($artifact).TrimEnd('\') + '\'
$children = @($all | Where-Object {
  [int]$_.ParentProcessId -eq [int]$desktop[0].ProcessId -and $_.ExecutablePath -and
  ([string]$_.ExecutablePath).StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and
  ([IO.Path]::GetFileName([string]$_.ExecutablePath) -ieq 'node.exe') -and
  ([string]$_.CommandLine -match '(?i)(?:\\|/)sidecar(?:\\|/)index[.]js(?:["''\s]|$)')
})
if ($mode -eq 'exited') {
  $alive = @($all | Where-Object { [int]$_.ProcessId -eq $expectedPid })
  if ($alive.Count -eq 0) { @{ok=$true;code='exited'} | ConvertTo-Json -Compress; exit 0 }
  try {
    $aliveProcess = [Diagnostics.Process]::GetProcessById($expectedPid)
    $null = $aliveProcess.Handle
    $aliveCreatedTicks = $aliveProcess.StartTime.ToUniversalTime().Ticks.ToString()
    $sameInstance = ($expectedCreatedTicks -and $aliveCreatedTicks -eq $expectedCreatedTicks)
    @{ok=(-not $sameInstance);code=$(if($sameInstance){'process-instance-still-alive'}else{'exited-pid-reused'})} | ConvertTo-Json -Compress; exit 0
  } catch { @{ok=$true;code='exited'} | ConvertTo-Json -Compress; exit 0 }
}
if ($children.Count -ne 1) { @{ok=$false;code='sidecar-process-count'} | ConvertTo-Json -Compress; exit 0 }
$child = $children[0]
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port | Where-Object {
  [int]$_.OwningProcess -eq [int]$child.ProcessId -and ([string]$_.LocalAddress -in @('127.0.0.1','::1'))
})
if ($listeners.Count -lt 1) { @{ok=$false;code='sidecar-listener-mismatch'} | ConvertTo-Json -Compress; exit 0 }
if ($expectedPid -gt 0 -and [int]$child.ProcessId -ne $expectedPid) { @{ok=$false;code='sidecar-pid-mismatch'} | ConvertTo-Json -Compress; exit 0 }
$childProcess = [Diagnostics.Process]::GetProcessById([int]$child.ProcessId)
$null = $childProcess.Handle
$createdTicks = $childProcess.StartTime.ToUniversalTime().Ticks.ToString()
if ($expectedCreatedTicks -and $createdTicks -ne $expectedCreatedTicks) { @{ok=$false;code='sidecar-process-instance-mismatch'} | ConvertTo-Json -Compress; exit 0 }
if ($mode -eq 'terminate') {
  if (-not $expectedCreatedTicks) { @{ok=$false;code='sidecar-process-instance-missing'} | ConvertTo-Json -Compress; exit 0 }
  $childProcess.Kill()
}
@{ok=$true;desktopPid=[int]$desktop[0].ProcessId;pid=[int]$child.ProcessId;createdTicks=$createdTicks} | ConvertTo-Json -Compress
`;

function powershellExe() {
  const root = str(process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows');
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function processCommand(mode, artifact, port, expectedPid = 0, expectedCreatedTicks = '') {
  const childEnv = {};
  for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PSModulePath', 'ComSpec', 'COMSPEC']) {
    if (Object.prototype.hasOwnProperty.call(process.env, name)) childEnv[name] = process.env[name];
  }
  Object.assign(childEnv, {
    STARNET_QA_PROCESS_MODE: str(mode),
    STARNET_QA_ARTIFACT_PATH: path.resolve(artifact),
    STARNET_QA_API_PORT: String(port),
    STARNET_QA_EXPECTED_PID: String(expectedPid),
    STARNET_QA_EXPECTED_CREATED_TICKS: str(expectedCreatedTicks)
  });
  const result = spawnSync(powershellExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROCESS_SCRIPT], {
    cwd: ROOT, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024
  });
  if (result.error || result.status !== 0) return { ok: false, code: 'process-seam-unavailable' };
  try {
    const parsed = JSON.parse(str(result.stdout).trim());
    return parsed && typeof parsed === 'object' ? parsed : { ok: false, code: 'process-seam-invalid' };
  } catch (_) { return { ok: false, code: 'process-seam-invalid' }; }
}

// Read-only export used by the focused test to prove the Windows/CIM script parses and
// returns a bounded classification. Termination remains private to the live driver.
export function inspectWindowsSidecarProcess(artifact, port) {
  if (process.platform !== 'win32') return { ok: false, code: 'windows-process-proof-required' };
  return processCommand('find', artifact, port, 0);
}

const processApi = {
  find(artifact, port) { return processCommand('find', artifact, port, 0); },
  terminate(artifact, port, pid, createdTicks) { return processCommand('terminate', artifact, port, pid, createdTicks); },
  exited(artifact, port, pid, createdTicks) { return processCommand('exited', artifact, port, pid, createdTicks); }
};

async function waitUntil(check, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    try { value = await check(); } catch (_) { value = null; }
    if (value) return value;
    await sleep(intervalMs);
  }
  return null;
}

// Pure CDP event fold. Native EventSource retries can race the OS/watchdog polls, so every
// exact non-active request is retained without its token-bearing URL. Once the UI's real DOWN
// observation supplies a boundary, only a candidate with a successful response and browser-
// visible empty data frame after that boundary can become recovery authority.
export function makeNetworkObservationTracker(options = {}) {
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  let apiPort = 0;
  let phase = 'healthy';
  let endpointOrigin = '';
  let activeRequestId = '';
  let healthyGeneration = 0;
  let recoveryRequestId = '';
  let recoveryResponseAfter = Infinity;
  let recoveryDataAfter = Infinity;
  let networkFailedAt = null;
  let recoveryFrameAt = null;
  const records = new Map();
  function chooseRecovery() {
    let winner = null;
    for (const record of records.values()) {
      if (record.id === activeRequestId || record.requestedPhase === 'healthy' ||
          !Number.isFinite(record.requestedAt) || !Number.isFinite(record.responseAt) ||
          !Number.isFinite(record.messageAt) || record.responseAt < record.requestedAt ||
          record.messageAt < record.responseAt || record.responseAt <= recoveryResponseAfter ||
          record.messageAt <= recoveryDataAfter) continue;
      if (!winner || record.messageAt < winner.messageAt) winner = record;
    }
    recoveryRequestId = winner ? winner.id : '';
    recoveryFrameAt = winner ? winner.messageAt : null;
  }
  function request(params) {
    try {
      const u = new URL(str(params && params.request && params.request.url));
      if (!apiPort || u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
          Number(u.port) !== apiPort || u.pathname !== '/api/channels/events' || params.type !== 'EventSource') return false;
      const id = str(params.requestId);
      if (!id) return false;
      records.set(id, { id, requestedAt: Number(now()), requestedPhase: phase, responseAt: null, messageAt: null, frames: [] });
      endpointOrigin = u.origin; // URL query/header bytes are intentionally discarded here.
      if (phase === 'healthy') { activeRequestId = id; healthyGeneration++; }
      return true;
    } catch (_) { return false; }
  }
  function response(params) {
    const id = str(params && params.requestId);
    const record = records.get(id);
    if (!record || params.type !== 'EventSource' || Number(params.response && params.response.status) !== 200) return false;
    if (Number.isFinite(record.responseAt)) return false;
    const stamp = Number(now());
    if (!Number.isFinite(stamp) || stamp < record.requestedAt) return false;
    record.responseAt = stamp;
    if (phase === 'recovery') chooseRecovery();
    return true;
  }
  function message(params) {
    const id = str(params && params.requestId);
    const record = records.get(id);
    if (!record || str(params && params.data).trim() !== '{}') return false;
    const stamp = Number(now());
    if (!Number.isFinite(record.responseAt) || stamp < record.responseAt) return false;
    if (phase === 'healthy' && id === activeRequestId) record.frames.push(stamp);
    else if (id !== activeRequestId) { record.messageAt = stamp; if (phase === 'recovery') chooseRecovery(); }
    else return false;
    return true;
  }
  function failed(params) {
    const id = str(params && params.requestId);
    if (phase !== 'loss' || !id || id !== activeRequestId) return false;
    networkFailedAt = Number(now()); return true;
  }
  return {
    setApiPort(value) { apiPort = Number(value) || 0; },
    setPhase(value) { phase = str(value); },
    beginRecovery(downAt, sidecarRecoveredAt = downAt) {
      phase = 'recovery'; recoveryResponseAfter = Number(downAt); recoveryDataAfter = Number(sidecarRecoveredAt);
      recoveryRequestId = ''; recoveryFrameAt = null;
      chooseRecovery();
    },
    request, response, message, failed,
    snapshot() {
      return {
        phase, endpointOrigin, activeRequestId, recoveryRequestId, networkFailedAt, recoveryFrameAt,
        healthyGeneration, healthyFrames: (records.get(activeRequestId)?.frames || []).slice(),
        activeResponseOk: Number.isFinite(records.get(activeRequestId)?.responseAt),
        recoveryResponseOk: Number.isFinite(records.get(recoveryRequestId)?.responseAt)
      };
    }
  };
}

function makeLiveDriver(deps = {}) {
  const processes = deps.processes || processApi;
  const connect = deps.connect || connectTrustedTarget;
  return {
    async run(invocation, context = {}) {
      if (process.platform !== 'win32' && !deps.allowNonWindows) throw Object.assign(new Error('windows-process-proof-required'), { code: 'windows-process-proof-required' });
      const cdp = await connect(Number(invocation.cdpPort));
      const started = Number.isFinite(Number(context.startedAt)) ? Number(context.startedAt) : Date.now();
      const sessionId = 'link-session-' + crypto.randomBytes(16).toString('hex');
      const observations = [];
      const at = () => Date.now() - started;
      const push = item => {
        const event = Object.assign({ atMs: at(), sessionId }, item);
        observations.push(event); return event;
      };
      let apiPort = 0;
      const tracker = makeNetworkObservationTracker({ now: at });
      cdp.on('Network.requestWillBeSent', params => tracker.request(params));
      cdp.on('Network.responseReceived', params => tracker.response(params));
      cdp.on('Network.eventSourceMessageReceived', params => tracker.message(params));
      cdp.on('Network.loadingFailed', params => tracker.failed(params));
      try {
        await cdp.send('Network.enable');
        const before = await readIdentity(cdp);
        const identityVerdict = validateInstalledObservation(before, invocation);
        if (!identityVerdict.ok) throw Object.assign(new Error(identityVerdict.errors[0]), { code: identityVerdict.errors[0] });
        apiPort = identityVerdict.apiPort;
        tracker.setApiPort(apiPort);
        await cycleProductBridge(cdp);
        const healthyOpen = await waitUntil(async () => {
          const network = tracker.snapshot();
          const link = await readLink(cdp);
          return network.activeRequestId && network.activeResponseOk && link && link.bridged === true && link.paused === false && link.down === false ? link : null;
        }, 15000);
        if (!healthyOpen) throw Object.assign(new Error('product-eventsource-not-open'), { code: 'product-eventsource-not-open' });
        push({ kind: 'link-state', state: 'UP' });
        const healthyGeneration = tracker.snapshot().healthyGeneration;
        let emitted = 0;
        const healthy = await waitUntil(async () => {
          const network = tracker.snapshot();
          let link = null;
          try { link = await readLink(cdp); } catch (_) {}
          if (network.healthyGeneration !== healthyGeneration || !link || link.bridged !== true || link.paused === true || link.down === true) {
            return { lost: true };
          }
          while (emitted < network.healthyFrames.length) {
            observations.push({ atMs: network.healthyFrames[emitted], sessionId, kind: 'transport-data', source: 'message',
              cdpObserved: true, endpointOrigin: network.endpointOrigin, endpointPath: '/api/channels/events' });
            emitted++;
          }
          return network.healthyFrames.length >= 2 && network.healthyFrames[network.healthyFrames.length - 1] - network.healthyFrames[0] > MIN_HEALTHY_SPAN_MS
            ? { done: true } : null;
        }, 90000, 100);
        if (!healthy) throw Object.assign(new Error('healthy-transport-timeout'), { code: 'healthy-transport-timeout' });
        if (healthy.lost) throw Object.assign(new Error('healthy-product-link-interrupted'), { code: 'healthy-product-link-interrupted' });
        const healthyFinalLink = await readLink(cdp);
        if (!healthyFinalLink || healthyFinalLink.bridged !== true || healthyFinalLink.paused === true || healthyFinalLink.down === true ||
            tracker.snapshot().healthyGeneration !== healthyGeneration) {
          throw Object.assign(new Error('healthy-product-link-not-up'), { code: 'healthy-product-link-not-up' });
        }
        push({ kind: 'link-state', state: 'UP', continuous: true });
        const sidecar = processes.find(invocation.artifact.path, apiPort);
        const sidecarInstanceSha = processInstanceSha(sidecar);
        if (!sidecar || sidecar.ok !== true || !sidecarInstanceSha) {
          throw Object.assign(new Error('sidecar-identity-unproven'), { code: 'sidecar-identity-unproven' });
        }
        push({ kind: 'sidecar-process', pid: Number(sidecar.pid), candidateCommit: lower(invocation.candidateCommit),
          instanceSha256: sidecarInstanceSha, parentVerified: true, bundledNodeVerified: true, apiListenerVerified: true });
        tracker.setPhase('loss');
        const killed = processes.terminate(invocation.artifact.path, apiPort, Number(sidecar.pid), sidecar.createdTicks);
        if (!killed || killed.ok !== true || Number(killed.pid) !== Number(sidecar.pid) || str(killed.createdTicks) !== str(sidecar.createdTicks)) {
          throw Object.assign(new Error('sidecar-termination-refused'), { code: 'sidecar-termination-refused' });
        }
        let exitedAt = null;
        const exited = await waitUntil(() => {
          const result = processes.exited(invocation.artifact.path, apiPort, Number(sidecar.pid), sidecar.createdTicks);
          if (result && result.ok === true) { exitedAt = at(); return result; }
          return null;
        }, 10000);
        if (!exited) throw Object.assign(new Error('sidecar-exit-unobserved'), { code: 'sidecar-exit-unobserved' });
        const failed = await waitUntil(() => Number.isFinite(tracker.snapshot().networkFailedAt), 10000);
        if (!failed) throw Object.assign(new Error('eventsource-error-unobserved'), { code: 'eventsource-error-unobserved' });
        const lossNetwork = tracker.snapshot();
        const lossEvents = [
          { atMs: exitedAt, sessionId, kind: 'sidecar-exit', pid: Number(sidecar.pid), observed: true },
          { atMs: lossNetwork.networkFailedAt, sessionId, kind: 'transport-error', source: 'cdp-network-loading-failed', requestBound: true,
            endpointOrigin: lossNetwork.endpointOrigin, endpointPath: '/api/channels/events' }
        ].sort((a, b) => a.atMs - b.atMs);
        observations.push(...lossEvents);
        const down = await waitUntil(async () => {
          const link = await readLink(cdp);
          return link && link.bridged === true && link.paused === false && link.down === true ? link : null;
        }, 5000, 25);
        if (!down) throw Object.assign(new Error('product-link-down-unobserved'), { code: 'product-link-down-unobserved' });
        const downEvent = push({ kind: 'link-state', state: 'DOWN', cause: 'eventsource-error' });
        tracker.setPhase('recovery-wait');
        const recovered = await waitUntil(() => {
          const value = processes.find(invocation.artifact.path, apiPort);
          return value && value.ok === true && processInstanceSha(value) && Number(value.pid) !== Number(sidecar.pid) ? value : null;
        }, 20000, 250);
        if (!recovered) throw Object.assign(new Error('watchdog-sidecar-unrecovered'), { code: 'watchdog-sidecar-unrecovered' });
        const recoveredRuntime = await waitUntil(async () => {
          const value = await readIdentity(cdp);
          const verdict = validateInstalledObservation(value, invocation, { requireLink: false });
          return verdict.ok ? value : null;
        }, 20000, 250);
        if (!recoveredRuntime) throw Object.assign(new Error('watchdog-version-unrecovered'), { code: 'watchdog-version-unrecovered' });
        const recoveredAfterVersion = processes.find(invocation.artifact.path, apiPort);
        if (!recoveredAfterVersion || recoveredAfterVersion.ok !== true || Number(recoveredAfterVersion.pid) !== Number(recovered.pid) ||
            str(recoveredAfterVersion.createdTicks) !== str(recovered.createdTicks)) {
          throw Object.assign(new Error('watchdog-version-pid-changed'), { code: 'watchdog-version-pid-changed' });
        }
        const recoveredAt = at();
        tracker.beginRecovery(downEvent.atMs, recoveredAt);
        const recoveredLink = await waitUntil(async () => {
          const network = tracker.snapshot();
          const link = await readLink(cdp);
          return network.recoveryRequestId && network.recoveryResponseOk && Number.isFinite(network.recoveryFrameAt) &&
            link && link.bridged === true && link.paused === false && link.down === false ? link : null;
        }, 35000, 100);
        if (!recoveredLink) throw Object.assign(new Error('watchdog-link-unrecovered'), { code: 'watchdog-link-unrecovered' });
        const recoveryNetwork = tracker.snapshot();
        const recoveredIdentity = await readIdentity(cdp);
        const recoveredIdentityVerdict = validateInstalledObservation(recoveredIdentity, invocation);
        if (!recoveredIdentityVerdict.ok) throw Object.assign(new Error('watchdog-final-identity-invalid'), { code: 'watchdog-final-identity-invalid' });
        const recoveredFinalProcess = processes.find(invocation.artifact.path, apiPort);
        if (!recoveredFinalProcess || recoveredFinalProcess.ok !== true || Number(recoveredFinalProcess.pid) !== Number(recovered.pid) ||
            str(recoveredFinalProcess.createdTicks) !== str(recovered.createdTicks)) {
          throw Object.assign(new Error('watchdog-final-pid-changed'), { code: 'watchdog-final-pid-changed' });
        }
        const recoveredInstanceSha = processInstanceSha(recoveredFinalProcess);
        if (!recoveredInstanceSha || recoveredInstanceSha === sidecarInstanceSha) {
          throw Object.assign(new Error('watchdog-process-instance-invalid'), { code: 'watchdog-process-instance-invalid' });
        }
        const artifactAfter = fileIdentity(invocation.artifact.path);
        if (!artifactAfter || artifactAfter.sha256 !== lower(invocation.artifact.sha256) || artifactAfter.size !== Number(invocation.artifact.size)) {
          throw Object.assign(new Error('artifact-changed-during-proof'), { code: 'artifact-changed-during-proof' });
        }
        const recoveryEvents = [
          { atMs: recoveredAt, sessionId, kind: 'sidecar-recovery', pid: Number(recovered.pid), previousPid: Number(sidecar.pid),
            candidateCommit: lower(invocation.candidateCommit), parentVerified: true, bundledNodeVerified: true,
            apiListenerVerified: true, versionVerified: true, watchdog: true, instanceSha256: recoveredInstanceSha },
          { atMs: recoveryNetwork.recoveryFrameAt, sessionId, kind: 'recovery-transport-data', source: 'message',
            cdpObserved: true, requestBound: true, nativeReconnect: true,
            endpointOrigin: recoveryNetwork.endpointOrigin, endpointPath: '/api/channels/events' }
        ].sort((a, b) => a.atMs - b.atMs);
        observations.push(...recoveryEvents);
        push({ kind: 'link-state', state: 'UP', recovered: true });
        return { identity: recoveredIdentity, origin: recoveredIdentity.origin, sessionId, observations };
      } finally {
        try { cdp.ws.close(); } catch (_) {}
      }
    }
  };
}

function relativeEvidencePath(file) {
  const relative = path.relative(ROOT, path.resolve(file)).replace(/\\/g, '/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('evidence-path-invalid');
  return relative;
}

function atomicWriteJson(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) throw new Error('refuse-overwrite');
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  if (containsSecretMaterial(bytes.toString('utf8'))) throw new Error('secret-bearing-output');
  const temp = target + '.tmp-' + process.pid + '-' + crypto.randomBytes(8).toString('hex');
  let handle;
  try {
    handle = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    fs.closeSync(handle); handle = null;
    fs.renameSync(temp, target);
  } finally {
    if (handle != null) { try { fs.closeSync(handle); } catch (_) {} }
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
  }
  const proof = fileIdentity(target);
  if (!proof || proof.sha256 !== sha256(bytes) || proof.size !== bytes.length) throw new Error('write-readback-failed');
  return { path: relativeEvidencePath(target), sha256: proof.sha256, size: proof.size };
}

function ambientInvocation(env = process.env) {
  const artifactInput = str(env.STARNET_FIRST_RUN_ARTIFACT);
  const artifact = path.isAbsolute(artifactInput) ? fileIdentity(artifactInput) : null;
  const self = fileIdentity(fileURLToPath(import.meta.url));
  return {
    challenge: str(env.STARNET_W1_LINK_CHALLENGE),
    outputPath: str(env.STARNET_W1_LINK_OUTPUT),
    candidateCommit: lower(env.STARNET_PRODUCT_PERFECT_CANDIDATE_SHA),
    candidateTree: lower(env.STARNET_PRODUCT_PERFECT_CANDIDATE_TREE),
    artifact,
    cdpPort: Number(env.STARNET_FIRST_RUN_CDP_PORT || env.STARNET_SMOKE_CDP_PORT),
    probe: { path: PROBE_RELATIVE_PATH, expectedSha256: lower(env.STARNET_W1_LINK_PROBE_SHA256), actualSha256: lower(self && self.sha256) }
  };
}

async function main() {
  const invocation = ambientInvocation();
  const evidencePath = invocation.outputPath && path.join(path.dirname(invocation.outputPath), 'link-observation.json');
  const io = {
    writeEvidence(document) { return atomicWriteJson(evidencePath, document); },
    writeReceipt(receipt) { atomicWriteJson(invocation.outputPath, receipt); }
  };
  const probe = makeInstalledLinkTransportProbe({ invocation, driver: makeLiveDriver(), io });
  const result = await probe.run();
  if (!result.ok) {
    console.error('[W1 BLOCKED] installed link transport proof unavailable: ' + str(result.code || 'unknown'));
    process.exit(2);
  }
  console.log('[W1 PASS] installed link transport proof captured');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error('[W1 BLOCKED] installed link transport proof unavailable: ' + (str(error && error.code) || 'unexpected'));
    process.exit(2);
  });
}
