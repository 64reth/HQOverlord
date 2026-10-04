#!/usr/bin/env node
// dev/logo-glass-shots.mjs — where should the brand mark sit in the CRT glass stack?
//
// The mark is hoisted to <body> at z960, ABOVE both glass layers (vignette z940, scanlines z950),
// so the beam runs behind it and stops at its edges. #screen-game is z10, so ANY z above 10 still
// paints over every window — which means the mark can be dropped under the glass without giving up
// the occlusion behaviour the hoist was for. Three candidate seats:
//   960  today: above everything, no glass on the mark
//   945  under the scanlines, above the vignette
//   935  under both
//
// LAW THIS SCRIPT EXISTS TO OBEY (crt-glass-moire lane, cost a whole session): never tune glass
// pixels from computed-style readouts. Capture REAL device pixels, magnify them NEAREST, and look.
// clip.scale is deliberately 1 — raising it would re-rasterize the gradient at the higher scale and
// show a beam that no screen ever paints.
//
//   node dev/logo-glass-shots.mjs [--url=http://127.0.0.1:9481] [--z=960,945,935] [--out=dir]
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const h = argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const URL = opt('url', 'http://127.0.0.1:9481');
const ZS = opt('z', '960,945,935').split(',').map(Number);
const THEME = opt('theme', 'amber');
const OUT_DIR = opt('out', join(REPO, 'logo-glass'));
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9401);
const DPR = 2;
const MARGIN = 12;    // CSS px of surrounding chrome, so the beam is visible BESIDE the mark too
const ZOOM = 3;       // nearest magnification in the contact sheet

const LABEL = { 960: 'z960 — TODAY (above all glass)', 945: 'z945 — under scanlines, above vignette', 935: 'z935 — under both glass layers' };

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'glass-'));
  let chrome = null, cdp = null;
  try {
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1600,1000', profileDir: join(scratch, 'chrome') });
    await sleep(1400);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Page.navigate', { url: URL });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (await evalJS(cdp, `(() => { const g = document.getElementById('screen-game'), l = document.getElementById('logo');
        return !!(g && g.classList.contains('active') && l && getComputedStyle(l).display !== 'none'); })()`)) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) throw new Error('app never reached the in-game screen at ' + URL);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: DPR, mobile: false });
    await evalJS(cdp, `StationUI.setTheme(${JSON.stringify(THEME)})`);
    await sleep(700);

    const scan = await evalJS(cdp, `(() => { const b = getComputedStyle(document.body, '::after');
      return { z: b.zIndex, off: document.body.classList.contains('no-scan') }; })()`);
    if (scan.off) throw new Error('body.no-scan is on — there is no beam to judge');

    const shots = [];
    for (const z of ZS) {
      await evalJS(cdp, `document.getElementById('logo').style.zIndex = ${JSON.stringify(String(z))}`);
      await sleep(350);
      const r = await evalJS(cdp, `(() => { const r = document.querySelector('#logo .logo-img').getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false,
        clip: { x: r.x - MARGIN, y: r.y - MARGIN, width: r.w + 2 * MARGIN, height: r.h + 2 * MARGIN, scale: 1 },
      });
      shots.push({ z, label: LABEL[z] || ('z' + z), data: shot.data });
    }
    await evalJS(cdp, `document.getElementById('logo').style.zIndex = ''`);

    // contact sheet: the captured device pixels, magnified NEAREST, labelled
    const sheet = `<!doctype html><meta charset="utf-8"><title>glass</title>
<style>
 body{margin:0;padding:18px 20px;background:#07090b;color:#cfd8dc;font:12px/1.4 ui-monospace,Consolas,monospace}
 .l{font-size:11px;letter-spacing:2px;color:#78909c;margin:0 0 5px}
 .r{margin-bottom:16px}
 img{display:block;image-rendering:pixelated;border:1px solid #1c2429;border-radius:3px}
</style>
<h1 style="font-size:14px;letter-spacing:2px;margin:0 0 4px;color:#eceff1">BRAND MARK vs THE CRT GLASS — ${THEME}</h1>
<p style="color:#7d8a91;margin:0 0 16px">Real device pixels at DPR ${DPR}, magnified ${ZOOM}x nearest. The beam runs across the
 chrome beside the mark in every frame; the question is whether it also runs ACROSS the mark.</p>
<div id="root"></div>
<script>
const S = ${JSON.stringify(shots.map(s => ({ label: s.label, data: s.data })))};
const Z = ${ZOOM};
let left = S.length;
for (const s of S) {
  const d = document.createElement('div'); d.className = 'r';
  d.innerHTML = '<p class="l">' + s.label + '</p>';
  const im = new Image();
  im.onload = () => { im.style.width = (im.naturalWidth * Z) + 'px'; if (--left === 0) document.body.dataset.ready = '1'; };
  im.src = 'data:image/png;base64,' + s.data;
  d.appendChild(im); document.getElementById('root').appendChild(d);
}
</script>`;
    const html = join(scratch, 'sheet.html');
    writeFileSync(html, sheet);
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
    let ok = false;
    for (let i = 0; i < 60; i++) {
      if (await evalJS(cdp, `document.body && document.body.dataset.ready === '1'`)) { ok = true; break; }
      await sleep(200);
    }
    if (!ok) throw new Error('contact sheet never signalled ready');
    const size = await evalJS(cdp, `({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(size.w), height: Math.ceil(size.h), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const final = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, `glass-${THEME}.png`);
    writeFileSync(out, Buffer.from(final.data, 'base64'));
    console.log(JSON.stringify({ out, scanlineZ: scan.z, seats: ZS }, null, 2));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc.kill(); } catch {}
  }
}
main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
