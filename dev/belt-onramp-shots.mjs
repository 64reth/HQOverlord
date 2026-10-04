#!/usr/bin/env node
/* dev/belt-onramp-shots.mjs — live proof shots for the belt-onramp lane.
 *
 * Boots a seeded sidecar from THIS worktree, drives the REAL app over CDP (the established
 * headless pattern — see catshot.mjs / scripts/lib/cdp.mjs), and captures:
 *   1. lines-palette.png     — the LINES tool armed: THE ONE SENTENCE + the four blueprint tiles
 *   2. ghost-<bp>.png        — each blueprint's green ghost following the cursor
 *   3. stamped-<bp>.png      — each blueprint stamped on a fresh floor (amber UNBOUND_BAY nags only)
 *   4. first-ride.png        — an agent bound to a stamped bay -> the auto-narrated first crate
 *                              mid-ride, caption visible (Feature 2 firing unprompted)
 *   5. belt-sentence.png     — the BELT tool's palette idle state showing the sentence
 *
 *   node dev/belt-onramp-shots.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-belt-onramp');

// open REFIT and wait for its DOM
const OPEN_REFIT = `(() => {
  if (typeof Build === 'undefined') return 'no-build';
  if (!Build.isOpen()) Build.open();
  const card = document.querySelector('.refit-firstrun');   // dismiss the first-run card if it landed
  if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
  return Build.isOpen() ? 'open' : 'failed';
})()`;

// clear every workflow machine + belt off the floor so each blueprint stamps on a fresh deck
const CLEAR_FLOOR = `(() => {
  const st = Build.__test__.station();
  for (const b of st.belts()) st.removeBelt(b.x, b.y);
  const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
  for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
  return { props: st.props().filter(p => WF[p.t]).length, belts: st.belts().length };
})()`;

// find a stampable origin for a blueprint by scanning the station bounds (real validator)
const findSpot = (bpId) => `(() => {
  const st = Build.__test__.station();
  const b = st.bounds();
  for (let ty = b.minTy - 2; ty <= b.maxTy + 2; ty++)
    for (let tx = b.minTx - 2; tx <= b.maxTx + 2; tx++)
      if (st.canPlaceBlueprint(${JSON.stringify(bpId)}, tx, ty).ok) return { tx, ty };
  return null;
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'beltonramp-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const shots = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    // ---- REFIT open + LINES palette (Feature 1 + the sentence, Feature 3) ----
    const opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(600);
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(500);
    const paletteProof = await evalJS(cdp, `(() => {
      const intro = document.querySelector('.refit-lineintro');
      const tiles = [...document.querySelectorAll('.refit-linetile')].map(b => b.dataset.line);
      return { sentence: intro ? intro.textContent.slice(0, 60) : null, tiles };
    })()`);
    console.log('LINES palette:', JSON.stringify(paletteProof));
    shots.push(await capture(cdp, OUT, 'lines-palette'));

    // ---- BELT tool idle state shows the sentence (Feature 3) ----
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="belt"]').click()`);
    await sleep(400);
    const beltProof = await evalJS(cdp, `(() => {
      const intro = document.querySelector('.refit-lineintro');
      return intro ? intro.textContent : null;
    })()`);
    console.log('BELT palette sentence:', JSON.stringify(beltProof));
    shots.push(await capture(cdp, OUT, 'belt-sentence'));
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(300);

    // ---- each blueprint: fresh floor -> ghost -> stamp -> shot ----
    const bps = await evalJS(cdp, `WorldModel.BLUEPRINTS.map(b => b.id)`);
    for (const bpId of bps) {
      await evalJS(cdp, CLEAR_FLOOR);
      await evalJS(cdp, `(() => {
        const b = [...document.querySelectorAll('.refit-linetile')].find(x => x.dataset.line === ${JSON.stringify(bpId)});
        if (b) b.click();
      })()`);
      await sleep(300);
      const spot = await evalJS(cdp, findSpot(bpId));
      if (!spot) { console.log('NO SPOT for ' + bpId); continue; }
      // ghost: drive the REAL pointer path over the blueprint's center tile
      const ghosted = await evalJS(cdp, `(() => {
        const bp = WorldModel.BLUEPRINTS.find(b => b.id === ${JSON.stringify(bpId)});
        const cx = ${spot.tx} + (bp.w >> 1), cy = ${spot.ty} + (bp.h >> 1);
        const cv = document.querySelector('.refit-canvas');
        const ev = Build.__test__._tileEvent([cx, cy], 0);
        cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
        return { cx, cy };
      })()`);
      await sleep(400);
      shots.push(await capture(cdp, OUT, 'ghost-' + bpId));
      // stamp through the REAL pointer path (down at the same tile)
      const stamped = await evalJS(cdp, `(() => {
        const bp = WorldModel.BLUEPRINTS.find(b => b.id === ${JSON.stringify(bpId)});
        const st = Build.__test__.station();
        const before = st.props().length;
        const cx = ${spot.tx} + (bp.w >> 1), cy = ${spot.ty} + (bp.h >> 1);
        const cv = document.querySelector('.refit-canvas');
        const ev = Build.__test__._tileEvent([cx, cy], 0);
        cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
        cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
        return { before, after: st.props().length, belts: st.belts().length };
      })()`);
      console.log('stamp ' + bpId + ':', JSON.stringify(stamped));
      await sleep(700);   // let the UNBOUND_BAY callouts + flash render
      shots.push(await capture(cdp, OUT, 'stamped-' + bpId));
    }

    // ---- Feature 2: bind an agent on the stamped RESEARCH LINE -> the auto first ride fires ----
    await evalJS(cdp, CLEAR_FLOOR);
    await evalJS(cdp, `localStorage.removeItem(Object.keys(localStorage).find(k => k.startsWith('starnet.refit.firstride')) || 'x')`);
    const spot2 = await evalJS(cdp, findSpot('research_line'));
    if (!spot2) throw new Error('no spot for the first-ride proof');
    const rideSetup = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const res = st.stampBlueprint('research_line', ${spot2.tx}, ${spot2.ty});
      if (!res.ok) return { error: res.error || 'stamp failed' };
      const bays = st.props().filter(p => p.t === 'bay');
      // bind ONLY the first bay — the moment the line truly powers on
      const agents = (window.App && App.agents) ? null : null;
      const bind = st.assignPropAgent(bays[0].id, 'w0');
      return { stamped: res.ids.length, bind: bind.ok, bay: bays[0].id };
    })()`);
    console.log('ride setup:', JSON.stringify(rideSetup));
    const coaching = await evalJS(cdp, `(typeof Tutorial !== 'undefined' && Tutorial.isCoaching) ? Tutorial.isCoaching() : 'no-tutorial'`);
    console.log('tutorial coaching (ride defers while true):', JSON.stringify(coaching));
    if (coaching === true) {
      // the ride correctly STOOD DOWN while a coach bubble was live (the tutorial-audit law).
      // Dismiss the coach the way a user would move on, and the armed ride must then fire.
      await evalJS(cdp, `(typeof Tutorial !== 'undefined' && Tutorial.clearCoach) ? (Tutorial.clearCoach(), Tutorial.isCoaching()) : null`);
      console.log('coach dismissed; ride should now fire from the frame loop');
    }
    // the auto ride arms on the recompile and fires ~700ms later; catch it mid-narration
    await sleep(2000);
    const rideProof = await evalJS(cdp, `(() => {
      const key = Object.keys(localStorage).find(k => k.startsWith('starnet.refit.firstride'));
      return { fired: !!key, flag: key || null };
    })()`);
    console.log('ride fired:', JSON.stringify(rideProof));
    shots.push(await capture(cdp, OUT, 'first-ride'));
    await sleep(1500);
    shots.push(await capture(cdp, OUT, 'first-ride-2'));

    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
