/* dev/bed-click-repro.mjs — "I clicked the bed and the agent transferred into it."
 *
 * Boots its OWN seeded station (never touches a live session), puts a BED far from the hero, then
 * dispatches a REAL mouse click on the bed and watches the body across ~6s of frames. Prints the
 * hero's tile + goal before the click, right after it, and after the frames — so a teleport, a walk,
 * and "nothing happened, the nap just fired on its own" are told apart by evidence.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const port = process.env.SKYNET_SHOT_PORT || '8949';
const cdpPort = Number(process.env.SKYNET_CDP_PORT || 9355);
const OUT = join(process.cwd(), '.rugbed-shots');
const APP = `http://127.0.0.1:${port}/`;
const PROFILE = join(OUT, '_repro-profile');
mkdirSync(OUT, { recursive: true });
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

let own = null;
if (await isUp(APP)) console.log(`sidecar: reusing :${port}`);
else {
  materializeSeedWorkspace(join(OUT, '_repro-workspace'));
  own = bootSeededSidecar({ port, scratchDir: join(OUT, '_repro-workspace') });
  if (!(await waitUp(APP))) throw new Error('sidecar never came up');
}

const { proc } = launchChrome({ cdpPort, win: '1440,900', profileDir: PROFILE });
let cdp;
try {
  cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 60);',
  });
  await cdp.send('Page.navigate', { url: APP });
  if (!(await waitDevReady(cdp, evalJS, { tries: 24, url: APP }))) throw new Error('never reached the floor');
  const say = async (l, e) => { const v = await evalJS(cdp, e); console.log(l, v); return v; };

  await say('placed:', `(() => {
    const st = Build.__test__.station(); const b = st.bounds();
    // the FARTHEST placeable 2x2 from the hero's desk, so a walk and a teleport cannot be confused
    const desk = (st.doc().props || []).find(p => p.agentId) || { x: b.minTx, y: b.minTy };
    let best = null, bd = -1;
    for (let ty = b.minTy; ty <= b.maxTy; ty++) for (let tx = b.minTx; tx <= b.maxTx; tx++) {
      if (!(st.canPlaceProp('bunk', tx, ty, 2, 2) || {}).ok) continue;
      const d = Math.abs(tx - desk.x) + Math.abs(ty - desk.y);
      if (d > bd) { bd = d; best = { tx, ty }; }
    }
    if (!best) return 'no room for a bed';
    st.addProp({ t: 'bunk', x: best.tx, y: best.ty, w: 2, h: 2, block: true });
    World.refit();
    return 'bed at ' + best.tx + ',' + best.ty + ' (' + bd + ' tiles from the desk)';
  })()`);
  await sleep(2000);
  await evalJS(cdp, 'World.stop(); World.start(); 1');

  const state = `(() => { const b = World.bodies()[0] || {}, d = World._dbgLeisure();
    return JSON.stringify({ tile: b.tile, goal: d.goal, lying: d.lying, seated: d.seated, usingProp: d.usingProp, renderPx: d.renderPx }); })()`;
  await say('BEFORE the click:', state);

  await say('click dispatched:', `(() => {
    const p = World._dbgPropClientPoint('bunk'); if (!p) return 'no bed on the floor';
    const cv = document.getElementById('stage');
    for (const type of ['mousedown', 'mouseup', 'click']) {
      cv.dispatchEvent(new MouseEvent(type, { clientX: p.clientX, clientY: p.clientY, bubbles: true, cancelable: true, button: 0 }));
    }
    return 'clicked the bed at ' + Math.round(p.clientX) + ',' + Math.round(p.clientY);
  })()`);
  await say('IMMEDIATELY after:', state);
  for (const t of [1500, 3000, 6000]) { await sleep(1500); await say('after ' + t + 'ms:', state); }

  /* THE TELEPORT REGRESSION. Drive the real nap planner from across the room and sample the body every
     400ms: it must WALK (state 'walk', tile marching, lying false) and only be posed on the mattress
     once it arrives. A body that is `lying` on the first sample after the plan is the bug back again. */
  await say('nap planned:', `JSON.stringify(World._dbgSleep())`);
  const track = [];
  for (let i = 0; i < 22; i++) {
    await sleep(400);
    track.push(JSON.parse(await evalJS(cdp, `(() => { const b = World.bodies()[0] || {}, d = World._dbgLeisure();
      return JSON.stringify({ t: b.tile, walking: b.moving || b.state === 'walk', lying: d.lying, goal: d.goal }); })()`)));
  }
  const firstLying = track.findIndex(s => s.lying);
  const walked = new Set(track.map(s => s.t && s.t.x + ',' + s.t.y)).size;
  console.log('walk samples :', JSON.stringify(track.slice(0, 6)));
  console.log('distinct tiles visited:', walked, '| first sample posed in bed:', firstLying, 'of', track.length);
  console.log(firstLying === 0 ? 'FAIL — posed in the bed before walking (teleport)' :
              walked > 1 ? 'PASS — the body WALKED to the bed, then got in' : 'INCONCLUSIVE — it never moved');
} finally {
  try { if (cdp) cdp.close && cdp.close(); } catch {}
  try { proc.kill(); } catch {}
  try { if (own) own.kill(); } catch {}
}
