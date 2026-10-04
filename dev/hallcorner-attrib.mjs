#!/usr/bin/env node
// dev/hallcorner-attrib.mjs — WHICH corridor draws which pixel at an L corner?
//
// Two wrong guesses cost a day on this: first that the case was corridor-to-room, then that the two
// corridors contend for the corner pixels and draw order decides (it does not — reordering the wall
// pass changed exactly zero pixels). So stop reasoning about it. Bake the vertical hallway ALONE,
// the horizontal hallway ALONE, and the two TOGETHER, on identical absolute tile coordinates, and
// put the three crops side by side. Whatever is in BOTH singles but missing from the pair is being
// overwritten; whatever is in neither single but appears in the pair is a join pass; and whatever is
// in a single and unchanged in the pair is simply never reconciled at all.
//
//   node dev/hallcorner-attrib.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8981';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9381);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const SB = StationBake, OX = 40, OY = 40;
  // the L: a hallway down x6..7 / y0..9, and one east along x8..18 / y8..9. Corner at tile (8,8).
  const V = [6, 0, 7, 9], H = [8, 8, 18, 9];
  const put = (st, r) => {
    const rects = [{ x1: r[0] + OX, y1: r[1] + OY, x2: r[2] + OX, y2: r[3] + OY }];
    const res = st.placeHallway({ rects });
    if (!res || !res.id) throw new Error('placement REJECTED ' + JSON.stringify(rects[0]));
    return res;
  };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };

  const bake = (which) => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    if (which !== 'H') put(st, V);
    if (which !== 'V') put(st, H);
    const geo = st.projectGeometry(), T = geo.TILE, bk = SB.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.fillStyle = '#ff00ff'; lit.g.fillRect(0, 0, bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0);   // BASE ONLY — the light pass would tint the attribution
    return { lit, T, W: bk.W, H: bk.H, geo };
  };

  const both = bake('VH'), vOnly = bake('V'), hOnly = bake('H');
  const T = both.T;
  /* ⛔ NEVER COMPUTE A BAKE COORDINATE FROM THE TILES YOU PASSED IN. projectGeometry REBASES every
     tile by the pad (a room authored at x0 comes back at x3), so (x + OX) * T lands a pad's worth
     of tiles away — no throw, no blank image, just a crisp picture of the wrong place. That is the
     third time this exact mistake has cost a render in this lane. Read the rects back out of the
     geometry the bake was actually handed, and derive the corner from THOSE. */
  const cors = both.geo.allRects.filter(r => both.geo.isCorridor(r.z));
  if (cors.length < 2) throw new Error('expected two corridors, got ' + cors.length);
  const vert = cors.find(r => (r.y2 - r.y1) > (r.x2 - r.x1)), horz = cors.find(r => r !== vert);
  if (!vert || !horz) throw new Error('could not tell the two hallways apart');
  // the corner is where the vertical hall's east edge meets the horizontal hall's north edge
  const CX = (vert.x2 + 1) * T, CY = horz.y1 * T;
  const PAD = 30, CW = 56, CH = 56, Z = 11;
  const sx = CX - PAD, sy = CY - PAD;

  const label = (g, t, x, y, w) => {
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(x, y, w, 20);
    g.fillStyle = '#ffcf70'; g.font = '15px VT323, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(t, x + w / 2, y + 10);
  };
  const panels = [['vertical hall ALONE', vOnly], ['horizontal hall ALONE', hOnly], ['BOTH (the L)', both]];
  const sheet = mk(CW * Z * panels.length, CH * Z + 20);
  sheet.g.fillStyle = '#101014'; sheet.g.fillRect(0, 0, sheet.c.width, sheet.c.height);
  sheet.g.imageSmoothingEnabled = false;
  panels.forEach(([name, bk], i) => {
    sheet.g.drawImage(bk.lit.c, sx, sy, CW, CH, i * CW * Z, 20, CW * Z, CH * Z);
    label(sheet.g, name, i * CW * Z, 0, CW * Z);
  });
  // tile grid over the sheet so a pixel can be named, not pointed at
  sheet.g.strokeStyle = 'rgba(0,255,255,0.35)'; sheet.g.lineWidth = 1;
  for (let i = 0; i < panels.length; i++) for (let t = 0; t <= CW; t += T) {
    const gx = i * CW * Z + ((t - (sx % T) + T) % T) * Z;
    sheet.g.beginPath(); sheet.g.moveTo(gx + 0.5, 20); sheet.g.lineTo(gx + 0.5, 20 + CH * Z); sheet.g.stroke();
  }
  for (let t = 0; t <= CH; t += T) {
    const gy = 20 + ((t - (sy % T) + T) % T) * Z;
    sheet.g.beginPath(); sheet.g.moveTo(0, gy + 0.5); sheet.g.lineTo(sheet.c.width, gy + 0.5); sheet.g.stroke();
  }

  /* THE ATTRIBUTION, AS NUMBERS. For every pixel of the corner block, classify it: present only in
     the vertical bake, only in the horizontal one, in both singles, in neither, and whether the
     PAIR agrees with whichever single claimed it. "Lost" is the interesting bucket — a pixel some
     corridor painted on its own that the pair leaves as void. */
  const px = (bk, x, y) => { const d = bk.lit.g.getImageData(x, y, 1, 1).data; return { m: d[0] === 255 && d[1] === 0 && d[2] === 255, k: d[0] + ',' + d[1] + ',' + d[2] }; };
  let lost = 0, gained = 0, changed = 0, agree = 0, lostList = [];
  for (let y = sy; y < sy + CH; y++) for (let x = sx; x < sx + CW; x++) {
    const a = px(vOnly, x, y), b2 = px(hOnly, x, y), c = px(both, x, y);
    const singleHas = !a.m || !b2.m;
    if (singleHas && c.m) { lost++; if (lostList.length < 40) lostList.push((x - CX) + ',' + (y - CY)); }
    else if (!singleHas && !c.m) gained++;
    else if (singleHas && !c.m) { const want = !a.m ? a.k : b2.k; if (want === c.k) agree++; else changed++; }
  }
  return JSON.stringify({
    tile: T, cornerTile: [8 + OX, 8 + OY], block: [sx, sy, CW, CH],
    attribution: { lost_pixels: lost, gained_by_join_pass: gained, repainted_by_other: changed, unchanged: agree },
    first_lost_offsets_from_corner: lostList,
    crops: { CORNER_attribution: sheet.c.toDataURL('image/png').split(',')[1] }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'hallcorner-'));
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
  console.error('hallcorner: dev harness never became ready — re-run.');
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
