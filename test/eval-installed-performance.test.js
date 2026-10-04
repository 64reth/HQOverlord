'use strict';
const A = require('./_assert.js');

(async () => {
  const { performanceStats } = await import('../scripts/eval/installed-performance.mjs');
  const { desktopStartupLogMark, waitInstalledDesktopPort } = await import('../scripts/eval/campaign/drivers.mjs');
  const stats = performanceStats([9, 1, 5, 3, 7]);
  A.eq(stats, { unit: 'ms', samples: 5, min: 1, median: 5, p95: 9, max: 9, values: [1, 3, 5, 7, 9] }, 'installed performance stats are deterministic');
  let refused = false;
  try { performanceStats([]); } catch (_) { refused = true; }
  A.ok(refused, 'an empty performance sample cannot produce a green measurement');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-desktop-port-')), log = path.join(root, 'startup.log');
  try {
    fs.writeFileSync(log, 'startup exe=old port=11111\nspawn_sidecar pid=1 port=11111 listening=true\n');
    const mark = desktopStartupLogMark(log);
    fs.appendFileSync(log, 'startup exe=Ok("StarNet") resource_dir=Ok("root") port=60874\nspawn_sidecar pid=42 port=60874 listening=true\n');
    A.eq(await waitInstalledDesktopPort({ startupLog: log, afterBytes: mark, child: { exitCode: null }, timeoutMs: 1000 }), 60874, 'desktop port discovery uses only the new Tauri launch record');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const performanceSource = fs.readFileSync(path.resolve(__dirname, '../scripts/eval/installed-performance.mjs'), 'utf8');
  const driverSource = fs.readFileSync(path.resolve(__dirname, '../scripts/eval/campaign/drivers.mjs'), 'utf8');
  A.ok(!/STARNET_PORT/.test(performanceSource) && /if \(!desktopExecutable\) env\.STARNET_PORT/.test(driverSource), 'desktop benchmarks never split the WebView from Tauri by overriding only the sidecar port');
  A.ok(/desktopExecutable: executable/.test(performanceSource), 'useful-artifact performance also runs through the installed desktop');
  A.report('eval-installed-performance.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
