#!/usr/bin/env node
// dev/logo-size-ladder.mjs — at what height does a given wordmark still READ?
//
// The mosaic variant is the master art's own ASCII-dash texture. It is gorgeous large and it is the
// brand's actual character; the whole question is whether it survives the topbar, where the mark is
// 30px tall (24px under the <=1480px media query). This renders each candidate at a ladder of
// heights, at TRUE SIZE, so the answer is looked at rather than argued.
//
//   node dev/logo-size-ladder.mjs --svg="label:path" [--svg=...] [--heights=24,30,40,56,80] [--dpr=2]
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
  return i > 1 ? { label: spec.slice(0, i), path: spec.slice(i + 1) } : { label: 'mark', path: spec };
});
const HEIGHTS = opt('heights', '24,30,40,56,80').split(',').map(Number);
const DPR = Number(opt('dpr', 2));
const PH = opt('ph', '#ffaa33');
const BG = opt('bg', '#030201');
const OUT_DIR = opt('out', join(REPO, 'logo-ladder'));
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9403);

const rows = SVGS.map(s => ({ label: s.label, svg: readFileSync(s.path, 'utf8'), bytes: readFileSync(s.path).length }));

const page = `<!doctype html><meta charset="utf-8"><title>ladder</title>
<style>
 body{margin:0;padding:20px 24px;background:#07090b;color:#cfd8dc;font:12px/1.4 ui-monospace,Consolas,monospace}
 h1{font-size:14px;letter-spacing:2px;margin:0 0 4px;color:#eceff1}
 .sub{color:#7d8a91;margin:0 0 18px}
 .grp{margin-bottom:22px;border:1px solid #1c2429;border-radius:6px;overflow:hidden}
 .grp>h2{font-size:11px;letter-spacing:2px;margin:0;padding:7px 12px;background:#10161a;color:#90a4ae;border-bottom:1px solid #1c2429}
 .bar{display:flex;align-items:center;gap:14px;padding:9px 12px;border-bottom:1px solid #12181c;background:${BG}}
 .bar:last-child{border-bottom:0}
 .h{font-size:10px;letter-spacing:1px;color:#607d8b;width:74px;flex:0 0 auto}
 .bar svg{display:block;width:auto;color:${PH}}
</style>
<h1>WORDMARK SIZE LADDER — true size, DPR ${DPR}</h1>
<p class="sub">Each row is the mark at the stated CSS height on the station background. 30px is the
 topbar; 24px is the topbar under the &lt;=1480px media query.</p>
<div id="root"></div>
<script>
const ROWS = ${JSON.stringify(rows)};
const HEIGHTS = ${JSON.stringify(HEIGHTS)};
const root = document.getElementById('root');
for (const r of ROWS) {
  const g = document.createElement('div'); g.className = 'grp';
  g.innerHTML = '<h2>' + r.label + '  (' + (r.bytes/1024).toFixed(1) + ' KB)</h2>';
  for (const h of HEIGHTS) {
    const b = document.createElement('div'); b.className = 'bar';
    b.innerHTML = '<span class="h">' + h + 'px</span>' + r.svg;
    const s = b.querySelector('svg'); s.style.height = h + 'px'; s.removeAttribute('height'); s.removeAttribute('width');
    g.appendChild(b);
  }
  root.appendChild(g);
}
document.body.dataset.ready = '1';
</script>`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'ladder-'));
  const html = join(scratch, 'l.html');
  writeFileSync(html, page);
  let chrome = null, cdp = null;
  try {
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1300,1400', profileDir: join(scratch, 'chrome') });
    await sleep(1400);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Page.navigate', { url: pathToFileURL(html).href });
    let ok = false;
    for (let i = 0; i < 60; i++) {
      if (await evalJS(cdp, `document.body && document.body.dataset.ready === '1'`)) { ok = true; break; }
      await sleep(200);
    }
    if (!ok) throw new Error('ladder page never signalled ready');
    const size = await evalJS(cdp, `({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(size.w), height: Math.ceil(size.h), deviceScaleFactor: DPR, mobile: false });
    await sleep(400);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    mkdirSync(OUT_DIR, { recursive: true });
    const out = join(OUT_DIR, `ladder-dpr${DPR}.png`);
    writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify({ out, heights: HEIGHTS, rows: rows.map(r => r.label) }, null, 2));
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try { if (chrome) chrome.proc.kill(); } catch {}
  }
}
main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
