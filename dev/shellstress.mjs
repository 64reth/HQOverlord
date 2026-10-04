#!/usr/bin/env node
// dev/shellstress.mjs — every room a DIFFERENT skin, on Andrew's own geometry.
// Renders it, times the bake against trunk's, and re-checks chunk parity at nine groups.
//   node dev/shellstress.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8967';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9367);
const URL = `http://127.0.0.1:${PORT}/`;

const ROOMS = [
  [0, 0, 17, 10], [-5, 2, -1, 8], [18, 2, 22, 8], [4, -3, 13, -1], [4, 11, 13, 13],
  [23, 3, 25, 7], [-8, 3, -6, 6], [6, 14, 11, 16], [6, -6, 11, -4]
];
const SKINS = [['station', 'follow'], ['timber', 'walnut'], ['brick', 'rust'], ['clapboard', 'bone'],
  ['shingle', 'ember'], ['stone', 'sterile'], ['stucco', 'amber'], ['curtain', 'cobalt'], ['hedge', 'fern']];

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const build = () => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    for (const id of st.doc().order.slice()) st.removeRoom(id);
    const ids = [];
    for (const [x1, y1, x2, y2] of ${JSON.stringify(ROOMS)}) ids.push(st.addRoom({ kind: 'hab', rects: [{ x1, y1, x2, y2 }] }).id);
    ${JSON.stringify(SKINS)}.forEach(([mat, style], i) => { if (mat !== 'station') st.setHull(ids[i], { mat, style }); });
    return st;
  };
  const flat = (bk, Bake) => { const o = mk(bk.W, bk.H); o.g.fillStyle = '#000'; o.g.fillRect(0, 0, bk.W, bk.H); (Bake||StationBake).drawBase(o.g, bk, 0, 0); (Bake||StationBake).drawLight(o.g, bk, 0, 0); return o; };
  const st = build(), geo = st.projectGeometry();
  const mono = flat(StationBake.bake(geo));
  const chunked = flat(StationBake.bakeIncremental(geo, null, null, {}));
  const da = mono.g.getImageData(0, 0, mono.c.width, mono.c.height).data;
  const db = chunked.g.getImageData(0, 0, chunked.c.width, chunked.c.height).data;
  let n = 0; for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]) > 6) n++;
  const time = (Bake) => { const t0 = performance.now(); for (let k = 0; k < 5; k++) Bake.bake(geo); return +((performance.now() - t0) / 5).toFixed(1); };
  const o2 = mk(mono.c.width * 2, mono.c.height * 2); o2.g.imageSmoothingEnabled = false;
  o2.g.drawImage(mono.c, 0, 0, mono.c.width * 2, mono.c.height * 2);
  return JSON.stringify({
    groups: ${JSON.stringify(SKINS)}.length,
    chunkParityDiffPx: n,
    msTrunk: time(window.StationBakeBefore), msBranch: time(StationBake),
    crops: { stress: o2.c.toDataURL('image/png').split(',')[1] }
  });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellstress-'));
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
  console.error('shellstress: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const beforeSrc = execFileSync('git', ['show', 'HEAD:frontend/app/stationbake.js'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .replace('const StationBake = (() =>', 'window.StationBakeBefore = (() =>')
  .replace(/if \(typeof module[\s\S]*$/, '');
await evalJS(cdp, beforeSrc + '\n;"ok"');
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellstress');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
