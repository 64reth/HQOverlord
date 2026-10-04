/* node dev/glyphdiag.mjs [--port 8963] [--cdp 9363]
 *
 * DIAGNOSTIC, not a gate. glyphprobe reported rune ink landing while the captured frame showed no
 * bubble over the bodies — a counter that passes while the screen disagrees. This answers the three
 * questions that separate "not drawn" from "drawn somewhere wrong" from "drawn then painted over":
 *
 *   1. the EXACT fillRect coordinates of one frame's runes, with the fillStyle that was live
 *   2. where the speaker actually is on the canvas (the same body->screen math drawBubble uses)
 *   3. whether those pixels SURVIVE to the final composited frame (getImageData at the rect)
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg('--port', '8963');
const CDP_PORT = Number(arg('--cdp', '9363'));
const OUT = arg('--out', join(process.cwd(), '.glyphdiag'));
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

// record EVERY fillRect of one frame with its live fillStyle, plus every fillText, tagged by draw order
const SPY = `(() => {
  const cv = document.getElementById('stage'); const ctx = cv.getContext('2d');
  if (window.__diag) return { already: true };
  const oRect = ctx.fillRect.bind(ctx), oText = ctx.fillText.bind(ctx);
  window.__diag = { rects: [], texts: [], on: false };
  ctx.fillRect = function (x, y, w, h) {
    if (window.__diag.on) window.__diag.rects.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h), String(ctx.fillStyle), Math.round(ctx.globalAlpha * 100)]);
    return oRect(x, y, w, h);
  };
  ctx.fillText = function (t, x, y) {
    if (window.__diag.on) window.__diag.texts.push([String(t), Math.round(x), Math.round(y)]);
    return oText(t, x, y);
  };
  return { ok: true };
})()`;

let proc = null, side = null, cdp = null;
try {
  if (await isUp(APP_URL)) throw new Error(`${APP_URL} already answers — pick another --port`);
  rmSync(SCRATCH, { recursive: true, force: true });
  materializeSeedWorkspace(SCRATCH);
  side = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
  if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);
  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 100); window.cancelAnimationFrame = (id) => clearTimeout(id);`,
  });
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 30, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(5000);
  console.log('[diag] spy:', JSON.stringify(await evalJS(cdp, SPY)));

  for (let i = 0; i < 2; i++) { await evalJS(cdp, `(() => { World.spawnAgent({ id: 'D${i}', name: 'DIAG${i}', color: '#ffaa55' }); return true; })()`); await sleep(700); }
  await sleep(4000);
  await evalJS(cdp, `(() => { const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced); World._dbgTeleport(bs[1].id, bs[0].px + 3, bs[0].py + 3); return true; })()`);
  await sleep(1500);
  let armed = null;
  for (let a = 0; a < 12; a++) {
    armed = await evalJS(cdp, `(() => { try { const bs = World.bodies().filter(b => b && !b.hero && !b.unplaced); return World._dbgHuddle(bs.map(b => b.id), true); } catch (e) { return { ok: false, err: String(e) }; } })()`);
    if (armed && armed.ok) break;
    await sleep(3000);
  }
  console.log('[diag] armed:', JSON.stringify(armed));
  if (!(armed && armed.ok)) throw new Error('could not arm a huddle');

  // poll for a talking turn, then record ONE frame in full
  let hit = null;
  for (let i = 0; i < 120; i++) {
    const r = await evalJS(cdp, `(() => {
      const ch = World._dbgChatter();
      if (!ch.live.length) return null;
      // record the NEXT frame from scratch, then read it back with the geometry that produced it
      window.__diag.rects.length = 0; window.__diag.texts.length = 0; window.__diag.on = true;
      World.stop(); World.start();                 // drives ONE synchronous frame
      window.__diag.on = false;
      const cv = document.getElementById('stage'), dpr = window.devicePixelRatio || 1;
      const bodies = World.bodies().filter(b => ch.live.some(x => x.id === b.id));
      const phos = window.__diag.rects.filter(r => String(r[4]).toLowerCase() === '#ffe0b0');
      let bb = null;
      for (const r of phos) { const x0 = r[0], y0 = r[1], x1 = r[0] + r[2], y1 = r[1] + r[3];
        bb = bb ? [Math.min(bb[0], x0), Math.min(bb[1], y0), Math.max(bb[2], x1), Math.max(bb[3], y1)] : [x0, y0, x1, y1]; }
      // do those pixels survive the FINAL composite? read the live canvas back at the rect
      let survive = null;
      if (bb) {
        const s = document.createElement('canvas');
        s.width = Math.max(1, (bb[2] - bb[0]) * dpr); s.height = Math.max(1, (bb[3] - bb[1]) * dpr);
        const sc = s.getContext('2d');
        sc.drawImage(cv, bb[0] * dpr, bb[1] * dpr, s.width, s.height, 0, 0, s.width, s.height);
        const d = sc.getImageData(0, 0, s.width, s.height).data;
        let bright = 0, max = 0, sum = 0;
        for (let p = 0; p < d.length; p += 4) { const l = (d[p] + d[p + 1] + d[p + 2]) / 3; sum += l; max = Math.max(max, l); if (l > 90) bright++; }
        survive = { px: d.length / 4, bright: bright, maxLum: Math.round(max), meanLum: Math.round(sum / (d.length / 4)) };
      }
      return {
        canvas: { w: cv.width, h: cv.height, dpr: dpr, cssW: Math.round(cv.width / dpr), cssH: Math.round(cv.height / dpr) },
        live: ch.live.map(x => ({ id: x.id, words: x.words, ageMs: x.ageMs, talking: x.talking })),
        bodies: bodies.map(b => ({ id: b.id, px: b.px, py: b.py, tile: b.tile, phase: b.socialPhase })),
        totalRects: window.__diag.rects.length, phosRects: phos.length, bbox: bb,
        firstPhos: phos.slice(0, 14), texts: window.__diag.texts.length,
        survive: survive
      };
    })()`).catch((e) => ({ err: String(e) }));
    if (r && !r.err && r.phosRects != null) { hit = r; break; }
    if (r && r.err) console.log('[diag] eval err:', r.err);
    await sleep(300);
  }
  if (!hit) throw new Error('never caught a talking turn to record');
  console.log('\n[diag] ONE RECORDED FRAME');
  console.log(JSON.stringify(hit, null, 1));

  // and a screenshot of that same moment
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, 'diag-frame.png'), Buffer.from(shot.data, 'base64'));
  console.log('[diag] frame: ' + join(OUT, 'diag-frame.png'));
  try { if (proc) proc.kill(); } catch {} try { if (side) side.kill(); } catch {}
  process.exit(0);
} catch (e) {
  console.log('DIAG ERROR — ' + (e && e.message ? e.message : String(e)));
  try { if (proc) proc.kill(); } catch {} try { if (side) side.kill(); } catch {}
  process.exit(1);
}
