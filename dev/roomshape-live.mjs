#!/usr/bin/env node
// dev/roomshape-live.mjs — the room-shape change in the REAL running app, not an offscreen bake.
//
// The contact sheets in roomshape-shots.mjs call StationBake directly. That proves the bake, not
// the game: the rendered world goes through World's own (chunked) bake path, and a knob that only
// works on the monolithic path is a knob that does not ship. This boots the seeded app, screenshots
// the live canvas, and reads the values the RUNNING page has, so the picture and the numbers come
// from the same process.
//
//   node dev/roomshape-live.mjs
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8975';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9375);
const URL = `http://127.0.0.1:${PORT}/`;

const scratch = mkdtempSync(join(tmpdir(), 'rslive-'));
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
  console.error('roomshape-live: dev harness never became ready — re-run.');
  try { proc.kill(); } catch {} try { side.kill(); } catch {}
  process.exit(2);
}
await sleep(2500);   // let the world settle and the station finish its first bake

const dir = process.env.SKYNET_ROOMSHAPE_DIR || join(process.cwd(), 'dev', '.shots-roomshape');
mkdirSync(dir, { recursive: true });

/* THE HONEST BEFORE IS THE SAME SESSION, RE-BAKED. Screenshotting the new build and comparing it
   against a picture taken on an older one compares two stations, two window sizes and two seeds as
   well as the change. Push the pre-2026-08-08 values onto the LIVE objects, call World.rebake(),
   shoot; then put the shipped values back and shoot again. Everything except the three knobs is
   held fixed by construction. */
const setAndRebake = (js) => evalJS(cdp, `(() => {
  const SB = StationBake; ${js}
  (typeof World !== 'undefined' ? World : window.World).rebake();
  return 'ok';
})()`);

/* THE 'AFTER' IS RESTORED FROM WHAT THE PAGE SHIPPED WITH, NEVER RE-TYPED. Writing the new numbers
   out a second time here makes this harness assert its own copy of them: change LIGHT.pitch in the
   bake and the shot still comes back showing the old value, reported as if it were the default.
   Stash the live objects on boot, and put those exact bytes back. */
await evalJS(cdp, `(() => { window.__RS_SHIPPED = JSON.stringify({ WALL: StationBake.WALL, LIGHT: StationBake.LIGHT, SHAPE: StationBake.SHAPE }); return 'ok'; })()`);

await setAndRebake('Object.assign(SB.WALL, { up: 14, corUp: 8, capH: 3 }); SB.LIGHT.pitch = 40; SB.SHAPE.cornerN = 2;');
await sleep(1500);
await capture(cdp, dir, 'LIVE_before');

await setAndRebake('const s = JSON.parse(window.__RS_SHIPPED); Object.assign(SB.WALL, s.WALL); Object.assign(SB.LIGHT, s.LIGHT); Object.assign(SB.SHAPE, s.SHAPE);');
await sleep(1500);

// what the RUNNING page actually holds, plus a luma read off the live canvas' own deck
const state = await evalJS(cdp, `(() => {
  const SB = StationBake;
  const cv = document.getElementById('stage') || document.querySelector('canvas');
  const g = cv && cv.getContext('2d');
  let deck = null;
  if (g) {
    const w = cv.width, h = cv.height;
    const d = g.getImageData(0, 0, w, h).data;
    // brightest and darkest non-void rows through the vertical centre band of the picture
    let lo = 255, hi = 0;
    for (let y = (h * 0.25) | 0; y < (h * 0.8) | 0; y += 4) {
      let s = 0, n = 0;
      for (let x = (w * 0.3) | 0; x < (w * 0.7) | 0; x += 4) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 8) continue;
        s += 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]; n++;
      }
      if (!n) continue;
      const v = s / n; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    deck = { canvas: [w, h], centreBandLumaMin: +lo.toFixed(1), centreBandLumaMax: +hi.toFixed(1) };
  }
  return JSON.stringify({ live: { WALL: SB.WALL, SHAPE: SB.SHAPE, pitch: SB.LIGHT.pitch }, deck });
})()`);

await capture(cdp, dir, 'LIVE_after');
console.log(state);
console.error('live shots → ' + dir + ' (LIVE_before.png, LIVE_after.png)');
try { proc.kill(); } catch {} try { side.kill(); } catch {}
process.exit(0);
