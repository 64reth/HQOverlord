#!/usr/bin/env node
// dev/roomshape-shots.mjs — the three room-shape fixes, rendered side by side on ONE geometry.
//
//   1. WALL HEIGHT   — WALL.up 14 → 22 (a room read as a tray, not a box)
//   2. LAMP GRID     — LIGHT.pitch: lamps run DOWN the room, not one row at the north wall
//   3. CORNER PROFILE— SHAPE.cornerN: 2 = circular fillet (legacy) · 1 = 45° chamfer
//
// Bakes the SAME station through the shipped StationBake at each config, so every difference in
// the output is one of the three knobs and nothing else. Also dumps a luma profile DOWN the room's
// centre column, which is the number that says whether the deck is actually lit or just claimed to be.
//
//   node dev/roomshape-shots.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8971';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9371);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake;
  // the shipped values, captured before anything is overridden, so 'after' is provably the default
  const SHIPPED = { wall: { ...SB.WALL }, light: { ...SB.LIGHT }, shape: { ...SB.SHAPE } };

  // a room the shape of the one in Andrew's screenshot: wide, and DEEPER than one lamp reach
  const st = WorldModel.create(WorldModel.defaultDoc());
  const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 20, x2: 37, y2: 33 }] });
  const geo = st.projectGeometry(), T = geo.TILE;
  const ra = geo.allRects.find(r => r.z === A.id);
  /* BAKE PIXELS ARE tile * T — geo.origin is the world→screen offset the renderer applies, NOT the
     bake's own frame (the bake pass itself computes X = ccx * T). Subtracting origin here
     silently crops a DIFFERENT part of the station: no throw, no blank image, just a plausible
     picture of the wrong place. Verified against geo.W: tiles 3..40 → 41*12 + pad/skirt = 528. */
  const PX = (tx) => tx * T, PY = (ty) => ty * T;

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // bake at a config and return { png(zoom, rect), luma-down-the-centre }
  function render(cfg) {
    Object.assign(SB.WALL, SHIPPED.wall, cfg.wall || {});
    Object.assign(SB.LIGHT, SHIPPED.light, cfg.light || {});
    Object.assign(SB.SHAPE, SHIPPED.shape, cfg.shape || {});
    const bk = SB.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    return lit;
  }
  const crop = (lit, cx, cy, cw, ch, z) => {
    const o = mk(Math.round(cw * z), Math.round(ch * z));
    o.g.imageSmoothingEnabled = false;
    o.g.drawImage(lit.c, cx, cy, cw, ch, 0, 0, Math.round(cw * z), Math.round(ch * z));
    return o.c.toDataURL('image/png').split(',')[1];
  };

  // the whole room + the wall above it + the hull skirt below it
  const RX = PX(ra.x1) - 26, RY = PY(ra.y1) - 46;
  const RW = (ra.x2 - ra.x1 + 1) * T + 52, RH = (ra.y2 - ra.y1 + 1) * T + 92;

  // average luma of each deck ROW down the room — the honest measure of "is the floor lit"
  const deckProfile = (lit) => {
    const x0 = PX(ra.x1) + 4, w = (ra.x2 - ra.x1 + 1) * T - 8;
    const y0 = PY(ra.y1) + 10, h = (ra.y2 - ra.y1 + 1) * T - 12;
    const d = lit.g.getImageData(x0, y0, w, h).data, out = [];
    for (let r = 0; r < h; r += 6) { let s = 0; for (let c = 0; c < w; c++) s += L(d, ((r * w) + c) * 4); out.push(+(s / w).toFixed(1)); }
    return out;
  };

  const CONFIGS = {
    // pitch 40 tiles is wider than any room here, so lampRows() yields exactly the legacy single row
    before: { wall: { up: 14, corUp: 8, capH: 3 }, light: { pitch: 40 }, shape: { cornerN: 2 } },
    after:  {},
    // isolate each fix so a taste call can be made on one at a time
    only_walls:  { light: { pitch: 40 }, shape: { cornerN: 2 } },
    only_lamps:  { wall: { up: 14, corUp: 8, capH: 3 }, shape: { cornerN: 2 } },
    only_corner: { wall: { up: 14, corUp: 8, capH: 3 }, light: { pitch: 40 } },
  };

  const crops = {}, lumas = {};
  for (const [name, cfg] of Object.entries(CONFIGS)) {
    const lit = render(cfg);
    crops['room_' + name] = crop(lit, RX, RY, RW, RH, 2);
    lumas[name] = deckProfile(lit);
  }

  /* CONTACT SHEETS. A taste call is made by COMPARING, so the deliverable is one image with the
     options beside each other at the same scale — not four files the eye has to hold in memory. */
  const label = (g, txt, x, y, w) => {
    g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(x, y, w, 22);
    g.fillStyle = '#ffcf70'; g.font = '16px VT323, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(txt, x + w / 2, y + 12);
  };
  const sheet = (panels, pw, ph) => {
    const s = mk(pw * panels.length, ph + 22);
    s.g.fillStyle = '#07090b'; s.g.fillRect(0, 0, s.c.width, s.c.height);
    panels.forEach((p, i) => {
      s.g.imageSmoothingEnabled = false;
      s.g.drawImage(p.lit.c, p.sx, p.sy, p.sw, p.sh, i * pw, 22, pw, ph);
      label(s.g, p.name, i * pw, 0, pw);
    });
    return s.c.toDataURL('image/png').split(',')[1];
  };

  // ROOM SHEET — before | after, same geometry, same scale
  crops.SHEET_room_before_after = sheet([
    { name: 'BEFORE  up14 · 1 lamp row · fillet', lit: render(CONFIGS.before), sx: RX, sy: RY, sw: RW, sh: RH },
    { name: 'AFTER  up22 · lamp grid · chamfer',  lit: render(CONFIGS.after),  sx: RX, sy: RY, sw: RW, sh: RH },
  ], RW * 2, RH * 2);

  // CORNER SHEET — the top-left corner at 8x across the exponent ladder, walls+lamps held at the new values
  // tight on the corner itself: the tile, the hull pad outside it, the wall crown above it
  const CX = PX(ra.x1) - 16, CY = PY(ra.y1) - 34, CW = 44, CH = 52;
  crops.SHEET_corner_ladder = sheet([2, 1.5, 1, 0.7].map(n => ({
    name: 'cornerN ' + n + (n === 2 ? '  (legacy fillet)' : n === 1 ? '  (45° chamfer)' : ''),
    lit: render({ shape: { cornerN: n } }), sx: CX, sy: CY, sw: CW, sh: CH,
  })), CW * 9, CH * 9);

  for (const n of [2, 1.5, 1, 0.7]) {
    const lit = render({ shape: { cornerN: n } });
    crops['corner_n' + String(n).replace('.', 'p')] = crop(lit, CX, CY, CW, CH, 8);
  }

  /* PITCH LADDER. "Is the deck too evenly lit" is not a matter of opinion about the average — it is
     whether there is a TROUGH between pools at all. A room lit to a flat wash has nothing but its
     pattern to show (the lesson the corridor deck taught three times over). So the ladder reports
     the peak, the trough, and the ratio between them alongside the picture: a real pools read needs
     the gap to fall well below the pool, and a pitch so wide the trough hits raw ambient is the
     unlit-tray failure coming back. */
  const contrast = {};
  const pitchPanels = [7, 8, 9, 10].map(p => {
    const lit = render({ light: { pitch: p } });
    const prof = deckProfile(lit);
    const peak = Math.max(...prof), trough = Math.min(...prof);
    contrast['pitch' + p] = { peak, trough, ratio: +(trough / peak).toFixed(2) };
    return { name: 'pitch ' + p + '  peak ' + peak + ' / trough ' + trough, lit, sx: RX, sy: RY, sw: RW, sh: RH };
  });
  crops.SHEET_pitch_ladder = sheet(pitchPanels, RW, RH);
  Object.assign(SB.WALL, SHIPPED.wall); Object.assign(SB.LIGHT, SHIPPED.light); Object.assign(SB.SHAPE, SHIPPED.shape);

  return JSON.stringify({
    tile: T, roomTiles: [ra.x2 - ra.x1 + 1, ra.y2 - ra.y1 + 1],
    shipped: SHIPPED,
    deck_luma_every_6px_top_to_bottom: lumas,
    pitch_pool_vs_trough: contrast,
    crops
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'roomshape-'));
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
  console.error('roomshape: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_ROOMSHAPE_DIR || join(process.cwd(), 'dev', '.shots-roomshape');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
