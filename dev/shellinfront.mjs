#!/usr/bin/env node
// dev/shellinfront.mjs — ANDREW'S REPRO: build a room IN FRONT of a clad wall.
//
// "It works perfectly fine, unless u place something in front of the shell, then it will glitch and
// destroy the texture, but if there is nothing in front of it the station wall will remain intact."
//
// A clad room's skirt is cropped BEFORE and AFTER a second room is placed to its south, in the same
// columns. The pixels that survive (the ones the new room's plate does not cover) must be
// IDENTICAL — the wall behind cannot change because something was built in front of it.
// Run against trunk too, via the StationBakeBefore shim, so the difference is attributable.
//
//   node dev/shellinfront.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8972';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9372);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const SKINS = [['brick','rust'],['timber','walnut'],['shingle','ember'],['stone','sterile'],['clapboard','bone'],['stucco','amber'],['hedge','fern'],['curtain','cobalt'],['station',null]];

  function shot(Bake, mat, style, inFront) {
    const st = WorldModel.create(WorldModel.defaultDoc());
    for (const id of st.doc().order.slice()) st.removeRoom(id);
    const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 20, x2: 33, y2: 27 }] });
    if (mat !== 'station') st.setHull(A.id, { mat, style });
    if (inFront) st.addRoom({ kind: 'hab', rects: [{ x1: 22, y1: 32, x2: 31, y2: 38 }] });
    const geo = st.projectGeometry(), T = geo.TILE, bk = Bake.bake(geo);
    const o = mk(bk.W, bk.H);
    o.g.fillStyle = '#c0146e'; o.g.fillRect(0, 0, bk.W, bk.H);
    Bake.drawBase(o.g, bk, 0, 0); Bake.drawLight(o.g, bk, 0, 0);
    const r = geo.allRects.find(x => x.z === A.id);
    // A's skirt band: the 32 rows under its south edge, in ITS columns
    return { img: o, x: r.x1 * T, y: (r.y2 + 1) * T, w: (r.x2 - r.x1 + 1) * T, h: 32 };
  }
  function compare(Bake, mat, style) {
    const a = shot(Bake, mat, style, false), b = shot(Bake, mat, style, true);
    const da = a.img.g.getImageData(a.x, a.y, a.w, a.h).data;
    const db = b.img.g.getImageData(b.x, b.y, b.w, b.h).data;
    let diff = 0;
    for (let i = 0; i < da.length; i += 4)
      if (Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2]) > 6) diff++;
    return { diff, of: a.w * a.h };
  }
  const now = {}, before = {};
  for (const [mat, style] of SKINS) {
    now[mat] = compare(StationBake, mat, style);
    if (window.StationBakeBefore) before[mat] = compare(window.StationBakeBefore, mat, style);
  }
  // a picture of the worst case, both ways
  const pic = (Bake, tag) => {
    const a = shot(Bake, 'station', null, false), b = shot(Bake, 'station', null, true);
    const z = mk(a.w * 6, a.h * 6 * 2 + 12);
    z.g.imageSmoothingEnabled = false;
    z.g.fillStyle = '#101014'; z.g.fillRect(0, 0, z.c.width, z.c.height);
    z.g.drawImage(a.img.c, a.x, a.y, a.w, a.h, 0, 0, a.w * 6, a.h * 6);
    z.g.drawImage(b.img.c, b.x, b.y, b.w, b.h, 0, a.h * 6 + 12, b.w * 6, b.h * 6);
    return z.c.toDataURL('image/png').split(',')[1];
  };
  const crops = { after: pic(StationBake) };
  if (window.StationBakeBefore) crops.before = pic(window.StationBakeBefore);
  return JSON.stringify({ skirtDiff_nothingInFront_vs_roomInFront: now, sameOnTrunk: before, crops });
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'shellinfront-'));
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
  console.error('shellinfront: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const beforeSrc = execFileSync('git', ['show', 'HEAD:frontend/app/stationbake.js'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  .replace('const StationBake = (() =>', 'window.StationBakeBefore = (() =>')
  .replace(/if \(typeof module[\s\S]*$/, '');
await evalJS(cdp, beforeSrc + '\n;"ok"');
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SHELL_DIR || join(process.cwd(), '.shellinfront');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
