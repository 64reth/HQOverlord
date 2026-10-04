/* dev/deliverables-shots.mjs — real PNGs of the organized DELIVERABLES area.

   The in-app preview pane cannot capture this window (its open animation freezes at t=0, so the window measures
   ~7px, and the pane does not composite frames at all), which is why this goes through headless Chrome instead.
   It attaches to an ALREADY-RUNNING seed (dev/seed-deliverables.js on SKYNET_PORT, default 8733) rather than
   booting its own, so the shots are of the exact library that seed built with real runs.

   Usage:  node dev/seed-deliverables.js          (in one shell, leave running)
           node dev/deliverables-shots.mjs        (in another)

   Shots land in dev/.shots-deliverables/. Dev-only. */
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.shots-deliverables');
const PORT = process.env.SKYNET_PORT || '8733';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9779);
const PROFILE = join(OUT, '_chrome');

// Open the window and settle it for capture. Returns a small report so a failed shot is never a silent blank.
const OPEN_PANEL = `(async () => {
  StationUI.openTerm('deliverables');
  await new Promise(r => setTimeout(r, 1800));
  const win = document.querySelector('.term.console.dlv-win');
  if (!win) return JSON.stringify({ ok: false, why: 'window not found' });
  (win.getAnimations ? win.getAnimations() : []).forEach(a => { try { a.finish(); } catch (_) {} });
  await new Promise(r => setTimeout(r, 250));
  const r = win.getBoundingClientRect();
  return JSON.stringify({ ok: true, w: Math.round(r.width), h: Math.round(r.height), cards: document.querySelectorAll('.dlv-card').length });
})()`;

const EXPAND = (re) => `(async () => {
  const c = [...document.querySelectorAll('.dlv-card')].find(x => ${re}.test(x.textContent));
  if (!c) return JSON.stringify({ ok: false, why: 'card not found' });
  c.querySelector('.dlv-head').click();
  await new Promise(r => setTimeout(r, 450));
  c.scrollIntoView({ block: 'center' });
  await new Promise(r => setTimeout(r, 250));
  return JSON.stringify({ ok: true, title: c.querySelector('.dlv-title').textContent });
})()`;

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const { proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,980', profileDir: PROFILE });
  try {
    await sleep(1800);
    const cdp = await connectCDP(CDP_PORT);
    const diag = collectDiagnostics(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // rAF must be throttled BEFORE boot or the software-rendered game canvas starves every Runtime.evaluate.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 200);'
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT });
    await sleep(9000);   // ONE long uninterrupted settle; interleaved evaluates just queue behind the boot

    console.log('open  ->', await evalJS(cdp, OPEN_PANEL));
    console.log(' shot ->', JSON.stringify(await capture(cdp, OUT, '1-library')));

    console.log('expand pending ->', await evalJS(cdp, EXPAND('/onboarding checklist/i')));
    console.log(' shot ->', JSON.stringify(await capture(cdp, OUT, '2-pending-drawer')));

    console.log('expand churn   ->', await evalJS(cdp, EXPAND('/Q3 churn/')));
    console.log(' shot ->', JSON.stringify(await capture(cdp, OUT, '3-files-drawer')));

    const errs = (diag.exceptions || []).length;
    console.log('page exceptions during capture:', errs);
    if (errs) console.log(JSON.stringify(diag.exceptions.slice(0, 3), null, 1));
    console.log('\nshots in', OUT);
  } finally {
    try { proc.kill(); } catch (_) {}
  }
})();
