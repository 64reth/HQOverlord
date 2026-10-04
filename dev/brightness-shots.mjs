#!/usr/bin/env node
/* dev/brightness-shots.mjs — live proof shots for the BRIGHTNESS-knob lane.
 *
 * Boots a seeded sidecar from THIS worktree, drives the REAL app over CDP (the established
 * headless pattern — see catshot.mjs / scripts/lib/cdp.mjs), and captures the amber station at
 * BRIGHTNESS 0 (the shipped control) / 50 / 100, plus green at 100 — proving the panels lift in
 * the phosphor's own light while the page and the station feed stay dark.
 *
 *   node dev/brightness-shots.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9521';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9523);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-brightness');

// drive the REAL control: the settings window's BRIGHTNESS slider, via the same input events a
// user's drag fires — this exercises wireSlider → store.settings.panelBright → applySettings.
const dragBright = (v) => `(() => {
  const el = document.querySelector('#set-bright');
  if (!el) return 'no-slider';
  el.value = ${v};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return document.querySelector('#set-bright-val') ? document.querySelector('#set-bright-val').textContent : 'no-val';
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'brightshots-'));
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

    // per shot: open Settings, drag the real slider, CLOSE the window (scrim and all) so the
    // captured frame is the station itself, not the station behind a modal scrim.
    for (const [name, pct, theme] of [['amber-b0', 0, 'amber'], ['amber-b50', 50, 'amber'], ['amber-b100', 100, 'amber'], ['green-b100', 100, 'green']]) {
      await evalJS(cdp, `StationUI.openTerm('settings', 'appearance')`);
      await sleep(700);
      await evalJS(cdp, `StationUI.setTheme(${JSON.stringify(theme)})`);
      const dragged = await evalJS(cdp, dragBright(pct));
      console.log(name, 'slider ->', dragged);
      await evalJS(cdp, `StationUI.toggleTerm('settings')`);
      await sleep(700);
      const probe = await evalJS(cdp, `(() => { const cs = getComputedStyle(document.body); return {
        panel: cs.getPropertyValue('--panel').trim(), bg: cs.getPropertyValue('--bg').trim(),
        inline: document.body.style.getPropertyValue('--panel') || '(none)' }; })()`);
      console.log(name, probe);
      console.log('shot', await capture(cdp, OUT, name));
    }

    if (diag.exceptions.length) console.log('PAGE EXCEPTIONS:', diag.exceptions);
    const errs = diag.consoleMsgs.filter(m => m.type === 'error');
    if (errs.length) console.log('CONSOLE ERRORS:', errs.slice(0, 10));
    console.log('done ->', OUT);
  } finally {
    try { chrome && chrome.proc.kill(); } catch {}
    try { side && side.kill(); } catch {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
