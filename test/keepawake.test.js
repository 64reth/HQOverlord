/* node test/keepawake.test.js
   Locks the Settings bridge for Keep Computer Awake: browser preview is honest,
   desktop invokes the native Tauri command, and repeated settings renders do not
   spam the native power assertion. */
'use strict';

const A = require('./_assert.js');
const KeepAwake = require('../frontend/app/keepawake.js');

(async () => {
  A.eq(KeepAwake.isDesktop({}), false, 'plain browser windows are not desktop');

  const browser = await KeepAwake.apply(true, { win: {} });
  A.eq(browser.desktop, false, 'browser preview reports non-desktop');
  A.eq(browser.supported, false, 'browser preview does not claim native support');
  A.eq(browser.enabled, false, 'browser preview never claims the OS assertion is active');
  A.eq(browser.requested, true, 'browser preview still reports the requested state');

  const calls = [];
  const desktopWin = {
    __TAURI__: {
      core: {
        invoke(cmd, args) {
          calls.push({ cmd, args: args || {} });
          if (cmd === KeepAwake._internals.STATUS_COMMAND) {
            return Promise.resolve({ desktop: true, supported: true, enabled: true, message: null });
          }
          return Promise.resolve({ desktop: true, supported: true, enabled: !!args.enabled, message: null });
        }
      }
    }
  };

  A.eq(KeepAwake.isDesktop(desktopWin), true, 'Tauri core marks desktop support');
  const enabled = await KeepAwake.apply(true, { win: desktopWin, force: true });
  A.eq(calls.length, 1, 'desktop apply invokes Tauri once');
  A.eq(calls[0].cmd, KeepAwake._internals.SET_COMMAND, 'desktop apply calls the native keep-awake command');
  A.eq(calls[0].args.enabled, true, 'desktop apply forwards the desired enabled state');
  A.eq(enabled.enabled, true, 'desktop response is normalized');

  const deduped = await KeepAwake.apply(true, { win: desktopWin });
  A.eq(calls.length, 1, 'same requested state is deduped after settings rerenders');
  A.eq(deduped.enabled, true, 'deduped status preserves the last native state');

  const status = await KeepAwake.status({ win: desktopWin });
  A.eq(calls.length, 2, 'status reads invoke Tauri');
  A.eq(calls[1].cmd, KeepAwake._internals.STATUS_COMMAND, 'status uses the read-only command');
  A.eq(status.enabled, true, 'status response is normalized');

  const failingWin = {
    __TAURI__: {
      core: {
        invoke() {
          return Promise.reject(new Error('native unavailable'));
        }
      }
    }
  };
  let failed = false;
  try {
    await KeepAwake.apply(true, { win: failingWin, force: true });
  } catch (err) {
    failed = true;
    A.eq(err.message, 'native unavailable', 'native failures keep the OS error message');
    A.eq(err.status.enabled, false, 'native failures report inactive assertion');
  }
  A.eq(failed, true, 'native failures reject so the UI can roll back');

  A.report('keepawake.test');
})().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
