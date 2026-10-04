#!/usr/bin/env node
// dev/logo-live-proof.mjs — capture the REAL topbar mark out of the running app.
//
// The Browser-pane screenshot times out on this app (an undisplayed pane composites no frames), and
// a DOM read cannot tell a working mask from a broken one: when a CSS mask image fails to load the
// mask is treated as absent and the element paints as a SOLID BLOCK — same computed style, opposite
// pixels. So this clips the actual #logo rect out of a CDP screenshot and also reports the painted
// coverage, which is the number that separates letterforms from a slab.
//
//   node dev/logo-live-proof.mjs [--url=http://127.0.0.1:9481] [--out=dir]
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { decodePNG } from '../scripts/lib/png.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const h = argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const URL = opt('url', 'http://127.0.0.1:9481');
const OUT_DIR = opt('out', join(REPO, 'logo-proof'));
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9397);
const THEMES = ['amber', 'green'];
const DPR = 2;   // capture at 2x so the clipped strip is legible when viewed

const hexToRgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return String(hex);
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
};

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'logoproof-'));
  let chrome = null, cdp = null;
  const report = [];
  try {
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1600,1000', profileDir: join(scratch, 'chrome') });
    await sleep(1400);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Page.navigate', { url: URL });

    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (await evalJS(cdp, `(() => { const g = document.getElementById('screen-game');
        const l = document.getElementById('logo');
        return !!(g && g.classList.contains('active') && l && getComputedStyle(l).display !== 'none'); })()`)) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) throw new Error('app never reached the in-game screen with #logo shown at ' + URL);

    // 1600 wide clears the <=1480px media query, so the mark is at its full 30px — the size the law
    // in style.css is written for, and the size the comparison sheet was judged at.
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: DPR, mobile: false });
    await sleep(600);
    mkdirSync(OUT_DIR, { recursive: true });

    for (const theme of THEMES) {
      // StationUI.setTheme, NOT a className swap: applySettings() re-derives the theme classes from
      // the store, so a hand-set class is wiped the next time anything touches settings — the first
      // run of this probe reported GREEN while --ph was still amber.
      await evalJS(cdp, `StationUI.setTheme(${JSON.stringify(theme)})`);
      await sleep(600);

      const info = await evalJS(cdp, `(() => {
        const li = document.querySelector('#logo .logo-img'), logo = document.getElementById('logo');
        const cs = getComputedStyle(li), r = li.getBoundingClientRect(), lr = logo.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        return { bg: cs.backgroundColor, ph: getComputedStyle(document.body).getPropertyValue('--ph').trim(),
                 mark: { x: r.left, y: r.top, w: r.width, h: r.height },
                 seatDeviceX: +(lr.left * dpr).toFixed(3), seatDeviceY: +(lr.top * dpr).toFixed(3), dpr };
      })()`);

      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
        clip: { x: info.mark.x - 6, y: info.mark.y - 6, width: info.mark.w + 12, height: info.mark.h + 12, scale: DPR },
      });
      const buf = Buffer.from(shot.data, 'base64');
      const file = join(OUT_DIR, `logo-${theme}.png`);
      writeFileSync(file, buf);

      // Coverage: fraction of the clipped strip that is lit. A working mask lands well under half
      // (a hollow outline wordmark on a dark bar); a failed mask paints the whole box -> near 1.
      const png = decodePNG(buf);
      const { width: w, height: h, channels, pixels } = png;
      let lit = 0;
      for (let i = 0; i < w * h; i++) {
        const d = i * channels;
        if (0.299 * pixels[d] + 0.587 * pixels[d + 1] + 0.114 * pixels[d + 2] > 90) lit++;
      }
      report.push({
        theme, file, strip: [w, h],
        // the mark PAINTS the theme colour only if its background-color equals the theme's own --ph
        bgPaint: info.bg, phVar: info.ph, marksTheme: info.bg.replace(/\s/g, '') === hexToRgb(info.ph),
        markBox: { w: +info.mark.w.toFixed(2), h: +info.mark.h.toFixed(2) },
        seatDeviceX: info.seatDeviceX, seatDeviceY: info.seatDeviceY,
        seatIsWholeDevicePx: Number.isInteger(Math.round(info.seatDeviceX * 1000) / 1000) && Number.isInteger(Math.round(info.seatDeviceY * 1000) / 1000),
        litFraction: +(lit / (w * h)).toFixed(4),
      });
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
