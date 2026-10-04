#!/usr/bin/env node
/* dev/guided-line-b-shots.mjs — live proof shots for guided workflows Phase 3
 * (the GHOST PROJECTION: a dashed projected crate loops an incomplete line).
 * Adapted from dev/guided-line-a-shots.mjs (seeded-sidecar + CDP pattern).
 *
 * Captures:
 *   1. ghost-mid-ride.png          — the dashed projection crate riding the stamped (uncrewed)
 *                                    RESEARCH LINE's belts in REFIT
 *   2. ghost-would-caption.png     — a WOULD-language caption on screen as the ghost passes
 *   3. ghost-stops-real-crates.png — ▸ TEST fired: real crates own the belt, the ghost is GONE
 *   4. ghost-stopped-complete.png  — docks crewed + a routine feeds the line: no projection
 *
 *   node dev/guided-line-b-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-guided-b');

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

const GHOST = `JSON.stringify(Build.__test__.ghost())`;

async function pollGhost(cdp, pred, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const raw = await evalJS(cdp, GHOST);
    let g = null; try { g = JSON.parse(raw); } catch {}
    if (g && pred(g)) return g;
    await sleep(120);
  }
  throw new Error('ghost poll timed out: ' + label);
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'guidedb-'));
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
    await evalJS(cdp, CLEAR_FLOOR);
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(400);

    // ---- stamp a RESEARCH LINE through the REAL pointer path (unbound docks = incomplete) ----
    const spot = await evalJS(cdp, findSpot('research_line'));
    if (!spot) throw new Error('no stampable spot for research_line');
    const stamped = await evalJS(cdp, `(() => {
      const bp = WorldModel.BLUEPRINTS.find(b => b.id === 'research_line');
      const st = Build.__test__.station();
      const before = st.props().length;
      const cx = ${spot.tx} + (bp.w >> 1), cy = ${spot.ty} + (bp.h >> 1);
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([cx, cy], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, button: 0, bubbles: true }));
      const bays = st.props().filter(p => p.t === 'bay').map(p => ({ id: p.id, role: p.role, agentId: p.agentId || null }));
      return { before, after: st.props().length, bays };
    })()`);
    console.log('STAMP:', JSON.stringify(stamped));
    if (!stamped || stamped.after !== stamped.before + 4) throw new Error('research_line did not stamp');

    // the stamp fires the tutorial's belt coach — the GHOST correctly STANDS DOWN while it's up.
    // Log that gate, then dismiss the coach like a user would and park the cursor off the deck.
    const gate = await evalJS(cdp, `JSON.stringify({ coaching: (typeof Tutorial !== 'undefined' && Tutorial.isCoaching) ? Tutorial.isCoaching() : null, ghost: (Build.__test__.ghost() || {}).projecting })`);
    console.log('COACH GATE (ghost stands down):', gate);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await evalJS(cdp, `(() => { const cv = document.querySelector('.refit-canvas'); cv.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 900, pointerId: 1, bubbles: true })); })()`);

    // ---- (1) the ghost mid-ride on the incomplete line ----
    const mid = await pollGhost(cdp, g => g.projecting && g.boxes.length && g.boxes.some(b => b.sink <= 0 && b.prog > 0.15 && b.prog < 0.85), 15000, 'mid-ride');
    console.log('MID-RIDE:', JSON.stringify({ projecting: mid.projecting, lineKey: mid.lineKey, pass: mid.pass, boxes: mid.boxes }));
    shots.push(await capture(cdp, OUT, 'ghost-mid-ride'));

    // ---- (2) a WOULD-caption on screen (fresh note riding with the ghost) ----
    const cap = await pollGhost(cdp, g => g.projecting && g.notes.length > 0, 15000, 'would-caption');
    console.log('CAPTIONS:', JSON.stringify(cap.notes));
    if (!cap.notes.every(n => n.text.includes('WOULD'))) throw new Error('a caption is missing WOULD-language: ' + JSON.stringify(cap.notes));
    shots.push(await capture(cdp, OUT, 'ghost-would-caption'));
    const dockCap = await pollGhost(cdp, g => g.log.some(e => e.kind === 'dock'), 20000, 'dock caption logged');
    console.log('LOG (route truth, uncrewed docks consume):', JSON.stringify(dockCap.log));

    // ---- (3) real crates own the belt: fire ▸ TEST, the ghost clears the same tick ----
    const beforeTest = await evalJS(cdp, GHOST);
    await evalJS(cdp, `document.querySelector('#refit-test').click()`);
    await sleep(350);
    const afterTest = await pollGhost(cdp, g => !g.projecting && g.boxes.length === 0, 5000, 'ghost cleared for real crates');
    console.log('REAL-CRATE STOP: before=', JSON.parse(beforeTest).boxes.length, 'boxes → after=', JSON.stringify({ projecting: afterTest.projecting, boxes: afterTest.boxes.length }));
    shots.push(await capture(cdp, OUT, 'ghost-stops-real-crates'));

    // wait for the test ride to drain, then confirm the ghost RESUMES (line still incomplete)
    const resumed = await pollGhost(cdp, g => g.projecting && g.boxes.length > 0, 25000, 'ghost resumed after test ride');
    console.log('RESUMED after test ride: pass=', resumed.pass);

    // ---- (4) complete the line: summon-crew BOTH docks, then feed it with a real routine ----
    for (const b of stamped.bays) {
      await evalJS(cdp, `Build.openAssign(${JSON.stringify(b.id)})`);
      await sleep(500);
      const s = await evalJS(cdp, `(() => { const btn = document.querySelector('#bay-summon'); if (!btn) return 'no-summon'; btn.click(); return 'clicked'; })()`);
      if (s !== 'clicked') throw new Error('summon button missing for ' + b.id);
      await sleep(1800);
      const bound = await evalJS(cdp, `JSON.stringify((() => { const p = Build.__test__.station().propById(${JSON.stringify(b.id)}); return { id: p.id, role: p.role, agentId: p.agentId || null }; })())`);
      console.log('CREWED:', bound);
      // dismiss any picker/firstrun overlays before the next step
      await evalJS(cdp, `(() => { const g = document.querySelector('.refit-bay-picker'); if (g && g.parentNode) g.parentNode.removeChild(g); return true; })()`);
    }
    // crewed docks alone leave the feed step open — the ghost may STILL ride (honest). Now feed it:
    // a REAL routine through the REAL API (POST /api/cron + arm), then force the feed-truth poll.
    const agentId = await evalJS(cdp, `Build.__test__.station().props().find(p => p.t === 'bay' && p.agentId).agentId`);
    const fed = await evalJS(cdp, `(async () => {
      const mk = await fetch('/api/cron', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ghost-proof-brief', prompt: 'summarize the day', schedule: '0 9 * * *', agentId: ${JSON.stringify('%AID%')}, enabled: true }) }).then(r => r.json()).catch(e => ({ error: String(e) }));
      const arm = await fetch('/api/cron/arm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) }).then(r => r.json()).catch(e => ({ error: String(e) }));
      return JSON.stringify({ mk, arm });
    })()`.replace('"%AID%"', JSON.stringify(agentId)));
    console.log('FEED (routine + arm):', fed);
    // force the world's feed poll (REFIT reads World.feedState — the same truth the NO FEED nag keys on)
    await evalJS(cdp, `(typeof World !== 'undefined' && World._dbgBeltLegibility) ? (World._dbgBeltLegibility().pollFeed(), 'polled') : 'no-world'`);
    await sleep(1500);
    const feedNow = await evalJS(cdp, `JSON.stringify((typeof World !== 'undefined' && World.feedState) ? World.feedState() : null)`);
    console.log('FEED STATE:', feedNow);
    const stopped = await pollGhost(cdp, g => !g.projecting && g.boxes.length === 0 && g.candidates.every(c => c.crewLeft === 0), 20000, 'ghost stopped on the complete line');
    console.log('COMPLETE-LINE STOP:', JSON.stringify({ projecting: stopped.projecting, boxes: stopped.boxes.length, candidates: stopped.candidates, feed: JSON.parse(feedNow) }));
    await sleep(600);
    shots.push(await capture(cdp, OUT, 'ghost-stopped-complete'));

    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
