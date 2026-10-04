#!/usr/bin/env node
/* dev/dossier-shots.mjs — shoot every pane of the AGENT DOSSIER so a UX pass judges PIXELS.

   Seeds a station with a realistic CREW (4 agents, varied levels/specialties), opens the
   dossier, and captures each section: BRIEF · GROWTH · MEMORY · SKILLS · CONFIG · LOGBOOK ·
   RESTORE, plus a scrolled-down CONFIG (the long tail nobody sees) and the search state.

     node dev/dossier-shots.mjs        (ports: SKYNET_SHOT_PORT / SKYNET_CDP_PORT) */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9612';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9613);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = process.env.SKYNET_SHOT_OUT || join(process.cwd(), 'dev', '.shots-dossier');

// a realistic crew: the overseer plus three specialists at different levels
function seedCrew(wsDir) {
  const p = join(wsDir, 'agent.save.json');
  const w = JSON.parse(readFileSync(p, 'utf8'));
  const d = w.doc;
  d.agent.stats = { xp: 640, level: 4, lifetimeXp: 640, confidence: 78, samples: 9,
    counters: { runs: 23, positiveFeedback: 7 }, milestones: ['first_run', 'ten_runs'] };
  const mk = (id, name, color, purpose, skin, stats) => ({
    id, name, color, skin, model: '', personaId: 'professional',
    purpose, specialtyId: null, createdAt: Date.now() - 86400000 * 9, docs: {
      identity: name + ' is a specialist aboard the station.',
      purpose, manual: '', context: ''
    }, stats
  });
  d.agents = [
    mk('a_scribe', 'SCRIBE', '#ffd166', 'Draft and edit written work — briefs, posts, and outreach.', undefined,
      { xp: 210, level: 2, lifetimeXp: 210, confidence: 61, samples: 5, counters: { runs: 8, positiveFeedback: 3 }, milestones: ['first_run'] }),
    mk('a_ledger', 'LEDGER', '#8affc1', 'Track numbers, reconcile spend, and flag anything odd.', undefined,
      { xp: 40, level: 1, lifetimeXp: 40, confidence: 50, samples: 1, counters: { runs: 2 }, milestones: [] }),
    mk('a_probe', 'PROBE', '#ff8ad0', 'Research the open web and bring back sourced answers.', undefined,
      { xp: 0, level: 1, lifetimeXp: 0, confidence: 50, samples: 0, counters: {}, milestones: [] })
  ];
  writeFileSync(p, JSON.stringify(w, null, 2));
}

const OPEN_DOSSIER = `(() => {
  if (typeof StationUI === 'undefined') return 'no-stationui';
  if (StationUI.openAgent) { StationUI.openAgent(0); return 'opened'; }
  const b = document.querySelector('[data-term="agents"]'); if (b) { b.click(); return 'clicked'; }
  return 'no-door';
})()`;

const pickTab = (id) => `(() => {
  const t = document.querySelector('#con-tab-agents-' + ${JSON.stringify(id)});
  if (!t) return 'missing:' + ${JSON.stringify(id)};
  t.click(); return 'ok';
})()`;

const TABS = `(() => [...document.querySelectorAll('.con-toptab')].map(t => t.dataset.section))()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'dossier-'));
  const ws = join(scratch, 'ws');
  materializeSeedWorkspace(ws);
  seedCrew(ws);
  const side = bootSeededSidecar({ port: PORT, scratchDir: ws });
  let chrome = null, cdp = null;
  const notes = [];
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up on ' + URL);
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1600,1060', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never reached the game screen');
    await sleep(1800);
    mkdirSync(OUT, { recursive: true });

    await evalJS(cdp, `(() => {
      const KEY = 'starnet.station.v1';
      const r = JSON.parse(localStorage.getItem(KEY) || '{"v":1}');
      r.settings = Object.assign({}, r.settings, { textScale: 100 });
      localStorage.setItem(KEY, JSON.stringify(r));
      location.reload(); return 'reloading';
    })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('app never came back after reload');
    await sleep(2000);

    notes.push('open: ' + await evalJS(cdp, OPEN_DOSSIER));
    await sleep(1600);
    notes.push('roster: ' + await evalJS(cdp, `document.querySelectorAll('.ag-item').length`));
    notes.push('tabs: ' + JSON.stringify(await evalJS(cdp, TABS)));
    await capture(cdp, OUT, '01-brief');

    for (const id of ['record', 'memory', 'growth', 'config']) {
      const r = await evalJS(cdp, pickTab(id));
      notes.push('tab ' + id + ': ' + r);
      if (r !== 'ok') continue;
      await sleep(1200);
      await capture(cdp, OUT, '0' + (2 + ['record', 'memory', 'growth', 'config'].indexOf(id)) + '-' + id);
    }

    // the CONFIG long tail — scroll to the bottom of the pane
    await evalJS(cdp, pickTab('config'));
    await sleep(900);
    for (const n of [1, 2, 3]) {
      await evalJS(cdp, `(() => { const p = document.querySelector('#term-agents .con-pane') || document.querySelector('.con-pane'); if (!p) return 'no-pane'; p.scrollTop += p.clientHeight * 0.9; return p.scrollTop + '/' + p.scrollHeight; })()`);
      await sleep(600);
      await capture(cdp, OUT, '1' + n + '-config-scroll' + n);
    }

    // GROWTH long tail too
    await evalJS(cdp, pickTab('growth'));
    await sleep(900);
    await evalJS(cdp, `(() => { const p = document.querySelector('#term-agents .con-pane') || document.querySelector('.con-pane'); if (p) p.scrollTop = p.scrollHeight; return 1; })()`);
    await sleep(600);
    await capture(cdp, OUT, '14-growth-bottom');

    // pane metrics — how tall is each section really
    const metrics = await evalJS(cdp, `(() => {
      const out = {};
      document.querySelectorAll('#term-agents .con-sec, .con-sec').forEach(s => {
        const id = s.dataset.section; if (!id) return;
        const was = s.classList.contains('con-sec-hidden');
        if (was) s.classList.remove('con-sec-hidden');
        out[id] = { h: Math.round(s.scrollHeight), controls: s.querySelectorAll('button,input,textarea,select').length };
        if (was) s.classList.add('con-sec-hidden');
      });
      const p = document.querySelector('#term-agents .con-pane') || document.querySelector('.con-pane');
      out.__pane = p ? { h: Math.round(p.clientHeight), w: Math.round(p.clientWidth) } : null;
      const w = document.querySelector('#term-agents'); out.__win = w ? { w: Math.round(w.offsetWidth), h: Math.round(w.offsetHeight) } : null;
      return out;
    })()`);
    notes.push('METRICS: ' + JSON.stringify(metrics));

    console.log('NOTES:\\n' + notes.join('\\n'));
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions).slice(0, 900));
    console.log('SHOTS IN:', OUT);
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
  }
}
main().catch(e => { console.error('DOSSIER SHOTS FAILED:', e.message); process.exit(1); });
