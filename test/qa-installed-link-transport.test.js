/* node test/qa-installed-link-transport.test.js — deterministic W1 link companion authority. */
'use strict';

const A = require('./_assert.js');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  LINK_RECEIPT_SCHEMA, LINK_PRODUCER, OBSERVATION_PRODUCER, MIN_HEALTHY_SPAN_MS,
  PROBE_RELATIVE_PATH, containsSecretMaterial, validateInvocation,
  validateInstalledObservation, validateObservedTimeline, buildObservationDocument,
  buildReceipt, makeInstalledLinkTransportProbe, inspectWindowsSidecarProcess,
  makeNetworkObservationTracker
} = require('../scripts/qa/installed-link-transport.mjs');

const SHA = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const HASH = 'c'.repeat(64);
const PROBE_HASH = 'd'.repeat(64);
const CHALLENGE = 'w1-' + 'e'.repeat(64);
const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'qa', 'installed', 'smoke-unit-link', 'receipt.json');
const ARTIFACT = { path: 'C:\\Program Files\\StarNet\\skynet-desktop.exe', sha256: HASH, size: 456789 };
const ENDPOINT = { endpointOrigin: 'http://127.0.0.1:8787', endpointPath: '/api/channels/events' };
const INVOCATION = {
  challenge: CHALLENGE, outputPath: OUTPUT, candidateCommit: SHA, candidateTree: TREE,
  artifact: ARTIFACT, cdpPort: 9444,
  probe: { path: PROBE_RELATIVE_PATH, expectedSha256: PROBE_HASH, actualSha256: PROBE_HASH }
};
const IDENTITY = {
  origin: 'http://tauri.localhost', mode: 'desktop', apiBase: 'http://127.0.0.1:8787',
  shell: {
    sha: SHA, sourceTree: TREE, dirty: false, provenanceKind: 'reproducible-source',
    executableSha256: HASH, executableSize: ARTIFACT.size, version: '0.6.0', describe: 'v0.6.0-1-gaaaaaaaa'
  },
  version: { buildSha: SHA, buildDirty: false, app: '0.6.0', harness: 'v0.6.0-1-gaaaaaaaa' },
  link: { bridged: true, paused: false, down: false }
};

function live(overrides = {}) {
  const sessionId = 'link-session-' + '7'.repeat(24);
  const observations = [
    { atMs: 0, sessionId, kind: 'link-state', state: 'UP' },
    Object.assign({ atMs: 100, sessionId, kind: 'transport-data', source: 'message', cdpObserved: true }, ENDPOINT),
    Object.assign({ atMs: 45101, sessionId, kind: 'transport-data', source: 'message', cdpObserved: true }, ENDPOINT),
    { atMs: 45500, sessionId, kind: 'link-state', state: 'UP', continuous: true },
    { atMs: 46000, sessionId, kind: 'sidecar-process', pid: 1234, candidateCommit: SHA, instanceSha256: '1'.repeat(64),
      parentVerified: true, bundledNodeVerified: true, apiListenerVerified: true },
    { atMs: 46100, sessionId, kind: 'sidecar-exit', pid: 1234, observed: true },
    Object.assign({ atMs: 46200, sessionId, kind: 'transport-error', source: 'cdp-network-loading-failed', requestBound: true }, ENDPOINT),
    { atMs: 46300, sessionId, kind: 'link-state', state: 'DOWN', cause: 'eventsource-error' },
    { atMs: 47000, sessionId, kind: 'sidecar-recovery', pid: 5678, previousPid: 1234, candidateCommit: SHA,
      parentVerified: true, bundledNodeVerified: true, apiListenerVerified: true, versionVerified: true, watchdog: true, instanceSha256: '2'.repeat(64) },
    Object.assign({ atMs: 47100, sessionId, kind: 'recovery-transport-data', source: 'message', cdpObserved: true, requestBound: true, nativeReconnect: true }, ENDPOINT),
    { atMs: 47200, sessionId, kind: 'link-state', state: 'UP', recovered: true }
  ];
  return Object.assign({ identity: IDENTITY, origin: IDENTITY.origin, sessionId, observations }, overrides);
}

function verdict(value, wallElapsedMs = 50000) {
  return validateObservedTimeline(value, { candidateCommit: SHA, apiPort: 8787, wallElapsedMs });
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function memoryIo(opts = {}) {
  const out = { evidence: [], receipts: [] };
  out.writeEvidence = async document => {
    if (opts.failEvidence) throw new Error('disk-full');
    const bytes = Buffer.from(JSON.stringify(document));
    const proof = { path: 'qa/installed/smoke-unit-link/link-observation.json', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
    out.evidence.push({ document, proof }); return proof;
  };
  out.writeReceipt = async receipt => {
    if (opts.failReceipt) throw new Error('disk-full');
    out.receipts.push(receipt);
  };
  return out;
}

function clock(start = 1000, end = 51000) {
  const values = [start, end];
  return { now: () => values.shift() };
}

(async () => {
  A.eq(LINK_RECEIPT_SCHEMA, 1, 'companion schema matches the challenged W1 validator');
  A.eq(LINK_PRODUCER, 'installed-link-transport-v2', 'receipt producer is exact');
  A.eq(OBSERVATION_PRODUCER, 'installed-link-observation-v1', 'raw evidence producer is exact');
  A.eq(MIN_HEALTHY_SPAN_MS, 40000, 'healthy transport must exceed forty real seconds');
  A.eq(validateInvocation(INVOCATION).ok, true, 'exact challenged invocation validates');

  A.ok(validateInvocation(Object.assign({}, INVOCATION, { challenge: 'old' })).errors.includes('challenge-invalid'), 'stale/hand-authored challenge is rejected');
  A.ok(validateInvocation(Object.assign({}, INVOCATION, { outputPath: path.join(ROOT, 'receipt.json') })).errors.includes('output-path-invalid'), 'gate output cannot escape qa/installed runtime namespace');
  A.ok(validateInvocation(Object.assign({}, INVOCATION, { candidateCommit: '' })).errors.includes('candidate-invalid'), 'ambient/missing candidate is rejected');
  A.ok(validateInvocation(Object.assign({}, INVOCATION, { candidateTree: 'f'.repeat(40) + 'x' })).errors.includes('tree-invalid'), 'malformed candidate tree is rejected');
  A.ok(validateInvocation(Object.assign({}, INVOCATION, { cdpPort: 0 })).errors.includes('cdp-port-invalid'), 'untrusted CDP port is rejected');
  A.ok(validateInvocation(Object.assign({}, INVOCATION, { probe: Object.assign({}, INVOCATION.probe, { expectedSha256: 'f'.repeat(64) }) })).errors.includes('probe-hash-invalid'), 'different candidate-owned probe bytes are rejected');
  A.ok(validateInvocation(Object.assign({}, INVOCATION, { artifact: Object.assign({}, ARTIFACT, { sha256: '' }) })).errors.includes('artifact-invalid'), 'artifact without exact bytes is rejected');

  A.eq(validateInstalledObservation(IDENTITY, INVOCATION).ok, true, 'exact Tauri commit/tree/executable/sidecar identity validates');
  A.ok(validateInstalledObservation(Object.assign({}, IDENTITY, { mode: 'browser' }), INVOCATION).errors.includes('not-installed-desktop'), 'browser target cannot satisfy installed proof');
  A.ok(validateInstalledObservation(Object.assign({}, IDENTITY, { shell: Object.assign({}, IDENTITY.shell, { sourceTree: 'f'.repeat(40) }) }), INVOCATION).errors.includes('source-tree-mismatch'), 'wrong source tree is rejected');
  A.ok(validateInstalledObservation(Object.assign({}, IDENTITY, { shell: Object.assign({}, IDENTITY.shell, { executableSha256: 'f'.repeat(64) }) }), INVOCATION).errors.includes('executable-mismatch'), 'wrong running executable hash is rejected');
  A.ok(validateInstalledObservation(Object.assign({}, IDENTITY, { version: Object.assign({}, IDENTITY.version, { buildSha: 'f'.repeat(40) }) }), INVOCATION).errors.includes('sidecar-commit-mismatch'), 'wrong sidecar build is rejected');
  A.ok(validateInstalledObservation(Object.assign({}, IDENTITY, { apiBase: 'http://example.com:8787' }), INVOCATION).errors.includes('api-base-invalid'), 'non-loopback API seam is rejected');
  A.ok(validateInstalledObservation(Object.assign({}, IDENTITY, { link: { bridged: true, paused: false, down: true } }), INVOCATION).errors.includes('product-link-not-up'), 'a preexisting DOWN state cannot seed green proof');
  A.eq(validateInstalledObservation(Object.assign({}, IDENTITY, { link: { bridged: true, paused: false, down: true } }), INVOCATION, { requireLink: false }).ok, true, 'watchdog version can be rechecked before the native bridge recovers');

  {
    let stamp = 0;
    const tracker = makeNetworkObservationTracker({ now: () => (stamp += 100) });
    tracker.setApiPort(8787);
    const request = (id) => ({ requestId: id, type: 'EventSource', request: { url: 'http://127.0.0.1:8787/api/channels/events?token=must-never-serialize' } });
    tracker.request(request('healthy'));
    tracker.response({ requestId: 'healthy', type: 'EventSource', response: { status: 200 } });
    tracker.message({ requestId: 'healthy', data: '{}' });
    tracker.setPhase('loss');
    tracker.request(request('too-early'));
    tracker.response({ requestId: 'too-early', type: 'EventSource', response: { status: 200 } });
    tracker.message({ requestId: 'too-early', data: '{}' });
    tracker.request(request('raced-before-down'));
    tracker.response({ requestId: 'raced-before-down', type: 'EventSource', response: { status: 200 } });
    tracker.failed({ requestId: 'healthy' });
    tracker.beginRecovery(750, 950);
    A.eq(tracker.snapshot().recoveryRequestId, '', 'a retry whose data arrived before DOWN cannot impersonate recovery');
    tracker.message({ requestId: 'raced-before-down', data: '{}' });
    const network = tracker.snapshot();
    A.eq(network.recoveryRequestId, 'raced-before-down', 'native request started during loss can prove recovery only after post-DOWN data');
    A.eq(network.recoveryResponseOk && Number.isFinite(network.recoveryFrameAt), true, 'native recovery requires response plus browser-visible post-DOWN data');
    A.eq(JSON.stringify(network).includes('must-never-serialize'), false, 'request query/token bytes are discarded by the pure CDP fold');
  }
  {
    let stamp = 0;
    const tracker = makeNetworkObservationTracker({ now: () => (stamp += 100) });
    tracker.setApiPort(8787);
    const request = id => ({ requestId: id, type: 'EventSource', request: { url: 'http://127.0.0.1:8787/api/channels/events?token=discarded' } });
    tracker.request(request('generation-a'));
    tracker.response({ requestId: 'generation-a', type: 'EventSource', response: { status: 200 } });
    tracker.message({ requestId: 'generation-a', data: '{}' });
    tracker.request(request('generation-b'));
    A.eq(tracker.message({ requestId: 'generation-b', data: '{}' }), false, 'frame before the matching HTTP-200 response is rejected');
    tracker.response({ requestId: 'generation-b', type: 'EventSource', response: { status: 200 } });
    tracker.message({ requestId: 'generation-b', data: '{}' });
    const network = tracker.snapshot();
    A.eq(network.healthyGeneration, 2, 'a healthy-phase reconnect creates a new exact request generation');
    A.eq(network.activeRequestId, 'generation-b', 'only the current EventSource request can own healthy proof');
    A.eq(network.healthyFrames.length, 1, 'frames from the prior request generation are never aggregated');
  }

  A.eq(verdict(live()).ok, true, 'real CDP frames, exact child exit, DOWN, and watchdog recovery validate');
  {
    const noContinuousUp = live(); noContinuousUp.observations.splice(3, 1);
    A.ok(verdict(noContinuousUp).errors.includes('healthy-transport-unproven'), 'healthy frames without a final continuously-UP product observation are rejected');
  }
  {
    const networkFirst = live(); networkFirst.observations[6].atMs = 46050;
    networkFirst.observations.sort((a, b) => a.atMs - b.atMs);
    A.eq(verdict(networkFirst).ok, true, 'actual CDP failure may precede OS exit polling while DOWN still follows both');
  }
  {
    const exactForty = live(); exactForty.observations[2].atMs = 40100;
    A.ok(verdict(exactForty).errors.includes('healthy-transport-unproven'), 'data frames spanning exactly forty seconds are insufficient');
  }
  A.ok(verdict({ identity: IDENTITY, origin: IDENTITY.origin, sessionId: 'handwritten', observations: [] }).errors.includes('healthy-transport-unproven'), 'hand-authored summary without raw observations cannot green');
  {
    const noCdp = live(); noCdp.observations[2].cdpObserved = false;
    A.ok(verdict(noCdp).errors.includes('healthy-transport-unproven'), 'page booleans without browser-visible CDP data cannot green');
  }
  {
    const tokenUrl = live(); tokenUrl.observations[1].endpointOrigin = 'http://127.0.0.1:8787?token=hidden';
    A.ok(verdict(tokenUrl).errors.includes('healthy-transport-unproven'), 'query-bearing endpoint evidence is rejected rather than persisted');
  }
  {
    const wrongPid = live(); wrongPid.observations[5].pid = 9999;
    A.ok(verdict(wrongPid).errors.includes('sidecar-exit-unproven'), 'an unrelated process exit cannot prove sidecar loss');
  }
  {
    const unboundPid = live(); unboundPid.observations[4].apiListenerVerified = false;
    A.ok(verdict(unboundPid).errors.includes('sidecar-identity-unproven'), 'PID without exact API-listener ownership is rejected');
  }
  {
    const noNetworkError = live(); noNetworkError.observations.splice(6, 1);
    A.ok(verdict(noNetworkError).errors.includes('eventsource-error-unproven'), 'DOWN without the exact CDP EventSource failure is rejected');
  }
  {
    const samePid = live(); samePid.observations[8].pid = 1234;
    A.ok(verdict(samePid).errors.includes('watchdog-recovery-unproven'), 'same/dead PID cannot impersonate watchdog recovery');
  }
  {
    const sameInstance = live(); sameInstance.observations[8].instanceSha256 = '1'.repeat(64);
    A.ok(verdict(sameInstance).errors.includes('watchdog-recovery-unproven'), 'reused process instance cannot impersonate watchdog recovery');
  }
  {
    const fabricatedTime = live(); fabricatedTime.observations[10].atMs = 99999;
    A.ok(verdict(fabricatedTime).errors.includes('timeline-invalid'), 'observation timestamps beyond real wall time are rejected');
  }
  {
    const secret = live(); secret.observations[0].diagnostic = 'api_key = sk-test-abcdefghijklmnop';
    A.ok(verdict(secret).errors.includes('secret-bearing-observation'), 'secret-shaped raw evidence is rejected');
  }

  const doc = buildObservationDocument(live(), INVOCATION, { startedAt: 1000, endedAt: 51000 });
  A.eq(doc.producer, OBSERVATION_PRODUCER, 'raw document uses exact producer');
  A.eq(doc.challenge, CHALLENGE, 'raw document is challenge-bound');
  A.eq(doc.artifact.sha256, HASH, 'raw document is artifact-bound');
  A.eq(Object.prototype.hasOwnProperty.call(doc.artifact, 'path'), false, 'raw evidence does not disclose install path');
  const summary = buildReceipt(INVOCATION, live(), { path: 'qa/installed/smoke-unit-link/link-observation.json', sha256: 'f'.repeat(64), size: 10 }, new Date(51000).toISOString());
  A.eq(summary.producer, LINK_PRODUCER, 'receipt uses exact companion producer');
  A.eq(summary.probe.sha256, PROBE_HASH, 'receipt binds its candidate-owned producer bytes');
  A.eq(summary.cdpPort, 9444, 'receipt binds the normalized CDP port');
  A.eq(Object.prototype.hasOwnProperty.call(summary.artifact, 'path'), false, 'receipt does not disclose install path');

  {
    const io = memoryIo();
    const runner = makeInstalledLinkTransportProbe({ invocation: INVOCATION, driver: { run: async () => live() }, io, clock: clock() });
    const result = await runner.run();
    A.eq(result.ok, true, 'injectable exact scenario writes evidence and receipt');
    A.eq(io.evidence.length, 1, 'raw evidence is written once');
    A.eq(io.receipts.length, 1, 'receipt is written only after evidence read-back descriptor exists');
    A.eq(containsSecretMaterial(JSON.stringify(io.receipts[0])), false, 'written receipt is secret-free');
  }
  {
    const io = memoryIo();
    const runner = makeInstalledLinkTransportProbe({ invocation: INVOCATION, driver: { run: async () => live() }, io, clock: clock(1000, 1000) });
    const result = await runner.run();
    A.eq(result.ok, false, 'fabricated 47-second timeline cannot outrun zero wall time');
    A.eq(io.receipts.length, 0, 'failed wall-time proof writes no receipt');
  }
  {
    const io = memoryIo({ failEvidence: true });
    const runner = makeInstalledLinkTransportProbe({ invocation: INVOCATION, driver: { run: async () => live() }, io, clock: clock() });
    A.eq((await runner.run()).code, 'evidence-write-failed', 'evidence persistence failure blocks');
    A.eq(io.receipts.length, 0, 'receipt is never written after evidence failure');
  }
  {
    const io = memoryIo({ failReceipt: true });
    const runner = makeInstalledLinkTransportProbe({ invocation: INVOCATION, driver: { run: async () => live() }, io, clock: clock() });
    A.eq((await runner.run()).code, 'receipt-write-failed', 'receipt persistence failure blocks');
  }

  A.eq(containsSecretMaterial('safe candidate ' + SHA), false, 'ordinary candidate metadata is safe');
  A.eq(containsSecretMaterial('https://127.0.0.1/events?token=hidden'), true, 'token query is always secret-shaped');
  const source = fs.readFileSync(path.join(ROOT, PROBE_RELATIVE_PATH), 'utf8');
  A.ok(/Network[.]eventSourceMessageReceived/.test(source), 'healthy frames come from CDP EventSource events');
  A.ok(/Network[.]loadingFailed/.test(source), 'loss comes from CDP network failure');
  A.ok(/Get-NetTCPConnection/.test(source) && /ParentProcessId/.test(source) && /[.]Handle/.test(source) && /StartTime/.test(source) && /[.]Kill\(\)/.test(source), 'kill uses exact child/listener plus an opened process-instance handle');
  A.ok(!/Stop-Process\s+-Id/.test(source), 'probe never kills by a reusable PID alone');
  A.ok(/watchdog-version-pid-changed/.test(source) && /watchdog-final-pid-changed/.test(source), 'same recovered PID/creation identity is rebound after version and final link proof');
  A.ok(/CommandLine[^\n]+sidecar[^\n]+index/.test(source), 'process seam requires the packaged sidecar entry');
  A.ok(!/new\s+EventSource\s*\(/.test(source), 'probe never creates a synthetic page EventSource');
  A.ok(!/World[.]init\s*\(/.test(source), 'probe never initializes the product world to manufacture a bridge');
  A.ok(!/__STARNET_API_TOKEN__/.test(source), 'probe never reads the launch token');
  A.ok(!/endpointUrl/.test(source), 'raw token-bearing request URLs are never serialized');
  A.ok(/sidecar-recovery/.test(source) && /recovery-transport-data/.test(source), 'probe leaves the same desktop recovered for the following journey');
  A.eq((source.match(/await cycleProductBridge\(cdp\)/g) || []).length, 1, 'bridge is cycled only for initial measurement; recovery remains the product native retry');

  if (process.platform === 'win32') {
    const missingArtifact = path.join(os.tmpdir(), 'starnet-definitely-missing-' + process.pid + '.exe');
    const processSeam = inspectWindowsSidecarProcess(missingArtifact, 65534);
    A.eq(processSeam.code, 'desktop-process-count', 'Windows CIM process seam parses and safely refuses a missing desktop');
    const strippedEnv = {};
    for (const name of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PATH', 'PATHEXT', 'ComSpec', 'COMSPEC']) {
      if (Object.prototype.hasOwnProperty.call(process.env, name)) strippedEnv[name] = process.env[name];
    }
    const stripped = spawnSync(process.execPath, ['--input-type=module', '-e',
      "const m=await import('./scripts/qa/installed-link-transport.mjs');console.log(JSON.stringify(m.inspectWindowsSidecarProcess(process.argv[1],65534)))",
      missingArtifact], { cwd: ROOT, env: strippedEnv, encoding: 'utf8' });
    A.eq(stripped.status, 0, 'Windows process seam runs under the gate allowlisted environment');
    A.eq(JSON.parse(String(stripped.stdout).trim()).code, 'desktop-process-count', 'stripped environment retains bounded CIM classification');
  }

  const blocked = spawnSync(process.execPath, [path.join(ROOT, PROBE_RELATIVE_PATH)], {
    cwd: ROOT, env: { SystemRoot: process.env.SystemRoot, SYSTEMROOT: process.env.SYSTEMROOT }, encoding: 'utf8'
  });
  A.eq(blocked.status, 2, 'probe without gate-minted challenge/candidate exits BLOCKED');
  A.ok(!/token=|api[_-]?key|authorization/i.test(String(blocked.stdout || '') + String(blocked.stderr || '')), 'BLOCKED output does not echo secret-shaped material');

  A.report('qa installed link transport');
})().catch(error => { console.error(error); process.exit(1); });
