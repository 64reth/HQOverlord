#!/usr/bin/env node
/* dev/portrait-ab.mjs — find WHERE the dossier portrait loses its detail.
   Renders the same skin frame through several pipelines into test canvases and reports an
   edge-softness metric for each, plus the true master frame size and the per-set draw scale. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9684';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9685);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = join(process.cwd(), 'dev', '.shots-portrait');

const WIN = `[...document.querySelectorAll('.term')].find(t => /AGENT DOSSIER/i.test(t.textContent||''))`;

const AB = `(async () => {
  const a = (StationUI.h && StationUI.h.present) ? StationUI.h.present[0] : null;
  if (!a) return 'no agent';
  const skin = a.skin || DATA.DEFAULT_SKIN;
  const set = (DATA.SKINS[skin] && DATA.SKINS[skin].set) || DATA.SKINS[DATA.DEFAULT_SKIN].set;
  const key = set + '.rot.south';
  // no frames hook is exported, so pull the SAME png the skin picker shows (assets/sprites/<set>/rot_south.png)
  const info = { skin, set, key };
  const img = await new Promise(res => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = () => res(null);
    i.src = 'assets/sprites/' + set + '/rot_south.png';
  });
  if (img) info.master = { w: img.naturalWidth, h: img.naturalHeight };

  // metric: share of opaque pixels that are partially transparent (soft resample edge)
  const soft = (cv) => {
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let op = 0, sf = 0, minX = cv.width, minY = cv.height, maxX = 0, maxY = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const al = d[(y * cv.width + x) * 4 + 3];
      if (al > 16) { op++; if (al < 239) sf++; if (x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
    return { opaque: op, softPct: op ? +(sf / op * 100).toFixed(1) : 0, box: op ? { w: maxX-minX+1, h: maxY-minY+1 } : null };
  };

  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const out = { info };

  if (img) {
    // A: the master blitted 1:1 — the ceiling
    const A = mk(img.width, img.height);
    A.getContext('2d').drawImage(img, 0, 0);
    out.A_master_1to1 = soft(A);
    // B: master smooth-scaled straight to ~98px tall (one resample)
    const B = mk(Math.round(img.width * 98 / img.height), 98);
    const bg = B.getContext('2d'); bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = 'high';
    bg.drawImage(img, 0, 0, B.width, B.height);
    out.B_one_resample_98 = soft(B);
  }

  // C: what the dossier ACTUALLY produces
  const cv = ${WIN} ? ${WIN}.querySelector('#ag-portrait') : null;
  if (cv) out.C_live_portrait = soft(cv);

  // D: the buffer stage in isolation — drawBody at 3x into 200x200, like drawPortrait
  const D = mk(200, 200);
  const dg = D.getContext('2d');
  dg.translate(100, 186); dg.scale(3, 3);
  SPRITES.drawBody(dg, { id: a.id, skin, px: 0, py: 0, dir: 'south', color: a.color, state: 'idle', sitting: false, working: false, phase: 0, noShadow: true }, performance.now());
  out.D_buffer_3x = soft(D);
  return out;
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'portab-'));
  const ws = join(scratch, 'ws');
  materializeSeedWorkspace(ws);
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
    await sleep(2200);
    mkdirSync(OUT, { recursive: true });
    await evalJS(cdp, `StationUI.openAgent(0)`);
    await sleep(2000);
    console.log("AB:", JSON.stringify(await evalJS(cdp, AB), null, 1));
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions).slice(0, 700));
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
    setTimeout(() => process.exit(0), 400);
  }
}
main().catch(e => { console.error('AB FAILED:', e.message); process.exit(1); });
