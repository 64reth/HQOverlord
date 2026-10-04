#!/usr/bin/env node
/* dev/line-placement-shots.mjs — live proof for the LINE PLACEMENT lane (2026-08-07).
 *
 * The three walls a beginner hit, and the scenes that prove each one is gone:
 *   1. "where is this even legal?"  → 03-candidate-wash    (the dim candidate field under the ghost)
 *   2. "I clicked and got red"      → 04-snapped-ghost + 05-roughly-there-stamp
 *   3. "I can't see the whole line" → 06-autofit-frame     (zoom before/after, printed)
 *   plus 01/02  STATION ORDERS on a bare floor is the ONLY thing inviting a line (no canvas
 *               invitation any more — retired 2026-08-07), and its ④ arms LINES
 *   plus 07     shelf honesty: a blueprint the deck cannot hold says so
 *   plus 08     ONE COMBINED SCENE — wash + ghost + nags + finish card at once (no text soup)
 *   plus 09     the frame-loop guard: a throwing draw layer must not blank the canvas
 *
 * Seeded sidecar + CDP on port 9498 — NEVER 9496 (that is the live demo).
 *   node dev/line-placement-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-line-placement');

const OPEN_REFIT = `(() => {
  if (typeof Build === 'undefined') return 'no-build';
  if (!Build.isOpen()) Build.open();
  const card = document.querySelector('.refit-firstrun');
  if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
  return Build.isOpen() ? 'open' : 'failed';
})()`;

/* A GENUINELY FRESH STATION HAS NEVER CARRIED A LINE. The dev seed ships one, so the floor is
   stripped back to bare deck — and STATION ORDERS' dismiss latch is cleared with it, since a
   dismissed checklist would hide the very guidance these first two scenes are about. */
const FRESH_FLOOR = `(() => {
  const st = Build.__test__.station();
  for (const b of st.belts()) st.removeBelt(b.x, b.y);
  const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
  for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
  localStorage.removeItem('starnet.refit.orders.dis');
  return { belts: st.belts().length, lineParts: st.props().filter(p => WF[p.t]).length };
})()`;

// what the shared guidance card slot is showing right now — ORDERS (before any line) or FINISH
// THE LINE (after one). ONE VOICE: `cards` must never exceed 1.
const CARD_SLOT = `(() => {
  const el = document.querySelector('.refit-finline');
  return {
    cards: document.querySelectorAll('.refit-finline').length,
    orders: !!(el && el.classList.contains('refit-orders')),
    title: el ? (el.querySelector('.fl-title') || {}).textContent : null,
    count: el ? ((el.querySelector('.fl-count') || {}).textContent || null) : null,
    steps: el ? [...el.querySelectorAll('.fl-step')].map(b => ({
      ord: b.dataset.ord || null, txt: b.textContent.trim(), done: b.classList.contains('done') })) : [],
    canvasInvite: typeof Build.__test__.lineInvite,   // 'undefined' = the standalone invite is gone
  };
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

// the dock buttons TOGGLE — clicking the already-armed tool drops back to SELECT and tears down
// its palette, so arm only when it isn't armed already.
const armLine = (id) => `(() => {
  if (Build.__test__.tool() !== 'line') document.querySelector('.refit-tool[data-tool="line"]').click();
  const c = document.querySelector('.refit-linetile[data-line=${JSON.stringify(id)}]');
  if (c) c.click();
  return { tool: Build.__test__.tool(), bp: c && c.dataset.line, card: !!c };
})()`;

const J = (cdp, expr) => evalJS(cdp, `JSON.stringify(${expr})`).then(s => JSON.parse(s));

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'lineplace-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const shots = [], proof = {};
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
      location.reload(); return 'reloading';
    })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after the text-size reload');
    await sleep(1500);

    const opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(700);
    proof.freshFloor = await J(cdp, FRESH_FLOOR);
    await sleep(1200);

    /* ---- 1. STATION ORDERS is the ONLY invitation on a bare floor ----
       The standalone canvas prompt was retired (2026-08-07): two voices asking for the same act
       is exactly what the one-voice law forbids, and leading with the line read as "build mode is
       about conveyors". ORDERS sequences the whole mode and its ④ is the line's one invitation. */
    proof.ordersAtRest = await J(cdp, CARD_SLOT);
    shots.push(await capture(cdp, OUT, '01-empty-floor-orders'));
    if (proof.ordersAtRest.canvasInvite !== 'undefined') throw new Error('the retired canvas invitation is still wired: ' + proof.ordersAtRest.canvasInvite);
    if (!proof.ordersAtRest.orders) throw new Error('STATION ORDERS is not in the card slot on a bare floor: ' + JSON.stringify(proof.ordersAtRest));
    if (proof.ordersAtRest.cards !== 1) throw new Error('one voice: expected exactly one guidance card, got ' + proof.ordersAtRest.cards);
    if (!proof.ordersAtRest.steps.some(s => s.ord === 'line' && !s.done)) throw new Error('ORDERS is not offering ④ STAMP A WORK LINE: ' + JSON.stringify(proof.ordersAtRest.steps));

    // ---- 2. ITS ④ ARMS LINES (the same thing key 9 does) — and the wash comes with it ----
    proof.ordersClick = await J(cdp, `(() => {
      const before = Build.__test__.tool();
      document.querySelector('.refit-finline [data-ord="line"]').click();
      return { before, after: Build.__test__.tool() };
    })()`);
    if (proof.ordersClick.after !== 'line') throw new Error('ORDERS ④ did not arm LINES: ' + JSON.stringify(proof.ordersClick));
    await sleep(700);
    proof.ordersHandoff = await J(cdp, `Build.__test__.lineField()`);
    if (!proof.ordersHandoff || !proof.ordersHandoff.count) throw new Error('arming from ORDERS yielded no candidate wash: ' + JSON.stringify(proof.ordersHandoff));
    shots.push(await capture(cdp, OUT, '02-orders-arms-lines'));

    // ---- 3. THE CANDIDATE WASH under an armed blueprint ----
    proof.arm = await J(cdp, armLine('sorting_office'));
    await sleep(800);
    proof.field = await J(cdp, `Build.__test__.lineField('sorting_office')`);
    if (!proof.field || !proof.field.count) throw new Error('no candidate field for sorting_office');
    shots.push(await capture(cdp, OUT, '03-candidate-wash'));

    /* ---- 4. SNAP: aim at a tile that is genuinely NOT legal, the ghost lands on one that is ----
       Probe outward from a known-good anchor for the first tile the model REFUSES which is still
       inside the snap radius — otherwise "roughly there" would be tested on a tile that was
       already legal and would prove nothing. */
    const probe = await J(cdp, `(() => {
      const f = Build.__test__.lineField('sorting_office'), s0 = f.sample[0];
      for (let d = 1; d <= 4; d++)
        for (const o of [[0,d],[0,-d],[d,0],[-d,0],[d,d],[-d,-d]]) {
          const tx = s0.tx + o[0], ty = s0.ty + o[1];
          const r = Build.__test__.lineSnapAt(tx, ty);
          if (r.snapped) return { aim: { tx, ty }, snap: r, offBy: o };
        }
      return null;
    })()`);
    if (!probe) throw new Error('found no off-field aim that snaps — the snap is not being exercised');
    const aim = probe.aim;
    proof.snap = probe.snap; proof.aim = aim; proof.snapOffBy = probe.offBy;
    if (!proof.snap.snapped) throw new Error('the probe tile did not snap');
    await evalJS(cdp, hoverTile(aim.tx, aim.ty));
    await sleep(600);
    shots.push(await capture(cdp, OUT, '04-snapped-ghost'));

    // ---- 5. the SAME roughly-there click stamps ----
    proof.stamp = await J(cdp, `(() => {
      const st = Build.__test__.station();
      const before = st.props().length;
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([${aim.tx}, ${aim.ty}], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      return { before, after: st.props().length, tool: Build.__test__.tool(), canUndo: st.canUndo() };
    })()`);
    if (proof.stamp.after <= proof.stamp.before) throw new Error('the roughly-there click did not stamp: ' + JSON.stringify(proof.stamp));
    await sleep(1400);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await sleep(700);
    shots.push(await capture(cdp, OUT, '05-roughly-there-stamp'));

    // ONE UNDO REMOVES THE WHOLE LINE (existing behaviour must survive the snap)
    proof.undo = await J(cdp, `(() => {
      const st = Build.__test__.station(); const before = st.props().length;
      st.undo(); return { before, after: st.props().length };
    })()`);
    if (proof.undo.after !== proof.stamp.before) throw new Error('one undo did not remove the whole line: ' + JSON.stringify(proof.undo));

    // ---- 6. AUTO-FIT: zoom in hard, then arm the 17-tile line ----
    proof.fit = await J(cdp, `(() => {
      const wheel = (d) => document.querySelector('.refit-canvas').dispatchEvent(
        new WheelEvent('wheel', { deltaY: d, clientX: 800, clientY: 500, bubbles: true, cancelable: true }));
      document.querySelector('.refit-tool[data-tool="select"]').click();
      for (let i = 0; i < 6; i++) wheel(-120);          // zoom right in — the beginner's default is already 168%
      const bpw = 17;   // RESEARCH LINE is 17 tiles wide
      // the VISIBLE glass, not the raw canvas: the build dock covers the left inset
      const fits = (c) => (bpw + 2) * c.tile * c.zoom <= (c.cw - c.ins.l);
      const zoomedIn = Build.__test__.camera();
      const fitsBefore = fits(zoomedIn);
      document.querySelector('.refit-tool[data-tool="line"]').click();
      document.querySelector('.refit-linetile[data-line="research_line"]').click();
      const after = Build.__test__.camera();
      return { zoomBefore: zoomedIn.zoom, zoomAfter: after.zoom, dockInset: after.ins.l,
               fitsBefore, fitsAfter: fits(after) };
    })()`);
    if (proof.fit.fitsBefore) throw new Error('setup failed: the 17-tile line already fitted before arming');
    if (!proof.fit.fitsAfter) throw new Error('arming did not frame the footprint: ' + JSON.stringify(proof.fit));
    await sleep(900);
    shots.push(await capture(cdp, OUT, '06-autofit-frame'));

    /* ---- 7. SHELF HONESTY: a deck with no room left must SAY so ----
       Lay a lattice of belts across the whole floor. checkBlueprint refuses any tile that already
       carries a belt (ON_BELT — never bury a lane the Commander laid), so this is a genuinely
       full deck, not a doctored flag. */
    proof.nofit = await J(cdp, `(() => {
      const st = Build.__test__.station(), b = st.bounds();
      let n = 0;
      for (let ty = b.minTy; ty <= b.maxTy; ty += 2)
        for (let tx = b.minTx; tx <= b.maxTx; tx++)
          if (st.setBelt(tx, ty, 'E').ok) n++;
      document.querySelector('.refit-tool[data-tool="select"]').click();
      document.querySelector('.refit-tool[data-tool="line"]').click();
      return {
        beltsLaid: n,
        cards: [...document.querySelectorAll('.refit-linetile')].map(c => ({
          bp: c.dataset.line, nofit: c.classList.contains('nofit'),
          note: (c.querySelector('.refit-linetile-nofit') || {}).textContent || null,
        })),
      };
    })()`);
    await sleep(700);
    shots.push(await capture(cdp, OUT, '07-nofit-shelf'));
    if (!proof.nofit.cards.some(c => c.nofit)) throw new Error('a fully-belted deck still offered every blueprint as placeable');

    // ---- 8. THE COMBINED SCENE: wash + ghost + a stamped line's nags + the finish card ----
    proof.combined = await J(cdp, `(() => {
      const st = Build.__test__.station();
      for (const b of st.belts()) st.removeBelt(b.x, b.y);   // clear the lattice back off
      return { belts: st.belts().length };
    })()`);
    await sleep(900);
    // stamp a line (unbound bays => amber nags + the finish-the-line card), then arm LINES again
    const spot2 = await J(cdp, `(() => {
      const f = Build.__test__.lineField('ship_out');
      return f && f.count ? f.sample[0] : null;
    })()`);
    if (spot2) {
      await evalJS(cdp, armLine('ship_out'));
      await sleep(400);
      await evalJS(cdp, clickTile(spot2.tx, spot2.ty));
      await sleep(1500);
      await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
      await sleep(600);
    }
    await evalJS(cdp, armLine('sorting_office'));
    await sleep(700);
    const f3 = await J(cdp, `Build.__test__.lineField('sorting_office')`);
    if (f3 && f3.count) await evalJS(cdp, hoverTile(f3.sample[0].tx + 1, f3.sample[0].ty));
    await sleep(900);
    proof.combinedScene = await J(cdp, `({
      field: Build.__test__.lineField('sorting_office'),
      slot: ${CARD_SLOT},
      fin: !!Build.__test__.finCard(),
      degraded: Build.__test__.degradedLayers(),
    })`);
    // ONE VOICE, still: a line now exists, so the shared slot has handed ORDERS off to FINISH THE
    // LINE — one card, and nothing else on the canvas is asking for a line.
    if (proof.combinedScene.slot.cards !== 1) throw new Error('one voice: ' + proof.combinedScene.slot.cards + ' guidance cards at once');
    if (proof.combinedScene.slot.orders) throw new Error('STATION ORDERS never handed off after a line was stamped');
    shots.push(await capture(cdp, OUT, '08-combined-scene'));

    // ---- 9. THE FRAME-LOOP GUARD: make a draw layer throw, prove the canvas keeps painting ----
    proof.guard = await J(cdp, `(() => {
      const before = Build.__test__.degradedLayers();
      const real = PropSprites.draw;
      PropSprites.draw = function () { throw new TypeError("Cannot read properties of undefined (reading 'slice')"); };
      return { beforeDegraded: before, patched: PropSprites.draw !== real };
    })()`);
    await sleep(1500);
    proof.guardAfter = await J(cdp, `(() => {
      const root = document.querySelector('.refit-overlay');
      return {
        degraded: Build.__test__.degradedLayers(),
        renderState: root && root.dataset.renderState,
        renderFailures: root && root.dataset.renderFailures,
        renderDegraded: root && root.dataset.renderDegraded,
      };
    })()`);
    if (!proof.guardAfter.degraded.includes('props')) throw new Error('the throwing layer was not recorded: ' + JSON.stringify(proof.guardAfter));
    if (proof.guardAfter.renderState !== 'ready') throw new Error('a single bad layer took the whole frame down: ' + JSON.stringify(proof.guardAfter));
    // the canvas must still carry the station, not a black rectangle — sample real pixels
    proof.guardPixels = await J(cdp, `(() => {
      const cv = document.querySelector('.refit-canvas');
      const g = cv.getContext('2d');
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let lit = 0, total = 0;
      for (let i = 0; i < d.length; i += 4 * 997) { total++; if (d[i] + d[i+1] + d[i+2] > 90) lit++; }
      return { total, lit, litPct: +(100 * lit / total).toFixed(1) };
    })()`);
    if (proof.guardPixels.litPct < 5) throw new Error('REFIT went dark behind the guard: ' + JSON.stringify(proof.guardPixels));
    shots.push(await capture(cdp, OUT, '09-layer-guard-still-paints'));
    await evalJS(cdp, `(() => { location.reload(); return 1; })()`);

    console.log('CONSOLE ERRORS:', JSON.stringify(diag.consoleMsgs.slice(0, 12)));
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions.slice(0, 6)));
  } finally {
    // print what we proved even when a later assertion fails — a failure with no readout teaches nothing
    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), proof }, null, 2));
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill ? side.kill() : (side.proc && side.proc.kill()); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
