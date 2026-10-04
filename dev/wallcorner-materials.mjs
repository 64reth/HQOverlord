#!/usr/bin/env node
// dev/wallcorner-materials.mjs — does the corner-face fix hold for EVERY wall material?
//
// Forces geo.wallMatOf to each recipe in turn (a plain function on the projected geometry, so this
// needs no shipped-code edit — same trick the hallway-corner lane used on geo.chamfers), re-bakes,
// and for each material reports two MEASURED failure modes at a corner, plus a crop to look at:
//
//   voidPx  — unpainted pixels inside the corner's own tile. A corner is solid by construction, so
//             any hole there is the "starfield through the wall" bug. (Windows live in the flat run;
//             the sampled tile is the corner tile itself, which must never be see-through.)
//   flatRun — longest single-colour vertical run in the corner's standing face. This is the
//             "triangle" signature: a clamped depth makes every row sample the same strip row, so a
//             flat slab shows up as a long constant run in a pass that is supposed to be textured.
//
//   node dev/wallcorner-materials.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8986';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9386);
const URL = `http://127.0.0.1:${PORT}/`;
const ZOOM = Number(process.env.SKYNET_ZOOM || 10);

const savePath = join(process.env.APPDATA, 'ai.skynet.harness', 'workspaces', 'agent.save.json');
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const stationDoc = save.doc && save.doc.station;
if (!stationDoc) { console.error('no .doc.station in save'); process.exit(2); }

const PROBE = `(() => {
  const doc = ${JSON.stringify(JSON.stringify(stationDoc))};
  const ZOOM = ${ZOOM};
  const MATS = ['plating','ribbed','panelled','viewport','pipework','wainscot','hedge','bulkhead','courses','service'];
  // corners to score: two TOP corners (the lifted-arc case the fix changed) and one BOTTOM corner
  // (which keeps the polar measure — it must NOT have moved).
  const SPOTS = [
    { name: 'tl@28,3', tx: 28, ty: 3,  cx: 330, cy: 6,  w: 42, h: 48 },
    { name: 'tr@39,3', tx: 39, ty: 3,  cx: 452, cy: 6,  w: 42, h: 48 },
    { name: 'bl@28,13', tx: 28, ty: 13, cx: 330, cy: 150, w: 42, h: 48 },
  ];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const out = { mats: [] };

  for (const mat of MATS) {
    const st = WorldModel.deserialize(JSON.parse(doc));
    const geo = st.projectGeometry();
    geo.wallMatOf = () => mat;                     // force EVERY room onto this recipe
    const bk = StationBake.bake(geo);
    const T = geo.TILE;
    const lit = mk(bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    const base = mk(bk.W, bk.H); base.g.drawImage(bk.baseCv, 0, 0);   // score the BASE: light tints

    const row = { mat, spots: [], crop: null };
    for (const s of SPOTS) {
      // voidPx: unpainted pixels inside the corner's own tile
      const d = base.g.getImageData(s.tx * T, s.ty * T, T, T).data;
      let voidPx = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] === 0) voidPx++;
      // flatRun: longest constant-colour vertical run in the standing face above the corner tile
      const band = base.g.getImageData(s.tx * T, Math.max(0, s.ty * T - 28), T, 28).data;
      let flat = 0;
      for (let x = 0; x < T; x++) {
        let run = 1, prev = null;
        for (let y = 0; y < 28; y++) {
          const i = ((y * T + x) << 2);
          const k = band[i + 3] === 0 ? 'V' : band[i] + ',' + band[i + 1] + ',' + band[i + 2];
          if (k === prev) { run++; if (run > flat) flat = run; } else { run = 1; }
          prev = k;
        }
      }
      row.spots.push({ name: s.name, voidPx, flatRun: flat });
    }
    // one crop per material, at the corner Andrew circled
    const s = SPOTS[0];
    const o = mk(s.w * ZOOM, s.h * ZOOM);
    o.g.fillStyle = '#ff00ff'; o.g.fillRect(0, 0, s.w * ZOOM, s.h * ZOOM);
    o.g.drawImage(lit.c, s.cx, s.cy, s.w, s.h, 0, 0, s.w * ZOOM, s.h * ZOOM);
    row.crop = o.c.toDataURL('image/png').split(',')[1];
    out.mats.push(row);
  }
  return JSON.stringify(out);
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'wcmat-'));
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
  console.error('wcmat: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_WCMAT_DIR || join(process.cwd(), 'dev', '.shots-wcmat');
mkdirSync(dir, { recursive: true });
console.log('material      ' + data.mats[0].spots.map(s => s.name.padEnd(13)).join(''));
for (const m of data.mats) {
  writeFileSync(join(dir, m.mat + '.png'), Buffer.from(m.crop, 'base64'));
  console.log(m.mat.padEnd(14) + m.spots.map(s => ('void=' + s.voidPx + ' flat=' + s.flatRun).padEnd(13)).join(''));
}
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
