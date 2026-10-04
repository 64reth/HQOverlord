#!/usr/bin/env node
/* dev/dossier-check.mjs — post-change verification for the AGENT DOSSIER UX pass.
   Proves: (1) the shell no longer moves between tabs, (2) every section mounted its content,
   (3) BRIEF's setup rows really land on their CONFIG card. */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9620';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9621);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = join(process.cwd(), 'dev', '.shots-dossier-check');
const TABS = ['brief', 'growth', 'record', 'memory', 'config'];

function seedCrew(wsDir) {
  const p = join(wsDir, 'agent.save.json');
  const w = JSON.parse(readFileSync(p, 'utf8'));
  const d = w.doc;
  d.agent.stats = { xp: 640, level: 4, lifetimeXp: 640, confidence: 78, samples: 9,
    counters: { runs: 23, positiveFeedback: 7 }, milestones: ['first_run', 'ten_runs'] };
  const mk = (id, name, color, purpose, stats) => ({ id, name, color, model: '', personaId: 'professional',
    purpose, specialtyId: null, createdAt: Date.now() - 86400000 * 9,
    docs: { identity: name + ' is a specialist.', purpose, manual: '', context: '' }, stats });
  d.agents = [
    mk('a_scribe', 'SCRIBE', '#ffd166', 'Draft and edit written work.', { xp: 210, level: 2, lifetimeXp: 210, confidence: 61, samples: 5, counters: { runs: 8 }, milestones: [] }),
    mk('a_ledger', 'LEDGER', '#8affc1', 'Track numbers and spend.', { xp: 40, level: 1, lifetimeXp: 40, confidence: 50, samples: 1, counters: { runs: 2 }, milestones: [] }),
    mk('a_probe', 'PROBE', '#ff8ad0', 'Research the open web.', { xp: 0, level: 1, lifetimeXp: 0, confidence: 50, samples: 0, counters: {}, milestones: [] })
  ];
  writeFileSync(p, JSON.stringify(w, null, 2));
}

const WIN = `[...document.querySelectorAll('.term')].find(t => /AGENT DOSSIER/i.test(t.textContent||''))`;
const MEASURE = `(() => {
  const w = ${WIN}; if (!w) return { err: 'no window' };
  const r = w.getBoundingClientRect();
  const strip = w.querySelector('.con-toptabs');
  const sec = w.querySelector('.con-sec:not(.con-sec-hidden)');
  const pane = w.querySelector('.con-pane');
  return { winTop: Math.round(r.top), winH: Math.round(r.height),
    stripTop: strip ? Math.round(strip.getBoundingClientRect().top) : null,
    sec: sec ? { id: sec.dataset.section, scrollH: Math.round(sec.scrollHeight),
      controls: sec.querySelectorAll('button,input,textarea,select').length,
      words: (sec.textContent||'').trim().split(/\\s+/).length } : null,
    paneScrollH: pane ? Math.round(pane.scrollHeight) : null };
})()`;
const pick = (id) => `(() => { const t = document.querySelector('#con-tab-agents-' + ${JSON.stringify(id)}); if (!t) return 'missing'; t.click(); return 'ok'; })()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'doscheck-'));
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
    mkdirSync(OUT, { recursive: true });
    await evalJS(cdp, `StationUI.openAgent(0)`);
    await sleep(1600);

    // TAB ORDER is a deliberate choice (Andrew: GROWTH belongs right after BRIEF), so assert the RENDERED
    // order rather than assuming the array reached the DOM — this reads the strip, not the source.
    const order = await evalJS(cdp, `[...${WIN}.querySelectorAll('.con-toptab')].map(t => t.dataset.section)`);
    console.log('TAB ORDER:', JSON.stringify(order), 'expected', JSON.stringify(TABS),
      JSON.stringify(order) === JSON.stringify(TABS) ? 'OK' : '*** MISMATCH ***');

    const rows = [];
    for (const id of TABS) { await evalJS(cdp, pick(id)); await sleep(800); rows.push({ tab: id, ...(await evalJS(cdp, MEASURE)) }); }
    console.log('PER-TAB:', JSON.stringify(rows));
    const strips = rows.map(r => r.stripTop);
    console.log('STRIP TOP SPREAD:', Math.max(...strips) - Math.min(...strips), 'px', JSON.stringify(strips));

    // RECORD really contains BOTH former tabs, and both are reachable without a scroll hunt
    await evalJS(cdp, pick('record')); await sleep(900);
    console.log('RECORD has both lanes:', await evalJS(cdp, `(() => { const w = ${WIN}; return !!w.querySelector('#rw-list') && !!w.querySelector('#lb-list'); })()`));
    console.log('RECORD jump row:', await evalJS(cdp, `(() => { const w = ${WIN}; return [...w.querySelectorAll('.con-sec:not(.con-sec-hidden) [data-secjump]')].map(b => b.textContent); })()`));
    await capture(cdp, OUT, 'record-top');
    // click RESTORE POINTS in the jump row and prove the restore list lands in view
    const rec = await evalJS(cdp, `(() => {
      const w = ${WIN};
      const b = [...w.querySelectorAll('[data-secjump]')].find(x => /RESTORE/i.test(x.textContent));
      if (!b) return 'no button'; b.click(); return 'clicked';
    })()`);
    await sleep(900);
    console.log('RESTORE jump:', rec, await evalJS(cdp, `(() => {
      const w = ${WIN}; const pane = w.querySelector('.con-pane'); const list = w.querySelector('#rw-list');
      if (!pane || !list) return { err: 'missing' };
      const lr = list.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      return { offsetFromPaneTop: Math.round(lr.top - pr.top), visible: lr.top >= pr.top - 2 && lr.top < pr.bottom };
    })()`));
    await capture(cdp, OUT, 'record-restore');

    // CONFIG group rules present
    await evalJS(cdp, pick('config')); await sleep(900);
    console.log('CONFIG groups:', await evalJS(cdp, `(() => { const w = ${WIN}; return [...w.querySelectorAll('.cf-grp .sec-l')].map(e => e.textContent); })()`));
    console.log('PER-AGENT badges left:', await evalJS(cdp, `(() => { const w = ${WIN}; return [...w.querySelectorAll('.cf-badge')].filter(b => /PER-AGENT/.test(b.textContent)).length; })()`));

    // the setup-strip jump actually scrolls to the card
    await evalJS(cdp, pick('brief')); await sleep(800);
    const jump = await evalJS(cdp, `(() => {
      const w = ${WIN};
      const row = [...w.querySelectorAll('.ag-setup-row')].find(r => /APPROVAL/.test(r.textContent));
      if (!row) return 'no row';
      row.click(); return 'clicked';
    })()`);
    await sleep(1200);
    const landed = await evalJS(cdp, `(() => {
      const w = ${WIN}; const pane = w.querySelector('.con-pane'); const card = w.querySelector('#ag-approval-card');
      if (!card || !pane) return { err: 'missing' };
      const cr = card.getBoundingClientRect(), pr = pane.getBoundingClientRect();
      return { section: (w.querySelector('.con-sec:not(.con-sec-hidden)')||{}).dataset?.section,
        offsetFromPaneTop: Math.round(cr.top - pr.top), visible: cr.top >= pr.top - 2 && cr.top < pr.bottom };
    })()`);
    console.log('JUMP:', jump, JSON.stringify(landed));
    await capture(cdp, OUT, 'jump-landed');

    // no leaked spec letters anywhere in the dossier
    await evalJS(cdp, pick('growth')); await sleep(900);
    console.log('gx-ref chips:', await evalJS(cdp, `(() => { const w = ${WIN}; return [...w.querySelectorAll('.gx-ref, .gx-station .badge')].map(e => e.textContent); })()`));
    await capture(cdp, OUT, 'growth-top');
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions).slice(0, 800));
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
    setTimeout(() => process.exit(0), 400);
  }
}
main().catch(e => { console.error('CHECK FAILED:', e.message); process.exit(1); });
