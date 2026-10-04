/* dev/outbox-unify-proof.mjs — live proof of the OUTBOX↔DELIVERABLES unification (2026-08-13).

   Attaches to an ALREADY-RUNNING dev/seed-deliverables.js (SKYNET_PORT, default 8733) whose three runs are
   real all the way down (real sidecar, real fs jail, real artifact ledger — only the MODEL is mocked). It
   folds those real finished runs into ReturnStore's pending ledger via the shipped foldRow seam (the same
   one the guided workflow uses), plus one runId the library index cannot know, then opens the OUTBOX window
   and asserts the unified drawer against the live DOM:
     · sections speak the library grammar (WHAT YOU ASKED FOR / WHAT CAME BACK / FILES)
     · FILES renders the library's dlv-files markup joined from /api/deliverables by runId
     · clicking OPEN rides the library's safe-preview seam (SAFE PREVIEW lands in the drawer)
     · a run the index doesn't know shows NO FILES section
     · the window carries the library door (#ob-library)

   Usage:  node dev/seed-deliverables.js            (one shell, leave running)
           node dev/outbox-unify-proof.mjs          (another)
   Dev-only. Shots land in dev/.shots-outbox-unify/. */
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.shots-outbox-unify');
const PORT = process.env.SKYNET_PORT || '8733';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9781);
const PROFILE = join(OUT, '_chrome');

// Fold the seed's REAL finished runs into the pending ledger (shipped foldRow seam), plus one
// runId the deliverables index cannot know — the honest probe for the "no FILES section" law.
const STAGE = `(async () => {
  const j = await Harness.api.get('/api/runs?agent=*&limit=50');
  const runs = ((j && j.runs) || []).filter(r => r && r.runId);
  if (!runs.length) return JSON.stringify({ ok: false, why: 'seed recorded no runs' });
  let folded = 0;
  for (const r of runs) if (ReturnStore.foldRow({ runId: r.runId, agentId: r.agentId, title: r.title, usd: r.usd, ts: r.ts, streamId: r.streamId })) folded++;
  ReturnStore.foldRow({ runId: 'proof-unknown-run', agentId: runs[0].agentId, title: 'a plain conversation the library never indexed', ts: Date.now(), streamId: '' });
  return JSON.stringify({ ok: true, folded, staged: ReturnStore.pendingRows().length });
})()`;

const OPEN_OUTBOX = `(async () => {
  StationUI.openTerm('outbox');
  await new Promise(r => setTimeout(r, 2500));
  const rows = document.querySelectorAll('#ob-list .ob-row').length;
  const lib = !!document.querySelector('#ob-library');
  return JSON.stringify({ ok: rows > 0, rows, libraryDoor: lib });
})()`;

// Expand the row whose collapsed text matches, settle the transcript+files fills, then read the drawer.
const EXPAND = (re) => `(async () => {
  const row = [...document.querySelectorAll('#ob-list .ob-row')].find(x => ${re}.test(x.textContent));
  if (!row) return JSON.stringify({ ok: false, why: 'row not found' });
  if (!row.classList.contains('open')) row.querySelector('.ob-head').click();
  await new Promise(r => setTimeout(r, 1200));
  row.scrollIntoView({ block: 'center' });
  const secs = [...row.querySelectorAll('.ob-sec')].map(s => s.textContent.trim());
  const files = [...row.querySelectorAll('.dlv-files li')].map(li => li.textContent.replace(/\\s+/g, ' ').trim());
  const anchors = row.querySelectorAll('a[data-file]').length;
  const headButtons = row.querySelector('.ob-head').querySelectorAll('button').length;
  return JSON.stringify({ ok: true, secs, files, anchors, headButtons, dataI: row.dataset.i || null });
})()`;

// Click the first OPEN anchor in the open row and read what the library's preview seam painted.
const CLICK_OPEN = `(async () => {
  const row = document.querySelector('#ob-list .ob-row.open');
  const a = row && row.querySelector('a[data-file]');
  if (!a) return JSON.stringify({ ok: false, why: 'no OPEN anchor in the open row' });
  a.click();
  await new Promise(r => setTimeout(r, 1500));
  const prev = row.querySelector('[data-preview]');
  const txt = prev ? prev.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : '';
  return JSON.stringify({ ok: /SAFE PREVIEW/.test(txt), preview: txt });
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

    console.log('stage  ->', await evalJS(cdp, STAGE));
    console.log('open   ->', await evalJS(cdp, OPEN_OUTBOX));
    console.log(' shot  ->', JSON.stringify(await capture(cdp, OUT, '1-outbox-list')));

    console.log('files-run  ->', await evalJS(cdp, EXPAND('/churn|Q3/i')));
    console.log(' shot  ->', JSON.stringify(await capture(cdp, OUT, '2-drawer-files')));

    console.log('preview    ->', await evalJS(cdp, CLICK_OPEN));
    console.log(' shot  ->', JSON.stringify(await capture(cdp, OUT, '3-safe-preview')));

    console.log('unknown-run ->', await evalJS(cdp, EXPAND('/never indexed/i')));
    console.log(' shot  ->', JSON.stringify(await capture(cdp, OUT, '4-no-files-drawer')));

    const errs = (diag.exceptions || []).length;
    console.log('page exceptions during capture:', errs);
    if (errs) console.log(JSON.stringify(diag.exceptions.slice(0, 3), null, 1));
    console.log('\nshots in', OUT);
  } finally {
    try { proc.kill(); } catch (_) {}
  }
})();
