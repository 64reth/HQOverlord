'use strict';
const A = require('./_assert.js');

(async () => {
  const R = await import('../scripts/qa/overnight-reliability.mjs');

  const args = R.parseArgs(['--duration-hours', '8', '--resume', '--output', 'report.json']);
  A.eq(args['duration-hours'], '8', 'pair arguments are parsed');
  A.eq(args.resume, '1', 'boolean arguments are parsed');
  A.eq(args.output, 'report.json', 'later pair arguments are parsed');

  const coverage = new Set(R.PROBES.map(row => row.id));
  for (const id of ['completion-authority', 'interrupted-run-recovery', 'execution-context-continuity', 'failure-route-exhaustion', 'oauth-refresh', 'rate-limit-failover', 'scheduled-continuation', 'restart-persistence', 'duplicate-delivery', 'partial-platform-outage']) {
    A.ok(coverage.has(id), 'campaign declares ' + id + ' coverage');
  }
  A.ok(R.PROBES.every(row => row.files.length > 0 && row.files.every(file => /^test\/.+\.test\.js$/.test(file))), 'every probe runs explicit test files');

  const end = Date.now() - 1;
  const green = {
    once: false, plannedEndAt: new Date(end).toISOString(), requiredCycles: 2,
    cycles: [
      { endedAt: new Date(end).toISOString(), probes: [{ runs: [{ file: 'test/a.test.js', ok: true, cycle: 1 }] }] },
      { endedAt: new Date(end).toISOString(), probes: [{ runs: [{ file: 'test/a.test.js', ok: true, cycle: 2 }] }] }
    ]
  };
  const greenSummary = R.summarize(green, end + 1);
  A.ok(greenSummary.completed && greenSummary.pass, 'completed coverage with no failures passes');
  A.eq(greenSummary.probeRuns, 2, 'probe executions are counted');

  const red = JSON.parse(JSON.stringify(green));
  red.cycles[1].probes[0].runs[0].ok = false;
  red.cycles[1].probes[0].runs[0].timedOut = true;
  const redSummary = R.summarize(red, end + 1);
  A.eq(redSummary.pass, false, 'one failed probe fails the soak');
  A.eq(redSummary.failures, 1, 'failed probes are counted');
  A.eq(redSummary.failed[0].cycle, 2, 'failure evidence keeps the cycle');

  const short = JSON.parse(JSON.stringify(green));
  short.requiredCycles = 3;
  A.eq(R.summarize(short, end + 1).pass, false, 'insufficient cycle coverage cannot pass');

  const once = { once: true, plannedEndAt: new Date(end + 999999).toISOString(), requiredCycles: 1, cycles: [{ endedAt: new Date(end).toISOString(), probes: [{ runs: [{ file: 'test/a.test.js', ok: true, cycle: 1 }] }] }] };
  A.ok(R.summarize(once, end).pass, 'a one-cycle smoke can finish without waiting for a wall-clock deadline');

  const coverageBound = {
    once: true,
    plannedEndAt: new Date(end).toISOString(),
    requiredCycles: 1,
    coverage: [{ id: 'recovery', files: ['test/a.test.js', 'test/b.test.js'] }],
    cycles: [{ number: 1, endedAt: new Date(end).toISOString(), probes: [{ id: 'recovery', runs: [{ file: 'test/a.test.js', ok: true, cycle: 1 }] }] }]
  };
  const incomplete = R.summarize(coverageBound, end + 1);
  A.eq(incomplete.pass, false, 'a missing planned probe cannot produce a false-green campaign');
  A.eq(incomplete.coverageViolations, 1, 'missing probe execution is explicit evidence');
  coverageBound.cycles[0].probes[0].runs.push({ file: 'test/b.test.js', ok: true, cycle: 1 });
  const coverageGreen = R.summarize(coverageBound, end + 1);
  A.ok(coverageGreen.pass, 'complete planned coverage can pass');
  A.eq(coverageGreen.expectedProbeRuns, 2, 'expected executions are counted independently');

  delete coverageBound.cycles[0].endedAt;
  const interrupted = R.summarize(coverageBound, end + 1);
  A.eq(interrupted.pass, false, 'an interrupted cycle cannot count as completed');
  A.eq(interrupted.cycles, 0, 'only finalized cycles satisfy the campaign requirement');
  A.eq(interrupted.attemptedCycles, 1, 'an interrupted attempt remains visible for recovery');

  A.report('overnight-reliability-runner.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
