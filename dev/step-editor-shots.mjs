#!/usr/bin/env node
/* dev/step-editor-shots.mjs — live proof shots for the STEP EDITOR lane
 * (the per-dock STEP CARD · persisted job briefs · line naming · one-voice combined scene).
 * Adapted from dev/guided-line-a-shots.mjs (seeded-sidecar + CDP pattern).
 *
 * Captures (dev/.shots-step-editor/):
 *   1. step-card-open.png          — the card on a RESEARCHER dock: THE STEP · THE AGENT · THE WORK
 *   2. combined-scene.png          — the card open WHILE the ghost projection rides (one-voice proof)
 *   3. step-card-crewed-brief.png  — summoned in place: crewed + the brief draft intact (one surface)
 *   4. brief-persist-after-reload.png — full page reload; the reopened card still carries the brief
 *   5. line-name-edit.png          — the INBOX card naming the line; finish-the-line header renamed
 *   6. intake-glance-line-name.png — hover the named INBOX: 'LINE · <name>' through the arbiter
 * Plus a LIVE wire proof: after crewing both docks the browser's posted plan serves
 * /api/routing/chain { next, brief } — the downstream dock's brief over the real seam.
 *
 *   node dev/step-editor-shots.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9498';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9499);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-step-editor');

const BRIEF = 'Dig three primary sources and hand the writer a bulleted evidence pack.';
const WRITER_BRIEF = 'Draft the final answer in press style.';
const LINE_NAME = 'PRESS DESK';

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

// set a field's value through the native setter + real input/blur events (the save path is blur)
const typeInto = (sel, val, blur) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'no-el';
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  ${blur ? `el.focus(); el.dispatchEvent(new FocusEvent('blur'));` : ''}
  return 'ok';
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'stepedit-'));
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
    let opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not open: ' + opened);
    await sleep(600);
    await evalJS(cdp, CLEAR_FLOOR);
    await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
    await sleep(400);

    // ---- stamp a RESEARCH LINE through the REAL pointer path ----
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
      const props = st.props();
      return { before, after: props.length,
        bays: props.filter(p => p.t === 'bay').map(p => ({ id: p.id, role: p.role, agentId: p.agentId || null })),
        intake: (props.find(p => p.t === 'intake') || {}).id || null };
    })()`);
    console.log('STAMP:', JSON.stringify(stamped));
    if (!stamped || stamped.after !== stamped.before + 4) throw new Error('research_line did not stamp');
    await sleep(900);
    await evalJS(cdp, `(() => { const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click(); return !!ok; })()`);
    await evalJS(cdp, `(() => { const cv = document.querySelector('.refit-canvas'); cv.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 900, pointerId: 1, bubbles: true })); })()`);
    await sleep(700);

    // ---- 1. THE STEP CARD on the RESEARCHER dock: three zones, summon leading, brief placeholder ----
    const bayId = stamped.bays.find(b => b.role === 'RESEARCHER').id;
    const writerBayId = stamped.bays.find(b => b.role === 'WRITER').id;
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(bayId)})`);
    await sleep(500);
    const cardProof = await evalJS(cdp, `JSON.stringify((() => {
      const g = document.querySelector('.refit-step-card');
      if (!g) return null;
      return {
        title: g.querySelector('h3').textContent.trim(),
        sections: [...g.querySelectorAll('.refit-sec')].map(s => s.textContent.trim()),
        facts: [...g.querySelectorAll('.step-fact')].map(s => s.textContent.trim()),
        summon: (g.querySelector('#bay-summon') || {}).textContent || null,
        briefPlaceholder: g.querySelector('#step-brief').placeholder,
        bound: g.querySelector('#step-bound').textContent.trim()
      };
    })())`);
    console.log('STEP CARD:', cardProof);
    if (!cardProof || cardProof === 'null') throw new Error('the step card did not open');
    shots.push(await capture(cdp, OUT, 'step-card-open'));

    // ---- 2. COMBINED SCENE (one-voice law): the ghost projection rides while the card is open ----
    await sleep(2200);   // let the projected crate loop the incomplete line
    const ghost = await evalJS(cdp, `JSON.stringify((() => { const gh = Build.__test__.ghost(); return gh && { boxes: (gh.boxes || []).length, blocked: gh.blocked }; })())`);
    console.log('GHOST WHILE CARD OPEN:', ghost);
    shots.push(await capture(cdp, OUT, 'combined-scene'));

    // ---- 3. write the brief (real blur save) + summon IN PLACE (draft survives crewing) ----
    const typed = await evalJS(cdp, typeInto('#step-brief', BRIEF, true));
    if (typed !== 'ok') throw new Error('brief field not typed: ' + typed);
    await sleep(300);
    const savedBrief = await evalJS(cdp, `(Build.__test__.station().propById(${JSON.stringify(bayId)}).brief || null)`);
    console.log('BRIEF SAVED ON PROP:', JSON.stringify(savedBrief));
    if (savedBrief !== BRIEF) throw new Error('brief did not save on blur');
    await evalJS(cdp, `document.querySelector('#bay-summon').click()`);
    await sleep(1800);
    const afterSummon = await evalJS(cdp, `JSON.stringify((() => {
      const st = Build.__test__.station();
      const p = st.propById(${JSON.stringify(bayId)});
      const g = document.querySelector('.refit-step-card');
      return { agentId: p.agentId || null, brief: p.brief || null,
        cardStillOpen: !!g, bound: g && g.querySelector('#step-bound').textContent.trim(),
        briefDraftIntact: g && g.querySelector('#step-brief').value === ${JSON.stringify(BRIEF)} };
    })())`);
    console.log('AFTER SUMMON (in place):', afterSummon);
    shots.push(await capture(cdp, OUT, 'step-card-crewed-brief'));
    await evalJS(cdp, `document.querySelector('#step-done').click()`);
    await sleep(300);

    // crew + brief the WRITER dock too (for the live chain-seam wire proof below)
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(writerBayId)})`);
    await sleep(400);
    await evalJS(cdp, typeInto('#step-brief', WRITER_BRIEF, true));
    await sleep(200);
    await evalJS(cdp, `document.querySelector('#bay-summon').click()`);
    await sleep(1800);
    await evalJS(cdp, `document.querySelector('#step-done').click()`);
    await sleep(300);

    // ---- 5. LINE NAME on the INBOX card + the finish-the-line header renames ----
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(stamped.intake)})`);
    await sleep(400);
    const nameCard = await evalJS(cdp, `JSON.stringify((() => {
      const g = document.querySelector('.refit-flow-card');
      const inp = g && g.querySelector('#line-name');
      return g ? { hasField: !!inp, placeholder: inp && inp.placeholder } : null;
    })())`);
    console.log('INTAKE CARD:', nameCard);
    await evalJS(cdp, typeInto('#line-name', LINE_NAME, true));
    await sleep(300);
    const named = await evalJS(cdp, `JSON.stringify((() => {
      const st = Build.__test__.station();
      const label = st.propById(${JSON.stringify(stamped.intake)}).label || null;
      const fl = document.querySelector('.refit-finline .fl-title');
      return { label, finTitle: fl ? fl.textContent.trim() : null };
    })())`);
    console.log('LINE NAMED:', named);
    shots.push(await capture(cdp, OUT, 'line-name-edit'));
    await evalJS(cdp, `(() => { const b = document.querySelector('#flow-ok'); if (b) b.click(); })()`);
    await sleep(300);

    // ---- 6. the named INBOX's glance: 'LINE · PRESS DESK' through the arbiter (hover layer) ----
    await evalJS(cdp, `(() => {
      const st = Build.__test__.station();
      const p = st.propById(${JSON.stringify(stamped.intake)});
      const cv = document.querySelector('.refit-canvas');
      const ev = Build.__test__._tileEvent([p.x + 1, p.y + 1], 0);
      cv.dispatchEvent(new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, pointerId: 1, bubbles: true }));
      return 'hovering';
    })()`);
    await sleep(600);
    const glance = await evalJS(cdp, `JSON.stringify((() => {
      const pc = document.querySelector('.refit-propcard') || document.querySelector('#refit-propcard') || [...document.querySelectorAll('div')].find(d => d.className && String(d.className).indexOf('pc-') >= 0);
      const anyCard = [...document.querySelectorAll('.pc-assign')].map(e => e.textContent.trim());
      return { assigns: anyCard };
    })())`);
    console.log('INTAKE HOVER VOICE:', glance);
    shots.push(await capture(cdp, OUT, 'intake-glance-line-name'));

    // ---- LIVE WIRE PROOF: the browser-posted plan serves the downstream dock's brief over the seam ----
    const researcherAgent = await evalJS(cdp, `(Build.__test__.station().propById(${JSON.stringify(bayId)}).agentId || null)`);
    await evalJS(cdp, `(() => { Build.close(); return 'closed'; })()`);   // close REFIT -> world rederives -> plan POSTs
    await sleep(2500);
    const wire = await evalJS(cdp, `(async () => {
      const h = {}; const tok = window.__STARNET_API_TOKEN__ || '';
      if (tok) h['X-StarNet-Token'] = String(tok);
      const r = await fetch('/api/routing/chain?agentId=' + encodeURIComponent(${JSON.stringify(researcherAgent)}) + '&tag=general', { cache: 'no-store', headers: h });
      return JSON.stringify(await r.json());
    })()`);
    console.log('LIVE CHAIN SEAM (browser-posted plan):', wire);
    const wireJ = JSON.parse(wire);
    if (wireJ.brief !== WRITER_BRIEF) throw new Error('the posted plan did not serve the downstream brief: ' + wire);

    // ---- 4. PERSISTENCE: reload the whole app; the brief + name survive; the card reads them back ----
    await evalJS(cdp, `(() => { App.persist(); location.reload(); return 'reloading'; })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after the persistence reload');
    await sleep(1500);
    opened = await evalJS(cdp, OPEN_REFIT);
    if (opened !== 'open') throw new Error('REFIT did not reopen: ' + opened);
    await sleep(800);
    const survived = await evalJS(cdp, `JSON.stringify((() => {
      const st = Build.__test__.station();
      const bay = st.props().find(p => p.t === 'bay' && p.role === 'RESEARCHER');
      const intake = st.props().find(p => p.t === 'intake');
      return { brief: bay && bay.brief || null, agentId: bay && bay.agentId || null, label: intake && intake.label || null, bayId: bay && bay.id };
    })())`);
    console.log('AFTER RELOAD:', survived);
    const sv = JSON.parse(survived);
    if (sv.brief !== BRIEF) throw new Error('brief did not survive the reload');
    if (sv.label !== LINE_NAME) throw new Error('line name did not survive the reload');
    await evalJS(cdp, `Build.openAssign(${JSON.stringify(sv.bayId)})`);
    await sleep(500);
    const reread = await evalJS(cdp, `JSON.stringify((() => {
      const g = document.querySelector('.refit-step-card');
      return g && { briefValue: g.querySelector('#step-brief').value, bound: g.querySelector('#step-bound').textContent.trim() };
    })())`);
    console.log('CARD AFTER RELOAD:', reread);
    shots.push(await capture(cdp, OUT, 'brief-persist-after-reload'));

    console.log(JSON.stringify({ out: OUT, shots: shots.map(s => s.path), consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
