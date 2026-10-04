#!/usr/bin/env node
// dev/walljoin-live.mjs — render Andrew's LIVE station (agent.save.json) through the current
// bake and dump the full composited PNG, to locate the wall-junction overlap defects he circled
// on 2026-08-11. Pattern per dev/seamjoin-proof.mjs.
//   node dev/walljoin-live.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8983';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9383);
const URL = `http://127.0.0.1:${PORT}/`;

const savePath = join(process.env.APPDATA, 'ai.skynet.harness', 'workspaces', 'agent.save.json');
const save = JSON.parse(readFileSync(savePath, 'utf8'));
const stationDoc = save.doc && save.doc.station;
if (!stationDoc) { console.error('no .doc.station in save'); process.exit(2); }

const PROBE = `(() => {
  const doc = ${JSON.stringify(JSON.stringify(stationDoc))};
  const st = WorldModel.deserialize(JSON.parse(doc));
  const geo = st.projectGeometry();
  const bk = StationBake.bake(geo);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const lit = mk(bk.W, bk.H);
  lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
  const rects = geo.allRects.map(r => ({ z: r.z, x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, kind: r.kind || null }));
  return JSON.stringify({
    W: bk.W, H: bk.H, T: geo.TILE, rects,
    chamfers: geo.chamfers ? geo.chamfers.length : null,
    png: lit.c.toDataURL('image/png').split(',')[1],
  });
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
  console.error('walljoin: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_WALLJOIN_DIR || join(process.cwd(), 'dev', '.shots-walljoin');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'station.png'), Buffer.from(data.png, 'base64'));
delete data.png;
console.log(JSON.stringify(data, null, 1));
console.error('station → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
