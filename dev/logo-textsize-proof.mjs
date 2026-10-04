#!/usr/bin/env node
// dev/logo-textsize-proof.mjs — does the brand mark stay seated across TEXT SIZE?
//
// WHY this exists: positionLogo() gained a device-pixel snap plus a correction pass, and TEXT SIZE
// is the exact dial that broke logo seating once before (2026-07-20 misalignment: visual-px rects
// written into the zoomed body's coordinate space). The mark is CABINET — app.css counter-zooms it
// back to 1:1 while <body> stays zoomed — so the correct expectation is that it does NOT move and
// does NOT resize as the dial changes, and stays on a whole device pixel throughout.
//
// The dial must be driven through the REAL setting: writing body.style.zoom by hand is wiped the
// next time applySettings() re-derives from the store (proven the hard way). So this clicks the
// actual TEXT SIZE chips in the SETTINGS window.
//
//   node dev/logo-textsize-proof.mjs [--url=http://127.0.0.1:9481]
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const h = argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const URL = opt('url', 'http://127.0.0.1:9481');
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9411);
const STEPS = ['100', '115', '145', '90', '0'];   // 0 = AUTO, the shipped default; restored last

const MEASURE = `(() => {
  const logo = document.getElementById('logo');
  const anchor = document.getElementById('logo-anchor');
  const mr = document.querySelector('#logo .logo-img').getBoundingClientRect();
  const lr = logo.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const whole = v => Math.abs(v * dpr - Math.round(v * dpr)) < 0.02;
  return {
    bodyZoom: document.body.style.zoom || '(none)',
    snUnzoom: document.body.style.getPropertyValue('--sn-unzoom') || '(none)',
    logoElZoom: +U.elZoom(logo).toFixed(3),
    seatDeviceX: +(lr.left * dpr).toFixed(3),
    seatDeviceY: +(lr.top * dpr).toFixed(3),
    onWholeDevicePx: whole(lr.left) && whole(lr.top),
    seatDeltaX: +(lr.left - ar.left).toFixed(2),
    markW: +mr.width.toFixed(2), markH: +mr.height.toFixed(2),
  };
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'textsize-'));
  let chrome = null, cdp = null;
  try {
    // 1600 wide clears the <=1480px media query, so the mark is at its full 30px
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1600,1000', profileDir: join(scratch, 'chrome') });
    await sleep(1400);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Page.navigate', { url: URL });
    for (let i = 0; i < 80; i++) {
      if (await evalJS(cdp, `(() => { const g = document.getElementById('screen-game'), l = document.getElementById('logo');
        return !!(g && g.classList.contains('active') && l && getComputedStyle(l).display !== 'none'); })()`)) break;
      await sleep(500);
    }
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
    await sleep(600);

    await evalJS(cdp, `StationUI.openTerm('settings')`);
    let chips = 0;
    for (let i = 0; i < 40; i++) {
      chips = await evalJS(cdp, `document.querySelectorAll('#set-textsize [data-ts]').length`);
      if (chips) break;
      await sleep(400);
    }
    if (!chips) throw new Error('SETTINGS never rendered its TEXT SIZE chips');

    const rows = [];
    for (const ts of STEPS) {
      const clicked = await evalJS(cdp, `(() => {
        const c = Array.from(document.querySelectorAll('#set-textsize [data-ts]')).find(x => x.dataset.ts === ${JSON.stringify(ts)});
        if (!c) return false; c.click(); return true; })()`);
      if (!clicked) { rows.push({ chip: ts, error: 'chip missing' }); continue; }
      await sleep(900);
      rows.push(Object.assign({ chip: ts }, await evalJS(cdp, MEASURE)));
    }

    // The CONTROL: at least one step must actually have moved the dial, or this proves nothing.
    const applied = rows.filter(r => r.bodyZoom && r.bodyZoom !== '(none)').map(r => r.chip);
    const seats = new Set(rows.filter(r => r.seatDeviceX != null).map(r => r.seatDeviceX + '/' + r.seatDeviceY));
    // Size is compared with a TOLERANCE, not for equality: the counter-zoom is a reciprocal
    // (1/1.15 is not representable), so the mark's box lands within a fraction of a pixel of its
    // authored size rather than exactly on it. 0.25px is well inside "cannot be seen"; demanding
    // equality just reports rounding as a defect.
    const TOL = 0.25;
    const ws = rows.filter(r => r.markW != null).map(r => r.markW);
    const hs = rows.filter(r => r.markH != null).map(r => r.markH);
    const spread = a => +(Math.max(...a) - Math.min(...a)).toFixed(3);
    const sizeStable = ws.length > 0 && spread(ws) <= TOL && spread(hs) <= TOL;
    console.log(JSON.stringify({
      rows,
      dialActuallyMovedOn: applied,
      seatStable: seats.size === 1, seatsSeen: [...seats],
      sizeStable, sizeSpreadPx: { w: spread(ws), h: spread(hs), tolerance: TOL },
      allOnWholeDevicePx: rows.every(r => r.onWholeDevicePx !== false),
      verdict: applied.length === 0 ? 'INCONCLUSIVE — the dial never applied'
        : (seats.size === 1 && sizeStable && rows.every(r => r.onWholeDevicePx !== false))
          ? 'PASS — mark holds its seat and size across TEXT SIZE' : 'FAIL',
    }, null, 2));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc.kill(); } catch {}
  }
}
main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
