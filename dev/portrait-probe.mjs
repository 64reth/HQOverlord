#!/usr/bin/env node
/* dev/portrait-probe.mjs — measure the DOSSIER PORTRAIT's real resolution chain and shoot a zoom.
   Reports: canvas backing-store size vs CSS box vs devicePixelRatio, the effective drawn raster of
   the 92px master, the crop bounds, and the CSS image-rendering in force. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, connectCDP, evalJS, capture, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '9680';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9681);
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = join(process.cwd(), 'dev', '.shots-portrait');

function seedCrew(wsDir) {
  const p = join(wsDir, 'agent.save.json');
  const w = JSON.parse(readFileSync(p, 'utf8'));
  const d = w.doc;
  d.agent.stats = { xp: 640, level: 4, lifetimeXp: 640, confidence: 78, samples: 9,
    counters: { runs: 23, positiveFeedback: 7 }, milestones: ['first_run'] };
  const mk = (id, name, color, skin) => ({ id, name, color, skin, model: '', personaId: 'professional',
    purpose: name + ' does work.', specialtyId: null, createdAt: Date.now() - 86400000,
    docs: { identity: '', purpose: '', manual: '', context: '' },
    stats: { xp: 40, level: 1, lifetimeXp: 40, confidence: 50, samples: 0, counters: {}, milestones: [] } });
  // deliberately spread: pikachu is the LARGEST shipped character (43x46 — the one that decides the frame
  // size), voidwizard/bear sit at the wide end, skeleton at the narrow end.
  d.agents = [mk('a_scribe', 'SCRIBE', '#ffd166', 'pikachu'), mk('a_ledger', 'LEDGER', '#8affc1', 'voidwizard'),
    mk('a_probe', 'PROBE', '#ff8ad0', 'skeleton'), mk('a_bear', 'URSA', '#ff9a5a', 'bear')];
  writeFileSync(p, JSON.stringify(w, null, 2));
}

const WIN = `[...document.querySelectorAll('.term')].find(t => /AGENT DOSSIER/i.test(t.textContent||''))`;

const MEASURE = `(() => {
  const w = ${WIN}; if (!w) return { err: 'no window' };
  const cv = w.querySelector('#ag-portrait'); if (!cv) return { err: 'no canvas' };
  const r = cv.getBoundingClientRect();
  const cs = getComputedStyle(cv);
  const well = cv.closest('.ag-portrait-well');
  const wr = well ? well.getBoundingClientRect() : null;
  // how much of the canvas the body actually occupies (alpha > 16 bounds)
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let minX = cv.width, minY = cv.height, maxX = 0, maxY = 0, any = false, opaque = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const a = d[(y * cv.width + x) * 4 + 3];
    if (a > 16) { any = true; opaque++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  // count PARTIALLY transparent edge pixels — the signature of a smoothed (resampled) upscale
  let soft = 0; for (let i = 3; i < d.length; i += 4) { const a = d[i]; if (a > 16 && a < 239) soft++; }
  return {
    dpr: window.devicePixelRatio,
    canvasAttr: { w: cv.width, h: cv.height },
    cssBox: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
    wellBox: wr ? { w: +wr.width.toFixed(1), h: +wr.height.toFixed(1) } : null,
    imageRendering: cs.imageRendering,
    bodyBounds: any ? { w: maxX - minX + 1, h: maxY - minY + 1 } : null,
    opaquePx: opaque, softEdgePx: soft,
    softPct: opaque ? +(soft / opaque * 100).toFixed(1) : 0
  };
})()`;

const MASTER = `(() => {
  if (typeof SPRITES === 'undefined' || !SPRITES.ready) return 'sprites not ready';
  if (typeof DATA === 'undefined') return 'no DATA';
  const skins = DATA.SKINS || {};
  const out = {};
  for (const id of Object.keys(skins).slice(0, 4)) out[id] = { set: skins[id].set, scale: skins[id].scale };
  return out;
})()`;

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'portrait-'));
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
    await sleep(2200);
    mkdirSync(OUT, { recursive: true });
    await evalJS(cdp, `StationUI.openAgent(0)`);
    await sleep(2000);

    console.log('SKIN SCALES:', JSON.stringify(await evalJS(cdp, MASTER)));
    console.log('PORTRAIT:', JSON.stringify(await evalJS(cdp, MEASURE), null, 1));

    // zoom the portrait well so the pixels are judgeable
    const rect = await evalJS(cdp, `(() => { const w = ${WIN}; const el = w.querySelector('.ag-portrait-well'); const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
    console.log('WELL RECT:', JSON.stringify(rect));
    await capture(cdp, OUT, 'dossier-full');
    // blow the portrait up 6x into a scratch overlay so the shot shows real pixel structure
    await evalJS(cdp, `(() => {
      const w = ${WIN}; const cv = w.querySelector('#ag-portrait');
      let host = document.getElementById('__zoom');
      if (!host) { host = document.createElement('canvas'); host.id = '__zoom';
        host.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999;border:2px solid #0f0;background:#000';
        document.body.appendChild(host); }
      const Z = 6; host.width = cv.width * Z; host.height = cv.height * Z;
      const g = host.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, host.width, host.height);
      return [host.width, host.height];
    })()`);
    await sleep(400);
    await capture(cdp, OUT, 'portrait-zoom6x');

    /* EVERY-SKIN SWEEP. One skin proves nothing: the frame is sized so the LARGEST character still clears
       an integer x2, and the failure mode if that is wrong is silent — a big skin drops to x1 and renders
       half the height of the rest. So walk the whole roster and assert the upscale factor is uniform. */
    await evalJS(cdp, `(() => { const z = document.getElementById('__zoom'); if (z) z.remove(); return 1; })()`);
    const sweep = await evalJS(cdp, `(async () => {
      const w = ${WIN}; const cv = w.querySelector('#ag-portrait');
      const a = StationUI.h.present[0];
      const bounds = (c) => { const g = c.getContext('2d'); const d = g.getImageData(0,0,c.width,c.height).data;
        let mnX=c.width,mnY=c.height,mxX=0,mxY=0,any=false,op=0,sf=0;
        for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++){ const al=d[(y*c.width+x)*4+3];
          if (al>16){any=true;op++;if(al<239)sf++;if(x<mnX)mnX=x;if(x>mxX)mxX=x;if(y<mnY)mnY=y;if(y>mxY)mxY=y;} }
        return any?{w:mxX-mnX+1,h:mxY-mnY+1,op,softPct:+(sf/op*100).toFixed(1)}:null; };
      const master = async (set) => { const i = await new Promise(r=>{const im=new Image();im.onload=()=>r(im);im.onerror=()=>r(null);im.src='assets/sprites/'+set+'/rot_south.png';});
        if(!i) return null; const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;
        c.getContext('2d').drawImage(i,0,0); return bounds(c); };
      const out = [];
      for (const id of Object.keys(DATA.SKINS)) {
        // ensureSkin is ASYNC: without awaiting it, drawPortrait takes its procedural-fallback branch and
        // every skin measures an identical 18x60 rect. That false uniformity looks exactly like the PASS
        // we are trying to prove, so the wait is load-bearing, not politeness.
        await SPRITES.ensureSkin(id);
        if (!SPRITES.isSkinReady(id)) { out.push({ id, err: 'skin never became ready' }); continue; }
        a.skin = id;
        StationUI.rerender('agents');
        await new Promise(r => setTimeout(r, 120));
        const live = w.querySelector('#ag-portrait');
        const b = bounds(live), m = await master(DATA.SKINS[id].set);
        out.push({ id, master: m && (m.w+'x'+m.h), drawn: b && (b.w+'x'+b.h),
          factor: (b && m) ? +(b.h/m.h).toFixed(2) : null, softPct: b ? b.softPct : null });
      }
      return out;
    })()`);
    if (Array.isArray(sweep)) {
      const factors = [...new Set(sweep.map(r => r.factor))];
      const soft = [...new Set(sweep.map(r => r.softPct))];
      console.log('SWEEP skins:', sweep.length, 'distinct factors:', JSON.stringify(factors), 'distinct softPct:', JSON.stringify(soft));
      const odd = sweep.filter(r => r.factor !== factors[0] || r.softPct !== 0);
      console.log('NON-UNIFORM / SOFT:', odd.length ? JSON.stringify(odd) : 'none');
    } else { console.log('SWEEP:', JSON.stringify(sweep).slice(0, 400)); }
    // a visual strip: six skins' real portraits side by side at 3x NN, so the pixels are judgeable
    await evalJS(cdp, `(async () => {
      const w = ${WIN}; const a = StationUI.h.present[0];
      const IDS = ['blank', 'pikachu', 'voidwizard', 'skeleton', 'bear', 'plaguedoctor'];
      const shots = [];
      for (const id of IDS) {
        await SPRITES.ensureSkin(id);
        a.skin = id; StationUI.rerender('agents');
        await new Promise(r => setTimeout(r, 150));
        const cv = w.querySelector('#ag-portrait');
        const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
        c.getContext('2d').drawImage(cv, 0, 0); shots.push(c);
      }
      let host = document.getElementById('__strip');
      if (!host) { host = document.createElement('canvas'); host.id = '__strip';
        host.style.cssText = 'position:fixed;left:16px;top:16px;z-index:99999;border:2px solid #0f0;background:#0a0602';
        document.body.appendChild(host); }
      const Z = 3, pad = 6;
      host.width = shots.length * (shots[0].width * Z + pad) + pad;
      host.height = shots[0].height * Z + pad * 2;
      const g = host.getContext('2d'); g.imageSmoothingEnabled = false;
      shots.forEach((s, i) => g.drawImage(s, 0, 0, s.width, s.height,
        pad + i * (s.width * Z + pad), pad, s.width * Z, s.height * Z));
      return host.width;
    })()`);
    await sleep(500);
    await capture(cdp, OUT, 'portrait-strip-6skins');
    console.log('EXCEPTIONS:', JSON.stringify(diag.exceptions).slice(0, 600));
  } finally {
    try { chrome && chrome.proc && chrome.proc.kill(); } catch (e) {}
    try { side && side.proc && side.proc.kill(); } catch (e) {}
    setTimeout(() => process.exit(0), 400);
  }
}
main().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
