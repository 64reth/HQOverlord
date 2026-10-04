#!/usr/bin/env node
// dev/floorseam-live.mjs — the seam fix, proved on the REAL game canvas.
//
// dev/floorseam.mjs bakes offscreen; this drives the LIVE app: it lays two abutting HAB rooms
// through the same validated mutation API REFIT uses (Build.__test__.station()), lets the world
// rebake and re-render on its own rAF loop, then reads pixels back out of #stage — the canvas the
// Commander is actually looking at — and reports the luma profile straight across the join.
//
//   node dev/floorseam-live.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8958';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9358);
const URL = `http://127.0.0.1:${PORT}/`;

const PLACE = `(() => {
  const st = (typeof Build !== 'undefined' && Build.__test__) ? Build.__test__.station() : null;
  if (!st) return JSON.stringify({ error: 'no live station (Build.__test__ unavailable)' });
  const b = st.bounds();
  const y1 = b.minTy, y2 = b.minTy + 7;
  const x0 = b.maxTx + 3;
  const P = st.addRoom({ kind: 'hab', rects: [{ x1: x0,      y1, x2: x0 + 9,  y2 }] });
  const Q = st.addRoom({ kind: 'hab', rects: [{ x1: x0 + 10, y1, x2: x0 + 19, y2 }] });
  World.rebake(); World.refit();
  return JSON.stringify({ P, Q, x0, y1, y2, bounds: b });
})()`;

// world→canvas: the renderer does setTransform(scale,0,0,scale,panX,panY) then drawImage(bake,0,0),
// so a bake-local pixel maps to px*scale + pan. Tiles here are LOCAL (the zoneGrid frame), which is
// the frame projectGeometry().allRects already speaks.
const SAMPLE = (seamX, rowY) => `((seamWorldX, rowsWorldY) => {
  const st = Build.__test__.station();
  const geo = st.projectGeometry(), T = geo.TILE, cam = World.cameraDbg();
  const lx = seamWorldX - geo.origin.tx, ly = rowsWorldY - geo.origin.ty;
  const cv = document.getElementById('stage');
  const g = cv.getContext('2d');
  const cx = Math.round(lx * T * cam.scale + cam.panX);
  const cy = Math.round((ly + 0.5) * T * cam.scale + cam.panY);
  const half = Math.round(8 * T * cam.scale);
  const x0 = Math.max(0, cx - half), w = Math.min(cv.width - x0, half * 2);
  const h = Math.max(1, Math.round(3 * T * cam.scale));
  if (w < 8 || cy < 0 || cy + h > cv.height) return JSON.stringify({ error: 'seam off-canvas', cx, cy, cw: cv.width, ch: cv.height, cam });
  const d = g.getImageData(x0, cy, w, h).data;
  const prof = [];
  for (let c = 0; c < w; c++) {
    let s = 0;
    for (let r = 0; r < h; r++) { const i = ((r * w) + c) * 4; s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
    prof.push(+(s / h).toFixed(2));
  }
  /* The CRT pass warps the composited frame, so the seam does not land exactly on the predicted
     column. Don't chase it: the question is "is there a bright vertical line ANYWHERE across this
     join", so take the window's brightest column and compare it to the deck's median. A seam that
     has blended has no column standing out — brightest ≈ median. */
  const seamIdx = cx - x0;
  const med = prof.slice().sort((a, b) => a - b)[Math.floor(prof.length / 2)];
  let maxIdx = 0; for (let i = 0; i < prof.length; i++) if (prof[i] > prof[maxIdx]) maxIdx = i;
  const near = prof.slice(Math.max(0, maxIdx - 4), maxIdx + 5);
  const shot = (() => { const o = document.createElement('canvas'); o.width = w * 3; o.height = h * 3;
    const og = o.getContext('2d'); og.imageSmoothingEnabled = false;
    og.drawImage(cv, x0, cy, w, h, 0, 0, w * 3, h * 3); return o.toDataURL('image/png').split(',')[1]; })();
  return JSON.stringify({ cam, T, predictedSeamIdx: seamIdx, brightestIdx: maxIdx, deckMedian: +med.toFixed(2),
    brightestColumn: prof[maxIdx], ratio: +(prof[maxIdx] / med).toFixed(3), near, shot });
})(${seamX}, ${rowY})`;

const scratch = mkdtempSync(join(tmpdir(), 'seamlive-'));
materializeSeedWorkspace(scratch);
const side = bootSeededSidecar({ port: PORT, scratchDir: scratch });
await waitUp(URL);
const { proc } = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
await sleep(1200);
const cdp = await connectCDP(CDP_PORT);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL });
const die = async (msg, code) => { console.error(msg); try { proc.kill(); } catch {} try { side.kill(); } catch {} process.exit(code); };
if (!(await waitDevReady(cdp, evalJS, { url: URL }))) await die('floorseam-live: dev harness never became ready — re-run.', 2);

const placed = JSON.parse(await evalJS(cdp, PLACE));
if (placed.error) await die('floorseam-live: ' + placed.error, 3);
console.log('placed: ' + JSON.stringify(placed));
await sleep(2500);   // let the model emit, the world rebake, and the fit camera settle

const seamWorldX = placed.x0 + 10;                    // the shared boundary between the two rooms
const rowWorldY = Math.round((placed.y1 + placed.y2) / 2);
const out = JSON.parse(await evalJS(cdp, SAMPLE(seamWorldX, rowWorldY)));
if (out.error) await die('floorseam-live: ' + JSON.stringify(out), 4);
const dir = process.env.SKYNET_SEAM_DIR || join(process.cwd(), '.floorseam-live');
mkdirSync(dir, { recursive: true });
if (out.shot) writeFileSync(join(dir, 'live-seam.png'), Buffer.from(out.shot, 'base64'));
delete out.shot;
console.log(JSON.stringify(out, null, 1));
console.error('shot → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
