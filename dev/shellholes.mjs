#!/usr/bin/env node
// dev/shellholes.mjs — FUZZ THE SHELL FOR HOLES.
//
// Objective detector for "the shell just didn't render": for every footprint, walk the `skirt` rows
// below its south edge and count pixels that are TRANSPARENT in the base bake. A skirt is opaque by
// construction, so any transparent pixel under a footprint is the backdrop showing through — which
// is exactly what Andrew circled.
//
// Runs over many generated layouts (varied room sizes, adjacency, corridors) with random skins,
// because the defect only appears with several groups packed together. Also re-checks chunk parity
// per layout. Prints the worst offenders and dumps their render.
//
//   node dev/shellholes.mjs [trials]
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8968';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9368);
const URL = `http://127.0.0.1:${PORT}/`;
const TRIALS = Number(process.argv[2] || 24);

const PROBE = `(async () => {
  const TRIALS = ${TRIALS};
  const SKINS = [['station',null],['timber','walnut'],['brick','rust'],['clapboard','bone'],
    ['shingle','ember'],['stone','sterile'],['stucco','amber'],['curtain','cobalt'],['hedge','fern']];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  // deterministic PRNG so a failing trial can be re-run by seed
  const rng = s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

  function layout(seed) {
    const R = rng(seed), st = WorldModel.create(WorldModel.defaultDoc());
    for (const id of st.doc().order.slice()) st.removeRoom(id);
    /* ROOMS THAT TOUCH. Andrew's station is one packed blob with corridors through it, and every
       earlier probe used ISLANDS separated by a gap — which is precisely the case where skirts do
       not contend. Grow the layout by budding each new room off an existing edge. */
    // removeRoom refuses to delete the LAST room, so the survivor is the seed we bud from
    const ids = [], placed = [];
    for (const id of st.doc().order) { const r = st.doc().rooms[id].rects[0]; ids.push(id); placed.push({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }); }
    const n = 4 + Math.floor(R() * 6);
    for (let i = 0; i < n && placed.length; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const host = placed[Math.floor(R() * placed.length)];
        const w = 2 + Math.floor(R() * 9), h = 2 + Math.floor(R() * 6);
        const side = Math.floor(R() * 4);
        let x1, y1;
        if (side === 0) { x1 = host.x1 + Math.floor(R() * 4) - 1; y1 = host.y1 - h - 1; }        // north, flush
        else if (side === 1) { x1 = host.x1 + Math.floor(R() * 4) - 1; y1 = host.y2 + 1; }        // south, flush
        else if (side === 2) { x1 = host.x1 - w - 1; y1 = host.y1 + Math.floor(R() * 3) - 1; }    // west
        else { x1 = host.x2 + 1; y1 = host.y1 + Math.floor(R() * 3) - 1; }                        // east
        const r = { x1, y1, x2: x1 + w, y2: y1 + h };
        if (placed.some(p => !(r.x2 < p.x1 || r.x1 > p.x2 || r.y2 < p.y1 || r.y1 > p.y2))) continue;
        const made = st.addRoom({ kind: 'hab', rects: [r] });
        if (made && made.id) { ids.push(made.id); placed.push(r); }
        break;
      }
    }
    // ...and a corridor or two through the middle, which every earlier probe also lacked
    if (typeof st.placeHallway === 'function' && placed.length > 1) {
      const a = placed[0];
      const cx = a.x1 + 1 + Math.floor(R() * Math.max(1, a.x2 - a.x1 - 2));
      const c = { x1: cx, y1: a.y2 + 1, x2: cx + 1, y2: a.y2 + 3 + Math.floor(R() * 4) };
      if (!placed.some(p => !(c.x2 < p.x1 || c.x1 > p.x2 || c.y2 < p.y1 || c.y1 > p.y2))) {
        const m = st.placeHallway({ rects: [c] });
        if (m && m.id) { ids.push(m.id); placed.push(c); }
      }
    }
    if (!ids.length) return null;
    for (const id of ids) { const s = SKINS[Math.floor(R() * SKINS.length)]; if (s[0] !== 'station') st.setHull(id, { mat: s[0], style: s[1] }); }
    return { st, ids };
  }

  const SKIRT = 32;
  function holes(geo, bk) {
    // base only — a transparent base pixel under a footprint is backdrop showing through
    const o = mk(bk.W, bk.H);
    StationBake.drawBase(o.g, bk, 0, 0);
    const d = o.g.getImageData(0, 0, bk.W, bk.H).data, T = geo.TILE;
    let n = 0, worst = null;
    for (const r of geo.allRects) {
      const y0 = (r.y2 + 1) * T, x0 = r.x1 * T, x1 = (r.x2 + 1) * T;
      for (let y = y0; y < Math.min(bk.H, y0 + SKIRT); y++) {
        for (let x = Math.max(0, x0); x < Math.min(bk.W, x1); x++) {
          if (!d[(((y * bk.W) + x) << 2) + 3]) { n++; if (!worst) worst = [x, y, r.z]; }
        }
      }
    }
    return { n, worst };
  }

  const out = [];
  for (let t = 0; t < TRIALS; t++) {
    const L = layout(1000 + t * 7919);
    if (!L) continue;
    const geo = L.st.projectGeometry();
    const bk = StationBake.bake(geo);
    const h = holes(geo, bk);
    // chunk parity
    const flat = b => { const o = mk(b.W, b.H); o.g.fillStyle = '#000'; o.g.fillRect(0, 0, b.W, b.H); StationBake.drawBase(o.g, b, 0, 0); StationBake.drawLight(o.g, b, 0, 0); return o; };
    const A = flat(bk), B = flat(StationBake.bakeIncremental(geo, null, null, {}));
    const da = A.g.getImageData(0, 0, A.c.width, A.c.height).data, db = B.g.getImageData(0, 0, B.c.width, B.c.height).data;
    let par = 0, box = null;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]) > 6) {
      par++; const p = i >> 2, x = p % A.c.width, y = (p / A.c.width) | 0;
      if (!box) box = [x, y, x, y]; else { if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; }
    }
    // the same layout through TRUNK-BEFORE, so we know whether the ownership pass introduced it
    let parBefore = null;
    if (window.StationBakeBefore) {
      const bkB = window.StationBakeBefore.bake(geo);
      const fb = b => { const o = mk(b.W, b.H); o.g.fillStyle = '#000'; o.g.fillRect(0, 0, b.W, b.H); window.StationBakeBefore.drawBase(o.g, b, 0, 0); window.StationBakeBefore.drawLight(o.g, b, 0, 0); return o; };
      const A2 = fb(bkB), B2 = fb(window.StationBakeBefore.bakeIncremental(geo, null, null, {}));
      const d1 = A2.g.getImageData(0, 0, A2.c.width, A2.c.height).data, d2 = B2.g.getImageData(0, 0, B2.c.width, B2.c.height).data;
      parBefore = 0; for (let i = 0; i < d1.length; i += 4) if (Math.abs(d1[i]-d2[i])+Math.abs(d1[i+1]-d2[i+1])+Math.abs(d1[i+2]-d2[i+2]) > 6) parBefore++;
    }
    out.push({ trial: t, rooms: L.ids.length, holePx: h.n, at: h.worst, parityPx: par, parityBox: box, parityPxBefore: parBefore, chunkPx: StationBake.CHUNK_PX });
  }
  out.sort((a, b) => (b.holePx - a.holePx) || (b.parityPx - a.parityPx));
  // render the worst trial
  let crop = null;
  if (out.length && (out[0].holePx > 0 || out[0].parityPx > 0)) {
    const L = layout(1000 + out[0].trial * 7919);
    const geo = L.st.projectGeometry(), bk = StationBake.bake(geo);
    const fl = b => { const o = mk(b.W, b.H); o.g.fillStyle='#000'; o.g.fillRect(0,0,b.W,b.H); StationBake.drawBase(o.g,b,0,0); StationBake.drawLight(o.g,b,0,0); return o; };
    const MA = fl(bk), MB = fl(StationBake.bakeIncremental(geo, null, null, {}));
    const xa = MA.g.getImageData(0,0,MA.c.width,MA.c.height), xb = MB.g.getImageData(0,0,MB.c.width,MB.c.height);
    const dv = mk(MA.c.width, MA.c.height), od = dv.g.createImageData(MA.c.width, MA.c.height);
    for (let i=0;i<xa.data.length;i+=4){ const on = Math.abs(xa.data[i]-xb.data[i])+Math.abs(xa.data[i+1]-xb.data[i+1])+Math.abs(xa.data[i+2]-xb.data[i+2])>6; od.data[i]=on?255:xa.data[i]>>2; od.data[i+1]=on?60:xa.data[i+1]>>2; od.data[i+2]=on?30:xa.data[i+2]>>2; od.data[i+3]=255; }
    dv.g.putImageData(od,0,0);
    window.__parityPng = dv.c.toDataURL('image/png').split(',')[1];
    const o = mk(bk.W, bk.H);
    o.g.fillStyle = '#7a1030'; o.g.fillRect(0, 0, bk.W, bk.H);   // magenta shows through every hole
    StationBake.drawBase(o.g, bk, 0, 0); StationBake.drawLight(o.g, bk, 0, 0);
    const z = mk(bk.W * 2, bk.H * 2); z.g.imageSmoothingEnabled = false;
    z.g.drawImage(o.c, 0, 0, bk.W * 2, bk.H * 2);
    crop = z.c.toDataURL('image/png').split(',')[1];
  }
  return JSON.stringify({
    layoutErr: window.__layoutErr || null,
    trials: out.length,
    trialsWithHoles: out.filter(o => o.holePx > 0).length,
    trialsWithParityBreak: out.filter(o => o.parityPx > 0).length,
    top: out.slice(0, 8),
    crops: Object.assign(crop ? { worst: crop } : {}, window.__parityPng ? { parity: window.__parityPng } : {})
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellholes-'));
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
  console.error('shellholes: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
import { readFileSync, existsSync } from 'node:fs';
if (existsSync('.before.js')) await evalJS(cdp, readFileSync('.before.js', 'utf8') + '\n;"ok"');
const data = JSON.parse(await evalJS(cdp, PROBE, { awaitPromise: true }));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellholes');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops || {})) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
