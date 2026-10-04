#!/usr/bin/env node
// dev/hallcorner-nw.mjs — THE corner Andrew circled: a hallway's own NORTH-WEST convex corner.
//
// Not a junction between two halls. In his shot a hallway runs east and another drops south from its
// west end, and the break is the outside corner they share — the corner of the HALLWAY ITSELF.
//
// Hypothesis, straight out of worldmodel.js:1205 — `if (rm.kind === 'corridor') continue;`. Chamfers
// are computed for ROOMS ONLY, so every convex void-exposed corner of a hallway is a raw right angle
// where the tall north face (extruded up-screen by corUp) collides with the flat side band (a top
// surface at floor level) with nothing reconciling them. A room never shows this because a room gets
// the chamfer. That is also why it tracked the 08-08 wall change: the collision is `corUp` tall.
//
// Tested WITHOUT touching the bake: geo.chamfers is a plain array on the projected geometry, so the
// probe can push the corridor's own corners into it and re-bake. If that closes the corner, the fix
// is "give corridors a chamfer"; if it does not, the hypothesis is dead and nothing was changed.
//
//   node dev/hallcorner-nw.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8983';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9383);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake, OX = 40, OY = 40;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };

  // the shape in the photo: a hall east, a hall dropping south from its west end. Shared NW corner.
  const build = () => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    const put = (x1, y1, x2, y2) => {
      const rects = [{ x1: x1 + OX, y1: y1 + OY, x2: x2 + OX, y2: y2 + OY }];
      const res = st.placeHallway({ rects });
      if (!res || !res.id) throw new Error('placement REJECTED ' + JSON.stringify(rects[0]));
    };
    put(6, 6, 18, 7);     // hallway running EAST
    put(6, 8, 7, 18);     // hallway dropping SOUTH from its west end
    return st;
  };

  /* the corridor's own convex, void-exposed corners — the same test worldmodel runs for rooms, just
     never run for hallways. Kept here in the probe so the experiment changes no shipped code. */
  const corridorChamfers = (geo) => {
    const { COLS, ROWS, zoneGrid, idx } = geo;
    const isVoid = (x, y) => (x < 0 || y < 0 || x >= COLS || y >= ROWS) ? true : zoneGrid[idx(x, y)] == null;
    const out = [];
    for (const r of geo.allRects) {
      if (!geo.isCorridor(r.z)) continue;
      if (isVoid(r.x1 - 1, r.y1) && isVoid(r.x1, r.y1 - 1)) out.push([r.x1, r.y1, 'tl']);
      if (isVoid(r.x2 + 1, r.y1) && isVoid(r.x2, r.y1 - 1)) out.push([r.x2, r.y1, 'tr']);
      if (isVoid(r.x1 - 1, r.y2) && isVoid(r.x1, r.y2 + 1)) out.push([r.x1, r.y2, 'bl']);
      if (isVoid(r.x2 + 1, r.y2) && isVoid(r.x2, r.y2 + 1)) out.push([r.x2, r.y2, 'br']);
    }
    return out;
  };

  /* Once the fix shipped, projectGeometry emits the corridor chamfers itself — so "before" can no
     longer be the default, and this probe would have quietly compared the fix against itself. The
     BEFORE panel now STRIPS every corridor chamfer back out, which is exactly the pre-fix geometry;
     the AFTER panel takes whatever the shipped path produces, and never restates it. */
  const shoot = (withCorridorChamfers) => {
    const st = build();
    const geo = st.projectGeometry();
    const isCorTile = (c) => geo.allRects.some(r => geo.isCorridor(r.z) && c[0] >= r.x1 && c[0] <= r.x2 && c[1] >= r.y1 && c[1] <= r.y2);
    if (!withCorridorChamfers) geo.chamfers = geo.chamfers.filter(c => !isCorTile(c));
    const added = withCorridorChamfers ? geo.chamfers.filter(isCorTile) : [];
    const bk = SB.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.fillStyle = '#ff00ff'; lit.g.fillRect(0, 0, bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    return { lit, geo, T: geo.TILE, W: bk.W, H: bk.H, added };
  };

  const off = shoot(false), on = shoot(true);
  const T = off.T;
  // corner read out of the GEOMETRY, never recomputed from the tiles passed in (projectGeometry rebases)
  const hz = off.geo.allRects.filter(r => off.geo.isCorridor(r.z));
  const east = hz.find(r => (r.x2 - r.x1) > (r.y2 - r.y1));
  if (!east) throw new Error('could not find the east-running hallway');
  const CX = east.x1 * T, CY = east.y1 * T;

  const label = (g, t, x, y, w) => {
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(x, y, w, 20);
    g.fillStyle = '#ffcf70'; g.font = '15px VT323, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(t, x + w / 2, y + 10);
  };
  const sheetOf = (pairs, pad, size, Z) => {
    const sx = CX - pad, sy = CY - pad;
    const s = mk(size * Z * pairs.length, size * Z + 20);
    s.g.fillStyle = '#101014'; s.g.fillRect(0, 0, s.c.width, s.c.height);
    s.g.imageSmoothingEnabled = false;
    pairs.forEach(([n, bk], i) => { s.g.drawImage(bk.lit.c, sx, sy, size, size, i * size * Z, 20, size * Z, size * Z); label(s.g, n, i * size * Z, 0, size * Z); });
    return s.c.toDataURL('image/png').split(',')[1];
  };

  const crops = {
    NW_corner_closeup: sheetOf([['BEFORE  (rooms-only chamfer)', off], ['AFTER  (hallway chamfered)', on]], 34, 72, 9),
    NW_corner_wide:    sheetOf([['BEFORE', off], ['AFTER', on]], 60, 200, 3),
  };
  return JSON.stringify({ tile: T, cornerPx: [CX, CY], corridorChamfersFound: on.added, crops });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'hallnw-'));
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
  console.error('hallcorner-nw: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_HALLWALL_DIR || join(process.cwd(), 'dev', '.shots-hallwall');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
