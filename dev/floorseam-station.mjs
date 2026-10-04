#!/usr/bin/env node
// dev/floorseam-station.mjs — the seam law rendered on ANDREW'S OWN STATION geometry.
//
// The shape that broke the first cut of the law (his save, 2026-08-05):
//     r1 HAB       x0..17, y0..10
//     r8 CORRIDOR  x3..4,  y11..18     <- flush against r9, so the seam under r1 is ONE 14-tile run
//     r9 HAB       x5..16, y11..18
// Bakes it offscreen through the shipped StationBake and crops the seam he circled, wide.
//
//   node dev/floorseam-station.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8959';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9359);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const st = WorldModel.create(WorldModel.defaultDoc());
  const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 20, x2: 37, y2: 30 }] });
  const C = st.placeHallway({ rects: [{ x1: 23, y1: 31, x2: 24, y2: 38 }] });
  const B = st.addRoom({ kind: 'hab', rects: [{ x1: 25, y1: 31, x2: 36, y2: 38 }] });
  const geo = st.projectGeometry(), T = geo.TILE, bk = StationBake.bake(geo);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const lit = mk(bk.W, bk.H); lit.g.fillStyle = '#ff00ff'; lit.g.fillRect(0, 0, bk.W, bk.H);
  lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
  const crop = (cx, cy, cw, ch, z) => { const o = mk(cw * z, ch * z); o.g.drawImage(lit.c, cx, cy, cw, ch, 0, 0, cw * z, ch * z); return o.c.toDataURL('image/png').split(',')[1]; };

  const ra = geo.allRects.find(r => r.z === A.id), rb = geo.allRects.find(r => r.z === B.id);
  const sy = rb.y1 * T;                                  // the seam row he circled
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const g = lit.g, x0 = ra.x1 * T + 6 * T, w = 8 * T, y0 = sy - 3 * T, h = 6 * T;
  const d = g.getImageData(x0, y0, w, h).data, prof = [];
  for (let r = 0; r < h; r++) { let s = 0; for (let c = 0; c < w; c++) s += L(d, ((r * w) + c) * 4); prof.push(+(s / w).toFixed(2)); }

  return JSON.stringify({
    rows_across_seam: prof.join(','),
    crops: {
      station: crop(ra.x1 * T - 20, ra.y1 * T - 20, (ra.x2 - ra.x1 + 1) * T + 40, (rb.y2 - ra.y1 + 1) * T + 48, 3),
      seam:    crop(ra.x1 * T - 8, sy - 30, (ra.x2 - ra.x1 + 1) * T + 16, 60, 6),
    }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'seamstation-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
await waitUp(URL);
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) {
  console.error('floorseam-station: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SEAM_DIR || join(process.cwd(), '.seamstation');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
