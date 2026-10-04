/* dev/quest-diag.mjs — DIAGNOSTIC ONLY: measure the QUEST LOG's live render + fetch behaviour.

   Andrew's report: the panel is "constantly flashing" and REFRESH QUESTS "barely works". Before changing
   anything we measure the real thing: how many times the panel's DOM is rebuilt while it just sits open,
   what fires those rebuilds, and how many quest-related fetches go out per second.

   Instrumentation is added AT RUNTIME (never in shipped source): we wrap StationUI.rerender and window.fetch
   inside the page, open the QUEST LOG, sit still for a measured window, then report counts.

   Usage:  node dev/seed-deliverables.js         (one shell)
           node dev/quest-diag.mjs               (another)
   Dev-only. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics, capture } from '../scripts/lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.shots-quest-diag');
const PORT = process.env.SKYNET_PORT || '8741';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9783);
const PROFILE = join(OUT, '_chrome');
const WATCH_MS = Number(process.env.QUEST_WATCH_MS || 12000);

// Wrap rerender + fetch. Record WHO called rerender (a trimmed stack) so a render storm names its source.
const INSTRUMENT = `(() => {
  window.__qd = { renders: [], fetches: [], stacks: {} };
  const origRerender = StationUI.rerender;
  StationUI.rerender = function (key) {
    if (key === 'quests') {
      const st = (new Error().stack || '').split('\\n').slice(2, 5).map(s => s.trim().replace(/^at /, '')).join(' <- ');
      window.__qd.renders.push({ t: Date.now(), st });
      window.__qd.stacks[st] = (window.__qd.stacks[st] || 0) + 1;
    }
    return origRerender.apply(this, arguments);
  };
  const origFetch = window.fetch;
  window.fetch = function (url) {
    const u = String((url && url.url) || url || '');
    if (/quest|goal|journey/i.test(u)) window.__qd.fetches.push({ t: Date.now(), u: u.split('?')[0] });
    return origFetch.apply(this, arguments);
  };
  return 'instrumented';
})()`;

const OPEN = `(async () => {
  StationUI.openTerm('quests');
  await new Promise(r => setTimeout(r, 2000));
  const win = [...document.querySelectorAll('.term')].find(t => /QUEST LOG/.test(t.textContent));
  if (!win) return JSON.stringify({ ok: false, why: 'quest window not found' });
  (win.getAnimations ? win.getAnimations() : []).forEach(a => { try { a.finish(); } catch (_) {} });
  const cs = getComputedStyle(win);
  window.__qd.renders = []; window.__qd.fetches = []; window.__qd.stacks = {};   // reset AFTER the open render
  return JSON.stringify({ ok: true, width: cs.width, height: cs.height,
    rows: document.querySelectorAll('.gx-quests .gx-tro').length,
    open: document.querySelectorAll('.q-open .gx-tro').length,
    done: document.querySelectorAll('.q-done .gx-tro').length });
})()`;

const REPORT = `(() => {
  const d = window.__qd;
  const byStack = Object.entries(d.stacks).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const fby = {}; for (const f of d.fetches) fby[f.u] = (fby[f.u] || 0) + 1;
  return JSON.stringify({ renders: d.renders.length, perSec: +(d.renders.length / (${WATCH_MS} / 1000)).toFixed(2),
    topCallers: byStack, fetches: d.fetches.length, fetchesByUrl: fby });
})()`;

// Does the panel visibly rebuild? Watch one row's identity + a CSS animation restart across the window.
const REFRESH_BTN = `(async () => {
  const b = document.querySelector('.q-refresh-btn');
  if (!b) return JSON.stringify({ ok: false, why: 'no REFRESH QUESTS button' });
  const before = b.textContent.trim();
  b.click();
  await new Promise(r => setTimeout(r, 5000));
  const b2 = document.querySelector('.q-refresh-btn');
  const notices = [...document.querySelectorAll('.notice, .toast, .nfy')].map(n => n.textContent.trim()).slice(0, 4);
  return JSON.stringify({ ok: true, before, after: b2 ? b2.textContent.trim() : '(button gone)',
    disabled: b2 ? b2.disabled : null, notices,
    refreshLine: (document.querySelector('.q-refresh, .gx-quests .q-refresh-line') || {}).textContent || '' });
})()`;

// SWEEP CHECKS (2026-08-13): steady shell, crossfade-free data pokes, distinct dossier explanations.
const SWEEP = `(async () => {
  const win = [...document.querySelectorAll('.term')].find(t => /QUEST LOG/.test(t.textContent));
  const body = win.querySelector('.term-body') || win;
  const h1 = getComputedStyle(win).height;
  // 1) a DATA poke must not blink: clear any prior crossfade class, poke as data, class must stay absent.
  body.classList.remove('swap-in');
  StationUI.rerender('quests', false);
  await new Promise(r => setTimeout(r, 150));
  const dataPokeBlinks = body.classList.contains('swap-in');
  StationUI.rerender('quests');   // a user-driven swap still fades (the default is unchanged)
  await new Promise(r => setTimeout(r, 150));
  const userSwapFades = body.classList.contains('swap-in');
  // 2) content change must not resize/re-centre the steady shell.
  WorkQuestStore.accept({ title: 'Sweep probe quest', build: { kind: 'freeform' } });
  await new Promise(r => setTimeout(r, 400));
  const h2 = getComputedStyle(win).height;
  // 3) dossier cards explain WHY each dimension matters — distinct sentences, not one repeated wall.
  const dossierDescs = [...document.querySelectorAll('.q-open .q-card')]
    .filter(c => /ABOUT YOU/.test(c.textContent)).map(c => c.querySelector('.sub').textContent.trim());
  return JSON.stringify({ steadyHeight: h1 === h2, h1, h2, dataPokeBlinks, userSwapFades,
    dossierCount: dossierDescs.length, distinctDescs: new Set(dossierDescs).size,
    sample: dossierDescs.slice(0, 3) });
})()`;

// Stage a REAL work quest through the shipped mint seam (WorkQuestStore.accept — the same call an accepted
// pitch makes). Nothing is hand-written into the panel: the card comes from the store's own projection.
const STAGE_WORK_QUEST = `(async () => {
  if (typeof WorkQuestStore === 'undefined' || !WorkQuestStore.accept) return JSON.stringify({ ok: false, why: 'WorkQuestStore absent' });
  const id = WorkQuestStore.accept({ title: 'Draft the launch announcement', build: { kind: 'freeform' } });
  StationUI.rerender('quests');
  await new Promise(r => setTimeout(r, 700));
  return JSON.stringify({ ok: !!id, id, cards: document.querySelectorAll('.q-open .q-card').length,
    startBtns: document.querySelectorAll('.q-actions .q-go[data-dest="session"]').length });
})()`;

// START QUEST must open the quest's OWN session (never the TASK BOARD) and be idempotent on a second click.
const START_QUEST = `(async () => {
  const b = document.querySelector('.q-actions .q-go[data-dest="session"]');
  if (!b) return JSON.stringify({ ok: false, why: 'no START QUEST button on any open quest' });
  const label = b.textContent.trim();
  const before = Workstreams.list().length;
  b.click();
  await new Promise(r => setTimeout(r, 1200));
  const active = Workstreams.active();
  const composer = document.getElementById('chat-input');
  const afterOne = Workstreams.list().length;
  // click it again (re-open the log first — opening a session may cover it)
  StationUI.openTerm('quests');
  await new Promise(r => setTimeout(r, 900));
  const b2 = document.querySelector('.q-actions .q-go[data-dest="session"]');
  if (b2) { b2.click(); await new Promise(r => setTimeout(r, 900)); }
  return JSON.stringify({ ok: true, label, before, afterOne, afterTwo: Workstreams.list().length,
    activeTitle: active ? active.title : null,
    composerPrefill: composer ? String(composer.value || '').slice(0, 90) : '(composer not found)',
    taskBoardOpened: [...document.querySelectorAll('.term')].some(t => /TASK BOARD/.test(t.textContent)) });
})()`;

(async () => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const { proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,980', profileDir: PROFILE });
  try {
    await sleep(1800);
    const cdp = await connectCDP(CDP_PORT);
    const diag = collectDiagnostics(cdp);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 200);'
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT });
    await sleep(9000);

    console.log('instrument ->', await evalJS(cdp, INSTRUMENT));
    console.log('open       ->', await evalJS(cdp, OPEN));
    console.log(' shot      ->', JSON.stringify(await capture(cdp, OUT, '1-quest-log')));
    console.log('… sitting idle for ' + WATCH_MS + 'ms (no interaction) …');
    await sleep(WATCH_MS);
    console.log('IDLE REPORT->', await evalJS(cdp, REPORT));

    console.log('refresh    ->', await evalJS(cdp, REFRESH_BTN));
    console.log(' shot      ->', JSON.stringify(await capture(cdp, OUT, '2-after-refresh')));

    console.log('sweep      ->', await evalJS(cdp, SWEEP));
    console.log('stage work ->', await evalJS(cdp, STAGE_WORK_QUEST));
    console.log('startquest ->', await evalJS(cdp, START_QUEST));
    console.log(' shot      ->', JSON.stringify(await capture(cdp, OUT, '3-quest-session')));

    const errs = (diag.exceptions || []).length;
    console.log('page exceptions:', errs);
    if (errs) console.log(JSON.stringify(diag.exceptions.slice(0, 3), null, 1));
    console.log('\nshots in', OUT);
  } finally {
    try { proc.kill(); } catch (_) {}
  }
})();
