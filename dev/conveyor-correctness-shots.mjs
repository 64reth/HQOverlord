#!/usr/bin/env node
/* dev/conveyor-correctness-shots.mjs — LIVE proof for the conveyor CORRECTNESS lane.
 * Seeded sidecar + CDP, adapted from dev/step-editor-shots.mjs. Port 9498 — NEVER 9496 (live demo).
 *
 * Each capture is a claim the audit says was BROKEN, driven through the real app:
 *   1. esc-brief-kept.png        — ESC over a STEP card with an unsaved job brief SAVES it, and does NOT
 *                                  mark the build-mode guide seen (it used to do exactly the opposite).
 *   2. modal-owns-keyboard.png   — with the card up, `9` does not arm LINES and Ctrl+Z does not undo.
 *   3. opener-replaces.png       — opening a second dock's card while one is up REPLACES it (the world's
 *                                  NO AGENT nag / FINISH ① CREW used to no-op silently).
 *   4. prop-card-rehover.png     — close REFIT, reopen, hover the SAME prop: a POPULATED card (it painted
 *                                  empty, because propCardKey survived close()).
 *   5. fresh-station-orders.png  — a station with a different id shows ORDERS again: the latch is really
 *                                  per-station now, and it survives a reload.
 * Plus wire proofs printed to stdout: the station id is a real stamp (not 0), the per-station localStorage
 * keys, ORPHAN_JUNCTION reaching the live world's nag table, and a routine created FOR THIS LINE coming
 * back from GET /api/cron with runsLine true.
 *
 *   node dev/conveyor-correctness-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9497);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-conveyor-correctness');

const BRIEF = 'Dig three primary sources and hand the writer an evidence pack.';
const fails = [];
const claim = (ok, what) => { console.log((ok ? '  PASS  ' : '  FAIL  ') + what); if (!ok) fails.push(what); };

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

// set a field through the native setter + a real input event, WITHOUT blurring: a dirty, unsaved field
const typeNoBlur = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'no-el';
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
})()`;

// ESC as the WINDOW sees it (focus outside the field — the exact path that used to bypass closeP)
const PRESS = k => `(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }));
  return 'sent';
})()`;
const PRESS_CTRL = k => `(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, ctrlKey: true, bubbles: true }));
  return 'sent';
})()`;

const hoverProp = (propId) => `(() => {
  const st = Build.__test__.station();
  const p = st.propById(${JSON.stringify(propId)});
  if (!p) return 'no-prop';
  const cv = document.querySelector('.refit-canvas');
  const ev = Build.__test__._tileEvent([p.x, p.y], 0);
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
  return 'moved';
})()`;

const PROP_CARD = `JSON.stringify((() => {
  const c = document.querySelector('.refit-propcard') || document.querySelector('#refit-propcard');
  if (!c) return { found: false };
  return { found: true, shown: c.style.display === 'block', len: (c.textContent || '').trim().length,
           head: (c.textContent || '').trim().slice(0, 60) };
})())`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'convcorr-'));
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

    // pin default text size (the known zoom trap) + reload
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

    /* ---------- #2 the station has a DURABLE id, and the latches hang off it ---------- */
    const ident = await evalJS(cdp, `JSON.stringify((() => {
      const d = World.stationDoc();
      return { createdAt: d && d.meta && d.meta.createdAt, saved: (JSON.parse(localStorage.getItem('starnet.save') || '{}').station || {}).meta };
    })())`);
    const id = JSON.parse(ident);
    console.log('STATION IDENTITY:', ident);
    claim(!!id.createdAt && id.createdAt > 0, 'the live station carries a real id (never the old constant 0)');
    claim(!!(id.saved && id.saved.createdAt === id.createdAt), 'and the SAVE on disk carries the same id (it survives a reload)');

    let opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(700);
    await evalJS(cdp, CLEAR_FLOOR);
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(400);

    const spot = await evalJS(cdp, findSpot('research_line'));
    if (!spot) throw new Error('no stampable spot for research_line');
    const stamped = await evalJS(cdp, `(() => {
      const bp = WorldModel.BLUEPRINTS.find(b => b.id === 'research_line');
      const st = Build.__test__.station();
      const cx = ${spot.tx} + (bp.w >> 1), cy = ${spot.ty} + (bp.h >> 1);
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([cx, cy], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      const props = st.props();
      return { bays: props.filter(p => p.t === 'bay').map(p => ({ id: p.id, role: p.role })),
               intake: (props.find(p => p.t === 'intake') || {}).id || null };
    })()`);
    console.log('STAMP:', JSON.stringify(stamped));
    await sleep(900);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await sleep(500);

    const bayId = stamped.bays.find(b => b.role === 'RESEARCHER').id;
    const writerId = stamped.bays.find(b => b.role === 'WRITER').id;

    /* ---------- #3 ESC over a STEP card: the brief is SAVED, the guide is NOT marked seen ---------- */
    await evalJS(cdp, `(() => { try { localStorage.removeItem('starnet.refit.seen'); } catch (e) {} return 'cleared'; })()`);
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(bayId)})`);
    await sleep(500);
    await evalJS(cdp, typeNoBlur('#step-brief', BRIEF));
    const beforeEsc = await evalJS(cdp, `JSON.stringify({
      cardUp: !!document.querySelector('.refit-step-card'),
      draft: (document.querySelector('#step-brief') || {}).value,
      savedOnProp: Build.__test__.station().propById(${JSON.stringify(bayId)}).brief || null,
      guideSeen: !!localStorage.getItem('starnet.refit.seen')
    })`);
    console.log('BEFORE ESC:', beforeEsc);
    const pre = JSON.parse(beforeEsc);
    claim(pre.cardUp && pre.draft === BRIEF && pre.savedOnProp === null, 'the step card holds an UNSAVED job brief');
    shots.push(await capture(cdp, OUT, 'esc-brief-before'));

    await evalJS(cdp, PRESS('Escape'));
    await sleep(500);
    const afterEsc = await evalJS(cdp, `JSON.stringify({
      cardUp: !!document.querySelector('.refit-step-card'),
      savedOnProp: Build.__test__.station().propById(${JSON.stringify(bayId)}).brief || null,
      guideSeen: !!localStorage.getItem('starnet.refit.seen'),
      refitStillOpen: Build.isOpen()
    })`);
    console.log('AFTER ESC:', afterEsc);
    const post = JSON.parse(afterEsc);
    claim(!post.cardUp, 'ESC closed the card');
    claim(post.savedOnProp === BRIEF, 'ESC SAVED the job brief through the card’s own close path (it used to discard it)');
    claim(post.guideSeen === false, 'ESC did NOT mark the build-mode guide seen (it used to, permanently)');
    claim(post.refitStillOpen === true, 'and ESC closed the CARD, not build mode');
    shots.push(await capture(cdp, OUT, 'esc-brief-kept'));

    /* ---------- #9 a mounted card owns the keyboard ---------- */
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(bayId)})`);
    await sleep(450);
    const camBefore = await evalJS(cdp, `JSON.stringify((() => { const c = Build.__test__.camera(); return { panX: Math.round(c.panX), panY: Math.round(c.panY) }; })())`);
    const propsBefore = await evalJS(cdp, `Build.__test__.station().props().length`);
    await evalJS(cdp, PRESS('9'));
    await evalJS(cdp, PRESS_CTRL('z'));
    await sleep(500);
    const keyProof = await evalJS(cdp, `JSON.stringify((() => {
      const armed = document.querySelector('.refit-tool.active');
      const c = Build.__test__.camera();
      return { tool: armed && armed.dataset.tool, cam: { panX: Math.round(c.panX), panY: Math.round(c.panY) },
               props: Build.__test__.station().props().length, cardUp: !!document.querySelector('.refit-step-card') };
    })())`);
    console.log('AFTER 9 + CTRL-Z WITH CARD OPEN:', keyProof, '| camera before:', camBefore);
    const kp = JSON.parse(keyProof);
    claim(kp.tool !== 'line', '`9` did NOT arm LINES while the card was open');
    claim(JSON.stringify(kp.cam) === camBefore, '…and the camera did not move under the card');
    claim(kp.props === propsBefore, 'Ctrl+Z did NOT undo the stamp that made the bay being edited');
    claim(kp.cardUp, 'and the card is still up');
    shots.push(await capture(cdp, OUT, 'modal-owns-keyboard'));

    /* ---------- #8 an opener REPLACES the open card ---------- */
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(writerId)})`);
    await sleep(500);
    const swap = await evalJS(cdp, `JSON.stringify((() => {
      const cards = document.querySelectorAll('.refit-guide');
      const g = document.querySelector('.refit-step-card');
      return { cardCount: cards.length, title: g && g.querySelector('h3').textContent.trim() };
    })())`);
    console.log('AFTER OPENING A SECOND DOCK:', swap);
    const sw = JSON.parse(swap);
    claim(sw.cardCount === 1, 'exactly ONE card is mounted — the second opener replaced the first');
    claim(/WRITER/.test(sw.title || ''), '…and it is the SECOND dock’s card (the opener no longer no-ops)');
    shots.push(await capture(cdp, OUT, 'opener-replaces'));
    await evalJS(cdp, PRESS('Escape'));
    await sleep(300);

    /* ---------- #7 re-hover the same prop after reopening REFIT paints a POPULATED card ---------- */
    await evalJS(cdp, hoverProp(bayId));
    await sleep(600);
    const card1 = await evalJS(cdp, PROP_CARD);
    console.log('HOVER CARD (session 1):', card1);
    const c1 = JSON.parse(card1);
    claim(c1.found && c1.shown && c1.len > 10, 'hovering the dock paints a populated card in session 1');
    // leave REFIT and come back — this is what used to leave propCardKey latched
    await evalJS(cdp, `Build.close()`);
    await sleep(900);
    await evalJS(cdp, OPEN_REFIT);
    await sleep(900);
    await evalJS(cdp, hoverProp(bayId));
    await sleep(700);
    const card2 = await evalJS(cdp, PROP_CARD);
    console.log('HOVER CARD (session 2, same prop):', card2);
    const c2 = JSON.parse(card2);
    claim(c2.found && c2.shown && c2.len > 10, 'RE-hovering the SAME prop after reopening REFIT paints a POPULATED card (it used to be empty)');
    claim(c2.len === c1.len, '…with the same content it had the first time');
    shots.push(await capture(cdp, OUT, 'prop-card-rehover'));

    /* ---------- #11 ORPHAN_JUNCTION reaches the LIVE world's nag table ---------- */
    const nag = await evalJS(cdp, `JSON.stringify((() => {
      const src = document.querySelector('script[src*="world.js"]');
      return { inWorld: typeof World !== 'undefined' };
    })())`);
    const junctionNag = await evalJS(cdp, `JSON.stringify((() => {
      // place a FILTER off the belt: the compiler answers ORPHAN_JUNCTION, and the LIVE world must say so
      const st = Build.__test__.station();
      // a real in-room floor tile with NO belt on or beside it: that is a junction on no line
      const near = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (st.beltAt(x + dx, y + dy)) return true; return false; };
      const b = st.bounds();
      for (let ty = b.minTy; ty <= b.maxTy; ty++) for (let tx = b.minTx; tx <= b.maxTx; tx++) {
        if (!st.roomAt(tx, ty) || st.propAt(tx, ty) || st.beltAt(tx, ty) || near(tx, ty)) continue;
        const r = st.addProp({ t: 'filter', x: tx, y: ty, w: 1, h: 1, block: false });
        if (r && r.ok) return { added: true, id: r.id, at: [tx, ty] };
      }
      return { added: false };
    })())`);
    console.log('ORPHAN FILTER PLACED:', junctionNag);
    await sleep(900);
    const codes = await evalJS(cdp, `JSON.stringify((() => {
      const plan = Pipeline.compileRoutingPlan(Build.__test__.station().projectGeometry());
      return { codes: [...new Set(plan.errors.map(e => e.code))] };
    })())`);
    console.log('COMPILED CODES:', codes);
    claim(/ORPHAN_JUNCTION/.test(codes), 'the compiler really answers ORPHAN_JUNCTION for a belt-less junction');
    await evalJS(cdp, `Build.close()`);
    await sleep(1200);
    // the LIVE WORLD's own callout list — buildRoutingNags drops any code missing from NAG_LABEL, so THIS
    // is the assertion that the finding survives the projection, not merely that the compiler emits it.
    const worldNag = await evalJS(cdp, `JSON.stringify((() => {
      const d = World._dbgBeltLegibility ? World._dbgBeltLegibility() : null;
      return { nags: d && d.nags };
    })())`);
    console.log('LIVE WORLD NAGS:', worldNag);
    claim(/NOT ON A BELT/.test(String(worldNag)),
      'the LIVE WORLD paints the ORPHAN_JUNCTION callout (it used to drop the finding silently)');

    /* ---------- runsLine: a routine created FOR THIS LINE is that line's own trigger ---------- */
    const cronProof = await evalJS(cdp, `(async () => {
      const r = await fetch('/api/cron', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'LINE PROBE', prompt: 'probe', schedule: 'every 30m', agentId: 'agent', runsLine: true }) });
      const created = await r.json();
      const list = await (await fetch('/api/cron')).json();
      const mine = (list.jobs || []).find(j => j.name === 'LINE PROBE');
      return JSON.stringify({ created: !!(created && !created.error), runsLine: mine && mine.runsLine, err: created && created.error });
    })()`);
    console.log('CRON runsLine ROUND-TRIP:', cronProof);
    claim(/"runsLine":true/.test(String(cronProof)), 'a routine created with runsLine:true round-trips through GET /api/cron as runsLine true');

    /* ---------- #2b a station with a DIFFERENT id sees ORDERS again (per-station latch, survives reload) ---------- */
    await evalJS(cdp, OPEN_REFIT);
    await sleep(800);
    const keysNow = await evalJS(cdp, `JSON.stringify(Object.keys(localStorage).filter(k => /starnet\\.refit\\.(orders|firstride|finline)/.test(k)))`);
    console.log('PER-STATION LATCH KEYS:', keysNow);
    /* THE LAW: every REFIT latch key carries a station-id suffix. The bare family names
       ('starnet.refit.orders.dis', '…firstride', '…finline') are what shipped, and a key that ENDS at the
       family name is the bug — whichever station writes it, every other station then inherits it. */
    const latchKeys = JSON.parse(keysNow);
    const bare = latchKeys.filter(k => /^starnet\.refit\.(orders\.dis|firstride|finline)$/.test(k));
    claim(bare.length === 0, 'no REFIT latch is stored under a bare GLOBAL key (' + JSON.stringify(latchKeys) + ')');
    claim(latchKeys.every(k => /\.\d+$/.test(k)), 'every latch key that exists is suffixed with a station id');
    // dismiss ORDERS on this station, then give the SAVE a different station id and reload = a new station
    await evalJS(cdp, `(() => { try { localStorage.setItem('starnet.refit.orders.dis.' + ${JSON.stringify(String(id.createdAt))}, '1'); } catch (e) {} return 'dismissed'; })()`);
    await evalJS(cdp, `Build.close()`);
    await sleep(600);
    const NEWID = id.createdAt + 999999;
    await evalJS(cdp, `(() => {
      const KEY = 'starnet.save';
      const r = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (!r.station || !r.station.meta) return 'no-station-in-save';
      r.station.meta.createdAt = ${NEWID};
      localStorage.setItem(KEY, JSON.stringify(r));
      location.reload();
      return 'reloading';
    })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after the new-station reload');
    await sleep(1600);
    const fresh = await evalJS(cdp, `JSON.stringify((() => {
      const d = World.stationDoc();
      return { id: d && d.meta && d.meta.createdAt,
               oldDismissal: !!localStorage.getItem('starnet.refit.orders.dis.' + ${JSON.stringify(String(id.createdAt))}),
               newDismissal: !!localStorage.getItem('starnet.refit.orders.dis.' + ${NEWID}) };
    })())`);
    console.log('AFTER SWITCHING TO A NEW STATION ID:', fresh);
    const fr = JSON.parse(fresh);
    claim(fr.id === NEWID, 'the app is now on a station with a different durable id');
    claim(fr.oldDismissal === true, '…the FIRST station’s dismissal is still on disk (nothing was destroyed)');
    claim(fr.newDismissal === false, '…and the NEW station has no dismissal of its own — it is NOT inherited');
    await evalJS(cdp, OPEN_REFIT);
    await sleep(1400);
    const ordersUp = await evalJS(cdp, `JSON.stringify((() => {
      const el = document.querySelector('.refit-orders') || document.querySelector('.refit-finline');
      return { present: !!el, cls: el && el.className, txt: el && el.textContent.trim().slice(0, 90) };
    })())`);
    console.log('ORDERS ON THE NEW STATION:', ordersUp);
    claim(/"present":true/.test(ordersUp), 'the NEW station is shown its own ORDERS card again (the latch really is per-station)');
    shots.push(await capture(cdp, OUT, 'fresh-station-orders'));

    console.log('\nSHOTS:');
    for (const s of shots) console.log('  ' + (s && s.path ? s.path + '  (' + s.kb + ' kB)' : s));
    const errs = diag && diag.errors ? diag.errors : [];
    console.log('\nCONSOLE ERRORS: ' + errs.length);
    for (const e of errs.slice(0, 10)) console.log('  ! ' + e);
    console.log('\n' + (fails.length ? 'FAILED CLAIMS: ' + fails.length : 'ALL CLAIMS PASSED'));
    for (const f of fails) console.log('  FAIL ' + f);
    process.exitCode = fails.length ? 1 : 0;
  } finally {
    try { if (cdp) await cdp.close(); } catch (_) {}
    try { if (chrome) chrome.kill(); } catch (_) {}
    try { if (side) side.kill(); } catch (_) {}
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
