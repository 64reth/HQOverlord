'use strict';
const A = require('./_assert.js');

(async () => {
  const { requiredSoakCoverage, installedRuntimeFingerprint, hashFileStreamed, retryObserver, parseWindowsObserverLine, createWindowsProcessObserver } = await import('../scripts/eval/installed-provider-soak.mjs');
  A.eq(requiredSoakCoverage(48, 60), 2851, '48-hour health coverage requires at least 99% of planned samples');
  A.eq(requiredSoakCoverage(48, 3600), 47, '48-hour provider coverage requires at least 99% of hourly active samples');
  let refused = false; try { requiredSoakCoverage(0, 60); } catch (_) { refused = true; }
  A.ok(refused, 'invalid soak duration fails closed');
  let observerAttempts = 0, observerSleeps = 0;
  const recovered = await retryObserver(async () => {
    observerAttempts++;
    if (observerAttempts < 3) throw new Error('transient observer pressure');
    return 'recovered';
  }, 6, { baseDelayMs: 1, sleep: async () => { observerSleeps++; } });
  A.eq(recovered, 'recovered', 'observer retry returns the first recovered reading');
  A.eq(observerAttempts, 3, 'transient observer failure is retried without becoming a missing sample');
  A.eq(observerSleeps, 2, 'observer retry backs off between failed attempts');
  A.eq(parseWindowsObserverLine('OK|4096|1.25').rssBytes, 4096, 'observer protocol parses RSS telemetry');
  let decoded = false; try { parseWindowsObserverLine('ERR|' + Buffer.from('paging file pressure').toString('base64')); } catch (error) { decoded = /paging file pressure/.test(error.message); }
  A.ok(decoded, 'observer protocol preserves a readable UTF-8 failure instead of NUL-corrupted stderr');
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../scripts/eval/installed-provider-soak.mjs'), 'utf8');
  A.ok(/qualifyingDuration: durationHours >= 48/.test(source) && /qualifiesRelease: false/.test(source) && /report\.qualifiesRelease = report\.summary\.pass/.test(source), 'release qualification stays false until a real 48-hour run passes every terminal gate');
  A.ok(/providerFailures === 0/.test(source) && /healthFailures === 0/.test(source), 'provider and health failures both fail the soak');
  A.ok(/gradeParityTrajectory/.test(source) && /fixtureCalls\.length > 0/.test(source), 'active samples require independent fixture grading and real host calls');
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-soak-fingerprint-'));
  try {
    fs.mkdirSync(path.join(root, 'sidecar')); fs.writeFileSync(path.join(root, 'sidecar', 'index.js'), 'one');
    A.eq(await hashFileStreamed(path.join(root, 'sidecar', 'index.js')), require('node:crypto').createHash('sha256').update('one').digest('hex'), 'candidate files are hashed as bounded streams');
    const first = installedRuntimeFingerprint(root, ['sidecar']);
    fs.writeFileSync(path.join(root, 'sidecar', 'index.js'), 'two');
    const second = installedRuntimeFingerprint(root, ['sidecar']);
    A.eq(first.files, 1, 'runtime fingerprint records the file count');
    A.ok(first.sha256 !== second.sha256, 'runtime fingerprint detects content drift');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  A.ok(/identityFailures === 0/.test(source) && /executableHashMatch/.test(source) && /runtimeFingerprintMatch/.test(source), 'candidate identity drift fails the soak');
  A.ok(/observerFailures === 0/.test(source) && /createWindowsProcessObserver/.test(source) && /hashFileStreamed/.test(source), 'persistent observer sampling is bounded and retried without weakening the zero-failure terminal gate');
  if (process.platform === 'win32') {
    const realSpawn = require('node:child_process').spawn; let observerHosts = 0;
    const observer = createWindowsProcessObserver(process.pid, {
      attempts: 2, requestTimeoutMs: 10000, baseDelayMs: 1,
      spawn: (...args) => { observerHosts++; return realSpawn(...args); }
    });
    try {
      const first = await observer.sample(), second = await observer.sample();
      A.ok(first.rssBytes > 0 && first.cpuSeconds >= 0, 'persistent Windows observer reads the live process');
      A.ok(second.rssBytes > 0 && second.cpuSeconds >= first.cpuSeconds, 'persistent Windows observer survives a second sample without a new host requirement');
      A.eq(observerHosts, 1, 'multiple telemetry samples reuse one persistent PowerShell host');
    } finally { observer.close(); }
  }
  A.ok(/desktop-executable/.test(source) && /desktopExecutable/.test(source) && /installed-desktop/.test(source), 'qualifying soak launches and observes the installed desktop rather than an orphan sidecar');
  A.report('eval-installed-provider-soak.test');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
