// Additional evidence for customer/owner escapes. Legacy status remains engineering status.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
export const LIFECYCLE_FIELDS = ['origin', 'report', 'affected', 'family', 'installer', 'installerVersion',
  'installerSha256', 'installerEvidence', 'recovery', 'recoveryEvidence'];
export const COVERAGE_AXES = ['adapters', 'entrypoints', 'displays', 'lifecycle'];
export const ESCAPE_LAW_SINCE = '2026-09-05';
export const isEscape = b => ['customer', 'owner'].includes(b.origin);
const text = v => String(v ?? '').trim();

export function lifecycleErrors(b) {
  const errors = [];
  if (b.found >= ESCAPE_LAW_SINCE || b.origin) {
    if (!['customer', 'owner', 'audit', 'unknown'].includes(b.origin)) errors.push('origin must be customer, owner, audit, or unknown');
    if (b.origin === 'unknown' && b.status === 'fixed') errors.push('classify report origin before marking a new bug fixed');
  }
  if (!isEscape(b)) return errors;
  for (const field of ['report', 'affected', 'family']) if (!text(b[field])) errors.push('user escape requires ' + field);
  if (!['unverified', 'verified', 'not-applicable'].includes(b.installer)) errors.push('installer must be unverified, verified, or not-applicable');
  if (!['unconfirmed', 'confirmed', 'persists'].includes(b.recovery)) errors.push('recovery must be unconfirmed, confirmed, or persists');
  if (b.installer === 'verified') {
    if (b.status !== 'fixed') errors.push('installer verification requires a source-fixed bug');
    if (!text(b.installerVersion) || !/^[a-f0-9]{64}$/.test(b.installerSha256 || '') || !text(b.installerEvidence)) {
      errors.push('verified installer requires version, exact SHA-256 and behavior evidence; tag ancestry alone is insufficient');
    }
  }
  if (b.installer === 'not-applicable' && !text(b.installerEvidence)) errors.push('installer not-applicable requires a reason');
  if (b.recovery !== 'unconfirmed' && !text(b.recoveryEvidence)) errors.push('confirmed/persisting customer outcome requires recoveryEvidence');
  if (b.recovery === 'confirmed' && b.status !== 'fixed') errors.push('confirmed recovery requires a source-fixed bug');
  if (b.status !== 'fixed') return errors;
  if (!/^[a-f0-9]{7,40}$/.test(b.fix || '')) errors.push('source-fixed user escape requires an exact fix commit');
  if (!text(b.sections?.Regression)) errors.push('source-fixed user escape requires Regression: before-fix failure and after-fix proof');
  let coverage;
  try { coverage = JSON.parse(text(b.sections?.['Sibling coverage'])); } catch { errors.push('Sibling coverage must be a JSON object'); return errors; }
  for (const axis of COVERAGE_AXES) {
    const rows = coverage?.[axis];
    if (!Array.isArray(rows) || !rows.length) { errors.push('Sibling coverage must enumerate ' + axis); continue; }
    const seen = new Set();
    for (const row of rows) {
      if (!text(row?.target) || seen.has(row.target)) errors.push(axis + ' targets must be named and unique');
      seen.add(row?.target);
      if (row?.state === 'covered') {
        if (!/^test\/[\w./-]+\.(?:m?js|cjs)$/.test(row.test || '') || !text(row.scenario) || !['fast', 'http'].includes(row.gate)) {
          errors.push(axis + '/' + row.target + ': covered requires test path, scenario and fast/http gate');
        }
      } else if (['blocked', 'not-applicable'].includes(row?.state)) {
        if (text(row.reason).length < 16) errors.push(axis + '/' + row.target + ': uncovered requires a substantive reason');
      } else errors.push(axis + '/' + row?.target + ': state must be covered, blocked, or not-applicable');
    }
  }
  return errors;
}

export function coverageRows(b) {
  try { return Object.values(JSON.parse(b.sections?.['Sibling coverage'] || '{}')).flat().filter(r => r?.state === 'covered'); }
  catch { return []; }
}

export function escapeSummary(bugs) {
  const rows = bugs.filter(isEscape);
  return {
    reports: rows.length,
    sourceFixed: rows.filter(b => b.status === 'fixed').length,
    installerVerified: rows.filter(b => b.installer === 'verified').length,
    customerConfirmed: rows.filter(b => b.recovery === 'confirmed').length,
    customerPersists: rows.filter(b => b.recovery === 'persists').length,
    customerUnconfirmed: rows.filter(b => b.recovery === 'unconfirmed').length
  };
}

export function makeCoverageChecker(root) {
  return row => {
    const file = resolve(root, row.test || '');
    if (!file.startsWith(resolve(root, 'test') + sep) || !existsSync(file)) return 'sibling regression test is missing or outside test/: ' + row.test;
    try {
      const entries = readFileSync(resolve(root, 'test', row.gate + '.list'), 'utf8').split(/\r?\n/).map(s => s.trim());
      if (!entries.includes(row.test)) return row.test + ' is not registered in test/' + row.gate + '.list';
    } catch { return 'cannot read sibling regression gate: ' + row.gate; }
    return '';
  };
}
