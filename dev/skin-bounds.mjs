#!/usr/bin/env node
/* dev/skin-bounds.mjs — measure the REAL drawn character bounds inside every skin's 92x92 rot_south
   master. The dossier portrait scales the character to fill an 84x112 frame; whether that is an
   upscale (and by how much) decides whether smoothing or nearest-neighbour is correct. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9688';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9689);
const URL = `http://127.0.0.1:${PORT}/`;

const SCAN = `(async () => {
  const skins = DATA.SKINS || {};
  const rows = [];
  for (const id of Object.keys(skins)) {
    const set = skins[id].set;
    const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'assets/sprites/' + set + '/rot_south.png'; });
    if (!img) { rows.push({ id, set, err: 'load failed' }); continue; }
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0, any = false;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      if (d[(y * c.width + x) * 4 + 3] > 16) { any = true; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
    rows.push({ id, set, sheet: c.width + 'x' + c.height, scale: skins[id].scale,
      charW: any ? maxX-minX+1 : 0, charH: any ? maxY-minY+1 : 0 });
  }
  return rows;
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'skinb-'));
  const ws = join(scratch, 'ws');
  materializeSeedWorkspace(ws);
  const side = bootSeededSidecar({ port: PORT, scratchDir: ws });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up');
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1400,900', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('never reached game');
    await sleep(2000);
    const rows = await evalJS(cdp, SCAN);
    if (!Array.isArray(rows)) { console.log(JSON.stringify(rows)); return; }
    const hs = rows.filter(r => r.charH).map(r => r.charH).sort((a, b) => a - b);
    console.log('SKINS:', rows.length);
    console.log(rows.map(r => `${String(r.id).padEnd(14)} sheet=${r.sheet} char=${r.charW}x${r.charH} scale=${r.scale}`).join('\n'));
    console.log('\ncharH min/med/max:', hs[0], hs[Math.floor(hs.length / 2)], hs[hs.length - 1]);
    // the dossier frame is 84x112 with pad 8/8/6 → usable 68x98
    console.log('fit factor to 98px tall (k = 98/charH):', JSON.stringify(rows.filter(r => r.charH).map(r => +(98 / r.charH).toFixed(2))));
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
    setTimeout(() => process.exit(0), 400);
  }
}
main().catch(e => { console.error('SCAN FAILED:', e.message); process.exit(1); });
