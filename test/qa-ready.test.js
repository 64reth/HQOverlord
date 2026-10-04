/* node test/qa-ready.test.js — the READY GATE's pure verdict logic (lane EL-7), fed injected
   artifact objects + a fixed clock (no QA-artifact reads, zero git, zero child processes). Asserts: the
   no-fake-green law (a missing/unreadable/erroring artifact is NOT READY, never a silent pass),
   staleness math, guardian trunk-drift + skip-gate rejection, ledger P0/P1 counting via the
   ledger's OWN openBySeverity() authority, and the overall verdict aggregation + numbered reasons.
   Pure + deterministic — every age comes from the injected `nowMs`, never Date.now(). Does NOT read
   qa/ artifacts or run git (that is the IO shell's job). */
'use strict';
const A = require('./_assert.js');
const crypto = require('crypto');
const path = require('path');
const {
  evaluate, checkLedger, checkBugRegister, checkGuardian, checkJourneys, checkBeginner, checkInstalled,
  inspectInstalledIdentity, freshness, humanAge, renderVerdict, verifyContentIdentity, DAY_MS, DEFAULTS,
} = require('../scripts/qa/ready.mjs');
const { makeLedger } = require('../scripts/qa/ledger.mjs');

const NOW = Date.parse('2026-07-07T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();
const FRESH = iso(NOW - 60 * 1000);         // 1 minute ago
const STALE = iso(NOW - 26 * 60 * 60 * 1000); // 26h ago (> 24h window)
const TRUNK = 'a'.repeat(40);
const TREE = 'd'.repeat(40);
const EXECUTABLE_IDENTITY = { sha256: 'b'.repeat(64), size: 123 };
const EVIDENCE_BYTES = Buffer.from('installed smoke evidence', 'utf8');
const EVIDENCE_IDENTITY = {
  path: 'qa/installed/run/probe.json',
  sha256: crypto.createHash('sha256').update(EVIDENCE_BYTES).digest('hex'),
  size: EVIDENCE_BYTES.length
};

// A fully-GREEN artifact set + cfg, so each test perturbs exactly ONE thing.
function greenArtifacts() {
  return {
    ledger: { ok: true, counts: { P0: 0, P1: 0, P2: 3 } },
    bugs: { counts: { P0: 0, P1: 0, P2: 7 } },
    guardian: { stampIso: FRESH, trunkHead: TRUNK, result: 'green', gatesRan: ['test-fast', 'shoot', 'golden', 'audit', 'journeys'], gatesSkipped: [] },
    journeys: { stampIso: FRESH, trunkHead: TRUNK, result: 'pass', passed: 120, total: 120, fullSuite: true },
    beginner: { stampIso: FRESH, trunkHead: TRUNK, result: 'PASS', mode: 'ui-only', totalMs: 84000 },
    installed: {
      schemaVersion: 3, stampIso: iso(NOW - 2 * DAY_MS), expectedHead: TRUNK, expectedTree: TREE,
      buildCommit: TRUNK, sourceTree: TREE, buildDescribe: 'v0.3.0-1-gaaaaaaaa', buildDirty: false,
      buildKind: 'reproducible-source', provenanceKind: 'reproducible-source', officialEvidence: null,
      appVersion: '0.3.0',
      sidecarHarness: 'v0.3.0-1-gaaaaaaaa', mode: 'desktop', origin: 'http://tauri.localhost',
      artifact: { path: 'StarNet.exe', sha256: EXECUTABLE_IDENTITY.sha256, size: EXECUTABLE_IDENTITY.size },
      runtimeExecutable: EXECUTABLE_IDENTITY, artifactVerified: true,
      result: 'GREEN', evidence: [EVIDENCE_IDENTITY], evidenceVerified: true
    },
  };
}
function greenCfg() {
  return { nowMs: NOW, maxStaleMs: DEFAULTS.maxStaleMs, maxInstalledStaleMs: DEFAULTS.maxInstalledStaleMs, maxTrunkDrift: 0, currentTrunk: TRUNK, currentTree: TREE, trunkDrift: 0 };
}

/* ─── A. the all-green baseline is READY (and only then) ─── */
{
  const v = evaluate(greenArtifacts(), greenCfg());
  A.eq(v.ready, true, 'all six checks green -> READY');
  A.eq(v.reasons.length, 0, 'READY has zero reasons');
  A.eq(v.checks.length, 6, 'exactly six checks are evaluated');
  A.ok(v.checks.every(c => c.ok), 'every check ok in the green baseline');
  // every check carries an auditable receipt (artifact + value).
  A.ok(v.checks.every(c => c.receipt && c.receipt.artifact && c.receipt.value), 'each check emits a receipt with artifact + value');
}

/* ─── B. NO-FAKE-GREEN: a MISSING artifact is NOT READY (never a silent pass) ─── */
{
  for (const key of ['guardian', 'journeys', 'beginner', 'installed']) {
    const arts = greenArtifacts();
    arts[key] = { missing: true };
    const v = evaluate(arts, greenCfg());
    A.eq(v.ready, false, 'a missing ' + key + ' artifact -> NOT READY');
    A.eq(v.failing.length, 1, 'exactly the ' + key + ' check fails');
    A.eq(v.failing[0], key, 'the failing check id is ' + key);
    A.ok(/1\. /.test(v.reasons[0]), 'the reason is numbered');
  }
}

/* ─── B2. NO-FAKE-GREEN: an ERRORING artifact (unreadable) is NOT READY, loudly ─── */
{
  const arts = greenArtifacts();
  arts.ledger = { error: 'ENOENT reading findings dir' };
  const v = evaluate(arts, greenCfg());
  A.eq(v.ready, false, 'a ledger read error -> NOT READY');
  A.ok(/could not read the ledger/i.test(v.checks[0].reason), 'the ledger error is surfaced in the reason (loud)');

  const arts2 = greenArtifacts();
  arts2.guardian = { error: 'bad JSON' };
  const v2 = evaluate(arts2, greenCfg());
  A.eq(v2.ready, false, 'an unreadable guardian stamp -> NOT READY');

  A.throws(() => makeLedger({ strictRead: true, io: { listFindings() { throw new Error('EACCES'); } } }),
    'strict aggregate ledger propagates an unreadable findings store');
  A.notThrows(() => makeLedger({ io: { listFindings() { throw new Error('EACCES'); } } }),
    'non-aggregate detector lanes retain legacy fail-open ledger behavior');
}

/* ─── C. ledger P0/P1 counting: any open P0 or P1 blocks; P2-only passes ─── */
{
  A.eq(checkLedger({ ok: true, counts: { P0: 0, P1: 0, P2: 9 } }).ok, true, 'P2-only ledger passes (P2 does not block ready)');
  A.eq(checkLedger({ ok: true, counts: { P0: 1, P1: 0, P2: 0 } }).ok, false, 'one open P0 blocks');
  A.eq(checkLedger({ ok: true, counts: { P0: 0, P1: 2, P2: 0 } }).ok, false, 'open P1s block');
  const r = checkLedger({ ok: true, counts: { P0: 2, P1: 3, P2: 1 } });
  A.ok(/5 open blocking/.test(r.reason) && /2 P0/.test(r.reason) && /3 P1/.test(r.reason), 'reason states the exact P0/P1 blocking count');
}

/* ─── C2. ledger counting is the LEDGER's authority (openBySeverity) — fixed → NOT counted ─── */
{
  // Build a real ledger from an in-memory io; assert the SAME openBySeverity the gate consumes.
  const store = [
    { id: 'a', fingerprint: 'f1', severity: 'P0', status: 'open', title: 't', evidence: ['e'], crew: 'Green Guardian' },
    { id: 'b', fingerprint: 'f2', severity: 'P1', status: 'fixed', title: 't', evidence: ['e'], crew: 'Beginner Run' },   // fixed -> not open
    { id: 'c', fingerprint: 'f3', severity: 'P1', status: 'dismissed', title: 't', evidence: ['e'], crew: 'Janitor' },   // dismissed -> not open
    { id: 'd', fingerprint: 'f4', severity: 'P2', status: 'open', title: 't', evidence: ['e'], crew: 'Janitor' },
    { id: 'e', fingerprint: 'f5', severity: 'P1', status: 'routed', title: 't', evidence: ['e'], crew: 'Overseer' },     // routed -> still open (tracked)
  ];
  const led = makeLedger({ clock: { now: () => NOW }, io: { listFindings: () => store } });
  const counts = led.openBySeverity();
  A.eq(counts.P0, 1, 'openBySeverity counts the one open P0');
  A.eq(counts.P1, 1, 'openBySeverity excludes fixed+dismissed P1s, keeps the routed one');
  A.eq(counts.P2, 1, 'openBySeverity counts the open P2');
  A.eq(counts.blocking, 2, 'blocking = open P0 + P1');
  // feed it straight into the gate: 2 blocking -> NOT READY.
  A.eq(checkLedger({ ok: true, counts }).ok, false, 'the ledger authority feeds the gate: 2 blocking -> NOT READY');
}

/* â”€â”€â”€ C3. canonical per-bug records independently block READY â”€â”€â”€ */
{
  A.eq(checkBugRegister({ counts: { P0: 0, P1: 0, P2: 9 } }).ok, true, 'P2-only bug register passes');
  A.eq(checkBugRegister({ counts: { P0: 6, P1: 9, P2: 7 } }).ok, false, 'open P0/P1 bugs block READY');
  A.eq(checkBugRegister({ error: 'malformed frontmatter' }).ok, false, 'an invalid bug register fails closed');
  const arts = greenArtifacts();
  arts.bugs = { counts: { P0: 0, P1: 1, P2: 0 } };
  const v = evaluate(arts, greenCfg());
  A.eq(v.ready, false, 'one open P1 bug makes the aggregate NOT READY');
  A.eq(v.failing[0], 'bugs', 'bug register is named as the failing authority');
}

/* ─── D. staleness math: fresh passes, > window fails, unparseable fails-closed ─── */
{
  A.eq(freshness(FRESH, NOW, DAY_MS).ok, true, '1-minute-old stamp is fresh');
  A.eq(freshness(STALE, NOW, DAY_MS).ok, false, '26h-old stamp is stale against a 24h window');
  A.eq(freshness(iso(NOW - DAY_MS + 1000), NOW, DAY_MS).ok, true, 'just under the window is fresh');
  A.eq(freshness('not-a-date', NOW, DAY_MS).ok, false, 'an unparseable stamp is NOT fresh (fail-closed, no-fake-green)');
  A.eq(freshness('', NOW, DAY_MS).ok, false, 'an empty stamp is NOT fresh');
  A.eq(freshness(iso(NOW + 10 * 60 * 1000), NOW, DAY_MS).ok, false, 'materially future-dated evidence is rejected');
  // a stale guardian cycle (green + no drift) still fails the check.
  const g = checkGuardian({ stampIso: STALE, trunkHead: 'abc12345', result: 'green', gatesRan: ['test-fast'], gatesSkipped: [] }, greenCfg());
  A.eq(g.ok, false, 'a stale-but-green guardian cycle is NOT READY');
  A.ok(/stale/.test(g.reason), 'the reason names staleness');
}

/* ---- D2. artifact/evidence bytes are reverified against their receipt identity ---- */
{
  A.eq(verifyContentIdentity(EVIDENCE_IDENTITY, EVIDENCE_BYTES).ok, true, 'unchanged evidence bytes match their receipt digest + size');
  const tampered = Buffer.from('installed smoke evidence!', 'utf8');
  A.eq(verifyContentIdentity(EVIDENCE_IDENTITY, tampered).ok, false, 'tampered evidence bytes fail closed');
  A.eq(verifyContentIdentity(Object.assign({}, EVIDENCE_IDENTITY, { sha256: 'd'.repeat(64) }), EVIDENCE_BYTES).ok, false, 'wrong receipt SHA-256 fails closed');
  A.eq(verifyContentIdentity(Object.assign({}, EVIDENCE_IDENTITY, { size: EVIDENCE_BYTES.length + 1 }), EVIDENCE_BYTES).ok, false, 'wrong receipt size fails closed');
}

/* ─── E. guardian: not-green, skipped gates, and trunk drift each block ─── */
{
  const cfg = greenCfg();
  A.eq(checkGuardian({ stampIso: FRESH, trunkHead: 'abc12345', result: 'red', gatesRan: ['test-fast'], gatesSkipped: [] }, cfg).ok, false, 'a RED guardian cycle blocks');

  const skip = checkGuardian({ stampIso: FRESH, trunkHead: 'abc12345', result: 'green', gatesRan: ['test-fast', 'audit'], gatesSkipped: ['shoot', 'golden', 'journeys'] }, cfg);
  A.eq(skip.ok, false, 'a green cycle that SKIPPED gates (e.g. --skip-visual) cannot vouch for readiness');
  A.ok(/SKIPPED|skipped/.test(skip.reason), 'the reason names the skipped gates');

  // trunk drift: the guardian ran 4 commits behind current head -> "has not seen current trunk".
  const driftCfg = Object.assign(greenCfg(), { currentTrunk: 'def99999', trunkDrift: 4 });
  const drift = checkGuardian({ stampIso: FRESH, trunkHead: 'abc12345', result: 'green', gatesRan: ['test-fast', 'shoot', 'golden', 'audit', 'journeys'], gatesSkipped: [] }, driftCfg);
  A.eq(drift.ok, false, 'a green cycle behind current trunk is NOT READY');
  A.ok(/has not seen current trunk/.test(drift.reason), 'the reason is "guardian has not seen current trunk"');
  A.ok(/4 commit/.test(drift.reason), 'the drift distance is stated');

  // drift within tolerance passes when maxTrunkDrift is raised.
  const tolCfg = Object.assign(greenCfg(), { currentTrunk: 'def99999', trunkDrift: 2, maxTrunkDrift: 5 });
  A.eq(checkGuardian({ stampIso: FRESH, trunkHead: 'abc12345', result: 'green', gatesRan: ['test-fast', 'shoot', 'golden', 'audit', 'journeys'], gatesSkipped: [] }, tolCfg).ok, true, 'drift within maxTrunkDrift passes');

  // a git failure to compute drift is fail-closed.
  const errCfg = Object.assign(greenCfg(), { driftError: 'git rev-list failed' });
  A.eq(checkGuardian({ stampIso: FRESH, trunkHead: 'abc12345', result: 'green', gatesRan: ['test-fast', 'shoot', 'golden', 'audit', 'journeys'], gatesSkipped: [] }, errCfg).ok, false, 'a drift-compute error is fail-closed (NOT READY)');

  const falseZero = Object.assign(greenCfg(), { trunkDrift: 0 });
  A.eq(checkGuardian({ stampIso: FRESH, trunkHead: 'b'.repeat(40), result: 'green', gatesRan: ['test-fast', 'shoot', 'golden', 'audit', 'journeys'], gatesSkipped: [] }, falseZero).ok, false,
    'a different guardian SHA cannot pass merely because one-way drift was zero');
}

/* ─── F. journeys + beginner + installed check semantics ─── */
{
  const cfg = greenCfg();
  A.eq(checkJourneys({ stampIso: FRESH, trunkHead: TRUNK, result: 'pass', passed: 5, total: 5, fullSuite: true }, cfg).ok, true, 'fresh candidate-bound full journeys pass -> ok');
  for (const fullSuite of [false, undefined, 'true']) {
    A.eq(checkJourneys({ stampIso: FRESH, trunkHead: TRUNK, result: 'pass', passed: 13, total: 13, fullSuite }, cfg).ok, false,
      'a focused or unproven-scope receipt cannot satisfy release journeys');
  }
  // Exercise the producer's actual argument parser and receipt field, not just
  // injected reader fixtures: an unfiltered run uses null, not an empty Set.
  const journeySource = require('fs').readFileSync(path.join(__dirname, '../scripts/qa/journeys.mjs'), 'utf8');
  const parserStart = journeySource.indexOf('const ONLY = (() => {');
  const parserEnd = journeySource.indexOf('const J =', parserStart);
  const scopeExpression = journeySource.match(/fullSuite: ([^\r\n]+),/)[1];
  const receiptScope = new Function('process', journeySource.slice(parserStart, parserEnd) + '\nreturn ' + scopeExpression + ';');
  A.eq(receiptScope({ argv: ['node', 'journeys.mjs'] }), true, 'unfiltered producer writes a full-suite receipt');
  A.eq(receiptScope({ argv: ['node', 'journeys.mjs', '--only', 'J4'] }), false, 'filtered producer writes a partial-suite receipt');
  A.eq(checkJourneys({ stampIso: FRESH, result: 'blocked' }, cfg).ok, false, 'blocked journeys -> NOT READY');
  A.eq(checkJourneys({ stampIso: FRESH, result: 'fail' }, cfg).ok, false, 'failed journeys -> NOT READY');
  A.eq(checkJourneys({ stampIso: STALE, trunkHead: TRUNK, result: 'pass' }, cfg).ok, false, 'a stale journeys pass -> NOT READY');
  A.eq(checkJourneys({ stampIso: FRESH, result: 'pass' }, cfg).ok, false, 'journeys missing candidate SHA -> NOT READY');
  A.eq(checkJourneys({ stampIso: FRESH, trunkHead: 'b'.repeat(40), result: 'pass' }, cfg).ok, false, 'journeys on another candidate -> NOT READY');

  A.eq(checkBeginner({ stampIso: FRESH, trunkHead: TRUNK, result: 'PASS', mode: 'ui-only' }, cfg).ok, true, 'fresh candidate-bound beginner PASS -> ok');
  const stuck = checkBeginner({ stampIso: FRESH, result: 'STUCK@first-directive', mode: 'ui-only' }, cfg);
  A.eq(stuck.ok, false, 'a STUCK beginner run -> NOT READY');
  A.ok(/stuck/i.test(stuck.reason), 'the reason names the stuck fresh-user path');
  A.eq(checkBeginner({ stampIso: FRESH, result: 'FAIL' }, cfg).ok, false, 'a FAILED beginner run -> NOT READY');
  A.eq(checkBeginner({ stampIso: STALE, trunkHead: TRUNK, result: 'PASS' }, cfg).ok, false, 'a stale beginner PASS -> NOT READY');
  A.eq(checkBeginner({ stampIso: FRESH, result: 'PASS' }, cfg).ok, false, 'beginner missing candidate SHA -> NOT READY');
  A.eq(checkBeginner({ stampIso: FRESH, trunkHead: 'b'.repeat(40), result: 'PASS' }, cfg).ok, false, 'beginner on another candidate -> NOT READY');

  // installed uses the 7-day window, not 24h.
  const installed = greenArtifacts().installed;
  A.eq(checkInstalled(Object.assign({}, installed, { stampIso: iso(NOW - 5 * DAY_MS) }), cfg).ok, true, '5-day-old v3 desktop GREEN smoke is fresh (7d window)');
  A.eq(checkInstalled(Object.assign({}, installed, { stampIso: iso(NOW - 8 * DAY_MS) }), cfg).ok, false, '8-day-old installed smoke is stale (> 7d)');
  A.eq(checkInstalled(Object.assign({}, installed, { stampIso: FRESH, result: 'RED' }), cfg).ok, false, 'a RED installed smoke -> NOT READY');
  A.eq(checkInstalled(Object.assign({}, installed, { stampIso: FRESH, result: 'BLOCKED' }), cfg).ok, false, 'a BLOCKED installed smoke -> NOT READY');
  A.eq(checkInstalled(Object.assign({}, installed, { mode: 'browser' }), cfg).ok, false, 'browser-mode installed receipt is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { buildCommit: 'c'.repeat(40) }), cfg).ok, false, 'binary built from another commit is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { sourceTree: 'c'.repeat(40) }), cfg).ok, false, 'binary built from another source tree is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { buildKind: 'dirty-dev', provenanceKind: 'dirty-dev' }), cfg).ok, false, 'dirty-dev classification is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { provenanceKind: 'official', officialEvidenceVerified: false }), cfg).ok, false, 'hand-asserted official classification is rejected');
  const officialEvidence = {
    schemaVersion: 1, candidateCommit: TRUNK, sourceTree: TREE,
    artifact: { sha256: installed.artifact.sha256, size: installed.artifact.size },
    authority: 'release-attestation-verifier', verificationId: 'attestation-123'
  };
  A.eq(checkInstalled(Object.assign({}, installed, { provenanceKind: 'official', officialEvidence, officialEvidenceVerified: true }), cfg).ok, true, 'host-reverified exact official evidence is accepted');
  A.eq(checkInstalled(Object.assign({}, installed, { buildKind: 'custom', provenanceKind: 'custom' }), cfg).ok, true, 'an exact clean custom open-source build is accepted as custom');
  A.eq(checkInstalled(Object.assign({}, installed, { runtimeExecutable: null }), cfg).ok, false, 'missing runtime executable identity is rejected');
  const differentRuntime = { sha256: 'd'.repeat(64), size: installed.artifact.size };
  A.eq(checkInstalled(Object.assign({}, installed, { runtimeExecutable: differentRuntime }), cfg).ok, false, 'supplied artifact whose SHA-256 differs from the running executable is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { runtimeExecutable: { sha256: installed.artifact.sha256, size: installed.artifact.size + 1 } }), cfg).ok, false, 'supplied artifact whose size differs from the running executable is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { artifactVerified: false }), cfg).ok, false, 'missing/mismatched artifact is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { evidenceVerified: false, evidenceError: 'probe.json: file SHA-256 does not match receipt' }), cfg).ok, false, 'tampered content-bound evidence is rejected');
  A.eq(checkInstalled(Object.assign({}, installed, { schemaVersion: 2 }), cfg).ok, false, 'legacy installed receipt is rejected');
  A.ok(/installed app unverified/.test(checkInstalled({ missing: true }, cfg).reason), 'a missing installed smoke reads "installed app unverified"');
}

/* ---- F2. W0 can inspect installed identity without invoking the broad READY aggregate ---- */
{
  const repoRoot = path.resolve('C:/virtual-starnet');
  const receiptPath = path.join(repoRoot, 'qa', 'installed', 'last-smoke.json');
  const artifactPath = path.join(repoRoot, 'StarNet.exe');
  const evidencePath = path.join(repoRoot, EVIDENCE_IDENTITY.path);
  const artifactBytes = Buffer.from('exact running StarNet executable', 'utf8');
  const artifactIdentity = {
    path: artifactPath,
    sha256: crypto.createHash('sha256').update(artifactBytes).digest('hex'),
    size: artifactBytes.length,
  };
  const receipt = Object.assign({}, greenArtifacts().installed, {
    stampIso: FRESH,
    artifact: artifactIdentity,
    runtimeExecutable: { sha256: artifactIdentity.sha256, size: artifactIdentity.size },
    evidence: [EVIDENCE_IDENTITY],
  });
  delete receipt.artifactVerified;
  delete receipt.evidenceVerified;

  const files = new Map([
    [path.resolve(receiptPath), Buffer.from(JSON.stringify(receipt), 'utf8')],
    [path.resolve(artifactPath), artifactBytes],
    [path.resolve(evidencePath), EVIDENCE_BYTES],
  ]);
  const io = {
    existsSync(file) { return files.has(path.resolve(file)); },
    statSync(file) {
      if (!files.has(path.resolve(file))) throw new Error('ENOENT');
      return { isFile: () => true };
    },
    readFileSync(file, encoding) {
      const value = files.get(path.resolve(file));
      if (!value) throw new Error('ENOENT');
      return encoding ? value.toString(encoding) : Buffer.from(value);
    },
  };
  const opts = { repoRoot, receiptPath, candidateSha: TRUNK, nowMs: NOW, io, resolveCandidateTree: () => TREE };
  const inspected = inspectInstalledIdentity(opts);
  A.eq(inspected.ok, true, 'host-callable installed inspector accepts an exact content-bound receipt');
  A.eq(inspected.status, 'PASS', 'installed inspector returns a standalone PASS status');
  A.eq(inspected.reasons, [], 'standalone PASS has no reasons');

  const officialReceipt = Object.assign({}, receipt, {
    provenanceKind: 'official',
    officialEvidence: {
      schemaVersion: 1, candidateCommit: TRUNK, sourceTree: TREE,
      artifact: { sha256: artifactIdentity.sha256, size: artifactIdentity.size },
      authority: 'release-attestation-verifier', verificationId: 'attestation-123'
    }
  });
  files.set(path.resolve(receiptPath), Buffer.from(JSON.stringify(officialReceipt), 'utf8'));
  A.eq(inspectInstalledIdentity(opts).ok, false, 'standalone inspector rejects official receipt without an external verifier');
  const externallyVerified = inspectInstalledIdentity(Object.assign({}, opts, {
    verifyOfficialEvidence: (_normalized, raw) => ({
      ok: raw.verificationId === 'attestation-123',
      authority: raw.authority,
      verificationId: raw.verificationId,
    })
  }));
  A.eq(externallyVerified.ok, true, 'standalone inspector re-verifies exact official evidence through the host verifier');

  files.set(path.resolve(receiptPath), Buffer.from(JSON.stringify(receipt), 'utf8'));

  files.set(path.resolve(evidencePath), Buffer.from('tampered evidence', 'utf8'));
  const tampered = inspectInstalledIdentity(opts);
  A.eq(tampered.ok, false, 'standalone inspector rehashes and rejects tampered evidence');
  A.ok(tampered.reasons.some(reason => /evidence/i.test(reason)), 'standalone inspector explains the evidence failure');
}

/* ─── G. aggregation: multiple failures are all numbered, in check order ─── */
{
  const arts = greenArtifacts();
  arts.ledger = { ok: true, counts: { P0: 1, P1: 0, P2: 0 } };  // fail 1
  arts.beginner = { stampIso: FRESH, result: 'STUCK@first-directive' }; // fail
  arts.installed = { missing: true }; // fail
  const v = evaluate(arts, greenCfg());
  A.eq(v.ready, false, 'multiple failures -> NOT READY');
  A.eq(v.failing.length, 3, 'three checks fail');
  A.eq(JSON.stringify(v.failing), JSON.stringify(['ledger', 'beginner', 'installed']), 'failures listed in fixed check order');
  A.ok(v.reasons[0].startsWith('1.') && v.reasons[1].startsWith('2.') && v.reasons[2].startsWith('3.'), 'reasons are numbered 1..3');
}

/* ─── H. renderVerdict: READY banner vs NOT READY + numbered reasons + receipts block ─── */
{
  const ready = renderVerdict(evaluate(greenArtifacts(), greenCfg()));
  A.ok(/^READY/.test(ready), 'a green verdict renders a READY banner');
  A.ok(/receipts:/.test(ready), 'the receipts block is always present');
  A.ok(/\[PASS\] Ledger open P0\/P1/.test(ready), 'each check line shows its PASS/FAIL + label');

  const arts = greenArtifacts();
  arts.installed = { missing: true };
  const notReady = renderVerdict(evaluate(arts, greenCfg()));
  A.ok(/^NOT READY — 1 reason/.test(notReady), 'a failing verdict renders NOT READY with the reason count');
  A.ok(/installed app unverified/.test(notReady), 'the human-readable reason is in the render');
  A.ok(/\[FAIL\] Installed-exe smoke/.test(notReady), 'the failing check is marked FAIL in receipts');
}

/* ─── I. humanAge is coarse + monotonic across the boundaries it uses ─── */
{
  A.eq(humanAge(30 * 1000), '30s', 'seconds under 90s');
  A.eq(humanAge(20 * 60 * 1000), '20m', 'minutes');
  A.eq(humanAge(26 * 60 * 60 * 1000), '26h', 'hours');
  A.eq(humanAge(9 * DAY_MS), '9d', 'days');
}

A.report('qa-ready.test');
