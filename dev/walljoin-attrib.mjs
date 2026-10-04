#!/usr/bin/env node
// dev/walljoin-attrib.mjs — attribute the wall-junction artifacts on Andrew's live station by
// re-baking with passes isolated: (a) as-is, (b) chamfers stripped, (c) skirt collapsed to 4px.
// Also dumps an outline overlay so canvas px map to room rects. Pattern per dev/walljoin-live.mjs.
//   node dev/walljoin-attrib.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8984';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9384);
const URL = `http://127.0.0.1:${PORT}/`;

const savePath = join(process.env.APPDATA, 'ai.skynet.harness', 'workspaces', 'agent.save.json');
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const stationDoc = save.doc && save.doc.station;

const PROBE = `(() => {
  const doc = ${JSON.stringify(JSON.stringify(stationDoc))};
  const st = WorldModel.deserialize(JSON.parse(doc));
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const render = (mut) => {
    const geo = st.projectGeometry();
    if (mut) mut(geo);
    const bk = StationBake.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    return { geo, bk, lit };
  };
  const cur = render(null);
  const noch = render(g => { g.chamfers.length = 0; });
  const oldSkirt = StationBake.WALL.skirt;
  StationBake.WALL.skirt = 4;
  const thin = render(null);
  StationBake.WALL.skirt = oldSkirt;
  // outline overlay on the current render
  const ov = mk(cur.bk.W, cur.bk.H);
  ov.g.drawImage(cur.lit.c, 0, 0);
  ov.g.strokeStyle = '#ff004c'; ov.g.lineWidth = 1; ov.g.font = '8px monospace'; ov.g.fillStyle = '#00ffcc';
  const T = cur.geo.TILE;
  for (const r of cur.geo.allRects) {
    ov.g.strokeRect(r.x1 * T + 0.5, r.y1 * T + 0.5, (r.x2 - r.x1 + 1) * T - 1, (r.y2 - r.y1 + 1) * T - 1);
    ov.g.fillText(r.z, r.x1 * T + 2, r.y1 * T + 9);
  }
  const png = c => c.toDataURL('image/png').split(',')[1];
  return JSON.stringify({ W: cur.bk.W, H: cur.bk.H, T,
    crops: { cur: png(cur.lit.c), nochamfer: png(noch.lit.c), thinskirt: png(thin.lit.c), overlay: png(ov.c) } });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'walljoin-'));
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
  console.error('walljoin-attrib: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_WALLJOIN_DIR || join(process.cwd(), 'dev', '.shots-walljoin');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, 'attrib_' + n + '.png'), Buffer.from(b64, 'base64'));
console.log(JSON.stringify({ W: data.W, H: data.H, T: data.T }));
console.error('shots → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
