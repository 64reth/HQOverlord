#!/usr/bin/env node
/* dev/refit-select-shots.mjs — live proof shots for the REFIT select-mode + one-voice reshape.
 * Adapted from dev/guided-line-a-shots.mjs (seeded-sidecar + CDP pattern, port 9498 — never 9496).
 *
 * The acceptance scenes (Andrew's text-soup complaint, re-shot):
 *   1. office-at-rest.png     — a stamped SORTING OFFICE with the ghost projection active, cursor
 *                               parked off the deck: at rest the floor speaks with near-zero text
 *                               (brackets + at most the ghost's single WOULD-caption).
 *   2. office-hover-dock.png  — pointer over ONE dock: exactly one voice (the hover prop card).
 *   3. office-mid-connect.png — BELT armed + first machine clicked: the FROM ▸ / CLICK TO CONNECT
 *                               labels exist ONLY now, mid-gesture.
 *   4. esc-deselect-inspect.png — PROP tool armed → ESC drops to SELECT → clicking a bay opens its
 *                               STEP CARD instead of placing anything.
 *
 * 2026-08-07: this asserted `.refit-bay-picker`, the bare agent picker a bay click used to open.
 * The STEP CARD (`.refit-step-card`) replaced it and that class no longer exists anywhere in
 * frontend/, so the check had become a guaranteed failure — the harness was lying about a surface
 * that works. Assert the card that actually opens.
 *
 *   node dev/refit-select-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-refit-select');

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

// dispatch the real pointer sequence at a WORLD tile (Build.__test__._tileEvent inverts the camera)
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

const PARK_CURSOR = `(() => {
  const cv = document.querySelector('.refit-canvas');
  cv.dispatchEvent(new PointerEvent('pointerleave', { pointerId: 1, bubbles: true }));
  return true;
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'refitsel-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const shots = [];
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

    // default text size (the shelf harness's known zoom trap) — pin + reload
    await evalJS(cdp, `(() => {
      const KEY = 'starnet.station.v1';
      const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
      r.settings = Object.assign({}, r.settings, { textScale: 100 });
      localStorage.setItem(KEY, JSON.stringify(r));
      location.reload();
      return 'reloading';
    })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after the text-size reload');
    await sleep(1500);
    const opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(600);

    // PROOF: SELECT is the default — REFIT opens with nothing armed
    const toolAtOpen = await evalJS(cdp, `Build.__test__.tool()`);
    console.log('TOOL AT OPEN (must be select):', toolAtOpen);
    if (toolAtOpen !== 'select') throw new Error('REFIT did not open in select mode: ' + toolAtOpen);

    await evalJS(cdp, CLEAR_FLOOR);

    // ---- stamp the SORTING OFFICE through the REAL pointer path ----
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(300);
    await evalJS(cdp, `(() => { const b = document.querySelector('.refit-linetile[data-line="sorting_office"]'); if (b) b.click(); return !!b; })()`);
    await sleep(300);
    const spot = await evalJS(cdp, findSpot('sorting_office'));
    if (!spot) throw new Error('no stampable spot for sorting_office');
    const bp = { cx: spot.tx + 4, cy: spot.ty + 2 };   // 9×5 blueprint → its center tile
    const stamped = await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const before = st.props().length;
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([${bp.cx}, ${bp.cy}], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      const bays = st.props().filter(p => p.t === 'bay').map(p => ({ id: p.id, x: p.x, y: p.y, role: p.role, agentId: p.agentId || null }));
      return { before, after: st.props().length, tool: Build.__test__.tool(), bays };
    })()`);
    console.log('STAMP:', JSON.stringify(stamped));
    if (!stamped || stamped.after !== stamped.before + 4) throw new Error('sorting_office did not stamp');
    // PROOF: placement flow — a successful blueprint stamp DROPS the tool back to select
    console.log('TOOL AFTER STAMP (must be select):', stamped.tool);
    if (stamped.tool !== 'select') throw new Error('stamp did not drop the tool back to select: ' + stamped.tool);

    // dismiss the belt coach the stamp fires, then park the cursor off the deck
    await sleep(900);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await evalJS(cdp, PARK_CURSOR);
    await sleep(2600);   // let a ghost pass ride so the projection is visibly ACTIVE in the shot

    // ---- SHOT 1: at rest — near-zero floating text ----
    const ghostState = await evalJS(cdp, `JSON.stringify((() => { const g = Build.__test__.ghost(); return g && { projecting: g.projecting, notes: g.notes, boxes: g.boxes.length }; })())`);
    console.log('GHOST AT REST:', ghostState);
    shots.push(await capture(cdp, OUT, 'office-at-rest'));

    // ---- SHOT 2: hover ONE dock — exactly one voice (the hover card) ----
    const eng = stamped.bays.find(b => b.role === 'ENGINEER');
    await evalJS(cdp, hoverTile(eng.x, eng.y + 1));
    await sleep(500);
    const hoverProof = await evalJS(cdp, `JSON.stringify({
      card: (() => { const c = document.querySelector('#refit-propcard'); return c && c.style.display === 'block' ? c.textContent.trim().slice(0, 120) : null; })(),
      tool: Build.__test__.tool()
    })`);
    console.log('HOVER:', hoverProof);
    shots.push(await capture(cdp, OUT, 'office-hover-dock'));

    // ---- SHOT 3: mid-connect — FROM/TO labels exist ONLY now ----
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="belt"]').click()`);
    await sleep(300);
    await evalJS(cdp, clickTile(spot.tx, spot.ty));          // click the INTAKE → connect flow armed
    await evalJS(cdp, hoverTile(spot.tx + 3, spot.ty + 1));  // pointer mid-line, like a user seeking the target
    await sleep(1600);                                       // let the FROM ▸ action tip expire — canvas labels remain
    shots.push(await capture(cdp, OUT, 'office-mid-connect'));

    // right-click cancels the half-made connection AND drops the tool back to select
    const rcTool = await evalJS(cdp, `(() => {
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([${bp.cx}, ${bp.cy}], 2);
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 2, bubbles: true }));
      return Build.__test__.tool();
    })()`);
    console.log('TOOL AFTER RIGHT-CLICK (must be select):', rcTool);
    if (rcTool !== 'select') throw new Error('right-click did not drop the tool to select: ' + rcTool);

    // ---- SHOT 4: ESC deselect → click a bay opens its STEP CARD (inspect, never place) ----
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="prop"]').click()`);
    await sleep(300);
    const escProof = await evalJS(cdp, `JSON.stringify((() => {
      const armed = Build.__test__.tool();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      const after = Build.__test__.tool();
      return { armed, after };
    })())`);
    console.log('ESC DESELECT:', escProof);
    const esc = JSON.parse(escProof);
    if (esc.armed !== 'prop' || esc.after !== 'select') throw new Error('ESC did not drop prop→select: ' + escProof);
    const before = await evalJS(cdp, `Build.__test__.station().props().length`);
    await evalJS(cdp, clickTile(eng.x, eng.y + 1));          // click the ENGINEER bay in select mode
    await sleep(500);
    const inspectProof = await evalJS(cdp, `JSON.stringify({
      stepCardOpen: !!document.querySelector('.refit-step-card'),
      props: Build.__test__.station().props().length
    })`);
    console.log('INSPECT ON CLICK:', inspectProof, '(props before:', before + ')');
    const ins = JSON.parse(inspectProof);
    if (!ins.stepCardOpen) throw new Error('bay click in select mode did not open the step card');
    if (ins.props !== before) throw new Error('bay click placed something: ' + before + ' -> ' + ins.props);
    shots.push(await capture(cdp, OUT, 'esc-deselect-inspect'));

    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
