#!/usr/bin/env node
// dev/wallcorner-live.mjs — render Andrew's LIVE station (agent.save.json) through the current
// bake and dump NN-zoomed crops around every chamfer/junction, to locate the "wall texture curves
// then gets cut off" defect he circled on 2026-08-13. Pattern per dev/walljoin-live.mjs.
//
//   node dev/wallcorner-live.mjs                 # all chamfer crops + whole
//   SKYNET_CROP="x,y,w,h" node dev/wallcorner-live.mjs   # one explicit crop (bake px)
//   SKYNET_ZOOM=8 node dev/wallcorner-live.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8984';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9384);
const URL = `http://127.0.0.1:${PORT}/`;
const ZOOM = Number(process.env.SKYNET_ZOOM || 6);
const ONLY = process.env.SKYNET_CROP || '';

const savePath = join(process.env.APPDATA, 'ai.skynet.harness', 'workspaces', 'agent.save.json');
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const stationDoc = save.doc && save.doc.station;
if (!stationDoc) { console.error('no .doc.station in save'); process.exit(2); }

const PROBE = `(() => {
  const doc = ${JSON.stringify(JSON.stringify(stationDoc))};
  const ZOOM = ${ZOOM};
  const ONLY = ${JSON.stringify(ONLY)};
  const st = WorldModel.deserialize(JSON.parse(doc));
  const geo = st.projectGeometry();
  // ATTRIBUTION: drop named chamfers ("22,17;23,19") or all of them ("*") before baking. geo.chamfers
  // is a plain array on the projected geometry, so a hypothesis can be tested with zero shipped-code
  // edits — see the hallway-corner lane.
  const DROP = ${JSON.stringify(process.env.SKYNET_DROP_CHAMFER || '')};
  if (DROP === '*') geo.chamfers = [];
  else if (DROP) { const kill = new Set(DROP.split(';')); geo.chamfers = geo.chamfers.filter(c => !kill.has(c[0] + ',' + c[1])); }
  const bk = StationBake.bake(geo);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const lit = mk(bk.W, bk.H);
  lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);

  // NN-zoomed crop of the composited station, over magenta so unpainted void is unmistakable.
  const RULER = ${process.env.SKYNET_RULER ? 1 : 0};
  const crop = (x, y, w, h) => {
    const o = mk(w * ZOOM, h * ZOOM);
    o.g.fillStyle = '#ff00ff'; o.g.fillRect(0, 0, w * ZOOM, h * ZOOM);
    o.g.drawImage(lit.c, x, y, w, h, 0, 0, w * ZOOM, h * ZOOM);
    if (RULER) {
      // TILE RULER — gridlines on the bake's own tile lattice, labelled in tile coords, so a pixel
      // in the crop can be named exactly instead of guessed at from its position in the image.
      const T = geo.TILE;
      o.g.font = '11px monospace'; o.g.lineWidth = 1;
      for (let bx = Math.ceil(x / T) * T; bx < x + w; bx += T) {
        o.g.strokeStyle = 'rgba(0,255,255,0.55)';
        o.g.beginPath(); o.g.moveTo((bx - x) * ZOOM + 0.5, 0); o.g.lineTo((bx - x) * ZOOM + 0.5, h * ZOOM); o.g.stroke();
        o.g.fillStyle = '#00ffff'; o.g.fillText('x' + (bx / T), (bx - x) * ZOOM + 2, 11);
      }
      for (let by = Math.ceil(y / T) * T; by < y + h; by += T) {
        o.g.strokeStyle = 'rgba(255,220,0,0.55)';
        o.g.beginPath(); o.g.moveTo(0, (by - y) * ZOOM + 0.5); o.g.lineTo(w * ZOOM, (by - y) * ZOOM + 0.5); o.g.stroke();
        o.g.fillStyle = '#ffdd00'; o.g.fillText('y' + (by / T), 2, (by - y) * ZOOM + 11);
      }
    }
    return o.c.toDataURL('image/png').split(',')[1];
  };

  const out = { W: bk.W, H: bk.H, T: geo.TILE, pad: geo.pad ?? null, crops: [] };
  out.rects = geo.allRects.map(r => ({ z: r.z, kind: r.kind || null, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }));
  out.chamfers = (geo.chamfers || []).map(c => ({ x: c[0], y: c[1], kind: c[2] }));

  if (ONLY) {
    ONLY.split(';').forEach((spec, i) => {
      const [x, y, w, h] = spec.split(',').map(Number);
      out.crops.push({ name: 'crop' + i, x, y, w, h, png: crop(x, y, w, h) });
    });
  } else {
    // one window per chamfer, centred on the corner tile
    const T = geo.TILE, R = 3; // tiles of context each way
    (geo.chamfers || []).forEach((c, i) => {
      const cx = c[0], cy = c[1], kind = c[2];
      const x = Math.max(0, cx * T - R * T), y = Math.max(0, cy * T - R * T);
      const w = Math.min(bk.W - x, (2 * R + 1) * T), h = Math.min(bk.H - y, (2 * R + 1) * T);
      out.crops.push({ name: 'ch' + String(i).padStart(2, '0') + '_' + kind + '_' + cx + 'x' + cy, x, y, w, h, png: crop(x, y, w, h) });
    });
  }
  // COLUMN PROFILE — for a given tile column band, walk down and report every colour run, on the
  // BASE canvas (the light pass tints everything and hides attribution).
  const CENSUS = ${JSON.stringify(process.env.SKYNET_CENSUS || '')};
  if (CENSUS) {
    const bcv = mk(bk.W, bk.H); bcv.g.drawImage(bk.baseCv, 0, 0);
    const hex = (d, i) => d[i + 3] === 0 ? 'VOID' : '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
    out.census = CENSUS.split(';').map(spec => {
      const [x, y0, y1] = spec.split(',').map(Number);
      const d = bcv.g.getImageData(x, y0, 1, y1 - y0).data;
      const runs = [];
      for (let i = 0; i < y1 - y0; i++) {
        const c = hex(d, i * 4);
        if (runs.length && runs[runs.length - 1].c === c) runs[runs.length - 1].n++;
        else runs.push({ y: y0 + i, c, n: 1 });
      }
      return { x, runs };
    });
  }
  /* THE HYPOTHESIS, ENUMERATED. A chamfer's crown ring runs on past the arc as a straight tail that
     expects the adjacent STRAIGHT wall's crown to continue it. That straight wall only paints a crown
     when it is EXTERIOR. Where a neighbouring room sits flush against it the tail hands off to
     nothing and stops dead in the void — the "curves, then gets cut off" Andrew circled. */
  {
    const voidAt = (x, y) => {
      if (x < 0 || y < 0) return true;
      const i = geo.idx(x, y);
      return i == null || i < 0 || i >= geo.zoneGrid.length ? true : geo.zoneGrid[i] == null;
    };
    // for each corner: the two straight walls it hands off to, and whether each is exterior there
    /* (armDx, armDy) steps from the corner to the tile the straight wall continues on; (vx, vy)
       steps from THAT tile to the one that must be void for it to be an exterior wall — i.e. the
       direction the wall faces, which is a property of the SIDE, not of the corner. Getting that
       second pair from the corner's own diagonal instead read a tile one row off and mis-scored
       every arm; the numbers it produced were wrong and are not to be trusted anywhere. */
    const NEIGH = {
      tl: [['w', 0, 1, -1, 0], ['n', 1, 0, 0, -1]],
      tr: [['e', 0, 1, 1, 0], ['n', -1, 0, 0, -1]],
      bl: [['w', 0, -1, -1, 0], ['s', 1, 0, 0, 1]],
      br: [['e', 0, -1, 1, 0], ['s', -1, 0, 0, 1]],
    };
    out.corners = (geo.chamfers || []).map(([cx, cy, kind]) => {
      const own = geo.zoneGrid[geo.idx(cx, cy)];
      const arms = NEIGH[kind].map(([side, sx, sy, vx, vy]) => {
        const nx = cx + sx, ny = cy + sy;
        const sameRoom = !voidAt(nx, ny) && geo.zoneGrid[geo.idx(nx, ny)] === own;
        return { side, at: nx + ',' + ny, sameRoom, exterior: sameRoom && voidAt(nx + vx, ny + vy) };
      });
      /* An interior arm is only HALF the condition. The orphan tail is the row dual's t <= 0 branch,
         and that branch only exists when the arc's centre is LIFTED above the corner point — which
         cornerArcCy does for tl/tr ONLY. On a bottom corner cy === ay, so t = py + 0.5 - ay is never
         <= 0 and there is no straight tail to leave hanging. Reporting bl/br as orphans sent me
         hunting a defect that cannot occur there.
         (No backticks in this comment: it lives inside the PROBE template literal.) */
      const lifted = kind === 'tl' || kind === 'tr';
      const interior = arms.filter(a => a.sameRoom && !a.exterior).map(a => a.side);
      return { kind, at: cx + ',' + cy, zone: own, arms, interiorArms: interior, orphan: lifted ? interior : [] };
    });
  }
  out.whole = lit.c.toDataURL('image/png').split(',')[1];

  // LABELLED OVERLAY at 3x — rect outlines + room ids + a 5-tile grid, so a screenshot Andrew
  // circled can be mapped to exact tile coordinates instead of guessed at.
  {
    const Z = 3, T = geo.TILE;
    const o = mk(bk.W * Z, bk.H * Z);
    o.g.drawImage(lit.c, 0, 0, bk.W * Z, bk.H * Z);
    o.g.lineWidth = 1;
    o.g.strokeStyle = 'rgba(0,255,255,0.30)';
    for (let tx = 0; tx <= Math.ceil(bk.W / T); tx += 5) { o.g.beginPath(); o.g.moveTo(tx * T * Z, 0); o.g.lineTo(tx * T * Z, bk.H * Z); o.g.stroke(); }
    for (let ty = 0; ty <= Math.ceil(bk.H / T); ty += 5) { o.g.beginPath(); o.g.moveTo(0, ty * T * Z); o.g.lineTo(bk.W * Z, ty * T * Z); o.g.stroke(); }
    o.g.strokeStyle = 'rgba(255,80,0,0.85)';
    o.g.font = '10px monospace'; o.g.fillStyle = '#ffdd00';
    for (const r of geo.allRects) {
      o.g.strokeRect(r.x1 * T * Z, r.y1 * T * Z, (r.x2 - r.x1 + 1) * T * Z, (r.y2 - r.y1 + 1) * T * Z);
      o.g.fillText(String(r.z), r.x1 * T * Z + 3, r.y1 * T * Z + 11);
    }
    o.g.fillStyle = '#00ff00';
    for (const c of (geo.chamfers || [])) o.g.fillText(c[2], c[0] * T * Z + 2, c[1] * T * Z + 30);
    o.g.fillStyle = 'rgba(0,255,255,0.9)'; o.g.font = '9px monospace';
    for (let tx = 0; tx <= Math.ceil(bk.W / T); tx += 5) for (let ty = 0; ty <= Math.ceil(bk.H / T); ty += 5) o.g.fillText(tx + ',' + ty, tx * T * Z + 2, ty * T * Z + 9);
    out.overlay = o.c.toDataURL('image/png').split(',')[1];
  }
  return JSON.stringify(out);
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'wallcorner-'));
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
  console.error('wallcorner: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_WALLCORNER_DIR || join(process.cwd(), 'dev', '.shots-wallcorner');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'whole.png'), Buffer.from(data.whole, 'base64'));
if (data.overlay) writeFileSync(join(dir, 'overlay.png'), Buffer.from(data.overlay, 'base64'));
for (const c of data.crops) writeFileSync(join(dir, c.name + '.png'), Buffer.from(c.png, 'base64'));
const meta = { W: data.W, H: data.H, T: data.T, pad: data.pad, rects: data.rects, chamfers: data.chamfers, corners: data.corners, crops: data.crops.map(({ png, ...r }) => r) };
if (data.corners) {
  const bad = data.corners.filter(c => c.orphan.length);
  console.log('CORNERS ' + data.corners.length + '  ORPHAN-TAIL ' + bad.length);
  for (const c of bad) console.log('  ' + c.kind + '@' + c.at + ' zone=' + c.zone + ' orphan-arms=' + c.orphan.join(',') + '  ' + c.arms.map(a => a.side + '(' + a.at + ' same=' + a.sameRoom + ' ext=' + a.exterior + ')').join(' '));
}
writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 1));
if (data.census) for (const col of data.census) console.log('x=' + col.x + '  ' + col.runs.map(r => 'y' + r.y + (r.n > 1 ? '..' + (r.y + r.n - 1) : '') + ':' + r.c).join('  '));
else console.log(JSON.stringify({ W: data.W, H: data.H, T: data.T, pad: data.pad, crops: data.crops.length, chamfers: data.chamfers.length }, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
