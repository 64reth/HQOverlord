/* node test/qa-closer.test.js — the RED→GREEN CLOSER's pure DECISION logic (lane Q8),
   fed injected io + a controllable clock (zero disk, zero git, zero worktrees, zero gates).

   The Closer is the only crew member that produces a FIX, so its decision logic carries three
   locks and this file exists to prove each one cannot be walked around:

     LOCK 1  writeSetVerdict  — a patch that edits what judges it is DISQUALIFIED before the
                                gate ever runs (mute-the-alarm), with add-vs-modify direction.
     LOCK 2  refereeVerdict   — only a candidate proven on the referee's own clean tree can win.
     LOCK 3  refereeVerdict   — a baseline that is NOT red BLOCKS the whole run: no patch is
                                creditable against a detector that does not detect.

   Pure + deterministic — every ts comes from the injected clock, never Date.now(). Does NOT
   provision worktrees, run git, or execute a gate (that is the IO shell's job). */
'use strict';
const A = require('./_assert.js');
const {
  CREW, CLOSER_GATES, ALWAYS_FORBIDDEN, PROTECTED,
  normalizePath, pathMatches, coerceWriteSet, writeSetVerdict,
  gateForFinding, resolveGateArg, parseNameStatus, patchSize,
  refereeVerdict, closerWhyFailed, makeCloserCore,
} = require('../scripts/qa/closer.mjs');
const { fingerprintOf } = require('../scripts/qa/ledger.mjs');

const clock = { now: () => 7000 };

// ---- A. path matching: the three rule forms, and normalization that fails CLOSED ----
{
  A.eq(normalizePath('scripts\\qa\\Ledger.mjs'), 'scripts/qa/ledger.mjs', 'backslashes normalize to forward slashes, lowercased');
  A.eq(normalizePath('./test/foo.js'), 'test/foo.js', 'a leading ./ is stripped');

  A.ok(pathMatches('test/foo.test.js', 'test/'), 'a trailing-slash rule matches everything under the dir');
  A.ok(pathMatches('test', 'test/'), 'a trailing-slash rule also matches the bare dir itself');
  A.ok(!pathMatches('tests/foo.js', 'test/'), 'a sibling dir with a longer name does NOT match');
  A.ok(pathMatches('qa/KNOWN_ISSUES.md', 'qa/KNOWN_ISSUES.md'), 'an exact rule matches exactly');
  A.ok(!pathMatches('qa/KNOWN_ISSUES.md.bak', 'qa/KNOWN_ISSUES.md'), 'an exact rule does not match a prefix-extended path');
  A.ok(pathMatches('scripts\\qa\\guardian.mjs', 'scripts/qa/'), 'a Windows-style path still matches a posix rule (fail-closed)');
  A.ok(pathMatches('QA/Findings/x.json', 'qa/findings/'), 'matching is case-insensitive (deny lists must over-match, never under-match)');
  A.ok(pathMatches('scripts/lib/png.mjs', 'scripts/**/png.mjs'), 'a ** rule matches across segments');
  A.ok(!pathMatches('', 'test/'), 'an empty path matches nothing');
}

// ---- B. write-set coercion: an unknown status is treated as MODIFY (the stricter reading) ----
{
  A.eq(coerceWriteSet(['a.js'])[0].status, 'M', 'a bare string is treated as a modify, never an add');
  A.eq(coerceWriteSet([{ path: 'a.js', status: 'a' }])[0].status, 'A', 'status is upper-cased');
  A.eq(coerceWriteSet([{ path: 'a.js', status: '' }])[0].status, 'M', 'a blank status falls back to modify');
  A.eq(coerceWriteSet([{ path: '', status: 'A' }]).length, 0, 'an entry with no path is dropped');
  A.eq(coerceWriteSet(null).length, 0, 'a non-array write set coerces to empty');
}

// ---- C. LOCK 1: the mute-the-alarm lint ----
{
  // an honest fix touching product code only
  const ok = writeSetVerdict({ gate: 'test-fast', files: [{ path: 'sidecar/index.js', status: 'M' }] });
  A.eq(ok.ok, true, 'a patch touching only product code passes the lint');
  A.eq(ok.violations.length, 0, 'a clean patch has zero violations');

  // an EMPTY patch can never be credited
  const empty = writeSetVerdict({ gate: 'test-fast', files: [] });
  A.eq(empty.ok, false, 'an empty patch is a violation, not a pass');
  A.eq(empty.violations[0].rule, 'empty-patch', 'the empty patch names its own rule');

  // modifying the failing gate's own test = the classic mute
  const muted = writeSetVerdict({ gate: 'test-fast', files: [{ path: 'test/shell.test.js', status: 'M' }] });
  A.eq(muted.ok, false, 'MODIFYING an existing test disqualifies');
  A.ok(/protected detector/.test(muted.violations[0].why), 'the violation explains it is a protected detector');

  // ADDING a new test is the honest move and must stay legal
  const added = writeSetVerdict({ gate: 'test-fast', files: [{ path: 'sidecar/x.js', status: 'M' }, { path: 'test/new-regression.test.js', status: 'A' }] });
  A.eq(added.ok, true, 'ADDING a new test alongside the fix is allowed (a regression lock is what a good fix ships)');

  // deleting or renaming a test is a mute, exactly like modifying it
  A.eq(writeSetVerdict({ gate: 'test-fast', files: [{ path: 'test/shell.test.js', status: 'D' }] }).ok, false, 'DELETING a test disqualifies');
  A.eq(writeSetVerdict({ gate: 'golden', files: [{ path: 'test/a.test.js', status: 'D' }, { path: 'test/b.test.js', status: 'A' }] }).ok, false,
    'RENAMING a test (delete+add) disqualifies on the delete half');

  // test/ is protected on EVERY gate — the collateral-mute hole. A golden fix may not silence a
  // unit test it broke, because test:fast is the collateral gate on every non-test run.
  A.eq(writeSetVerdict({ gate: 'golden', files: [{ path: 'test/unrelated.test.js', status: 'M' }] }).ok, false,
    'test/ is protected even when closing a GOLDEN finding (collateral gate cannot be muted)');
  A.ok(PROTECTED.indexOf('test/') >= 0, 'test/ is in the universal PROTECTED set, not just a per-gate detector');

  // per-gate detector files
  A.eq(writeSetVerdict({ gate: 'golden', files: [{ path: 'scripts/goldens.json', status: 'M' }] }).ok, false, 're-blessing the golden baseline disqualifies a golden close');
  A.eq(writeSetVerdict({ gate: 'audit', files: [{ path: 'scripts/audit.mjs', status: 'M' }] }).ok, false, 'editing audit.mjs disqualifies an audit close');
  A.eq(writeSetVerdict({ gate: 'shoot', files: [{ path: 'scripts/lib/states.mjs', status: 'M' }] }).ok, false, 'editing the shoot state list disqualifies a shoot close');
  // ...but a detector for a DIFFERENT gate is not automatically protected (only always-forbidden ones are)
  A.eq(writeSetVerdict({ gate: 'audit', files: [{ path: 'scripts/goldens.json', status: 'M' }] }).ok, true,
    'the golden baseline is not a detector for the AUDIT gate, so an audit close may touch it');

  // ALWAYS_FORBIDDEN — every gate, every status, including ADD
  for (const p of ['qa/KNOWN_ISSUES.md', 'qa/findings/x.json', 'qa/STATUS.md', 'test/fast.list', 'package.json', 'scripts/qa/guardian.mjs', '.github/workflows/ci.yml', 'qa/product-perfect/claims.json', 'CLOSER_BRIEF.md']) {
    A.eq(writeSetVerdict({ gate: 'golden', files: [{ path: p, status: 'M' }] }).ok, false, 'always-forbidden path rejected on any gate: ' + p);
    A.eq(writeSetVerdict({ gate: 'audit', files: [{ path: p, status: 'A' }] }).ok, false, 'always-forbidden path rejected even as an ADD: ' + p);
  }
  A.ok(ALWAYS_FORBIDDEN.indexOf('scripts/qa/') >= 0, 'the detector fleet itself (scripts/qa/) is always forbidden — the Closer cannot be patched by its own candidates');

  // one patch, several violations -> all reported (a reviewer sees the whole picture)
  const multi = writeSetVerdict({ gate: 'test-fast', files: [{ path: 'qa/KNOWN_ISSUES.md', status: 'M' }, { path: 'test/x.test.js', status: 'M' }] });
  A.eq(multi.violations.length, 2, 'every violating file is reported, not just the first');
}

// ---- D. gate inference from the Guardian's stable finding titles ----
{
  const T = (title) => gateForFinding({ title });
  A.eq(T('Visual regression: frame `ingame` changed beyond animation noise').gate, 'golden', 'a visual regression maps to the golden gate');
  A.eq(T('Golden gate failed to produce a review report').gate, 'golden', 'a golden step-level failure maps to golden');
  A.eq(T('Truth regression: audit assertion `task/run-lifecycle` failed (task)').gate, 'audit', 'a truth regression maps to the audit gate');
  A.eq(T('Behavioral audit failed (no parseable assertion report)').gate, 'audit', 'an unparseable audit red maps to audit');
  A.eq(T('Journey parity regression: `J2/estop/settles-idle` failed (J2a)').gate, 'journeys', 'a journey regression maps to the journeys gate');
  A.eq(T('Journey run failed (no parseable journey report)').gate, 'journeys', 'an unparseable journeys red maps to journeys');
  A.eq(T('UI state `crew-roster` failed to open').gate, 'shoot', 'a failed UI state maps to the shoot gate');
  A.eq(T('Screenshot sweep failed (app did not reach the floor)').gate, 'shoot', 'a boot failure maps to shoot');
  A.eq(T('Gate red: `test:fast` failed (exit 1)').gate, 'test-fast', 'a step-level gate red names its npm script');
  A.eq(T('Gate red: `test:http` failed (exit 1)').gate, 'http-e2e', 'the http gate is inferred from its npm script');

  // a BLOCKED finding is an ENVIRONMENT failure — refused, never aimed at repair agents
  const blocked = T('Guardian BLOCKED: Full fast unit/contract gate could not run');
  A.eq(blocked.ok, false, 'a BLOCKED finding is refused');
  A.eq(blocked.reason, 'blocked-finding', 'the refusal names the blocked-finding reason');
  A.ok(/environment/.test(blocked.hint), 'the hint explains it is a machine problem, not a patchable defect');

  // refusal beats guessing
  A.eq(T('something nobody has ever seen before').ok, false, 'an unrecognised title is REFUSED, never guessed');
  A.eq(T('').ok, false, 'a finding with no title is refused');
  A.eq(T('Gate red: `npm:does-not-exist` failed (exit 1)').reason, 'unknown-npm-script', 'an unknown npm script is refused by name');
  A.eq(gateForFinding(null).ok, false, 'a null finding is refused');
}

// ---- E. --gate accepts either a step id or the npm script name ----
{
  A.eq(resolveGateArg('test-fast'), 'test-fast', 'a step id resolves to itself');
  A.eq(resolveGateArg('test:fast'), 'test-fast', 'an npm script name resolves to its step id');
  A.eq(resolveGateArg('qa:journeys'), 'journeys', 'the journeys npm script resolves');
  A.eq(resolveGateArg('nonsense'), '', 'an unknown gate resolves to empty (the caller then blocks)');
  A.eq(resolveGateArg(''), '', 'an empty gate arg resolves to empty');
}

// ---- F. name-status parsing, including the rename fail-closed rule ----
{
  const parsed = parseNameStatus('M\tsidecar/index.js\nA\ttest/new.test.js\nD\tscripts/old.mjs\n');
  A.eq(parsed.length, 3, 'three status lines -> three entries');
  A.eq(parsed[0].status, 'M', 'a modify is parsed');
  A.eq(parsed[1].status, 'A', 'an add is parsed');
  A.eq(parsed[2].status, 'D', 'a delete is parsed');

  const renamed = parseNameStatus('R100\ttest/old.test.js\ttest/new.test.js');
  A.eq(renamed.length, 2, 'a rename becomes TWO entries (delete of old + add of new)');
  A.eq(renamed[0].status, 'D', 'the old path is recorded as a DELETE so renaming a test away still trips the lint');
  A.eq(renamed[1].status, 'A', 'the new path is recorded as an add');
  A.eq(writeSetVerdict({ gate: 'test-fast', files: renamed }).ok, false, 'renaming a protected test is caught end-to-end');

  A.eq(parseNameStatus('').length, 0, 'empty name-status output -> []');
  A.eq(parseNameStatus('garbage-with-no-tab').length, 0, 'a line with no tab is dropped');
  A.eq(parseNameStatus(null).length, 0, 'null input -> []');
}

// ---- G. patch size (ranking only — never correctness) ----
{
  const diff = [
    'diff --git a/x.js b/x.js', 'index 111..222 100644', '--- a/x.js', '+++ b/x.js',
    '@@ -1,3 +1,3 @@', ' unchanged', '-old line', '+new line',
  ].join('\n');
  const size = patchSize(diff);
  A.eq(size.files, 1, 'one diff --git header -> one file');
  A.eq(size.lines, 2, 'one - and one + -> two changed lines (--- / +++ headers excluded)');
  A.eq(patchSize('').files, 0, 'an empty diff has no files');
  A.eq(patchSize(null).lines, 0, 'a null diff has no lines');
}

// ---- H. LOCK 3: a baseline that is not RED blocks the whole run ----
{
  const winner = { id: 'cand-1', applied: true, gateGreen: true, collateralGreen: true, size: { files: 1, lines: 2 } };

  const green = refereeVerdict({ baseline: { ran: true, red: false }, candidates: [winner] });
  A.eq(green.verdict, 'blocked', 'a GREEN baseline blocks the run even when a candidate "passed"');
  A.eq(green.reason, 'baseline-not-red', 'the block names the baseline-not-red reason');
  A.eq(green.winner, null, 'no winner is crowned against a detector that does not detect');
  A.ok(/stale|flaky|wrong/.test(green.detail), 'the detail explains the three ways a baseline goes green');

  const cantRun = refereeVerdict({ baseline: { ran: false, detail: 'npm missing' }, candidates: [winner] });
  A.eq(cantRun.verdict, 'blocked', 'a baseline that could not RUN blocks the run (no-fake-green)');
  A.eq(cantRun.reason, 'baseline-gate-could-not-run', 'the block names the unrunnable baseline');

  A.eq(refereeVerdict({ baseline: {}, candidates: [winner] }).verdict, 'blocked', 'a missing baseline record blocks');
  A.eq(refereeVerdict({}).verdict, 'blocked', 'an empty input blocks rather than crowning anything');
}

// ---- I. LOCK 2: only a candidate proven on the referee's clean tree can win ----
{
  const base = { ran: true, red: true };
  const mk = (over) => Object.assign({ id: 'c', applied: true, gateGreen: true, collateralGreen: true, size: { files: 1, lines: 5 } }, over);

  A.eq(refereeVerdict({ baseline: base, candidates: [mk({ id: 'c1' })] }).verdict, 'winner', 'a candidate that applied + went green wins');

  A.eq(refereeVerdict({ baseline: base, candidates: [mk({ id: 'c1', disqualified: true, violations: [{ file: 'test/x.js' }] })] }).verdict, 'no-winner',
    'a DISQUALIFIED candidate cannot win even with gateGreen:true (the lint outranks the gate)');
  A.eq(refereeVerdict({ baseline: base, candidates: [mk({ id: 'c1', applied: false })] }).verdict, 'no-winner', 'a patch that did not apply cannot win');
  A.eq(refereeVerdict({ baseline: base, candidates: [mk({ id: 'c1', gateGreen: false })] }).verdict, 'no-winner', 'a patch that left the gate red cannot win');
  A.eq(refereeVerdict({ baseline: base, candidates: [mk({ id: 'c1', collateralGreen: false })] }).verdict, 'no-winner', 'a patch that broke test:fast cannot win (collateral damage)');
  A.eq(refereeVerdict({ baseline: base, candidates: [] }).verdict, 'no-winner', 'zero candidates -> no winner, never a default pass');

  // smallest honest fix wins; ties break deterministically
  const ranked = refereeVerdict({ baseline: base, candidates: [
    mk({ id: 'cand-3', size: { files: 4, lines: 90 } }),
    mk({ id: 'cand-1', size: { files: 1, lines: 4 } }),
    mk({ id: 'cand-2', size: { files: 3, lines: 4 } }),
  ] });
  A.eq(ranked.verdict, 'winner', 'three passing candidates produce a winner');
  A.eq(ranked.winner.id, 'cand-1', 'fewest changed lines wins, then fewest files');
  A.eq(ranked.runnersUp.length, 2, 'the other passing candidates are runners-up, not discarded');
  A.eq(ranked.runnersUp[0].id, 'cand-2', 'runners-up keep the same deterministic order');

  // a disqualified candidate does not suppress an honest one
  const mixed = refereeVerdict({ baseline: base, candidates: [
    mk({ id: 'cand-1', disqualified: true, violations: [{ file: 'qa/KNOWN_ISSUES.md' }], size: { files: 1, lines: 1 } }),
    mk({ id: 'cand-2', size: { files: 2, lines: 9 } }),
  ] });
  A.eq(mixed.winner.id, 'cand-2', 'the honest larger patch beats the disqualified smaller one');

  // every judged candidate is reported, winners and losers alike
  A.eq(mixed.ranked.length, 2, 'ranked carries every judged candidate');
  A.eq(mixed.ranked.filter(c => c.passed).length, 1, 'exactly one candidate is marked passed');
}

// ---- J. closerWhyFailed explains each losing shape in one line ----
{
  A.ok(/DISQUALIFIED/.test(closerWhyFailed({ disqualified: true, violations: [{ file: 'test/x.js' }] })), 'a disqualification is named loudly');
  A.ok(/did not apply/.test(closerWhyFailed({ applied: false })), 'an unapplyable patch is named');
  A.ok(/stayed red/.test(closerWhyFailed({ applied: true, gateGreen: false })), 'a still-red gate is named');
  A.ok(/collateral/.test(closerWhyFailed({ applied: true, gateGreen: true, collateralGreen: false })), 'collateral damage is named');
  A.eq(closerWhyFailed(null), 'not judged', 'an unjudged candidate says so rather than implying a pass');
}

// ---- K. the Closer's own findings: BLOCKED only, P0, injected clock, agreeing fingerprint ----
{
  const core = makeCloserCore({ io: { evidencePath: (p) => '/cycle/' + p }, clock });
  const f = core.blockedFinding({
    reason: 'baseline-not-red', runId: 'closer-abc-1', gate: 'test:fast', base: 'deadbeef1234',
    targetFingerprint: 'aabbccdd', title: 'gate is GREEN at base', detail: 'does not reproduce', evidence: ['baseline.log'],
  });
  A.eq(f.severity, 'P0', 'a Closer that cannot judge files a P0 (no-fake-green)');
  A.eq(f.crew, CREW, 'the finding carries the Red-Green Closer crew');
  A.eq(f.ts, 7000, 'ts comes from the injected clock, never Date.now()');
  A.ok(/^Closer BLOCKED:/.test(f.title), 'the title is loud');
  A.eq(f.evidence[0], '/cycle/baseline.log', 'evidence is routed through the injected evidencePath');
  A.ok(f.evidence.length > 0, 'the Evidence Law holds — a finding always carries an artifact');
  A.eq(f.fingerprint, fingerprintOf({ crew: CREW, checkId: 'closer', subject: 'baseline-not-red/aabbccdd' }),
    'the Closer fingerprint delegates to the ledger fingerprintOf (one dedup key, never re-implemented)');
  // the same block on the same target dedups; a different target does not
  const same = core.blockedFinding({ reason: 'baseline-not-red', targetFingerprint: 'aabbccdd' });
  const other = core.blockedFinding({ reason: 'baseline-not-red', targetFingerprint: '99887766' });
  A.eq(f.fingerprint, same.fingerprint, 'the same block on the same finding dedups (anti-nag)');
  A.ok(f.fingerprint !== other.fingerprint, 'a block on a different finding is a different fingerprint');
}

// ---- L. the repair brief is the whole contract, including the refusal path ----
{
  const core = makeCloserCore({ clock });
  const finding = { title: 'Truth regression: audit assertion `x` failed (task)', severity: 'P1', crew: 'Green Guardian', fingerprint: 'abc12345', detail: 'the UI lied', evidence: ['.bugloops/g/audit.log'] };
  const md = core.brief({ finding, gate: 'audit', base: 'deadbeef1234', candidateId: 'cand-2', totalCandidates: 3 });

  A.ok(/cand-2/.test(md), 'the brief names the candidate');
  A.ok(/3 independent repair agents/.test(md), 'the brief states how many candidates compete');
  A.ok(/Truth regression/.test(md), 'the defect title is in the brief');
  A.ok(/\.bugloops\/g\/audit\.log/.test(md), 'the evidence path is in the brief (reproduce before reading code)');
  A.ok(/npm run audit/.test(md), 'the acceptance command is stated exactly');
  A.ok(/npm run test:fast/.test(md), 'the collateral gate is stated for a non-test gate');
  A.ok(/deadbeef/.test(md), 'the base sha is stated');
  A.ok(/referee is a script, not a model/.test(md), 'the brief tells the agent it cannot grade itself');
  A.ok(/scripts\/audit\.mjs/.test(md), "the gate's own detector is listed as untouchable");
  A.ok(/qa\/KNOWN_ISSUES\.md/.test(md), 'the always-forbidden list is in the brief');
  A.ok(/test\//.test(md), 'the protected test dir is in the brief');
  A.ok(/CLOSER_VERDICT\.md/.test(md), 'the refusal path (detector is wrong -> write it down, change nothing) is offered');
  A.ok(/never modify or delete/i.test(md), 'the add-vs-modify direction is spelled out');

  // test:fast as the gate does NOT get a redundant collateral line
  const fastBrief = core.brief({ finding: { title: 'Gate red: `test:fast` failed (exit 1)' }, gate: 'test-fast', base: 'abc', candidateId: 'cand-1', totalCandidates: 1 });
  A.ok(/npm run test:fast/.test(fastBrief), 'the test-fast brief names its gate');
  A.ok(!/no collateral damage/.test(fastBrief), 'test:fast as the gate does not also list itself as collateral');
}

// ---- M. the verdict report tells the truth about losers, and never claims a merge ----
{
  const core = makeCloserCore({ clock });
  const verdict = refereeVerdict({ baseline: { ran: true, red: true }, candidates: [
    { id: 'cand-1', disqualified: true, violations: [{ file: 'qa/KNOWN_ISSUES.md', why: 'always-forbidden' }], size: { files: 1, lines: 1 } },
    { id: 'cand-2', applied: true, gateGreen: true, collateralGreen: true, size: { files: 1, lines: 3 }, patchFile: '/runs/cand-2.patch' },
    { id: 'cand-3', applied: true, gateGreen: false, size: { files: 9, lines: 200 } },
  ] });
  const md = core.verdictMarkdown({ runId: 'closer-abc-1', finding: { title: 'a defect', fingerprint: 'abc12345' }, gate: 'audit', base: 'deadbeef', verdict });

  A.ok(/WINNER/.test(md), 'the verdict headline states the outcome');
  A.ok(/cand-2/.test(md), 'the winner is named');
  A.ok(/cand-1/.test(md) && /cand-3/.test(md), 'every losing candidate is still reported (no quiet drops)');
  A.ok(/DISQUALIFIED/.test(md), 'the disqualified candidate is called out with its violation');
  A.ok(/KNOWN_ISSUES/.test(md), 'the violating file is named in the report');
  A.ok(/not merged/i.test(md), 'the report states the patch is NOT merged — the Closer never merges');

  const blockedMd = core.verdictMarkdown({ runId: 'r', finding: {}, gate: 'audit', base: 'x', verdict: refereeVerdict({ baseline: { ran: true, red: false }, candidates: [] }) });
  A.ok(/BLOCKED/.test(blockedMd), 'a blocked run renders BLOCKED');
  A.ok(/baseline-not-red/.test(blockedMd), 'the blocked report names the reason');
  A.ok(!/WINNER/.test(blockedMd), 'a blocked run never renders a winner section');
}

// ---- N. the gate registry is internally consistent (every gate is closable + has a port plan) ----
{
  for (const id of Object.keys(CLOSER_GATES)) {
    const g = CLOSER_GATES[id];
    A.ok(!!g.npm, 'gate ' + id + ' names an npm script');
    A.ok(Array.isArray(g.detectors), 'gate ' + id + ' declares a detector list');
    A.eq(resolveGateArg(g.npm), id, 'gate ' + id + ' round-trips through resolveGateArg');
  }
  A.ok(!!CLOSER_GATES['test-fast'], 'test-fast is a closable gate (the most common red)');
}

A.report('qa-closer.test');
