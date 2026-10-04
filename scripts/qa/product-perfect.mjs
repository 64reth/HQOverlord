#!/usr/bin/env node
/* StarNet product-perfection controller.
 *
 * The tracked manifest defines goals; this program derives state from verifier receipts. A receipt
 * is valid only for an exact clean commit and the exact manifest/wave definition. Source or policy
 * drift therefore re-queues proof automatically. There is intentionally no mutable "done" flag.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeLedger } from './ledger.mjs';
import { makeCartographer, AREAS as ATLAS_AREAS } from './cartographer.mjs';
import { inspectInstalledIdentity } from './ready.mjs';
import { inspectClaimsAuthority } from './product-perfect/claims.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'qa', 'product-perfect', 'waves.json');
export const DEFAULT_RUNTIME_DIR = path.join(REPO_ROOT, '.dogfood', 'product-perfect');
const RECEIPT_SCHEMA = 1;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const EXPECTED_WAVES = Object.freeze([
  ['W0', 'proof-authority', 86400000, 'scripts/qa/product-perfect/gates/wave-0-proof-authority.mjs'],
  ['W1', 'installed-first-run', 86400000, 'scripts/qa/product-perfect/gates/wave-1-installed-first-run.mjs'],
  ['W2', 'security-trust', 86400000, 'scripts/qa/product-perfect/gates/wave-2-security-trust.mjs'],
  ['W3', 'last-mile-recovery', 86400000, 'scripts/qa/product-perfect/gates/wave-3-last-mile-recovery.mjs'],
  ['W4', 'capability-enforcement', 86400000, 'scripts/qa/product-perfect/gates/wave-4-capability-enforcement.mjs'],
  ['W5', 'autonomy-honesty', 86400000, 'scripts/qa/product-perfect/gates/wave-5-autonomy-honesty.mjs'],
  ['W6', 'integration-full-proof', 21600000, 'scripts/qa/product-perfect/gates/wave-6-integration-full-proof.mjs'],
  ['W7', 'frozen-candidate', 3600000, 'scripts/qa/product-perfect/gates/wave-7-frozen-candidate.mjs']
]);
const EXPECTED_POLICY = Object.freeze({
  serialization: 'first-non-pass',
  candidateBinding: 'exact-commit-and-wave-definition',
  unverifiable: 'blocked',
  staleEvidence: 'requeue',
  publishAuthorized: false
});
const AUTHORITY_IDS = Object.freeze([
  'installed', 'claimsPlanning', 'claimsTerminal', 'ready', 'ledger', 'atlas'
]);

function str(value) { return value == null ? '' : String(value); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export function definitionHash(value) { return sha256(stableJson(value)); }

export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, errors: ['manifest must be an object'] };
  if (manifest.schemaVersion !== 1) errors.push('manifest schemaVersion must be 1');
  if (manifest.campaign !== 'StarNet product perfection') errors.push('manifest campaign must be StarNet product perfection');
  if (manifest.terminalVerdict !== 'PRODUCT PERFECT') errors.push('terminalVerdict must be PRODUCT PERFECT');
  if (stableJson(manifest.policy) !== stableJson(EXPECTED_POLICY)) errors.push('manifest policy does not match the locked non-publishing controller policy');
  if (!Array.isArray(manifest.waves) || manifest.waves.length !== EXPECTED_WAVES.length) {
    errors.push('manifest must contain the exact W0-W7 campaign');
  }
  const seen = new Set();
  for (let index = 0; index < (Array.isArray(manifest.waves) ? manifest.waves.length : 0); index += 1) {
    const wave = manifest.waves[index] || {};
    const label = 'waves[' + index + ']';
    const expectedWave = EXPECTED_WAVES[index];
    if (!expectedWave || wave.id !== expectedWave[0]) errors.push(label + '.id must preserve exact W0-W7 order');
    if (!expectedWave || wave.slug !== expectedWave[1]) errors.push(label + '.slug does not match the locked wave');
    if (!/^[A-Z][A-Z0-9-]*$/.test(str(wave.id))) errors.push(label + '.id must be a stable uppercase ID');
    if (seen.has(wave.id)) errors.push(label + '.id is duplicated: ' + wave.id);
    seen.add(wave.id);
    if (!str(wave.name).trim()) errors.push(label + '.name is required');
    if (!str(wave.goal).trim()) errors.push(label + '.goal is required');
    if (!Array.isArray(wave.conditions) || wave.conditions.length === 0 || wave.conditions.some(item => !str(item).trim())) {
      errors.push(label + '.conditions must contain non-blank conditions');
    }
    if (!Array.isArray(wave.dependsOn)) errors.push(label + '.dependsOn must be an array');
    else {
      const expected = index === 0 ? [] : [manifest.waves[index - 1] && manifest.waves[index - 1].id];
      if (stableJson(wave.dependsOn) !== stableJson(expected)) {
        errors.push(label + '.dependsOn must serialize the campaign (' + expected.join(', ') + ')');
      }
    }
    const command = wave.verifier && wave.verifier.command;
    if (!Array.isArray(command) || command.length < 2 || command.some(part => !str(part).trim())) {
      errors.push(label + '.verifier.command must be a non-empty argv array');
    }
    if (!expectedWave || stableJson(command) !== stableJson(['node', expectedWave[3]])) {
      errors.push(label + '.verifier.command must use the locked repository verifier');
    }
    const timeoutMs = Number(wave.verifier && wave.verifier.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) errors.push(label + '.verifier.timeoutMs must be at least 1000');
    const maxReceiptAgeMs = Number(wave.maxReceiptAgeMs);
    if (!expectedWave || maxReceiptAgeMs !== expectedWave[2]) errors.push(label + '.maxReceiptAgeMs does not match the locked freshness window');
  }
  return { ok: errors.length === 0, errors };
}

function receiptPayload(receipt) {
  const copy = Object.assign({}, receipt);
  delete copy.attestation;
  return stableJson(copy);
}

function normalizeKey(key) {
  if (Buffer.isBuffer(key) && key.length >= 32) return key;
  if (typeof key === 'string' && /^[0-9a-f]{64}$/i.test(key)) return Buffer.from(key, 'hex');
  return null;
}

export function sealReceipt(receipt, key) {
  const normalized = normalizeKey(key);
  if (!normalized) throw new Error('receipt HMAC key must contain at least 32 bytes');
  const unsigned = Object.assign({}, receipt);
  delete unsigned.attestation;
  return Object.assign(unsigned, {
    attestation: {
      algorithm: 'HMAC-SHA256',
      keyId: sha256(normalized).slice(0, 16),
      digest: crypto.createHmac('sha256', normalized).update(receiptPayload(unsigned)).digest('hex')
    }
  });
}

function expectedEvidencePath(candidateSha, waveId, stream) {
  return ['receipts', candidateSha, waveId + '.' + stream + '.log'].join('/');
}

function readEvidenceEntry(entry, context) {
  if (typeof context.readEvidence === 'function') return context.readEvidence(entry);
  if (!context.runtimeDir) throw new Error('evidence root unavailable');
  const root = path.resolve(context.runtimeDir);
  const resolved = path.resolve(root, str(entry.path).split('/').join(path.sep));
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('evidence path escapes runtime root');
  return fs.readFileSync(resolved);
}

export function receiptValidity(receipt, context) {
  const errors = [];
  context = context || {};
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return { ok: false, errors: ['receipt missing or unreadable'] };
  if (receipt.schemaVersion !== RECEIPT_SCHEMA) errors.push('receipt schema mismatch');
  if (receipt.result !== 'PASS') errors.push('receipt result is ' + (receipt.result || 'missing'));
  if (receipt.waveId !== context.wave.id) errors.push('wave ID mismatch');
  if (receipt.candidateSha !== context.candidate.sha) errors.push('candidate commit mismatch');
  if (receipt.manifestHash !== context.manifestHash) errors.push('manifest definition changed');
  if (receipt.waveDefinitionHash !== definitionHash(context.wave)) errors.push('wave definition changed');
  if (!context.candidate.clean) errors.push('working tree is dirty');
  if (!Number.isInteger(receipt.exitCode) || receipt.exitCode !== 0) errors.push('verifier did not exit zero');
  if (stableJson(receipt.verifier) !== stableJson(context.wave.verifier.command)) errors.push('verifier argv mismatch');
  const startedMs = Date.parse(str(receipt.startedAt));
  const finishedMs = Date.parse(str(receipt.finishedAt));
  const nowMs = Number.isFinite(Number(context.nowMs)) ? Number(context.nowMs) : Date.now();
  if (!Number.isFinite(startedMs)) errors.push('startedAt missing or invalid');
  if (!Number.isFinite(finishedMs)) errors.push('finishedAt missing or invalid');
  if (Number.isFinite(startedMs) && Number.isFinite(finishedMs) && finishedMs < startedMs) errors.push('receipt timestamps are reversed');
  if (Number.isFinite(startedMs) && startedMs > nowMs + FUTURE_SKEW_MS) errors.push('receipt starts in the future');
  if (Number.isFinite(finishedMs) && finishedMs > nowMs + FUTURE_SKEW_MS) errors.push('receipt finishes in the future');
  if (Number.isFinite(finishedMs) && nowMs - finishedMs > Number(context.wave.maxReceiptAgeMs)) errors.push('receipt is stale');

  const key = normalizeKey(context.key);
  const attestation = receipt.attestation || {};
  if (!key) errors.push('receipt HMAC key unavailable');
  else if (attestation.algorithm !== 'HMAC-SHA256' || attestation.keyId !== sha256(key).slice(0, 16) || !/^[0-9a-f]{64}$/i.test(str(attestation.digest))) {
    errors.push('receipt attestation missing or invalid');
  } else {
    const expected = crypto.createHmac('sha256', key).update(receiptPayload(receipt)).digest('hex');
    const actual = str(attestation.digest).toLowerCase();
    if (!crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) errors.push('receipt HMAC mismatch');
  }

  const output = receipt.verifierOutput;
  for (const stream of ['stdout', 'stderr']) {
    const entry = output && output[stream];
    const expectedPath = expectedEvidencePath(context.candidate.sha, context.wave.id, stream);
    if (!entry || entry.path !== expectedPath || !Number.isInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/i.test(str(entry.sha256))) {
      errors.push(stream + ' evidence descriptor missing or invalid');
      continue;
    }
    try {
      const content = readEvidenceEntry(entry, context);
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(str(content));
      if (buffer.length !== entry.bytes || sha256(buffer) !== str(entry.sha256).toLowerCase()) errors.push(stream + ' evidence hash/size mismatch');
    } catch (error) {
      errors.push(stream + ' evidence unreadable: ' + error.message);
    }
  }
  return { ok: errors.length === 0, errors };
}

function normalizedAuthorities(authorities) {
  const out = {};
  for (const id of AUTHORITY_IDS) {
    const value = authorities && authorities[id];
    out[id] = value && typeof value === 'object'
      ? value
      : { ok: false, status: 'BLOCKED', reasons: [id + ' authority unavailable'] };
    if (!Array.isArray(out[id].reasons)) out[id].reasons = out[id].reason ? [str(out[id].reason)] : [];
  }
  return out;
}

function authorityErrorsForWave(waveId, authorities) {
  const required = waveId === 'W0' ? ['installed', 'claimsPlanning']
    : waveId === 'W6' ? ['claimsTerminal', 'ledger', 'atlas']
      : waveId === 'W7' ? ['ready'] : [];
  const errors = [];
  for (const id of required) {
    const authority = authorities[id];
    if (authority.ok === true) continue;
    const reasons = authority.reasons.length ? authority.reasons : [id + ' authority is not green'];
    for (const reason of reasons) errors.push(id + ': ' + reason);
  }
  return errors;
}

export function deriveStatus(manifest, candidate, receiptsByWave, authorityInput, receiptContext = {}) {
  const authorities = normalizedAuthorities(authorityInput);
  const validation = validateManifest(manifest);
  if (!validation.ok) {
    return {
      productPerfect: false,
      verdict: 'NOT PRODUCT PERFECT',
      currentWave: null,
      candidate,
      manifestErrors: validation.errors,
      waves: [],
      authorities,
      nextAction: 'Repair the product-perfect manifest before running any wave.'
    };
  }
  const manifestHash = definitionHash(manifest);
  const waves = [];
  let previousPass = true;
  let currentWave = null;
  for (const wave of manifest.waves) {
    const receipt = receiptsByWave && receiptsByWave[wave.id];
    const validity = receiptValidity(receipt, Object.assign({}, receiptContext, { wave, candidate, manifestHash }));
    const authorityErrors = authorityErrorsForWave(wave.id, authorities);
    const passes = validity.ok && authorityErrors.length === 0;
    let status = 'pending';
    let reasons = [];
    if (previousPass) {
      if (passes) status = 'pass';
      else {
        status = receipt && receipt.result === 'FAIL' ? 'fail'
          : receipt && receipt.result === 'BLOCKED' ? 'blocked'
            : receipt ? 'blocked' : (candidate.clean ? 'pending' : 'blocked');
        reasons = validity.errors.concat(authorityErrors);
        if (!currentWave) currentWave = wave.id;
        previousPass = false;
      }
    } else {
      status = 'pending';
      reasons = ['dependency not current and passing'];
    }
    waves.push({
      id: wave.id,
      name: wave.name,
      status,
      goal: wave.goal,
      reasons,
      receipt: receipt ? {
        result: receipt.result,
        candidateSha: receipt.candidateSha,
        finishedAt: receipt.finishedAt,
        exitCode: receipt.exitCode
      } : null
    });
  }
  const authorityPerfect = AUTHORITY_IDS.every(id => authorities[id].ok === true);
  let productPerfect = waves.length > 0 && waves.every(wave => wave.status === 'pass') && authorityPerfect;
  if (!productPerfect && !currentWave && !authorityPerfect) {
    const targetId = manifest.waves.some(wave => wave.id === 'W6') ? 'W6' : manifest.waves[manifest.waves.length - 1].id;
    const row = waves.find(wave => wave.id === targetId);
    if (row) {
      row.status = 'blocked';
      row.reasons = ['terminal authorities are not all green'];
      currentWave = targetId;
    }
  }
  const active = manifest.waves.find(wave => wave.id === currentWave);
  return {
    productPerfect,
    verdict: productPerfect ? str(manifest.terminalVerdict || 'PRODUCT PERFECT') : 'NOT PRODUCT PERFECT',
    currentWave: productPerfect ? null : currentWave,
    candidate,
    manifestHash,
    authorities,
    waves,
    nextAction: productPerfect
      ? 'Pause the controller and report the immutable candidate receipt. Do not publish.'
      : active
        ? 'Run and repair ' + active.id + ' — ' + active.name + ': ' + active.goal
        : 'Repair unverifiable campaign state.'
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return null; }
}

function git(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true });
  return { code: result.status, out: str(result.stdout).trim(), err: str(result.stderr).trim(), error: result.error };
}

export function currentCandidate() {
  const head = git(['rev-parse', 'HEAD']);
  if (head.code !== 0 || !/^[0-9a-f]{40}$/i.test(head.out)) throw new Error('could not resolve exact Git HEAD: ' + (head.err || (head.error && head.error.message) || 'unknown error'));
  const status = git(['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status.code !== 0) throw new Error('could not inspect working tree: ' + (status.err || (status.error && status.error.message) || 'unknown error'));
  return candidateFromGitStatus(head.out.toLowerCase(), status.out);
}

export function candidateFromGitStatus(sha, statusOutput) {
  const allDirtyPaths = str(statusOutput) ? str(statusOutput).split(/\r?\n/).filter(Boolean) : [];
  // git() trims stdout, so the first porcelain line may lose its leading blank status column
  // (` M path` becomes `M path`). Recover the path from either valid shape. Only generated,
  // non-authoritative dashboards are operational; Atlas shards and every other qa/ file are source.
  const porcelainPath = (line) => line[2] === ' ' ? line.slice(3) : line[1] === ' ' ? line.slice(2) : line;
  const operational = new Set(['qa/STATUS.md', 'qa/atlas/ATLAS.md']);
  const operationalDirtyPaths = allDirtyPaths.filter(line => operational.has(porcelainPath(line)));
  const dirtyPaths = allDirtyPaths.filter(line => !operational.has(porcelainPath(line)));
  return { sha: str(sha).toLowerCase(), clean: dirtyPaths.length === 0, dirtyPaths, operationalDirtyPaths };
}

function inspectReadyAuthority() {
  const result = spawnSync(process.execPath, ['scripts/qa/ready.mjs', '--json'], {
    cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 16 * 1024 * 1024
  });
  let verdict = null;
  try { verdict = JSON.parse(str(result.stdout)); } catch (_) {}
  if (!verdict || typeof verdict !== 'object') {
    return { ok: false, status: 'BLOCKED', reasons: ['READY verdict missing or unreadable'] };
  }
  const reasons = Array.isArray(verdict.reasons) ? verdict.reasons.map(str) : [];
  const ok = result.status === 0 && verdict.ready === true;
  return {
    ok,
    status: ok ? 'PASS' : 'FAIL',
    reasons: ok ? [] : (reasons.length ? reasons : ['READY did not pass']),
    failing: Array.isArray(verdict.failing) ? verdict.failing : [],
    generatedAt: verdict.generatedAt || '',
    trunk: verdict.trunk || null
  };
}

function inspectLedgerAuthority() {
  const findingsDir = path.join(REPO_ROOT, 'qa', 'findings');
  const knownFile = path.join(REPO_ROOT, 'qa', 'KNOWN_ISSUES.md');
  try {
    const names = fs.readdirSync(findingsDir).filter(name => name.endsWith('.json'));
    const findings = names.map(name => {
      try { return JSON.parse(fs.readFileSync(path.join(findingsDir, name), 'utf8')); }
      catch (error) { throw new Error('finding unreadable ' + name + ': ' + error.message); }
    });
    const knownText = fs.readFileSync(knownFile, 'utf8');
    const known = new Set();
    const regex = /fingerprint[:=]\s*`?([0-9a-fA-F]{6,})`?/g;
    let match; while ((match = regex.exec(knownText))) known.add(match[1].toLowerCase());
    const ledger = makeLedger({
      strictRead: true,
      clock: { now: () => Date.now() },
      io: { listFindings: () => findings, knownFingerprints: () => known }
    });
    if (typeof ledger.openBySeverity !== 'function') throw new Error('ledger.openBySeverity unavailable');
    const counts = ledger.openBySeverity();
    const normalized = { P0: Number(counts.P0) || 0, P1: Number(counts.P1) || 0, P2: Number(counts.P2) || 0 };
    const open = normalized.P0 + normalized.P1 + normalized.P2;
    return {
      ok: open === 0,
      status: open === 0 ? 'PASS' : 'FAIL',
      reasons: open === 0 ? [] : [normalized.P0 + ' P0 · ' + normalized.P1 + ' P1 · ' + normalized.P2 + ' P2 open'],
      counts: normalized,
      open
    };
  } catch (error) {
    return { ok: false, status: 'BLOCKED', reasons: ['ledger authority unreadable: ' + error.message] };
  }
}

function inspectAtlasAuthority(candidate) {
  const areasDir = path.join(REPO_ROOT, 'qa', 'atlas', 'areas');
  const sweepFile = path.join(REPO_ROOT, '.uiatlas', 'sweep-report.json');
  const cartographer = makeCartographer({
    clock: { now: () => Date.now() },
    git: {
      logSince(sha, files) {
        if (!/^[0-9a-f]{40}$/i.test(str(sha)) || !Array.isArray(files) || files.length === 0) throw new Error('invalid staleness input');
        const result = git(['log', '--oneline', str(sha) + '..' + candidate.sha, '--'].concat(files.map(str)));
        if (result.code !== 0 || result.error) throw new Error(result.err || (result.error && result.error.message) || 'git log failed');
        return result.out;
      }
    }
  });
  try {
    const shards = {};
    const names = fs.readdirSync(areasDir).filter(name => name.endsWith('.json'));
    for (const name of names) {
      let shard;
      try { shard = JSON.parse(fs.readFileSync(path.join(areasDir, name), 'utf8')); }
      catch (error) { throw new Error('shard unreadable ' + name + ': ' + error.message); }
      const fileArea = name.replace(/\.json$/, '');
      if (!shard || typeof shard !== 'object' || str(shard.area) !== fileArea || !Array.isArray(shard.entries)) {
        throw new Error('malformed shard ' + name);
      }
      for (const entry of shard.entries) cartographer.validateEntry(entry, name + '#' + str(entry && entry.id));
      shards[fileArea] = shard;
    }
    const missingAreas = ATLAS_AREAS.filter(area => !Object.prototype.hasOwnProperty.call(shards, area));
    const emptyAreas = ATLAS_AREAS.filter(area => shards[area] && shards[area].entries.length === 0);
    cartographer.validateShardSet(shards, ATLAS_AREAS);
    const derived = cartographer.deriveStatus(shards);
    const reasons = [];
    if (missingAreas.length) reasons.push('required area shard(s) missing: ' + missingAreas.join(', '));
    if (emptyAreas.length) reasons.push('required area shard(s) empty: ' + emptyAreas.join(', '));
    if (derived.total <= 0) reasons.push('registry inventory is empty');
    if (derived.perfectedFresh !== derived.total) reasons.push(derived.markdown);
    const backlog = ['unmapped', 'mapped', 'audited', 'stale', 'missing']
      .map(id => id + '=' + (Number(derived.byStatus[id]) || 0)).join(' · ');
    if (['unmapped', 'mapped', 'audited', 'stale', 'missing'].some(id => Number(derived.byStatus[id]) > 0)) reasons.push(backlog);

    const sweep = readJson(sweepFile);
    const sweepReasons = [];
    if (!sweep) sweepReasons.push('full sweep receipt missing or unreadable');
    else {
      if (sweep.schemaVersion !== 1) sweepReasons.push('full sweep receipt schema is not v1');
      if (sweep.result !== 'GREEN') sweepReasons.push('full sweep result is not GREEN');
      if (sweep.staticOnly !== false) sweepReasons.push('latest sweep was not full/live');
      if (str(sweep.sha).toLowerCase() !== candidate.sha) sweepReasons.push('full sweep is not bound to current candidate');
      if (Number(sweep.missingCount) !== 0) sweepReasons.push('full sweep reported missing entries');
      for (const area of ATLAS_AREAS) {
        if (!sweep.byArea || !(Number(sweep.byArea[area]) > 0)) sweepReasons.push('full sweep did not enumerate area ' + area);
      }
    }
    reasons.push(...sweepReasons);
    const structurallyBlocked = missingAreas.length > 0 || emptyAreas.length > 0 || sweepReasons.length > 0;
    return {
      ok: reasons.length === 0,
      status: reasons.length === 0 ? 'PASS' : (structurallyBlocked ? 'BLOCKED' : 'FAIL'),
      reasons,
      total: derived.total,
      perfectedFresh: derived.perfectedFresh,
      pct: derived.pct,
      byStatus: derived.byStatus,
      areas: derived.areas,
      missingAreas,
      sweep: sweep ? { schemaVersion: sweep.schemaVersion, result: sweep.result, sha: sweep.sha, ranAt: sweep.ranAt, staticOnly: sweep.staticOnly } : null
    };
  } catch (error) {
    return { ok: false, status: 'BLOCKED', reasons: ['Atlas authority unreadable: ' + error.message] };
  }
}

const AUTHORITY_STAGE_RANK = Object.freeze({ W0: 0, W6: 6, W7: 7 });

function deferredAuthority(id, wave) {
  return {
    ok: false,
    status: 'DEFERRED',
    reasons: [id + ' authority is not inspected before ' + wave]
  };
}

function inspectAuthority(id, run) {
  try {
    const result = run();
    if (!result || typeof result !== 'object') throw new Error('inspector returned no verdict');
    return result;
  } catch (error) {
    return { ok: false, status: 'BLOCKED', reasons: [id + ' authority unreadable: ' + str(error && error.message || error)] };
  }
}

export function authorityStageForStatus(status) {
  if (status && (status.productPerfect === true || status.currentWave === 'W7')) return 'W7';
  if (status && status.currentWave === 'W6') return 'W6';
  return 'W0';
}

export function inspectAuthorities(candidate, options = {}) {
  const throughWave = Object.prototype.hasOwnProperty.call(AUTHORITY_STAGE_RANK, options.throughWave)
    ? options.throughWave : 'W0';
  const rank = AUTHORITY_STAGE_RANK[throughWave];
  const inspectors = options.inspectors || {};
  const installed = inspectAuthority('installed', () => inspectors.installed
    ? inspectors.installed(candidate, options)
    : inspectInstalledIdentity({
        repoRoot: REPO_ROOT,
        receiptPath: path.join(REPO_ROOT, 'qa', 'installed', 'last-smoke.json'),
        candidateSha: candidate.sha,
        nowMs: options.nowMs
      }));
  const claims = inspectAuthority('claims', () => inspectors.claims
    ? inspectors.claims(candidate, options)
    : inspectClaimsAuthority({ repoRoot: REPO_ROOT, candidateCommit: candidate.sha }));
  const claimsPlanning = claims.planning && typeof claims.planning === 'object'
    ? claims.planning : { ok: false, status: 'BLOCKED', reasons: ['claims planning verdict unavailable'] };
  const claimsTerminal = claims.terminal && typeof claims.terminal === 'object'
    ? claims.terminal : { ok: false, status: 'BLOCKED', reasons: ['claims terminal verdict unavailable'] };
  const ledger = rank >= AUTHORITY_STAGE_RANK.W6
    ? inspectAuthority('ledger', () => inspectors.ledger ? inspectors.ledger(candidate, options) : inspectLedgerAuthority())
    : deferredAuthority('ledger', 'W6');
  const atlas = rank >= AUTHORITY_STAGE_RANK.W6
    ? inspectAuthority('atlas', () => inspectors.atlas ? inspectors.atlas(candidate, options) : inspectAtlasAuthority(candidate))
    : deferredAuthority('atlas', 'W6');
  const ready = rank >= AUTHORITY_STAGE_RANK.W7
    ? inspectAuthority('ready', () => inspectors.ready ? inspectors.ready(candidate, options) : inspectReadyAuthority())
    : deferredAuthority('ready', 'W7');
  return { installed, claimsPlanning, claimsTerminal, ready, ledger, atlas };
}

export function inspectCampaignState(manifest, candidate, receipts, receiptContext = {}, options = {}) {
  let stage = 'W0';
  let authorities;
  let status;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    authorities = inspectAuthorities(candidate, Object.assign({}, options, { throughWave: stage }));
    status = deriveStatus(manifest, candidate, receipts, authorities, receiptContext);
    const nextStage = authorityStageForStatus(status);
    if (AUTHORITY_STAGE_RANK[nextStage] <= AUTHORITY_STAGE_RANK[stage]) break;
    stage = nextStage;
  }
  return { authorities, status, stage };
}

function receiptDir(runtimeDir, candidate) { return path.join(runtimeDir, 'receipts', candidate.sha); }
function receiptFile(runtimeDir, candidate, waveId) { return path.join(receiptDir(runtimeDir, candidate), waveId + '.json'); }
function keyFile(runtimeDir) { return path.join(runtimeDir, 'receipt-hmac.key'); }

export function loadReceiptKey(runtimeDir = DEFAULT_RUNTIME_DIR, { create = false } = {}) {
  const file = keyFile(runtimeDir);
  try {
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error('receipt HMAC key has invalid length');
    return key;
  } catch (error) {
    if (!create || (error && error.code && error.code !== 'ENOENT')) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key, { flag: 'wx', mode: 0o600 });
    return key;
  }
}

export function loadReceipts(manifest, candidate, runtimeDir = DEFAULT_RUNTIME_DIR) {
  const out = {};
  for (const wave of manifest.waves || []) {
    const receipt = readJson(receiptFile(runtimeDir, candidate, wave.id));
    if (receipt) out[wave.id] = receipt;
  }
  return out;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

function persistOutput(runtimeDir, candidate, wave, stream, value) {
  const text = str(value);
  const relative = expectedEvidencePath(candidate.sha, wave.id, stream);
  const file = path.join(runtimeDir, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  const content = fs.readFileSync(file);
  return { path: relative, bytes: content.length, sha256: sha256(content) };
}

function resolveVerifier(command) {
  const argv = command.map(str);
  let executable = argv[0];
  const args = argv.slice(1);
  if (executable === 'node') executable = process.execPath;
  if (executable === process.execPath && args[0] && !path.isAbsolute(args[0])) {
    const script = path.resolve(REPO_ROOT, args[0]);
    if (!fs.existsSync(script)) return { blocked: 'verifier script is missing: ' + args[0], executable, args };
  }
  return { executable, args };
}

export function runWaveVerifier(manifest, wave, candidate, runtimeDir = DEFAULT_RUNTIME_DIR, options = {}) {
  const now = typeof options === 'function' ? options : (options.now || (() => new Date()));
  const key = typeof options === 'function' ? null : normalizeKey(options.key);
  if (!key) throw new Error('receipt HMAC key unavailable; verifier cannot issue authoritative proof');
  const manifestHash = definitionHash(manifest);
  const waveDefinitionHash = definitionHash(wave);
  const startedAt = now().toISOString();
  const resolved = resolveVerifier(wave.verifier.command);
  let child = null;
  let result = 'BLOCKED';
  let exitCode = null;
  let signal = null;
  let blockReason = resolved.blocked || '';
  if (!blockReason) {
    child = spawnSync(resolved.executable, resolved.args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      timeout: Number(wave.verifier.timeoutMs),
      maxBuffer: 16 * 1024 * 1024,
      env: Object.assign({}, process.env, {
        STARNET_PRODUCT_PERFECT_CANDIDATE_SHA: candidate.sha,
        STARNET_PRODUCT_PERFECT_MANIFEST_HASH: manifestHash,
        STARNET_PRODUCT_PERFECT_WAVE: wave.id
      })
    });
    exitCode = Number.isInteger(child.status) ? child.status : null;
    signal = child.signal || null;
    if (child.error) blockReason = child.error.message;
    result = exitCode === 0 ? 'PASS' : (exitCode === 2 || exitCode == null || blockReason ? 'BLOCKED' : 'FAIL');
    try {
      const after = currentCandidate();
      if (after.sha !== candidate.sha || !after.clean) {
        result = 'BLOCKED';
        blockReason = 'source changed or became dirty while verifier was running';
      }
    } catch (error) {
      result = 'BLOCKED';
      blockReason = 'could not reverify source after gate: ' + error.message;
    }
  }
  let verifierOutput;
  try {
    verifierOutput = {
      stdout: persistOutput(runtimeDir, candidate, wave, 'stdout', child && child.stdout),
      stderr: persistOutput(runtimeDir, candidate, wave, 'stderr', child && child.stderr)
    };
    const lint = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'lint-evidence-secrets.mjs'), receiptDir(runtimeDir, candidate)], {
      cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024
    });
    if (lint.status !== 0 || lint.error) {
      result = 'BLOCKED';
      exitCode = null;
      blockReason = 'verifier evidence failed secret lint: ' + (str(lint.stderr).trim() || (lint.error && lint.error.message) || 'unknown failure');
      for (const entry of Object.values(verifierOutput)) {
        try { fs.rmSync(path.join(runtimeDir, ...entry.path.split('/')), { force: true }); } catch (_) {}
      }
      verifierOutput = null;
    }
  } catch (error) {
    result = 'BLOCKED';
    exitCode = null;
    blockReason = 'could not persist verifier evidence: ' + error.message;
    verifierOutput = null;
  }
  const unsignedReceipt = {
    schemaVersion: RECEIPT_SCHEMA,
    waveId: wave.id,
    waveName: wave.name,
    candidateSha: candidate.sha,
    manifestHash,
    waveDefinitionHash,
    result,
    exitCode,
    signal,
    startedAt,
    finishedAt: now().toISOString(),
    verifier: wave.verifier.command,
    verifierOutput,
    blockReason
  };
  const receipt = sealReceipt(unsignedReceipt, key);
  atomicJson(receiptFile(runtimeDir, candidate, wave.id), receipt);
  return { receipt, stdout: str(child && child.stdout), stderr: str(child && child.stderr) };
}

function render(status) {
  const lines = [];
  lines.push(status.verdict + (status.productPerfect ? ' @ ' + status.candidate.sha : ' — current ' + (status.currentWave || 'unverifiable')));
  lines.push('candidate ' + (status.candidate && status.candidate.sha ? status.candidate.sha : '(unknown)') + ' · ' + (status.candidate && status.candidate.clean ? 'clean' : 'DIRTY'));
  if (status.candidate && status.candidate.operationalDirtyPaths && status.candidate.operationalDirtyPaths.length) {
    lines.push('  [INFO] operational evidence dirt excluded from shipped-source cleanliness: ' + status.candidate.operationalDirtyPaths.join(', '));
  }
  if (status.manifestErrors) for (const error of status.manifestErrors) lines.push('  [BLOCKED] manifest — ' + error);
  for (const id of AUTHORITY_IDS) {
    const authority = status.authorities && status.authorities[id];
    if (!authority) continue;
    lines.push('  [' + str(authority.status || (authority.ok ? 'PASS' : 'BLOCKED')).toUpperCase() + '] authority/' + id);
    if (!authority.ok) for (const reason of authority.reasons || []) lines.push('      - ' + reason);
  }
  for (const wave of status.waves || []) {
    lines.push('  [' + wave.status.toUpperCase() + '] ' + wave.id + ' · ' + wave.name);
    if (wave.id === status.currentWave) for (const reason of wave.reasons || []) lines.push('      - ' + reason);
  }
  lines.push('next: ' + status.nextAction);
  return lines.join('\n');
}

function outputTail(text, max = 4000) {
  text = str(text).trim();
  if (!text) return '';
  return text.length > max ? '…' + text.slice(-max) : text;
}

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; }
  catch (_) { return false; }
})();

if (INVOKED_DIRECTLY) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const statusOnly = args.includes('--status');
  const waveIndex = args.indexOf('--wave');
  const requestedWave = waveIndex >= 0 ? str(args[waveIndex + 1]).toUpperCase() : '';
  const manifest = readJson(DEFAULT_MANIFEST);
  let candidate;
  try { candidate = currentCandidate(); }
  catch (error) {
    const blocked = { productPerfect: false, verdict: 'NOT PRODUCT PERFECT', currentWave: null, candidate: { sha: '', clean: false }, waves: [], nextAction: error.message };
    console.log(jsonMode ? JSON.stringify(blocked, null, 2) : render(blocked));
    process.exit(2);
  }
  let receipts = manifest ? loadReceipts(manifest, candidate) : {};
  const manifestValidation = validateManifest(manifest);
  let receiptKey = null;
  try { receiptKey = loadReceiptKey(DEFAULT_RUNTIME_DIR, { create: !statusOnly && manifestValidation.ok && candidate.clean }); }
  catch (error) {
    const blocked = { productPerfect: false, verdict: 'NOT PRODUCT PERFECT', currentWave: 'W0', candidate, waves: [], nextAction: 'Receipt authority unavailable: ' + error.message };
    console.log(jsonMode ? JSON.stringify(blocked, null, 2) : render(blocked));
    process.exit(2);
  }
  const receiptContext = { nowMs: Date.now(), key: receiptKey, runtimeDir: DEFAULT_RUNTIME_DIR };
  let campaignState = inspectCampaignState(manifest, candidate, receipts, receiptContext, { nowMs: receiptContext.nowMs });
  let authorities = campaignState.authorities;
  let status = campaignState.status;
  if (statusOnly) {
    console.log(jsonMode ? JSON.stringify(status, null, 2) : render(status));
    process.exit(status.productPerfect ? 0 : 2);
  }
  if (!candidate.clean) {
    console.log(jsonMode ? JSON.stringify(status, null, 2) : render(status));
    process.exit(2);
  }
  if (status.manifestErrors) {
    console.log(jsonMode ? JSON.stringify(status, null, 2) : render(status));
    process.exit(2);
  }

  const runOne = (wave) => {
    const priorIds = wave.dependsOn || [];
    const latest = deriveStatus(manifest, candidate, receipts, authorities, Object.assign({}, receiptContext, { nowMs: Date.now() }));
    const unmet = priorIds.filter(id => !latest.waves.some(item => item.id === id && item.status === 'pass'));
    if (unmet.length) return { blocked: 'dependencies not current and passing: ' + unmet.join(', ') };
    const run = runWaveVerifier(manifest, wave, candidate, DEFAULT_RUNTIME_DIR, { key: receiptKey });
    receipts = loadReceipts(manifest, candidate);
    campaignState = inspectCampaignState(manifest, candidate, receipts, Object.assign({}, receiptContext, { nowMs: Date.now() }));
    authorities = campaignState.authorities;
    return run;
  };

  let lastRun = null;
  if (requestedWave) {
    const wave = manifest.waves.find(item => item.id === requestedWave);
    if (!wave) {
      console.error('unknown wave ' + requestedWave);
      process.exit(2);
    }
    lastRun = runOne(wave);
    if (lastRun.blocked) {
      console.error(lastRun.blocked);
      process.exit(2);
    }
  } else {
    for (const wave of manifest.waves) {
      status = deriveStatus(manifest, candidate, receipts, authorities, Object.assign({}, receiptContext, { nowMs: Date.now() }));
      const row = status.waves.find(item => item.id === wave.id);
      if (row && row.status === 'pass') continue;
      lastRun = runOne(wave);
      if (lastRun.blocked || lastRun.receipt.result !== 'PASS') break;
    }
  }

  status = deriveStatus(manifest, candidate, receipts, authorities, Object.assign({}, receiptContext, { nowMs: Date.now() }));
  atomicJson(path.join(DEFAULT_RUNTIME_DIR, 'product-perfect-status.json'), status);
  if (jsonMode) console.log(JSON.stringify({ status, lastReceipt: lastRun && lastRun.receipt }, null, 2));
  else {
    if (lastRun && outputTail(lastRun.stdout)) console.log(outputTail(lastRun.stdout));
    if (lastRun && outputTail(lastRun.stderr)) console.error(outputTail(lastRun.stderr));
    console.log(render(status));
  }
  const lastResult = lastRun && lastRun.receipt && lastRun.receipt.result;
  process.exit(status.productPerfect || (requestedWave && lastResult === 'PASS') ? 0 : (lastResult === 'FAIL' ? 1 : 2));
}
