#!/usr/bin/env node
/* dev/guided-line-a-shots.mjs — live proof shots for guided workflows Phase 1+2
 * (roles on docks · ⊕ SUMMON leading the bay picker · the FINISH-THE-LINE card).
 * Adapted from dev/lines-shelf-v2-shots.mjs (seeded-sidecar + CDP pattern).
 *
 * Captures:
 *   1. stamped-role-placards.png — a freshly stamped RESEARCH LINE: unbound docks calling
 *                                  "RESEARCHER — … — CLICK" / "WRITER — … — CLICK"
 *   2. finish-line-card.png      — the checklist card beside the line (crew 2 · feed · sample off)
 *   3. picker-summon-leading.png — the bay picker with "⊕ SUMMON A RESEARCHER HERE" leading
 *   4. after-summon.png          — dock bound to the summoned agent; card decremented to 1 TO GO
 *
 *   node dev/guided-line-a-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-guided-a');

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
  const scratch = mkdtempSync(join(tmpdir(), 'guideda-'));
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

    // ---- (a) stamp a RESEARCH LINE through the REAL pointer path ----
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
    await sleep(900);
    // the stamp fires the tutorial's belt coach — the card correctly STANDS DOWN while it's up
    // (Tutorial.isCoaching gate). Dismiss it like a user would, and park the cursor off the deck
    // so the armed LINES ghost doesn't overprint the placards in the shot.
    const coachGate = await evalJS(cdp, `JSON.stringify({ coaching: (typeof Tutorial !== 'undefined' && Tutorial.isCoaching) ? Tutorial.isCoaching() : null, cardHidden: (Build.__test__.finCard() || {}).display === false })`);
    console.log('COACH GATE (stand-down law):', coachGate);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await evalJS(cdp, `(() => { const cv = document.querySelector('.refit-canvas'); cv.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 900, pointerId: 1, bubbles: true })); })()`);
    await sleep(700);
    shots.push(await capture(cdp, OUT, 'stamped-role-placards'));

    // ---- (b/c) the finish-the-line card state (crew 2 · feed truth · sample feature-detect) ----
    const cardState = await evalJS(cdp, `JSON.stringify({ card: Build.__test__.finCard(), feed: (typeof World !== 'undefined' && World.feedState) ? World.feedState() : null })`);
    console.log('FIN CARD:', cardState);
    shots.push(await capture(cdp, OUT, 'finish-line-card'));

    // ---- (b) the augmented picker: ⊕ SUMMON A RESEARCHER HERE leads ----
    const bayId = stamped.bays.find(b => b.role === 'RESEARCHER').id;
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(bayId)})`);
    await sleep(500);
    const pickerProof = await evalJS(cdp, `JSON.stringify((() => {
      const g = document.querySelector('.refit-bay-picker');
      if (!g) return null;
      const sum = g.querySelector('#bay-summon');
      const secs = [...g.querySelectorAll('.refit-sec')].map(s => s.textContent.trim());
      const form = g.querySelector('.refit-form');
      return { summonText: sum ? sum.textContent.trim() : null,
               summonLeads: !!sum && form.querySelector('button') === sum ? true : (!!sum && [...form.querySelectorAll('button')].indexOf(sum) === 0),
               sections: secs };
    })())`);
    console.log('PICKER:', pickerProof);
    shots.push(await capture(cdp, OUT, 'picker-summon-leading'));

    // ---- (d) one-click summon: real agent minted + bound, card decrements ----
    const summoned = await evalJS(cdp, `(() => {
      const before = (typeof App !== 'undefined' && App.crewCount) ? App.crewCount() : -1;
      const btn = document.querySelector('#bay-summon');
      if (!btn) return { err: 'no summon button' };
      btn.click();
      return { before };
    })()`);
    await sleep(1800);
    const bound = await evalJS(cdp, `JSON.stringify((() => {
      const st = Build.__test__.station();
      const p = st.propById(${JSON.stringify(bayId)});
      const roster = (typeof App !== 'undefined' && App.agents) ? App.agents() : [];
      const a = roster.find(x => x.id === p.agentId) || null;
      return { bayAgentId: p.agentId || null, role: p.role, crewBefore: ${JSON.stringify(0)} || null,
               crewCount: (typeof App !== 'undefined' && App.crewCount) ? App.crewCount() : -1,
               agent: a && { id: a.id, name: a.name, model: a.model },
               card: Build.__test__.finCard(), pickerOpen: !!document.querySelector('.refit-bay-picker') };
    })())`);
    console.log('SUMMON BEFORE:', JSON.stringify(summoned));
    console.log('AFTER SUMMON:', bound);
    await sleep(400);
    shots.push(await capture(cdp, OUT, 'after-summon'));

    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
