/* dev/rugbed-proof.mjs — LIVE proof for the floor-decal + sleep-in-bed lane.
 *
 * Boots a seeded sidecar + headless Chrome (the CDP path, because rAF never runs in the preview tab),
 * lays a RUG and a BED through the real station.addProp API, then:
 *   1. places a prop ON the rug          -> proves the placement exemption end to end
 *   2. stands the hero ON the rug        -> proves the floor pass (the body is drawn, not buried)
 *   3. drives the sleep plan + arrival   -> proves the lying pose, and shoots the bed
 * Captures PNGs into .rugbed-shots/ and prints the live state it read back.
 *
 * node dev/rugbed-proof.mjs            (env: SKYNET_SHOT_PORT, SKYNET_CDP_PORT)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS, capture } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const port = process.env.SKYNET_SHOT_PORT || '8947';
const cdpPort = Number(process.env.SKYNET_CDP_PORT || 9347);
const OUT = join(process.cwd(), '.rugbed-shots');
const APP = `http://127.0.0.1:${port}/`;
const SCRATCH = join(OUT, '_seed-workspace');
const PROFILE = join(OUT, '_profile');
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
  // a CLOSE-UP of one prop: the station renders at 12px tiles, so a full-viewport shot of a 2-tile bed
  // is 24 unreadable pixels. Clip to the prop's own screen rect and blow it up.
  const closeUp = async (type, name, pad = 70) => {
    const p = await evalJS(cdp, `(() => { const q = World._dbgPropClientPoint(${JSON.stringify(type)}); return q ? { x: q.clientX, y: q.clientY } : null; })()`);
    if (!p) { console.log('closeUp: no', type); return; }
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: Math.max(0, p.x - pad), y: Math.max(0, p.y - pad), width: pad * 2, height: pad * 2, scale: 3 },
    });
    writeFileSync(join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('closeUp:', name);
  };

  // ---- 1. lay the floor: a rug, a prop ON it, and a bed, all through the validated mutation API
  const laid = await say('laid:', `(() => {
    const st = Build.__test__.station();
    if (!st) return { error: 'no station' };
    const b = st.bounds();
    const fit = (t, w, h) => {
      for (let ty = b.minTy; ty <= b.maxTy; ty++) for (let tx = b.minTx; tx <= b.maxTx; tx++)
        if ((st.canPlaceProp(t, tx, ty, w, h) || {}).ok) return { tx, ty };
      return null;
    };
    const rugAt = fit('rug', 4, 3);
    if (!rugAt) return { error: 'nowhere for a rug' };
    const rug = st.addProp({ t: 'rug', x: rugAt.tx, y: rugAt.ty, w: 4, h: 3, block: false });
    // THE PLACEMENT PROOF: a solid prop on the middle of the rug (this used to answer OVERLAP)
    const onRug = st.canPlaceProp('plant', rugAt.tx + 1, rugAt.ty + 1, 1, 1);
    const planted = onRug.ok ? st.addProp({ t: 'plant', x: rugAt.tx + 1, y: rugAt.ty + 1, w: 1, h: 1, block: false }) : null;
    const bedAt = fit('bunk', 2, 2);
    const bed = bedAt ? st.addProp({ t: 'bunk', x: bedAt.tx, y: bedAt.ty, w: 2, h: 2, block: true }) : null;
    World.refit();
    return { rugAt, rug: !!(rug && rug.ok), onRug, planted: !!(planted && planted.ok), bedAt, bed: !!(bed && bed.ok) };
  })()`);
  if (laid.error) throw new Error(laid.error);
  await sleep(1500);                                   // the refit re-bakes on a frame; geo is stale until then
  await evalJS(cdp, 'World.stop(); World.start(); 1');
  await say('screen pts:', `JSON.stringify(['rug','plant','bunk'].map(t => [t, World._dbgPropClientPoint(t)]))`);

  // ---- 2. stand the hero ON the rug, zoom the camera onto the floor, and shoot it
  const zoomOnto = async (type) => evalJS(cdp, `(() => {
    const cv = document.getElementById('stage');
    const p = World._dbgPropClientPoint(${JSON.stringify(type)});
    if (!p) return 'no ' + ${JSON.stringify(type)};
    for (let i = 0; i < 7; i++) cv.dispatchEvent(new WheelEvent('wheel', { clientX: p.clientX, clientY: p.clientY, deltaY: -240, bubbles: true, cancelable: true }));
    return 'zoomed at ' + Math.round(p.clientX) + ',' + Math.round(p.clientY);
  })()`);
  await say('zoom:', JSON.stringify(await zoomOnto('rug')));
  await sleep(600);
  // stand the hero on the rug's CENTRE. The doc is in world tiles and the engine draws in the local
  // frame, so the tile is resolved by inverting the live camera off the rug's own screen point rather
  // than assuming the two frames agree.
  await say('on the rug:', `(() => {
    const id = (World.bodies()[0] || {}).id || (App.currentAgent() || {}).id;
    const p = World._dbgPropClientPoint('rug'), cam = World.cameraDbg();
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    const wx = ((p.clientX - r.left) * (cv.width / r.width) - cam.panX) / cam.scale;
    const wy = ((p.clientY - r.top) * (cv.height / r.height) - cam.panY) / cam.scale;
    // the rug's NORTH row — the row the old y-sort buried a body on, so it is the row worth shooting
    const py = wy - 12 + 5;
    World._dbgTeleport(id, wx - 18, py);
    return { id, worldPx: [Math.round(wx), Math.round(py)] };
  })()`);
  await sleep(900);
  await evalJS(cdp, 'World.stop(); World.start(); 1');
  await say('body now:', 'JSON.stringify(World.bodies().map(b => ({ id: b.id, tile: b.tile })))');
  await capture(cdp, OUT, 'agent-on-rug');
  await closeUp('rug', 'agent-on-rug-closeup', 150);
  await say('rug pixel:', `(() => {
    const cv = document.getElementById('stage'), r = cv.getBoundingClientRect();
    const p = World._dbgPropClientPoint('rug');
    const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height;
    sc.getContext('2d').drawImage(cv, 0, 0);
    const at = (cx, cy) => { const d = sc.getContext('2d').getImageData(Math.round((cx - r.left) * cv.width / r.width), Math.round((cy - r.top) * cv.height / r.height), 1, 1).data; return [d[0], d[1], d[2]]; };
    return { onRug: at(p.clientX, p.clientY + 14), offRug: at(p.clientX, p.clientY + 220) };
  })()`);

  // ---- 3. put it to bed: the real planner, then the real arrival beat
  await say('sleep plan:', 'JSON.stringify(World._dbgSleep())');
  await say('arrived:', 'JSON.stringify(World._dbgArrive())');
  await zoomOnto('bunk');
  await sleep(1500);
  await evalJS(cdp, 'World.stop(); World.start(); 1');
  await capture(cdp, OUT, 'agent-in-bed');
  await closeUp('bunk', 'agent-in-bed-closeup', 110);
  await say('dwell (ms):', '(() => { const d = World._dbgLeisure(); return { goal: d.goal, useKind: d.useKind, lying: d.lying, sitting: d.sitting, seatKey: d.seatKey, renderPx: d.renderPx }; })()');
  // and the wake path: a summon must take it out of the bed
  // ---- 4. THE WAKE. A summon (the same flip chat.js/the scheduler make when a run starts) must take it
  // out of the bed and free the mattress. The seize lives in the tick, so this needs real frames.
  await evalJS(cdp, `World.setActivity('task'); 1`);
  await sleep(2500);
  await evalJS(cdp, 'World.stop(); World.start(); 1');
  await say('after summon:', `(() => { const d = World._dbgLeisure(); return { activity: World.getActivity(), goal: d.goal, lying: d.lying, seated: d.seated, seats: d.seats }; })()`);
  console.log('shots in', OUT);
} finally {
  try { if (cdp) cdp.close && cdp.close(); } catch {}
  try { proc.kill(); } catch {}
  try { if (ownSidecar) ownSidecar.kill(); } catch {}
}
