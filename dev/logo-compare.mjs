#!/usr/bin/env node
// dev/logo-compare.mjs — the side-by-side: today's placed PNG vs the traced SVG, at topbar size.
//
// Honesty rules this harness follows, because a logo comparison is trivially riggable:
//  - Both marks are rasterized by the SAME browser at the SAME CSS box (30px tall, the real
//    .logo-img height from frontend/css/style.css).
//  - The magnifier does NOT re-render either mark bigger. It rasterizes each at 30 CSS px under a
//    simulated devicePixelRatio, then NEAREST-upscales those real device pixels to a fixed display
//    size. So every cell shows the same physical size and differs only in how many real pixels the
//    screen would actually have. That is the whole question.
//  - DPR 1 / 2 / 3 are all shown. The baked PNG is a 60px-tall asset, so DPR 2 is its BEST case
//    (exact 1:1) and it is shown at its best.
//
//   node dev/logo-compare.mjs [--svg=path] [--out=dir]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const h = argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
// --svg may repeat: each becomes its own row, so stroke weight can be judged side by side.
// "path" or "label:path" (a bare drive letter is not a label — C:\... must still work).
const SVG_ARGS = argv.filter(a => a.startsWith('--svg=')).map(a => a.slice('--svg='.length));
const SVGS = (SVG_ARGS.length ? SVG_ARGS : [join(REPO, 'frontend/assets/brand/starnet-wordmark.svg')])
  .map(spec => {
    const i = spec.indexOf(':');
    return i > 1 ? { label: spec.slice(0, i), path: spec.slice(i + 1) } : { label: 'SVG (traced)', path: spec };
  });
const OUT_DIR = opt('out', join(REPO, 'logo-compare'));
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9391);

const THEMES = [
  { key: 'amber', label: 'AMBER (default)', ph: '#ffaa33', bg: '#030201' },
  { key: 'green', label: 'GREEN', ph: '#3dff70', bg: '#010503' },
];
const DPRS = [1, 2, 3];
const MARK_H = 30;      // the real .logo-img height
const CELL_H = 180;     // every magnifier cell displays at this height, whatever DPR fed it
const CROP = 0.30;      // magnify the left 30% ("STA") — wide enough to read, narrow enough that all
                        // three DPR columns fit the sheet without clipping

const pngB64 = readFileSync(join(REPO, 'frontend/assets/brand/starnet-logo-small.png')).toString('base64');
// row order = the order they are compared in: today's asset first, then each candidate
const VARIANTS = [
  { label: 'PNG (today)', kind: 'png' },
  ...SVGS.map(s => ({ label: s.label, kind: 'svg', svg: readFileSync(s.path, 'utf8') })),
];

const page = `<!doctype html><meta charset="utf-8"><title>logo compare</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 26px 30px 34px; background: #07090b; color: #cfd8dc;
         font: 13px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
  h1 { font-size: 15px; letter-spacing: 2px; margin: 0 0 4px; color: #eceff1; }
  .sub { color: #7d8a91; margin: 0 0 22px; }
  .theme { margin-bottom: 30px; border: 1px solid #1c2429; border-radius: 8px; overflow: hidden; }
  .theme > h2 { font-size: 12px; letter-spacing: 3px; margin: 0; padding: 8px 14px;
                background: #10161a; color: #90a4ae; border-bottom: 1px solid #1c2429; }
  .pad { padding: 16px 14px 18px; }
  .cap { font-size: 11px; letter-spacing: 2px; color: #78909c; margin: 0 0 7px; }
  /* true size: a mock topbar strip, mark at its real 30px */
  .bar { display: flex; align-items: center; gap: 14px; height: 46px; padding: 0 14px;
         border: 1px solid rgba(255,255,255,.07); border-radius: 5px; margin-bottom: 6px; }
  .bar .who { font-size: 10px; letter-spacing: 2px; color: #607d8b; width: 108px; flex: 0 0 auto; }
  .bar img, .bar svg { height: ${MARK_H}px; width: auto; display: block; }
  .grid { display: grid; grid-template-columns: 108px repeat(${DPRS.length}, auto); gap: 8px 12px;
          align-items: center; margin-top: 16px; }
  .grid .hd { font-size: 10px; letter-spacing: 2px; color: #607d8b; text-align: center; }
  .grid .rl { font-size: 10px; letter-spacing: 2px; color: #607d8b; }
  canvas { display: block; border: 1px solid #1c2429; border-radius: 3px; image-rendering: pixelated; }
</style>
<h1>STARNET WORDMARK — PLACED PNG vs TRACED SVG</h1>
<p class="sub">Both drawn by the same engine at the real topbar box (${MARK_H}px tall). Magnifier =
   rasterize at ${MARK_H}px under each devicePixelRatio, then nearest-upscale those real device pixels
   to a constant ${CELL_H}px. Same physical size in every cell; only the pixel budget differs.</p>
<div id="root"></div>
<script>
const VARIANTS = ${JSON.stringify(VARIANTS)};
const PNG = "data:image/png;base64,${pngB64}";
const THEMES = ${JSON.stringify(THEMES)};
const DPRS = ${JSON.stringify(DPRS)};
const MARK_H = ${MARK_H}, CELL_H = ${CELL_H}, CROP = ${CROP};

const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
// currentColor does not resolve inside an <img>, so the theme colour is substituted into the
// markup for the canvas path; the TRUE SIZE row inlines the SVG in the DOM and inherits it via CSS.
const srcFor = (v, colour) => v.kind === 'png' ? PNG
  : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(v.svg.replace(/currentColor/g, colour));

/* Rasterize the mark into a MARK_H*dpr-tall buffer (what the screen would really hold), crop the
   left CROP fraction, then blow those exact pixels up with smoothing OFF. No re-render at size. */
async function magnify(img, dpr) {
  const aspect = img.naturalWidth / img.naturalHeight;
  const rh = Math.round(MARK_H * dpr), rw = Math.round(rh * aspect);
  const real = document.createElement('canvas');
  real.width = rw; real.height = rh;
  real.getContext('2d').drawImage(img, 0, 0, rw, rh);

  const cw = Math.round(rw * CROP);
  const out = document.createElement('canvas');
  const k = CELL_H / rh;                      // 6x at dpr1, 3x at dpr2, 2x at dpr3 -> constant size
  out.width = Math.round(cw * k); out.height = CELL_H;
  const g = out.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(real, 0, 0, cw, rh, 0, 0, out.width, out.height);
  return out;
}

window.addEventListener('error', e => { document.body.dataset.err = 'onerror: ' + e.message; });
(async () => {
 try {
  const root = document.getElementById('root');
  for (const t of THEMES) {
    const box = document.createElement('div');
    box.className = 'theme';
    box.innerHTML = '<h2>' + t.label + '</h2><div class="pad"></div>';
    const pad = box.querySelector('.pad');

    const cap = document.createElement('p');
    cap.className = 'cap'; cap.textContent = 'TRUE SIZE — ' + MARK_H + 'px, as the topbar shows it';
    pad.appendChild(cap);

    for (const v of VARIANTS) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.background = t.bg;
      bar.style.color = t.ph;
      bar.innerHTML = '<span class="who">' + v.label + '</span>' +
                      (v.kind === 'png' ? '<img src="' + PNG + '" alt="">' : v.svg);
      pad.appendChild(bar);
    }

    const cap2 = document.createElement('p');
    cap2.className = 'cap';
    cap2.style.marginTop = '18px';
    cap2.textContent = 'MAGNIFIED — the same ' + MARK_H + 'px mark, real device pixels only';
    pad.appendChild(cap2);

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.appendChild(document.createElement('span'));
    for (const d of DPRS) {
      const hd = document.createElement('span');
      hd.className = 'hd';
      hd.textContent = 'DPR ' + d + '  (' + Math.round(MARK_H * d) + ' real px tall)';
      grid.appendChild(hd);
    }
    for (const v of VARIANTS) {
      const rl = document.createElement('span');
      rl.className = 'rl'; rl.textContent = v.label;
      grid.appendChild(rl);
      const img = await load(srcFor(v, t.ph));
      for (const d of DPRS) {
        const cv = await magnify(img, d);
        cv.style.background = t.bg;
        grid.appendChild(cv);
      }
    }
    pad.appendChild(grid);
    root.appendChild(box);
  }
  document.body.dataset.ready = '1';
 } catch (e) { document.body.dataset.err = String(e && e.stack || e); }
})();
</script>`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'logocmp-'));
  const html = join(scratch, 'compare.html');
  writeFileSync(html, page);
  let chrome = null, cdp = null;
  try {
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1500,1400', profileDir: join(scratch, 'chrome') });
    await sleep(1400);
    cdp = await connectCDP(CDP_PORT);
    // Page.navigate, NOT `location.href = ...`: a script on about:blank is not allowed to navigate
    // the page to a file:// URL, and the assignment fails SILENTLY (href stays about:blank).
    await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (await evalJS(cdp, `document.body && document.body.dataset.ready === '1'`)) { ready = true; break; }
      await sleep(250);
    }
    if (!ready) {
      const err = await evalJS(cdp, `(document.body && document.body.dataset.err) || 'no error recorded'`);
      throw new Error('compare page never signalled ready — page said: ' + err);
    }
    const size = await evalJS(cdp, `({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: Math.ceil(size.w), height: Math.ceil(size.h), deviceScaleFactor: 1, mobile: false,
    });
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, 'logo-compare.png');
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ out, page: size, variants: VARIANTS.map(v => v.label) }, null, 2));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
