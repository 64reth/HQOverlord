#!/usr/bin/env node
// dev/shellshots.mjs — ANDREW'S OWN STATION, shell reach before vs after.
//
// Left: the shipped bake (stationbake.before.js, trunk's copy). Right: this branch.
// Both are shot un-clad AND with four rooms clad in different skins, because the defect only
// shows when you compare a clad room against the shell around it.
//
//   node dev/shellshots.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8964';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9364);
const URL = `http://127.0.0.1:${PORT}/`;

// verbatim from C:\Users\andro\AppData\Local\StarNet\workspaces\agent.save.json
const ROOMS = [
  [0, 0, 17, 10], [-5, 2, -1, 8], [18, 2, 22, 8], [4, -3, 13, -1], [4, 11, 13, 13],
  [23, 3, 25, 7], [-8, 3, -6, 6], [6, 14, 11, 16], [6, -6, 11, -4]
];
// which of the nine get re-clad in the "mixed" shot, and with what
const CLAD = { 1: ['timber', 'walnut'], 2: ['brick', 'rust'], 6: ['stone', 'sterile'], 8: ['clapboard', 'bone'] };

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  function shot(Bake, clad) {
    const st = WorldModel.create(WorldModel.defaultDoc());
    for (const id of st.doc().order.slice()) st.removeRoom(id);
    const ids = [];
    for (const [x1, y1, x2, y2] of ${JSON.stringify(ROOMS)}) ids.push(st.addRoom({ kind: 'hab', rects: [{ x1, y1, x2, y2 }] }).id);
    if (clad) for (const [i, [mat, style]] of Object.entries(${JSON.stringify(CLAD)})) st.setHull(ids[i], { mat, style });
    const geo = st.projectGeometry(), bk = Bake.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.fillStyle = '#05060a'; lit.g.fillRect(0, 0, bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    const o = mk(bk.W * 2, bk.H * 2); o.g.imageSmoothingEnabled = false;
    o.g.drawImage(lit.c, 0, 0, bk.W * 2, bk.H * 2);
    return o.c.toDataURL('image/png').split(',')[1];
  }
  const B = window.StationBakeBefore;
  return JSON.stringify({ crops: {
    before_unclad: shot(B, false), after_unclad: shot(StationBake, false),
    before_mixed:  shot(B, true),  after_mixed:  shot(StationBake, true)
  } });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellshots-'));
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
  console.error('shellshots: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {}
  try { side.kill(); } catch {}
  process.exit(2);
}
/* THE SHIPPED BAKE, LOADED BESIDE THE BRANCH'S. Trunk's stationbake.js, rebound to a second global
   and evaluated in the same page, so before/after are the same geometry through the same canvas —
   the shim pattern the hull and wall lanes both used. */
const beforeSrc = execFileSync('git', ['show', 'HEAD:frontend/app/stationbake.js'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .replace('const StationBake = (() =>', 'window.StationBakeBefore = (() =>')
  .replace(/if \(typeof module[\s\S]*$/, '');
await evalJS(cdp, beforeSrc + '\n;"ok"');
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellshots');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
console.error('crops → ' + dir);
try { proc.kill(); } catch {}
try { side.kill(); } catch {}
process.exit(0);
