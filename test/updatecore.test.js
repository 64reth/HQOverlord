/* node test/updatecore.test.js
   Locks the autonomous desktop update goal/loop planner: due checks, no busy
   overlap, retry backoff, notification de-dupe, remind-later, skip-version, and
   progress math. */
'use strict';
const A = require('./_assert.js');
const U = require('../frontend/app/updatecore.js');
const fs = require('fs');
const path = require('path');

const HOUR = 60 * 60 * 1000;
const now = 1_000_000;

// ---- hydrate: safe defaults, malformed input tolerated ----
{
  const s = U.hydrateSettings(null);
  A.eq(s.autoCheck, true, 'auto-check defaults on');
  A.eq(s.nextCheckAt, 0, 'fresh loop is due immediately');
  const bad = U.hydrateSettings({ autoCheck: false, lastCheckAt: -1, failureCount: -8, ignoredVersion: 9 });
  A.eq(bad.autoCheck, false, 'explicit auto-check off is preserved');
  A.eq(bad.lastCheckAt, 0, 'negative timestamps clamp to zero');
  A.eq(bad.failureCount, 0, 'negative failure counts clamp to zero');
  A.eq(bad.ignoredVersion, '', 'non-string ignored version is dropped');
}

// ---- nextAction: desktop/due/busy gates ----
{
  A.eq(U.nextAction({ settings: {}, runtime: { desktop: false }, now }).reason, 'not-desktop', 'browser preview does not check');
  A.eq(U.nextAction({ settings: { autoCheck: false }, runtime: { desktop: true }, now }).reason, 'auto-disabled', 'disabled auto-check stays quiet');
  A.eq(U.nextAction({ settings: {}, runtime: { desktop: true, phase: 'checking' }, now }).reason, 'busy', 'checking never overlaps');
  A.eq(U.nextAction({ settings: { nextCheckAt: now + HOUR }, runtime: { desktop: true, phase: 'idle' }, now }).reason, 'waiting-interval', 'future check waits');
  A.eq(U.nextAction({ settings: { nextCheckAt: now }, runtime: { desktop: true, phase: 'idle' }, now }).action, 'check', 'due desktop loop checks');
}

// ---- successful checks schedule the next steady-state check ----
{
  const s = U.recordCheckResult({}, { checkedAt: now, update: null }, now);
  A.eq(s.lastCheckAt, now, 'success records last check');
  A.eq(s.nextCheckAt, now + U.CHECK_INTERVAL_MS, 'success schedules the steady check interval');
  A.eq(s.failureCount, 0, 'success clears failures');
}

// ---- errors back off exponentially but cap ----
{
  let s = U.recordCheckError({}, now);
  A.eq(s.nextCheckAt, now + U.RETRY_BASE_MS, 'first failure retries at base delay');
  s = U.recordCheckError(s, now);
  A.eq(s.nextCheckAt, now + U.RETRY_BASE_MS * 2, 'second failure doubles delay');
  for (let i = 0; i < 20; i++) s = U.recordCheckError(s, now);
  A.eq(s.nextCheckAt, now + U.RETRY_MAX_MS, 'retry delay caps');
}

// ---- notification loop: once per version, critical bypasses skips/reminders ----
{
  let s = U.hydrateSettings(null);
  A.ok(U.shouldNotify(s, '0.2.0', now), 'new version notifies');
  s = U.recordNotified(s, '0.2.0');
  A.ok(!U.shouldNotify(s, '0.2.0', now), 'same version does not notify twice');
  A.ok(U.shouldNotify(s, '0.2.1', now), 'a newer version notifies');
  s = U.ignoreVersion(s, '0.2.1');
  A.ok(!U.shouldNotify(s, '0.2.1', now), 'ignored version stays quiet');
  A.ok(U.shouldNotify(s, '0.2.1', now, true), 'critical update bypasses a skip');
}

// ---- remind-later suppresses until its deadline, then permits a fresh nudge ----
{
  let s = U.remindLater({}, '0.3.0', now, HOUR);
  A.ok(!U.shouldNotify(s, '0.3.0', now + HOUR - 1), 'remind-later suppresses before deadline');
  A.ok(U.shouldNotify(s, '0.3.0', now + HOUR + 1), 'same version can remind again after the deadline');
  A.ok(U.shouldNotify(s, '0.3.1', now + HOUR + 1), 'new version still notifies after reminder');
}

// ---- progress: unknown length and clamps ----
{
  A.eq(U.progress(50, 0), 0, 'unknown content length reports 0 percent');
  A.eq(U.progress(50, 200), 25, 'progress computes percent');
  A.eq(U.progress(250, 200), 100, 'progress clamps at 100');
}

// ---- GB-4 install guard: never kill live runs as a click side effect ----
{
  A.eq(U.installBlockReason(0, false), null, 'no live runs installs freely');
  A.ok(/1 agent is still working/.test(U.installBlockReason(1, false)), 'one live run blocks with the singular reason');
  A.ok(/3 agents are still working/.test(U.installBlockReason(3, false)), 'many live runs block with the count');
  A.eq(U.installBlockReason(3, true), null, 'force (the explicit INSTALL ANYWAY click) bypasses the guard');
  A.eq(U.installBlockReason(-2, false), null, 'negative/garbage count never blocks');
  A.ok(/2 agents/.test(U.installBlockReason('2', false) || ''), 'numeric-string count still guards');
}

// ---- public privacy claims follow the real first-run default and plaintext OAuth inventory ----
{
  const ROOT = path.resolve(__dirname, '..');
  const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const docs = [
    ['PRIVACY.md', read('PRIVACY.md')],
    ['website privacy', read('website/legal/privacy.html')],
    ['website no-credits privacy', read('website/legal/_privacy.nocredits.html')]
  ];
  const sidecar = read('sidecar/index.js');

  A.ok(/const OAUTH_PROVIDER_IDS = \['grok', 'kimi'\]/.test(sidecar), 'runtime owns Grok and Kimi OAuth stores');
  A.ok(/path\.join\(WORKSPACES, id, 'tokens\.json'\)/.test(sidecar), 'runtime persists each device-OAuth token under its provider directory');

  for (const [label, doc] of docs) {
    A.ok(/The app does not track you/i.test(doc), label + ' preserves the accurate no-tracking claim');
    A.ok(/Automatic update checks are on by default/i.test(doc), label + ' discloses the default');
    A.ok(/On first run and at the configured interval/i.test(doc), label + ' discloses first-run timing');
    A.ok(/AUTO-CHECK FOR UPDATES/i.test(doc), label + ' names the opt-out control');
    A.ok(/SYSTEM (?:>|&gt;) SETTINGS (?:>|&gt;) UPDATES/i.test(doc), label + ' names the opt-out location');
    A.ok(!/no ["&quot;]*phone home["&quot;]* of any kind/i.test(doc), label + ' omits the retired absolute phone-home claim');
    A.ok(!/talks to the network[^\n<]*only[^\n<]*work you asked for/i.test(doc), label + ' does not hide the automatic update request');
    for (const provider of ['codex', 'grok', 'kimi']) {
      const row = new RegExp(provider + '\\/tokens\\.json[\\s\\S]{0,120}Plaintext', 'i');
      A.ok(row.test(doc), label + ' identifies ' + provider + '/tokens.json as plaintext');
    }
    A.ok(/\.secrets\/spotify\.json[\s\S]{0,120}Plaintext/i.test(doc), label + ' retains the Spotify plaintext disclosure');
    A.ok(!/Two secret types are/i.test(doc), label + ' omits the incomplete secret count');
  }
}

A.report('updatecore');
