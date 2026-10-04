/* node test/qa-janitor.test.js — the Self-Testing Station's hygiene sweep (lane Q4),
   fed a SYNTHETIC git+fs io (zero real git, zero disk). Asserts the classification logic:
   removable-worktree (merged + clean), stranded-branch (unmerged + idle > N days), root
   litter (untracked binary artifacts), dead-doc-ref precision (conservative filed/info
   tiering — plan docs & aspirational refs are info-only, non-plan/deleted-from-trunk refs
   are filed), evidence sizing, and FINGERPRINT STABILITY across runs (so re-runs dedup).
   Pure + deterministic — every timestamp comes from the injected clock, never Date.now(),
   and NO real git mutation ever happens (propose-only is proven by construction: the core
   has no fs/git handle at all — it only reads what the injected io returns). */
'use strict';
const A = require('./_assert.js');
const { makeJanitor, fingerprintOf } = require('../scripts/qa/janitor.mjs');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-01T00:00:00Z');
const clock = { now: () => NOW };

// A fully-synthetic io. Every field is a plain fixture the core reads — no git, no fs. Anything
// omitted exercises the core's fail-open path.
function fakeIo(over) {
  const base = {
    trunk: 'feat/harness-backend',
    worktrees: [
      { path: 'C:/repo', branch: 'feat/harness-backend', isMain: true },              // main tree — never a candidate
      { path: 'C:/trees/merged-clean', branch: 'agent/merged-clean' },                // merged + clean -> removable
      { path: 'C:/trees/merged-dirty', branch: 'agent/merged-dirty' },                // merged but DIRTY -> not removable
      { path: 'C:/trees/ahead-fresh', branch: 'agent/ahead-fresh' },                  // ahead, recent -> neither
      { path: 'C:/trees/ahead-stale', branch: 'agent/ahead-stale' }                   // ahead, idle 40d -> stranded
    ],
    ahead: {                                                                          // trunk..branch commit counts
      'agent/merged-clean': 0, 'agent/merged-dirty': 0,
      'agent/ahead-fresh': 3, 'agent/ahead-stale': 2
    },
    clean: {                                                                          // working-tree clean?
      'C:/trees/merged-clean': true, 'C:/trees/merged-dirty': false,
      'C:/trees/ahead-fresh': true, 'C:/trees/ahead-stale': true
    },
    lastCommit: {
      'agent/ahead-fresh': { iso: '2026-06-29T00:00:00Z', epochMs: NOW - 2 * DAY, shortSha: 'aaaaaaa' },
      'agent/ahead-stale': { iso: '2026-05-22T00:00:00Z', epochMs: NOW - 40 * DAY, shortSha: 'bbbbbbb' }
    },
    rootEntries: [
      { name: 'screenshot.png', isDir: false, tracked: false },                       // litter
      { name: 'crash.log', isDir: false, tracked: false },                            // litter
      { name: 'thumb.jpeg', isDir: false, tracked: false },                           // litter
      { name: 'logo.png', isDir: false, tracked: true },                              // TRACKED png -> not litter
      { name: 'README.md', isDir: false, tracked: true },                             // tracked doc -> not litter
      { name: 'notes.txt', isDir: false, tracked: false },                            // not a litter extension
      { name: 'assets', isDir: true, tracked: false }                                 // a DIR -> never litter
    ],
    topDirs: new Set(['docs', 'sidecar', 'test', 'scripts', 'frontend']),
    docFiles: [
      // a NON-plan doc citing a missing, real-dir-anchored path -> FILED (high confidence rot claim)
      { file: 'docs/GUIDE.md', text: 'See `sidecar/gone.js` for details. Also `sidecar/present.js`.' },
      // a PLAN doc citing a missing path -> INFO-only (aspirational, never filed)
      { file: 'docs/BUILD_PLAN.md', text: 'We will build `scripts/future.mjs` next.' },
      // a doc citing a path DELETED FROM TRUNK -> FILED even though it is a plan doc (true rot beats plan)
      { file: 'docs/RELEASE_PLAN.md', text: 'Ships with `test/deleted-from-trunk.test.js`.' },
      // noise that must NOT be flagged: a method ref (dotted mid-segment), a non-top-dir path,
      // a gitignored path, and a path whose PARENT dir is fictional.
      { file: 'docs/NOISE.md', text: 'call `SIM.load/SIM.save.js`; see `other/thing.js`; `sidecar/.env.local`; `ghostdir/ghost.js`.' }
    ],
    // existence oracle: only these paths "exist".
    existing: new Set(['sidecar/present.js', 'sidecar', 'docs', 'test', 'scripts', 'frontend', 'ghostdir/..']),
    ignored: new Set(['sidecar/.env.local']),
    inTrunkHistory: new Set(['test/deleted-from-trunk.test.js']),                     // once on trunk, now gone = rot
    evidence: [
      { name: '.uishots', exists: true, bytes: 40 * 1024 * 1024 },
      { name: '.bugloops', exists: false, bytes: 0 }
    ]
  };
  return Object.assign(base, over || {});
}

// Wrap the fixtures into the io method surface the core expects.
function ioFrom(fx) {
  const parent = (rel) => rel.split('/').slice(0, -1).join('/');
  return {
    trunkBranch: () => fx.trunk,
    worktrees: () => fx.worktrees,
    aheadCount: (b) => (b in fx.ahead ? fx.ahead[b] : 1),
    isClean: (p) => fx.clean[p] === true,
    lastCommit: (b) => fx.lastCommit[b] || null,
    rootEntries: () => fx.rootEntries,
    topDirs: () => fx.topDirs,
    docFiles: () => fx.docFiles,
    pathExists: (rel) => fx.existing.has(rel),
    parentExists: (rel) => fx.existing.has(parent(rel)),
    isIgnored: (rel) => fx.ignored.has(rel),
    everInHistory: (rel) => fx.inTrunkHistory.has(rel),
    evidenceDirs: () => fx.evidence
  };
}

// ---- A. removable worktrees: only merged AND clean, never the main tree ----
{
  const J = makeJanitor({ io: ioFrom(fakeIo()), clock, staleDays: 14 });
  const r = J.sweep({ date: '2026-07-01' });
  const names = r.removableWorktrees.map(w => w.name);
  A.eq(names, ['merged-clean'], 'only the merged+clean worktree is removable');
  const wt = r.removableWorktrees[0];
  A.ok(/remove-agent-tree\.ps1 merged-clean -DeleteBranch/.test(wt.command), 'exact propose-only removal command is rendered');
  A.eq(wt.branch, 'agent/merged-clean', 'removable candidate carries its branch');
  // main tree, dirty-but-merged, and ahead worktrees are all excluded.
  A.ok(!names.includes('repo'), 'the main integration tree is never a removal candidate');
  A.ok(!names.includes('merged-dirty'), 'a merged-but-DIRTY worktree is NOT removable');
  A.ok(!names.includes('ahead-fresh') && !names.includes('ahead-stale'), 'unmerged worktrees are not removable');
}

// ---- A2. fail-open safety: unknown ahead-count / clean state => NOT removable (never proposes wrongly) ----
{
  const fx = fakeIo({ ahead: {}, clean: {} });                 // io answers nothing
  const J = makeJanitor({ io: ioFrom(fx), clock });
  const r = J.sweep({ date: 'd' });
  A.eq(r.removableWorktrees.length, 0, 'with unknown merge/clean state, nothing is proposed for removal (safe default)');
}

// ---- B. stranded branches: ahead of trunk AND idle beyond the threshold ----
{
  const J = makeJanitor({ io: ioFrom(fakeIo()), clock, staleDays: 14 });
  const r = J.sweep({ date: 'd' });
  const names = r.strandedBranches.map(b => b.name);
  A.eq(names, ['ahead-stale'], 'only the ahead+idle>14d branch is stranded');
  const b = r.strandedBranches[0];
  A.eq(b.ahead, 2, 'stranded finding carries the ahead-count');
  A.eq(b.ageDays, 40, 'stranded finding carries the idle age in days');
  A.ok(!names.includes('ahead-fresh'), 'a recently-committed ahead branch is NOT stranded');
  A.ok(!names.includes('merged-clean'), 'a merged branch is never stranded (no unmerged work)');
  // tightening the threshold past the fresh branch pulls it in too.
  const J2 = makeJanitor({ io: ioFrom(fakeIo()), clock, staleDays: 1 });
  const r2 = J2.sweep({ date: 'd' });
  A.eq(r2.strandedBranches.map(b => b.name).sort(), ['ahead-fresh', 'ahead-stale'], 'a 1-day threshold strands both ahead branches');
}

// ---- C. root litter: untracked binary/image/log files only ----
{
  const J = makeJanitor({ io: ioFrom(fakeIo()), clock });
  const r = J.sweep({ date: 'd' });
  A.eq(r.rootLitter, ['crash.log', 'screenshot.png', 'thumb.jpeg'], 'exactly the untracked binary/image/log files, sorted');
  A.ok(!r.rootLitter.includes('logo.png'), 'a TRACKED png is not litter');
  A.ok(!r.rootLitter.includes('notes.txt'), 'a .txt is not a litter extension');
  A.ok(!r.rootLitter.includes('assets'), 'a directory is never litter');
}

// ---- D. dead-doc-ref precision: conservative filed/info tiering ----
{
  const J = makeJanitor({ io: ioFrom(fakeIo()), clock });
  const r = J.sweep({ date: 'd' });
  const filed = r.deadRefs.filed.map(x => x.file + '->' + x.ref).sort();
  const info = r.deadRefs.info.map(x => x.file + '->' + x.ref).sort();

  // FILED: the non-plan-doc missing ref, and the deleted-from-trunk ref (true rot).
  A.eq(filed, ['docs/GUIDE.md->sidecar/gone.js', 'docs/RELEASE_PLAN.md->test/deleted-from-trunk.test.js'],
    'filed tier = non-plan missing ref + deleted-from-trunk rot');
  A.eq(r.deadRefs.filed.find(x => x.ref === 'test/deleted-from-trunk.test.js').deleted, true, 'the rot ref is flagged deleted:true');

  // INFO-only: the plan-doc aspirational ref.
  A.eq(info, ['docs/BUILD_PLAN.md->scripts/future.mjs'], 'info tier = the plan/roadmap aspirational ref only');

  // NOISE that must appear in NEITHER tier (the precision guarantees):
  const all = filed.concat(info).join(' ');
  A.ok(!/SIM\.load/.test(all), 'a dotted method ref (SIM.load/SIM.save.js) is never flagged');
  A.ok(!/other\/thing\.js/.test(all), 'a path not anchored to a real top-level dir is never flagged');
  A.ok(!/\.env\.local/.test(all), 'a gitignored path is never flagged');
  A.ok(!/ghost/.test(all), 'a path whose parent dir does not exist is never flagged');
  // the present file is not flagged at all.
  A.ok(!/present\.js/.test(all), 'an existing referenced file is not a dead ref');
}

// ---- E. findings: one per issue-class instance, correct crew/severity/evidence, all P2 ----
{
  const J = makeJanitor({ io: ioFrom(fakeIo()), clock });
  const r = J.sweep({ date: '2026-07-01' });
  // 1 removable + 1 stranded + 1 root-litter (one finding for the whole litter set) + 2 dead-ref = 5
  A.eq(r.findings.length, 5, 'one finding per issue-class instance (1 removable, 1 stranded, 1 litter, 2 dead-ref)');
  for (const f of r.findings) {
    A.eq(f.crew, 'Janitor', 'every finding is filed under the Janitor crew seat');
    A.eq(f.severity, 'P2', 'hygiene findings are always P2 (informational, never a merge blocker)');
    A.eq(f.evidence, ['qa/digests/janitor-2026-07-01.md'], 'every finding points at the dated report (evidence law)');
    A.ok(f.fingerprint && /^[0-9a-f]{8}$/.test(f.fingerprint), 'every finding carries a stable 8-hex fingerprint');
    A.ok(f.title && f.detail, 'every finding has a title and detail');
  }
  // root litter is ONE finding summarizing all files, not one-per-file (anti-nag).
  const litter = r.findings.filter(f => /Root litter/.test(f.title));
  A.eq(litter.length, 1, 'root litter files into a single finding, not one per file');
}

// ---- F. fingerprint STABILITY across runs: same repo state => identical fingerprints => dedup ----
{
  const J1 = makeJanitor({ io: ioFrom(fakeIo()), clock });
  const J2 = makeJanitor({ io: ioFrom(fakeIo()), clock: { now: () => NOW + 5 * DAY } });   // different clock, same subjects
  const fps1 = J1.sweep({ date: 'a' }).findings.map(f => f.fingerprint).sort();
  const fps2 = J2.sweep({ date: 'b' }).findings.map(f => f.fingerprint).sort();
  A.eq(fps1, fps2, 'fingerprints depend only on (crew+checkId+subject), not on time or date — so re-runs dedup');
  // and they match the standalone fingerprintOf for a known subject (byte-identical to the ledger hash).
  const expect = fingerprintOf({ crew: 'Janitor', checkId: 'removable-worktree', subject: 'merged-clean' });
  A.ok(fps1.includes(expect), 'a removable-worktree fingerprint matches fingerprintOf(crew,checkId,subject)');
}

// ---- G. deterministic report body: two sweeps over identical state render byte-identically ----
{
  const a = makeJanitor({ io: ioFrom(fakeIo()), clock }).sweep({ date: '2026-07-01' }).report;
  const b = makeJanitor({ io: ioFrom(fakeIo()), clock }).sweep({ date: '2026-07-01' }).report;
  A.eq(a, b, 'the report is deterministic (stable ordering) so re-runs diff cleanly');
  A.ok(/## 1\. Removable worktrees/.test(a), 'report has the removable-worktree section');
  A.ok(/## 3\. Root litter/.test(a), 'report has the root-litter section');
  A.ok(/remove-agent-tree\.ps1 merged-clean -DeleteBranch/.test(a), 'report embeds the propose-only command');
  A.ok(/40 MB/.test(a), 'report renders human-readable evidence sizes');
  A.ok(/Info-only/.test(a), 'report shows the info-only dead-ref tier');
}

// ---- H. empty / malformed io never throws; degrades to an all-clean sweep (fail-open) ----
{
  let J, r;
  A.notThrows(() => { J = makeJanitor({ io: {}, clock }); }, 'construction with an empty io does not throw');
  A.notThrows(() => { r = J.sweep({ date: 'd' }); }, 'a sweep over an empty io does not throw');
  A.eq(r.removableWorktrees.length, 0, 'empty io -> no removable worktrees');
  A.eq(r.strandedBranches.length, 0, 'empty io -> no stranded branches');
  A.eq(r.rootLitter.length, 0, 'empty io -> no litter');
  A.eq(r.findings.length, 0, 'empty io -> no findings (clean sweep)');
  A.ok(typeof r.report === 'string' && r.report.length > 0, 'a report is still rendered for a clean sweep');
  // an io whose methods THROW is swallowed per-check, not fatal.
  const throwingIo = {
    worktrees() { throw new Error('git gone'); },
    docFiles() { throw new Error('fs gone'); },
    rootEntries() { throw new Error('nope'); },
    evidenceDirs() { throw new Error('nope'); }
  };
  let r2;
  A.notThrows(() => { r2 = makeJanitor({ io: throwingIo, clock }).sweep({ date: 'd' }); }, 'a throwing io is swallowed per-check, sweep survives');
  A.eq(r2.findings.length, 0, 'a throwing io yields an empty (not false-positive) sweep');
}

A.report('qa-janitor.test');
