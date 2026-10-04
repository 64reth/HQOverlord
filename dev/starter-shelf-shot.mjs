#!/usr/bin/env node
/* dev/starter-shelf-shot.mjs — live proof for the STARTER GEAR card (replaces STATION ORDERS):
 * fresh floor shows the 5 powers, rows tick BY GRANT as props land, the card retires at 5/5
 * without burning the dismiss key, and reclaiming a power re-summons it. Runs in real Chrome
 * over CDP because the card's refresh rides the draw-loop poll — rAF never fires in the
 * preview pane. Same headless pattern as brightness-shots.mjs / catshot.mjs.
 *
 *   node dev/starter-shelf-shot.mjs
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9531';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9533);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-starter-shelf');

const CARD = `(() => {
  const el = document.querySelector('.refit-finline');
  if (!el) return JSON.stringify({ card: null });
  return JSON.stringify({ orders: el.classList.contains('refit-orders'),
    title: (el.querySelector('.fl-title') || {}).textContent,
    count: (el.querySelector('.fl-count') || {}).textContent,
    opt: (el.querySelector('.fl-opt') || {}).textContent,
    rows: [...el.querySelectorAll('[data-ord]')].map(b => b.textContent.trim()) });
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'startershelf-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    await evalJS(cdp, `(() => { Build.open();
      const go = [...document.querySelectorAll('button')].find(b => /START BUILDING/i.test(b.textContent || ''));
      if (go) go.click(); return 'ok'; })()`);
    await sleep(1200);

    // 1. fresh floor: the card carries the 5 powers at 0/5
    const fresh = JSON.parse(await evalJS(cdp, CARD));
    console.log('fresh ->', fresh);
    if (!fresh.orders || !/STARTER GEAR/.test(fresh.title || '') || fresh.count !== '0/5' || fresh.rows.length !== 5
        || fresh.opt !== 'everything else is optional')
      throw new Error('fresh card wrong: ' + JSON.stringify(fresh));
    console.log('shot', await capture(cdp, OUT, 'starter-card-fresh'));

    // 2. a row click arms the prop tool with that prop picked
    const armed = JSON.parse(await evalJS(cdp, `(() => {
      document.querySelector('.refit-finline [data-ord="studio"]').click();
      return JSON.stringify({ tool: (document.querySelector('.refit-tool.active') || {}).dataset.tool,
        tile: !!document.querySelector('.refit-proptile[data-prop="studio"].active') }); })()`));
    console.log('row click ->', armed);
    if (armed.tool !== 'prop' || !armed.tile) throw new Error('row click did not arm the prop: ' + JSON.stringify(armed));

    // 3. grant-keyed ticks: studio + a VAULT (files SKIN — must tick the INTEL CAB row)
    await evalJS(cdp, `(Build.requisition('studio'), Build.requisition('vault'), 'ok')`);
    await sleep(2600);   // the card refresh rides the draw loop's 2s poll
    const mid = JSON.parse(await evalJS(cdp, CARD));
    console.log('after studio+vault ->', mid);
    if (mid.count !== '2/5' || !mid.rows.some(r => /✓ FILES/.test(r)) || !mid.rows.some(r => /✓ IMAGES/.test(r)))
      throw new Error('grant ticks wrong: ' + JSON.stringify(mid));
    console.log('shot', await capture(cdp, OUT, 'starter-card-mid'));

    // 4. all five powers down → the card retires on its own, dismiss key NOT burned
    await evalJS(cdp, `(Build.requisition('comms_dish'), Build.requisition('workbench'), Build.requisition('gigs_servercart'), 'ok')`);
    await sleep(2600);
    const done = JSON.parse(await evalJS(cdp, CARD));
    const key = await evalJS(cdp, `Object.keys(localStorage).filter(k => k.includes('refit.orders.dis')).length`);
    console.log('at 5/5 ->', done, 'dismiss keys:', key);
    if (done.card !== null || Number(key) !== 0) throw new Error('card did not self-retire cleanly: ' + JSON.stringify({ done, key }));

    // 5. reclaim the only dish → the card re-summons at 4/5
    await evalJS(cdp, `(() => { const st = Build.__test__.station();
      const dish = st.props().find(p => p.t === 'comms_dish'); return JSON.stringify(st.removeProp(dish.id)); })()`);
    await sleep(2600);
    const back = JSON.parse(await evalJS(cdp, CARD));
    console.log('after reclaim ->', back);
    if (!back.orders || back.count !== '4/5') throw new Error('card did not re-summon: ' + JSON.stringify(back));

    if (diag.exceptions.length) console.log('PAGE EXCEPTIONS:', diag.exceptions);
    const errs = diag.consoleMsgs.filter(m => m.type === 'error');
    if (errs.length) console.log('CONSOLE ERRORS:', errs.slice(0, 10));
    console.log('ALL PROOFS PASS ->', OUT);
  } finally {
    try { chrome && chrome.proc.kill(); } catch {}
    try { side && side.kill(); } catch {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
