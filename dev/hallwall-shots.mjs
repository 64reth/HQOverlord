#!/usr/bin/env node
// dev/hallwall-shots.mjs — do a HALLWAY's walls stand at the same height as a ROOM's, and what
// happens to the corner where the two meet?
//
// The discriminator this exists to settle first: is the defect a REGRESSION from the 08-08 wall
// lane (WALL.up 14->22, corUp 8->12, capH 3->4, SHAPE.cornerN 1) or was it always there and merely
// made visible? So every junction renders at BOTH the pre-08-08 values and the shipped ones, same
// geometry, same crop, side by side. Anything that is broken in the LEFT panel too is not mine.
//
//   node dev/hallwall-shots.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8979';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9379);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake;
  const SHIPPED = { wall: { ...SB.WALL }, light: { ...SB.LIGHT }, shape: { ...SB.SHAPE } };
  const OLD = { wall: { up: 14, corUp: 8, capH: 3 }, shape: { cornerN: 2 } };

  /* Four junctions, each the shape a user actually builds:
       A  hallway hanging DOWN off a room's south wall  (the screenshot's shape)
       B  hallway running along a room's flank, flush    (an open join on the long side)
       C  hallway BRIDGING two rooms
       D  hallway meeting a room at its corner           (where the chamfer and the hall collide) */
  /* OFFSET CLEAR OF THE DEFAULT STATION, AND ASSERT EVERY PLACEMENT. defaultDoc() already contains
     a room at roughly x0..17 / y0..10. Building a case on top of it makes addRoom fail with OVERLAP
     and return a falsy result - and because the DEFAULT room still bakes, the probe hands back a
     perfectly plausible picture of a room that is not the one under test. That is how the first run
     of this file produced four panels showing the same untouched default station. Nothing threw. */
  const OX = 40, OY = 40;
  const put = (st, kind, x1, y1, x2, y2) => {
    const rects = [{ x1: x1 + OX, y1: y1 + OY, x2: x2 + OX, y2: y2 + OY }];
    const res = kind === 'corridor' ? st.placeHallway({ rects }) : st.addRoom({ kind, rects });
    if (!res || !res.id) throw new Error('placement REJECTED: ' + kind + ' ' + JSON.stringify(rects[0]) + ' -> ' + JSON.stringify(res));
    return res;
  };
  const box = (x1, y1, x2, y2) => ({ x1: x1 + OX, y1: y1 + OY, x2: x2 + OX, y2: y2 + OY });

  /* HALLWAY MEETING HALLWAY — the actual reported case. Andrew: "its only when u connect 2 hallways
     together". Every earlier case here was corridor-to-ROOM, which is why they all looked fine and
     told me nothing: a corridor's walls are only ever reconciled against a room's, never against
     another corridor's. These are the four ways two hallways can join. */
  const CASES = {
    L_corner: (st) => {                       // one comes down, one goes right - the screenshot
      put(st, 'corridor', 6, 0, 7, 9);
      put(st, 'corridor', 8, 8, 18, 9);
      return box(0, 0, 18, 9);
    },
    T_junction: (st) => {
      put(st, 'corridor', 0, 8, 18, 9);
      put(st, 'corridor', 8, 10, 9, 18);
      return box(0, 8, 18, 18);
    },
    inline_end_to_end: (st) => {              // two hallways continuing in a straight line
      put(st, 'corridor', 0, 8, 9, 9);
      put(st, 'corridor', 10, 8, 19, 9);
      return box(0, 8, 19, 9);
    },
    L_corner_into_rooms: (st) => {            // the same L, but load-bearing between two rooms
      put(st, 'hab', 0, 0, 5, 6);
      put(st, 'corridor', 6, 0, 7, 9);
      put(st, 'corridor', 8, 8, 15, 9);
      put(st, 'hab', 16, 4, 24, 12);
      return box(0, 0, 24, 12);
    },
  };

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const apply = (cfg) => {
    Object.assign(SB.WALL, SHIPPED.wall, cfg.wall || {});
    Object.assign(SB.LIGHT, SHIPPED.light, cfg.light || {});
    Object.assign(SB.SHAPE, SHIPPED.shape, cfg.shape || {});
  };
  const bakeCase = (fn, cfg) => {
    apply(cfg);
    const st = WorldModel.create(WorldModel.defaultDoc());
    const box = fn(st);
    const geo = st.projectGeometry(), T = geo.TILE, bk = SB.bake(geo);
    const lit = mk(bk.W, bk.H);
    /* MAGENTA UNDERNEATH, ALWAYS. A hole in the hull and a dark pixel look the same over black, and
       the station is nearly all dark pixels - the first read of these crops had me about to report
       "missing hull" from what turned out to be a fine dither pattern in the skirt. Over #ff00ff a
       gap is unmistakable and a texture is obviously a texture. */
    lit.g.fillStyle = '#ff00ff'; lit.g.fillRect(0, 0, bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    /* CENTRE THE CROP ON WHERE THE TWO CORRIDORS MEET — the shared corner, not a room boundary.
       Take the two corridor rects that touch and use the corner of their overlap. */
    let jrect = null;
    const cor = geo.allRects.filter(r => geo.isCorridor(r.z));
    for (let i = 0; i < cor.length && !jrect; i++) for (let j = i + 1; j < cor.length && !jrect; j++) {
      const a = cor[i], b = cor[j];
      const xo = Math.max(a.x1, b.x1) <= Math.min(a.x2, b.x2) + 1;
      const yo = Math.max(a.y1, b.y1) <= Math.min(a.y2, b.y2) + 1;
      if (!xo || !yo) continue;
      jrect = { cx: (Math.max(a.x1, b.x1) + Math.min(a.x2, b.x2) + 1) / 2,
                cy: (Math.max(a.y1, b.y1) + Math.min(a.y2, b.y2) + 1) / 2 };
    }
    return { lit, T, box, W: bk.W, H: bk.H, jrect };
  };

  const label = (g, txt, x, y, w) => {
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(x, y, w, 20);
    g.fillStyle = '#ffcf70'; g.font = '15px VT323, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(txt, x + w / 2, y + 10);
  };

  const crops = {}, heights = {};
  for (const [name, fn] of Object.entries(CASES)) {
    const oldB = bakeCase(fn, OLD), newB = bakeCase(fn, {});
    const T = newB.T, b = newB.box;
    const sx = Math.max(0, b.x1 * T - 40), sy = Math.max(0, b.y1 * T - 56);
    const sw = Math.min(newB.W - sx, (b.x2 - b.x1 + 1) * T + 80);
    const sh = Math.min(newB.H - sy, (b.y2 - b.y1 + 1) * T + 110);
    const Z = Math.max(2, Math.min(5, Math.round(760 / sw)));
    const sheet = mk(sw * Z * 2, sh * Z + 20);
    sheet.g.fillStyle = '#07090b'; sheet.g.fillRect(0, 0, sheet.c.width, sheet.c.height);
    sheet.g.imageSmoothingEnabled = false;
    sheet.g.drawImage(oldB.lit.c, sx, sy, sw, sh, 0, 20, sw * Z, sh * Z);
    sheet.g.drawImage(newB.lit.c, sx, sy, sw, sh, sw * Z, 20, sw * Z, sh * Z);
    label(sheet.g, 'BEFORE 08-08  (up14 / corUp8 / fillet)', 0, 0, sw * Z);
    label(sheet.g, 'NOW  (up22 / corUp12 / chamfer)', sw * Z, 0, sw * Z);
    crops[name] = sheet.c.toDataURL('image/png').split(',')[1];

    /* AND THE JUNCTION ITSELF, TIGHT. The wide panel shows that a hallway reads differently from a
       room; only a close crop shows WHY, and the corner where the two meet is a handful of pixels
       that the wide shot averages away entirely. Centred on the corridor's own corner-most tile. */
    const jr = newB.jrect;
    if (jr) {
      const jx = jr.cx * T - 34, jy = jr.cy * T - 34, JZ = 8;
      const jw = 68, jh = 68;
      const js = mk(jw * JZ * 2, jh * JZ + 20);
      js.g.fillStyle = '#07090b'; js.g.fillRect(0, 0, js.c.width, js.c.height);
      js.g.imageSmoothingEnabled = false;
      js.g.drawImage(oldB.lit.c, jx, jy, jw, jh, 0, 20, jw * JZ, jh * JZ);
      js.g.drawImage(newB.lit.c, jx, jy, jw, jh, jw * JZ, 20, jw * JZ, jh * JZ);
      label(js.g, 'BEFORE 08-08', 0, 0, jw * JZ);
      label(js.g, 'NOW', jw * JZ, 0, jw * JZ);
      crops['JUNCTION_' + name] = js.c.toDataURL('image/png').split(',')[1];
    }
  }

  /* MEASURE THE HEIGHTS RATHER THAN EYEBALLING THEM. For case A, walk UP from the room's north
     floor seam and from the hallway's north floor seam and report the first row that is not void,
     i.e. how tall each wall actually stands in bake pixels. */
  {
    apply({});
    const st = WorldModel.create(WorldModel.defaultDoc());
    put(st, 'hab', 0, 0, 15, 8);
    put(st, 'corridor', 6, 9, 7, 16);
    const geo = st.projectGeometry(), T = geo.TILE, bk = SB.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0);
    /* how tall each wall STANDS, in bake pixels: from the tile's floor seam, walk up while the
       pixel is opaque. Read the whole column in one getImageData - a per-pixel call per row is
       thousands of round-trips and was slow enough to look like a hang. */
    const riseAt = (tx, seamTileY) => {
      const x = tx * T + (T >> 1), y0 = seamTileY * T;
      if (x < 0 || x >= bk.W || y0 <= 0) return -1;
      const col = lit.g.getImageData(x, 0, 1, Math.min(y0, bk.H)).data;
      let up = 0;
      for (let y = Math.min(y0, bk.H) - 1; y >= 0; y--) { if (col[y * 4 + 3] < 8) break; up++; }
      return up;
    };
    const rr = geo.allRects.find(r => !geo.isCorridor(r.z)), cr = geo.allRects.find(r => geo.isCorridor(r.z));
    heights.room_rect = rr && [rr.x1, rr.y1, rr.x2, rr.y2];
    heights.hall_rect = cr && [cr.x1, cr.y1, cr.x2, cr.y2];
    heights.room_north_wall_px = rr ? riseAt(rr.x1 + 2, rr.y1) : -1;
    heights.hall_north_wall_px = cr ? riseAt(cr.x1, cr.y1) : -1;
    heights.WALL = { ...SB.WALL };
  }

  apply({});
  return JSON.stringify({ measured_rise: heights, crops });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'hallwall-'));
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
  console.error('hallwall: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_HALLWALL_DIR || join(process.cwd(), 'dev', '.shots-hallwall');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
