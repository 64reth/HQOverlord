// Live PU-04 DOM journey: x:-996 -> desktop -> phone -> desktop -> reload.
// Uses the repository's sanctioned CDP harness; no canvas screenshots.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../lib/cdp.mjs';

const url = process.env.STARNET_URL || 'http://127.0.0.1:9074';
const cdpPort = Number(process.env.STARNET_CDP_PORT || 9474);
const profileDir = mkdtempSync(join(tmpdir(), 'starnet-window-position-'));
const { proc } = launchChrome({ cdpPort, win: '1440,900', profileDir });
let cdp;

async function waitFor(expr, label) {
  for (let i = 0; i < 50; i++) {
    if (await evalJS(cdp, expr).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error('timed out waiting for ' + label);
}

async function openSettings() {
  await waitFor("typeof StationUI === 'object' && typeof StationUI.openTerm === 'function' && !!document.querySelector('#screen-game.active')", 'active station');
  await evalJS(cdp, "StationUI.openTerm('settings')");
  await waitFor("!!document.querySelector('.term.console .term-x')", 'Settings terminal');
  await sleep(650);
}

async function probe(label) {
  const result = await evalJS(cdp, `(() => {
    const w = document.querySelector('.term.console');
    const head = w && w.querySelector('.term-head');
    const close = w && w.querySelector('.term-x');
    if (!w || !head || !close) return { label: ${JSON.stringify(label)}, ok: false, reason: 'missing terminal chrome' };
    const wr = w.getBoundingClientRect(), hr = head.getBoundingClientRect(), xr = close.getBoundingClientRect();
    const saved = JSON.parse(localStorage.getItem('starnet.station.v1') || '{}').termPos?.settings;
    const ok = hr.bottom > 0 && hr.top < innerHeight && xr.left >= 0 && xr.right <= innerWidth && xr.top >= 0 && xr.bottom <= innerHeight;
    return { label: ${JSON.stringify(label)}, ok, viewport: [innerWidth, innerHeight], window: [wr.left, wr.top, wr.width, wr.height], close: [xr.left, xr.top, xr.right, xr.bottom], saved };
  })()`);
  if (!result.ok) throw new Error(label + ' invariant failed: ' + JSON.stringify(result));
  return result;
}

const receipts = [];
try {
  cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url });
  await waitFor("typeof StationUI === 'object' && typeof StationUI.openTerm === 'function' && !!document.querySelector('#screen-game.active')", 'station floor');
  await evalJS(cdp, `(() => {
    const key = 'starnet.station.v1';
    const state = JSON.parse(localStorage.getItem(key) || '{"v":1}');
    state.v = 1; state.termPos = state.termPos || {}; state.termPos.settings = { left: -996, top: -40 };
    localStorage.setItem(key, JSON.stringify(state));
    location.reload();
  })()`);
  await openSettings();
  receipts.push(await probe('desktop repaired x:-996'));

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  receipts.push(await probe('phone'));

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(350);
  receipts.push(await probe('desktop restored'));

  await cdp.send('Page.reload');
  await sleep(500);
  await openSettings();
  receipts.push(await probe('reload'));
  console.log(JSON.stringify({ ok: true, receipts }, null, 2));
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message, receipts }, null, 2));
  process.exitCode = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  try { proc.kill(); } catch {}
  try { rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
