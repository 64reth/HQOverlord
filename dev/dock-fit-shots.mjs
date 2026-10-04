#!/usr/bin/env node
/* dev/dock-fit-shots.mjs — proof harness for the REFIT dock vs TEXT SIZE body zoom.
 *
 * The bug (found 2026-08-05 by the lines-shelf-v2 lane): the dock's max-height was
 * `calc(100vh - 68px)`. TEXT SIZE is a body zoom, and a vh length inside the zoomed
 * subtree still computes against the REAL viewport — so the whole dock renders
 * zoom× too tall and its tail (the LINES footer, gallery tails) falls off the glass.
 *
 * For each text scale (100 / AUTO / 130) it pins the REAL settings store, reloads,
 * opens REFIT, selects the LINE tool, scrolls the palette to its foot and records:
 *   innerHeight · body zoom · overlay/dock rects (visual px) · dock offsetHeight
 *   (panel-UX law: rects read large under zoom — offsetHeight is the layout truth)
 *   · the LINES footer note bottom vs the palette bottom (noteInPal)
 * plus a full screenshot per scale.
 *
 *   node dev/dock-fit-shots.mjs <label>     → dev/.shots-dock-fit/<label>-t100.png …
 *   ports: SKYNET_SHOT_PORT (default 9497) / SKYNET_CDP_PORT (default 9487)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const LABEL = process.argv[2] || 'shot';
const PORT = process.env.SKYNET_SHOT_PORT || '9497';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9487);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-dock-fit');

// textScale 0 = AUTO (the shipped default; resolves 115 on a ≤1470px-long screen)
const SCALES = [['t100', 100], ['auto', 0], ['t130', 130]];

const setScale = (v) => `(() => {
  const KEY = 'starnet.station.v1';
  const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
  r.settings = Object.assign({}, r.settings, { textScale: ${v} });
  localStorage.setItem(KEY, JSON.stringify(r));
  location.reload();
  return 'reloading';
})()`;

const OPEN_REFIT = `(() => {
  if (typeof Build === 'undefined') return 'no-build';
  if (!Build.isOpen()) Build.open();
  const card = document.querySelector('.refit-firstrun');
  if (card) { const go = card.querySelector('#refit-guide-go'); if (go) go.click(); }
  return Build.isOpen() ? 'open' : 'failed';
})()`;

const MEASURE = `(() => {
  const ov = document.querySelector('.refit-overlay');
  const dock = document.querySelector('.refit-dock');
  const pal = document.querySelector('.refit-palette');
  pal.scrollTop = pal.scrollHeight;                       // show the shelf's tail
  const note = document.querySelector('.refit-linenote');
  const dr = dock.getBoundingClientRect(), or2 = ov.getBoundingClientRect();
  const pr = pal.getBoundingClientRect();
  const nr = note ? note.getBoundingClientRect() : null;
  return {
    innerHeight: window.innerHeight,
    zoom: document.body.style.zoom || '1',
    overlayBottom: Math.round(or2.bottom),
    dockTop: Math.round(dr.top), dockBottom: Math.round(dr.bottom),
    dockRectH: Math.round(dr.height), dockOffsetH: dock.offsetHeight,
    dockMaxH: getComputedStyle(dock).maxHeight,
    palBottom: Math.round(pr.bottom),
    noteBottom: nr ? Math.round(nr.bottom) : null,
    noteInPal: nr ? nr.bottom <= pr.bottom + 2 : null,
    dockFitsGlass: dr.bottom <= window.innerHeight + 1,
  };
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'dockfit-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const results = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    // 1040 tall reproduces the report: AUTO (115%) pushed the vh-sized dock to ~939px in a ~900px glass
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,1040', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1200);
    mkdirSync(OUT, { recursive: true });

    for (const [tag, scale] of SCALES) {
      await evalJS(cdp, setScale(scale));
      if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after textScale=' + scale);
      await sleep(1200);
      const opened = await evalJS(cdp, OPEN_REFIT);
      if (opened !== 'open') throw new Error('REFIT did not open at ' + tag + ': ' + opened);
      await sleep(500);
      await evalJS(cdp, `document.querySelector('.refit-tool[data-tool="line"]').click()`);
      await sleep(400);
      results[tag] = await evalJS(cdp, MEASURE);
      await sleep(200);
      await capture(cdp, OUT, `${LABEL}-${tag}`);
      console.log(tag + ':', JSON.stringify(results[tag]));
      await evalJS(cdp, `Build.isOpen() && Build.toggle && Build.toggle()`).catch(() => {});
      await sleep(300);
    }

    console.log(JSON.stringify({ out: OUT, label: LABEL, results, consoleErrors: diag.consoleMsgs.slice(0, 10), exceptions: diag.exceptions.slice(0, 10) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
