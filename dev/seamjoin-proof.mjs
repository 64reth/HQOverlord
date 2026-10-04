#!/usr/bin/env node
// dev/seamjoin-proof.mjs — the three separation lines Andrew circled on 2026-08-10, measured.
//
// His save (%APPDATA%\ai.skynet.harness\workspaces\agent.save.json) is all walnut/plank, and the
// three circles are: the r18|r119 room join (5-tile overlap, walled both ends — the minority rule
// called it a DOORWAY and dressed it), and the two real mouths of the r17 corridor. The fix: any
// doorway whose two sides bake the identical deck paints NO threshold dressing, and per-plate tone
// hashes are world-keyed so tone never re-rolls on a zone boundary.
//
// This probe rebuilds that exact cluster (translated +20,+20 so everything is positive), profiles
// luma straight across each circled boundary, and re-runs the SAME geometry with a different deck
// on one side — where the sill must REMAIN. Same discipline as dev/floorseam.mjs.
//
//   node dev/seamjoin-proof.mjs
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8981';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9381);
const URL = `http://127.0.0.1:${PORT}/`;

const PROBE = `(() => {
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return { c, g }; };
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // Andrew's circled cluster, translated +20,+20:
  //   r18 hab (20,3)..(31,13)   r17 corridor (24,14)..(25,19)   r1 hab (20,20)..(37,30)
  //   r119 hab (32,9)..(36,14)  — flush on r18's east face, overlap rows 9..13 (5 open vs 6 wall)
  const build = (deck119) => {
    const st = WorldModel.create(WorldModel.defaultDoc());
    const A = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 3,  x2: 31, y2: 13 }], floorStyle: 'walnut', floorMat: 'plank' });
    const H = st.placeHallway({ rects: [{ x1: 24, y1: 14, x2: 25, y2: 19 }] });
    const B = st.addRoom({ kind: 'hab', rects: [{ x1: 20, y1: 20, x2: 37, y2: 30 }], floorStyle: 'walnut', floorMat: 'plank' });
    const E = st.addRoom({ kind: 'hab', rects: [{ x1: 32, y1: 9,  x2: 36, y2: 14 }],
      floorStyle: deck119 ? deck119.style : 'walnut', floorMat: deck119 ? deck119.mat : 'plank' });
    // the corridor must carry the SAME deck as the rooms (his does: walnut/plank)
    const sd = st.setDeck(H.id, { style: 'walnut', mat: 'plank' });
    const errs = [A, H, B, E].map(r => r.error || null).filter(Boolean);
    if (sd && sd.error) errs.push('setDeck: ' + sd.error);
    const geo = st.projectGeometry();
    const bk = StationBake.bake(geo);
    const lit = mk(bk.W, bk.H);
    lit.g.drawImage(bk.baseCv, 0, 0); lit.g.drawImage(bk.lightCv, 0, 0);
    return { st, geo, bk, lit, errs, ids: { A: A.id, H: H.id, B: B.id, E: E.id } };
  };

  const colProfile = (g, x0, y0, w, h) => {   // mean luma per COLUMN
    const d = g.getImageData(x0, y0, w, h).data, out = [];
    for (let c = 0; c < w; c++) { let s = 0; for (let r = 0; r < h; r++) s += L(d, ((r * w) + c) * 4); out.push(+(s / h).toFixed(1)); }
    return out;
  };
  const rowProfile = (g, x0, y0, w, h) => {   // mean luma per ROW
    const d = g.getImageData(x0, y0, w, h).data, out = [];
    for (let r = 0; r < h; r++) { let s = 0; for (let c = 0; c < w; c++) s += L(d, ((r * w) + c) * 4); out.push(+(s / w).toFixed(1)); }
    return out;
  };
  // how hard the seam reads: peak within ±3px of the seam line vs the window median
  const seamRatio = (prof, seamIdx) => {
    const near = prof.slice(Math.max(0, seamIdx - 3), seamIdx + 4);
    const med = prof.slice().sort((a, b) => a - b)[prof.length >> 1];
    return +(Math.max(...near) / med).toFixed(3);
  };

  const measure = (run) => {
    const T = run.geo.TILE, g = run.lit.g;
    // 1. the r18|r119 vertical join: boundary at world x=32 -> local (32-ox). geo.allRects are local.
    const rA = run.geo.allRects.find(r => r.z === run.ids.A);
    const rE = run.geo.allRects.find(r => r.z === run.ids.E);
    const rH = run.geo.allRects.find(r => r.z === run.ids.H);
    const rB = run.geo.allRects.find(r => r.z === run.ids.B);
    const jx = rE.x1 * T;                        // first pixel column of r119
    const jy1 = Math.max(rA.y1, rE.y1), jy2 = Math.min(rA.y2, rE.y2);
    const join = colProfile(g, jx - 30, jy1 * T + 4, 60, (jy2 - jy1 + 1) * T - 8);
    // 2. mouth r18|r17 (top circle): boundary row = rH.y1
    const m1y = rH.y1 * T;
    const mouthTop = rowProfile(g, rH.x1 * T + 2, m1y - 24, (rH.x2 - rH.x1 + 1) * T - 4, 48);
    // 3. mouth r17|r1 (bottom circle): boundary row = rB.y1
    const m2y = rB.y1 * T;
    const mouthBot = rowProfile(g, rH.x1 * T + 2, m2y - 24, (rH.x2 - rH.x1 + 1) * T - 4, 48);
    const crop = (cx, cy, cw, ch, z) => {
      cx = Math.max(0, cx); cy = Math.max(0, cy);
      const o = mk(cw * z, ch * z); o.g.imageSmoothingEnabled = false;
      o.g.drawImage(run.lit.c, cx, cy, cw, ch, 0, 0, cw * z, ch * z);
      return o.c.toDataURL('image/png').split(',')[1];
    };
    return {
      join_profile: join.join(','), join_ratio: seamRatio(join, 30),
      mouthTop_profile: mouthTop.join(','), mouthTop_ratio: seamRatio(mouthTop, 24),
      mouthBot_profile: mouthBot.join(','), mouthBot_ratio: seamRatio(mouthBot, 24),
      crops: {
        join: crop(jx - 40, jy1 * T - 20, 80, (jy2 - jy1 + 1) * T + 40, 5),
        mouthTop: crop(rH.x1 * T - 40, m1y - 40, (rH.x2 - rH.x1 + 1) * T + 80, 80, 5),
        mouthBot: crop(rH.x1 * T - 40, m2y - 40, (rH.x2 - rH.x1 + 1) * T + 80, 80, 5),
        station: crop(0, 0, run.bk.W, run.bk.H, 1),
      }
    };
  };

  const same = build(null);                                  // Andrew's case: one deck everywhere
  const diff = build({ style: 'sterile', mat: 'tile' });     // counter-case: r119 is a DIFFERENT deck
  const rSame = measure(same), rDiff = measure(diff);
  const hall = same.st.doc().rooms[same.ids.H];
  const out = {
    errs: [...same.errs, ...diff.errs],
    hallDeck: { style: hall.floorStyle, mat: hall.floorMat, effMat: same.geo.matOf ? same.geo.matOf(same.ids.H) : null },
    T: same.geo.TILE,
    same_deck: { join_ratio: rSame.join_ratio, mouthTop_ratio: rSame.mouthTop_ratio, mouthBot_ratio: rSame.mouthBot_ratio,
                 join_profile: rSame.join_profile, mouthTop_profile: rSame.mouthTop_profile, mouthBot_profile: rSame.mouthBot_profile },
    diff_deck: { join_ratio: rDiff.join_ratio, join_profile: rDiff.join_profile },
    crops: {}
  };
  for (const [k, v] of Object.entries(rSame.crops)) out.crops['same_' + k] = v;
  out.crops.diff_join = rDiff.crops.join;
  return JSON.stringify(out);
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'seamjoin-'));
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
  console.error('seamjoin: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
const data = JSON.parse(await evalJS(cdp, PROBE));
const dir = process.env.SKYNET_SEAMJOIN_DIR || join(process.cwd(), 'dev', '.shots-seamjoin');
mkdirSync(dir, { recursive: true });
for (const [n, b64] of Object.entries(data.crops)) writeFileSync(join(dir, n + '.png'), Buffer.from(b64, 'base64'));
delete data.crops;
console.log(JSON.stringify(data, null, 1));
console.error('crops → ' + dir);
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
