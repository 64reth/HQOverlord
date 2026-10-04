#!/usr/bin/env node
/* dev/reclinerskins.mjs — THE RECLINER SIT, ON EVERY SKIN.
 *
 * The side-seat render is only as good as each set's SIT master: the body is placed on the cushion
 * and covered by the chair's near arm, so a set whose sit pose is taller, shorter, or (worse) absent
 * lands somewhere else entirely. assets.js already warns that a set with no sit frames falls back to
 * rot/stand — that is a body STANDING in an armchair, and no unit test can see it.
 *
 * So: seat the hero on the recliner once per DATA.SKINS entry, through the REAL planCouchSit path,
 * and assemble one labelled contact sheet per facing. Crops are kept IN the page and composited
 * there — 37 full-size PNGs over CDP is megabytes of base64 for no reason.
 *
 *   node dev/reclinerskins.mjs [--port=8962] [--cdp=9362] [--out=.reclinerskins] [--scale=2]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, isUp } from '../scripts/lib/seed.mjs';

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith('--' + k + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const PORT = arg('port', '8962');
const CDP_PORT = Number(arg('cdp', 9362));
const SCALE = Number(arg('scale', 2));
const OUT = join(process.cwd(), arg('out', '.reclinerskins'));
const SCRATCH = join(OUT, '_seed-workspace');
const APP_URL = `http://127.0.0.1:${PORT}/`;
const COLS = Number(arg('cols', 7));
const ONLY = (arg('skins', '') || '').split(',').filter(Boolean);   // spot-check a shortlist at a bigger scale

const PLACE = `(() => {
  const st = (typeof Build !== 'undefined' && Build.__test__) ? Build.__test__.station() : null;
  if (!st) return { error: 'no live station (Build.__test__ unavailable)' };
  const b = st.bounds();
  const x1 = b.maxTx + 1, y1 = b.minTy + 1;
  const room = st.addRoom({ kind: 'hab', rects: [{ x1, y1, x2: x1 + 9, y2: y1 + 7 }] });
  if (!room || room.ok === false) return { error: 'addRoom refused: ' + JSON.stringify(room) };
  for (const p of [{ t: 'recliner', x: x1 + 2 }, { t: 'recliner_r', x: x1 + 4 }]) {
    const r = st.addProp({ t: p.t, x: p.x, y: y1 + 2, w: 1, h: 1, block: true });
    if (!r || r.ok === false) return { error: 'addProp refused: ' + p.t };
  }
  World.rebake(); World.refit();
  Object.assign(World.crt, { scan: 0, pitch: 1, fade: 0, glow: 0, curve: 0, vig: 0, over: 1, dust: 0, aberr: 0, grain: 0 });
  document.body.classList.add('no-scan');   // barrel warp OFF: a crop from world coords must land on the prop
  window.__SHEET = { recliner: [], recliner_r: [] };
  return { ok: true, skins: Object.keys(DATA.SKINS) };
})()`;

/* One skin, one facing: make the set resident, repoint the live body at it, seat through the real
   planner, then crop. Returns the pose so a bad cell can be told apart from a bad SEAT. */
const SHOT = (skin, t, hero) => `(async () => {
  const set = DATA.SKINS[${JSON.stringify(skin)}].set;
  SPRITES.ensureSkin(set);
  for (let i = 0; i < 40 && !SPRITES.isSkinReady(set); i++) await new Promise(r => setTimeout(r, 100));
  World.setSkin(${JSON.stringify(hero)}, ${JSON.stringify(skin)});
  const p = (Build.__test__.station().projectGeometry().props || []).find(q => q.t === ${JSON.stringify(t)});
  if (!p) return { err: 'no prop' };
  const seated = World._dbgCouchSit(${JSON.stringify(hero)}, p.id);
  await new Promise(r => setTimeout(r, 900));
  const geo = Build.__test__.station().projectGeometry(), T = geo.TILE, cam = World.cameraDbg();
  const g2 = (geo.props || []).find(q => q.t === ${JSON.stringify(t)});
  const cv = document.getElementById('stage');
  const PAD = 1.6;
  const x0 = Math.round((g2.x - PAD) * T * cam.scale + cam.panX);
  const y0 = Math.round((g2.y - PAD - 0.8) * T * cam.scale + cam.panY);
  const w = Math.round((1 + 2 * PAD) * T * cam.scale), h = Math.round((1 + 2 * PAD) * T * cam.scale);
  if (x0 < 0 || y0 < 0 || x0 + w > cv.width || y0 + h > cv.height) return { err: 'off-canvas' };
  const o = document.createElement('canvas'); o.width = w * ${SCALE}; o.height = h * ${SCALE};
  const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(cv, x0, y0, w, h, 0, 0, o.width, o.height);
  window.__SHEET[${JSON.stringify(t)}].push({ skin: ${JSON.stringify(skin)}, cv: o });
  const b = World.bodies().find(x => x && x.hero) || {};
  return { seated: !!seated, sitting: !!b.sitting, dir: b.dir, ready: SPRITES.isSkinReady(set) };
})()`;

const SHEET = (t) => `(() => {
  const cells = window.__SHEET[${JSON.stringify(t)}];
  if (!cells.length) return { error: 'no cells' };
  const CW = cells[0].cv.width, CH = cells[0].cv.height, LAB = 18, COLS = ${COLS};
  const rows = Math.ceil(cells.length / COLS);
  const o = document.createElement('canvas');
  o.width = COLS * CW; o.height = rows * (CH + LAB);
  const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
  g.fillStyle = '#07090a'; g.fillRect(0, 0, o.width, o.height);
  g.font = 'bold 13px monospace'; g.textBaseline = 'top';
  cells.forEach((c, i) => {
    const cx = (i % COLS) * CW, cy = Math.floor(i / COLS) * (CH + LAB);
    g.drawImage(c.cv, cx, cy);
    g.fillStyle = '#0c1416'; g.fillRect(cx, cy + CH, CW, LAB);
    g.fillStyle = '#7fe9c8'; g.fillText(c.skin, cx + 3, cy + CH + 3);
  });
  return { png: o.toDataURL('image/png').split(',')[1], cells: cells.length, w: o.width, h: o.height };
})()`;

let proc = null, side = null, cdp = null;
const die = async (msg, code) => { console.error(msg); try { proc && proc.kill(); } catch {} try { side && side.kill(); } catch {} process.exit(code); };

try {
  if (await isUp(APP_URL)) throw new Error(`${APP_URL} already answers — pick another --port`);
  mkdirSync(OUT, { recursive: true });
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);

  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1600,1000', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });

  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const up = await evalJS(cdp, `(() => { try { return !!(typeof World !== 'undefined' && World._dbgCouchSit && World.setSkin && typeof SPRITES !== 'undefined' && SPRITES.ensureSkin && typeof Build !== 'undefined' && Build.__test__ && document.getElementById('screen-game').classList.contains('active')); } catch (e) { return false; } })()`).catch(() => false);
    if (up) break;
  }
  const raf = await evalJS(cdp, `new Promise(res => { let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); };
    requestAnimationFrame(tick); })`);
  if (!(raf > 10)) await die('RECLINERSKINS INCONCLUSIVE — world clock frozen', 4);

  const placed = await evalJS(cdp, PLACE);
  if (!placed || placed.error) await die('[reclinerskins] ' + JSON.stringify(placed), 3);
  const hero = await evalJS(cdp, `(World.bodies().find(b => b && b.hero) || {}).id || null`);
  if (ONLY.length) placed.skins = placed.skins.filter(s => ONLY.includes(s));
  console.log('[reclinerskins] hero=' + hero + '  skins=' + placed.skins.length);
  await sleep(1200);

  const bad = [];
  for (const t of ['recliner', 'recliner_r']) {
    for (const skin of placed.skins) {
      const r = await evalJS(cdp, SHOT(skin, t, hero));
      const okCell = r && r.seated && r.sitting && !r.err;
      if (!okCell) bad.push(t + '/' + skin + ': ' + JSON.stringify(r));
      process.stdout.write(okCell ? '.' : 'X');
    }
    process.stdout.write('\n');
    const sheet = await evalJS(cdp, SHEET(t));
    if (!sheet || sheet.error) { console.error('[reclinerskins] sheet ' + t + ': ' + JSON.stringify(sheet)); continue; }
    writeFileSync(join(OUT, t + '-skins.png'), Buffer.from(sheet.png, 'base64'));
    console.log('[reclinerskins] ' + t + ' sheet -> ' + join(OUT, t + '-skins.png') + '  ' + sheet.w + 'x' + sheet.h + '  cells=' + sheet.cells);
  }
  if (bad.length) { console.log('[reclinerskins] CELLS THAT DID NOT SEAT:'); for (const b of bad) console.log('  ' + b); }
  else console.log('[reclinerskins] every skin seated and posed sitting');
} catch (e) {
  await die('[reclinerskins] ' + String(e && e.stack || e), 1);
}
try { proc && proc.kill(); } catch {}
try { side && side.kill(); } catch {}
process.exit(0);
