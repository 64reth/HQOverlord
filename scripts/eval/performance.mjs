import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, readJsonl } from './core.mjs';
import { runBridgeAdapters } from './adapters/bridge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function round(value) { return Math.round(Number(value) * 1000) / 1000; }
function stats(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  const at = p => ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * p) - 1))];
  return {
    unit: 'ms', samples: ordered.length, min: round(ordered[0]), median: round(at(0.5)),
    p95: round(at(0.95)), max: round(ordered[ordered.length - 1]), values: ordered.map(round)
  };
}

export async function collectPerformanceBaseline(opts = {}) {
  const samples = Math.max(5, Math.min(100, Math.floor(Number(opts.samples) || 15)));
  const fixtures = join(HERE, 'fixtures');
  const tasks = readJsonl(join(fixtures, 'tasks.jsonl'));
  const candidate = readJsonl(join(fixtures, 'candidate.jsonl'));
  const baseline = readJsonl(join(fixtures, 'baseline.jsonl'));
  const bridgeTimes = [];
  const evaluationTimes = [];
  const startupTimes = [];
  const rssStart = process.memoryUsage().rss;

  // One unreported warm-up keeps module initialization out of the steady-state source-harness baseline.
  await runBridgeAdapters();
  evaluate({ tasks, candidateRows: candidate, baselineRows: baseline });

  for (let index = 0; index < samples; index++) {
    let started = performance.now();
    const rows = await runBridgeAdapters();
    bridgeTimes.push(performance.now() - started);
    if (rows.length !== 6) throw new Error(`bridge adapter pack returned ${rows.length} rows, expected 6`);

    started = performance.now();
    // A hundred folds makes this small dependency-free evaluator measurable above Windows timer noise.
    for (let repeat = 0; repeat < 100; repeat++) {
      const report = evaluate({ tasks, candidateRows: candidate, baselineRows: baseline });
      if (!report.summary.pass) throw new Error('seed evaluation failed while collecting the baseline');
    }
    evaluationTimes.push((performance.now() - started) / 100);

    started = performance.now();
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write("ready")'], { encoding: 'utf8', windowsHide: true });
    startupTimes.push(performance.now() - started);
    if (child.status !== 0 || child.stdout !== 'ready') throw new Error('Node startup probe failed');
  }

  const rssEnd = process.memoryUsage().rss;
  return {
    schemaVersion: 'starnet.eval.performance-baseline.v1',
    pass: true,
    scope: 'dependency-free source harness',
    samples,
    measurements: {
      bridgeAdapterPackMs: stats(bridgeTimes),
      evaluationPackMs: stats(evaluationTimes),
      nodeStartupMs: stats(startupTimes),
      processRssBytes: { unit: 'bytes', start: rssStart, end: rssEnd, delta: rssEnd - rssStart }
    },
    regressionGate: { medianIncreasePct: 10 },
    pendingInstalledMeasurements: [
      'cold boot to interactive station', 'send to first visible token', 'send to first tool activity',
      'send to verified useful artifact', 'final token to durable visible delivery',
      'session switching at 100/1000/10000 turns', '48-hour idle and active CPU/memory'
    ]
  };
}
