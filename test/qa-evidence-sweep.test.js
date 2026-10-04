/* node test/qa-evidence-sweep.test.js — the Self-Testing Station's EVIDENCE RETENTION sweep (lane GB-27).
   Exercises the REAL fs path against a throwaway FIXTURE tree built under os.tmpdir(): fake families
   (guardian/beginner/crew), real mtimes set via utimesSync, real qa/findings/*.json. Asserts the
   retention policy EXACTLY: expired-unprotected deleted, newest-5-per-family kept, evidence-referenced
   kept (and only for NON-resolved findings), *-latest kept, within-window kept, dry-run deletes/writes
   nothing, unreadable/unparseable findings => ZERO deletions (fail-open). The sweep is NEVER pointed at
   the real ./.bugloops here — only at the temp fixture. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runSweep, planSweep, familyOf, isLatestPointer, referencedEntryNames } = require('../scripts/qa/evidence-sweep.mjs');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-09T12:00:00Z');

// Build a fresh, isolated fixture: <tmp>/.bugloops/<entries> + <tmp>/qa/findings/<jsons>.
// entries: [{ name, ageDays, files? }]  — a dir per entry, dir mtime set to NOW - ageDays.
// findings: [{ id, status, evidence:[...] }] — one JSON each; plus a README + .gitkeep (must be ignored).
function makeFixture(entries, findings, opts) {
  opts = opts || {};
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'evsweep-'));
  const bugloopsDir = path.join(root, '.bugloops');
  const findingsDir = path.join(root, 'qa', 'findings');
  fs.mkdirSync(bugloopsDir, { recursive: true });
  fs.mkdirSync(findingsDir, { recursive: true });

  for (const e of entries) {
    const dir = path.join(bugloopsDir, e.name);
    fs.mkdirSync(dir, { recursive: true });
    // drop a file inside so the bundle is non-trivial (and dir mtime is stable once we set it last)
    fs.writeFileSync(path.join(dir, 'golden.log'), 'evidence for ' + e.name + '\n', 'utf8');
    const t = (NOW - e.ageDays * DAY) / 1000;                    // seconds since epoch
    fs.utimesSync(dir, t, t);                                    // set atime+mtime AFTER writing inner file
  }
  // non-finding files in the findings dir must be ignored by the parser
  fs.writeFileSync(path.join(findingsDir, 'README.md'), '# findings\n', 'utf8');
  fs.writeFileSync(path.join(findingsDir, '.gitkeep'), '', 'utf8');
  for (const f of (findings || [])) {
    fs.writeFileSync(path.join(findingsDir, f.id + '.json'), JSON.stringify(f, null, 2) + '\n', 'utf8');
  }
  if (opts.corruptFinding) {
    fs.writeFileSync(path.join(findingsDir, 'corrupt.json'), '{ this is : not valid json,,, ', 'utf8');
  }
  return { root, bugloopsDir, findingsDir };
}
function names(list) { return list.map(x => x.name).sort(); }
function present(bugloopsDir, name) { return fs.existsSync(path.join(bugloopsDir, name)); }

// A canonical family layout reused by several cases:
//   guardian: A..E newest (well outside the window) -> newest-per-family floor,
//             F 36d (evidence-referenced by an OPEN finding) -> kept,
//             G 37d + H 38d (expired, unprotected) -> DELETED,
//             guardian-...-latest 40d (oldest, would-be-expired) -> kept via latest rule
//   crew: 6 entries all INSIDE the window -> 5 newest-per-family + 1 within-retention -> all kept
//   beginner: 2 very-old entries -> family < 5 so both are newest-per-family -> kept
const GUARDIAN = [
  { name: 'guardian-20260705-000000', ageDays: 31 },
  { name: 'guardian-20260704-000000', ageDays: 32 },
  { name: 'guardian-20260703-000000', ageDays: 33 },
  { name: 'guardian-20260702-000000', ageDays: 34 },
  { name: 'guardian-20260701-000000', ageDays: 35 },
  { name: 'guardian-20260631-000000', ageDays: 36 },   // F — evidence-referenced (open finding)
  { name: 'guardian-20260630-000000', ageDays: 37 },   // G — expired, unprotected -> DELETE
  { name: 'guardian-20260629-000000', ageDays: 38 },   // H — expired, unprotected -> DELETE
  { name: 'guardian-20260101-latest', ageDays: 40 }     // latest pointer -> keep despite age
];
const CREW = [
  { name: 'crew-20260709-a', ageDays: 1 }, { name: 'crew-20260708-a', ageDays: 2 },
  { name: 'crew-20260707-a', ageDays: 3 }, { name: 'crew-20260706-a', ageDays: 4 },
  { name: 'crew-20260705-a', ageDays: 5 }, { name: 'crew-20260704-a', ageDays: 6 }   // 6th, inside window
];
const BEGINNER = [
  { name: 'beginner-2026-06-01T00-00-00', ageDays: 50 },
  { name: 'beginner-2026-05-01T00-00-00', ageDays: 70 }
];
const ALL_ENTRIES = [].concat(GUARDIAN, CREW, BEGINNER);

// Findings: an OPEN finding protecting guardian-F, plus a RESOLVED (dismissed) finding citing
// guardian-G — proving a resolved finding does NOT protect (G must still be deleted).
const FINDINGS = [
  { id: 'open-1', status: 'open', evidence: ['.bugloops/guardian-20260631-000000/golden.log'] },
  { id: 'routed-1', status: 'routed', evidence: ['.bugloops/guardian-20260631-000000/extra.log'] },  // 2nd open ref, same entry
  { id: 'dismissed-1', status: 'dismissed', evidence: ['.bugloops/guardian-20260630-000000/golden.log'] }
];

/* ── A. pure helpers: familyOf / isLatestPointer / referencedEntryNames ── */
{
  A.eq(familyOf('guardian-20260701-235647'), 'guardian', 'family strips the date stamp (guardian)');
  A.eq(familyOf('beginner-2026-07-01T23-15-27'), 'beginner', 'family strips ISO-ish date (beginner)');
  A.eq(familyOf('perfectionist-world3-20260707'), 'perfectionist-world3', 'family keeps compound non-date tokens');
  A.eq(familyOf('bug-hunt-20260707-010101'), 'bug-hunt', 'family = leading non-date tokens joined');
  A.ok(isLatestPointer('guardian-20260101-latest'), '-latest is a pointer');
  A.ok(!isLatestPointer('guardian-20260101-000000'), 'a normal stamp is not a latest pointer');
  const refs = referencedEntryNames(
    ['.bugloops/guardian-X/golden.log', 'C:\\repo\\.bugloops\\beginner-Y\\shot.png', '.uiatlas/report.json'],
    '.bugloops'
  );
  A.eq([...refs].sort(), ['beginner-Y', 'guardian-X'], 'evidence -> top-level entry names (rel + abs + \\-sep), non-bugloops ignored');
}

/* ── B. pure planner: deterministic decision over synthetic entries ── */
{
  const entries = ALL_ENTRIES.map(e => ({ name: e.name, mtimeMs: NOW - e.ageDays * DAY }));
  const p1 = planSweep({ entries, protectedNames: new Set(['guardian-20260631-000000']), now: NOW, retentionDays: 7, keepPerFamily: 5 });
  const p2 = planSweep({ entries: entries.slice().reverse(), protectedNames: ['guardian-20260631-000000'], now: NOW, retentionDays: 7, keepPerFamily: 5 });
  A.eq(names(p1.del), ['guardian-20260629-000000', 'guardian-20260630-000000'], 'planner deletes exactly the two expired-unprotected guardian bundles');
  A.eq(names(p1.del), names(p2.del), 'planner is order-independent (deterministic)');
  const reasonOf = (plan, n) => (plan.keep.find(k => k.name === n) || {}).reason;
  A.eq(reasonOf(p1, 'guardian-20260705-000000'), 'newest-per-family', 'newest bundle kept via family floor');
  A.eq(reasonOf(p1, 'guardian-20260631-000000'), 'evidence-referenced', 'the 6th-newest is BEYOND the floor and kept only by evidence');
  A.eq(reasonOf(p1, 'guardian-20260101-latest'), 'latest-pointer', 'old latest pointer kept');
  A.eq(reasonOf(p1, 'crew-20260704-a'), 'within-retention', '6th crew bundle kept as within the window');
}

/* ── C. REAL run: expired-unprotected deleted, everything else kept, manifest written ── */
{
  const fx = makeFixture(ALL_ENTRIES, FINDINGS);
  const manifestDir = path.join(fx.root, 'cycle');
  const res = runSweep({ bugloopsDir: fx.bugloopsDir, findingsDir: fx.findingsDir, now: NOW, manifestDir });

  A.eq(res.findingsError, false, 'valid findings => no fail-open');
  A.eq(res.deleted.sort(), ['guardian-20260629-000000', 'guardian-20260630-000000'], 'exactly the two expired-unprotected bundles deleted');
  // on-disk truth
  A.ok(!present(fx.bugloopsDir, 'guardian-20260630-000000'), 'expired unprotected G removed from disk (resolved finding did NOT protect it)');
  A.ok(!present(fx.bugloopsDir, 'guardian-20260629-000000'), 'expired unprotected H removed from disk');
  A.ok(present(fx.bugloopsDir, 'guardian-20260631-000000'), 'evidence-referenced F still on disk');
  A.ok(present(fx.bugloopsDir, 'guardian-20260705-000000'), 'newest-per-family bundle still on disk');
  A.ok(present(fx.bugloopsDir, 'guardian-20260101-latest'), 'latest pointer still on disk');
  A.ok(present(fx.bugloopsDir, 'crew-20260704-a'), 'within-window crew bundle still on disk');
  A.ok(present(fx.bugloopsDir, 'beginner-2026-05-01T00-00-00'), 'small-family beginner bundle still on disk');
  A.eq(res.counts.findingsProtecting, 1, 'exactly one entry protected by evidence (two open findings, same entry)');

  // manifest is written into the cycle dir and round-trips
  A.ok(res.manifestPath && fs.existsSync(res.manifestPath), 'a manifest json is written for a real run');
  A.ok(/cycle[\\/]sweep-manifest\.json$/.test(res.manifestPath), 'manifest lands in the guardian cycle dir when one is given');
  const man = JSON.parse(fs.readFileSync(res.manifestPath, 'utf8'));
  A.eq(man.deleted.sort(), ['guardian-20260629-000000', 'guardian-20260630-000000'], 'manifest records the deleted bundles');
  A.ok(man.kept.length >= 15 && man.dryRun === false, 'manifest records the kept bundles and marks the run non-dry');
  A.ok(man.kept.some(k => k.name === 'guardian-20260631-000000' && k.reason === 'evidence-referenced'), 'manifest carries the keep REASON per bundle');
}

/* ── D. DRY-RUN: deletes nothing, writes no manifest, still reports what WOULD go ── */
{
  const fx = makeFixture(ALL_ENTRIES, FINDINGS);
  const before = fs.readdirSync(fx.bugloopsDir).sort();
  const res = runSweep({ bugloopsDir: fx.bugloopsDir, findingsDir: fx.findingsDir, now: NOW, dryRun: true, manifestDir: path.join(fx.root, 'cycle') });
  A.eq(res.deleted.length, 0, 'dry-run deletes nothing');
  A.eq(res.wouldDelete.sort(), ['guardian-20260629-000000', 'guardian-20260630-000000'], 'dry-run still reports what WOULD be deleted');
  A.eq(fs.readdirSync(fx.bugloopsDir).sort(), before, 'dry-run leaves every bundle on disk');
  A.eq(res.manifestPath, null, 'dry-run writes no manifest');
  A.ok(!fs.existsSync(path.join(fx.root, 'cycle')), 'dry-run does not even create the manifest dir');
}

/* ── E. FAIL-OPEN: an unparseable finding => ZERO deletions, loud warning ── */
{
  const fx = makeFixture(ALL_ENTRIES, FINDINGS, { corruptFinding: true });
  const before = fs.readdirSync(fx.bugloopsDir).sort();
  let warned = '';
  // route the (still-written) audit manifest to a cycle dir so the swept dir is provably untouched
  const res = runSweep({ bugloopsDir: fx.bugloopsDir, findingsDir: fx.findingsDir, now: NOW, manifestDir: path.join(fx.root, 'cycle'), warn: (m) => { warned += m + '\n'; } });
  A.eq(res.findingsError, true, 'an unparseable finding flips findingsError');
  A.eq(res.deleted.length, 0, 'fail-open deletes NOTHING when findings cannot be trusted');
  A.eq(fs.readdirSync(fx.bugloopsDir).sort(), before, 'fail-open leaves every bundle on disk');
  A.ok(/FAIL-OPEN/.test(warned), 'fail-open emits a loud warning');
  A.ok(res.kept.some(k => k.name === 'guardian-20260630-000000' && k.reason === 'findings-error-abort'), 'the would-be-deleted bundle is retained with the abort reason');
}

/* ── F. no findings dir at all => proceeds (nothing to orphan), still deletes expired ── */
{
  const fx = makeFixture(ALL_ENTRIES, []);   // findings dir exists but empty of jsons
  fs.rmSync(path.join(fx.root, 'qa'), { recursive: true, force: true });   // remove the whole findings tree
  const res = runSweep({ bugloopsDir: fx.bugloopsDir, findingsDir: fx.findingsDir, now: NOW });
  A.eq(res.findingsError, false, 'a MISSING findings dir is not a parse error (nothing to orphan)');
  // with NO findings, guardian-F (36d, beyond the newest-5 floor) is no longer evidence-protected and
  // now also expires — proving it was the OPEN finding that saved it in case C.
  A.eq(res.deleted.sort(), ['guardian-20260629-000000', 'guardian-20260630-000000', 'guardian-20260631-000000'], 'with no findings, every expired bundle outside the floor is swept (incl. the formerly-protected F)');
  // standalone manifest lands in .bugloops/_sweep-manifest-*.json
  A.ok(/_sweep-manifest-.*\.json$/.test(res.manifestPath || ''), 'standalone run drops the manifest into .bugloops/_sweep-manifest-<stamp>.json');
  A.ok(present(fx.bugloopsDir, path.basename(res.manifestPath)), 'the standalone manifest is on disk');
}

/* ── G. the standalone manifest file (leading _) is itself never swept ── */
{
  const fx = makeFixture([{ name: '_sweep-manifest-20260101-000000.json', ageDays: 99 }].concat(GUARDIAN.slice(0, 1)), []);
  // _sweep-manifest is a FILE-shaped name but makeFixture made it a dir; either way it must be skipped as meta
  const res = runSweep({ bugloopsDir: fx.bugloopsDir, findingsDir: fx.findingsDir, now: NOW });
  A.ok(!res.deleted.includes('_sweep-manifest-20260101-000000.json'), 'a _-prefixed meta entry is never a deletion candidate even when ancient');
  A.ok(present(fx.bugloopsDir, '_sweep-manifest-20260101-000000.json'), 'meta entry survives the sweep');
}

A.report('qa-evidence-sweep.test');
