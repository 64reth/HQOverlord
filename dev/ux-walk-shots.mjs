#!/usr/bin/env node
/* dev/ux-walk-shots.mjs — walk the conveyor system the way a FIRST-TIME user does and shoot every
   screen they actually meet, so a UX pass judges PIXELS, not intentions. Adapted from
   dev/refit-select-shots.mjs (seeded sidecar + CDP, port 9498 — never 9496).

   The walk: REFIT opens → LINES shelf → blueprint ghost → stamped line → the finish card →
   click a dock (STEP card) → click the INBOX (TRIGGER card) → hover a dock.

     node dev/ux-walk-shots.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT) */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-ux-walk');

const OPEN_REFIT = `(() => {
  if (typeof Build === 'undefined') return 'no-build';
  if (!Build.isOpen()) Build.open();
  const card = document.querySelector('.refit-firstrun');
  if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
  return Build.isOpen() ? 'open' : 'failed';
})()`;

const CLEAR_FLOOR = `(() => {
  const st = Build.__test__.station();
  for (const b of st.belts()) st.removeBelt(b.x, b.y);
  const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
  for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
  return { belts: st.belts().length };
})()`;

const findSpot = (bpId) => `(() => {
  const st = Build.__test__.station();
  const b = st.bounds();
  for (let ty = b.minTy - 2; ty <= b.maxTy + 2; ty++)
    for (let tx = b.minTx - 2; tx <= b.maxTx + 2; tx++)
      if (st.canPlaceBlueprint(${JSON.stringify(bpId)}, tx, ty).ok) return { tx, ty };
  return null;
})()`;

const clickTile = (tx, ty) => `(() => {
  const cv = document.querySelector('.refit-canvas');
  const ev = Build.__test__._tileEvent([${tx}, ${ty}], 0);
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
  cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
  cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
  return true;
})()`;

const hoverTile = (tx, ty) => `(() => {
  const cv = document.querySelector('.refit-canvas');
  const ev = Build.__test__._tileEvent([${tx}, ${ty}], 0);
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
  return true;
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'uxwalk-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const notes = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,1040', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    await evalJS(cdp, `(() => {
      const KEY = 'starnet.station.v1';
      const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
      r.settings = Object.assign({}, r.settings, { textScale: 100 });
      localStorage.setItem(KEY, JSON.stringify(r));
      location.reload(); return 'reloading';
    })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after reload');
    await sleep(1500);

    // 1. the world BEFORE build mode — what a user sees when they think "I want a workflow"
    await capture(cdp, OUT, '01-world-before');

    const opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(800);
    await evalJS(cdp, CLEAR_FLOOR);
    await sleep(600);
    // 2. REFIT just opened on a floor with no line yet
    await capture(cdp, OUT, '02-refit-open');

    // 3. the LINES shelf
    await evalJS(cdp, `Build.__test__.setTool ? Build.__test__.setTool('line') : (document.querySelector('[data-tool="line"]') || {click(){}}).click()`);
    await sleep(500);
    const toolNow = await evalJS(cdp, `Build.__test__.tool()`);
    notes.push('tool after LINES: ' + toolNow);
    await capture(cdp, OUT, '03-lines-shelf');

    // 4. ghost + stamp of the sorting office
    const spot = await evalJS(cdp, findSpot('sorting_office'));
    notes.push('sorting_office spot: ' + JSON.stringify(spot));
    if (spot && spot.tx !== undefined) {
      // the shelf cards are `.refit-linetile[data-line]` — the old `.refit-linecard,[data-bp]`
      // selector matched NOTHING, so this walk silently ghosted whatever blueprint was already
      // armed (research_line) at the sorting office's anchor, and the "stamp" never landed.
      await evalJS(cdp, `(() => { const c = document.querySelector('.refit-linetile[data-line="sorting_office"]'); if (c) c.click(); return !!c; })()`);
      await sleep(400);
      /* findSpot returns an ORIGIN, but the pointer addresses a blueprint by its CENTRE tile (the
         ghost is centred under the cursor). Aiming at the origin put the cursor ~4.5 tiles off any
         legal placement — outside the snap radius, correctly red — so this walk never stamped and
         reported `bay: null` while claiming to shoot a stamped line. sorting_office is 9×5. */
      const aim = { tx: spot.tx + 4, ty: spot.ty + 2 };
      notes.push('aim (centre tile): ' + JSON.stringify(aim));
      await evalJS(cdp, hoverTile(aim.tx, aim.ty));
      await sleep(400);
      await capture(cdp, OUT, '04-blueprint-ghost');
      await evalJS(cdp, clickTile(aim.tx, aim.ty));
      await sleep(1400);
      await capture(cdp, OUT, '05-stamped-line');
    }

    // 5. the step card on a dock
    const bay = await evalJS(cdp, `(() => { const b = Build.__test__.station().props().find(p => p.t === 'bay'); return b ? { x: b.x, y: b.y, id: b.id } : null; })()`);
    notes.push('bay: ' + JSON.stringify(bay));
    if (bay && bay.x !== undefined) {
      await evalJS(cdp, clickTile(bay.x, bay.y));
      await sleep(1200);
      await capture(cdp, OUT, '06-step-card');
      await evalJS(cdp, `(() => { const b = [...document.querySelectorAll('button,.refit-btn')].find(e => /close|done|✕|cancel/i.test(e.textContent||'')); if (b) b.click(); return !!b; })()`);
      await sleep(600);
    }

    // 6. the trigger card on the inbox
    const intake = await evalJS(cdp, `(() => { const p = Build.__test__.station().props().find(p => p.t === 'intake'); return p ? { x: p.x, y: p.y } : null; })()`);
    notes.push('intake: ' + JSON.stringify(intake));
    if (intake && intake.x !== undefined) {
      await evalJS(cdp, clickTile(intake.x, intake.y));
      await sleep(1200);
      await capture(cdp, OUT, '07-trigger-card');
    }

    console.log('NOTES:', JSON.stringify(notes, null, 1));
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions).slice(0, 900));
    console.log('SHOTS IN:', OUT);
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
  }
}
main().catch(e => { console.error('WALK FAILED:', e.message); process.exit(1); });
