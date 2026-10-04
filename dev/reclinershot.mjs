#!/usr/bin/env node
/* dev/reclinershot.mjs — DOES A BODY ACTUALLY SIT IN THE RECLINER?
 *
 * Andrew, 2026-08-17: "we have a new side angle chair the recliner, currently the agents do not
 * even sit in it ... they sit behind it." The only way to judge that is the REAL render: the
 * y-sorted world pass, the real sit sprite, the real prop art, over a real baked deck. So this
 * drives the live app — lays a lounge room through the same validated mutation API REFIT uses,
 * places the recliner pair (plus a plain couch as the control), seats a body on each through the
 * REAL planCouchSit path (World._dbgCouchSit — no staged pixels), and crops #stage around each.
 *
 * ⛔ The preview pane never fires rAF, so the world clock is frozen there. Headless-ish Chrome over
 *    CDP is the only surface where the station actually ticks — hence the whole CDP dance.
 *
 *   node dev/reclinershot.mjs [--port=8961] [--cdp=9361] [--out=.reclinershot] [--scale=6]
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, isUp } from '../scripts/lib/seed.mjs';

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith('--' + k + '=')); return h ? h.split('=').slice(1).join('=') : d; };
const PORT = arg('port', '8961');
const CDP_PORT = Number(arg('cdp', 9361));
const SCALE = Number(arg('scale', 6));
const OUT = join(process.cwd(), arg('out', '.reclinershot'));
const SCRATCH = join(OUT, '_seed-workspace');
const APP_URL = `http://127.0.0.1:${PORT}/`;

/* Lay a lounge ABUTTING the seeded station (projectGeometry auto-doors the shared seam, so it is
   reachable) and stand the three seats in it. Kept close so every tile stays inside the hero's
   14-tile roam zone — planCouchSit cages both the cushion and the approach tile to that zone. */
const PLACE = `(() => {
  const st = (typeof Build !== 'undefined' && Build.__test__) ? Build.__test__.station() : null;
  if (!st) return { error: 'no live station (Build.__test__ unavailable)' };
  const b = st.bounds();
  const x1 = b.maxTx + 1, y1 = b.minTy + 1;
  const room = st.addRoom({ kind: 'hab', rects: [{ x1, y1, x2: x1 + 9, y2: y1 + 7 }] });
  if (!room || room.ok === false) return { error: 'addRoom refused: ' + JSON.stringify(room) };
  const want = [
    { t: 'recliner',   x: x1 + 2, y: y1 + 2, w: 1, h: 1 },
    { t: 'recliner_r', x: x1 + 4, y: y1 + 2, w: 1, h: 1 },
    { t: 'couch',      x: x1 + 2, y: y1 + 5, w: 5, h: 1 },
  ];
  const refused = [];
  for (const p of want) { const r = st.addProp({ t: p.t, x: p.x, y: p.y, w: p.w, h: p.h, block: true }); if (!r || r.ok === false) refused.push(p.t + ':' + JSON.stringify(r)); }
  if (refused.length) return { error: 'addProp refused: ' + refused.join(' | ') };
  World.rebake(); World.refit();
  return { ok: true, x1, y1 };
})()`;

/* Kill the CRT pass for the READBACK only (World.crt is the same live object the dev CRT LAB
   mutates). The barrel warp is a per-pixel remap of the finished frame, so with it on a crop
   computed from world coords lands on the wrong content — floorseam-live hit exactly that and
   had to hunt for its seam. Zeroing curve/vignette/scan makes canvas = bake·scale + pan again,
   which is what lets a crop be an ASSERTION instead of a guess. Shipped defaults are untouched. */
const CLEAN = `(() => {
  Object.assign(World.crt, { scan: 0, pitch: 1, fade: 0, glow: 0, curve: 0, vig: 0, over: 1, dust: 0, aberr: 0, grain: 0 });
  document.body.classList.add('no-scan');
  return JSON.stringify(World.crt);
})()`;

const SEAT = (aid, t) => `(() => {
  const p = (Build.__test__.station().projectGeometry().props || []).find(q => q.t === ${JSON.stringify(t)});
  if (!p) return { err: 'prop missing from geo' };
  return { id: p.id, tile: { x: p.x, y: p.y }, seated: World._dbgCouchSit(${JSON.stringify(aid)}, p.id) };
})()`;

/* world→canvas: the renderer does setTransform(scale,0,0,scale,panX,panY) then draws the bake at
   0,0, so a LOCAL bake pixel maps to px*scale + pan. geo.props already speak that local frame. */
const CROP = (t, padT) => `(() => {
  const geo = Build.__test__.station().projectGeometry(), T = geo.TILE, cam = World.cameraDbg();
  const p = (geo.props || []).find(q => q.t === ${JSON.stringify(t)});
  if (!p) return { error: 'no ' + ${JSON.stringify(t)} + ' in geo' };
  const cv = document.getElementById('stage');
  const PAD = ${padT};
  const x0 = Math.round((p.x - PAD) * T * cam.scale + cam.panX);
  const y0 = Math.round((p.y - PAD) * T * cam.scale + cam.panY);
  const w = Math.round(((p.w || 1) + 2 * PAD) * T * cam.scale);
  const h = Math.round(((p.h || 1) + 2 * PAD) * T * cam.scale);
  if (x0 < 0 || y0 < 0 || x0 + w > cv.width || y0 + h > cv.height) return { error: 'crop off-canvas', x0, y0, w, h, cw: cv.width, ch: cv.height, cam };
  const o = document.createElement('canvas'); o.width = w * ${SCALE}; o.height = h * ${SCALE};
  const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(cv, x0, y0, w, h, 0, 0, o.width, o.height);
  return { png: o.toDataURL('image/png').split(',')[1], tile: { x: p.x, y: p.y }, cam };
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
    const up = await evalJS(cdp, `(() => { try { return !!(typeof World !== 'undefined' && World._dbgCouchSit && typeof Build !== 'undefined' && Build.__test__ && document.getElementById('screen-game') && document.getElementById('screen-game').classList.contains('active')); } catch (e) { return false; } })()`).catch(() => false);
    if (up) break;
  }
  const raf = await evalJS(cdp, `new Promise(res => { let n = 0; const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else res(n); };
    requestAnimationFrame(tick); })`);
  console.log('[reclinershot] rAF frames in 1s: ' + raf);
  if (!(raf > 10)) await die('RECLINERSHOT INCONCLUSIVE — world clock frozen', 4);

  const placed = await evalJS(cdp, PLACE);
  if (!placed || placed.error) await die('[reclinershot] ' + JSON.stringify(placed), 3);
  console.log('[reclinershot] placed: ' + JSON.stringify(placed));

  console.log('[reclinershot] crt cleaned for readback: ' + await evalJS(cdp, CLEAN));
  await sleep(1500);   // let the fit camera settle before any crop is computed

  // ONE body, seated on each prop in turn: the hero's roam zone provably covers the whole lounge,
  // so a failure here is the SEAT, never a zone accident on some crew body's anchor.
  const hero = await evalJS(cdp, `(World.bodies().find(b => b && b.hero) || {}).id || null`);
  console.log('[reclinershot] hero: ' + hero);
  for (const t of ['recliner', 'recliner_r', 'couch']) {
    const seated = await evalJS(cdp, SEAT(hero, t));
    console.log('[reclinershot] seat ' + t + ': ' + JSON.stringify(seated));
    await sleep(1800);   // arrive() + settle
    const pose = await evalJS(cdp, `(() => { const b = World.bodies().find(x => x && x.hero) || {}; return { goal: b.goal, sitting: b.sitting, dir: b.dir, tile: b.tile, renderTile: b.renderTile }; })()`);
    console.log('[reclinershot] pose on ' + t + ': ' + JSON.stringify(pose));
    const shot = await evalJS(cdp, CROP(t, 2));
    if (!shot || shot.error) { console.error('[reclinershot] crop ' + t + ': ' + JSON.stringify(shot)); continue; }
    writeFileSync(join(OUT, t + '.png'), Buffer.from(shot.png, 'base64'));
    console.log('[reclinershot] shot -> ' + join(OUT, t + '.png') + '  tile=' + JSON.stringify(shot.tile));
  }
} catch (e) {
  await die('[reclinershot] ' + String(e && e.stack || e), 1);
}
try { proc && proc.kill(); } catch {}
try { side && side.kill(); } catch {}
process.exit(0);
