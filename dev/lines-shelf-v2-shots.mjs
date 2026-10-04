#!/usr/bin/env node
/* dev/lines-shelf-v2-shots.mjs — live proof shots for the LINES shelf v2 presentation.
 * Adapted from dev/belt-onramp-shots.mjs (the established seeded-sidecar + CDP pattern).
 *
 * Captures:
 *   1. lines-shelf-v2.png     — the LINES palette: four uniform cards (schematic miniature,
 *                               NAME + footprint/dock chip, one-line purpose, footer note)
 *   2. lines-shelf-hover.png  — a REAL :hover on the SORTING OFFICE card (CDP Input mouseMoved)
 *   3. ghost-research.png     — the blueprint ghost following the cursor (behavior untouched)
 *   4. stamped-research.png   — the stamp landing (behavior untouched)
 *
 *   node dev/lines-shelf-v2-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-lines-v2');

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

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'linesv2-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const shots = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    // 1040 tall: the seed profile ships body zoom 1.15, which pushes the dock's vh-computed
    // bottom to ~939 real px — a 900px window clips the shelf's footer (pre-existing zoom trap)
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,1040', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    // ---- LINES palette: the four v2 cards + DOM anatomy proof ----
    // TEXT SIZE AUTO resolves to 115% on this screen, and the vh-sized dock is uiZoom-scaled —
    // it renders 15% past the glass (the known dock/zoom trait, app.css ~3274). Pin the REAL
    // setting to 100% and reload so the shots show the default-text-size presentation.
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
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(500);
    const proof = await evalJS(cdp, `(() => {
      const cards = [...document.querySelectorAll('.refit-linetile')].map(b => ({
        id: b.dataset.line,
        name: (b.querySelector('.refit-matname') || {}).textContent || null,
        stat: (b.querySelector('.refit-linetile-stat') || {}).textContent || null,
        why: (b.querySelector('.refit-linetile-why') || {}).textContent || null,
        cv: !!b.querySelector('.refit-linetile-cv'),
        w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height),
      }));
      const note = document.querySelector('.refit-linenote');
      return { cards, note: note ? note.textContent.slice(0, 50) : null };
    })()`);
    console.log('SHELF v2:', JSON.stringify(proof, null, 1));
    shots.push(await capture(cdp, OUT, 'lines-shelf-v2'));

    // ---- the shelf's tail: SHIP-OUT LOOP card + the operational footer under the grid ----
    const tail = await evalJS(cdp, `(() => {
      const p = document.querySelector('.refit-palette'); p.scrollTop = p.scrollHeight;
      const n = document.querySelector('.refit-linenote');
      const nr = n.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return { scrollTop: p.scrollTop, zoom: getComputedStyle(document.body).zoom || null,
               noteText: n.textContent.slice(0, 40), noteBottom: Math.round(nr.bottom), palBottom: Math.round(pr.bottom),
               noteInPal: nr.bottom <= pr.bottom + 2 };
    })()`);
    console.log('SHELF TAIL:', JSON.stringify(tail));
    await sleep(300);
    shots.push(await capture(cdp, OUT, 'lines-shelf-v2-foot'));
    await evalJS(cdp, `(() => { const p = document.querySelector('.refit-palette'); p.scrollTop = 0; })()`);
    await sleep(200);

    // ---- REAL hover on the SORTING OFFICE card (CDP Input -> CSS :hover fires) ----
    const rect = await evalJS(cdp, `(() => {
      const b = [...document.querySelectorAll('.refit-linetile')].find(x => x.dataset.line === 'sorting_office');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await sleep(400);
    const hovered = await evalJS(cdp, `(() => {
      const b = [...document.querySelectorAll('.refit-linetile')].find(x => x.matches(':hover'));
      return b ? { id: b.dataset.line, border: getComputedStyle(b).borderColor } : null;
    })()`);
    console.log('HOVER:', JSON.stringify(hovered));
    shots.push(await capture(cdp, OUT, 'lines-shelf-hover'));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 10 });

    // ---- ghost + stamp still work (behavior untouched) ----
    await evalJS(cdp, CLEAR_FLOOR);
    await evalJS(cdp, `(() => {
      const b = [...document.querySelectorAll('.refit-linetile')].find(x => x.dataset.line === 'research_line');
      if (b) b.click();
    })()`);
    await sleep(300);
    const spot = await evalJS(cdp, findSpot('research_line'));
    if (!spot) throw new Error('no stampable spot for research_line');
    await evalJS(cdp, `(() => {
      const bp = WorldModel.BLUEPRINTS.find(b => b.id === 'research_line');
      const cx = ${spot.tx} + (bp.w >> 1), cy = ${spot.ty} + (bp.h >> 1);
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([cx, cy], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      return { cx, cy };
    })()`);
    await sleep(400);
    shots.push(await capture(cdp, OUT, 'ghost-research'));
    const stamped = await evalJS(cdp, `(() => {
      const bp = WorldModel.BLUEPRINTS.find(b => b.id === 'research_line');
      const st = Build.__test__.station();
      const before = st.props().length;
      const cx = ${spot.tx} + (bp.w >> 1), cy = ${spot.ty} + (bp.h >> 1);
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([cx, cy], 0);
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      return { before, after: st.props().length, belts: st.belts().length };
    })()`);
    console.log('STAMP:', JSON.stringify(stamped));
    await sleep(700);
    shots.push(await capture(cdp, OUT, 'stamped-research'));

    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
