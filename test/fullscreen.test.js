/* node test/fullscreen.test.js
   Locks the F11 fullscreen shortcut: desktop uses the native Tauri window toggle;
   browser preview falls back to the Fullscreen API. */
'use strict';
const A = require('./_assert.js');
const Fullscreen = require('../frontend/app/fullscreen.js');

(async () => {
  A.ok(Fullscreen.isF11({ key: 'F11' }), 'F11 is recognized by key');
  A.ok(Fullscreen.isF11({ code: 'F11' }), 'F11 is recognized by code');
  A.ok(Fullscreen.isF11({ keyCode: 122 }), 'F11 is recognized by legacy keyCode');
  A.ok(!Fullscreen.isF11({ key: 'F10', code: 'F10', keyCode: 121 }), 'other function keys are ignored');

  let invoked = '';
  const ev = {
    key: 'F11',
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
  const tauriWin = {
    __TAURI__: {
      core: {
        invoke(cmd) { invoked = cmd; return Promise.resolve(true); }
      }
    }
  };
  A.eq(Fullscreen.handleKeydown(ev, tauriWin, null), true, 'F11 handler claims the shortcut');
  A.eq(invoked, 'starnet_toggle_fullscreen', 'desktop F11 calls the native Tauri fullscreen command');
  A.ok(ev.prevented && ev.stopped, 'F11 is consumed before browser chrome handles it');
  await Promise.resolve();
  await Promise.resolve();

  let fullscreen = false;
  invoked = '';
  const apiWin = {
    __TAURI__: {
      core: {
        invoke(cmd) { invoked = cmd; return Promise.resolve(true); }
      },
      window: {
        getCurrentWindow() {
          return {
            isFullscreen() { return Promise.resolve(fullscreen); },
            setFullscreen(next) { fullscreen = next; return Promise.resolve(); }
          };
        }
      }
    }
  };
  A.eq(await Fullscreen.toggle(apiWin, null), true, 'Tauri window API enters fullscreen');
  A.eq(fullscreen, true, 'Tauri window API sets fullscreen true');
  A.eq(await Fullscreen.toggle(apiWin, null), false, 'Tauri window API exits fullscreen');
  A.eq(fullscreen, false, 'Tauri window API sets fullscreen false');
  A.eq(invoked, '', 'Tauri window API is preferred before the custom command');

  fullscreen = false;
  const webviewWin = {
    __TAURI__: {
      webviewWindow: {
        getCurrentWebviewWindow() {
          return {
            isFullscreen() { return Promise.resolve(fullscreen); },
            setFullscreen(next) { fullscreen = next; return Promise.resolve(); }
          };
        }
      }
    }
  };
  A.eq(await Fullscreen.toggle(webviewWin, null), true, 'Tauri webviewWindow API is also recognized');
  A.eq(fullscreen, true, 'webviewWindow path sets fullscreen true');

  // Windows/tao: entering fullscreen from a MAXIMIZED window keeps the work-area
  // size (taskbar strip at the bottom) — the toggle must unmaximize first and
  // restore the maximize when fullscreen exits.
  {
    let fsOn = false, maxOn = true;
    const ops = [];
    const maxWin = {
      __TAURI__: {
        window: {
          getCurrentWindow() {
            return {
              isFullscreen() { return Promise.resolve(fsOn); },
              setFullscreen(next) { ops.push('setFullscreen:' + next); fsOn = next; return Promise.resolve(); },
              isMaximized() { return Promise.resolve(maxOn); },
              unmaximize() { ops.push('unmaximize'); maxOn = false; return Promise.resolve(); },
              maximize() { ops.push('maximize'); maxOn = true; return Promise.resolve(); }
            };
          }
        }
      }
    };
    A.eq(await Fullscreen.toggle(maxWin, null), true, 'maximized window still enters fullscreen');
    A.eq(ops.join(','), 'unmaximize,setFullscreen:true', 'maximize is dropped BEFORE fullscreen (tao work-area bug)');
    A.eq(await Fullscreen.toggle(maxWin, null), false, 'fullscreen exits back to windowed');
    A.eq(ops.join(','), 'unmaximize,setFullscreen:true,setFullscreen:false,maximize', 'exit restores the remembered maximize');
    A.eq(maxOn, true, 'window ends maximized again after the round trip');
  }

  let resolveSlow;
  let slowInvokes = 0;
  const slowWin = {
    __TAURI__: {
      core: {
        invoke() {
          slowInvokes++;
          return new Promise(resolve => { resolveSlow = resolve; });
        }
      }
    }
  };
  A.eq(Fullscreen.handleKeydown({ key: 'F11', preventDefault() {}, stopPropagation() {} }, slowWin, null), true, 'first F11 starts a pending toggle');
  A.eq(Fullscreen.handleKeydown({ key: 'F11', preventDefault() {}, stopPropagation() {} }, slowWin, null), true, 'second F11 is consumed while pending');
  A.eq(slowInvokes, 1, 'pending F11 does not start a second toggle');
  resolveSlow(true);
  await Promise.resolve();
  await Promise.resolve();

  invoked = '';
  A.eq(Fullscreen.handleKeydown({ key: 'F11', repeat: true }, tauriWin, null), false, 'held F11 repeats are ignored');
  A.eq(invoked, '', 'held F11 does not rapid-toggle fullscreen');

  let requested = 0;
  let exited = 0;
  const doc = {
    fullscreenElement: null,
    documentElement: {
      requestFullscreen() { requested++; doc.fullscreenElement = doc.documentElement; return Promise.resolve(); }
    },
    exitFullscreen() { exited++; doc.fullscreenElement = null; return Promise.resolve(); }
  };
  A.eq(await Fullscreen.toggleBrowser(doc), true, 'browser fallback enters fullscreen');
  A.eq(requested, 1, 'browser fallback calls requestFullscreen on the root document');
  A.eq(await Fullscreen.toggleBrowser(doc), false, 'browser fallback exits fullscreen');
  A.eq(exited, 1, 'browser fallback calls exitFullscreen when already active');

  requested = 0;
  const failingTauriWin = {
    __TAURI__: { core: { invoke() { return Promise.reject(new Error('native unavailable')); } } },
    console: { warn() {} }
  };
  A.eq(await Fullscreen.toggle(failingTauriWin, doc), true, 'native failure falls back to browser fullscreen');
  A.eq(requested, 1, 'fallback requestFullscreen still runs after a native error');

  // toggle() flips body.sn-fs immediately (titlebar hide) instead of waiting for the
  // titlebar's trailing resize probe — the probe still reconciles the truth later.
  {
    const classes = new Set();
    const fsDoc = {
      body: { classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } } },
      fullscreenElement: null,
      documentElement: {
        requestFullscreen() { fsDoc.fullscreenElement = fsDoc.documentElement; return Promise.resolve(); }
      },
      exitFullscreen() { fsDoc.fullscreenElement = null; return Promise.resolve(); }
    };
    let fsOn = false;
    const fsWin = {
      __TAURI__: {
        window: {
          getCurrentWindow() {
            return {
              isFullscreen() { return Promise.resolve(fsOn); },
              setFullscreen(next) { fsOn = next; return Promise.resolve(); }
            };
          }
        }
      }
    };
    A.eq(await Fullscreen.toggle(fsWin, fsDoc), true, 'class-sync toggle enters fullscreen');
    A.ok(classes.has('sn-fs'), 'entering fullscreen sets body.sn-fs immediately');
    A.eq(await Fullscreen.toggle(fsWin, fsDoc), false, 'class-sync toggle exits fullscreen');
    A.ok(!classes.has('sn-fs'), 'exiting fullscreen clears body.sn-fs immediately');
    Fullscreen.syncBodyClass(null, true);   // never throws without a document
  }

  // sn-fs re-seats the layout AFTER the window's own resize already fired — the
  // class flip must re-announce so fixed trackers (#logo positionLogo) re-seat too.
  {
    let resizes = 0;
    const classes = new Set();
    const rzDoc = {
      body: { classList: {
        contains(c) { return classes.has(c); },
        toggle(c, on) { on ? classes.add(c) : classes.delete(c); }
      } }
    };
    rzDoc.defaultView = {
      Event: function (type) { this.type = type; },
      dispatchEvent(ev) { if (ev && ev.type === 'resize') resizes++; }
    };
    Fullscreen.syncBodyClass(rzDoc, true);
    A.eq(resizes, 1, 'sn-fs flip dispatches a window resize (logo re-seat)');
    Fullscreen.syncBodyClass(rzDoc, true);
    A.eq(resizes, 1, 'no-op sync does NOT re-dispatch resize');
    Fullscreen.syncBodyClass(rzDoc, false);
    A.eq(resizes, 2, 'clearing sn-fs re-announces layout too');
  }

  let listener = null;
  const fakeWin = {
    document: {},
    addEventListener(type, fn, capture) {
      if (type === 'keydown' && capture === true) listener = fn;
    }
  };
  A.eq(Fullscreen.install(fakeWin, fakeWin.document), true, 'install wires the key listener');
  A.ok(typeof listener === 'function', 'install uses a real keydown listener');
  A.eq(Fullscreen.install(fakeWin, fakeWin.document), false, 'install is idempotent');

  A.report('fullscreen.test');
})().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
