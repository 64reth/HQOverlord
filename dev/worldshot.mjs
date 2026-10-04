#!/usr/bin/env node
/* dev/worldshot.mjs — the LIVE world frame on a FURNISHED station, for before/after art judgement.
 *
 * The seeded station is one nearly empty hab: a look comparison shot on it proves nothing. This
 * stages a furnished LOUNGE (oak plank + walnut wainscot — the shipped "deck is the room" choice),
 * a STOCK hab (the default hull/spine/bulkhead every new station starts on) with a desk and crew,
 * and a corridor between them; loads it into the live World; forces an EXACT integer camera zoom
 * on each room; freezes the loop; and captures the full CRT frame (Page.captureScreenshot) plus
 * per-room crops. Everything the user sees — bake, props, lightmap, glows, barrel warp, scanlines,
 * grain — is in the frame, because it IS the frame.
 *
 *   node dev/worldshot.mjs <tag>            # → .worldshots/<tag>-lounge.png, <tag>-hab.png, <tag>-wide.png
 *   SKYNET_SHOT_PORT=8961 SKYNET_CDP_PORT=9361 SKYNET_WS_ZOOM=2 node dev/worldshot.mjs base
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const TAG = process.argv[2] || 'shot';
const PORT = process.env.SKYNET_SHOT_PORT || '8961';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9361);
const ZOOM = Number(process.env.SKYNET_WS_ZOOM || 2);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_WS_OUT || join(process.cwd(), '.worldshots');

const STAGE = `(() => {
  const doc = WorldModel.defaultDoc();
  const st = WorldModel.create(doc);
  const hab = doc.order[0];                       // the stock 18x11 starter hab, untouched
  const lounge = st.addRoom({ kind: 'quarters', rects: [{ x1: 0, y1: 14, x2: 17, y2: 25 }] });
  if (!lounge.ok) return { error: 'lounge: ' + lounge.error };
  const hall = st.placeHallway({ rects: [{ x1: 7, y1: 11, x2: 9, y2: 13 }] });
  if (!hall.ok) return { error: 'hall: ' + hall.error };
  st.setFloor(lounge.id, 'oak'); st.setMaterial(lounge.id, 'plank'); st.setWalls(lounge.id, { mat: 'wainscot', style: 'walnut' });

  const placed = [], skipped = [];
  const put = (t, x, y) => {
    const c = PropSprites.CATALOG.find(c => c.id === t);
    if (!c) { skipped.push(t + ':NOCAT'); return; }
    const r = st.addProp({ t, x, y, w: c.w, h: c.h, block: !!c.blocks });
    if (r.ok) placed.push(t); else skipped.push(t + ':' + (r.code || r.error));
  };
  // STOCK HAB — a working room: desk + bay + a few capability props, agents at work
  put('desk', 3, 2); put('desk2', 8, 2); put('console', 13, 2);
  put('bay', 1, 7); put('intake', 15, 7); put('rack', 6, 8); put('core', 11, 7); put('shelf', 12, 5);
  // LOUNGE — the furnished room from the 08-17 colour measurement (lounge/decor kinds)
  const loungeIds = PropSprites.CATALOG.filter(c => (c.cat === 'lounge' || c.cat === 'decor') && c.w <= 3 && c.h <= 2 && c.mount !== 'surface').map(c => c.id);
  let cx = 1, cy = 15, rowH = 0;
  for (const id of loungeIds) {
    const c = PropSprites.CATALOG.find(c => c.id === id);
    if (cx + c.w > 17) { cx = 1; cy += rowH + 1; rowH = 0; }
    if (cy + c.h > 25) break;
    put(id, cx, cy); cx += c.w + 1; rowH = Math.max(rowH, c.h);
  }
  World.loadStation(st);
  const crew = [['nova2','VESTA','#7fe9c8'],['ork','ORACLE','#e9a87f'],['sable','SABLE','#a77fe9']];
  for (const [id,name,color] of crew) { try { World.spawnAgent({ id, name, color }); } catch (e) { skipped.push('crew:' + e.message); } }
  return { placed: placed.length, skipped, hab, lounge: lounge.id };
})()`;

// Force an exact camera scale centred on a tile rect, by driving world.js's own wheel handler.
const FRAME = (x1, y1, x2, y2, zoom) => `(() => {
  const cv = document.getElementById('stage');
  const r = cv.getBoundingClientRect();
  const d = World.cameraDbg();
  const T = 16;
  // world px of the rect centre (station-local frame = tile * T, origin already at 0 for a doc whose min tile is 0)
  const wx = ((${x1} + ${x2} + 1) / 2) * T, wy = ((${y1} + ${y2} + 1) / 2) * T;
  // pan so the centre sits at the canvas centre at the TARGET zoom
  const sx = cv.width / r.width, sy = cv.height / r.height;
  const cxc = cv.width / 2, cyc = cv.height / 2;
  // 1) put the target point under the canvas centre at the current scale via a zero-delta wheel? No API — so:
  //    dispatch the wheel at the client point where the target currently is, so zoom is about that point,
  //    then the point stays fixed and we know exactly where it is.
  const curX = d.panX + wx * d.scale, curY = d.panY + wy * d.scale;
  const clientX = r.left + curX / sx, clientY = r.top + curY / sy;
  const deltaY = -Math.log(${zoom} / d.scale) / 0.0015;
  cv.dispatchEvent(new WheelEvent('wheel', { clientX, clientY, deltaY, bubbles: true, cancelable: true }));
  // 2) now pan the target point to the canvas centre with a synthetic drag
  const d2 = World.cameraDbg();
  const nowX = d2.panX + wx * d2.scale, nowY = d2.panY + wy * d2.scale;
  const fromX = r.left + nowX / sx, fromY = r.top + nowY / sy;
  const toX = r.left + cxc / sx, toY = r.top + cyc / sy;
  cv.dispatchEvent(new MouseEvent('mousedown', { clientX: fromX, clientY: fromY, bubbles: true }));
  cv.dispatchEvent(new MouseEvent('mousemove', { clientX: (fromX + toX) / 2, clientY: (fromY + toY) / 2, bubbles: true }));
  cv.dispatchEvent(new MouseEvent('mousemove', { clientX: toX, clientY: toY, bubbles: true }));
  cv.dispatchEvent(new MouseEvent('mouseup', { clientX: toX, clientY: toY, bubbles: true }));
  return JSON.stringify(World.cameraDbg());
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'worldshot-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
if (!(await waitUp(URL))) { console.error('sidecar never came up'); side.kill(); process.exit(2); }
if (process.env.SKYNET_WS_HOLD) { console.log('HOLD: seeded sidecar up at ' + URL + ' — Ctrl-C to stop'); console.log('STAGE=' + JSON.stringify(STAGE)); await new Promise(() => {}); }
const chrome = findChrome();
// SKYNET_WS_GPU=1 keeps the real GPU (ANGLE/D3D11) instead of SwiftShader — the perf probe reports which one ran
const GPU_ARGS = process.env.SKYNET_WS_GPU ? ['--headless=new', '--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] : ['--headless=new', '--disable-gpu'];
const proc = spawn(chrome, [...GPU_ARGS, '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
  '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${CDP_PORT}`, '--window-size=1440,900', `--user-data-dir=${join(scratch, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) { console.error('dev harness never ready'); proc.kill(); side.kill(); process.exit(2); }
await sleep(4500);   // the sprite manifest needs ~4-5s or the crew renders as the procedural fallback
const staged = await evalJS(cdp, STAGE);
console.log('staged:', JSON.stringify(staged));
if (staged && staged.error) { proc.kill(); side.kill(); process.exit(2); }
await sleep(2500);   // rebake + a few frames so bodies settle
/* FRAME COST — how long World's own frame body takes on this station, sampled over ~3s by wrapping
   requestAnimationFrame. Reports the mean and p95 of the rAF-to-rAF interval and of the time the
   frame callback itself spent (the render cost proper). SKYNET_WS_PERF=1 to enable; the number to
   compare across shots is `bodyMean` — the interval is capped by vsync and says little. */
async function perfProbe(tag) {
  if (!process.env.SKYNET_WS_PERF) return;
  const perf = await evalJS(cdp, `new Promise(res => {
    const raf = window.requestAnimationFrame, gaps = [], bodies = [];
    let prev = 0;
    window.requestAnimationFrame = fn => raf(t => { if (prev) gaps.push(t - prev); prev = t; const a = performance.now(); fn(t); bodies.push(performance.now() - a); });
    setTimeout(() => {
      window.requestAnimationFrame = raf;
      const q = (arr, p) => { const s = arr.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : 0; };
      const mean = arr => arr.length ? +(arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(2) : 0;
      let gpu = 'n/a'; try { const g = document.createElement('canvas').getContext('webgl'); const x = g.getExtension('WEBGL_debug_renderer_info'); gpu = x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); } catch (_) {}
      res({ gpu, frames: bodies.length, gapMean: mean(gaps), gapP95: q(gaps, 0.95), bodyMean: mean(bodies), bodyP95: q(bodies, 0.95), stage: [document.getElementById('stage').width, document.getElementById('stage').height] });
    }, 3000);
  })`);
  console.log('perf ' + tag + ':', JSON.stringify(perf));
}
mkdirSync(OUT, { recursive: true });
// VARIANTS — a ladder of look overrides shot from ONE boot. Each entry: { tag, light, crt, depth, css, js }.
//   `js` is raw page code run before the rebake (e.g. retint a FLOOR_STYLES entry).
//   SKYNET_WS_VARIANTS='[{"tag":"warm14","light":{"warm":0.14}},{"tag":"sat","css":"#stage{filter:saturate(1)}"}]'
const VARIANTS = JSON.parse(process.env.SKYNET_WS_VARIANTS || 'null') || [{ tag: TAG }];
for (const V of VARIANTS) {
const TAGV = V.tag || TAG;
await evalJS(cdp, `(() => {
  const st = document.getElementById('ws-css') || Object.assign(document.createElement('style'), { id: 'ws-css' });
  st.textContent = ${JSON.stringify(V.css || '')}; document.head.appendChild(st);
  if (${JSON.stringify(!!V.light)}) Object.assign(StationBake.LIGHT, ${JSON.stringify(V.light || {})});
  if (${JSON.stringify(!!V.depth)}) Object.assign(StationBake.DEPTH, ${JSON.stringify(V.depth || {})});
  if (${JSON.stringify(!!V.crt)}) Object.assign(World.crt, ${JSON.stringify(V.crt || {})});
  ${V.js || ''}
  World.rebake(); return 'variant';
})()`);
await sleep(900);
await perfProbe(TAGV);
const shots = [
  ['wide', null],
  ['hab', [0, 0, 17, 10]],
  ['lounge', [0, 14, 17, 25]],
];
for (const [name, rect] of shots) {
  if (rect) { const cam = await evalJS(cdp, FRAME(...rect, ZOOM)); console.log(name, cam); }
  else { await evalJS(cdp, `World.camPullBack && World.camPullBack(); 'ok'`); }
  await sleep(1400);
  await evalJS(cdp, `(() => { World.stop(); World.start(); World.stop(); return 'frozen'; })()`);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${TAGV}-${name}.png`), Buffer.from(r.data, 'base64'));
  await evalJS(cdp, `World.start(); 'go'`);
  await sleep(200);
}
}
console.error('shots → ' + OUT);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
