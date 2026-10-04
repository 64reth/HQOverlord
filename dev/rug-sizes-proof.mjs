/* dev/rug-sizes-proof.mjs — LIVE proof for the 3x3 + 5x5 rugs.
 *
 * The render sheet (dev/rug-sheet.mjs) draws a rug into a scratch canvas, which proves the ART and
 * nothing else. This drives the REAL station: it lays all three rugs through the validated
 * station.addProp API, stands a prop on each, stands the HERO on the 5x5, and reads pixels back off
 * the live stage canvas — the three things a decal can silently fail at (placement exemption, the
 * floor pass drawing it UNDER the body, and the footprint actually covering its tiles).
 *
 * Screenshots of the whole animating canvas time out, so every shot here is a CLIPPED close-up.
 *
 * node dev/rug-sizes-proof.mjs        (env: SKYNET_SHOT_PORT, SKYNET_CDP_PORT)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const port = process.env.SKYNET_SHOT_PORT || '8948';
const cdpPort = Number(process.env.SKYNET_CDP_PORT || 9348);
const OUT = join(process.cwd(), '.rugbed-shots');
const APP = `http://127.0.0.1:${port}/`;
const SCRATCH = join(OUT, '_sizes-workspace');
const PROFILE = join(OUT, '_sizes-profile');
mkdirSync(OUT, { recursive: true });
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

let ownSidecar = null;
if (await isUp(APP)) console.log(`sidecar: reusing :${port}`);
else {
  materializeSeedWorkspace(SCRATCH);
  ownSidecar = bootSeededSidecar({ port, scratchDir: SCRATCH });
  if (!(await waitUp(APP))) throw new Error('sidecar never came up on :' + port);
  console.log('sidecar: ready');
}

const { proc } = launchChrome({ cdpPort, win: '1440,900', profileDir: PROFILE });
let cdp;
try {
  cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // throttle rAF BEFORE boot — a software-rendered always-animating canvas starves Runtime.evaluate
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 120);',
  });
  await cdp.send('Page.navigate', { url: APP });
  const ready = await waitDevReady(cdp, evalJS, { tries: 24, url: APP });
  console.log('in-game:', ready);
  if (!ready) throw new Error('never reached the floor');

  const say = async (label, expr) => { const v = await evalJS(cdp, expr); console.log(label, JSON.stringify(v)); return v; };
  const closeUp = async (type, name, pad = 120) => {
    const p = await evalJS(cdp, `(() => { const q = World._dbgPropClientPoint(${JSON.stringify(type)}); return q ? { x: q.clientX, y: q.clientY } : null; })()`);
    if (!p) { console.log('closeUp: no', type); return; }
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: Math.max(0, p.x - pad), y: Math.max(0, p.y - pad), width: pad * 2, height: pad * 2, scale: 3 },
    });
    writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('closeUp:', name);
  };

  // ---- 1. lay all three rugs, each with a solid prop standing on it (the decal placement exemption)
  const laid = await say('laid:', `(() => {
    const st = Build.__test__.station();
    if (!st) return { error: 'no station' };
    const b = st.bounds();
    const fit = (t, w, h, free) => {
      for (let ty = b.minTy; ty <= b.maxTy; ty++) for (let tx = b.minTx; tx <= b.maxTx; tx++)
        if ((!free || free(tx, ty, w, h)) && (st.canPlaceProp(t, tx, ty, w, h) || {}).ok) return { tx, ty };
      return null;
    };
    const out = {};
    /* the rugs must land APART. A decal never blocks a placement, so a naive first-fit puts all three on
       the same tile and every readback afterwards samples whichever one drew last. The taken list keeps
       this proof honest — it is the script's bookkeeping, not the engine's. */
    const taken = [];
    const free = (tx, ty, w, h) => !taken.some(r => tx < r.x + r.w + 1 && tx + w + 1 > r.x && ty < r.y + r.h + 1 && ty + h + 1 > r.y);
    for (const [t, w, h] of [['rug_large', 5, 5], ['rug_small', 3, 3], ['rug', 4, 3]]) {
      const at = fit(t, w, h, free);
      if (!at) { out[t] = { error: 'nowhere for a ' + t }; continue; }
      taken.push({ x: at.tx, y: at.ty, w, h });
      /* WALKABILITY DELTA, not absolute walkability. The seed station already has walls and machinery
         under some of these tiles, so "are all N tiles walkable" answers a question about the STATION.
         The question about the RUG is whether unrolling it takes anything away — count before, count
         after, and they must match. */
      const count = () => {
        const g = st.projectGeometry(); let n = 0;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++)
          if (g.walkable(at.tx + dx - g.origin.tx, at.ty + dy - g.origin.ty)) n++;
        return n;
      };
      const before = count();
      const laidOk = st.addProp({ t, x: at.tx, y: at.ty, w, h, block: false });
      const after = count();
      // THE PLACEMENT PROOF: a solid prop in the middle of the decal must NOT answer OVERLAP
      const onIt = st.canPlaceProp('gachapon', at.tx + 1, at.ty + 1, 1, 1);
      const planted = onIt.ok ? st.addProp({ t: 'gachapon', x: at.tx + 1, y: at.ty + 1, w: 1, h: 1, block: true }) : null;
      out[t] = { at, laid: !!(laidOk && laidOk.ok), standsOnIt: !!onIt.ok, planted: !!(planted && planted.ok),
                 why: onIt.error || null, walkable: before + '->' + after + (before === after ? ' (TOOK NOTHING)' : ' (STOLE TILES)') };
    }
    World.refit();
    return out;
  })()`);
  if (laid.error) throw new Error(laid.error);
  await sleep(1500);                                   // the refit re-bakes on a frame; geo is stale until then
  await evalJS(cdp, 'World.stop(); World.start(); 1');

  // ---- 2. the FOOTPRINT proof: geo carries each decal at its own w/h and never blocks a tile
  await say('geo props:', `(() => {
    const geo = Build.__test__.station().projectGeometry();
    return (geo.props || []).filter(p => /^rug/.test(p.t)).map(p => ({ t: p.t, w: p.w, h: p.h, block: p.block }));
  })()`);
  await say('soft-cross set:', `(() => {
    /* a rug an agent STEPS AROUND is a rug that failed. beltUnion() soft-blocks every non-blocking prop
       footprint except SOFT_CROSS, so a new rug id missing from that set is invisible to every other
       check here — the prop places, renders and stays walkable, and bodies still route around it. */
    const st = Build.__test__.station();
    return st.props().filter(p => /^rug/.test(p.t)).map(p => [p.t, World._dbgSoftCross ? World._dbgSoftCross(p.t) : 'no hook']);
  })()`);

  // ---- 3. zoom onto the 5x5, stand the hero on its NORTH row (the row a bad y-sort buries a body on)
  const zoomOnto = async (type) => evalJS(cdp, `(() => {
    const cv = document.getElementById('stage');
    const p = World._dbgPropClientPoint(${JSON.stringify(type)});
    if (!p) return 'no ' + ${JSON.stringify(type)};
    for (let i = 0; i < 7; i++) cv.dispatchEvent(new WheelEvent('wheel', { clientX: p.clientX, clientY: p.clientY, deltaY: -240, bubbles: true, cancelable: true }));
    return 'zoomed at ' + Math.round(p.clientX) + ',' + Math.round(p.clientY);
  })()`);
  await say('zoom:', JSON.stringify(await zoomOnto('rug_large')));
  await sleep(600);
  await say('on the large rug:', `(() => {
    const id = (World.bodies()[0] || {}).id || (App.currentAgent() || {}).id;
    const p = World._dbgPropClientPoint('rug_large'), cam = World.cameraDbg();
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    const wx = ((p.clientX - r.left) * (cv.width / r.width) - cam.panX) / cam.scale;
    const wy = ((p.clientY - r.top) * (cv.height / r.height) - cam.panY) / cam.scale;
    World._dbgTeleport(id, wx - 18, wy - 24 + 5);
    return { id, worldPx: [Math.round(wx), Math.round(wy)] };
  })()`);
  await sleep(900);
  await evalJS(cdp, 'World.stop(); World.start(); 1');
  /* THE FLOOR-PASS PROOF. A decal that renders in the ITEM pass instead of the floor pass paints OVER
     any body standing on its northern rows — the exact bug the `flat` flag was added for. Sample a
     column down from the body's own screen point: if the rug is under it, the sprite's own tones show
     up; if the rug drew last, every sample is rug. */
  await say('body over the large rug:', `(() => {
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    const b = World.bodies()[0], cam = World.cameraDbg();
    const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height;
    sc.getContext('2d').drawImage(cv, 0, 0);
    const at = (cx, cy) => { const d = sc.getContext('2d').getImageData(Math.round((cx - r.left) * cv.width / r.width), Math.round((cy - r.top) * cv.height / r.height), 1, 1).data; return [d[0], d[1], d[2]]; };
    const bx = r.left + (b.px * cam.scale + cam.panX) * (r.width / cv.width);
    const by = r.top + (b.py * cam.scale + cam.panY) * (r.height / cv.height);
    const col = [];
    for (let dy = -34; dy <= 4; dy += 6) col.push(at(bx, by + dy));
    /* ⛔ do NOT classify these samples by hue. A first cut called a pixel "the sprite" when green+blue
       outran red, which the PLUM rug satisfies on its own — the readout said 7/7 sprite while the crop
       showed nothing but rug. The colour column is raw evidence for a human to read against the
       close-up; what is machine-checkable is the flag the floor pass actually switches on. */
    return {
      bodyPx: [Math.round(b.px), Math.round(b.py)],
      column: col,
      flat: ['rug', 'rug_small', 'rug_large'].map(t => [t, !!(PropSprites.spec(t) || {}).flat]),
    };
  })()`);
  await closeUp('rug_large', 'rug-large-with-agent', 150);
  await zoomOnto('rug_small'); await sleep(600);
  await evalJS(cdp, 'World.stop(); World.start(); 1');
  await closeUp('rug_small', 'rug-small-live', 110);

  // ---- 4. PIXEL PROOF: the deck off the decal vs the decal itself. Two rugs that sample the same
  //         colour would mean one of them never painted (or both share a base, the thing to avoid).
  await say('pixels:', `(() => {
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height;
    sc.getContext('2d').drawImage(cv, 0, 0);
    const at = (cx, cy) => { const d = sc.getContext('2d').getImageData(Math.round((cx - r.left) * cv.width / r.width), Math.round((cy - r.top) * cv.height / r.height), 1, 1).data; return [d[0], d[1], d[2]]; };
    const out = {};
    for (const t of ['rug', 'rug_small', 'rug_large']) {
      const p = World._dbgPropClientPoint(t);
      out[t] = p ? at(p.clientX, p.clientY + 10) : null;
    }
    return out;
  })()`);
  console.log('shots in', OUT);
} finally {
  try { if (cdp) cdp.close && cdp.close(); } catch {}
  try { proc.kill(); } catch {}
  try { if (ownSidecar) ownSidecar.kill(); } catch {}
}
