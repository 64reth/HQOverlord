#!/usr/bin/env node
// dev/shellglitch.mjs — reproduce "changing a shell glitches / half-renders / breaks OTHER rooms".
//
// Three questions, each answered by a pixel diff against the bake that is by definition correct
// (a fresh monolithic bake of the final geometry):
//   A  CHUNK PARITY WITH MORE THAN ONE SKIN — the chunk test only ever baked one hull group.
//   B  INCREMENTAL RE-CLAD — bake, change one room's skin, bakeIncremental with that room's rects.
//   C  SECOND RE-CLAD — do it again on another room; this is where Andrew says it falls apart.
//
//   node dev/shellglitch.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8966';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9366);
const URL = `http://127.0.0.1:${PORT}/`;

// Andrew's own geometry
const ROOMS = [
  [0, 0, 17, 10], [-5, 2, -1, 8], [18, 2, 22, 8], [4, -3, 13, -1], [4, 11, 13, 13],
  [23, 3, 25, 7], [-8, 3, -6, 6], [6, 14, 11, 16], [6, -6, 11, -4]
];

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const build = () => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    for (const id of st.doc().order.slice()) st.removeRoom(id);
    const ids = [];
    for (const [x1, y1, x2, y2] of ${JSON.stringify(ROOMS)}) ids.push(st.addRoom({ kind: 'hab', rects: [{ x1, y1, x2, y2 }] }).id);
    return { st, ids };
  };
  const flat = (bk) => {   // composite whatever bake() / bakeIncremental() returned into one canvas
    const o = mk(bk.W, bk.H);
    o.g.fillStyle = '#000'; o.g.fillRect(0, 0, bk.W, bk.H);
    StationBake.drawBase(o.g, bk, 0, 0);
    StationBake.drawLight(o.g, bk, 0, 0);
    return o;
  };
  const diff = (A, B) => {
    const da = A.g.getImageData(0, 0, A.c.width, A.c.height).data;
    const db = B.g.getImageData(0, 0, B.c.width, B.c.height).data;
    let n = 0, minY = 1e9, maxY = -1, minX = 1e9, maxX = -1;
    const W = A.c.width;
    for (let i = 0; i < da.length; i += 4) {
      if (Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2]) > 6) {
        n++; const p = i >> 2, x = p % W, y = (p / W) | 0;
        if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
      }
    }
    return { n, box: n ? [minX, minY, maxX, maxY] : null };
  };
  const out = {};

  // ---- A: chunk parity with FOUR skins ----
  {
    const { st, ids } = build();
    st.setHull(ids[1], { mat: 'timber', style: 'walnut' });
    st.setHull(ids[2], { mat: 'brick', style: 'rust' });
    st.setHull(ids[6], { mat: 'stone', style: 'sterile' });
    st.setHull(ids[8], { mat: 'clapboard', style: 'bone' });
    const geo = st.projectGeometry();
    const mono = flat(StationBake.bake(geo));
    const chunked = flat(StationBake.bakeIncremental(geo, null, null, {}));
    out.A_multiSkinChunkParity = diff(mono, chunked);
  }

  // ---- B / C: incremental re-clad ----
  {
    const { st, ids } = build();
    let prev = StationBake.bakeIncremental(st.projectGeometry(), null, null, {});
    // B — clad ONE room, invalidate only its rects (what setHull's emit gives the renderer)
    st.setHull(ids[1], { mat: 'timber', style: 'walnut' });
    let geo = st.projectGeometry();
    prev = StationBake.bakeIncremental(geo, prev, st.doc().rooms[ids[1]].rects, {});
    out.B_afterFirstReclad = diff(flat(StationBake.bake(geo)), flat(prev));
    // C — clad a SECOND room the same way
    st.setHull(ids[2], { mat: 'brick', style: 'rust' });
    geo = st.projectGeometry();
    prev = StationBake.bakeIncremental(geo, prev, st.doc().rooms[ids[2]].rects, {});
    out.C_afterSecondReclad = diff(flat(StationBake.bake(geo)), flat(prev));
    const shot = flat(prev), ref = flat(StationBake.bake(geo));
    out.crops = { c_incremental: shot.c.toDataURL('image/png').split(',')[1],
                  c_correct: ref.c.toDataURL('image/png').split(',')[1] };
  }
  return JSON.stringify(out);
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellglitch-'));
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
  console.error('shellglitch: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellglitch');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops || {})) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
