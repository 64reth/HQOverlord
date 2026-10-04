#!/usr/bin/env node
// dev/walkbuild.mjs — PROOF instrument for "does a skin keep its build when it walks, and does
// its walk actually move?"
//
// Both questions are invisible in a screenshot and only half-answerable from the PNGs. A set can
// pass every file-level check and still render wrong, because drawBody is where the master meets
// the per-set scale, the foot-pad anchor measured off the IDLE frame, and the distance-phased
// frame pick. So measure what the shipped renderer actually paints:
//
//   BUILD  — draw the body idle, then walk, on a transparent field and read the alpha extents back.
//            A body whose walk frames were rendered on a different scale from its rotations grows
//            the moment it steps (skeleton shipped 28-38% taller walking than standing). Healthy
//            sets sit at max(walk height) / idle height ~= 0.96-1.08.
//   Motion is NOT checked here. It belongs on the masters (test/sprite-walk-motion.test.js) —
//   the in-world draw scales a 92px master to ~17px and that smooth downscale destroys every
//   structural signal it was measured with. The build ratio is the one read that survives it.
//

// The cycle is phased on DISTANCE (b.odo), not the clock, and the per-frame stride is derived
// inside assets.js — so rather than re-deriving it out here (and re-deriving it wrong), sweep odo
// across a wide span in fine steps and keep the distinct renders. That reads the real frame
// selection instead of a re-implementation of it.
//
// Usage:  node dev/walkbuild.mjs [--port 8941] [--cdp 9341] [--sets skeleton,pikachu,endoskeleton]
// Exits nonzero if any set's walk leaves the healthy build band.
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const PORT = arg('--port', '8941');
const CDP_PORT = Number(arg('--cdp', '9341'));
const SETS = arg('--sets', 'skeleton,pikachu,endoskeleton,secretagent').split(',').map(s => s.trim()).filter(Boolean);
const OUT = arg('--out', join(process.cwd(), '.uishots-walkbuild'));
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

// drawBody loads a set LAZILY: the first call for an unloaded set kicks off loadSet and returns
// null. A probe that measures on first call therefore measures nothing at all, for every set —
// so warm each one and wait for it to answer before reading anything.
const PROBE = (sets) => `(async () => {
  if (typeof SPRITES === 'undefined' || typeof SPRITES.drawBody !== 'function') return { err: 'no SPRITES.drawBody' };
  // Draw through a SCALED transform. These bodies paint at ~19 device px, and at that size a bob
  // and a frame of generation noise are both "1px" — the pre-fix pikachu cleared a 1px bar on
  // noise alone. drawBody snaps to the DEVICE pixel via getTransform().a, so scaling the context
  // buys real resolution instead of a smooth blur, and every number below is in quarter-pixels.
  const S = 4, W = 400, H = 400, PX = 50, PY = 75;
  // Transparent field + alpha read: the same discipline the shadow probe settled on. A white-field
  // luma read is colour-blind to whatever the skin happens to be painted in.
  const extent = (b) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(S, 0, 0, S, 0, 0);
    const drew = !!SPRITES.drawBody(g, b, 0);
    if (!drew) return null;
    const d = g.getImageData(0, 0, W, H).data;
    let top = -1, bot = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 16) { if (top < 0) top = y; bot = y; break; }
    }
    if (top < 0) return null;
    // foot band = the bottom 16% of the silhouette, the same slice assets.js reads a stride from
    let band = Math.floor(bot - (bot - top) * 0.16), minX = 1e9, maxX = -1e9;
    for (let y = band; y <= bot; y++) for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 16) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    return { top, h: bot - top + 1, foot: maxX < minX ? 0 : maxX - minX + 1 };
  };
  const body = (skin, state, odo) => ({ id: 'PROBE', skin, px: PX, py: PY, dir: 'east', state,
    sitting: false, working: false, phase: 0, aph: 0, odo, noShadow: true });

  const SETS = ${JSON.stringify(sets)};
  const nap = (ms) => new Promise(r => setTimeout(r, ms));
  for (let tries = 0; tries < 60; tries++) {
    const cold = SETS.filter(s => !extent(body(s, 'idle', 0)));
    if (!cold.length) break;
    await nap(250);
  }

  const out = {};
  for (const skin of SETS) {
    const idle = extent(body(skin, 'idle', 0));
    if (!idle) { out[skin] = { err: 'idle drew nothing after warm-up — set never loaded' }; continue; }
    // sweep DISTANCE, not frame index — the stride is derived inside assets.js and must stay there
    const seen = new Map();
    for (let odo = 0; odo < 400; odo += 0.25) {
      const e = extent(body(skin, 'walk', odo));
      if (e) seen.set(e.top + 'x' + e.h + 'x' + e.foot, e);
    }
    const fr = [...seen.values()];
    const spread = (k) => Math.max(...fr.map(f => f[k])) - Math.min(...fr.map(f => f[k]));
    out[skin] = {
      idleH: idle.h, idleTop: idle.top, idleFoot: idle.foot,
      frames: fr.length,
      minH: Math.min(...fr.map(f => f.h)), maxH: Math.max(...fr.map(f => f.h)),
      headSpread: spread('top'), footSpread: spread('foot'),
    };
    out[skin].ratio = +(out[skin].maxH / idle.h).toFixed(3);
  }
  return out;
})()`;

let code = 0, proc = null, cdp = null, ownSidecar = null;
try {
  if (await isUp(APP_URL)) console.log(`sidecar: reusing what is already on :${PORT}`);
  else {
    console.log(`sidecar: booting SEEDED SKYNET_DEV on :${PORT} ...`);
    materializeSeedWorkspace(SCRATCH);
    ownSidecar = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
    if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);
  }
  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 24, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(1500);

  const m = await evalJS(cdp, PROBE(SETS));
  if (m.err) throw new Error('probe: ' + m.err);

  const fails = [];
  console.log('\nAS THE SHIPPED RENDERER PAINTS IT (quarter-px, east, transparent field):');
  console.log('  set              idle   walk h   max/idle   distinct   head bob   foot swing');
  for (const skin of SETS) {
    const r = m[skin];
    if (!r || r.err) { fails.push(`${skin}: ${r ? r.err : 'no result'}`); continue; }
    console.log(`  ${skin.padEnd(15)} ${String(r.idleH).padStart(4)}   ${String(r.minH).padStart(2)}-${String(r.maxH).padEnd(4)} ` +
                `${String(r.ratio).padStart(8)}   ${String(r.frames).padStart(6)}   ${String(r.headSpread).padStart(6)}px   ` +
                `${String(r.footSpread).padStart(7)}px`);
    if (!(r.ratio >= 0.90 && r.ratio <= 1.12))
      fails.push(`${skin}: walks at ${r.ratio}x its standing height — outside the healthy 0.90..1.12 band`);
    if (!(r.frames >= 2))
      fails.push(`${skin}: the whole odo sweep produced ${r.frames} distinct render(s) — the cycle is not advancing`);

  }

  if (fails.length) { code = 1; console.log('\nFAIL:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('\nOK — every set keeps its build through the walk, and every walk moves.');
} catch (e) {
  console.error('FATAL', e && e.message || e); code = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  try { proc?.kill('SIGKILL'); } catch {}
  if (ownSidecar) { try { ownSidecar.kill('SIGKILL'); } catch {} }
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch {}
}
process.exit(code);
