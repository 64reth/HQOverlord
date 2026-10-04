#!/usr/bin/env node
// dev/shellholes-live.mjs — find the BLACK WEDGES in Andrew's real saved station.
//
// (2026-08-15, Andrew, a tight crop of one junction: "i am only talking about circumstances like
// this" — a hull run cut off at a hard edge with an unpainted wedge before the next wall.)
//
// Bakes %APPDATA%\ai.skynet.harness\workspaces\agent.save.json on MAGENTA, then finds every
// magenta region that is ENCLOSED by hull (bounded on all four sides within ~6 tiles). Open sky is
// unbounded and drops out; what survives is a hole the eye reads as a gap in the wall. Ranks them
// by area and dumps NN-zoomed crops so each can be judged.
//
//   node dev/shellholes-live.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8987';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9387);
const URL = `http://127.0.0.1:${PORT}/`;
const ZOOM = Number(process.env.SKYNET_ZOOM || 6);

const savePath = join(process.env.APPDATA, 'ai.skynet.harness', 'workspaces', 'agent.save.json');
const stationDoc = JSON.parse(readFileSync(savePath, 'utf8')).doc?.station;
if (!stationDoc) { console.error('no .doc.station in save'); process.exit(2); }

const PROBE = `(() => {
  const ZOOM = ${ZOOM};
  const st = WorldModel.deserialize(JSON.parse(${JSON.stringify(JSON.stringify(stationDoc))}));
  const geo = st.projectGeometry(), T = geo.TILE, bk = StationBake.bake(geo);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const lit = mk(bk.W, bk.H);
  lit.g.fillStyle = '#ff00ff'; lit.g.fillRect(0, 0, bk.W, bk.H);
  StationBake.drawBase(lit.g, bk, 0, 0); StationBake.drawLight(lit.g, bk, 0, 0);

  const W = bk.W, H = bk.H, d = lit.g.getImageData(0, 0, W, H).data;
  // a pixel nothing painted still reads pure magenta; the interstitial-shadow pass composites UNDER
  // the walls, so a wedge it filled is NOT magenta — this finds the ones nothing owns at all
  const bare = new Uint8Array(W * H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) if (d[i] > 240 && d[i + 1] < 24 && d[i + 2] > 240) bare[p] = 1;

  // flood the bare pixels; a component touching the canvas edge is open sky
  const seen = new Int32Array(W * H).fill(0), comps = [];
  const stack = new Int32Array(W * H);
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!bare[p0] || seen[p0]) continue;
    let sp = 0; stack[sp++] = p0; seen[p0] = 1;
    let n = 0, open = false, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    while (sp) {
      const p = stack[--sp], x = p % W, y = (p / W) | 0;
      n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) open = true;
      if (x > 0 && bare[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < W - 1 && bare[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && bare[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W; }
      if (y < H - 1 && bare[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W; }
    }
    if (!open && n >= 6) comps.push({ n, x0, y0, x1, y1 });
  }
  comps.sort((a, b) => b.n - a.n);

  const crop = (cx, cy, cw, ch) => { const o = mk(cw * ZOOM, ch * ZOOM); o.g.drawImage(lit.c, cx, cy, cw, ch, 0, 0, cw * ZOOM, ch * ZOOM); return o.c.toDataURL('image/png').split(',')[1]; };
  const crops = { whole: lit.c.toDataURL('image/png').split(',')[1] };
  comps.slice(0, 8).forEach((c, i) => {
    const px = 5 * T, cw = Math.min(W, c.x1 - c.x0 + 1 + px * 2), chh = Math.min(H, c.y1 - c.y0 + 1 + px * 2);
    crops['hole' + i] = crop(Math.max(0, c.x0 - px), Math.max(0, c.y0 - px), cw, chh);
  });
  return JSON.stringify({ W, H, T, enclosed: comps.length, top: comps.slice(0, 8), crops });
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
  console.error('shellholes-live: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SEAM_DIR || join(process.cwd(), '.shellholes');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
