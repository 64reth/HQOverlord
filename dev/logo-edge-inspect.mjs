#!/usr/bin/env node
// dev/logo-edge-inspect.mjs — render traced wordmark SVGs LARGE so contour quality is judgeable.
//
// The 30px comparison answers "is it crisp"; it cannot answer "is the outline clean", because at
// 30px a wobbly contour and a straight one are the same three pixels. This blows each candidate up
// to a height where every vertex is visible, and crops a region so the edges fill the frame.
//
//   node dev/logo-edge-inspect.mjs --svg="label:path" [--svg=...] [--h=260] [--crop=0,0.34] [--out=dir]
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const h = argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const SVGS = argv.filter(a => a.startsWith('--svg=')).map(a => a.slice('--svg='.length)).map(spec => {
  const i = spec.indexOf(':');
  return i > 1 ? { label: spec.slice(0, i), path: spec.slice(i + 1) } : { label: 'traced', path: spec };
});
const H = Number(opt('h', 260));
const [C0, C1] = opt('crop', '0,0.34').split(',').map(Number);
const OUT_DIR = opt('out', join(REPO, 'logo-edges'));
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9399);

const rows = SVGS.map(s => ({ label: s.label, svg: readFileSync(s.path, 'utf8') }));

const page = `<!doctype html><meta charset="utf-8"><title>edges</title>
<style>
  body { margin:0; padding:20px 24px; background:#07090b; color:#cfd8dc;
         font:12px/1.4 ui-monospace, Consolas, monospace; }
  .row { margin-bottom:18px; }
  .lbl { font-size:11px; letter-spacing:2px; color:#78909c; margin-bottom:6px; }
  .win { overflow:hidden; background:#030201; border:1px solid #1c2429; border-radius:4px;
         height:${H}px; position:relative; }
  .win svg { height:${H}px; width:auto; display:block; color:#ffaa33;
             position:absolute; left:0; top:0; }
</style>
<div id="root"></div>
<script>
const ROWS = ${JSON.stringify(rows)};
const H = ${H}, C0 = ${C0}, C1 = ${C1};
const root = document.getElementById('root');
for (const r of ROWS) {
  const d = document.createElement('div');
  d.className = 'row';
  d.innerHTML = '<div class="lbl">' + r.label + '</div><div class="win">' + r.svg + '</div>';
  root.appendChild(d);
  const svg = d.querySelector('svg'), win = d.querySelector('.win');
  const vb = svg.getAttribute('viewBox').split(/\\s+/).map(Number);
  const fullW = H * vb[2] / vb[3];
  win.style.width = Math.round(fullW * (C1 - C0)) + 'px';
  svg.style.left = Math.round(-fullW * C0) + 'px';
}
document.body.dataset.ready = '1';
</script>`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'edges-'));
  const html = join(scratch, 'e.html');
  writeFileSync(html, page);
  let chrome = null, cdp = null;
  try {
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1400,1200', profileDir: join(scratch, 'chrome') });
    await sleep(1400);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
    let ok = false;
    for (let i = 0; i < 60; i++) {
      if (await evalJS(cdp, `document.body && document.body.dataset.ready === '1'`)) { ok = true; break; }
      await sleep(200);
    }
    if (!ok) throw new Error('edge page never signalled ready');
    const size = await evalJS(cdp, `({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(size.w), height: Math.ceil(size.h), deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, 'edges.png');
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ out, size, rows: rows.map(r => r.label) }, null, 2));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc.kill(); } catch {}
  }
}
main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
