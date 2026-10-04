#!/usr/bin/env node
/* dev/popup-topcut-shots.mjs — does a floating window's HEADER survive the largest TEXT SIZE?
 *
 * User report (2026-08-06): "the top of the popup windows get cut off under the header bar
 * (I'm using the largest possible font since my monitor makes everything super small)".
 *
 * TEXT SIZE is a body zoom. A `vh` length inside the zoomed subtree still computes against the
 * REAL viewport, so a `.term` capped at `min(86vh, 100vh - 32px)` (and `.term.console` at
 * `min(78vh, 720px)`) renders zoom× too tall. Centred, that pushes its titlebar up into — or
 * past — the topbar. This harness measures, per window key and per scale:
 *   topbar rect · window rect · .term-head rect · offsetHeight (layout truth) · computed caps
 *   · headTop-vs-topbarBottom · whether elementFromPoint over the ✕ actually hits the ✕
 * plus a screenshot of each.
 *
 *   node dev/popup-topcut-shots.mjs <label>   → dev/.shots-popup-topcut/<label>-<key>-<tag>.png
 *   ports: SKYNET_SHOT_PORT (default 9531) / SKYNET_CDP_PORT (default 9521)
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const LABEL = process.argv[2] || 'shot';
const PORT = process.env.SKYNET_SHOT_PORT || '9531';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9521);
const WIN = process.env.SKYNET_SHOT_WIN || '1920,1080';
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-popup-topcut');

// 150 is the ceiling the SETTINGS dial clamps to (stationui clampN(v, 90, 150)).
const SCALES = [['t100', 100], ['t150', 150]];
// one plain window (tasks), one CONSOLE window (settings), one console+feature (agents)
const KEYS = ['tasks', 'settings', 'agents'];

const setScale = (v) => `(() => {
  const KEY = 'starnet.station.v1';
  const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
  r.settings = Object.assign({}, r.settings, { textScale: ${v} });
  // a remembered drag position / size would mask the DEFAULT placement this report is about
  delete r.termPos; delete r.termSize;
  localStorage.setItem(KEY, JSON.stringify(r));
  location.reload();
  return 'reloading';
})()`;

/* DESKTOP-SHELL MODE (SKYNET_SHOT_CHROME=1). The Windows shell removes the native titlebar and
   titlebar.js stamps body.sn-chrome + mounts #sn-titlebar (fixed, 34px, z930). Only the Tauri
   handle is unavailable in a browser, so we mount the REAL bar element and set the REAL class —
   the geometry and the z-order under test are the shipped ones. */
const MOUNT_CHROME = `(() => {
  if (typeof Titlebar === 'undefined' || !Titlebar.buildBar) return 'no-titlebar-module';
  if (!document.getElementById('sn-titlebar')) document.body.appendChild(Titlebar.buildBar(document).bar);
  document.body.classList.add('sn-chrome');
  window.dispatchEvent(new Event('resize'));
  return 'chrome-mounted';
})()`;

const openKey = (k) => `(() => {
  if (typeof StationUI === 'undefined') return 'no-stationui';
  StationUI.openTerm(${JSON.stringify(k)});
  return document.querySelectorAll('.term').length + ' open';
})()`;

/* Drag the window's header as far up as the pointer can go. The band is only half the fix if a
   user can still park a window under the bars — the drag clamp has to refuse it. */
const dragTo = (toY) => `(() => {
  const all = [...document.querySelectorAll('.term')];
  const w = all[all.length - 1]; if (!w) return 'no-window';
  const head = w.querySelector('.term-head'); const r = head.getBoundingClientRect();
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const M = (t, y) => new MouseEvent(t, { clientX: cx, clientY: y, bubbles: true, cancelable: true });
  head.dispatchEvent(M('mousedown', cy));                 // stationui drags on mouse*, not pointer*
  window.dispatchEvent(M('mousemove', ${toY}));
  window.dispatchEvent(M('mouseup', ${toY}));
  return w.classList.contains('term-moved') ? 'moved:' + w.style.top : 'drag-not-registered';
})()`;

const closeAll = `(() => {
  document.querySelectorAll('.term .term-x').forEach(x => x.click());
  return 'closed';
})()`;

const measure = (k) => `(() => {
  const all = [...document.querySelectorAll('.term')];
  const w = all[all.length - 1];   // the most recently opened window, never a still-closing one
  if (!w) return { error: 'no window for ${k}' };
  // the "header bar" the report names: the desktop shell's own titlebar when present, else #topbar
  const chrome = document.getElementById('sn-titlebar');
  const tb = (chrome && getComputedStyle(chrome).display !== 'none') ? chrome : document.getElementById('topbar');
  const head = w.querySelector('.term-head');
  const x = w.querySelector('.term-x');
  const r = w.getBoundingClientRect(), tr = tb.getBoundingClientRect(), hr = head.getBoundingClientRect();
  const cs = getComputedStyle(w);
  // Is the ✕ actually the thing painted at its own centre, and is that point on-screen?
  const xr = x ? x.getBoundingClientRect() : null;
  let xHit = null, xOnScreen = null;
  if (xr) {
    const cx = Math.round(xr.left + xr.width / 2), cy = Math.round(xr.top + xr.height / 2);
    xOnScreen = cy >= 0 && cy <= window.innerHeight && cx >= 0 && cx <= window.innerWidth;
    const el = xOnScreen ? document.elementFromPoint(cx, cy) : null;
    xHit = el ? (el === x || x.contains(el) ? 'x' : (el.className || el.tagName)) : 'off-screen';
  }
  // …and is the window's own TITLE the thing painted at its centre?
  const t = w.querySelector('.term-title');
  let titleHit = null;
  if (t) {
    const trc = t.getBoundingClientRect();
    const cx = Math.round(trc.left + trc.width / 2), cy = Math.round(trc.top + trc.height / 2);
    const el = (cy >= 0 && cy <= window.innerHeight) ? document.elementFromPoint(cx, cy) : null;
    titleHit = cy < 0 ? 'above-viewport' : (el ? (el === t || t.contains(el) ? 'title' : (el.id || el.className || el.tagName)) : 'none');
  }
  return {
    winCount: all.length,
    title: (w.querySelector('.term-title') || {}).textContent || '?',
    innerH: window.innerHeight, zoom: document.body.style.zoom || '1',
    topbarTop: Math.round(tr.top), topbarBottom: Math.round(tr.bottom),
    winTop: Math.round(r.top), winBottom: Math.round(r.bottom), winH: Math.round(r.height),
    offsetH: w.offsetHeight, maxH: cs.maxHeight, height: cs.height,
    headTop: Math.round(hr.top), headBottom: Math.round(hr.bottom),
    // the two failure modes the report describes
    headAboveViewport: hr.top < 0,
    headUnderTopbar: hr.top < tr.bottom,
    winBelowGlass: r.bottom > window.innerHeight + 1,
    xHit, xOnScreen, titleHit
  };
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'topcut-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const results = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: WIN, profileDir: join(scratch, 'chrome') });
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
      await sleep(1400);
      if (process.env.SKYNET_SHOT_CHROME === '1') console.log('chrome:', await evalJS(cdp, MOUNT_CHROME));
      for (const k of KEYS) {
        await evalJS(cdp, closeAll); await sleep(300);
        const opened = await evalJS(cdp, openKey(k));
        await sleep(900);   // the power-on animation (0.42s) plus the rAF fit pass
        const early = await evalJS(cdp, measure(k));
        await sleep(2600);  // …and again once everything has certainly settled
        results[tag + '/' + k] = await evalJS(cdp, measure(k));
        results[tag + '/' + k].earlyWinTop = early.winTop;
        results[tag + '/' + k].earlyHeadTop = early.headTop;
        await capture(cdp, OUT, `${LABEL}-${k}-${tag}`);   // the RESTING window, before we shove it
        // …then prove a USER cannot park it under the bars either. The DOWN drag is the control:
        // it must actually move, or an "unchanged after dragging up" reading proves nothing.
        results[tag + '/' + k].dragDown = await evalJS(cdp, dragTo(10000));
        await sleep(400);
        results[tag + '/' + k].downHeadTop = (await evalJS(cdp, measure(k))).headTop;
        results[tag + '/' + k].dragUp = await evalJS(cdp, dragTo(-400));
        await sleep(400);
        const dragged = await evalJS(cdp, measure(k));
        results[tag + '/' + k].draggedHeadTop = dragged.headTop;
        results[tag + '/' + k].draggedHeadUnderTopbar = dragged.headUnderTopbar;
        results[tag + '/' + k].draggedTitleHit = dragged.titleHit;
        console.log(tag, k, opened, JSON.stringify(results[tag + '/' + k]));
      }
      await evalJS(cdp, closeAll);
    }

    console.log(JSON.stringify({ out: OUT, label: LABEL, win: WIN, results,
      consoleErrors: diag.consoleMsgs.slice(0, 8), exceptions: diag.exceptions.slice(0, 8) }, null, 2));
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
