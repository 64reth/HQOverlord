#!/usr/bin/env node
// dev/shellstep.mjs — THE ONE-TILE STEP between two side-by-side rooms.
//
// (2026-08-16, Andrew, a tight crop of one junction: "i am only talking about circumstances like
// this".) His saved station has r114 (x6..17, y11..16) sitting beside r129 (x18..35, y-1..17):
// their south edges differ by ONE TILE, so the hull steps down there. The left run's skirt stops at
// a hard vertical cut, a dark shaft opens beside it, and the lower run restarts with its own
// coursing — two slabs shoved together instead of one wall taking a step.
//
// Minimal repro: A x0..11 y0..10 beside B x12..25 y0..11. Rendered on MAGENTA, at 8x, and again
// with the step's chamfer dropped (SKYNET_DROP_CHAMFER='*') to test whether the 45° cut at a
// one-tile step is what opens the shaft.
//
//   node dev/shellstep.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8989';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9389);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const build = (dropChamfers) => {
    // the DEFAULT station is A; B is flush against its east face but reaches ONE TILE further
    // south — the r114|r129 relationship in Andrew's save, which is the whole point of this repro
    const st = WorldModel.create(WorldModel.defaultDoc());
    const d = st.doc(), a = d.order.map(i => d.rooms[i]).filter(Boolean).flatMap(r => r.rects || [])[0];
    const B = st.addRoom({ kind: 'hab', rects: [{ x1: a.x2 + 1, y1: a.y1, x2: a.x2 + 14, y2: a.y2 + 1 }] });
    const geo = st.projectGeometry();
    if (dropChamfers) geo.chamfers = [];
    const bk = StationBake.bake(geo);
    const o = mk(bk.W, bk.H); o.g.fillStyle = '#ff00ff'; o.g.fillRect(0, 0, bk.W, bk.H);
    StationBake.drawBase(o.g, bk, 0, 0); StationBake.drawLight(o.g, bk, 0, 0);
    return { c: o.c, geo, bk, B };
  };
  const shot = (r, Z) => {
    // the step: A's SE corner, where B's floor hangs one tile lower
    // A is the left/shallower rect — pick it by geometry, not by id (addRoom's return shape varies)
    // BAKE-LOCAL px is simply geoTile * TILE. geo.origin is the WORLD tile of the geometry frame,
    // NOT the bake's offset; adding it lands you 3 tiles past the corner. (No backticks in here —
    // this whole probe is a template literal.)
    const T = r.geo.TILE, ra = r.geo.allRects.slice().sort((p, q) => p.x1 - q.x1)[0];
    const cx = (ra.x2 + 1) * T, cy = (ra.y2 + 1) * T;
    const w = 84, h = 84, x0 = Math.max(0, cx - 36), y0 = Math.max(0, cy - 28);
    const o = mk(w * Z, h * Z); o.g.drawImage(r.c, x0, y0, w, h, 0, 0, w * Z, h * Z);
    return o.c.toDataURL('image/png').split(',')[1];
  };
  const withCh = build(false), noCh = build(true);
  return JSON.stringify({
    chamfers: withCh.geo.chamfers, TILE: withCh.geo.TILE, origin: withCh.geo.origin,
    rects: withCh.geo.allRects.map(r => ({ z: r.z, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 })),
    crops: {
      step: shot(withCh, 10), 'step-nochamfer': shot(noCh, 10),
      whole: withCh.c.toDataURL('image/png').split(',')[1]
    }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellstep-'));
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
  console.error('shellstep: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SEAM_DIR || join(process.cwd(), '.shellstep');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
