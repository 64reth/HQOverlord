/* node test/qa-installed-smoke.test.js — the installed-exe smoke's pure core (EL-4/EL-8),
   fed injected fakes for attach / io / clock (zero disk, zero CDP). Asserts:
   the classifier's no-fake-green order (unreachable→BLOCKED, unversioned→BLOCKED, failed
   assertion→RED, all-pass→GREEN), the stamp writer/validator shape the ready-gate reads,
   the BLOCKED-on-unreachable path (stamp written + a P0 ledger finding filed, never a silent
   green), and that a GREEN run files NO finding. Pure + deterministic — the ISO stamp always
   comes from the injected clock, never Date.now(). */
'use strict';
const A = require('./_assert.js');
const crypto = require('crypto');
const vm = require('vm');
const {
  RESULTS, SMOKE_CREW, SMOKE_PROBE, PREPARE_SMOKE_SURFACE, STAMP_SCHEMA, REQUIRED_CHECKS,
  classifyResult, normalizeStamp, validateStamp, buildFinding, makeSmoke
} = require('../scripts/qa/installed-smoke.mjs');

const ISO = '2026-07-07T12:00:00.000Z';
const clock = { nowIso: () => ISO };
const SHA = 'a'.repeat(40);
const TREE = 'd'.repeat(40);
const ARTIFACT = { path: 'C:/Program Files/StarNet/StarNet.exe', sha256: 'b'.repeat(64), size: 123456 };
const RUNTIME_EXECUTABLE = { sha256: ARTIFACT.sha256, size: ARTIFACT.size };
const EVIDENCE = { path: 'qa/installed/run/probe.json', sha256: 'c'.repeat(64), size: 321 };
const OFFICIAL_EVIDENCE = { schemaVersion: 1, candidateCommit: SHA, sourceTree: TREE, artifact: { sha256: ARTIFACT.sha256, size: ARTIFACT.size } };

async function runInPageProbe({ boardOpen, cards = [], busyIds = [] }) {
  const context = {
    location: { origin: 'http://tauri.localhost' },
    window: {
      __TAURI__: { core: { invoke: async () => ({
        commit: 'aaaaaaaa', sha: SHA, describe: 'v0.3.0-1-gaaaaaaaa', dirty: false,
        sourceTree: TREE, provenanceKind: 'reproducible-source',
        executableSha256: RUNTIME_EXECUTABLE.sha256, executableSize: RUNTIME_EXECUTABLE.size
      }) } },
      __STARNET_API_TOKEN__: 'test-token',
      __world: {}
    },
    document: {
      querySelector: () => ({}),
      querySelectorAll: (selector) => selector === '.kb-cols' ? (boardOpen ? [{}] : []) : (selector === '.kb-card' ? cards : [])
    },
    Workstreams: { list: () => [] },
    Channels: { busyIds: () => busyIds },
    fetch: async (url) => ({
      ok: true,
      json: async () => url === '/api/version'
        ? ({ app: '0.3.0', appSource: 'test', harness: 'v0.3.0', buildSha: SHA, buildDirty: false })
        : ({ report: { mode: 'desktop' } })
    })
  };
  return await vm.runInNewContext(SMOKE_PROBE, context);
}

async function runPrepareWithDelayedWiring(handledClick) {
  let clicks = 0;
  let boardOpen = false;
  const context = {
    document: {
      querySelector: (selector) => selector === '[data-term="tasks"]' ? {
        click() {
          clicks += 1;
          if (clicks >= handledClick) boardOpen = true;
        }
      } : null,
      querySelectorAll: (selector) => selector === '.kb-cols' && boardOpen ? [{}] : []
    },
    setTimeout: (resolve) => resolve()
  };
  const prepared = await vm.runInNewContext(PREPARE_SMOKE_SURFACE, context);
  return { prepared, clicks };
}

// a fake io that records everything into inspectable arrays (no disk).
function memIo() {
  const evidence = [], stamps = [], findings = [], logs = [];
  return {
    evidence, stamps, findings, logs,
    log: (...a) => logs.push(a.join(' ')),
    writeEvidence(name, text) {
      const p = 'qa/installed/run/' + name;
      const bytes = Buffer.from(text, 'utf8');
      const proof = { path: p, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
      evidence.push({ name, text, proof });
      return proof;
    },
    writeStamp(obj) { stamps.push(obj); return 'qa/installed/last-smoke.json'; },
    readStamp() { return stamps.length ? stamps[stamps.length - 1] : null; },
    fileFinding(f) { findings.push(f); return true; }
  };
}
// a session whose probe returns a canned result.
const sessionWith = (probeResult) => ({
  async probe() { return probeResult; },
  diagnostics() { return { consoleMsgs: [], exceptions: [] }; },
  async close() {}
});
const GREEN_PROBE = {
  appVersion: '0.3.0', appSource: 'env', harness: 'v0.3.0-1-gaaaaaaaa',
  sidecarBuildSha: SHA, sidecarBuildDirty: false,
  mode: 'desktop', origin: 'http://tauri.localhost',
  shell: {
    version: '0.3.0', commit: 'aaaaaaaa', sha: SHA, describe: 'v0.3.0-1-gaaaaaaaa', dirty: false,
    sourceTree: TREE, provenanceKind: 'reproducible-source',
    executableSha256: RUNTIME_EXECUTABLE.sha256, executableSize: RUNTIME_EXECUTABLE.size
  },
  bootSane: true,
  checks: [
    { name: 'desktop/tauri-origin', ok: true, detail: 'ok' },
    { name: 'desktop/build-info', ok: true, detail: 'ok' },
    { name: 'desktop/executable-identity', ok: true, detail: 'ok' },
    { name: 'boot/api-token-present', ok: true, detail: 'ok' },
    { name: 'version/app-nonblank', ok: true, detail: 'app=0.3.0' },
    { name: 'boot/world-present', ok: true, detail: 'canvas' },
    { name: 'boot/stage-rendered', ok: true, detail: 'stage' },
    { name: 'store/workstreams-wellformed', ok: true, detail: '3 workstreams' },
    { name: 'board/no-forever-running', ok: true, detail: 'idle' }
  ],
  notes: 'checks=6 mode=desktop'
};

/* ---- A0. SMOKE_PROBE auth-header contract (regression for ledger finding 4d9992d9) ----
   The in-page probe MUST authenticate with X-StarNet-Token — the ONLY scheme the sidecar accepts (Authorization is
   rejected as "forbidden token") AND the only auth header in its CORS Access-Control-Allow-Headers. On the packaged
   desktop build the page origin (http://tauri.localhost) differs from the sidecar (http://127.0.0.1:<port>), so every
   /api/* call is cross-origin: a stray Authorization header makes the OPTIONS preflight request a header the sidecar
   won't allow, the preflight is rejected, and fetch() dies with "Failed to fetch" BEFORE any response — so appVersion
   reads blank and the smoke goes BLOCKED even though /api/version is serving the honest version. Same-origin
   dev/headless never preflights, which is why this only ever surfaced on the installed exe. The probe is a string
   eval'd in a real browser, so this guards its source directly (it can't be exercised headlessly). */
{
  A.ok(/X-StarNet-Token/.test(SMOKE_PROBE), 'SMOKE_PROBE authenticates with the X-StarNet-Token header (sidecar auth + CORS allow-list)');
  A.ok(!/Authorization/i.test(SMOKE_PROBE), 'SMOKE_PROBE sends NO Authorization header (it trips the packaged build cross-origin preflight)');
  A.ok(!/Bearer/.test(SMOKE_PROBE), 'SMOKE_PROBE uses NO Bearer scheme (the sidecar rejects Bearer as forbidden token)');
  A.ok(/starnet_build_info/.test(SMOKE_PROBE), 'SMOKE_PROBE obtains source identity from the running Tauri binary');
  A.ok(/executableSha256/.test(SMOKE_PROBE) && /executableSize/.test(SMOKE_PROBE), 'SMOKE_PROBE obtains content identity from the running executable');
  A.ok(/data-term="tasks"/.test(PREPARE_SMOKE_SURFACE) && /\.kb-cols/.test(PREPARE_SMOKE_SURFACE), 'installed smoke physically opens TASKS before asserting its rendered state');
  A.ok(REQUIRED_CHECKS.includes('desktop/tauri-origin') && REQUIRED_CHECKS.includes('desktop/build-info') && REQUIRED_CHECKS.includes('desktop/executable-identity'), 'desktop source + executable identity assertions are mandatory');
}

/* ---- A. classifyResult encodes the no-fake-green order ---- */
{
  A.eq(classifyResult({ attached: false }), RESULTS.BLOCKED, 'unreachable -> BLOCKED');
  A.eq(classifyResult({ attached: true, appVersion: '', checks: [] }), RESULTS.BLOCKED, 'attached but unversioned -> BLOCKED');
  const proven = Object.assign({ attached: true, expectedHead: SHA, expectedTree: TREE, artifact: ARTIFACT, evidencePersisted: true }, GREEN_PROBE);
  A.eq(classifyResult(proven), RESULTS.GREEN, 'desktop + exact clean build + complete assertions -> GREEN');
  A.eq(classifyResult(Object.assign({}, proven, { mode: 'browser' })), RESULTS.BLOCKED, 'browser fallback can never produce installed GREEN');
  A.eq(classifyResult(Object.assign({}, proven, { shell: Object.assign({}, proven.shell, { dirty: true }) })), RESULTS.BLOCKED, 'dirty packaged build is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { expectedHead: 'c'.repeat(40) })), RESULTS.BLOCKED, 'wrong candidate build is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { expectedTree: 'c'.repeat(40) })), RESULTS.BLOCKED, 'wrong candidate source tree is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { shell: Object.assign({}, proven.shell, { provenanceKind: 'official' }) })), RESULTS.BLOCKED, 'a running build cannot self-assert official');
  A.eq(classifyResult(Object.assign({}, proven, { artifact: Object.assign({}, ARTIFACT, { sha256: 'd'.repeat(64) }) })), RESULTS.BLOCKED, 'a supplied artifact with different bytes is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { artifact: Object.assign({}, ARTIFACT, { size: ARTIFACT.size + 1 }) })), RESULTS.BLOCKED, 'a supplied artifact with different size is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { shell: Object.assign({}, proven.shell, { executableSha256: '' }) })), RESULTS.BLOCKED, 'missing runtime executable identity is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { checks: proven.checks.slice(1) })), RESULTS.BLOCKED, 'missing required assertion is BLOCKED');
  A.eq(classifyResult(Object.assign({}, proven, { checks: proven.checks.map(c => c.name === 'board/no-forever-running' ? { name: c.name, ok: false } : c) })), RESULTS.RED, 'exact build with a failed assertion -> RED');
}

/* ---- B. normalizeStamp coerces to the exact contract shape; unknown result clamps to BLOCKED ---- */
{
  const s = normalizeStamp({ expectedHead: SHA, expectedTree: TREE, buildCommit: SHA, sourceTree: TREE, buildDescribe: 'v0.3.0', buildDirty: false, buildKind: 'reproducible-source', provenanceKind: 'reproducible-source', appVersion: ' 0.3.0 ', sidecarHarness: 'v0.3.0', mode: 'desktop', origin: 'http://tauri.localhost', artifact: ARTIFACT, runtimeExecutable: RUNTIME_EXECUTABLE, result: 'GREEN', evidence: [EVIDENCE, 'legacy-path-only.json'], notes: ' hi ' }, { clock });
  A.eq(s.schemaVersion, STAMP_SCHEMA, 'stamp carries the v3 schema');
  A.eq(s.stampIso, ISO, 'stampIso stamped from the injected clock');
  A.eq(s.appVersion, '0.3.0', 'appVersion trimmed');
  A.eq(s.expectedHead, SHA, 'explicit expected candidate is preserved');
  A.eq(s.buildCommit, SHA, 'observed binary commit is separate and preserved');
  A.eq(s.expectedTree, TREE, 'expected candidate source tree is preserved');
  A.eq(s.sourceTree, TREE, 'running build source tree is preserved');
  A.eq(s.buildKind, 'reproducible-source', 'running BuildInfo kind is preserved');
  A.eq(s.provenanceKind, 'reproducible-source', 'installed classification is preserved');
  A.eq(s.result, 'GREEN', 'valid result kept');
  A.eq(s.evidence, [EVIDENCE], 'only content-bound evidence entries survive normalization');
  A.eq(s.runtimeExecutable, RUNTIME_EXECUTABLE, 'receipt records content identity reported by the running executable');
  A.eq(s.notes, 'hi', 'notes trimmed');
  // exact key set the ready-gate reads — no extra/missing keys.
  A.eq(Object.keys(s).sort(), ['appVersion', 'artifact', 'buildCommit', 'buildDescribe', 'buildDirty', 'buildKind', 'evidence', 'expectedHead', 'expectedTree', 'mode', 'notes', 'officialEvidence', 'origin', 'provenanceKind', 'result', 'runtimeExecutable', 'schemaVersion', 'sidecarHarness', 'sourceTree', 'stampIso'], 'stamp has exactly the v3 contract keys');
  // an unknown/blank result is clamped to BLOCKED (never silently "" or GREEN).
  A.eq(normalizeStamp({ result: 'WAT' }, { clock }).result, RESULTS.BLOCKED, 'unknown result clamps to BLOCKED');
  A.eq(normalizeStamp({}, { clock }).result, RESULTS.BLOCKED, 'missing result clamps to BLOCKED');
  // a legacy path-only entry cannot become trusted evidence without content identity.
  A.eq(normalizeStamp({ evidence: 'only.json' }, { clock }).evidence, [], 'path-only evidence is dropped rather than trusted');
}

/* ---- C. validateStamp accepts a well-formed stamp and rejects each contract violation ---- */
{
  const good = normalizeStamp({ expectedHead: SHA, expectedTree: TREE, buildCommit: SHA, sourceTree: TREE, buildDescribe: 'v0.3.0', buildDirty: false, buildKind: 'reproducible-source', provenanceKind: 'reproducible-source', appVersion: '0.3.0', sidecarHarness: 'v0.3.0', mode: 'desktop', origin: 'http://tauri.localhost', artifact: ARTIFACT, runtimeExecutable: RUNTIME_EXECUTABLE, result: 'GREEN', evidence: [EVIDENCE], notes: 'n' }, { clock });
  A.eq(validateStamp(good).ok, true, 'a well-formed GREEN stamp validates');
  A.eq(validateStamp({}).ok, false, 'empty object fails validation');
  A.eq(validateStamp(null).ok, false, 'null fails validation');
  A.ok(validateStamp(Object.assign({}, good, { stampIso: 'not-a-date' })).errors.some(e => /ISO/.test(e)), 'a non-ISO stampIso is flagged');
  A.ok(validateStamp(Object.assign({}, good, { result: 'MAYBE' })).errors.some(e => /GREEN\|RED\|BLOCKED/.test(e)), 'a bad result enum is flagged');
  A.ok(validateStamp(Object.assign({}, good, { appVersion: '' })).errors.some(e => /appVersion/.test(e)), 'GREEN without appVersion is a lie -> flagged');
  A.ok(validateStamp(Object.assign({}, good, { evidence: [] })).errors.some(e => /evidence/.test(e)), 'GREEN without evidence is flagged');
  A.ok(validateStamp(Object.assign({}, good, { mode: 'browser' })).errors.some(e => /desktop/.test(e)), 'browser-mode GREEN is invalid');
  A.ok(validateStamp(Object.assign({}, good, { sourceTree: 'c'.repeat(40) })).errors.some(e => /sourceTree/.test(e)), 'mismatched source tree is invalid');
  A.ok(validateStamp(Object.assign({}, good, { provenanceKind: 'official', officialEvidence: null })).errors.some(e => /official evidence/.test(e)), 'hand-asserted official without evidence is invalid');
  A.ok(validateStamp(Object.assign({}, good, { runtimeExecutable: null })).errors.some(e => /runtime executable/.test(e)), 'GREEN without runtime executable identity is invalid');
  A.ok(validateStamp(Object.assign({}, good, { runtimeExecutable: { sha256: 'd'.repeat(64), size: ARTIFACT.size } })).errors.some(e => /must equal/.test(e)), 'GREEN whose supplied artifact differs from the runtime executable is invalid');
  A.ok(validateStamp(Object.assign({}, good, { evidence: [{ path: 'e.json', sha256: 'x', size: 1 }] })).errors.some(e => /evidence entries/.test(e)), 'evidence without a valid digest is invalid');
  // a BLOCKED stamp with a blank appVersion is legitimately valid (that's exactly what BLOCKED means).
  const blocked = normalizeStamp({ result: 'BLOCKED', evidence: [EVIDENCE], notes: 'n' }, { clock });
  A.eq(validateStamp(blocked).ok, true, 'BLOCKED with blank identity is a valid v3 receipt');
}

/* ---- D. buildFinding: BLOCKED -> P0, RED -> P1, evidence never empty ---- */
{
  const b = buildFinding(RESULTS.BLOCKED, 'could not attach', [], [], 'qa/installed/last-smoke.json');
  A.eq(b.severity, 'P0', 'BLOCKED finding is P0');
  A.eq(b.crew, SMOKE_CREW, 'finding is filed under the smoke crew');
  A.ok(b.evidence.length >= 1, 'BLOCKED finding still carries an evidence path (stamp fallback)');
  A.ok(/BLOCKED/.test(b.title), 'BLOCKED title says so');
  const r = buildFinding(RESULTS.RED, 'appVersion=0.3.0 checks 5/6 pass', [{ name: 'board/no-forever-running', detail: 'stuck: w1' }], [EVIDENCE], 'qa/installed/last-smoke.json');
  A.eq(r.severity, 'P1', 'RED finding is P1');
  A.ok(/board\/no-forever-running/.test(r.subject), 'RED subject names the failed assertion (stable fingerprint)');
  A.eq(r.evidence, ['qa/installed/run/probe.json'], 'RED finding uses the real probe evidence');
}

/* ---- E. makeSmoke: BLOCKED-on-unreachable — stamp written BLOCKED + a P0 finding, never silent green ---- */
(async () => {
  /* ---- A0.1. cold boot retries the physical TASKS control until its listener is wired ---- */
  const delayedSurface = await runPrepareWithDelayedWiring(3);
  A.eq(delayedSurface.prepared, true, 'surface preparation survives dock DOM appearing before its listener is wired');
  A.eq(delayedSurface.clicks, 3, 'surface preparation retries ignored cold-boot clicks and stops once TASKS opens');

  /* ---- A1. open-empty TASKS is observable proof; a closed board is still fail-closed ---- */
  const emptyOpen = await runInPageProbe({ boardOpen: true });
  const emptyOpenCheck = emptyOpen.checks.find(c => c.name === 'board/no-forever-running');
  A.eq(emptyOpenCheck.ok, true, 'an open TASKS board with zero cards passes the no-forever-running invariant');
  A.ok(/board open; 0 card/.test(emptyOpenCheck.detail), 'empty-board proof states that the TASKS container was observed');
  const closed = await runInPageProbe({ boardOpen: false });
  const closedCheck = closed.checks.find(c => c.name === 'board/no-forever-running');
  A.eq(closedCheck.ok, false, 'a closed TASKS board remains unproven and fails closed');

  const io = memIo();
  const attach = async () => { throw new Error('ECONNREFUSED 127.0.0.1:9333'); };
  const smoke = makeSmoke({ attach, clock, expectedHead: SHA, expectedTree: TREE, artifact: ARTIFACT, io });
  const res = await smoke.run();
  A.eq(res.result, RESULTS.BLOCKED, 'unreachable exe -> BLOCKED');
  A.eq(io.stamps.length, 1, 'a stamp was still written (no silent skip)');
  A.eq(io.stamps[0].result, RESULTS.BLOCKED, 'the written stamp reads BLOCKED');
  A.eq(io.stamps[0].expectedHead, SHA, 'stamp pins the explicit expected candidate');
  A.eq(io.stamps[0].appVersion, '', 'BLOCKED stamp has no proven appVersion');
  A.eq(validateStamp(io.stamps[0]).ok, true, 'the BLOCKED stamp is a valid contract object');
  A.eq(io.findings.length, 1, 'exactly one ledger finding filed on BLOCKED');
  A.eq(io.findings[0].severity, 'P0', 'the BLOCKED finding is a P0');
  A.ok(io.findings[0].evidence.length >= 1, 'the filed finding carries evidence (evidence-law safe)');
  A.ok(/ECONNREFUSED/.test(io.stamps[0].notes), 'the block reason is captured in the stamp notes');

  /* ---- F. makeSmoke: attach ok but appVersion blank -> BLOCKED (can not prove the build) ---- */
  const io2 = memIo();
  const unversioned = Object.assign({}, GREEN_PROBE, { appVersion: '', checks: GREEN_PROBE.checks.map(c => c.name === 'version/app-nonblank' ? { name: c.name, ok: false, detail: 'blank' } : c) });
  const smoke2 = makeSmoke({ attach: async () => sessionWith(unversioned), clock, expectedHead: SHA, expectedTree: TREE, artifact: ARTIFACT, io: io2 });
  const res2 = await smoke2.run();
  A.eq(res2.result, RESULTS.BLOCKED, 'attached but unversioned -> BLOCKED (no-fake-green)');
  A.eq(io2.findings[0].severity, 'P0', 'unversioned is a P0');

  /* ---- G. makeSmoke: attached + versioned + a failed assertion -> RED + P1 finding ---- */
  const io3 = memIo();
  const redProbe = Object.assign({}, GREEN_PROBE, { checks: GREEN_PROBE.checks.map(c => c.name === 'board/no-forever-running' ? { name: c.name, ok: false, detail: 'RUNNING chip with nothing busy: w1' } : c) });
  const smoke3 = makeSmoke({ attach: async () => sessionWith(redProbe), clock, expectedHead: SHA, expectedTree: TREE, artifact: ARTIFACT, io: io3 });
  const res3 = await smoke3.run();
  A.eq(res3.result, RESULTS.RED, 'a failed parity assertion -> RED');
  A.eq(io3.stamps[0].result, RESULTS.RED, 'stamp reads RED');
  A.eq(io3.stamps[0].appVersion, '0.3.0', 'RED stamp still pins the proven version');
  A.eq(io3.findings.length, 1, 'one finding filed on RED');
  A.eq(io3.findings[0].severity, 'P1', 'a RED parity divergence is P1');

  /* ---- H. makeSmoke: full green run -> GREEN stamp + NO finding filed ---- */
  const io4 = memIo();
  const smoke4 = makeSmoke({ attach: async () => sessionWith(GREEN_PROBE), clock, expectedHead: SHA, expectedTree: TREE, artifact: ARTIFACT, io: io4 });
  const res4 = await smoke4.run();
  A.eq(res4.result, RESULTS.GREEN, 'all pass -> GREEN');
  A.eq(io4.stamps[0].result, RESULTS.GREEN, 'stamp reads GREEN');
  A.eq(validateStamp(io4.stamps[0]).ok, true, 'the GREEN stamp is a valid contract object');
  A.ok(io4.stamps[0].evidence.length >= 1, 'GREEN stamp carries the probe evidence');
  A.eq(io4.stamps[0].runtimeExecutable, RUNTIME_EXECUTABLE, 'GREEN stamp binds the artifact to the executable that answered the probe');
  A.eq(io4.stamps[0].artifact.sha256, io4.stamps[0].runtimeExecutable.sha256, 'GREEN receipt records exact artifact/runtime SHA-256 equality');
  A.eq(io4.stamps[0].artifact.size, io4.stamps[0].runtimeExecutable.size, 'GREEN receipt records exact artifact/runtime size equality');
  A.eq(io4.stamps[0].sourceTree, TREE, 'GREEN receipt binds the exact source tree');
  A.eq(io4.stamps[0].provenanceKind, 'reproducible-source', 'ordinary clean source build is classified reproducible-source');
  A.eq(io4.findings.length, 0, 'a GREEN run files NO ledger finding (nothing to report)');

  /* ---- H2. official is externally earned; custom can never be promoted ---- */
  const verifier = () => ({ ok: true, authority: 'release-attestation-verifier', verificationId: 'attestation-123' });
  const ioOfficial = memIo();
  const official = await makeSmoke({
    attach: async () => sessionWith(GREEN_PROBE), clock, expectedHead: SHA, expectedTree: TREE,
    artifact: ARTIFACT, officialEvidence: OFFICIAL_EVIDENCE, verifyOfficialEvidence: verifier, io: ioOfficial
  }).run();
  A.eq(official.result, RESULTS.GREEN, 'external official verification does not weaken installed behavior gates');
  A.eq(official.stamp.provenanceKind, 'official', 'exact externally verified commit/tree/artifact earns official');
  A.ok(official.stamp.officialEvidence && official.stamp.officialEvidence.verificationId === 'attestation-123', 'official receipt records its external verification identity');

  const customProbe = Object.assign({}, GREEN_PROBE, { shell: Object.assign({}, GREEN_PROBE.shell, { provenanceKind: 'custom' }) });
  const custom = await makeSmoke({
    attach: async () => sessionWith(customProbe), clock, expectedHead: SHA, expectedTree: TREE,
    artifact: ARTIFACT, officialEvidence: OFFICIAL_EVIDENCE, verifyOfficialEvidence: verifier, io: memIo()
  }).run();
  A.eq(custom.stamp.provenanceKind, 'custom', 'explicit custom build stays custom despite unrelated official evidence');
  A.eq(custom.stamp.officialEvidence, null, 'custom receipt cannot retain an official-looking assertion');

  /* ---- I. makeSmoke: attach ok but the in-page probe throws -> BLOCKED (proved nothing) ---- */
  const io5 = memIo();
  const throwingSession = { async probe() { throw new Error('Runtime.evaluate detached'); }, diagnostics() { return {}; }, async close() {} };
  const smoke5 = makeSmoke({ attach: async () => throwingSession, clock, expectedHead: SHA, expectedTree: TREE, artifact: ARTIFACT, io: io5 });
  const res5 = await smoke5.run();
  A.eq(res5.result, RESULTS.BLOCKED, 'a probe that throws -> BLOCKED, not green');
  A.eq(io5.findings[0].severity, 'P0', 'probe-threw is a P0');

  A.report('qa-installed-smoke.test');
})();
