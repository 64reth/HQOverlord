/* node test/titlebar.test.js
   Locks the custom Windows window chrome (frontend/app/titlebar.js): it renders
   ONLY when the desktop shell opts in via __STARNET_CUSTOM_CHROME__, its buttons
   drive the real Tauri window handle, and the maximize/fullscreen state maps to
   the honest chrome classes (is-max glyph, sn-fs bar hide). */
'use strict';
const A = require('./_assert.js');
const Titlebar = require('../frontend/app/titlebar.js');

function fakeClassList() {
  const set = new Set();
  return {
    set,
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, on) { on ? set.add(c) : set.delete(c); return on; },
    contains(c) { return set.has(c); }
  };
}

(async () => {
  // --- opt-in gate: inert everywhere except the flagged desktop shell ---
  A.eq(Titlebar.shouldInstall(undefined), false, 'no window -> inert');
  A.eq(Titlebar.shouldInstall({}), false, 'browser preview (no flag) -> inert');
  A.eq(Titlebar.shouldInstall({ __STARNET_CUSTOM_CHROME__: 1 }), true, 'shell flag -> installs');

  // --- window-handle resolution mirrors fullscreen.js's ladder ---
  const handle = { minimize() {}, toggleMaximize() {}, close() {} };
  A.eq(Titlebar.tauriWindow({ __TAURI__: { window: { getCurrentWindow: () => handle } } }), handle,
    'getCurrentWindow shape resolves');
  A.eq(Titlebar.tauriWindow({ __TAURI__: { window: { appWindow: handle } } }).minimize, handle.minimize,
    'appWindow shape resolves');
  A.eq(Titlebar.tauriWindow({}), null, 'no __TAURI__ -> null (no dead chrome)');

  // --- buttons call the REAL window controls ---
  const calls = [];
  const appWindow = {
    minimize() { calls.push('minimize'); return Promise.resolve(); },
    toggleMaximize() { calls.push('toggleMaximize'); return Promise.resolve(); },
    close() { calls.push('close'); return Promise.resolve(); }
  };
  const act = Titlebar.handlers(appWindow);
  await act.min(); await act.max(); await act.close();
  A.eq(calls.join(','), 'minimize,toggleMaximize,close', 'MIN/MAX/CLOSE drive the native window');

  // a rejecting IPC call never throws out of a click handler
  let warned = false;
  const flaky = Titlebar.handlers({ minimize: () => Promise.reject(new Error('ipc down')) }, () => { warned = true; });
  await flaky.min();
  A.ok(warned, 'failed window control is warned, not thrown');

  // --- state -> chrome classes ---
  const body = { classList: fakeClassList() };
  const labels = [];
  const maxBtn = { classList: fakeClassList(), setAttribute(k, v) { if (k === 'aria-label') labels.push(v); } };

  Titlebar.applyState({ maximized: true, fullscreen: false }, body, maxBtn);
  A.ok(maxBtn.classList.contains('is-max'), 'maximized -> restore glyph class');
  A.ok(!body.classList.contains('sn-fs'), 'not fullscreen -> bar visible');
  A.eq(labels[labels.length - 1], 'Restore', 'maximized -> Restore label');

  Titlebar.applyState({ maximized: false, fullscreen: true }, body, maxBtn);
  A.ok(!maxBtn.classList.contains('is-max'), 'restored -> maximize glyph class');
  A.ok(body.classList.contains('sn-fs'), 'fullscreen -> bar hidden (sn-fs)');
  A.eq(labels[labels.length - 1], 'Maximize', 'restored -> Maximize label');

  // --- sn-fs flip re-announces layout: fixed trackers (#logo) hold stale pixel
  //     coords because the class moves the topbar AFTER the resize event fired ---
  {
    let resizes = 0;
    const win = {
      Event: function (type) { this.type = type; },
      dispatchEvent(ev) { if (ev && ev.type === 'resize') resizes++; }
    };
    const rzBody = { classList: fakeClassList(), ownerDocument: { defaultView: win } };
    Titlebar.applyState({ maximized: false, fullscreen: true }, rzBody, null);
    A.eq(resizes, 1, 'entering fullscreen dispatches a resize for fixed trackers');
    Titlebar.applyState({ maximized: false, fullscreen: true }, rzBody, null);
    A.eq(resizes, 1, 'same-state probe does NOT re-dispatch (no resize loop)');
    Titlebar.applyState({ maximized: false, fullscreen: false }, rzBody, null);
    A.eq(resizes, 2, 'exiting fullscreen re-announces too');
  }

  // --- readState probes honestly: missing/broken probes read as false ---
  const s1 = await Titlebar.readState({ isMaximized: () => Promise.resolve(true), isFullscreen: () => Promise.resolve(false) });
  A.eq(s1.maximized, true, 'isMaximized true flows through');
  A.eq(s1.fullscreen, false, 'isFullscreen false flows through');
  const s2 = await Titlebar.readState({});
  A.eq(s2.maximized, false, 'missing probe -> false, never a lie');
  const s3 = await Titlebar.readState({ isMaximized: () => Promise.reject(new Error('x')), isFullscreen: () => { throw new Error('y'); } });
  A.eq(s3.maximized || s3.fullscreen, false, 'throwing probes -> false, never a crash');

  console.log('titlebar.test.js OK');
  // report() settles the assertion counter — the .catch below only fires on a THROWN error, so
  // without this a failed assertion still exits 0 and the gate scores it green.
  A.report('titlebar.test');
})().catch(err => { console.error(err); process.exit(1); });
