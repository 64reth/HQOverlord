#!/usr/bin/env node
// dev/floorseam.mjs — MEASURE the floor seam between adjacent zones.
//
// Andrew 2026-08-05: "when you place multiple rooms, or a hallway, the floors do appear to not
// blend properly. there is always a border that shows."
//
// Same discipline as dev/corridordeck.mjs: bake offscreen at 1:1 through the shipped StationBake,
// composite over MAGENTA, and answer the question with NUMBERS as well as crops. The number that
// matters is a per-row (or per-column) mean-luma profile taken straight ACROSS the seam on the BARE
// composite — the ambient gradient is a smooth ramp, so any row that jumps off it is a painted line.
//
//   node dev/floorseam.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8957';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9357);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const st = WorldModel.create(WorldModel.defaultDoc());
  // A ---- C  (two HAB rooms abutting: SAME kind, SAME floor style -> the pure "does the deck
  //            continue" question, with hue held constant)
  // |
  // hallway   (corridor: a DIFFERENT floor style, the case Andrew drew a line on)
  // |
  // B
  const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 0,  x2: 34, y2: 9  }] });
  const C = st.addRoom({ kind: 'hab', rects: [{ x1: 35, y1: 0,  x2: 46, y2: 9  }] });
  const B = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 15, x2: 33, y2: 26 }] });
  const H = st.placeHallway({ rects: [{ x1: 24, y1: 10, x2: 26, y2: 14 }] });
  // A second cluster, well clear of the first: a WIDE hallway laid across the full face of two
  // rooms. Same open-join shape, but the two decks carry DIFFERENT hues (DECKING vs the room's
  // own) — so this is the case where removing the track exposes whatever tonal step was under it.
  const D = st.addRoom({ kind: 'bridge', rects: [{ x1: 60, y1: 0,  x2: 73, y2: 9  }] });
  const W = st.placeHallway({ rects: [{ x1: 60, y1: 10, x2: 73, y2: 12 }] });
  const E = st.addRoom({ kind: 'lab',    rects: [{ x1: 60, y1: 13, x2: 73, y2: 22 }] });
  const errs = { A: A.error || null, C: C.error || null, B: B.error || null, H: H.error || null,
                 D: D.error || null, W: W.error || null, E: E.error || null };

  const geo = st.projectGeometry(), T = geo.TILE;
  const bk = StationBake.bake(geo);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const lit = mk(bk.W, bk.H); lit.g.fillStyle = '#ff00ff'; lit.g.fillRect(0, 0, bk.W, bk.H);
  lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
  const bare = mk(bk.W, bk.H); bare.g.fillStyle = '#ff00ff'; bare.g.fillRect(0, 0, bk.W, bk.H);
  bare.g.drawImage(bk.baseCv, 0, 0);

  const crop = (src, cx, cy, cw, ch, z) => {
    const o = mk(cw * z, ch * z);
    o.g.drawImage(src, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
    return o.c.toDataURL('image/png').split(',')[1];
  };
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // mean luma of each ROW in a strip (x0..x0+w, y0..y0+h)
  const rows = (ctx, x0, y0, w, h) => {
    const d = ctx.getImageData(x0, y0, w, h).data, out = [];
    for (let r = 0; r < h; r++) { let s = 0; for (let c = 0; c < w; c++) s += L(d, ((r * w) + c) * 4); out.push(+(s / w).toFixed(2)); }
    return out;
  };
  const cols = (ctx, x0, y0, w, h) => {
    const d = ctx.getImageData(x0, y0, w, h).data, out = [];
    for (let c = 0; c < w; c++) { let s = 0; for (let r = 0; r < h; r++) s += L(d, ((r * w) + c) * 4); out.push(+(s / h).toFixed(2)); }
    return out;
  };

  const rectOf = z => geo.allRects.find(r => r.z === z);
  const ra = rectOf(A.id), rc = rectOf(C.id), rh = rectOf(H.id), rb = rectOf(B.id);

  // ---- SEAM 1: room A (above) <-> hallway (below), the y = rh.y1 tile line
  const s1y = rh.y1 * T;                       // first hallway pixel row
  const s1 = { row0: s1y - 3 * T,
    bare: rows(bare.g, rh.x1 * T + 4, s1y - 3 * T, (rh.x2 - rh.x1 + 1) * T - 8, 6 * T),
    lit:  rows(lit.g,  rh.x1 * T + 4, s1y - 3 * T, (rh.x2 - rh.x1 + 1) * T - 8, 6 * T) };
  // ---- SEAM 2: room A (west) <-> room C (east), the x = rc.x1 tile line. Same kind, same hue.
  const s2x = rc.x1 * T;
  const s2 = { col0: s2x - 3 * T,
    bare: cols(bare.g, s2x - 3 * T, ra.y1 * T + 4 * T, 6 * T, 4 * T),
    lit:  cols(lit.g,  s2x - 3 * T, ra.y1 * T + 4 * T, 6 * T, 4 * T) };

  // ---- SEAM 3: room D (above) <-> the WIDE hallway (below) — an open join across differing hues
  const rw = rectOf(W.id), rdd = rectOf(D.id);
  const s3y = rw.y1 * T;
  const s3 = { row0: s3y - 3 * T,
    bare: rows(bare.g, rw.x1 * T + 4 * T, s3y - 3 * T, 6 * T, 6 * T),
    lit:  rows(lit.g,  rw.x1 * T + 4 * T, s3y - 3 * T, 6 * T, 6 * T) };

  const HW = (rh.x2 - rh.x1 + 1) * T;
  const crops = {
    wide_hall: crop(lit.c, rdd.x1 * T - 16, rdd.y1 * T - 16, (rdd.x2 - rdd.x1 + 1) * T + 32, (rw.y2 - rdd.y1 + 1) * T + 40, 4),
    // the two hallway MOUTHS — room A above it, room B below it
    mouth_top:    crop(lit.c,  rh.x1 * T - 44, s1y - 44, HW + 88, 88, 7),
    mouth_bottom: crop(lit.c,  rh.x1 * T - 44, (rh.y2 + 1) * T - 44, HW + 88, 88, 7),
    // two HAB rooms abutting: same kind, same hue, same material — nothing should divide them
    seam_room_lit:  crop(lit.c,  s2x - 40, ra.y1 * T + 3 * T, 80, 80, 8),
    seam_room_bare: crop(bare.c, s2x - 40, ra.y1 * T + 3 * T, 80, 80, 8),
    wide_lit:       crop(lit.c,  ra.x1 * T - 16, ra.y1 * T - 16, (rc.x2 - ra.x1 + 1) * T + 32, (rb.y2 - ra.y1 + 1) * T + 32, 2),
  };
  return JSON.stringify({ errs, T, A: A.id, B: B.id, C: C.id, H: H.id,
    styles: { A: st.doc().rooms[A.id].floorStyle, C: st.doc().rooms[C.id].floorStyle, H: st.doc().rooms[H.id].floorStyle },
    mats: { A: geo.matOf(A.id), C: geo.matOf(C.id), H: geo.matOf(H.id) },
    seam1_rows_bare: s1.bare.join(','), seam1_rows_lit: s1.lit.join(','),
    seam2_cols_bare: s2.bare.join(','), seam2_cols_lit: s2.lit.join(','),
    seam3_rows_bare: s3.bare.join(','), seam3_rows_lit: s3.lit.join(','), crops });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'floorseam-'));
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
  console.error('floorseam: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const out = await evalJS(cdp, PROBE);
const data = JSON.parse(typeof out === 'string' ? out : JSON.stringify(out));
const dir = process.env.SKYNET_SEAM_DIR || join(process.cwd(), '.floorseam');
mkdirSync(dir, { recursive: true });
for (const [name, b64] of Object.entries(data.crops || {})) writeFileSync(join(dir, name + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
