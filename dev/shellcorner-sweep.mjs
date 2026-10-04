#!/usr/bin/env node
// dev/shellcorner-sweep.mjs — every corner of a MULTI-ROOM station, before/after the shared corner
// profile, as one contact sheet.
//
// The lane that introduced SHAPE.cornerN closed with "corridors, stacked/multi-room layouts, and
// rooms narrower than one lamp pitch have not been swept by eye — and corner work is precisely the
// class that only misbehaves on a multi-room station". This is that sweep: a hab, a differently-clad
// neighbour, a corridor joining them, and a small room, baked at the shipped chamfer (cornerN 1) and
// at the legacy fillet (cornerN 2), with every chamfer tile cropped and labelled.
//
//   node dev/shellcorner-sweep.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8964';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9364);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const st = WorldModel.create(WorldModel.defaultDoc());
  const errs = [];
  const add = (r) => { if (r && r.error) errs.push(r.error); return r; };
  // a neighbour room, a corridor between them, and a small room off on its own
  add(st.addRoom({ kind: 'lab',    rects: [{ x1: 3,  y1: 18, x2: 14, y2: 27 }] }));
  add(st.placeHallway({ rects: [{ x1: 6, y1: 14, x2: 8, y2: 17 }] }));
  add(st.addRoom({ kind: 'bridge', rects: [{ x1: 26, y1: 18, x2: 33, y2: 24 }] }));

  const render = () => {
    const geo = st.projectGeometry();
    const bk = SB.bake(geo);
    const base = mk(bk.W, bk.H);
    base.g.fillStyle = '#ff00ff'; base.g.fillRect(0, 0, bk.W, bk.H);
    base.g.drawImage(bk.baseCv, 0, 0);           // BASE ONLY — the light pass would tint attribution
    return { geo, bk, base };
  };
  const cur = render();
  const oldN = SB.SHAPE.cornerN;
  SB.SHAPE.cornerN = 2;
  const n2 = render();
  SB.SHAPE.cornerN = oldN;

  const T = cur.geo.TILE, Z = 8, PAD = 3, LAB = 12;
  const corners = cur.geo.chamfers.map(c => ({ x: c[0], y: c[1], kind: c[2] }));
  // one column per corner, one row per variant
  const cw = T * 3 * Z, chh = T * 3 * Z;
  const sheet = mk(corners.length * (cw + PAD), LAB + 2 * (chh + PAD) + LAB);
  sheet.g.fillStyle = '#101014'; sheet.g.fillRect(0, 0, sheet.c.width, sheet.c.height);
  sheet.g.font = '10px monospace'; sheet.g.textBaseline = 'top';
  corners.forEach((c, i) => {
    const bx = (c.x - 1) * T, by = (c.y - 1) * T;
    const x0 = i * (cw + PAD);
    sheet.g.fillStyle = '#7fffd4'; sheet.g.fillText(c.kind + ' ' + c.x + ',' + c.y, x0 + 2, 1);
    sheet.g.drawImage(cur.base.c, bx, by, T * 3, T * 3, x0, LAB, cw, chh);
    sheet.g.fillStyle = '#ffcc66'; sheet.g.fillText('n=2 (legacy fillet)', x0 + 2, LAB + chh + PAD - LAB + 1);
    sheet.g.drawImage(n2.base.c, bx, by, T * 3, T * 3, x0, LAB + chh + PAD + LAB, cw, chh);
  });

  const full = mk(cur.bk.W, cur.bk.H);
  full.g.drawImage(cur.base.c, 0, 0);

  return JSON.stringify({
    tile: T, W: cur.bk.W, H: cur.bk.H, placement_errors: errs,
    corners, cornerN: SB.SHAPE.cornerN,
    crops: { CORNER_sweep: sheet.c.toDataURL('image/png').split(',')[1], STATION: full.c.toDataURL('image/png').split(',')[1] }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellsweep-'));
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
  console.error('shellsweep: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELLSWEEP_DIR || join(process.cwd(), 'dev', '.shots-shellsweep');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
