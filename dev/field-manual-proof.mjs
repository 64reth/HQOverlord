// Real seeded station: chapter navigation, destinations, keyboard focus and responsive layout.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchChrome, connectCDP, evalJS, collectDiagnostics, capture, sleep } from '../scripts/lib/cdp.mjs';
import { waitDevReady } from '../scripts/lib/seed.mjs';

const url = 'http://127.0.0.1:' + (process.env.MANUAL_PORT || '9216');
const out = resolve('dev/.scratch-workspace/manual-proof');
mkdirSync(out, { recursive: true });
const { proc } = launchChrome({ cdpPort: 9616, profileDir: resolve(out, 'chrome') });
let cdp;
const receipt = { chapters: [], destinations: [] };
try {
  cdp = await connectCDP(9616);
  const diag = collectDiagnostics(cdp);
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });
  assert(await waitDevReady(cdp, evalJS, { url }), 'station did not enter game');
  const ev = expression => evalJS(cdp, expression);
  const click = async selector => { await ev(`document.querySelector(${JSON.stringify(selector)}).click()`); await sleep(500); };
  const open = async () => {
    await click('.bb-grp[data-hint="system"]');
    await click('[data-term="manual"]');
    assert(await ev(`!!document.querySelector('.fm-body')?.offsetWidth`), 'manual visible');
  };
  await open();
  assert(await ev(`document.querySelector('.fm-content').textContent.includes('Turn rough notes into a plan')`));
  const chapters = await ev(`Array.from(document.querySelectorAll('.fm-tab[data-t]'), b => b.dataset.t)`);
  assert.equal(chapters.length, 7);
  const titles = { deliverables: 'DELIVERABLES', agents: 'AGENT DOSSIER', tasks: 'TASK BOARD', connectors: 'ABILITIES', automation: 'AUTOMATION', quests: 'QUEST LOG', settings: 'SETTINGS' };
  for (const chapter of chapters) {
    await click('.fm-tab[data-t="' + chapter + '"]');
    const state = await ev(`(() => {
      const body = document.querySelector('.fm-body');
      const active = body.querySelector('.fm-tab.on');
      return { chapter: body.querySelector('.fm-content').getAttribute('aria-label'),
        pressed: body.querySelectorAll('[aria-pressed="true"]').length,
        focused: document.activeElement === active, overflow: body.scrollWidth > body.clientWidth + 1,
        blankTags: [...body.querySelectorAll('.fm-tag')].some(e => !e.textContent.trim()) };
    })()`);
    assert.equal(state.chapter, chapter); assert.equal(state.pressed, 1);
    assert(state.focused); assert(!state.overflow); assert(!state.blankTags);
    receipt.chapters.push(state);
  }
  // Tab-key navigation must continue from the newly rendered active chapter.
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert(await ev(`document.activeElement.matches('[data-fm-open="settings"]')`));
  await click('[data-fm-page="5"]');
  assert(await ev(`document.querySelector('.fm-content').getAttribute('aria-label') === 'PROGRESS'`));
  await click('[data-fm-page="6"]');
  assert(await ev(`document.querySelector('.fm-content').getAttribute('aria-label') === 'HELP'`));
  for (const [chapter, target] of [['FIRST MISSION', 'comms'], ['FIRST MISSION', 'deliverables'], ['CREW', 'agents'], ['CREW', 'tasks'], ['GEAR', 'connectors'], ['LINES', 'automation'], ['PROGRESS', 'quests'], ['HELP', 'settings']]) {
    await click('.fm-tab[data-t="' + chapter + '"]');
    await click('[data-fm-open="' + target + '"]');
    assert(await ev(`!document.querySelector('.fm-body')`), 'manual closed before destination');
    if (target === 'comms') assert(await ev(`document.activeElement.id === 'chat-input' && !!document.activeElement.offsetWidth`));
    else {
      assert(await ev(`Array.from(document.querySelectorAll('.term')).some(w => w.offsetWidth && w.querySelector('.term-title')?.textContent === ${JSON.stringify(titles[target])})`), 'destination visible: ' + target);
      await ev(`StationUI.closeTerm('${target}')`); await sleep(500);
    }
    receipt.destinations.push(target);
    await open();
  }
  await click('.fm-tab[data-t="CONTROLS"]');
  await click('[data-fm-open="refit"]');
  assert(await ev(`!!document.querySelector('.refit-overlay')?.offsetWidth`), 'refit visible');
  await ev(`Build.close()`); await open();
  receipt.destinations.push('refit');
  // Inspect panel geometry at normal and narrow widths.
  for (const width of [600, 360]) {
    await ev(`(() => { const term = document.querySelector('.fm-body').closest('.term'); term.style.width='${width}px'; term.style.minWidth='0'; term.style.maxWidth='95vw'; term.style.left='20px'; term.style.top='20px'; term.style.transform='none'; })()`);
    for (const chapter of chapters) {
      await click('.fm-tab[data-t="' + chapter + '"]');
      assert(await ev(`(() => { const b=document.querySelector('.fm-body'); return b.scrollWidth <= b.clientWidth + 1; })()`), 'no horizontal overflow: ' + width + ' ' + chapter);
    }
  }
  receipt.narrowLayout = 'All 7 chapters fit at 360px and 600px panel widths';
  await click('.fm-tab[data-t="FIRST MISSION"]');
  await ev(`(() => { const term=document.querySelector('.fm-body').closest('.term'); term.style.width='600px'; term.style.height='800px'; })()`);
  receipt.nativePaint = await ev(`Array.from(document.querySelectorAll('.fm-body button'), e => getComputedStyle(e).backgroundColor).filter(c => ['rgb(255, 255, 255)','rgb(239, 239, 239)'].includes(c))`);
  assert.equal(receipt.nativePaint.length, 0);
  await capture(cdp, out, 'first-mission');
  await click('.fm-replay');
  assert(await ev(`!document.querySelector('.fm-body') && Tutorial.isCoaching()`), 'tour closes manual and starts coaching');
  receipt.quickTour = 'replay opens real tutorial';
  receipt.diagnostics = diag;
  assert.equal(diag.exceptions.length, 0);
  writeFileSync(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.ws.close(); }
  if (proc.exitCode == null) proc.kill();
}
