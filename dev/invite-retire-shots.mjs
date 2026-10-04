#!/usr/bin/env node
/* dev/invite-retire-shots.mjs — live proof for the INVITE RETIRE lane (2026-08-07).
 *
 * The standalone "START A WORK LINE HERE" canvas invitation is GONE. STATION ORDERS is now the
 * only thing inviting a line, and arming LINES from its (4) still yields the candidate wash.
 *   01  a bare starter floor in REFIT: STATION ORDERS, and NO canvas invitation
 *   02  clicking (4) STAMP A WORK LINE arms LINES — with the candidate wash painted on the deck,
 *       proved by PIXELS: the SAME field tiles sampled off the canvas before and after arming
 *   03  ONE VOICE, combined: a line stamped, the slot handed off to FINISH THE LINE, wash+ghost
 *       live on the deck, and nothing anywhere still asking for a first line
 *
 * Seeded sidecar + CDP on port 9498 — NEVER 9496 (that is the live demo).
 *   node dev/invite-retire-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-invite-retire');
const J = (cdp, expr) => evalJS(cdp, `JSON.stringify(${expr})`).then(s => JSON.parse(s));

const OPEN_REFIT = `(() => {
  if (typeof Build === 'undefined') return 'no-build';
  if (!Build.isOpen()) Build.open();
  const card = document.querySelector('.refit-firstrun');
  if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
  return Build.isOpen() ? 'open' : 'failed';
})()`;

// strip the seed's shipped line back to bare deck, and un-dismiss ORDERS (a dismissed checklist
// would hide the very guidance these scenes are about)
const FRESH_FLOOR = `(() => {
  const st = Build.__test__.station();
  for (const b of st.belts()) st.removeBelt(b.x, b.y);
  const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
  for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
  localStorage.removeItem('starnet.refit.orders.dis');
  return { belts: st.belts().length, lineParts: st.props().filter(p => WF[p.t]).length };
})()`;

// what the shared guidance card slot is showing — ORDERS (before any line) or FINISH THE LINE
// (after one). ONE VOICE: `cards` must never exceed 1.
const CARD_SLOT = `(() => {
  const el = document.querySelector('.refit-finline');
  return {
    cards: document.querySelectorAll('.refit-finline').length,
    orders: !!(el && el.classList.contains('refit-orders')),
    title: el ? (el.querySelector('.fl-title') || {}).textContent : null,
    steps: el ? [...el.querySelectorAll('.fl-step')].map(b => ({ ord: b.dataset.ord || null, txt: b.textContent.trim() })) : [],
    canvasInvite: typeof Build.__test__.lineInvite,   // 'undefined' = the standalone invite is gone
  };
})()`;

/* THE WASH, IN PIXELS. Read the canvas itself at the field's OWN tiles — the same tiles twice,
   once with nothing armed and once with LINES armed from ORDERS. The wash is
   rgba(120,200,255,0.075) laid over a warm deck, so arming must lift blue at exactly those tiles.
   Sampling the same coordinates both times removes the deck, the light and the grid from the
   comparison: nothing here trusts a flag. */
const SAMPLE_FIELD = `(() => {
  const f = Build.__test__.lineField(), c = Build.__test__.camera();
  if (!f || !f.count) return { err: 'no field' };
  const cv = document.querySelector('.refit-canvas'), g = cv.getContext('2d');
  const px = (t) => Math.round(t * c.tile * c.zoom + c.panX), py = (t) => Math.round(t * c.tile * c.zoom + c.panY);
  const side = Math.max(2, Math.round(c.tile * c.zoom) - 6);
  let r = 0, gg = 0, b = 0, n = 0;
  for (const s of f.sample) {
    const x = px(s.tx) + 3, y = py(s.ty) + 3;
    if (x < 0 || y < 0 || x + side > cv.width || y + side > cv.height) continue;
    const d = g.getImageData(x, y, side, side).data;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  }
  const xs = f.sample.map(s => s.tx), ys = f.sample.map(s => s.ty);
  return { bp: f.bp, count: f.count, tiles: f.sample.length, px: n,
    r: n ? +(r / n).toFixed(2) : null, g: n ? +(gg / n).toFixed(2) : null, b: n ? +(b / n).toFixed(2) : null,
    rect: { x: px(Math.min(...xs)), y: py(Math.min(...ys)), w: px(Math.max(...xs) + 1) - px(Math.min(...xs)), h: py(Math.max(...ys) + 1) - py(Math.min(...ys)) } };
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'inviteretire-'));
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
    await sleep(1400);

    // ---- 1. BARE FLOOR: ORDERS speaks, the canvas does not ----
    proof.bare = await J(cdp, CARD_SLOT);
    proof.deckBefore = await J(cdp, SAMPLE_FIELD);
    shots.push(await capture(cdp, OUT, '01-bare-floor-orders-no-invite'));
    if (proof.bare.canvasInvite !== 'undefined') throw new Error('the retired canvas invitation is still wired: ' + proof.bare.canvasInvite);
    if (!proof.bare.orders) throw new Error('STATION ORDERS is not in the card slot: ' + JSON.stringify(proof.bare));
    if (proof.bare.cards !== 1) throw new Error('one voice: ' + proof.bare.cards + ' guidance cards on a bare floor');
    if (!proof.bare.steps.some(s => s.ord === 'line')) throw new Error('ORDERS is not offering (4) STAMP A WORK LINE');

    // ---- 2. ITS (4) ARMS LINES, AND THE WASH PAINTS ON THOSE TILES ----
    proof.click = await J(cdp, `(() => {
      const before = Build.__test__.tool();
      document.querySelector('.refit-finline [data-ord="line"]').click();
      return { before, after: Build.__test__.tool() };
    })()`);
    if (proof.click.after !== 'line') throw new Error('ORDERS (4) did not arm LINES: ' + JSON.stringify(proof.click));
    await sleep(1000);
    proof.deckAfter = await J(cdp, SAMPLE_FIELD);
    proof.blueLift = +(proof.deckAfter.b - proof.deckBefore.b).toFixed(2);
    proof.redLift = +(proof.deckAfter.r - proof.deckBefore.r).toFixed(2);
    if (!proof.deckAfter.count) throw new Error('arming from ORDERS yielded no candidate field: ' + JSON.stringify(proof.deckAfter));
    if (!(proof.blueLift > 1.5 && proof.blueLift > proof.redLift))
      throw new Error('the candidate wash is not on the deck: ' + JSON.stringify({ before: proof.deckBefore, after: proof.deckAfter, blueLift: proof.blueLift, redLift: proof.redLift }));
    shots.push(await capture(cdp, OUT, '02-orders-arms-lines-wash'));

    // ---- 3. ONE VOICE, COMBINED: stamp a line, the slot hands off, the wash + ghost still help ----
    const spot = await J(cdp, `(() => { const f = Build.__test__.lineField(); return f && f.count ? f.sample[0] : null; })()`);
    if (!spot) throw new Error('no legal anchor to stamp');
    await evalJS(cdp, `(() => {
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([${spot.tx}, ${spot.ty}], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      return 1;
    })()`);
    await sleep(1600);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await sleep(700);
    // re-arm LINES on a second blueprint and hover a candidate: wash + ghost + the handed-off card
    await evalJS(cdp, `(() => {
      if (Build.__test__.tool() !== 'line') document.querySelector('.refit-tool[data-tool="line"]').click();
      const c = document.querySelector('.refit-linetile[data-line="sorting_office"]');
      if (c) c.click(); return 1;
    })()`);
    await sleep(800);
    const s2 = await J(cdp, `(() => { const f = Build.__test__.lineField('sorting_office'); return f && f.count ? f.sample[0] : null; })()`);
    if (s2) {
      await evalJS(cdp, `(() => {
        const cv = document.querySelector('.refit-canvas');
        const ev = Build.__test__._tileEvent([${s2.tx}, ${s2.ty}], 0);
        cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
        return 1;
      })()`);
    }
    await sleep(900);
    proof.combined = await J(cdp, `({ slot: ${CARD_SLOT}, field: Build.__test__.lineField('sorting_office'),
      degraded: Build.__test__.degradedLayers(), props: Build.__test__.station().props().length })`);
    if (proof.combined.slot.cards !== 1) throw new Error('one voice: ' + proof.combined.slot.cards + ' guidance cards at once');
    if (proof.combined.slot.orders) throw new Error('STATION ORDERS never handed off after a line was stamped');
    if (proof.combined.degraded.length) throw new Error('a draw layer failed: ' + JSON.stringify(proof.combined.degraded));
    shots.push(await capture(cdp, OUT, '03-one-voice-combined'));

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
