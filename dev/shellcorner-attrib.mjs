#!/usr/bin/env node
// dev/shellcorner-attrib.mjs — WHAT is the dark wedge at a station's BOTTOM corners?
//
// Andrew, circling the bottom-right corner of the starter station: "i cant stand how the edge of
// the shell is showing on the bottom left and right sides. can we just remove the shell entirely
// from interior so its only the exterior where its visible".
//
// The screenshot is the CRT'd, barrel-warped, chromatically-fringed screen, so it cannot say which
// PASS paints that wedge. Same discipline as dev/hallcorner-attrib.mjs: bake offscreen at 1:1
// through the shipped StationBake, BASE ONLY (the light pass would tint the attribution), over
// MAGENTA, and answer with crops AND a colour census whose entries are named against the tones the
// bake actually computes (shell base/edge/rim vs the wall's face ramp vs the crown).
//
//   node dev/shellcorner-attrib.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8963';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9363);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const st = WorldModel.create(WorldModel.defaultDoc());

  const render = (mut) => {
    const geo = st.projectGeometry();
    if (mut) mut(geo);
    const bk = SB.bake(geo);
    const base = mk(bk.W, bk.H);
    base.g.fillStyle = '#ff00ff'; base.g.fillRect(0, 0, bk.W, bk.H);
    base.g.drawImage(bk.baseCv, 0, 0);           // BASE ONLY
    return { geo, bk, base };
  };
  const cur = render(null);
  const noch = render(g => { g.chamfers.length = 0; });
  /* THE HYPOTHESIS. SHAPE.cornerN defaults to 1 — a 45 deg chamfer — and eachCornerRow (the DECK
     CUT) honours it, but bakeCornerCrown's deckXAt/deckYAt still stop the wall face on a hardcoded
     CIRCLE of the same radius. Between the two lies a lens of tile, widest at exactly 45 deg, that
     the deck cut filled with cHull (the SHELL) and nothing ever paints over. Baking at cornerN = 2
     makes the two agree by construction: if that is the wedge, it must vanish here. */
  const oldN = SB.SHAPE.cornerN;
  SB.SHAPE.cornerN = 2;
  const n2 = render(null);
  SB.SHAPE.cornerN = oldN;

  const T = cur.geo.TILE;
  const chamfers = cur.geo.chamfers.map(c => ({ x: c[0], y: c[1], kind: c[2] }));
  const rects = cur.geo.allRects.map(r => ({ z: r.z, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }));

  // the block around a corner tile: 3 tiles square, so both straight walls it joins are in frame
  const BL = chamfers.find(c => c.kind === 'bl'), BR = chamfers.find(c => c.kind === 'br');
  const TR = chamfers.find(c => c.kind === 'tr');
  const blockOf = c => ({ x: (c.x - 1) * T, y: (c.y - 1) * T, w: T * 3, h: T * 3 });

  const Z = 12;
  const crop = (src, b) => { const o = mk(b.w * Z, b.h * Z); o.g.drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w * Z, b.h * Z); return o.c.toDataURL('image/png').split(',')[1]; };

  // COLOUR CENSUS of a block — every distinct rgb with its count, brightest first
  const census = (ctx, b) => {
    const d = ctx.getImageData(b.x, b.y, b.w, b.h).data, m = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, 24)
      .map(([k, n]) => ({ rgb: k, n, lum: Math.round(0.299 * +k.split(',')[0] + 0.587 * +k.split(',')[1] + 0.114 * +k.split(',')[2]) }));
  };

  const bBL = blockOf(BL), bBR = blockOf(BR), bTR = blockOf(TR);

  /* THE WEDGE, AS A NUMBER. hullPal is not exported, but the deck-cut fill IS the only tone that
     appears both here and out on the plate ring beyond the silhouette, so sample it there: one
     pixel just outside the room's east wall, on the ring, is cHull by construction. Count how many
     pixels of the corner tile carry that exact tone — that is "how much shell is showing inside". */
  const at = (ctx, x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; };
  const countTone = (ctx, b, tone) => {
    const d = ctx.getImageData(b.x, b.y, b.w, b.h).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + ',' + d[i + 1] + ',' + d[i + 2] === tone) n++;
    return n;
  };
  // the corner TILE itself (not the 3x3 block) — the only place an interior shell leak can live
  const tileOf = c => ({ x: c.x * T, y: c.y * T, w: T, h: T });
  const tBR = tileOf(BR), tBL = tileOf(BL), tTR = tileOf(TR);
  const room = rects[0];
  const hullTone = at(cur.base.g, room.x2 * T + T + 2, (room.y1 + 2) * T);   // plate ring, east of the room

  return JSON.stringify({
    tile: T, W: cur.bk.W, H: cur.bk.H, rects, chamfers, cornerN: SB.SHAPE.cornerN,
    blocks: { bl: bBL, br: bBR, tr: bTR },
    hullTone,
    shell_px_in_corner_tile: {
      br_cur: countTone(cur.base.g, tBR, hullTone), br_cornerN2: countTone(n2.base.g, tBR, hullTone),
      bl_cur: countTone(cur.base.g, tBL, hullTone), bl_cornerN2: countTone(n2.base.g, tBL, hullTone),
      tr_cur: countTone(cur.base.g, tTR, hullTone), tr_cornerN2: countTone(n2.base.g, tTR, hullTone),
    },
    census_br: census(cur.base.g, bBR),
    crops: {
      BR_cur: crop(cur.base.c, bBR), BR_nochamfer: crop(noch.base.c, bBR), BR_cornerN2: crop(n2.base.c, bBR),
      BL_cur: crop(cur.base.c, bBL), TR_cur: crop(cur.base.c, bTR),
    }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellcorner-'));
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
  console.error('shellcorner: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELLCORNER_DIR || join(process.cwd(), 'dev', '.shots-shellcorner');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
