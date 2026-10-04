#!/usr/bin/env node
/* dev/crew-fit-probe.mjs — measure the CREW rail's roster window against a real multi-agent
   station, and shoot it. The complaint this exists for: the roster cuts mid-row, so the second
   agent is sliced in half and the list reads as broken rather than scrollable.

   It boots a seeded sidecar, summons crew until the roster is 6 deep, then reports for a set of
   window heights: how tall #crew actually is, how many rows fit WHOLE, and how many pixels of
   the first partly-hidden row are showing (>0 = a sliced row = the bug).

     node dev/crew-fit-probe.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT) */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9518';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9519);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-crew-fit');
const TAG = process.env.SKYNET_PROBE_TAG || 'run';

// Summon real crew through the SAME door the Recruitment Bay uses, so the rows measured are the
// rows a Commander actually gets (name length, level chip, status line and all).
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

// A REAL rail also carries sessions. That matters: #ws-wrap only steals from the roster once its
// own content overflows the column, which is exactly the state a used station is always in.
const SESSIONS = (n) => `(() => {
  const btn = document.getElementById('ws-new');
  if (!btn) return 'no-btn';
  for (let i = 0; i < ${n}; i++) btn.click();
  return document.querySelectorAll('#workstreams .ws-row').length;
})()`;

// THE measurement. Everything below lives in one zoom context (#left and its children are plain
// body descendants), so offsetTop/offsetHeight are directly comparable to the CSS px we cap with.
const MEASURE = `(() => {
  const ul = document.getElementById('crew');
  const left = document.getElementById('left');
  const sum = document.getElementById('crew-sum');
  const ws = document.getElementById('ws-wrap');
  if (!ul || !left) return { err: 'no rail' };
  const rows = [...ul.querySelectorAll('.crew-row')];
  const win = ul.clientHeight;              // the visible roster window (content box)
  const padTop = parseFloat(getComputedStyle(ul).paddingTop) || 0;
  // each row's bottom edge measured from the top of the list's scrollable content
  const bottoms = rows.map(r => (r.offsetTop - ul.offsetTop) + r.offsetHeight);
  let whole = 0;
  for (const b of bottoms) { if (b <= win + 0.5) whole++; else break; }
  const nextTop = rows[whole] ? (rows[whole].offsetTop - ul.offsetTop) : null;
  // pixels of the first NOT-fully-visible row that are still painted (the "sliced row" signature)
  const sliver = nextTop === null ? 0 : Math.max(0, Math.round((win - nextTop) * 10) / 10);
  return {
    agents: rows.length,
    railH: left.clientHeight,
    crewH: Math.round(ul.getBoundingClientRect().height * 10) / 10,
    crewWindow: Math.round(win * 10) / 10,
    rowHeights: bottoms.map((b, i) => Math.round((b - (i ? bottoms[i - 1] : padTop)) * 10) / 10),
    wholeRowsVisible: whole,
    slicedRowPx: sliver,
    scrollable: ul.scrollHeight > ul.clientHeight + 1,
    sumH: sum ? Math.round(sum.getBoundingClientRect().height) : 0,
    wsH: ws ? Math.round(ws.getBoundingClientRect().height) : 0,
    cap: getComputedStyle(ul).maxHeight,
  };
})()`;

const HEIGHTS = [1040, 900, 780, 660];

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'crewfit-'));
  materializeSeedWorkspace(join(scratch, 'ws'));
  const side = bootSeededSidecar({ port: PORT, scratchDir: join(scratch, 'ws') });
  let chrome = null, cdp = null;
  const report = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1440,1040', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1500);
    mkdirSync(OUT, { recursive: true });

    const summoned = await evalJS(cdp, SUMMON(6));
    report.push('roster after summon: ' + JSON.stringify(summoned));
    await sleep(1200);
    const sessions = await evalJS(cdp, SESSIONS(12));
    report.push('sessions on the rail: ' + JSON.stringify(sessions));
    await sleep(1200);

    for (const h of HEIGHTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1440, height: h, deviceScaleFactor: 1, mobile: false,
      });
      await sleep(900);
      const m = await evalJS(cdp, MEASURE);
      report.push(`viewport ${1440}x${h}: ` + JSON.stringify(m));
      await capture(cdp, OUT, `${TAG}-h${h}`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  } catch (e) {
    report.push('ERROR: ' + (e && e.stack || e));
  } finally {
    try { writeFileSync(join(OUT, `${TAG}-report.txt`), report.join('\n') + '\n'); } catch {}
    console.log(report.join('\n'));
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}
main();
