#!/usr/bin/env node
// dev/shellrefit.mjs — RE-CLAD A BIG STATION THE WAY REFIT DOES IT.
//
// REFIT caches the bake in CHUNKS and re-bakes only the chunks a change's dirtyRects touch
// (build.js). The shell is a station-wide composite — skins are grouped and every skirt pixel is
// resolved to the nearest footprint above it — so a rect-scoped invalidation leaves distant chunks
// showing the PREVIOUS grouping. This measures exactly that, on a station several chunks wide.
//
// RECT   = the old behaviour (invalidate the edited room's rects)
// GLOBAL = what setHull now emits (invalidate everything)
// Both are compared against a fresh monolithic bake of the same final geometry, which is by
// definition what the station should look like.
//
//   node dev/shellrefit.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8969';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9369);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const flat = bk => { const o = mk(bk.W, bk.H); o.g.fillStyle = '#7a1030'; o.g.fillRect(0, 0, bk.W, bk.H); StationBake.drawBase(o.g, bk, 0, 0); StationBake.drawLight(o.g, bk, 0, 0); return o; };
  const diff = (A, B) => {
    const da = A.g.getImageData(0, 0, A.c.width, A.c.height).data, db = B.g.getImageData(0, 0, B.c.width, B.c.height).data;
    let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]) > 6) n++;
    return n;
  };
  // a station several chunks wide — one long spine with rooms budding off it
  const build = () => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    const ids = st.doc().order.slice();
    for (let i = 0; i < 8; i++) {
      const r = st.addRoom({ kind: 'hab', rects: [{ x1: 20 + i * 9, y1: (i % 2) ? 0 : 12, x2: 27 + i * 9, y2: (i % 2) ? 9 : 20 }] });
      if (r && r.id) ids.push(r.id);
    }
    return { st, ids };
  };
  const SKINS = [['timber','walnut'],['brick','rust'],['stone','sterile'],['clapboard','bone'],['shingle','ember'],['hedge','fern']];

  function run(mode) {
    const { st, ids } = build();
    let cache = StationBake.bakeIncremental(st.projectGeometry(), null, null, {});
    const steps = [];
    SKINS.forEach(([mat, style], k) => {
      const id = ids[1 + k];
      if (!id) return;
      st.setHull(id, { mat, style });
      const geo = st.projectGeometry();
      const rects = mode === 'global' ? null : st.doc().rooms[id].rects;
      cache = StationBake.bakeIncremental(geo, cache, rects, {});
      steps.push(diff(flat(StationBake.bake(geo)), flat(cache)));
    });
    return { steps, W: cache.W, H: cache.H, chunks: cache.chunks ? cache.chunks.length : 0,
             png: flat(cache).c.toDataURL('image/png').split(',')[1] };
  }
  const R = run('rect'), G = run('global');
  return JSON.stringify({
    chunkPx: StationBake.CHUNK_PX, size: [R.W, R.H], chunks: R.chunks,
    rectScoped_diffPxPerReclad: R.steps,
    global_diffPxPerReclad: G.steps,
    crops: { rect_scoped: R.png, global: G.png }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellrefit-'));
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
  console.error('shellrefit: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellrefit');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
