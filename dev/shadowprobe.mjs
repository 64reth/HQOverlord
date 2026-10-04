#!/usr/bin/env node
// dev/shadowprobe.mjs — PROOF instrument for the agent contact shadow.
//
// The pool is ~16x7 px under a ~35px sprite: too small to judge from a 1440x900 shoot frame, and the
// floor animates every frame (the hero wanders, the CRT layer repaints), so it can't be eyeballed for
// a falloff curve either. This measures three things a screenshot cannot:
//
//   1. THE POOL — runs the shipped SPRITES.groundShadow onto an offscreen TRANSPARENT field in the
//      live page and reads its alpha back: extent, core alpha, row/column falloff, the lift response
//      (a bobbing body's pool must shrink AND fade), the seated and ULTRON variants. Real function,
//      real browser, not a re-implementation.
//   2. THE DECK — whether the pool is actually VISIBLE where it has to live. Geometry can be perfect
//      and still be black-on-black: the station deck measures ~28/255 luma under the hero.
//   3. THE OFF-FLOOR PATH — the dossier portrait draws a body with no floor (b.noShadow) and must
//      paint NO pool; one there scales into a blocky bar across the card.
//
// Everything drives the PUBLIC surface (SPRITES.drawBody / SPRITES.groundShadow). Note that drawBody
// calls its module-local groundShadow directly, so stubbing the EXPORT does not suppress the pool in
// a world render — an earlier version of this probe did exactly that and produced an on/off image
// pair that differed only by animation noise. To suppress it honestly, wrap drawBody and force the
// b.noShadow flag the renderer already honours.
//
// Usage:  node dev/shadowprobe.mjs [--port 8939] [--cdp 9339] [--out .uishots-shadow]
// Exits nonzero if any pool invariant fails.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { sleep, launchChrome, connectCDP, evalJS } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, isUp, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const arg = (flag, dflt) => { const i = process.argv.indexOf(flag); return i > -1 ? process.argv[i + 1] : dflt; };
const POOL_ONLY = process.argv.includes('--pool-only'); // isolate geometry from textured/zoomed live decks
const PORT = arg('--port', '8939');
const CDP_PORT = Number(arg('--cdp', '9339'));
const OUT = arg('--out', join(process.cwd(), '.uishots-shadow'));
const APP_URL = `http://127.0.0.1:${PORT}/`;
const SCRATCH = join(OUT, '_seed-workspace');
mkdirSync(OUT, { recursive: true });

// --- the pool itself, measured inside the page against the shipped groundShadow ---
const PROBE = `(() => {
  if (typeof SPRITES === 'undefined' || typeof SPRITES.groundShadow !== 'function') return { err: 'no SPRITES.groundShadow' };
  const W = 96, H = 48, cx = 48, cy = 24, RX = 7.6;   // RX ~ a typical crew footprint (dw*0.21)
  // Measured on a TRANSPARENT field, reading the ALPHA channel — NOT as a darkening of white. A
  // white-field luma read is colour-blind in the wrong direction: ULTRON's #ff4a3d spill leaves the
  // red channel at 255, so it measured as alpha 0 and the probe reported "no spill" for a spill that
  // was plainly there. Alpha is what the pool deposits, for any colour.
  const field = (opts) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    SPRITES.groundShadow(x, cx, cy, RX, opts);
    const d = x.getImageData(0, 0, W, H).data;
    const at = (px, py) => d[(py * W + px) * 4 + 3] / 255;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, any = false;
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      if (at(px, py) > 0.01) { any = true; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
    }
    const row = [], col = [];
    for (let px = cx - 11; px <= cx + 11; px++) row.push(+at(px, cy).toFixed(3));
    for (let py = cy - 7; py <= cy + 7; py++) col.push(+at(cx, py).toFixed(3));
    return { core: +at(cx, cy).toFixed(3), w: any ? maxX - minX + 1 : 0, h: any ? maxY - minY + 1 : 0,
             biasX: any ? +(((minX + maxX) / 2) - cx).toFixed(2) : 0, row, col };
  };

  // The off-floor path, tested WITHOUT stubbing anything. GROUND_BITE parks the boots ~3px ABOVE the
  // floor line, so the rows just BELOW py carry the pool and never the sprite: with a shadow they are
  // darkened, with b.noShadow they must be untouched white. That is a direct read of the real
  // renderer — no monkeypatching, so nothing about it can be an artefact of the probe.
  const offFloor = (() => {
    const PY = 120;
    const groundBand = (noShadow) => {
      const c = document.createElement('canvas'); c.width = 160; c.height = 160;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, 160, 160);
      const drew = !!SPRITES.drawBody(g, { id: 'PROBE', skin: DATA.DEFAULT_SKIN, px: 80, py: PY,
        dir: 'south', state: 'idle', sitting: false, working: false, phase: 0, aph: 0, noShadow }, 0);
      const d = g.getImageData(0, PY + 1, 160, 4).data;    // 4 sprite-free rows under the floor line
      let marked = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 250) marked++;
      return { drew, marked };
    };
    const on = groundBand(false), off = groundBand(true);
    return { drew: on.drew && off.drew, poolPx: on.marked, poolPxWhenFlagged: off.marked };
  })();

  return {
    rest: field({}),
    lifted: field({ lift: 2.1 }),
    seated: field({ alpha: 0.6, spread: 0.8 }),
    // drawBody gives ULTRON's spill shR*1.55 — probe it at the radius it actually ships with, or the
    // "is it wider than the crew pool" check compares the spill against itself and always fails.
    ultron: field({ color: '#ff4a3d', alpha: 0.8, spread: 1.55 }),
    offFloor
  };
})()`;

// where is the hero standing, in CSS px on the page? (world px -> canvas -> CSS)
const LOCATE = `(() => {
  const b = (window.__SKYNET_TEST__ && window.__SKYNET_TEST__.hero && window.__SKYNET_TEST__.hero()) || null;
  const cam = (typeof World !== 'undefined' && World.cameraDbg) ? World.cameraDbg() : null;
  const cv = document.getElementById('stage');
  if (!b || !cam || !cv) return { err: 'no hero/cam/stage', hasBody: !!b, hasCam: !!cam };
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return {
    id: b.id, name: b.name, state: b.state, sitting: b.sitting, px: b.px, py: b.py, scale: cam.scale,
    cssX: r.left + (b.px * cam.scale + cam.panX) / dpr,
    cssY: r.top + (b.py * cam.scale + cam.panY) / dpr
  };
})()`;

// Does the pool READ on the deck it has to live on? Compare SPACE, not TIME: a with/without frame
// diff is ~100% animation here (the hero wanders and the CRT layer repaints every frame). Inside a
// single frame, measure the pool against the bare deck flanking it, on the sprite-free rows.
const CONTRAST = `(() => {
  const cv = document.getElementById('stage');
  if (!cv || !window.__SKYNET_TEST__ || typeof World === 'undefined' || !World.cameraDbg) return { err: 'no stage/test-api/World' };
  const x = cv.getContext('2d');
  const b = window.__SKYNET_TEST__.hero(); const cam = World.cameraDbg();
  const sx = Math.round(b.px * cam.scale + cam.panX), sy = Math.round(b.py * cam.scale + cam.panY);
  const R = 34, HH = 16, TOP = 6;
  const d = x.getImageData(sx - R, sy - TOP, R * 2, HH).data;
  const L = new Float64Array(R * 2 * HH);
  for (let i = 0, p = 0; p < L.length; p++, i += 4) L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const at = (ox, oy) => L[(oy + TOP) * R * 2 + (ox + R)];
  const inside = [], flank = [];
  for (let oy = 1; oy <= 4; oy++) for (let ox = -R + 1; ox < R; ox++) {
    const v = at(ox, oy); if (!(v >= 0)) continue;
    if (Math.abs(ox) <= 6) inside.push(v);
    else if (Math.abs(ox) >= 14 && Math.abs(ox) <= 30) flank.push(v);
  }
  const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  const deckLuma = avg(flank), poolLuma = avg(inside);
  const map = [];
  for (let oy = -TOP; oy < HH - TOP; oy++) {
    let line = '';
    for (let ox = -16; ox <= 16; ox++) {
      const dv = deckLuma - at(ox, oy);
      line += dv > 14 ? '#' : dv > 9 ? '+' : dv > 5 ? ':' : dv > 2 ? '.' : ' ';
    }
    map.push(line);
  }
  return { deckLuma: +deckLuma.toFixed(1), poolLuma: +poolLuma.toFixed(1),
           drop: +(deckLuma - poolLuma).toFixed(1),
           dropPct: Math.round(100 * (deckLuma - poolLuma) / Math.max(1, deckLuma)),
           bodyPx: [b.px, b.py], state: b.state, map };
})()`;

// Suppress the pool in the LIVE world by wrapping drawBody and forcing the flag the renderer already
// honours. Stubbing SPRITES.groundShadow does NOT work: drawBody calls its module-local copy.
const SHADOW_OFF = `(() => {
  if (window.__realDB) return 'already off';
  window.__realDB = SPRITES.drawBody;
  SPRITES.drawBody = (ctx, b, t) => window.__realDB(ctx, Object.assign({}, b, { noShadow: true }), t);
  return 'off';
})()`;
const SHADOW_ON = `(() => { if (window.__realDB) { SPRITES.drawBody = window.__realDB; delete window.__realDB; } return 'on'; })()`;

let ownSidecar = null, proc = null, cdp = null, code = 0;
try {
  if (await isUp(APP_URL)) console.log(`sidecar: reusing :${PORT}`);
  else {
    console.log(`sidecar: booting SEEDED SKYNET_DEV on :${PORT} ...`);
    materializeSeedWorkspace(SCRATCH);
    ownSidecar = bootSeededSidecar({ port: PORT, scratchDir: SCRATCH });
    if (!(await waitUp(APP_URL))) throw new Error('seeded sidecar never came up on :' + PORT);
  }
  ({ proc } = launchChrome({ cdpPort: CDP_PORT, win: '1440,900', profileDir: join(OUT, '_profile') }));
  cdp = await connectCDP(CDP_PORT);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 24, url: APP_URL }))) throw new Error('never reached the in-game floor');
  await sleep(1500);

  const m = await evalJS(cdp, PROBE);
  if (m.err) throw new Error('probe: ' + m.err);
  const P = (t, f) => console.log(`  ${t.padEnd(8)} core=${String(f.core).padEnd(6)} extent=${f.w}x${f.h}px  biasX=${f.biasX}`);
  console.log('\nTHE POOL (rx=7.6, a typical crew footprint):');
  P('rest', m.rest); P('lifted', m.lifted); P('seated', m.seated); P('ultron', m.ultron);
  console.log('  row falloff  ', m.rest.row.join(' '));
  console.log('  col falloff  ', m.rest.col.join(' '));
  console.log(`  off-floor (dossier portrait): body drew=${m.offFloor.drew} · pool under a normal body ${m.offFloor.poolPx}px · under b.noShadow ${m.offFloor.poolPxWhenFlagged}px`);

  const fails = [];
  const r = m.rest;
  if (!(r.h >= 5)) fails.push(`pool is ${r.h}px tall — still a line, not a pool`);
  if (!(r.w >= 12 && r.w <= 26)) fails.push(`pool width ${r.w}px outside the sane 12..26 band`);
  if (!(r.core > 0.34 && r.core < 0.55)) fails.push(`core alpha ${r.core} outside 0.34..0.55`);
  if (!(r.row[0] < 0.02 && r.row[r.row.length - 1] < 0.02)) fails.push('rim is not transparent — hard edge');
  if (!(r.row.some(v => v > 0.03 && v < r.core - 0.05))) fails.push('no intermediate alpha — falloff is a step, not soft');
  if (!(m.lifted.core < r.core - 0.04 && m.lifted.w < r.w)) fails.push('lift does not shrink AND fade the pool');
  if (!(m.seated.core < r.core && m.seated.w < r.w)) fails.push('seated pool is not tighter/fainter');
  if (!(r.biasX > 0)) fails.push('no south-east bias under the north-west key light');
  if (!(m.ultron.core > 0.3 && m.ultron.w > r.w)) fails.push(`ULTRON spill (core ${m.ultron.core}, ${m.ultron.w}px) is not a wider, present pool beside the crew pool (${r.w}px)`);
  if (!m.offFloor.drew) fails.push('off-floor probe never drew a body — the noShadow check proved nothing');
  else if (!(m.offFloor.poolPx > 0)) fails.push('off-floor probe saw no pool even on a normal body — it is not testing anything');
  else if (m.offFloor.poolPxWhenFlagged !== 0) fails.push(`b.noShadow ignored: ${m.offFloor.poolPxWhenFlagged}px of pool under an off-floor body — the dossier portrait would grow a ground bar`);

  if (!POOL_ONLY) {
  const cN = await evalJS(cdp, CONTRAST);
  if (cN && !cN.err) {
    console.log(`\nON THE LIVE DECK (hero ${cN.state} at ${cN.bodyPx}):`);
    console.log(`  deck beside the feet ${cN.deckLuma}/255 · under the pool ${cN.poolLuma}/255`);
    console.log(`  the pool takes ${cN.drop} luma off the deck (${cN.dropPct}% darker)`);
    console.log('  window around the floor line (# >14  + >9  : >5  . >2 luma below the deck):');
    cN.map.forEach((l, i) => console.log(`   ${String(i - 6).padStart(3)} |${l}|`));
    if (!(cN.drop >= 5)) fails.push(`pool only takes ${cN.drop} luma off a ${cN.deckLuma} deck — invisible in play`);
    if (!(cN.dropPct >= 12)) fails.push(`pool is only ${cN.dropPct}% darker than the deck — no contact read`);
  } else console.log('\ncontrast probe failed: ' + JSON.stringify(cN));

  // the visual: a magnified ON/OFF pair at the hero's feet. The hero WANDERS, so re-park it on the
  // same tile before each grab (_dbgTeleport clears path/target) — otherwise the pair differs by a
  // walk rather than by the shadow.
  const loc0 = await evalJS(cdp, LOCATE);
  if (loc0 && !loc0.err) {
    const park = `(() => { World._dbgTeleport(window.__SKYNET_TEST__.hero().id, ${loc0.px}, ${loc0.py}); return true; })()`;
    const grab = async (name) => {
      await evalJS(cdp, park); await sleep(220);
      const l = await evalJS(cdp, LOCATE);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png',
        clip: { x: Math.max(0, l.cssX - 30), y: Math.max(0, l.cssY - 44), width: 60, height: 60, scale: 9 } });
      writeFileSync(join(OUT, name), Buffer.from(shot.data, 'base64'));
    };
    await grab('shadow-closeup.png');
    const offAck = await evalJS(cdp, SHADOW_OFF);
    await grab('shadow-closeup-off.png');
    await evalJS(cdp, SHADOW_ON);
    console.log(`\nhero ${loc0.name} (${loc0.state}) parked at world ${loc0.px},${loc0.py} · cam scale ${loc0.scale} · suppression=${offAck}`);
    console.log(`closeups (9x) -> shadow-closeup.png  vs  shadow-closeup-off.png  (in ${OUT})`);
  } else console.log('\nlocate failed: ' + JSON.stringify(loc0));

  }

  if (fails.length) { code = 1; console.log('\nFAIL:'); fails.forEach(f => console.log('  - ' + f)); }
  else console.log('\nOK — every pool invariant holds.');
} catch (e) {
  console.error('FATAL', e && e.message || e); code = 1;
} finally {
  try { cdp?.ws.close(); } catch {}
  try { proc?.kill('SIGKILL'); } catch {}
  if (ownSidecar) { try { ownSidecar.kill('SIGKILL'); } catch {} }
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch {}
}
process.exit(code);
