#!/usr/bin/env node
/* dev/rotshot.mjs — one prop per ROW, one FACING per column, in situ.
 *
 * Same doctrine as catshot.mjs: never judge prop art on a neutral field. This bakes a REAL station
 * through the shipped StationBake, places each requested prop four times (r = 0..3) over the deck,
 * draws them in world.js order (base -> props y-sorted -> lightmap) and upscales by an INTEGER
 * factor with smoothing off, so what you see is the game's own camera scale, magnified.
 *
 * It also REPORTS what each facing resolved to (authored view / mirrored east / decal turn / fell
 * back to south), because a cell that looks like its neighbour has to say whether that is the art
 * or a silent fall-back.
 *
 *   node dev/rotshot.mjs chair loungetable longtable
 *   SKYNET_ROT_WORK=0 SKYNET_ROT_SCALE=8 node dev/rotshot.mjs chair
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8958';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9358);
// ⛔ CACHE-BUST: Chrome served a stale propsprites.js and the sheet came back identical after an
// art edit — a shooter that can show you yesterday's art is worse than no shooter.
const URL = `http://127.0.0.1:${PORT}/?rot=${process.pid}`;
const OUT = process.env.SKYNET_ROT_OUT || join(process.cwd(), 'rotshot');
const SCALE = Number(process.env.SKYNET_ROT_SCALE || 6);
const WORK = process.env.SKYNET_ROT_WORK !== '0';
const IDS = process.argv.slice(2).filter(a => !a.startsWith('-'));
/* which cells to shoot: quarter turns 0..3, plus 'm' for the MIRRORED south view (the flip is what
   gives an angled prop its other diagonal, so it deserves a cell of its own). */
const CELLS = (process.env.SKYNET_ROT_FACES || '0,1,2,3').split(',').map(s => s.trim()).filter(Boolean);
// ROW layout puts every prop side by side on ONE row — the readable shape for a single-facing batch
const ROW = process.env.SKYNET_ROT_LAYOUT === 'row';

const SHEET = `(() => {
  const WORK = ${WORK};
  const WANT = ${JSON.stringify(IDS)};
  const CELLS = ${JSON.stringify(CELLS)};
  const ROW = ${ROW};
  const cat = WANT.map(id => PropSprites.CATALOG.find(c => c.id === id)).filter(Boolean);
  if (cat.length !== WANT.length) return { error: 'unknown ids among ' + WANT.join(',') };
  PropSprites.setSpotifyConnected && PropSprites.setSpotifyConnected(true);

  /* one ROW per prop, four columns (r=0..3). Column stride is the widest turned box the prop can
     take, so a re-tiling table never overlaps its neighbour. 3 tiles of gutter each way: props paint
     RISE above their footprint and the label sits in the gap below. */
  const GX = 3, GY = 3;
  const rows = [];
  let H = GY, W = GX;
  if (ROW) {                                          // one row: every prop side by side, bottom-aligned
    const cells = [], boxes = cat.map(c => PropSprites.footprintAt(c.id, 0) || { w: c.w, h: c.h });
    const ch = Math.max(...boxes.map(b => b.h));
    let dx = GX;
    cat.forEach((c, i) => { cells.push({ id: c.id, r: 0, mir: false, b: boxes[i], dx }); dx += boxes[i].w + GX; });
    rows.push({ id: null, cells, y: GY, ch });
    H = GY + ch + 2 * GY; W = dx;
  } else
  for (const c of cat) {
    const spots = CELLS.map(k => ({ mir: k === 'm', r: k === 'm' ? 0 : (+k & 3) }));
    const boxes = spots.map(s => PropSprites.footprintAt(c.id, s.r) || { w: c.w, h: c.h });
    const cw = Math.max(...boxes.map(b => b.w)), ch = Math.max(...boxes.map(b => b.h));
    const cells = boxes.map((b, i) => ({ r: spots[i].r, mir: spots[i].mir, b, dx: GX + i * (cw + GX) }));
    rows.push({ id: c.id, cells, y: H, ch });
    H += ch + 2 * GY;
    W = Math.max(W, GX + cells.length * (cw + GX));
  }

  const doc = WorldModel.defaultDoc();
  const rid = doc.order[0];
  doc.rooms[rid].rects = [{ x1: 0, y1: 0, x2: W, y2: H }];
  const st = WorldModel.create(doc);

  const placed = [], skipped = [], resolved = [];
  let first = null;
  for (const row of rows) {
    for (const cell of row.cells) {
      const c = PropSprites.CATALOG.find(x => x.id === (cell.id || row.id));
      const y = row.y + (row.ch - cell.b.h);            // bottom-align inside the row band
      const res = st.addProp({ t: c.id, x: cell.dx, y, w: cell.b.w, h: cell.b.h, block: !!c.blocks, r: cell.r, m: cell.mir ? 1 : 0 });
      if (!res.ok) { skipped.push(c.id + ':' + cell.r + ':' + (res.code || 'REFUSED')); continue; }
      first = first || { x: cell.dx, y };
      placed.push({ id: c.id, r: cell.r, mir: cell.mir ? 1 : 0, x: cell.dx, y, w: cell.b.w, h: cell.b.h });
      // what did that facing actually resolve to? (a fall-back must never pass for authored art)
      const v = PropSprites.viewAt(c.id, cell.r);
      resolved.push(c.id + ':' + cell.r + ' -> ' + (!v ? 'FELL BACK TO SOUTH'
        : v.turned ? 'decal turn' : v.mirror ? 'east view, MIRRORED' : (cell.r ? 'authored' : 'south')));
    }
  }
  if (!first) return { error: 'nothing placed: ' + skipped.join('; ') };

  const geo = st.projectGeometry();
  const bk = StationBake.bake(geo);
  const T = geo.TILE;
  const ox = geo.props[0].x - first.x, oy = geo.props[0].y - first.y;

  const cv = document.createElement('canvas'); cv.width = bk.W; cv.height = bk.H;
  const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(bk.baseCv, 0, 0);
  PropSprites.setCtx(g);
  PropSprites.setNow(performance.now());
  const sorted = geo.props.slice().sort((a, b) => (a.y + a.h) - (b.y + b.h));
  for (const p of sorted) {
    try { PropSprites.draw(p, WORK); }
    catch (e) { return { error: 'draw threw on ' + p.t + ' r=' + (p.r || 0) + ': ' + (e && e.message) }; }
  }
  g.drawImage(bk.lightCv, 0, 0);
  /* CROP to the props themselves (plus a margin for rise + the label strip). A sheet that spends 90%
     of its pixels on empty deck cannot be judged at the game's own scale without a magnifier. */
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of placed) {
    x0 = Math.min(x0, (ox + p.x) * T); y0 = Math.min(y0, (oy + p.y) * T);
    x1 = Math.max(x1, (ox + p.x + p.w) * T); y1 = Math.max(y1, (oy + p.y + p.h) * T);
  }
  const M = 26;                                        // room for the tallest rise + the label strip
  x0 = Math.max(0, x0 - 8); y0 = Math.max(0, y0 - M);
  x1 = Math.min(bk.W, x1 + 8); y1 = Math.min(bk.H, y1 + M);
  const cw2 = x1 - x0, ch2 = y1 - y0;
  const cc = document.createElement('canvas'); cc.width = cw2; cc.height = ch2;
  const gc = cc.getContext('2d'); gc.imageSmoothingEnabled = false;
  gc.drawImage(cv, x0, y0, cw2, ch2, 0, 0, cw2, ch2);
  return { png: cc.toDataURL('image/png'), W: cw2, H: ch2, T, ox: ox - x0 / T, oy: oy - y0 / T, placed, skipped, resolved };
})()`;

const FACE = ['S', 'W', 'N', 'E'];
const labelExpr = (res) => `(() => {
  const S = ${SCALE}, T = ${res.T}, OX = ${res.ox}, OY = ${res.oy};
  const PLACED = ${JSON.stringify(res.placed)}, FACE = ${JSON.stringify(FACE)};
  return new Promise(done => {
    const src = new Image();
    src.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = ${res.W} * S; cv.height = ${res.H} * S;
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(src, 0, 0, cv.width, cv.height);
      g.font = 'bold ' + Math.max(10, 2.5 * S) + 'px monospace';
      g.textBaseline = 'top';
      for (const p of PLACED) {
        const t = p.id + ' ' + (p.mir ? 'FLIP' : FACE[p.r]);
        const x = (OX + p.x) * T * S, y = (OY + p.y + p.h) * T * S + 3;
        const wpx = g.measureText(t).width;
        g.fillStyle = 'rgba(4,8,10,0.72)'; g.fillRect(x - 2, y - 1, wpx + 5, 2.5 * S + 6);
        g.fillStyle = (p.r || p.mir) ? '#ffd88a' : '#7fe9c8'; g.fillText(t, x, y);
      }
      done(cv.toDataURL('image/png'));
    };
    src.src = ${JSON.stringify(res.png)};
  });
})()`;

async function main() {
  if (!IDS.length) { console.error('usage: node dev/rotshot.mjs <propId> [...]'); process.exit(2); }
  const scratch = mkdtempSync(join(tmpdir(), 'rotshot-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    await waitDevReady(cdp, evalJS, { url: URL });
    // wait on the MODULES, never on readiness: waitDevReady reloads the page while it waits, so an
    // eval landing in that window sees no globals at all ("PropSprites is not defined").
    for (let i = 0; i < 40; i++) {
      if (await evalJS(cdp, `['PropSprites','WorldModel','StationBake'].every(k => { try { return typeof eval(k) === 'object'; } catch { return false; } })`)) break;
      await sleep(500);
    }

    const res = await evalJS(cdp, SHEET);
    if (!res || res.error) throw new Error('probe failed: ' + (res ? res.error : 'no result'));

    mkdirSync(OUT, { recursive: true });
    const big = await evalJS(cdp, labelExpr(res));
    const file = join(OUT, IDS.join('-').slice(0, 60) + '.png');
    writeFileSync(file, Buffer.from(String(big).split(',')[1], 'base64'));
    console.log(JSON.stringify({ out: file, bake: [res.W, res.H], placed: res.placed.length, skipped: res.skipped, resolved: res.resolved }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
