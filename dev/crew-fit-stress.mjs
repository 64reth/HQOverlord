#!/usr/bin/env node
/* dev/crew-fit-stress.mjs — the roster window's hard cases, on the live app.

   crew-fit-probe.mjs proves the resting state (N whole rows, nothing sliced). This one attacks the
   three ways a measured cap can still land mid-row:
     A. SCROLL      — the agents past the window must actually be reachable, and reachable to the
                      LAST one (a cap computed from a stale row set would leave the tail unreachable).
     B. WORKING ROW — a live run grows .crew-prog inside the row, so every row below moves; the cap
                      has to re-measure or the flush edge becomes a slice.
     C. TEXT SIZE   — a body zoom puts rect px and style px in different spaces. Getting the
                      conversion wrong is invisible at 100% and slices at any other setting.

     node dev/crew-fit-stress.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT) */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9528';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9529);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-crew-fit');

const SUMMON = (n) => `(() => {
  if (typeof App === 'undefined' || !App.summonAgent) return 'no-app';
  const want = ['VECTOR', 'ORACLE', 'HALCYON', 'PRISM', 'WARDEN', 'CIPHER', 'TALLY', 'MERIDIAN'];
  let made = 0;
  while (App.crewCount() < ${n} && made < 20) {
    const nm = want[made % want.length];
    try { App.summonAgent({ name: nm, agentName: nm, role: 'specialist' }, { activate: false, desk: false }); } catch (e) { return 'throw:' + e.message; }
    made++;
  }
  return App.crewCount();
})()`;

const MEASURE = `(() => {
  const ul = document.getElementById('crew');
  const rows = [...ul.querySelectorAll('.crew-row')];
  const win = ul.clientHeight;
  const bottoms = rows.map(r => (r.offsetTop - ul.offsetTop) + r.offsetHeight);
  let whole = 0;
  for (const b of bottoms) { if (b <= win + 0.5) whole++; else break; }
  const nextTop = rows[whole] ? (rows[whole].offsetTop - ul.offsetTop) : null;
  return {
    agents: rows.length,
    wholeRowsVisible: whole,
    slicedRowPx: nextTop === null ? 0 : Math.max(0, Math.round((win - nextTop) * 10) / 10),
    // the flush test that matters: the window ends EXACTLY under a row, +/- a rounding px
    flushGapPx: whole ? Math.round((win - bottoms[whole - 1]) * 10) / 10 : null,
    cap: getComputedStyle(ul).maxHeight,
    scrollbarPx: ul.offsetWidth - ul.clientWidth,
    canScroll: ul.scrollHeight - ul.clientHeight,
    workingRows: rows.filter(r => r.classList.contains('working')).length,
    zoom: (typeof U !== 'undefined' && U.elZoom) ? Math.round(U.elZoom(ul) * 1000) / 1000 : 1,
  };
})()`;

// A: scroll to the bottom and report which agent is last fully in view.
const SCROLL_END = `(() => {
  const ul = document.getElementById('crew');
  ul.scrollTop = ul.scrollHeight;
  const rows = [...ul.querySelectorAll('.crew-row')];
  const r = ul.getBoundingClientRect();
  const seen = rows.filter(x => { const b = x.getBoundingClientRect(); return b.top >= r.top - 1 && b.bottom <= r.bottom + 1; })
                   .map(x => (x.querySelector('.crew-name') || {}).textContent.trim());
  return { scrollTop: Math.round(ul.scrollTop), atEnd: Math.abs(ul.scrollTop + ul.clientHeight - ul.scrollHeight) < 1.5, visible: seen };
})()`;

// B: put two agents into a live run — crewTick adds .working, which grows the in-flight bar.
const START_RUNS = `(() => {
  const ids = App.agents().slice(0, 2).map(a => a.id);
  window.__runIds = ids;
  ids.forEach(id => U.bus.emit('agent.run.start', { agentId: id }));
  return ids;
})()`;

// B2: END them and sample ACROSS the collapse. The bar animates (motion.css --t-med 220ms), so a
// window that only re-measures once lands mid-flight and shows a sliver of the next agent. Every
// sample here must read slicedRowPx 0 — this is the frame-by-frame follow's whole reason to exist.
const END_RUNS_AND_SAMPLE = `(async () => {
  const ul = document.getElementById('crew');
  const read = () => {
    const rows = [...ul.querySelectorAll('.crew-row')];
    const win = ul.clientHeight;
    const bottoms = rows.map(r => (r.offsetTop - ul.offsetTop) + r.offsetHeight);
    let whole = 0;
    for (const b of bottoms) { if (b <= win + 0.5) whole++; else break; }
    const nextTop = rows[whole] ? (rows[whole].offsetTop - ul.offsetTop) : null;
    return { whole: whole, sliced: nextTop === null ? 0 : Math.max(0, Math.round((win - nextTop) * 10) / 10), working: rows.filter(r => r.classList.contains('working')).length };
  };
  const out = [read()];
  (window.__runIds || []).forEach(id => U.bus.emit('agent.run.end', { agentId: id }));
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 45));
    out.push(read());
  }
  return { samples: out, worstSliced: Math.max(...out.map(s => s.sliced)) };
})()`;

// C: drive the REAL dial. applySettings isn't exported and writing body.style.zoom by hand does not
// stick (the next applySettings re-derives it from store.settings, which localStorage does not
// reach) — so click the actual TEXT SIZE chip in Settings ▸ APPEARANCE, which is the only honest
// way to reach the zoom + --sn-unzoom pair a Commander actually produces.
const OPEN_SETTINGS = `(() => {
  if (typeof StationUI === 'undefined' || !StationUI.openTerm) return 'no-stationui';
  StationUI.openTerm('settings');
  return document.querySelector('#set-textsize') ? 'open' : 'opened-no-chips';
})()`;

const setTextSize = (pct) => `(() => {
  const chip = document.querySelector('#set-textsize [data-ts="${pct}"]');
  if (!chip) return 'no-chip-' + [...document.querySelectorAll('#set-textsize [data-ts]')].map(c => c.dataset.ts).join('/');
  chip.click();
  return { zoom: document.body.style.zoom || 'none', unzoom: document.body.style.getPropertyValue('--sn-unzoom') || 'none' };
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'crewstress-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const report = [];
  const say = (k, v) => report.push(k + ': ' + JSON.stringify(v));
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    say('roster', await evalJS(cdp, SUMMON(7)));
    await sleep(1200);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(900);
    say('rest', await evalJS(cdp, MEASURE));
    await capture(cdp, OUT, 'stress-1-rest');

    // A — scroll
    say('A scrolled-to-end', await evalJS(cdp, SCROLL_END));
    await capture(cdp, OUT, 'stress-2-scrolled');
    await evalJS(cdp, `document.getElementById('crew').scrollTop = 0`);
    await sleep(300);

    // B — working rows grow
    say('B runs started', await evalJS(cdp, START_RUNS));
    await sleep(900);
    say('B working', await evalJS(cdp, MEASURE));
    await capture(cdp, OUT, 'stress-3-working');
    say('B across the collapse', await evalJS(cdp, END_RUNS_AND_SAMPLE));
    await sleep(600);
    say('B settled', await evalJS(cdp, MEASURE));

    // C — TEXT SIZE. Measured three times per step: right after the click, after it settles, and
    // after a forced resize — so a stale cap tells us WHICH trigger is missing rather than just
    // that one is.
    say('C settings', await evalJS(cdp, OPEN_SETTINGS));
    await sleep(1200);
    for (const pct of [130, 90, 100]) {
      say('C setTextSize ' + pct, await evalJS(cdp, setTextSize(pct)));
      await sleep(1400);
      say('C ' + pct + ' t+1.4s', await evalJS(cdp, MEASURE));
      await sleep(3000);
      say('C ' + pct + ' t+4.4s', await evalJS(cdp, MEASURE));
      await evalJS(cdp, `window.dispatchEvent(new Event('resize'))`);
      await sleep(600);
      say('C ' + pct + ' after forced resize', await evalJS(cdp, MEASURE));
      await capture(cdp, OUT, 'stress-4-text' + pct);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  } catch (e) {
    report.push('ERROR: ' + (e && e.stack || e));
  } finally {
    try { writeFileSync(join(OUT, 'stress-report.txt'), report.join('\n') + '\n'); } catch {}
    console.log(report.join('\n'));
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}
main();
