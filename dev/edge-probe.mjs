// one-off edge probes for the sweep — search x tier-filter interplay, window reopen, toggle re-render
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';
const PORT = process.env.SKYNET_SHOT_PORT || '9591';
const CDP = Number(process.env.SKYNET_CDP_PORT || 9593);
const URL = `http://127.0.0.1:${PORT}/`;
const scratch = mkdtempSync(join(tmpdir(), 'abedge-'));
materializeSeedWorkspace(join(scratch, 'ws'));
const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
let chrome = null, cdp = null;
try {
  if (!(await waitUp(URL))) throw new Error('sidecar down');
  chrome = launchChrome({ cdpPort: CDP, profileDir: join(scratch, 'chrome') });
  await sleep(1200);
  cdp = await connectCDP(CDP);
  await cdp.send('Runtime.enable');
  const diag = collectDiagnostics(cdp);
  await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
  if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('no game screen');
  await sleep(1500);
  await evalJS(cdp, `StationUI.openTerm('connectors')`); await sleep(1600);

  // 1. SEARCH x TIER FILTER: activate "no setup", then search a name that is API-key tier.
  const sxf = await evalJS(cdp, `(async () => {
    document.querySelector('#con-tab-connectors-catalog').click();
    document.querySelector('.cc-filter[data-cc-filter="none"]').click();
    const inp = document.querySelector('.con-search-in');
    inp.value = 'stripe'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const card = [...document.querySelectorAll('#cc-list .cc-card')].find(c => c.dataset.id === 'stripe');
    const r = { searching: document.querySelector('.term-console-body').classList.contains('con-searching'),
      stripeHit: card ? card.classList.contains('con-hit') : 'no-card',
      stripePainted: card ? card.offsetParent !== null : 'no-card',
      routerHidden: getComputedStyle(document.querySelector('.ab-router')).display === 'none' };
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r2 => setTimeout(r2, 200));
    r.routerBackAfterClear = getComputedStyle(document.querySelector('.ab-router')).display !== 'none';
    document.querySelector('.cc-filter[data-cc-filter="all"]').click();
    return r;
  })()`);
  console.log('SEARCH-X-FILTER', JSON.stringify(sxf));

  // 2. WINDOW REOPEN: close + reopen, then one route jump + one filter click must still work.
  const reopen = await evalJS(cdp, `(async () => {
    StationUI.toggleTerm('connectors'); await new Promise(r => setTimeout(r, 300));
    StationUI.openTerm('connectors'); await new Promise(r => setTimeout(r, 1200));
    const r = {};
    document.querySelector('.ab-route[data-ab-to="catalog"]').click();
    r.routeWorks = (document.querySelector('.con-rail-item.active') || {}).dataset?.section === 'catalog';
    document.querySelector('.cc-filter[data-cc-filter="apikey"]').click();
    await new Promise(r2 => setTimeout(r2, 200));
    r.filterWorks = [...document.querySelectorAll('#cc-list .cc-card')].filter(c => c.offsetParent !== null).length;
    document.querySelector('.cc-filter[data-cc-filter="all"]').click();
    return r;
  })()`);
  console.log('REOPEN', JSON.stringify(reopen));

  // 3. TOGGLE RE-RENDER: flip a toolset off+on; the +N more button must come back (rows are rebuilt).
  const rerender = await evalJS(cdp, `(async () => {
    document.querySelector('#con-tab-connectors-toolsets').click();
    await new Promise(r => setTimeout(r, 400));
    const cb = document.querySelector('input[data-ts-toggle="web"]'); if (!cb) return 'no-web-toggle';
    cb.click(); await new Promise(r => setTimeout(r, 900));
    cb2 = document.querySelector('input[data-ts-toggle="web"]'); cb2.click();
    await new Promise(r => setTimeout(r, 900));
    const row = document.querySelector('.ts-row[data-id="web"]');
    return { enabledAgain: document.querySelector('input[data-ts-toggle="web"]').checked,
      moreBtnBack: !!(row && row.querySelector('button[data-ts-more]')),
      placeBtnStill: !!(row && row.querySelector('button[data-ts-place]')) };
  })()`);
  console.log('TOGGLE-RERENDER', JSON.stringify(rerender));

  if (diag.exceptions.length) console.log('PAGE EXCEPTIONS:', diag.exceptions);
  const errs = diag.consoleMsgs.filter(m => m.type === 'error');
  if (errs.length) console.log('CONSOLE ERRORS:', errs.slice(0, 5));
} finally {
  try { if (chrome && chrome.proc) chrome.proc.kill(); } catch {}
  try { if (side && side.kill) side.kill(); } catch {}
}
