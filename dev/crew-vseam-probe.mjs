#!/usr/bin/env node
/* dev/crew-vseam-probe.mjs — proof harness for the CREW/SESSIONS seam (leftrail.js, 2026-08-10).
 *
 * The ask: "users should have the option to raise the sessions way higher if they want more space
 * to see their sessions." The roster window measured a good default split and offered no lever.
 * This drives the new horizontal seam end to end on a real 6-agent, 12-session station and records
 * at every step:
 *   where the handle sits (it must cover the gap the eye reads, between the WORKING/IDLE strip and
 *   the SESSIONS module) · the roster height and whole-row count · SESSIONS' height · that the px
 *   the roster gives up are exactly the px SESSIONS gains · slicedRowPx (the roster window's own
 *   law — it must stay 0 at every notch) · the floor, the ceiling, persistence across a reload and
 *   the double-click reset. Repeated at TEXT SIZE 100 and 130 so the body-zoom conversion in the
 *   drag math is measured rather than assumed.
 *
 *   node dev/crew-vseam-probe.mjs <label>   → dev/.shots-crew-vseam/<label>-*.png + report.txt
 *   ports: SKYNET_SHOT_PORT (default 9761) / SKYNET_CDP_PORT (default 9762)
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const LABEL = process.argv[2] || 'run';
const PORT = process.env.SKYNET_SHOT_PORT || '9761';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9762);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-crew-vseam');

// Summon real crew through the SAME door the Recruitment Bay uses, so the rows measured are the
// rows a Commander actually gets, and fill the rail with sessions — the state the ask came from.
const SUMMON = (n) => `(() => {
  if (typeof App === 'undefined' || !App.summonAgent) return 'no-app';
  const want = ['VECTOR', 'ORACLE', 'HALCYON', 'PRISM', 'WARDEN', 'CIPHER'];
  let made = 0;
  while (App.crewCount() < ${n} && made < 20) {
    const nm = want[made % want.length];
    try { App.summonAgent({ name: nm, agentName: nm, role: 'specialist' }, { activate: false, desk: false }); } catch (e) { return 'throw:' + e.message; }
    made++;
  }
  return App.crewCount();
})()`;

const SESSIONS = (n) => `(() => {
  const btn = document.getElementById('ws-new');
  if (!btn) return 'no-btn';
  for (let i = 0; i < ${n}; i++) btn.click();
  return document.querySelectorAll('#workstreams .ws-row').length;
})()`;

// THE measurement. #left and its children share one zoom context, so offsetTop/offsetHeight are
// directly comparable to the CSS px the cap is written in; the rects are only used for the seam's
// alignment against the two panels it divides, where both sides carry the same zoom.
const MEASURE = `(() => {
  const ul = document.getElementById('crew');
  const sum = document.getElementById('crew-sum');
  const ws = document.getElementById('ws-wrap');
  const seam = document.getElementById('crew-vresizer');
  if (!ul || !ws) return { err: 'no rail' };
  const rows = [...ul.querySelectorAll('.crew-row')];
  const win = ul.clientHeight;
  const padTop = parseFloat(getComputedStyle(ul).paddingTop) || 0;
  const bottoms = rows.map(r => (r.offsetTop - ul.offsetTop) + r.offsetHeight);
  let whole = 0;
  for (const b of bottoms) { if (b <= win + 0.5) whole++; else break; }
  const nextTop = rows[whole] ? (rows[whole].offsetTop - ul.offsetTop) : null;
  const sumR = sum.getBoundingClientRect(), wsR = ws.getBoundingClientRect();
  // the handle is zero-height; what has to cover the gap is its ::before hit strip
  const hit = seam ? getComputedStyle(seam, '::before') : null;
  const seamR = seam ? seam.getBoundingClientRect() : null;
  let stored = null; try { stored = localStorage.getItem('starnet.crewrail.rows'); } catch (_) {}
  return {
    agents: rows.length,
    crewH: Math.round(ul.getBoundingClientRect().height * 10) / 10,
    wholeRowsVisible: whole,
    slicedRowPx: nextTop === null ? 0 : Math.max(0, Math.round((win - nextTop) * 10) / 10),
    crewScrolls: ul.scrollHeight > ul.clientHeight + 1,
    cap: getComputedStyle(ul).maxHeight,
    wsH: Math.round(wsR.height * 10) / 10,
    wsRows: document.querySelectorAll('#workstreams .ws-row').length,
    // a CLOSED roster must still tell the truth about the crew it is no longer listing
    sumText: sum.textContent.replace(/\\s+/g, ' ').trim(),
    sumVisible: sumR.height > 0,
    headVisible: (() => { const h = document.querySelector('#left h3'); return !!(h && h.getBoundingClientRect().height > 0); })(),
    // the seam must sit ON the gap: its anchor line between the strip's bottom and the module's top
    seamPresent: !!seam, seamHidden: seam ? seam.hidden : null,
    seamY: seamR ? Math.round(seamR.top * 10) / 10 : null,
    gapTop: Math.round(sumR.bottom * 10) / 10, gapBottom: Math.round(wsR.top * 10) / 10,
    seamOnGap: seamR ? (seamR.top >= sumR.bottom - 0.5 && seamR.top <= wsR.top + 0.5) : null,
    hitTop: hit ? hit.top : null, hitHeight: hit ? hit.height : null, hitCursor: hit ? hit.cursor : null,
    zoom: document.body.style.zoom || '1',
    stored,
  };
})()`;

// a real pointer drag on the seam: down on the handle, move to an absolute clientY, up
const drag = (toY) => `(() => {
  const seam = document.getElementById('crew-vresizer');
  const r = seam.getBoundingClientRect();
  const opts = { pointerId: 3, bubbles: true, cancelable: true, isPrimary: true };
  const x = Math.round(r.left + r.width / 2);
  seam.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: x, clientY: Math.round(r.top) }, opts)));
  seam.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: x, clientY: ${toY} }, opts)));
  seam.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: x, clientY: ${toY} }, opts)));
  return true;
})()`;

// The grip is invisible until hovered, exactly like the two column seams — so the only way to
// prove it reads as a real control is to put a REAL cursor on it (a synthetic PointerEvent does
// not set :hover) and read the pseudo back.
const HOVER = `(() => {
  const seam = document.getElementById('crew-vresizer');
  const a = getComputedStyle(seam, '::after');
  return {
    hovered: seam.matches(':hover'),
    gripOpacity: a.opacity, gripBackground: a.backgroundColor,
    gripShadow: a.boxShadow, gripW: a.width, gripH: a.height,
  };
})()`;

const DBLCLICK = `(() => {
  document.getElementById('crew-vresizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  let stored = null; try { stored = localStorage.getItem('starnet.crewrail.rows'); } catch (_) {}
  return { stored };
})()`;

// TEXT SIZE cannot be driven by writing body.style.zoom — applySettings re-derives it from the
// store. Write the setting the app actually reads, then reload.
const setScale = (v) => `(() => {
  const KEY = 'starnet.station.v1';
  const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
  r.settings = Object.assign({}, r.settings, { textScale: ${v} });
  localStorage.setItem(KEY, JSON.stringify(r));
  location.reload();
  return 'reloading';
})()`;

// a magnified crop, so a 2px grip is actually legible in the proof shot
async function clip(cdp, name, rect) {
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
    clip: { x: Math.round(rect.x), y: Math.round(rect.y), width: rect.width, height: rect.height, scale: 4 },
  });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64'));
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'crewvseam-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const report = [];
  const say = (k, v) => { report.push(k + ': ' + JSON.stringify(v)); console.log(k + ': ' + JSON.stringify(v)); };
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    say('roster after summon', await evalJS(cdp, SUMMON(6)));
    await sleep(1200);
    say('sessions on the rail', await evalJS(cdp, SESSIONS(12)));
    await sleep(1200);

    for (const [tag, scale] of [['t100', 100], ['t130', 130]]) {
      await evalJS(cdp, setScale(scale));
      if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after textScale=' + scale);
      await sleep(1500);

      const dflt = await evalJS(cdp, MEASURE);
      say(tag + ' 1 default (auto split)', dflt);
      await capture(cdp, OUT, `${LABEL}-${tag}-1-default`);

      // 0 · the grip lights under a REAL cursor, and only then
      say(tag + ' 1b cold (no cursor)', await evalJS(cdp, HOVER));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 120, y: Math.round(dflt.seamY + 2), button: 'none', buttons: 0 });
      await sleep(400);
      say(tag + ' 1b hovered', await evalJS(cdp, HOVER));
      await clip(cdp, `${LABEL}-${tag}-1b-grip`, { x: 8, y: dflt.seamY - 34, width: 240, height: 68 });

      // 1 · RAISE SESSIONS: drag the seam up to where the 2nd row ends
      await evalJS(cdp, drag(Math.round(dflt.gapTop - 150)));
      await sleep(400);
      const up = await evalJS(cdp, MEASURE);
      say(tag + ' 2 dragged UP', up);
      say(tag + ' 2 exchange', { crewGave: Math.round((dflt.crewH - up.crewH) * 10) / 10, sessionsGained: Math.round((up.wsH - dflt.wsH) * 10) / 10 });
      await capture(cdp, OUT, `${LABEL}-${tag}-2-sessions-tall`);

      // 2 · past the top: the roster CLOSES and SESSIONS owns the column (round 2) — and the
      //     header + WORKING/IDLE totals must survive, or the rail stopped reporting its crew
      await evalJS(cdp, drag(10));
      await sleep(400);
      const shut = await evalJS(cdp, MEASURE);
      say(tag + ' 3 dragged SHUT', shut);
      say(tag + ' 3 exchange', { crewGave: Math.round((dflt.crewH - shut.crewH) * 10) / 10, sessionsGained: Math.round((shut.wsH - dflt.wsH) * 10) / 10 });
      await capture(cdp, OUT, `${LABEL}-${tag}-3-shut`);

      // 2b · and the way back: drag down again, the rows return
      await evalJS(cdp, drag(Math.round(dflt.gapTop - 100)));
      await sleep(400);
      say(tag + ' 3b reopened from shut', await evalJS(cdp, MEASURE));

      // 3 · the other way: the whole roster, bounded by the SESSIONS floor
      await evalJS(cdp, drag(2000));
      await sleep(400);
      say(tag + ' 4 dragged past the bottom', await evalJS(cdp, MEASURE));
      await capture(cdp, OUT, `${LABEL}-${tag}-4-crew-tall`);

      // 4 · persistence: land on 2 rows, reload, and the split must come back
      await evalJS(cdp, drag(Math.round(dflt.gapTop - 150)));
      await sleep(300);
      const before = await evalJS(cdp, MEASURE);
      await evalJS(cdp, `location.reload()`);
      if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after reload');
      await sleep(1500);
      const after = await evalJS(cdp, MEASURE);
      say(tag + ' 5 across a reload', { beforeRows: before.wholeRowsVisible, beforeCap: before.cap, afterRows: after.wholeRowsVisible, afterCap: after.cap, stored: after.stored });

      // 5 · double-click hands the split back to the measured default
      say(tag + ' 6 dblclick', await evalJS(cdp, DBLCLICK));
      await sleep(400);
      const reset = await evalJS(cdp, MEASURE);
      say(tag + ' 6 after reset', reset);
      say(tag + ' 6 back to default', { defaultCap: dflt.cap, resetCap: reset.cap, same: dflt.cap === reset.cap });
      await capture(cdp, OUT, `${LABEL}-${tag}-5-reset`);
    }

    say('console errors', diag.consoleMsgs.filter(m => m.level === 'error').slice(0, 10));
    say('exceptions', diag.exceptions.slice(0, 10));
  } catch (e) {
    report.push('ERROR: ' + (e && e.stack || e));
    console.error(String(e && e.stack || e));
  } finally {
    try { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, `${LABEL}-report.txt`), report.join('\n') + '\n'); } catch {}
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.proc ? chrome.proc.kill() : chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}

main().then(() => process.exit(0), e => { console.error(String(e && e.stack || e)); process.exit(1); });
