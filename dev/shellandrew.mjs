#!/usr/bin/env node
// dev/shellandrew.mjs — ANDREW'S EXACT SAVED STATION, on a MAGENTA backdrop.
//
// The nine rooms verbatim from %LOCALAPPDATA%\StarNet\workspaces\agent.save.json. Magenta behind the
// bake so any pixel the shell fails to paint screams instead of hiding against the starfield —
// r13 (x4..13, y11..13, the wide shallow room under the big hab) is the one Andrew circled.
//
// Shot four ways: un-clad, r13 alone re-clad, r13+r16, and everything re-clad — because the
// complaint is that each extra shell makes an earlier one fail.
//
//   node dev/shellandrew.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8971';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9371);
const URL = `http://127.0.0.1:${PORT}/`;

const ROOMS = [
  ['r1', 0, 0, 17, 10], ['r10', -5, 2, -1, 8], ['r11', 18, 2, 22, 8], ['r12', 4, -3, 13, -1],
  ['r13', 4, 11, 13, 13], ['r14', 23, 3, 25, 7], ['r15', -8, 3, -6, 6], ['r16', 6, 14, 11, 16],
  ['r17', 6, -6, 11, -4]
];

const PROBE = `(() => {
  const ROOMS = ${JSON.stringify(ROOMS)};
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const build = () => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    for (const id of st.doc().order.slice()) st.removeRoom(id);
    const by = {};
    for (const [name, x1, y1, x2, y2] of ROOMS) {
      const m = st.addRoom({ kind: 'hab', rects: [{ x1, y1, x2, y2 }] });
      if (m && m.id) by[name] = m.id;
    }
    return { st, by };
  };
  const CLADS = [
    ['unclad', {}],
    ['r13_only', { r13: ['brick', 'rust'] }],
    ['r13_r16', { r13: ['brick', 'rust'], r16: ['timber', 'walnut'] }],
    ['all', { r1: ['stone','sterile'], r10: ['timber','walnut'], r11: ['brick','rust'], r12: ['clapboard','bone'],
              r13: ['brick','rust'], r14: ['shingle','ember'], r15: ['stucco','amber'], r16: ['timber','walnut'], r17: ['hedge','fern'] }]
  ];
  const out = {}, stats = {};
  for (const [name, clad] of CLADS) {
    const { st, by } = build();
    for (const k in clad) if (by[k]) st.setHull(by[k], { mat: clad[k][0], style: clad[k][1] });
    const geo = st.projectGeometry(), T = geo.TILE, bk = StationBake.bake(geo);
    // MAGENTA backdrop: anything the shell fails to paint shows as magenta
    const o = mk(bk.W, bk.H);
    o.g.fillStyle = '#c0146e'; o.g.fillRect(0, 0, bk.W, bk.H);
    StationBake.drawBase(o.g, bk, 0, 0); StationBake.drawLight(o.g, bk, 0, 0);
    // count unpainted pixels in the skirt rows under every footprint
    const base = mk(bk.W, bk.H); StationBake.drawBase(base.g, bk, 0, 0);
    const d = base.g.getImageData(0, 0, bk.W, bk.H).data;
    let holes = 0;
    for (const r of geo.allRects) {
      for (let y = (r.y2 + 1) * T; y < Math.min(bk.H, (r.y2 + 1) * T + 32); y++)
        for (let x = Math.max(0, r.x1 * T); x < Math.min(bk.W, (r.x2 + 1) * T); x++)
          if (!d[(((y * bk.W) + x) << 2) + 3]) holes++;
    }
    stats[name] = { holePx: holes, W: bk.W, H: bk.H };
    const z = mk(bk.W * 2, bk.H * 2); z.g.imageSmoothingEnabled = false;
    z.g.drawImage(o.c, 0, 0, bk.W * 2, bk.H * 2);
    out[name] = z.c.toDataURL('image/png').split(',')[1];
    // and a tight crop on r13, the room Andrew circled
    const r13 = geo.allRects.find(r => r.x1 === 4 - geo.origin.tx + geo.origin.tx && r.y1 === 11) ||
                geo.allRects.find(r => (r.y2 - r.y1) === 2 && (r.x2 - r.x1) === 9);
    if (r13) {
      const cx = r13.x1 * T - 30, cy = r13.y1 * T - 20, cw = (r13.x2 - r13.x1 + 1) * T + 60, ch = (r13.y2 - r13.y1 + 1) * T + 80;
      const q = mk(cw * 5, ch * 5); q.g.imageSmoothingEnabled = false;
      q.g.drawImage(o.c, cx, cy, cw, ch, 0, 0, cw * 5, ch * 5);
      out[name + '_r13'] = q.c.toDataURL('image/png').split(',')[1];
    }
  }
  return JSON.stringify({ stats, crops: out });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellandrew-'));
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
  console.error('shellandrew: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellandrew');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
console.log(JSON.stringify(data.stats, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
