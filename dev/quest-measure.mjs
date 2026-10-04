/* dev/quest-measure.mjs — measure the QUEST LOG grid as the browser actually computes it.
   A screenshot can tell you "two columns"; only the computed style tells you WHICH rule won. Dev-only. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { launchChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.shots-quest-measure');
const PORT = process.env.SKYNET_PORT || '8741';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9786);

const MEASURE = `(async () => {
  StationUI.openTerm('quests');
  await new Promise(r => setTimeout(r, 2200));
  const win = [...document.querySelectorAll('.term')].find(t => /QUEST LOG/.test(t.textContent));
  (win.getAnimations ? win.getAnimations() : []).forEach(a => { try { a.finish(); } catch (_) {} });
  const grid = document.querySelector('.q-open.q-grid');
  const body = win.querySelector('.term-body') || win;
  const gcs = getComputedStyle(grid);
  const card = grid.querySelector('.q-card');
  const zoom = (typeof U !== 'undefined' && U.uiZoom) ? U.uiZoom() : 1;
  // LEFT/RIGHT EDGE AUDIT — every top-level block in the panel should share one column. Rects are visual
  // px and all measured in the same frame, so comparing them to each other is valid (we never convert).
  const edge = sel => { const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) }; };
  const edges = {
    directionSec: edge('.q-refresh-sec'), directionCard: edge('.q-refresh-card'),
    openSec: edge('.gx-quests .gx-sec:nth-of-type(2)'), lede: edge('.q-lede'),
    grid: edge('.q-open.q-grid'), firstCard: edge('.q-open .q-card'),
    journeyCard: edge('.q-journey-card'), meterSec: edge('.gx-quests .gx-sec')
  };
  return JSON.stringify({
    edges,
    winWidth: getComputedStyle(win).width,
    bodyWidth: getComputedStyle(body).width,
    gridWidth: gcs.width,
    columns: gcs.gridTemplateColumns,
    columnCount: gcs.gridTemplateColumns.split(' ').filter(Boolean).length,
    cardWidth: card ? getComputedStyle(card).width : null,
    cardTitleSize: card ? getComputedStyle(card.querySelector('.nm')).fontSize : null,
    uiZoom: zoom
  });
})()`;

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const { proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,980', profileDir: join(OUT, '_chrome') });
  try {
    await sleep(1800);
    const cdp = await connectCDP(CDP_PORT);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 200);'
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT });
    await sleep(9000);
    console.log('measure ->', await evalJS(cdp, MEASURE));
  } finally { try { proc.kill(); } catch (_) {} }
})();
