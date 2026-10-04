#!/usr/bin/env node
// dev/wallprobe.mjs — measure the CROWN RING in a real browser bake.
//
// The world canvas is drawn at a fractional uiZoom, so measuring a screenshot measures a
// RESAMPLE, not the art (the "never judge pixel art at a non-integer scale" law). This bakes a
// station offscreen at 1:1 through the shipped StationBake and reads pixels back, so every number
// below is the actual baked+lit tone the player sees.
//
// Composites over MAGENTA on purpose: anything painted outside the hull is invisible against a
// dark void fill and only shows against the real starfield, so the leak check counts non-magenta
// pixels beyond the silhouette instead of eyeballing them.
//
//   node dev/wallprobe.mjs            # boots its own sidecar + chrome
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8952';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9352);
const URL = `http://127.0.0.1:${PORT}/`;

const MULTI = process.env.SKYNET_PROBE_MULTI === '1';

const PROBE = `(() => {
  const st = WorldModel.create(WorldModel.defaultDoc());
  /* MULTI-ROOM: rooms STACKED VERTICALLY on purpose. A single-room station can never make two
     chamfers share a bake COLUMN, and any per-column bookkeeping that is keyed globally instead of
     per-corner only misbehaves when they do — which is why the one-room leak check read 0 while the
     real station leaked. Any future corner work must be leak-checked on this shape, not the seed. */
  if (${MULTI}) {
    st.addRoom({ kind: 'lab',     rects: [{ x1: 2,  y1: 14, x2: 15, y2: 24 }] });
    st.addRoom({ kind: 'bridge',  rects: [{ x1: 21, y1: 0,  x2: 34, y2: 9  }] });
    st.addRoom({ kind: 'foundry', rects: [{ x1: 20, y1: 15, x2: 33, y2: 26 }] });
    st.placeHallway({ rects: [{ x1: 8,  y1: 11, x2: 10, y2: 13 }] });
    st.placeHallway({ rects: [{ x1: 18, y1: 4,  x2: 20, y2: 6  }] });
    st.placeHallway({ rects: [{ x1: 16, y1: 19, x2: 19, y2: 21 }] });
    /* THE SHAPE ANDREW REPORTED (2026-07-28): a VERTICAL hallway running between a room above
       and a room below, void to its east and west. Its long e/w runs are the only walls it has —
       both ends butt into a room — so this is the one corridor whose side walls carry the whole
       read, and the only seed shape that can prove a hallway "has walls". */
    st.placeHallway({ rects: [{ x1: 24, y1: 10, x2: 26, y2: 14 }] });
  }
  const geo = st.projectGeometry();
  const bk = StationBake.bake(geo);
  const W = bk.W, H = bk.H, T = geo.TILE;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  g.fillStyle = '#ff00ff'; g.fillRect(0, 0, W, H);
  g.drawImage(bk.baseCv, 0, 0); g.drawImage(bk.lightCv, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  const lum = (x, y) => { const i = ((y * W + x) << 2); return Math.round(0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2]); };
  const isMagenta = (x, y) => { const i = ((y * W + x) << 2); return px[i] > 200 && px[i+1] < 60 && px[i+2] > 200; };

  // the one room in a fresh station, in bake-pixel coords (origin-relative)
  const r = geo.allRects[0];
  const x1 = r.x1 * T, y1 = r.y1 * T, x2 = (r.x2 + 1) * T, y2 = (r.y2 + 1) * T;
  const midY = ((y1 + y2) / 2) | 0, midX = ((x1 + x2) / 2) | 0;

  const scanH = (y, a, b) => { const o = []; for (let x = a; x <= b; x++) o.push(lum(x, y)); return o; };
  const scanV = (x, a, b) => { const o = []; for (let y = a; y <= b; y++) o.push(lum(x, y)); return o; };

  // LEAK CHECK — the decisive per-layer test: ambient mask lying over pixels the art never painted.
  const bg = bk.baseCv.getContext('2d').getImageData(0, 0, W, H).data;
  const lg = bk.lightCv.getContext('2d').getImageData(0, 0, W, H).data;
  let leak = 0;
  for (let i = 3; i < bg.length; i += 4) if (bg[i] === 0 && lg[i] > 0) leak++;

  // CROWN CONTINUITY — for each side, the brightest PAINTED pixel in the wall band, sampled along
  // the run. A ring is continuous when no sample position comes back dark. Magenta is void, not a
  // reading: without excluding it the void scores 105 and every gap in the ring looks like a peak.
  // The north band has to reach past WALL.up — its crown is extruded up-screen, the others are not.
  const bestAlong = (fixedFrom, fixedTo, band, sample) => {
    const o = [];
    for (let t = fixedFrom; t <= fixedTo; t += 4) {
      let m = 0;
      for (let d = 1; d <= band; d++) { const v = sample(t, d); if (v != null) m = Math.max(m, v); }
      o.push(m);
    }
    return o;
  };
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H || isMagenta(x, y)) ? null : lum(x, y);
  const nBand = 22, sBand = 9;
  const north = bestAlong(x1 + 16, x2 - 17, nBand, (x, d) => at(x, y1 - d));
  const south = bestAlong(x1 + 16, x2 - 17, sBand, (x, d) => at(x, y2 + d - 1));
  const west  = bestAlong(y1 + 16, y2 - 17, sBand, (y, d) => at(x1 - d, y));
  const east  = bestAlong(y1 + 16, y2 - 17, sBand, (y, d) => at(x2 + d - 1, y));
  const stat = a => ({ min: Math.min(...a), max: Math.max(...a), avg: Math.round(a.reduce((s,v)=>s+v,0)/a.length) });

  // CORNER RING — walk each chamfer's arc and report the brightest PAINTED pixel just outside the
  // deck curve at each step. This is the measurement that says whether the crown turns the corner.
  const arcOf = (kindWanted) => {
    const cor = geo.chamfers.find(c => c[2] === kindWanted);
    if (!cor) return null;
    const sx = kindWanted[1] === 'l' ? 1 : 0, sy = kindWanted[0] === 't' ? 1 : 0;
    const ax = (cor[0] + sx) * T, ay = (cor[1] + sy) * T;
    const a0 = { tl: Math.PI, tr: 1.5 * Math.PI, bl: 0.5 * Math.PI, br: 0 }[kindWanted];
    const o = [];
    for (let s = 0; s <= 18; s++) {
      const th = a0 + (s / 18) * (Math.PI / 2);
      let m = 0;
      for (let d = 0; d <= 20; d++) {
        const v = at(Math.round(ax + Math.cos(th) * (T + d)), Math.round(ay + Math.sin(th) * (T + d)));
        if (v != null) m = Math.max(m, v);
      }
      o.push(m);
    }
    return o;
  };

  // 1:1 CROPS written to disk by the caller — the only honest way to LOOK at a bake (the game
  // canvas draws at a fractional uiZoom, and a non-integer scale invents artifacts that are not
  // in the art). Nearest-neighbour upscale only.
  /* A BARE composite — baseCv with NO light map. The corners live at the darkest end of the room,
     where the ambient mask crushes the ring into the hull skirt beside it and geometry becomes
     impossible to judge by eye. Every SHAPE question is answered here; every TONE question needs
     the lit composite above. Judging the bottom corners on the lit view cost a whole round. */
  const bare = document.createElement('canvas'); bare.width = W; bare.height = H;
  const gb = bare.getContext('2d'); gb.imageSmoothingEnabled = false;
  gb.fillStyle = '#ff00ff'; gb.fillRect(0, 0, W, H); gb.drawImage(bk.baseCv, 0, 0);
  const cropBare = (cx, cy, cw, ch, z) => {
    const c2 = document.createElement('canvas'); c2.width = cw * z; c2.height = ch * z;
    const g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = false;
    g2.drawImage(bare, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
    return c2.toDataURL('image/png').split(',')[1];
  };

  const crop = (cx, cy, cw, ch, z) => {
    const c2 = document.createElement('canvas'); c2.width = cw * z; c2.height = ch * z;
    const g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = false;
    g2.fillStyle = '#05060c'; g2.fillRect(0, 0, cw * z, ch * z);
    g2.drawImage(cv, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
    return c2.toDataURL('image/png').split(',')[1];
  };

  /* THE ACCEPTANCE TEST for the crown cut: the DIMMEST crown pixel anywhere on the ring must beat
     the BRIGHTEST hull-skirt pixel. The skirt hangs outside the ambient plate at flat raw tones, so
     it is the thing the wall has to out-shine, and the corners are where the two meet. */
  /* THE JOIN TEST — for every column across the bottom-left corner and into the south straight,
     which row carries the crown's LIT edge. A clean join is a flat run of one number: any step is
     the ring and the straight disagreeing about where the wall's outer edge is. */
  const litRow = [];
  for (let x = x1 - 2; x < x1 + 46; x++) {
    let best = -1, bestY = -1;
    for (let y = y2 - 4; y < y2 + 12; y++) { const v = at(x, y); if (v != null && v > best) { best = v; bestY = y; } }
    litRow.push(bestY < 0 ? -99 : bestY - y2);
  }
  let skirtMax = 0;
  for (let y = y2 + 6; y < Math.min(H, y2 + 44); y++)
    for (let x = x1 + 60; x < x2 - 60; x++) { const v = at(x, y); if (v != null && v > skirtMax) skirtMax = v; }

  /* ---------- CORRIDOR COVERAGE ----------
     Everything above measures geo.allRects[0] — the first ROOM. A hallway could have no wall at all
     and every number would still read green, which is exactly how corridors missed the crown-ring
     fix. These point the same instruments at the VERTICAL hallway, and the comparison that matters
     is corridor-vs-room on the SAME instrument: the report is not "the corridor is dark", it is
     "the corridor has no wall where the room beside it plainly does". */
  const corrRects = geo.allRects.filter(r => geo.isCorridor(r.z));
  const vert = corrRects.find(r => (r.y2 - r.y1) > (r.x2 - r.x1)) || corrRects[0] || null;
  const corrCrops = {};
  let corridor = null;
  if (vert) {
    const cx1 = vert.x1 * T, cy1 = vert.y1 * T, cx2 = (vert.x2 + 1) * T, cy2 = (vert.y2 + 1) * T;
    const cMidY = ((cy1 + cy2) / 2) | 0;
    const cw = bestAlong(cy1 + 6, cy2 - 7, sBand, (y, d) => at(cx1 - d, y));
    const ce = bestAlong(cy1 + 6, cy2 - 7, sBand, (y, d) => at(cx2 + d - 1, y));
    corridor = {
      rect: [cx1, cy1, cx2, cy2],
      // straight across the hallway at its waist: void · west wall · deck · east wall · void
      acrossScan: scanH(cMidY, cx1 - 20, cx2 + 20),
      ring: { west: stat(cw), east: stat(ce) }
    };
    corrCrops.corr = crop(cx1 - 26, cy1 - 8, (cx2 - cx1) + 52, (cy2 - cy1) + 16, 9);
    corrCrops.corrBare = cropBare(cx1 - 26, cy1 - 8, (cx2 - cx1) + 52, (cy2 - cy1) + 16, 9);
  }
  /* the corridor whose NORTH end is EXTERIOR — the only place a hallway's north face is drawn at
     all, and the branch that took bakeTallNorthFace's legacy up===0 path (which paints no crown).
     Picked by asking the zone grid, not by index: a corridor whose north neighbour is another zone
     draws an interior seam and proves nothing about the wall. */
  const voidAbove = r => {
    for (let tx = r.x1; tx <= r.x2; tx++) if (geo.zoneGrid[geo.idx(tx, r.y1 - 1)]) return false;
    return true;
  };
  const stub = corrRects.find(r => r !== vert && voidAbove(r)) || corrRects.find(voidAbove) || null;
  let corrNorth = null;
  if (stub) {
    const sx1 = stub.x1 * T, sy1 = stub.y1 * T, sx2 = (stub.x2 + 1) * T;
    corrNorth = { rect: [sx1, sy1, sx2], scan: scanV(((sx1 + sx2) / 2) | 0, sy1 - 24, sy1 + 14) };
    corrCrops.corrN = crop(sx1 - 22, sy1 - 28, (sx2 - sx1) + 44, 56, 9);
  }
  // every corridor and whether its north end is exposed — so a null/blind reading is visible as
  // "no corridor qualifies", never as a silent pass.
  const corrAll = corrRects.map(r => ({ t: [r.x1, r.y1, r.x2, r.y2], nVoid: voidAbove(r) }));

  return JSON.stringify({
    W, H, T, room: [x1, y1, x2, y2], leak, skirtMax, litRow, corridor, corrNorth, corrAll,
    westScan: scanH(midY, x1 - 20, x1 + 12),
    eastScan: scanH(midY, x2 - 12, x2 + 20),
    northScan: scanV(midX, y1 - 24, y1 + 14),
    southScan: scanV(midX, y2 - 14, y2 + 20),
    ring: { north: stat(north), south: stat(south), west: stat(west), east: stat(east) },
    arcTL: arcOf('tl'), arcTR: arcOf('tr'), arcBL: arcOf('bl'), arcBR: arcOf('br'),
    crops: {
      tl: crop(x1 - 16, y1 - 26, 46, 46, 11),
      bl: crop(x1 - 16, y2 - 20, 46, 46, 11),
      br: crop(x2 - 30, y2 - 20, 46, 46, 11),
      blBare: cropBare(x1 - 12, y2 - 22, 38, 38, 14),
      tlBare: cropBare(x1 - 12, y1 - 26, 38, 38, 14),
      whole: crop(0, 0, W, H, 3),
      ...corrCrops
    }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'wallprobe-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
await waitUp(URL);
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
/* waitDevReady RETURNS false ON TIMEOUT — it does not throw. Ignoring it is how this probe
   "crashed" with `ReferenceError: WorldModel is not defined`: the page simply had not finished
   loading and the eval ran against a bare document. Fail loudly instead of blaming scoping. */
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) {
  console.error('wallprobe: dev harness never became ready (WorldModel/StationBake not on the page) — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const out = await evalJS(cdp, PROBE);
const data = JSON.parse(typeof out === 'string' ? out : JSON.stringify(out));
const dir = process.env.SKYNET_PROBE_DIR || join(process.cwd(), '.wallprobe');
mkdirSync(dir, { recursive: true });
for (const [name, b64] of Object.entries(data.crops || {})) writeFileSync(join(dir, name + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
