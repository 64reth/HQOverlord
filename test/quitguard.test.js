/* node test/quitguard.test.js
   Locks the GB-4 quit half: closing StarNet while agents are live must be an explicit
   choice, never a click side effect. Drives QuitGuard.handleCloseRequested with injected
   deps (no Tauri, no DOM) and proves: allow-when-idle, block-and-ask-when-busy,
   allow-after-confirm, drain-before-every-allow, and fail-open (a broken Channels can
   never make the window unclosable). */
'use strict';
const A = require('./_assert.js');
const Q = require('../frontend/app/quitguard.js');

function fakeEvent() {
  const ev = { prevented: false, preventDefault() { this.prevented = true; } };
  return ev;
}
function fakeDeps(busy, extra) {
  const calls = { drains: 0, shows: [], destroys: 0 };
  const deps = Object.assign({
    channels: { busyCount: () => busy },
    updates: { preInstallDrain: async () => { calls.drains += 1; } },
    doc: {},
    show: (doc, n, onCloseAnyway) => { calls.shows.push(n); deps._onCloseAnyway = onCloseAnyway; },
    destroy: () => { calls.destroys += 1; },
    confirmed: () => false
  }, extra || {});
  return { deps, calls };
}

(async () => {
  // idle → state drained, then the JS default (window destroy) is STILL prevented: the native
  // supervisor owns the outcome (full quit or tray residency). An un-prevented idle close let
  // Tauri's wrapper destroy the window while the supervisor chose residency — the 0.10.x
  // windowless, unrevealable background process.
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(0);
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, true, 'idle close never destroys the window from JS — the supervisor owns teardown');
    A.eq(calls.drains, 1, 'idle close still drains state before the supervisor decides');
    A.eq(calls.shows.length, 0, 'idle close never shows the guard card');
  }

  // busy → close blocked, guard card shown with the live count, nothing destroyed
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(3);
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, true, 'busy close is blocked');
    A.eq(calls.shows.join(','), '3', 'guard card shows the sidecar-confirmed count');
    A.eq(calls.destroys, 0, 'blocking never destroys the window');
    A.eq(calls.drains, 0, 'blocked close does not drain (the app keeps running)');
    // CLOSE ANYWAY → the injected destroy runs
    deps._onCloseAnyway();
    A.eq(calls.destroys, 1, 'CLOSE ANYWAY invokes the real teardown');
  }

  // Native supervisor proves the close only hides to tray → no destructive-close warning, even while busy.
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(2, { keepsRunning: async () => true });
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, true, 'tray-supervised close preserves the hidden main window for tray/relaunch reveal');
    A.eq(calls.drains, 1, 'tray-supervised close flushes state before hiding');
    A.eq(calls.shows.length, 0, 'tray-supervised close never claims it will kill live runs');
  }

  // A failed native status probe does not assume background safety; the existing busy guard remains conservative.
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(2, { keepsRunning: async () => { throw new Error('ipc down'); } });
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, true, 'unknown native close behavior keeps the live-run guard');
    A.eq(calls.shows.join(','), '2', 'unknown native close behavior still names the live run count');
  }

  // already confirmed → close proceeds regardless of busy count, drained first
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(5, { confirmed: () => true });
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, false, 'confirmed close is not re-blocked');
    A.eq(calls.drains, 1, 'confirmed close drains before dying');
    A.eq(calls.shows.length, 0, 'confirmed close shows no second card');
  }

  // update installing → close is the macOS/Linux app.restart(); MUST pass even with agents live,
  // or the files swap but the app never relaunches (stuck update). Windows never hits this
  // (its updater process::exit()s before restart) — but the guard must be right for mac.
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(4, { updates: { isInstalling: () => true, preInstallDrain: async () => { calls.drains += 1; } } });
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, false, 'an update-restart close is never blocked, even with live agents');
    A.eq(calls.shows.length, 0, 'update restart shows no guard card');
    A.eq(calls.drains, 1, 'update restart still drains state first');
  }
  // NOT installing → the guard still blocks live agents normally (proves the flag is the only bypass)
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(4, { updates: { isInstalling: () => false, preInstallDrain: async () => { calls.drains += 1; } } });
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, true, 'a normal close with live agents still blocks when no update is installing');
    A.eq(calls.shows.join(','), '4', 'guard card shown for the normal live-agent close');
  }

  // fail-open: Channels throwing reads as 0 live runs — no guard card wedges the close; the
  // supervisor still owns teardown (prevented, like every non-consent path).
  {
    const ev = fakeEvent();
    const { deps, calls } = fakeDeps(0, { channels: { busyCount: () => { throw new Error('dead'); } } });
    await Q.handleCloseRequested(ev, deps);
    A.eq(ev.prevented, true, 'a broken Channels reads as idle — no card, supervisor owns teardown');
    A.eq(calls.shows.length, 0, 'a broken Channels never blocks the close behind a guard card');
    A.eq(calls.drains, 1, 'fail-open path still drains');
  }

  // liveRunCount: truthful source shape
  {
    A.eq(Q.liveRunCount({ busyCount: () => 2 }), 2, 'liveRunCount reads Channels.busyCount');
    A.eq(Q.liveRunCount(null), 0, 'no Channels (preview) reads as zero');
    A.eq(Q.liveRunCount({}), 0, 'Channels without busyCount reads as zero');
  }

  // install() in a browser-preview world (no __TAURI__) is a clean no-op
  {
    const ok = await Q.install({});
    A.eq(ok, false, 'install without Tauri no-ops');
  }

  A.report('quitguard');
})().catch(e => { console.error(e); process.exit(1); });
