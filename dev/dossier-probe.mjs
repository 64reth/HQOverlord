#!/usr/bin/env node
/* dev/dossier-probe.mjs — MEASURE the AGENT DOSSIER instead of eyeballing it.
   Per section: the window rect, the tab-strip Y, pane scrollHeight, control count.
   Proves (or kills) the "the window jumps every time I click a tab" hypothesis. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9616';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9617);
const URL = `http://127.0.0.1:${PORT}/`;

function seedCrew(wsDir) {
  const p = join(wsDir, 'agent.save.json');
  const w = JSON.parse(readFileSync(p, 'utf8'));
  const d = w.doc;
  d.agent.stats = { xp: 640, level: 4, lifetimeXp: 640, confidence: 78, samples: 9,
    counters: { runs: 23, positiveFeedback: 7 }, milestones: ['first_run', 'ten_runs'] };
  const mk = (id, name, color, purpose, stats) => ({
    id, name, color, model: '', personaId: 'professional', purpose, specialtyId: null,
    createdAt: Date.now() - 86400000 * 9,
    docs: { identity: name + ' is a specialist.', purpose, manual: '', context: '' }, stats });
  d.agents = [
    mk('a_scribe', 'SCRIBE', '#ffd166', 'Draft and edit written work.', { xp: 210, level: 2, lifetimeXp: 210, confidence: 61, samples: 5, counters: { runs: 8 }, milestones: [] }),
    mk('a_ledger', 'LEDGER', '#8affc1', 'Track numbers and spend.', { xp: 40, level: 1, lifetimeXp: 40, confidence: 50, samples: 1, counters: { runs: 2 }, milestones: [] }),
    mk('a_probe', 'PROBE', '#ff8ad0', 'Research the open web.', { xp: 0, level: 1, lifetimeXp: 0, confidence: 50, samples: 0, counters: {}, milestones: [] })
  ];
  writeFileSync(p, JSON.stringify(w, null, 2));
}

const MEASURE = `(() => {
  const w = [...document.querySelectorAll('.term')].find(t => /AGENT DOSSIER/i.test(t.textContent||''));
  if (!w) return { err: 'no window' };
  const r = w.getBoundingClientRect();
  const strip = w.querySelector('.con-toptabs');
  const sr = strip ? strip.getBoundingClientRect() : null;
  const pane = w.querySelector('.con-pane');
  const active = w.querySelector('.con-sec:not(.con-sec-hidden)');
  return {
    win: { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) },
    stripTop: sr ? Math.round(sr.top) : null,
    pane: pane ? { clientH: Math.round(pane.clientHeight), scrollH: Math.round(pane.scrollHeight) } : null,
    sec: active ? { id: active.dataset.section, scrollH: Math.round(active.scrollHeight),
      controls: active.querySelectorAll('button,input,textarea,select').length,
      cards: active.querySelectorAll('.cf-card, .cf').length,
      words: (active.textContent||'').trim().split(/\\s+/).length } : null
  };
})()`;

const pickTab = (id) => `(() => { const t = document.querySelector('#con-tab-agents-' + ${JSON.stringify(id)}); if (!t) return 'missing'; t.click(); return 'ok'; })()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'dosprobe-'));
  const ws = join(scratch, 'ws');
  materializeSeedWorkspace(ws); seedCrew(ws);
  const side = bootSeededSidecar({ port: PORT, scratchDir: ws });
  let chrome = null, cdp = null;
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up');
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1600,1060', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    const diag = collectDiagnostics(cdp);
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('never reached game');
    await sleep(2000);
    await evalJS(cdp, `(() => { const K='starnet.station.v1'; const r=JSON.parse(localStorage.getItem(K)||'{"v":1}'); r.settings=Object.assign({},r.settings,{textScale:100}); localStorage.setItem(K,JSON.stringify(r)); location.reload(); return 1; })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('never came back');
    await sleep(2000);
    await evalJS(cdp, `StationUI.openAgent(0)`);
    await sleep(1600);

    const rows = [];
    for (const id of ['brief', 'growth', 'memory', 'skills', 'config', 'logbook', 'restore']) {
      await evalJS(cdp, pickTab(id));
      await sleep(900);
      rows.push({ tab: id, ...(await evalJS(cdp, MEASURE)) });
    }
    console.log(JSON.stringify(rows, null, 1));

    // overlap check on RESTORE: does any text box intersect the REFRESH button?
    await evalJS(cdp, pickTab('restore'));
    await sleep(700);
    const overlap = await evalJS(cdp, `(() => {
      const w = [...document.querySelectorAll('.term')].find(t => /AGENT DOSSIER/i.test(t.textContent||'')); if (!w) return 'no win';
      const sec = w.querySelector('.con-sec:not(.con-sec-hidden)');
      const els = [...sec.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent||'').trim());
      const hits = [];
      for (let i = 0; i < els.length; i++) for (let j = i+1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        if (!a.width || !b.width) continue;
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const ox = Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const oy = Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if (ox > 4 && oy > 4) hits.push({ a: (els[i].textContent||'').trim().slice(0,40), b: (els[j].textContent||'').trim().slice(0,40), ox: Math.round(ox), oy: Math.round(oy) });
      }
      return hits.slice(0, 12);
    })()`);
    console.log('RESTORE OVERLAPS:', JSON.stringify(overlap, null, 1));
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions).slice(0, 600));
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
    setTimeout(() => process.exit(0), 500);
  }
}
main().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
