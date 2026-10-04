#!/usr/bin/env node
/* dev/connect-beat-probe.mjs — LIVE PROOF for the tutorial's "Connect your world" beat (lane 2).
   Seeds a dossier GOAL mentioning email + website, runs the tour's skip path, captures the beat's chips,
   clicks the gmail chip and proves ABILITIES opened on the CATALOG with the gmail card flashed — and that
   the FIRST STEPS connector step did NOT flip from the click. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9731';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9732);
const URL = `http://127.0.0.1:${PORT}/`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'connbeat-'));
  const ws = join(scratch, 'ws');
  materializeSeedWorkspace(ws);
  const side = bootSeededSidecar({ port: PORT, scratchDir: ws });
  let chrome = null, cdp = null; const out = {};
  try {
    if (!(await waitUp(URL))) throw new Error('sidecar never came up');
    chrome = launchChrome({ cdpPort: CDP_PORT, win: '1600,1000', profileDir: join(scratch, 'chrome') });
    await sleep(1200);
    cdp = await connectCDP(CDP_PORT);
    await cdp.send('Runtime.enable');
    await evalJS(cdp, `location.href = ${JSON.stringify(URL)}`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('never reached game');
    await sleep(2500);
    // seed the goal + reset the tutorial key, then reload so Tutorial boots cold
    await evalJS(cdp, `(() => {
      DossierStore.upsert('goals', { text: 'run my email newsletter and grow the website', source: 'commander' });
      localStorage.removeItem('starnet.tutorial.v1');
      location.reload(); return 1; })()`);
    if (!(await waitDevReady(cdp, evalJS, { url: URL }))) throw new Error('never came back');
    await sleep(2500);
    out.goals = await evalJS(cdp, `DossierStore.beliefs('goals').map(b => b.text)`);
    out.stateBefore = await evalJS(cdp, `JSON.stringify(Tutorial._state().brief)`);
    await evalJS(cdp, `Tutorial.firstCommand({ name: 'NOVA' })`);
    for (let i = 0; i < 30; i++) {   // the dialogue types its line before the options land
      await sleep(500);
      out.skipClick = await evalJS(cdp, `(() => { const b = [...document.querySelectorAll('button')].find(x => /dive in myself/i.test(x.textContent||'')); if (!b) return 'no skip button'; b.click(); return 'clicked'; })()`);
      if (out.skipClick === 'clicked') break;
    }
    // finishUp(true) → 900ms → beatConnect types its line, then the chips land
    let beat = null;
    for (let i = 0; i < 30 && !beat; i++) {
      await sleep(500);
      beat = await evalJS(cdp, `(() => { const r = document.querySelector('.choice-row.comms-connect-beat'); if (!r) return null;
        return { html: r.outerHTML, ids: [...r.querySelectorAll('.choice')].map(b => ({ label: b.textContent, id: b.dataset.connector || null })) }; })()`);
    }
    out.beat = beat;
    if (!beat) throw new Error('connect beat never rendered');
    out.lastAgentLine = await evalJS(cdp, `(() => { const m = [...document.querySelectorAll('.cmsg.agent .body')].pop(); return m ? m.textContent : null; })()`);
    // the step must NOT flip from the click
    await evalJS(cdp, `(() => { const b = document.querySelector('.choice-row.comms-connect-beat .choice[data-connector="gmail"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); return 1; })()`);
    await sleep(2500);
    out.afterClick = await evalJS(cdp, `(() => {
      const t = [...document.querySelectorAll('#terms .term')].find(w => /ABILITIES/i.test(w.textContent||''));
      const card = t && t.querySelector('.cc-card[data-id="gmail"]');
      const catTab = t && t.querySelector('#con-tab-connectors-catalog');
      return { abilitiesOpen: !!t, catalogTabSelected: catTab ? (catTab.className + ' aria=' + catTab.getAttribute('aria-selected')) : null,
        gmailCard: card ? { cls: card.className, visible: !card.hidden && card.offsetHeight > 0 } : null,
        beatGone: !document.querySelector('.choice-row.comms-connect-beat'),
        brief: JSON.stringify(Tutorial._state().brief), connectOffered: Tutorial._state().connectOffered };
    })()`);
    out.connectorsReadback = await evalJS(cdp, `fetch('/api/connectors').then(r => r.json()).then(j => (j.connectors||[]).map(c => c.id + ':' + c.state))`);
    out.errors = await evalJS(cdp, `(window.__errs || []).length`);
  } finally {
    writeFileSync(join(process.cwd(), 'dev', 'connect-beat-probe.out.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    try { if (cdp) cdp.close(); } catch {}
    try { if (chrome) chrome.kill(); } catch {}
    try { side.kill(); } catch {}
  }
}
setTimeout(() => { console.error('WATCHDOG: 240s'); process.exit(2); }, 240000).unref();
main().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
