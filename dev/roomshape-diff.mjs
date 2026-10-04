#!/usr/bin/env node
// dev/roomshape-diff.mjs — WHERE does SHAPE.cornerN actually change pixels? Measure, don't squint.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8973';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9373);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake;
  const st = WorldModel.create(WorldModel.defaultDoc());
  const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 20, x2: 37, y2: 33 }] });
  const geo = st.projectGeometry(), T = geo.TILE;
  const ra = geo.allRects.find(r => r.z === A.id);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const shot = (n) => {
    SB.SHAPE.cornerN = n;
    const bk = SB.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    return { d: lit.g.getImageData(0, 0, bk.W, bk.H).data, W: bk.W, H: bk.H };
  };
  const a = shot(2), b = shot(1);
  SB.SHAPE.cornerN = 1;
  let diff = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < a.H; y++) for (let x = 0; x < a.W; x++) {
    const i = (y * a.W + x) * 4;
    if (a.d[i] !== b.d[i] || a.d[i+1] !== b.d[i+1] || a.d[i+2] !== b.d[i+2] || a.d[i+3] !== b.d[i+3]) {
      diff++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return JSON.stringify({
    chamfers: geo.chamfers, TILE: T, bakeWH: [a.W, a.H],
    roomTilesXY: [ra.x1, ra.y1, ra.x2, ra.y2],
    origin: geo.origin,
    diffPixels: diff, diffBox: diff ? [x0, y0, x1, y1] : null
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'rsdiff-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
await waitUp(URL);
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) { console.error('not ready'); try { proc.kill(); } catch {} try { side.kill(); } catch {} process.exit(2); }
console.log(await evalJS(cdp, PROBE));
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
