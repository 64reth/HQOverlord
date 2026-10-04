/* dev/rug-sheet.mjs — RENDER SHEET for the rug candidates (taste dial: show renders, then decide).
 *
 * Drives the already-running dev server over CDP and draws each rug variant into a scratch canvas at
 * 6x nearest-neighbour, on the station's own deck colour, so the choice is made on pixels rather than
 * on a description. Writes .rugbed-shots/rug-sheet.png.
 *
 * node dev/rug-sheet.mjs           (env: RUG_SHEET_URL, SKYNET_CDP_PORT)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';

const URL = process.env.RUG_SHEET_URL || 'http://127.0.0.1:8791/';
const IDS = (process.env.RUG_IDS || 'rug').split(',');   // any F.* prop id — candidates need not be in the CATALOG
const cdpPort = Number(process.env.SKYNET_CDP_PORT || 9351);
const OUT = join(process.cwd(), '.rugbed-shots');
mkdirSync(OUT, { recursive: true });

const { proc } = launchChrome({ cdpPort, win: '1440,900', profileDir: join(OUT, '_sheet-profile') });
let cdp;
try {
  cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 120);',
  });
  await cdp.send('Page.navigate', { url: URL });
  await sleep(9000);

  const data = await evalJS(cdp, `(() => {
    const T = PropSprites.TILE, Z = 6;
    const ids = (${JSON.stringify(IDS)});
    /* each rug gets a cell at ITS OWN footprint. The sheet used to hardcode 4x3, which silently drew a
       3x3 or a 5x5 rug at the wrong extents — i.e. it lied about the exact thing it exists to show. */
    const spec = id => { const r = PropSprites.CATALOG.find(c => c.id === id); return { w: (r && r.w) || 4, h: (r && r.h) || 3 }; };
    const cells = ids.map(id => { const s = spec(id); return { id: id, w: s.w * T + 6, h: s.h * T + 8, label: id + '  ' + s.w + 'x' + s.h }; });
    const maxH = Math.max.apply(null, cells.map(c => c.h));
    const src = document.createElement('canvas');
    const out = document.createElement('canvas');
    out.width = cells.reduce((a, c) => a + c.w * Z + 20, 20);
    out.height = maxH * Z + 54;
    const octx = out.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.fillStyle = '#0e1114'; octx.fillRect(0, 0, out.width, out.height);
    let dx = 20;
    cells.forEach(cell => {
      src.width = cell.w; src.height = cell.h;
      const sctx = src.getContext('2d');
      sctx.fillStyle = '#2a2622'; sctx.fillRect(0, 0, cell.w, cell.h);       // the deck it has to read against
      sctx.fillStyle = '#242019';
      for (let gy = 0; gy < cell.h; gy += T) for (let gx = 0; gx < cell.w; gx += T) sctx.fillRect(gx, gy, T - 1, 1);
      PropSprites.setCtx(sctx); PropSprites.setNow(2400);
      PropSprites.draw({ t: cell.id, x: 3 / T, y: 4 / T, w: (cell.w - 6) / T, h: (cell.h - 8) / T, id: 'sheet' }, false);
      octx.drawImage(src, 0, 0, cell.w, cell.h, dx, 34, cell.w * Z, cell.h * Z);
      octx.fillStyle = '#e8c860'; octx.font = '20px "VT323","Courier New",monospace';
      octx.fillText(cell.label, dx, 24);
      dx += cell.w * Z + 20;
    });
    return out.toDataURL('image/png');
  })()`);
  if (!data || !String(data).startsWith('data:image/png')) throw new Error('no sheet: ' + String(data).slice(0, 200));
  writeFileSync(join(OUT, 'rug-sheet.png'), Buffer.from(String(data).split(',')[1], 'base64'));
  console.log('wrote', join(OUT, 'rug-sheet.png'));
} finally {
  try { if (cdp) cdp.close && cdp.close(); } catch {}
  try { proc.kill(); } catch {}
}
