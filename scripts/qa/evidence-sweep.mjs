#!/usr/bin/env node
/* scripts/qa/evidence-sweep.mjs — the Self-Testing Station's EVIDENCE RETENTION sweep (lane GB-27).
 *
 * WHY THIS EXISTS: `.bugloops/` is the crew's evidence dir — every guardian/beginner/journeys
 * cycle drops a timestamped bundle there and NOTHING ever cleans it up. It crossed 1 GB / 6,111
 * files / 281 top-level dirs on 2026-07-09 and grows every hourly guardian cycle. This sweep
 * bounds it WITHOUT the two failure modes that make naive cleanup dangerous here:
 *   1. The Janitor is PROPOSE-ONLY by absolute law (scripts/qa/janitor.mjs:10-11) — it NEVER
 *      deletes. So deletion does NOT belong on the Janitor; it lives in this separate,
 *      narrowly-scoped tool that only ever touches `.bugloops/`.
 *   2. Open findings point INTO `.bugloops` via their evidence[] paths (qa/findings/README.md:36).
 *      Blind age-based deletion would orphan the evidence of a still-open finding. So this sweep
 *      parses qa/findings/*.json FIRST and never deletes a bundle a non-resolved finding cites.
 *
 * RETENTION POLICY — delete a top-level `.bugloops/*` entry ONLY when ALL of these hold:
 *   - it is OLDER than the retention window (default 7 days, by mtime), AND
 *   - it is NOT among the newest N (default 5) of its FAMILY (family = the leading non-date token,
 *     e.g. `guardian`, `beginner`, `perfectionist-world3`), AND
 *   - it is NOT a `*-latest` pointer dir, AND
 *   - it is NOT referenced by the evidence[] of any NON-RESOLVED finding in qa/findings/*.json.
 * Entries whose name starts with `_` or `.` (our own `_sweep-manifest-*.json`, dotfiles) are meta
 * and are never touched or counted.
 *
 * FAIL-OPEN LAW: if the findings dir cannot be read, or ANY single findings JSON fails to parse,
 * the sweep deletes NOTHING at all (loud warning) — it never guesses which evidence is safe to drop.
 * A missing findings dir is not an error (there are simply no findings to orphan) and proceeds.
 *
 * AUDITABILITY: every real (non-dry-run) sweep writes a deleted/kept manifest JSON — into the
 * current guardian cycle dir when the guardian calls it, else `.bugloops/_sweep-manifest-<stamp>.json`
 * when run standalone. `--dry-run` prints what WOULD go and writes/deletes NOTHING.
 *
 * HOUSE PATTERN (matches scripts/qa/janitor.mjs + ledger.mjs): a PURE planner `planSweep(...)` holds
 * the decision logic (age + newest-per-family + latest + evidence protection) and is deterministic
 * over synthetic input; the fs-backed `runSweep(...)` reads entries, parses findings fail-open, and
 * applies (or, on dry-run, only reports) the plan. ESM so the same file is the CLI; the pure pieces
 * are exported for the CJS test via Node's require(esm) support. Static imports are side-effect-free
 * so `require('../scripts/qa/evidence-sweep.mjs')` works and importing it into guardian.mjs is inert
 * until `runSweep` is called.
 *
 * CLI:
 *   node scripts/qa/evidence-sweep.mjs               real sweep of ./.bugloops (writes a manifest)
 *   node scripts/qa/evidence-sweep.mjs --dry-run     report only; deletes nothing, writes nothing
 *   node scripts/qa/evidence-sweep.mjs --days N       override the 7-day retention window
 *   node scripts/qa/evidence-sweep.mjs --keep N       override the newest-5-per-family floor
 *   node scripts/qa/evidence-sweep.mjs --bugloops DIR override the target dir (default <repo>/.bugloops)
 * Exit code: 0 on a clean sweep (or a fail-open abort — hygiene is never a hard failure); nonzero
 *            only if the tool itself could not run.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

/* ─────────────────────────────── PURE HELPERS ─────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS_DEFAULT = 7;
const KEEP_PER_FAMILY_DEFAULT = 5;

// A finding is "resolved" (its evidence may be reclaimed) only in these terminal states. Everything
// else — open, routed, missing/unknown status — is treated as NON-resolved and PROTECTS its evidence.
// Erring toward protection is the safe direction (never orphan a live finding's evidence).
const RESOLVED_STATUSES = new Set(['fixed', 'dismissed', 'known']);

function str(v) { return v == null ? '' : String(v); }
function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }
// A non-negative-int option with a default that survives `undefined` (num()-of-undefined is 0, which
// would silently swallow the default for a `>= 0` guard — e.g. keepPerFamily would become 0, deleting
// the newest-per-family floor). Only an explicit finite number >= 0 overrides the default.
function optCount(v, dflt) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? Math.floor(v) : dflt; }

// Family = the leading run of non-date tokens. Split on '-' and accumulate tokens until one begins a
// date stamp (a run of >=4 leading digits: a year `2026`, a `20260701`, or a time run). So
// `guardian-20260701-235647` -> `guardian`, `beginner-2026-07-01T23-15-27` -> `beginner`,
// `perfectionist-world3-20260707` -> `perfectionist-world3`. A name with no date token is its own family.
export function familyOf(name) {
  const n = str(name);
  const parts = n.split('-');
  const out = [];
  for (const p of parts) {
    if (/^\d{4}/.test(p)) break;          // start of the date stamp
    out.push(p);
  }
  return out.length ? out.join('-') : (parts[0] || n);
}

// A `*-latest` (or `*_latest`) pointer dir — always retained regardless of age.
export function isLatestPointer(name) {
  return /[-_]latest$/i.test(str(name));
}

// Meta entries we author or that are dot-metadata — never a deletion candidate, never counted.
function isMetaEntry(name) {
  const n = str(name);
  return n.startsWith('_') || n.startsWith('.');
}

// Extract the top-level `.bugloops/<entry>` names an evidence[] path set references. `marker` is the
// bugloops dir's basename (`.bugloops`). Paths may be repo-relative or absolute, `/`- or `\`-separated.
export function referencedEntryNames(evidencePaths, marker) {
  const mark = str(marker) || '.bugloops';
  const out = new Set();
  for (const raw of (Array.isArray(evidencePaths) ? evidencePaths : [])) {
    const segs = str(raw).replace(/\\/g, '/').split('/').filter(Boolean);
    const i = segs.indexOf(mark);
    if (i >= 0 && i + 1 < segs.length) out.add(segs[i + 1]);
  }
  return out;
}

/* ─────────────────────────────── PURE PLANNER ─────────────────────────────── */

// Decide, over a synthetic entry list, exactly which entries are deleted vs kept and WHY. Pure and
// deterministic — no fs, no clock, no Date.now(). `entries` = [{ name, mtimeMs }]. `protectedNames` =
// a Set of entry names cited by non-resolved findings. Returns { del:[...], keep:[...] }, each item
// { name, family, ageDays, reason }, both arrays sorted by name for stable manifests/diffs.
export function planSweep(opts) {
  opts = opts || {};
  const now = num(opts.now);
  const retentionDays = num(opts.retentionDays) > 0 ? num(opts.retentionDays) : RETENTION_DAYS_DEFAULT;
  const keepPerFamily = optCount(opts.keepPerFamily, KEEP_PER_FAMILY_DEFAULT);
  const protectedNames = opts.protectedNames instanceof Set
    ? opts.protectedNames
    : new Set(Array.isArray(opts.protectedNames) ? opts.protectedNames.map(str) : []);
  const cutoff = now - retentionDays * DAY_MS;

  const entries = (Array.isArray(opts.entries) ? opts.entries : [])
    .filter(e => e && !isMetaEntry(e.name))
    .map(e => ({ name: str(e.name), mtimeMs: num(e.mtimeMs), family: familyOf(e.name) }));

  // Group by family, then within a family rank by mtime desc (newest first). The newest `keepPerFamily`
  // are floor-protected. Ties (equal mtime) break by name desc so ranking is deterministic.
  const byFamily = new Map();
  for (const e of entries) {
    if (!byFamily.has(e.family)) byFamily.set(e.family, []);
    byFamily.get(e.family).push(e);
  }
  const newestKept = new Set();          // entry names inside the newest-per-family floor
  for (const [, list] of byFamily) {
    list.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    for (let i = 0; i < list.length && i < keepPerFamily; i++) newestKept.add(list[i].name);
  }

  const del = [];
  const keep = [];
  for (const e of entries) {
    const ageDays = Math.floor((now - e.mtimeMs) / DAY_MS);
    const rec = { name: e.name, family: e.family, ageDays };
    let reason;
    if (newestKept.has(e.name)) reason = 'newest-per-family';
    else if (isLatestPointer(e.name)) reason = 'latest-pointer';
    else if (protectedNames.has(e.name)) reason = 'evidence-referenced';
    else if (e.mtimeMs > cutoff) reason = 'within-retention';
    else reason = null;                  // older than the window AND unprotected -> delete
    if (reason) keep.push(Object.assign(rec, { reason }));
    else del.push(Object.assign(rec, { reason: 'expired' }));
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  del.sort(byName); keep.sort(byName);
  return { del, keep };
}

/* ─────────────────────────── FS-BACKED ORCHESTRATOR ─────────────────────────── */

// Read every finding JSON and build the protected-name set from NON-resolved findings' evidence.
// Returns { ok, protectedNames, error, count }. ok=false (with a reason in `error`) triggers the
// fail-open abort: a missing dir is ok:true with an empty set; an unreadable dir or ANY unparseable
// finding is ok:false so the caller deletes nothing.
function collectProtected(findingsDir, marker) {
  const protectedNames = new Set();
  let names;
  try {
    names = fs.readdirSync(findingsDir);
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, protectedNames, count: 0 };   // no findings dir => nothing to orphan
    return { ok: false, protectedNames, error: 'cannot read findings dir: ' + str(e && e.message), count: 0 };
  }
  let count = 0;
  for (const n of names) {
    if (!n.endsWith('.json')) continue;                                            // README/.gitkeep etc. are not findings
    const abs = path.join(findingsDir, n);
    let finding;
    try { finding = JSON.parse(fs.readFileSync(abs, 'utf8')); }
    catch (e) { return { ok: false, protectedNames, error: 'unparseable finding ' + n + ': ' + str(e && e.message), count }; }
    count++;
    const status = str(finding && finding.status).toLowerCase().trim();
    if (RESOLVED_STATUSES.has(status)) continue;                                   // resolved => its evidence may be reclaimed
    for (const name of referencedEntryNames(finding && finding.evidence, marker)) protectedNames.add(name);
  }
  return { ok: true, protectedNames, count };
}

// Read the top-level entries of the bugloops dir with their mtimes. Missing dir => []. Meta/dot
// entries are skipped here so they never enter the plan.
function readEntries(bugloopsDir) {
  let dirents;
  try { dirents = fs.readdirSync(bugloopsDir, { withFileTypes: true }); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { entries: [], readable: true };
    return { entries: [], readable: false, error: str(e && e.message) };
  }
  const entries = [];
  for (const d of dirents) {
    const name = d.name;
    if (isMetaEntry(name)) continue;
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(path.join(bugloopsDir, name)).mtimeMs; } catch (_) { continue; }
    entries.push({ name, mtimeMs });
  }
  return { entries, readable: true };
}

/*
 * runSweep — the real sweep. Reads `.bugloops` + qa/findings, plans, then (unless dryRun) deletes the
 * expired-unprotected entries and writes an audit manifest. Options:
 *   bugloopsDir   (required) absolute path to the evidence dir to sweep
 *   findingsDir   (required) absolute path to qa/findings (for evidence protection)
 *   now           epoch ms (default Date.now())
 *   dryRun        bool — report only; delete nothing, write no manifest (default false)
 *   retentionDays default 7 · keepPerFamily default 5
 *   manifestDir   dir to write the manifest into (e.g. the guardian cycle dir). If omitted, a real run
 *                 writes `.bugloops/_sweep-manifest-<stamp>.json`.
 *   manifestName  manifest filename when manifestDir is given (default 'sweep-manifest.json')
 *   log / warn    output sinks (default console.log / console.warn)
 * Returns { ok, dryRun, findingsError, findingsErrorReason, retentionDays, keepPerFamily,
 *           deleted:[names], deleteFailed:[{name,error}], wouldDelete:[names], kept:[{name,reason,...}],
 *           counts, manifest, manifestPath }.
 */
export function runSweep(opts) {
  opts = opts || {};
  const bugloopsDir = str(opts.bugloopsDir);
  const findingsDir = str(opts.findingsDir);
  const now = num(opts.now) || Date.now();
  const dryRun = !!opts.dryRun;
  const retentionDays = num(opts.retentionDays) > 0 ? num(opts.retentionDays) : RETENTION_DAYS_DEFAULT;
  const keepPerFamily = optCount(opts.keepPerFamily, KEEP_PER_FAMILY_DEFAULT);
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const warn = typeof opts.warn === 'function' ? opts.warn : () => {};
  const marker = path.basename(bugloopsDir) || '.bugloops';
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');

  // 1) Evidence protection FIRST (findings can veto any deletion).
  const prot = collectProtected(findingsDir, marker);
  const findingsError = !prot.ok;
  if (findingsError) {
    warn('[qa:sweep] FAIL-OPEN: ' + prot.error + ' — deleting NOTHING this sweep (never guess which evidence is safe to drop).');
  }

  // 2) Enumerate the evidence dir.
  const read = readEntries(bugloopsDir);
  if (!read.readable) warn('[qa:sweep] could not read ' + bugloopsDir + ': ' + str(read.error) + ' — nothing to sweep.');

  // 3) Plan. On a findings error we force an empty protected set AND suppress all deletion below.
  const plan = planSweep({
    entries: read.entries,
    protectedNames: findingsError ? new Set() : prot.protectedNames,
    now, retentionDays, keepPerFamily
  });

  // On a findings error EVERY planned deletion is instead retained (fail-open): fold them into kept.
  let del = plan.del;
  let kept = plan.keep;
  if (findingsError) {
    kept = plan.keep.concat(plan.del.map(d => ({ name: d.name, family: d.family, ageDays: d.ageDays, reason: 'findings-error-abort' })))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    del = [];
  }

  // 4) Apply (unless dry-run). Real deletions remove the whole bundle (dir or file).
  const deleted = [];
  const deleteFailed = [];
  if (!dryRun && !findingsError) {
    for (const d of del) {
      const abs = path.join(bugloopsDir, d.name);
      try { fs.rmSync(abs, { recursive: true, force: true }); deleted.push(d.name); }
      catch (e) { deleteFailed.push({ name: d.name, error: str(e && e.message) }); warn('[qa:sweep] could not delete ' + d.name + ': ' + str(e && e.message)); }
    }
  }

  const wouldDelete = del.map(d => d.name);
  const counts = {
    scanned: read.entries.length,
    families: new Set(read.entries.map(e => familyOf(e.name))).size,
    kept: kept.length,
    deleted: dryRun || findingsError ? 0 : deleted.length,
    wouldDelete: wouldDelete.length,
    deleteFailed: deleteFailed.length,
    findingsProtecting: findingsError ? 0 : prot.protectedNames.size,
    findingsParsed: prot.count || 0
  };

  const manifest = {
    tool: 'evidence-sweep',
    generatedAt: new Date(now).toISOString(),
    bugloopsDir, retentionDays, keepPerFamily,
    dryRun, findingsError, findingsErrorReason: findingsError ? str(prot.error) : null,
    counts,
    deleted: (dryRun || findingsError) ? [] : deleted,
    deleteFailed,
    wouldDelete: dryRun ? wouldDelete : undefined,   // only meaningful in a dry-run preview
    kept
  };

  // 5) Write the audit manifest (real runs only — dry-run writes nothing).
  let manifestPath = null;
  if (!dryRun) {
    try {
      if (opts.manifestDir) {
        fs.mkdirSync(opts.manifestDir, { recursive: true });
        manifestPath = path.join(opts.manifestDir, str(opts.manifestName) || 'sweep-manifest.json');
      } else {
        fs.mkdirSync(bugloopsDir, { recursive: true });
        manifestPath = path.join(bugloopsDir, '_sweep-manifest-' + stamp + '.json');
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    } catch (e) {
      warn('[qa:sweep] could not write manifest: ' + str(e && e.message));
      manifestPath = null;
    }
  }

  log('[qa:sweep] ' + (dryRun ? 'DRY-RUN ' : '') + 'scanned ' + counts.scanned + ' entr' + (counts.scanned === 1 ? 'y' : 'ies') +
    ' across ' + counts.families + ' famil' + (counts.families === 1 ? 'y' : 'ies') + '; ' +
    (findingsError ? 'FAIL-OPEN (deleted 0)' :
      (dryRun ? ('would delete ' + wouldDelete.length) : ('deleted ' + deleted.length)) +
      ', kept ' + counts.kept + (counts.findingsProtecting ? ' (' + counts.findingsProtecting + ' evidence-protected)' : '')) +
    (manifestPath ? ' — manifest ' + manifestPath : ''));

  return {
    ok: true, dryRun, findingsError, findingsErrorReason: findingsError ? str(prot.error) : null,
    retentionDays, keepPerFamily, deleted, deleteFailed, wouldDelete, kept, counts, manifest, manifestPath
  };
}

/* ───────────────────────────── THIN CLI WRAPPER ─────────────────────────────
 * The ONLY place ambient fs + Date.now() + process live. Resolves the repo's own `.bugloops` and
 * qa/findings, parses flags, and runs one sweep. Guarded so importing this module (from the test or
 * from guardian.mjs) has ZERO side effects.
 */

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
  catch (_) { return false; }
})();

if (INVOKED_DIRECTLY) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const REPO = path.resolve(__dirname, '..', '..');          // scripts/qa/ -> repo root
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const valOf = (name, dflt) => { const i = args.indexOf(name); return (i >= 0 && args[i + 1]) ? args[i + 1] : dflt; };

  const dryRun = flag('--dry-run');
  const retentionDays = Math.max(0, parseInt(valOf('--days', ''), 10) || RETENTION_DAYS_DEFAULT);
  const keepPerFamily = Math.max(0, parseInt(valOf('--keep', ''), 10) || KEEP_PER_FAMILY_DEFAULT);
  const bugloopsDir = path.resolve(valOf('--bugloops', path.join(REPO, '.bugloops')));
  const findingsDir = path.join(REPO, 'qa', 'findings');

  const res = runSweep({
    bugloopsDir, findingsDir, dryRun, retentionDays, keepPerFamily,
    log: (m) => console.log(m), warn: (m) => console.error(m)
  });

  if (dryRun && res.wouldDelete.length) {
    console.log('would delete (older than ' + retentionDays + 'd, outside newest-' + keepPerFamily + ', unprotected):');
    for (const n of res.wouldDelete) console.log('  - ' + n);
  }
  process.exit(0);
}
