#!/usr/bin/env node
// dev/seamblend-station.mjs — the seam question on ANDREW'S OWN 8-ROOM STATION.
//
// Geometry read out of his save (the seeded test workspace he built in on 2026-08-08), NOT guessed
// from the screenshot — the lane law is that his data names the defect in one command while a
// picture leaves you estimating room widths.
//
//     r1 hab       x0..17,   y0..10        r3 hab      x-1..18, y-9..-3
//     r4 corridor  x3..4,    y-2..-1       r5 hab      x19..27, y-1..5
//     r6 hab       x-10..-2, y-1..5        r7 hab      x19..27, y9..15
//     r8 hab       x-10..-2, y9..15        r9 hab      x0..17,  y14..19
//
// Renders the whole station and prints, for every pair of rooms that COULD be adjacent, the exact
// tile gap between them plus a luma profile straight across each boundary.
//
//   node dev/seamblend-station.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8977';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9377);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const ROOMS = [
    ['r1','hab',      0,   0, 17, 10],
    ['r3','hab',     -1,  -9, 18, -3],
    ['r4','corridor',  3,  -2,  4, -1],
    ['r5','hab',      19, -1, 27,  5],
    ['r6','hab',     -10, -1, -2,  5],
    ['r7','hab',      19,  9, 27, 15],
    ['r8','hab',     -10,  9, -2, 15],
    ['r9','hab',       0, 14, 17, 19],
  ];
  const st = WorldModel.create(WorldModel.defaultDoc());
  const made = {};
  for (const [id, kind, x1, y1, x2, y2] of ROOMS) {
    const rect = [{ x1, y1, x2, y2 }];
    made[id] = kind === 'corridor' ? st.placeHallway({ rects: rect }) : st.addRoom({ kind, rects: rect });
  }
  const geo = st.projectGeometry(), T = geo.TILE;
  const bk = StationBake.bake(geo);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const lit = mk(bk.W, bk.H);
  lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const crop = (cx, cy, cw, ch, z) => {
    cx = Math.max(0, Math.round(cx)); cy = Math.max(0, Math.round(cy));
    cw = Math.min(bk.W - cx, Math.round(cw)); ch = Math.min(bk.H - cy, Math.round(ch));
    const o = mk(Math.round(cw * z), Math.round(ch * z));
    o.g.imageSmoothingEnabled = false;
    o.g.drawImage(lit.c, cx, cy, cw, ch, 0, 0, Math.round(cw * z), Math.round(ch * z));
    return o.c.toDataURL('image/png').split(',')[1];
  };

  /* WHERE THE ROOMS ACTUALLY ARE RELATIVE TO EACH OTHER. "They look like they should join" is the
     user's reading of the picture; whether the tiles TOUCH is a fact, and the two are not the same
     thing. A one-tile void column between two rooms is not a seam that failed to blend - it is two
     separate hulls with a gap, and it needs a completely different fix from a seam bug. */
  const gaps = [];
  for (let i = 0; i < ROOMS.length; i++) for (let j = i + 1; j < ROOMS.length; j++) {
    const [ai,, ax1, ay1, ax2, ay2] = ROOMS[i], [bi,, bx1, by1, bx2, by2] = ROOMS[j];
    const yOver = Math.min(ay2, by2) - Math.max(ay1, by1) + 1;
    const xOver = Math.min(ax2, bx2) - Math.max(ax1, bx1) + 1;
    if (yOver > 0) {
      const g = (bx1 > ax2) ? bx1 - ax2 - 1 : (ax1 > bx2) ? ax1 - bx2 - 1 : null;
      if (g != null && g <= 3) gaps.push({ pair: ai + '|' + bi, axis: 'vertical', tileGap: g, overlapTiles: yOver });
    }
    if (xOver > 0) {
      const g = (by1 > ay2) ? by1 - ay2 - 1 : (ay1 > by2) ? ay1 - by2 - 1 : null;
      if (g != null && g <= 3) gaps.push({ pair: ai + '|' + bi, axis: 'horizontal', tileGap: g, overlapTiles: xOver });
    }
  }

  // luma straight across each near-adjacency, averaged over the shared span
  const profiles = {};
  for (const gp of gaps) {
    const [a, b] = gp.pair.split('|');
    const A = ROOMS.find(r => r[0] === a), B = ROOMS.find(r => r[0] === b);
    if (gp.axis === 'vertical') {
      const lo = Math.max(A[3], B[3]), hi = Math.min(A[5], B[5]);
      const mid = Math.round((Math.max(A[4], B[4]) + Math.min(A[2], B[2])) / 2);
      const x0 = (Math.min(A[4], B[4]) === A[4] ? A[4] : B[4]);
      const from = Math.max(0, (Math.min(A[2], B[2]) - 3) * T), to = (Math.max(A[4], B[4]) + 4) * T;
      const yA = lo * T + 4, hh = (hi - lo + 1) * T - 8;
      if (to > from && hh > 0 && from >= 0 && to <= bk.W) {
        const d = lit.g.getImageData(from, yA, to - from, hh).data, prof = [];
        for (let c = 0; c < to - from; c++) { let s = 0; for (let r = 0; r < hh; r++) s += L(d, ((r * (to - from)) + c) * 4); prof.push(+(s / hh).toFixed(1)); }
        profiles[gp.pair + ' (cols ' + (from / T) + '..)'] = prof.join(',');
      }
    } else {
      const lo = Math.max(A[2], B[2]), hi = Math.min(A[4], B[4]);
      const from = Math.max(0, (Math.min(A[3], B[3]) - 3) * T), to = (Math.max(A[5], B[5]) + 4) * T;
      const xA = lo * T + 4, ww = (hi - lo + 1) * T - 8;
      if (to > from && ww > 0 && to <= bk.H) {
        const d = lit.g.getImageData(xA, from, ww, to - from).data, prof = [];
        for (let r = 0; r < to - from; r++) { let s = 0; for (let c = 0; c < ww; c++) s += L(d, ((r * ww) + c) * 4); prof.push(+(s / ww).toFixed(1)); }
        profiles[gp.pair + ' (rows ' + (from / T) + '..)'] = prof.join(',');
      }
    }
  }

  const crops = { station: crop(0, 0, bk.W, bk.H, 1) };
  // every near-adjacency, zoomed
  for (const gp of gaps) {
    const [a, b] = gp.pair.split('|');
    const A = ROOMS.find(r => r[0] === a), B = ROOMS.find(r => r[0] === b);
    const cx = ((Math.min(A[2], B[2]) + Math.max(A[4], B[4])) / 2) * T;
    const cy = ((Math.min(A[3], B[3]) + Math.max(A[5], B[5])) / 2) * T;
    crops['join_' + a + '_' + b] = crop(cx - 60, cy - 60, 120, 120, 4);
  }

  /* THE COUNTER-CASE. If the seam code were broken, closing the gaps would still show a border. So
     build the SAME station with every room slid flush against its neighbour and ask the classifier
     how many open joins it finds. This is what separates "the blend is broken" from "there is
     nothing to blend", and those two have completely different fixes. */
  const FLUSH = [
    ['r1','hab',      0,   0, 17, 10],
    ['r3','hab',     -1, -10, 18, -1],   // was y-9..-3 with a 2-tile gap -> now flush to r1's top
    ['r5','hab',      18, -1, 26,  5],   // was x19 with a 1-tile gap     -> now flush to r1's right
    ['r6','hab',     -9,  -1, -1,  5],   // was x-10..-2 with a 1-tile gap-> now flush to r1's left
    ['r7','hab',      18,  9, 26, 15],
    ['r8','hab',      -9,  9, -1, 15],
    ['r9','hab',       0, 11, 17, 16],   // was y14 with a 3-tile gap     -> now flush to r1's bottom
  ];
  const st2 = WorldModel.create(WorldModel.defaultDoc());
  for (const [, kind, x1, y1, x2, y2] of FLUSH) st2.addRoom({ kind, rects: [{ x1, y1, x2, y2 }] });
  const geo2 = st2.projectGeometry(), bk2 = StationBake.bake(geo2);
  const lit2 = mk(bk2.W, bk2.H);
  lit2.g.drawImage(bk2.baseCv, 0, 0); lit2.g.drawImage(bk2.lightCv, 0, 0);
  {
    const o = mk(bk2.W, bk2.H); o.g.imageSmoothingEnabled = false; o.g.drawImage(lit2.c, 0, 0);
    crops.station_FLUSH = o.c.toDataURL('image/png').split(',')[1];
  }
  // profile straight across the r1|r5 boundary when flush: a blended seam has no spike
  const r1r5 = (() => {
    const bx = 18 * T, y0 = 0 * T + 6, hh = 5 * T;
    const from = bx - 40, to = bx + 40;
    const d = lit2.g.getImageData(from, y0, to - from, hh).data, prof = [];
    for (let c = 0; c < to - from; c++) { let s = 0; for (let r = 0; r < hh; r++) s += L(d, ((r * (to - from)) + c) * 4); prof.push(+(s / hh).toFixed(1)); }
    const peak = Math.max(...prof), med = prof.slice().sort((a, b) => a - b)[prof.length >> 1];
    return { profile: prof.join(','), peak, median: med, peakOverMedian: +(peak / med).toFixed(2) };
  })();

  return JSON.stringify({
    bake: [bk.W, bk.H], TILE: T,
    near_adjacencies: gaps,
    openJoinCount_ANDREWS_SAVE: StationBake.seamOpenJoins(geo).length,
    openJoinCount_SAME_ROOMS_FLUSH: StationBake.seamOpenJoins(geo2).length,
    flush_seam_r1_r5: r1r5,
    profiles, crops
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'seamblend-'));
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
  console.error('seamblend: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SEAMBLEND_DIR || join(process.cwd(), 'dev', '.shots-seamblend');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
