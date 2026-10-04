#!/usr/bin/env node
/* dev/catshot.mjs — the WHOLE CATALOG on one in-situ contact sheet.
 *
 * Same doctrine as rotshot.mjs (the rotation lane's shooter): never judge prop art on a neutral
 * field. This bakes a REAL station through the shipped StationBake, draws every catalog prop over
 * the deck in world.js order (base -> props y-sorted -> light), and upscales by an INTEGER factor
 * with smoothing off. The grid is greedy-packed rows (prop widths run 1..8 tiles, so a fixed
 * column stride would waste most of the sheet), each cell labelled in the deck gap BELOW its prop.
 *
 *   node dev/catshot.mjs                  # everything, powered/working state
 *   node dev/catshot.mjs bar tv crate     # just those ids
 *   SKYNET_CAT_WORK=0 node dev/catshot.mjs
 *   SKYNET_CAT_OUT=... SKYNET_CAT_SCALE=4
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8957';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9357);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_CAT_OUT || join(process.cwd(), 'catshot');
const SCALE = Number(process.env.SKYNET_CAT_SCALE || 4);
const WORK = process.env.SKYNET_CAT_WORK !== '0';
const IDS = process.argv.slice(2).filter(a => !a.startsWith('-'));

const SHEET = `(() => {
  const WORK = ${WORK};
  const WANT = ${JSON.stringify(IDS)};
  const cat = WANT.length ? WANT.map(id => PropSprites.CATALOG.find(c => c.id === id)).filter(Boolean)
                          : PropSprites.CATALOG.slice();
  if (WANT.length && cat.length !== WANT.length) return { error: 'unknown ids among ' + WANT.join(',') };
  PropSprites.setSpotifyConnected && PropSprites.setSpotifyConnected(true);

  /* Greedy row packing. ROWW tiles of usable width per row; every cell is the prop's own footprint
     plus a 2-tile gutter each side and 2 above / 2 below (props paint RISE above their box, and the
     label sits in the bottom gutter). Mount-required props get a table stood under them first. */
  const ROWW = 64, GX = 2, GY = 2;
  const rows = [];
  let cur = { x: GX, h: 0, cells: [] };
  for (const c of cat) {
    const w = c.w, h = c.h;
    if (cur.x + w + GX > ROWW && cur.cells.length) { rows.push(cur); cur = { x: GX, h: 0, cells: [] }; }
    cur.cells.push({ c, dx: cur.x });
    cur.x += w + GX; cur.h = Math.max(cur.h, h);
  }
  if (cur.cells.length) rows.push(cur);

  let H = GY;
  const placedRows = rows.map(r => { const y = H; H += r.h + 2 * GY; return { ...r, y }; });
  const doc = WorldModel.defaultDoc();
  const rid = doc.order[0];
  doc.rooms[rid].rects = [{ x1: 0, y1: 0, x2: ROWW, y2: H }];
  const st = WorldModel.create(doc);

  const placed = [], skipped = [];
  let first = null;                                   // first model-frame placement, for the geo offset
  for (const r of placedRows) for (const { c, dx } of r.cells) {
    const y = r.y + (r.h - c.h);                      // bottom-align inside the row band
    if (c.mount === 'surface') {
      const t = st.addProp({ t: 'sidetable', x: dx, y, w: 1, h: 1, block: true });
      if (!t.ok) { skipped.push(c.id + ':table:' + t.code); continue; }
      first = first || { x: dx, y };
    }
    const res = st.addProp({ t: c.id, x: dx, y, w: c.w, h: c.h, block: !!c.blocks });
    if (!res.ok) { skipped.push(c.id + ':' + (res.code || 'REFUSED')); continue; }
    first = first || { x: dx, y };
    placed.push({ id: c.id, x: dx, y, w: c.w, h: c.h });
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
    catch (e) { return { error: 'draw threw on ' + p.t + ': ' + (e && e.message) }; }
  }
  g.drawImage(bk.lightCv, 0, 0);
  return { png: cv.toDataURL('image/png'), W: bk.W, H: bk.H, T, ox, oy, placed, skipped };
})()`;

const labelExpr = (res) => `(() => {
  const S = ${SCALE}, T = ${res.T}, OX = ${res.ox}, OY = ${res.oy};
  const PLACED = ${JSON.stringify(res.placed)};
  return new Promise(done => {
    const src = new Image();
    src.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = ${res.W} * S; cv.height = ${res.H} * S;
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(src, 0, 0, cv.width, cv.height);
      g.font = 'bold ' + Math.max(10, 3 * S) + 'px monospace';
      g.textBaseline = 'top';
      for (const p of PLACED) {
        const x = (OX + p.x) * T * S, y = (OY + p.y + p.h) * T * S + 3;
        const wpx = g.measureText(p.id).width;
        g.fillStyle = 'rgba(4,8,10,0.72)'; g.fillRect(x - 2, y - 1, wpx + 5, 3 * S + 5);
        g.fillStyle = '#7fe9c8'; g.fillText(p.id, x, y);
      }
      done(cv.toDataURL('image/png'));
    };
    src.src = ${JSON.stringify(res.png)};
  });
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'catshot-'));
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
    for (let i = 0; i < 40; i++) {
      if (await evalJS(cdp, `['PropSprites','WorldModel','StationBake'].every(k => { try { return typeof eval(k) === 'object'; } catch { return false; } })`)) break;
      await sleep(500);
    }

    const res = await evalJS(cdp, SHEET);
    if (!res || res.error) throw new Error('probe failed: ' + (res ? res.error : 'no result'));

    mkdirSync(OUT, { recursive: true });
    const big = await evalJS(cdp, labelExpr(res));
    writeFileSync(join(OUT, 'catalog.png'), Buffer.from(String(big).split(',')[1], 'base64'));
    console.log(JSON.stringify({ out: join(OUT, 'catalog.png'), bake: [res.W, res.H], placed: res.placed.length, skipped: res.skipped }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
