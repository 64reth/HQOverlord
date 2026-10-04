#!/usr/bin/env node
/* dev/guided-line-b-live.mjs — LIVE-WORLD proof for the ghost projection (Phase 3).
 * REFIT is proven by dev/guided-line-b-shots.mjs; this run proves the OTHER lifecycle half:
 * stamp an (uncrewed) line in REFIT, CLOSE refit — the live world resumes and the same
 * projection rides the live floor (World._dbgBeltLegibility().ghost), captioned in WOULD-voice,
 * while the real conveyor stays empty (dedicated engine — never mixed into `boxes`).
 *
 *   node dev/guided-line-b-live.mjs      (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
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

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'guidedblive-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
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

    // stamp an uncrewed RESEARCH LINE through REFIT, dismiss the coach, then CLOSE refit
    const stamped = await evalJS(cdp, `(() => {
      if (!Build.isOpen()) Build.open();
      const card = document.querySelector('.refit-firstrun');
      if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
      const st = Build.__test__.station();
      for (const b of st.belts()) st.removeBelt(b.x, b.y);
      const WF = { intake:1, bay:1, outbox:1, filter:1, splitter:1, merger:1 };
      for (const p of st.props().slice()) if (WF[p.t]) st.removeProp(p.id);
      const bnd = st.bounds();
      let spot = null;
      for (let ty = bnd.minTy - 2; ty <= bnd.maxTy + 2 && !spot; ty++)
        for (let tx = bnd.minTx - 2; tx <= bnd.maxTx + 2 && !spot; tx++)
          if (st.canPlaceBlueprint('research_line', tx, ty).ok) spot = { tx, ty };
      if (!spot) return 'no-spot';
      const res = st.stampBlueprint('research_line', spot.tx, spot.ty);
      if (!res || !res.ok) return 'stamp-failed';
      const ok = document.querySelector('.tut-coach-ok'); if (ok) ok.click();
      Build.close();   // the live world resumes on the new floor
      return { spot, props: st.props().length };
    })()`);
    console.log('STAMP+CLOSE:', JSON.stringify(stamped));
    if (!stamped || !stamped.spot) throw new Error('stamp/close failed: ' + stamped);

    // the live world's projection state (the EXACT renderer state, never a re-derivation)
    const t0 = Date.now();
    let live = null;
    while (Date.now() - t0 < 25000) {
      const raw = await evalJS(cdp, `JSON.stringify((() => {
        const d = World._dbgBeltLegibility();
        return { coaching: (typeof Tutorial !== 'undefined' && Tutorial.isCoaching) ? Tutorial.isCoaching() : null,
                 realBoxes: d.boxes.length, ghost: d.ghost && { projecting: d.ghost.projecting, pass: d.ghost.pass,
                 boxes: d.ghost.boxes, notes: d.ghost.notes, candidates: d.ghost.candidates } };
      })())`);
      live = JSON.parse(raw);
      if (live.ghost && live.ghost.projecting && live.ghost.boxes.length && live.ghost.boxes.some(b => b.sink <= 0 && b.prog > 0.1 && b.prog < 0.9)) break;
      await sleep(150);
    }
    console.log('LIVE-WORLD GHOST:', JSON.stringify(live));
    if (!live || !live.ghost || !live.ghost.projecting || !live.ghost.boxes.length) throw new Error('the live-world projection never rode');
    if (live.realBoxes !== 0) throw new Error('real conveyor unexpectedly carries boxes: ' + live.realBoxes);
    if (!live.ghost.boxes.every(b => b.payload && b.payload.ghost)) throw new Error('a live ghost box is missing the ghost flag');
    const shot = await capture(cdp, OUT, 'ghost-live-world');
    console.log(JSON.stringify({ shot: shot.path, consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
