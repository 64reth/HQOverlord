#!/usr/bin/env node
/* scripts/qa/janitor.mjs — the Self-Testing Station's hygiene sweep (lane Q4).
 *
 * WHY THIS EXISTS: ~120 worktrees pile up (most stale/merged), loose PNGs litter the
 * repo root, branches strand half-done work, and docs rot into referencing files that
 * were deleted. Andrew shouldn't be the one to notice the workshop is filthy. The
 * Janitor runs one sweep, writes a dated report, and files ONE deduped ledger finding
 * per new issue-class instance — so the Overseer surfaces it in the morning digest.
 *
 * PROPOSE-ONLY (Part 0 + Part 5 read-only law, ABSOLUTE): the Janitor NEVER deletes,
 * removes, prunes, or edits anything outside its own report + ledger findings. For a
 * removable worktree it prints the EXACT `remove-agent-tree.ps1 <name> -DeleteBranch`
 * command for a human/orchestrator to run. It reads git metadata read-only (git
 * metadata is shared across worktrees; `git -C <path> status` is a read) but writes
 * into no other worktree, ever.
 *
 * HOUSE PATTERN (matches scripts/qa/ledger.mjs + sidecar/runstore.js): the CORE is a
 * PURE factory `makeJanitor({ io, clock })`. No ambient git, no ambient disk, no
 * ambient time — the host injects a small `io` surface (list worktrees, branch merge/
 * ahead facts, list root entries, read docs, du evidence dirs) plus a clock. So the
 * classification logic (removable? stranded? litter? dead-ref? evidence size?) tests
 * headlessly against SYNTHETIC git output with zero real git mutations, and re-runs
 * are deterministic. ESM so the same file is also the `node ... janitor.mjs` CLI; the
 * pure core is exported for the CJS test via Node's require(esm) support.
 *
 * The `io` contract (host owns real git/fs; core owns logic):
 *   io.trunkBranch()            -> 'feat/harness-backend'          (the merge target)
 *   io.worktrees()              -> [{ path, branch, isMain }]      (from git worktree list --porcelain)
 *   io.aheadCount(branch)       -> int   commits on <branch> not on trunk (git rev-list --count trunk..branch)
 *   io.isClean(path)            -> bool  working tree at <path> has no changes (git -C <path> status --porcelain empty)
 *   io.lastCommit(branch)       -> { iso, epochMs, shortSha }      (git log -1 on the branch)
 *   io.rootEntries()            -> [{ name, isDir, tracked }]      depth-1 entries at the watched repo root
 *   io.docFiles()               -> [{ file, text }]               root *.md + docs/*.md (repo-relative file + contents)
 *   io.topDirs()                -> Set|array of real top-level dir names (anchors dead-ref detection)
 *   io.pathExists(relPath)      -> bool  a repo-relative path exists now
 *   io.parentExists(relPath)    -> bool  the parent dir of a repo-relative path exists
 *   io.isIgnored(relPath)       -> bool  git check-ignore says the path is gitignored
 *   io.everInHistory(relPath)   -> bool  the path was once committed (git log --all -- <path> nonempty) = true rot
 *   io.evidenceDirs()           -> [{ name, exists, bytes }]      du of .bugloops, .uishots*, etc
 *
 * makeJanitor({ io, clock }) -> {
 *   sweep()   -> { date, removableWorktrees, strandedBranches, rootLitter, deadRefs, evidence, findings, report }
 *               // findings = ledger-ready finding objects (one per NEW issue-class instance, stable fingerprints)
 *               // report   = the markdown report body
 *   fingerprintOf(parts)  -> stable dedup key (delegates to the ledger's hash if provided)
 * }
 *
 * CLI (thin wrapper, real git + real fs + real clock + the real ledger):
 *   node scripts/qa/janitor.mjs                 run the sweep, write report + file findings, update STATUS row
 *   node scripts/qa/janitor.mjs --dry-run       run the sweep, print the report, file NOTHING (no writes)
 *   node scripts/qa/janitor.mjs --stale-days N  override the 14-day stranded threshold (default 14)
 * Exit code: 0 always on a clean sweep (hygiene is P2 — informational, never a merge blocker);
 *            nonzero only if the sweep itself could not run (BLOCKED loudly, never silent-pass).
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

/* ─────────────────────────────── PURE CORE ─────────────────────────────── */

const STALE_DAYS_DEFAULT = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const CREW = 'Janitor';                 // canonical crew seat (ledger normalizes case for the fingerprint)
const SEVERITY = 'P2';                   // hygiene is always informational — never a merge blocker

function str(v) { return v == null ? '' : String(v); }
function arr(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : 0; }

// A stable, dependency-free hash (FNV-1a 32-bit -> hex). Same as the ledger's, duplicated here so the
// core has no hard dependency on the ledger module for fingerprinting (the CLI hands in the ledger's
// own fingerprint fn when it wires up, keeping them identical; the fallback is byte-for-byte the same).
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}
function normalizeSubject(s) {
  return str(s).toLowerCase().replace(/\\/g, '/').replace(/\s+/g, ' ').trim();
}
export function fingerprintOf(parts) {
  parts = parts || {};
  const crew = normalizeSubject(parts.crew);
  const checkId = normalizeSubject(parts.checkId != null ? parts.checkId : parts.check);
  const subject = normalizeSubject(parts.subject);
  return fnv1a(crew + ' ' + checkId + ' ' + subject);
}

function humanBytes(n) {
  n = num(n);
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

// worktree dir -> the short name new-agent-tree.ps1 uses (the last path segment).
function worktreeName(wtPath) {
  const p = str(wtPath).replace(/\\/g, '/').replace(/\/+$/, '');
  const seg = p.split('/');
  return seg[seg.length - 1] || p;
}

// Is a root entry litter? Untracked binary/image/log artifacts sitting at repo root. Conservative:
// only well-known throwaway extensions, files only (never dirs), never tracked files.
const LITTER_EXT = /\.(png|jpe?g|gif|bmp|webp|log|tmp|bak|orig)$/i;
function isRootLitter(entry) {
  return entry && !entry.isDir && !entry.tracked && LITTER_EXT.test(str(entry.name));
}

// A markdown file whose NAME marks it forward-looking (a plan/roadmap names files it INTENDS to build,
// so a missing ref there is aspirational, not rot). Report those as info; only FILE the high-confidence
// tier (non-plan doc, or a ref that was genuinely DELETED from history — unambiguous rot).
function isPlanDoc(file) {
  return /(_PLAN|_ROADMAP|PLAN|ROADMAP|AUDIT|SESSION|DOSSIER)/i.test(path.basename(str(file)));
}

// Extract backticked, path-shaped references from doc text. CONSERVATIVE by design — a noisy janitor
// gets ignored. A candidate must: be backticked, contain a '/', have a file extension, start with a
// REAL top-level dir, and NOT have a dotted mid-segment (which is a method ref like `SIM.load/SIM.save`,
// not a path). The existence/ignore/history filters are applied by the caller against real fs+git.
const REF_RE = /`([A-Za-z0-9_][A-Za-z0-9_./-]*\.[A-Za-z0-9]{1,5})`/g;
function extractRefs(text, topDirs) {
  const tops = topDirs instanceof Set ? topDirs : new Set(arr(topDirs).map(str));
  const out = [];
  const seen = new Set();
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(str(text)))) {
    const p = m[1];
    if (seen.has(p)) continue;
    seen.add(p);
    if (!p.includes('/')) continue;                              // must look like a path
    const top = p.split('/')[0];
    if (!tops.has(top)) continue;                                // anchored to a real top-level dir
    const dir = p.split('/').slice(0, -1).join('/');
    if (/\.[A-Za-z]/.test(dir)) continue;                        // dotted mid-segment => method ref, skip
    out.push(p);
  }
  return out;
}

export function makeJanitor(opts) {
  opts = opts || {};
  const io = opts.io || {};
  const clock = opts.clock || { now() { return 0; } };
  const staleDays = num(opts.staleDays) > 0 ? num(opts.staleDays) : STALE_DAYS_DEFAULT;
  const fp = typeof opts.fingerprintOf === 'function' ? opts.fingerprintOf : fingerprintOf;

  // Every io method is optional and fail-open — a missing capability yields an empty result for its
  // check rather than crashing the whole sweep (No-fake-green law: a check that can't run is empty +
  // noted, never a false all-clear that masks a real problem elsewhere).
  const call = (name, fallback, ...args) => {
    const f = io[name];
    if (typeof f !== 'function') return fallback;
    try { return f.apply(io, args); } catch (_) { return fallback; }
  };

  function classifyWorktrees(trunk) {
    const removable = [];
    const wts = arr(call('worktrees', []));
    for (const wt of wts) {
      if (!wt || wt.isMain) continue;                            // never the integration tree
      const branch = str(wt.branch);
      if (!branch || branch === trunk) continue;
      const ahead = num(call('aheadCount', 1, branch));          // fail-open to "ahead" => NOT removable
      if (ahead !== 0) continue;                                 // not fully merged into trunk
      const clean = call('isClean', false, wt.path) === true;    // fail-open to dirty => NOT removable
      if (!clean) continue;
      removable.push({
        name: worktreeName(wt.path),
        path: str(wt.path),
        branch,
        command: 'gen-trees\\remove-agent-tree.ps1 ' + worktreeName(wt.path) + ' -DeleteBranch'
      });
    }
    removable.sort((a, b) => a.name.localeCompare(b.name));
    return removable;
  }

  function classifyStranded(trunk) {
    const now = clock.now();
    const cutoff = now - staleDays * DAY_MS;
    const stranded = [];
    const wts = arr(call('worktrees', []));
    for (const wt of wts) {
      if (!wt || wt.isMain) continue;
      const branch = str(wt.branch);
      if (!branch || branch === trunk) continue;
      const ahead = num(call('aheadCount', 0, branch));
      if (ahead <= 0) continue;                                  // stranded means work not yet merged
      const lc = call('lastCommit', null, branch) || {};
      const epoch = num(lc.epochMs);
      if (!epoch || epoch >= cutoff) continue;                   // only branches idle > staleDays
      stranded.push({
        name: worktreeName(wt.path),
        branch,
        ahead,
        lastCommitIso: str(lc.iso),
        lastCommitSha: str(lc.shortSha),
        ageDays: Math.floor((now - epoch) / DAY_MS)
      });
    }
    stranded.sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
    return stranded;
  }

  function classifyLitter() {
    const entries = arr(call('rootEntries', []));
    const litter = entries.filter(isRootLitter).map(e => str(e.name));
    litter.sort();
    return litter;
  }

  // Dead doc references. Returns two tiers:
  //   filed  = high-confidence rot -> gets a ledger finding (non-plan doc, OR deleted-from-history)
  //   info   = aspirational plan/roadmap refs -> reported but NOT filed (anti-nag: don't nag on plans)
  function classifyDeadRefs() {
    // io.topDirs may hand back a Set OR an array — coerce either into a Set of dir-name strings.
    // (arr() wraps a Set as [set], so never route a Set through arr().)
    const rawTops = call('topDirs', []);
    const tops = rawTops instanceof Set ? new Set([...rawTops].map(str)) : new Set(arr(rawTops).map(str));
    const docs = arr(call('docFiles', []));
    const filed = [];
    const info = [];
    const seen = new Set();
    for (const d of docs) {
      const file = str(d.file);
      const refs = extractRefs(d.text, tops);
      for (const ref of refs) {
        if (call('pathExists', false, ref)) continue;            // it exists -> not dead
        if (!call('parentExists', false, ref)) continue;         // parent dir gone too -> whole tree fictional, skip
        if (call('isIgnored', false, ref)) continue;             // gitignored (e.g. dev/.env.dev) -> expected-absent
        const key = file + '|' + ref;
        if (seen.has(key)) continue;
        seen.add(key);
        const deleted = call('everInHistory', false, ref) === true;   // was committed once => true rot
        const rec = { file, ref, deleted };
        if (deleted || !isPlanDoc(file)) filed.push(rec);        // unambiguous rot, or a non-plan doc claim
        else info.push(rec);                                     // plan/roadmap naming a to-build file
      }
    }
    const byPair = (a, b) => (a.file + a.ref).localeCompare(b.file + b.ref);
    filed.sort(byPair); info.sort(byPair);
    return { filed, info };
  }

  function classifyEvidence() {
    const dirs = arr(call('evidenceDirs', []));
    return dirs.map(d => ({ name: str(d.name), exists: d.exists === true, bytes: num(d.bytes) }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  }

  function sweep(o) {
    o = o || {};
    const trunk = str(call('trunkBranch', 'feat/harness-backend')) || 'feat/harness-backend';
    const date = str(o.date).trim() || new Date(clock.now()).toISOString().slice(0, 10);

    const removableWorktrees = classifyWorktrees(trunk);
    const strandedBranches = classifyStranded(trunk);
    const rootLitter = classifyLitter();
    const dead = classifyDeadRefs();
    const evidence = classifyEvidence();

    const reportRel = 'qa/digests/janitor-' + date + '.md';

    // Build ledger-ready findings — ONE per issue-class instance, stable fingerprints so re-runs dedup.
    // Every finding's evidence path IS the report file (Evidence law). Subject is normalized+stable so
    // the same worktree/branch/file never re-files.
    const findings = [];
    const mkFinding = (checkId, subject, severity, title, detail) => ({
      crew: CREW, severity, title, detail,
      evidence: [reportRel],
      checkId, subject,
      fingerprint: fp({ crew: CREW, checkId, subject })
    });

    for (const wt of removableWorktrees) {
      findings.push(mkFinding(
        'removable-worktree', wt.name, SEVERITY,
        'Removable worktree: ' + wt.name + ' (branch merged + clean)',
        'Branch ' + wt.branch + ' is fully merged into ' + trunk + ' and its working tree is clean. Propose-only removal command: ' + wt.command
      ));
    }
    for (const b of strandedBranches) {
      findings.push(mkFinding(
        'stranded-branch', b.branch, SEVERITY,
        'Stranded branch: ' + b.name + ' (' + b.ahead + ' ahead, idle ' + b.ageDays + 'd)',
        'Branch ' + b.branch + ' has ' + b.ahead + ' unmerged commit(s); last commit ' + b.lastCommitIso + ' (' + b.lastCommitSha + '), idle ~' + b.ageDays + ' days. Fake-done pattern surfacing — surface, do not judge.'
      ));
    }
    if (rootLitter.length) {
      findings.push(mkFinding(
        'root-litter', 'repo-root', SEVERITY,
        'Root litter: ' + rootLitter.length + ' loose artifact(s) at repo root',
        'Untracked binary/image/log files at repo root (removal candidates, flag only): ' + rootLitter.join(', ')
      ));
    }
    for (const r of dead.filed) {
      findings.push(mkFinding(
        'dead-doc-ref', r.file + ' -> ' + r.ref, SEVERITY,
        'Dead doc reference: ' + r.file + ' cites missing ' + r.ref,
        (r.deleted ? 'The referenced path was once committed but has since been deleted (true rot). ' : 'A non-plan doc references a path that does not exist. ') +
        r.file + ' cites `' + r.ref + '`, which is absent from the working tree.'
      ));
    }

    const report = renderReport({ date, trunk, staleDays, removableWorktrees, strandedBranches, rootLitter, dead, evidence, findings });
    return { date, trunk, reportRel, removableWorktrees, strandedBranches, rootLitter, deadRefs: dead, evidence, findings, report };
  }

  return { sweep, fingerprintOf: fp, _internals: { extractRefs, isRootLitter, isPlanDoc, worktreeName, humanBytes } };
}

// Deterministic markdown report body. Ordering is stable (already sorted upstream) so two sweeps over
// the same repo state render byte-identically.
function renderReport(s) {
  const L = [];
  const p = (x) => L.push(x);
  p('# Janitor sweep — ' + s.date);
  p('');
  p('> Hygiene report for the Self-Testing Station. **Propose-only**: the Janitor never');
  p('> deletes, prunes, or edits anything — it reports commands for a human to run.');
  p('> Watched trunk: `' + s.trunk + '`. Stranded threshold: ' + s.staleDays + ' days.');
  p('');
  p('## Summary');
  p('');
  p('| Check | Count |');
  p('| --- | --- |');
  p('| Removable worktrees (merged + clean) | ' + s.removableWorktrees.length + ' |');
  p('| Stranded branches (>' + s.staleDays + 'd, unmerged) | ' + s.strandedBranches.length + ' |');
  p('| Root litter (loose artifacts) | ' + s.rootLitter.length + ' |');
  p('| Dead doc references (filed) | ' + s.dead.filed.length + ' |');
  p('| Dead doc references (plan/aspirational, info-only) | ' + s.dead.info.length + ' |');
  p('| Ledger findings filed this sweep | ' + s.findings.length + ' |');
  p('');

  p('## 1. Removable worktrees');
  p('');
  if (!s.removableWorktrees.length) {
    p('_None. Every non-main worktree is either unmerged or has uncommitted changes._');
  } else {
    p('Branch fully merged into trunk **and** working tree clean. Run per candidate (propose-only — a human runs these):');
    p('');
    p('```powershell');
    for (const wt of s.removableWorktrees) p(wt.command + '   # branch ' + wt.branch);
    p('```');
  }
  p('');

  p('## 2. Stranded work (unmerged, idle >' + s.staleDays + 'd)');
  p('');
  if (!s.strandedBranches.length) {
    p('_None. No unmerged branch has been idle past the threshold._');
  } else {
    p('The fake-done pattern surfacing — reported, not judged.');
    p('');
    p('| Branch | Ahead | Last commit | Idle |');
    p('| --- | --- | --- | --- |');
    for (const b of s.strandedBranches) {
      p('| `' + b.branch + '` | ' + b.ahead + ' | ' + (b.lastCommitIso || '—') + ' (' + (b.lastCommitSha || '?') + ') | ~' + b.ageDays + 'd |');
    }
  }
  p('');

  p('## 3. Root litter (removal candidates — flag only)');
  p('');
  if (!s.rootLitter.length) {
    p('_None. Repo root is free of loose binary/image/log artifacts._');
  } else {
    p('Untracked binary/image/log files sitting at repo root (' + s.rootLitter.length + '). Flagged, **never deleted**:');
    p('');
    for (const n of s.rootLitter) p('- `' + n + '`');
  }
  p('');

  p('## 4. Dead doc references');
  p('');
  p('_Precision check: refs must be backticked, path-shaped, anchored to a real top-level dir, with an');
  p('existing parent dir, not gitignored, and not a dotted method-reference. **Filed** = a non-plan doc');
  p('claim OR a path deleted from git history (true rot). **Info-only** = a plan/roadmap naming a file it');
  p('intends to build (aspirational, not rot) — reported but never filed, to keep the janitor quiet._');
  p('');
  if (!s.dead.filed.length) {
    p('**Filed:** _none._');
  } else {
    p('**Filed (' + s.dead.filed.length + '):**');
    p('');
    for (const r of s.dead.filed) p('- `' + r.file + '` → `' + r.ref + '`' + (r.deleted ? ' _(deleted from history — true rot)_' : ' _(non-plan doc)_'));
  }
  p('');
  if (s.dead.info.length) {
    p('**Info-only — plan/roadmap aspirational refs (' + s.dead.info.length + ', not filed):**');
    p('');
    for (const r of s.dead.info) p('- `' + r.file + '` → `' + r.ref + '`');
    p('');
  }

  p('## 5. Evidence directory growth');
  p('');
  if (!s.evidence.length) {
    p('_No evidence directories present._');
  } else {
    p('| Directory | Present | Size |');
    p('| --- | --- | --- |');
    for (const e of s.evidence) p('| `' + e.name + '` | ' + (e.exists ? 'yes' : 'no') + ' | ' + (e.exists ? humanBytesTop(e.bytes) : '—') + ' |');
  }
  p('');
  return L.join('\n');
}
function humanBytesTop(n) {
  n = num(n);
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1, v = n;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}

/* ───────────────────────────── THIN CLI WRAPPER ─────────────────────────────
 * Only runs when invoked directly. This block is the ONLY place ambient git + fs + Date.now() live —
 * the composition root — exactly like ledger.mjs. It shells git READ-ONLY, reads docs, du's evidence
 * dirs, then hands a fully-injected io to the pure core. Findings are filed through the REAL ledger
 * (so dedup + known-refusal + evidence-law all apply identically). Static imports are side-effect-free
 * so require(esm) from the CJS test still works.
 */

const INVOKED_DIRECTLY = (() => {
  try { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
  catch (_) { return false; }
})();

if (INVOKED_DIRECTLY) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // The Janitor watches the MAIN working tree (where trunk lives + where litter/evidence accumulate),
  // NOT whichever worktree it happens to be invoked from. Resolve it from git; fall back to two-up.
  const gitRO = (args, cwd) => {
    try { return execFileSync('git', args, { cwd: cwd || process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
    catch (_) { return ''; }
  };
  const localRoot = path.resolve(__dirname, '..', '..');
  const parseWorktrees = (porcelain) => {
    const list = [];
    let cur = null;
    for (const line of str(porcelain).split(/\r?\n/)) {
      if (line.startsWith('worktree ')) { if (cur) list.push(cur); cur = { path: line.slice(9).trim(), branch: '', isMain: list.length === 0 }; }
      else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line === '' && cur) { list.push(cur); cur = null; }
    }
    if (cur) list.push(cur);
    if (list.length) list[0].isMain = true;                      // first porcelain entry is always the main worktree
    return list;
  };
  const worktreesRaw = parseWorktrees(gitRO(['worktree', 'list', '--porcelain'], localRoot));
  // MAIN = the tree the Janitor WATCHES (reads): git metadata is shared, but litter/evidence/docs
  // physically live in the main integration tree. OUT_ROOT = the tree the Janitor WRITES into (its
  // report + findings + STATUS row). They differ when run from a linked worktree: we read the shared
  // main tree but keep every WRITE inside our own checkout, never touching the integration tree or
  // another agent's worktree (Part 5 read-only + one-agent-per-worktree laws). Override OUT_ROOT via
  // --out-root <dir> or QA_JANITOR_OUT env for a deployed pinned-worktree runner.
  const MAIN = (worktreesRaw[0] && worktreesRaw[0].path) ? path.resolve(worktreesRaw[0].path) : localRoot;

  const trunkBranch = () => {
    // The integration branch this repo merges into. Prefer the main worktree's branch, else the doc default.
    const b = (worktreesRaw[0] && worktreesRaw[0].branch) || '';
    return b || 'feat/harness-backend';
  };

  const relOf = (rel) => path.join(MAIN, rel.replace(/\\/g, '/'));

  const realIo = {
    trunkBranch,
    worktrees: () => worktreesRaw,
    aheadCount: (branch) => {
      const out = gitRO(['rev-list', '--count', trunkBranch() + '..' + branch], MAIN).trim();
      const n = parseInt(out, 10);
      return isFinite(n) ? n : 1;                                // unknown => treat as ahead (NOT removable) — safe default
    },
    isClean: (wtPath) => gitRO(['-C', wtPath, 'status', '--porcelain'], MAIN).trim() === '',
    lastCommit: (branch) => {
      const out = gitRO(['log', '-1', '--format=%cI%x09%ct%x09%h', branch], MAIN).trim();
      if (!out) return null;
      const [iso, ct, shortSha] = out.split('\t');
      return { iso, epochMs: (parseInt(ct, 10) || 0) * 1000, shortSha };
    },
    rootEntries: () => {
      let names = [];
      try { names = fs.readdirSync(MAIN); } catch (_) { return []; }
      const tracked = new Set(gitRO(['ls-files'], MAIN).split(/\r?\n/).map(s => s.split('/')[0]).filter(Boolean));
      const out = [];
      for (const name of names) {
        if (name === '.git') continue;
        let isDir = false;
        try { isDir = fs.statSync(path.join(MAIN, name)).isDirectory(); } catch (_) {}
        out.push({ name, isDir, tracked: tracked.has(name) && !isDir ? isTrackedFile(name) : false });
      }
      return out;
    },
    docFiles: () => {
      const rel = gitRO(['ls-files', '*.md', 'docs/*.md'], MAIN).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const uniq = Array.from(new Set(rel));
      const out = [];
      for (const f of uniq) {
        try { out.push({ file: f, text: fs.readFileSync(path.join(MAIN, f), 'utf8') }); } catch (_) {}
      }
      return out;
    },
    topDirs: () => {
      const dirs = gitRO(['ls-tree', '-d', '--name-only', 'HEAD'], MAIN).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      return new Set(dirs);
    },
    pathExists: (rel) => { try { return fs.existsSync(relOf(rel)); } catch (_) { return false; } },
    parentExists: (rel) => { try { return fs.existsSync(path.dirname(relOf(rel))); } catch (_) { return false; } },
    isIgnored: (rel) => {
      try { execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: MAIN, stdio: 'ignore' }); return true; }
      catch (_) { return false; }
    },
    // "true rot" = the path was once committed ON TRUNK but is gone now. Scope to trunk history, NOT
    // --all: a file that only ever lived on an unmerged sibling branch (e.g. another lane's to-build
    // deliverable) is NOT deleted-from-trunk rot — it's just not merged yet. Using --all here mis-flags
    // sibling work as rot (caught in the movie test).
    everInHistory: (rel) => gitRO(['log', '--oneline', trunkBranch(), '--', rel], MAIN).trim().length > 0,
    evidenceDirs: () => {
      const names = ['.bugloops', '.uishots', '.uishots-props', '.uishots-trunk', '.uishots-trunk2', '.goldens'];
      // glob any extra .uishots* dirs at root
      try {
        for (const n of fs.readdirSync(MAIN)) if (/^\.uishots/.test(n) && !names.includes(n)) names.push(n);
      } catch (_) {}
      const out = [];
      for (const n of Array.from(new Set(names))) {
        const abs = path.join(MAIN, n);
        let exists = false, bytes = 0;
        try { exists = fs.statSync(abs).isDirectory(); } catch (_) { exists = false; }
        if (exists) bytes = dirSize(abs);
        out.push({ name: n, exists, bytes });
      }
      return out;
    }
  };

  // is a depth-1 root NAME a tracked file (not just a tracked dir prefix)?
  function isTrackedFile(name) {
    const listed = gitRO(['ls-files', '--', name], MAIN).trim();
    return listed.split(/\r?\n/).some(l => l.trim() === name);
  }
  function dirSize(dir) {
    let total = 0;
    let stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      let ents;
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { continue; }
      for (const e of ents) {
        const fp2 = path.join(d, e.name);
        if (e.isDirectory()) stack.push(fp2);
        else { try { total += fs.statSync(fp2).size; } catch (_) {} }
      }
    }
    return total;
  }

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  let staleDays = STALE_DAYS_DEFAULT;
  const sdIdx = args.indexOf('--stale-days');
  if (sdIdx >= 0 && args[sdIdx + 1]) { const n = parseInt(args[sdIdx + 1], 10); if (isFinite(n) && n > 0) staleDays = n; }
  // OUT_ROOT resolution: explicit --out-root wins, then QA_JANITOR_OUT env, else our own checkout
  // (localRoot). We NEVER default writes to MAIN — writing into the shared integration tree is banned.
  const orIdx = args.indexOf('--out-root');
  const OUT_ROOT = path.resolve(
    (orIdx >= 0 && args[orIdx + 1]) ? args[orIdx + 1] : (process.env.QA_JANITOR_OUT || localRoot)
  );

  // Wire the real ledger's fingerprint fn so janitor + ledger fingerprints are byte-identical.
  // Loaded via a SYNCHRONOUS require (createRequire) — never top-level `await import`, which would
  // flip this module into a top-level-await module that Node's require(esm) can no longer evaluate,
  // breaking the CJS test's `require('../scripts/qa/janitor.mjs')`.
  let ledgerFp = fingerprintOf;
  let ledgerMod = null;
  try {
    ledgerMod = createRequire(import.meta.url)('./ledger.mjs');
    if (typeof ledgerMod.fingerprintOf === 'function') ledgerFp = ledgerMod.fingerprintOf;
  } catch (_) { /* fall back to the local identical hash */ }

  const janitor = makeJanitor({ io: realIo, clock: { now: () => Date.now() }, staleDays, fingerprintOf: ledgerFp });
  let result;
  try { result = janitor.sweep(); }
  catch (e) {
    console.error('[qa:janitor] BLOCKED — sweep could not run: ' + (e && e.message));
    process.exit(1);
  }

  // Write the report (unless dry-run) — into OUT_ROOT (our own checkout), never MAIN.
  const DIGESTS_DIR = path.join(OUT_ROOT, 'qa', 'digests');
  const reportAbs = path.join(OUT_ROOT, result.reportRel);
  if (!dryRun) {
    try {
      fs.mkdirSync(DIGESTS_DIR, { recursive: true });
      fs.writeFileSync(reportAbs, result.report + '\n', 'utf8');
      console.error('[qa:janitor] wrote ' + result.reportRel);
    } catch (e) {
      console.error('[qa:janitor] BLOCKED — could not write report: ' + (e && e.message));
      process.exit(1);
    }
  }

  // File findings through the REAL ledger (dedup + known-refusal + evidence-law all apply).
  let added = 0, dup = 0, refused = 0;
  if (!dryRun && ledgerMod && typeof ledgerMod.makeLedger === 'function') {
    const FINDINGS_DIR = path.join(OUT_ROOT, 'qa', 'findings');
    const KNOWN_FILE = path.join(OUT_ROOT, 'qa', 'KNOWN_ISSUES.md');
    const ledgerIo = {
      listFindings() {
        let names; try { names = fs.readdirSync(FINDINGS_DIR); } catch (_) { return []; }
        const out = [];
        for (const n of names) { if (!n.endsWith('.json')) continue; try { out.push(JSON.parse(fs.readFileSync(path.join(FINDINGS_DIR, n), 'utf8'))); } catch (_) {} }
        return out;
      },
      writeFinding(finding) {
        fs.mkdirSync(FINDINGS_DIR, { recursive: true });
        const safe = String(finding.id).replace(/[^A-Za-z0-9._-]/g, '_');
        fs.writeFileSync(path.join(FINDINGS_DIR, safe + '.json'), JSON.stringify(finding, null, 2) + '\n', 'utf8');
      },
      knownFingerprints() {
        try {
          const txt = fs.readFileSync(KNOWN_FILE, 'utf8');
          const set = new Set(); const re = /fingerprint[:=]\s*`?([0-9a-fA-F]{6,})`?/g; let m;
          while ((m = re.exec(txt))) set.add(m[1].toLowerCase());
          return set;
        } catch (_) { return new Set(); }
      }
    };
    const ledger = ledgerMod.makeLedger({ io: ledgerIo, clock: { now: () => Date.now() } });
    for (const f of result.findings) {
      const res = ledger.add(f);
      if (res.ok && res.status === 'added') added++;
      else if (res.ok && res.status === 'duplicate') dup++;
      else refused++;
    }
  }

  // Update the Janitor row in qa/STATUS.md (best-effort; never fatal). Into OUT_ROOT, never MAIN.
  if (!dryRun) {
    try { updateStatusRow(OUT_ROOT, result.date, result.findings.length); } catch (_) {}
  }

  // Console summary.
  const S = [];
  S.push('Janitor sweep — ' + result.date + ' (watching ' + result.trunk + ' @ ' + MAIN + ')');
  if (OUT_ROOT !== MAIN) S.push('  output -> ' + OUT_ROOT + ' (writes stay in this checkout, never the integration tree)');
  S.push('  removable worktrees : ' + result.removableWorktrees.length);
  S.push('  stranded branches   : ' + result.strandedBranches.length + ' (>' + staleDays + 'd)');
  S.push('  root litter         : ' + result.rootLitter.length);
  S.push('  dead doc refs       : ' + result.deadRefs.filed.length + ' filed, ' + result.deadRefs.info.length + ' info-only');
  S.push('  evidence dirs       : ' + result.evidence.filter(e => e.exists).length + ' present');
  if (!dryRun) S.push('  ledger              : ' + added + ' new, ' + dup + ' dup, ' + refused + ' refused');
  else S.push('  (dry-run: nothing written, nothing filed)');
  console.log(S.join('\n'));
  process.exit(0);

  function updateStatusRow(root, date, findingCount) {
    const file = path.join(root, 'qa', 'STATUS.md');
    let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
    const result2 = findingCount === 0 ? 'clean' : (findingCount + ' finding' + (findingCount === 1 ? '' : 's'));
    // Replace the Janitor row's "Last run" + "Result" cells; keep the rest of the table intact.
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^\|\s*Janitor\s*\|/.test(lines[i])) {
        const cells = lines[i].split('|');
        // cells: ['', ' Janitor ', ' question ', ' last run ', ' result ', ' open ', '']
        if (cells.length >= 6) {
          cells[3] = ' ' + date + ' ';
          cells[4] = ' ' + result2 + ' ';
          lines[i] = cells.join('|');
        }
        break;
      }
    }
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
  }
}
