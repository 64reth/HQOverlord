#!/usr/bin/env node
// dev/propangle-live-proof.mjs — the bookshelf + fishtank projection fix, proved in the LIVE app.
//
// It boots a seeded sidecar, opens the real page, places both props through the same validated
// mutation API REFIT uses (Build.__test__.station().addProp), and then makes TWO claims:
//
//   A. THE LIVE APP DRAWS THEM. Both props land on the real deck, the stage canvas carries real
//      pixel structure where each one sits, and the console stays clean.
//   B. THE PROJECTION ACTUALLY CHANGED — measured, not eyeballed, and A/B'd against the art at the
//      pinned BASELINE commit, loaded into the same page under a module shim, so both builds are
//      measured by identical code on identical canvases.
//
//      bookshelf  topPlaneRows — consecutive rows from the prop's first row that are >=80% LIT
//                 TIMBER. A front elevation shows a 1-2px crown line; a top-down 3/4 case shows a
//                 SURFACE. This is the whole difference between the two views, in one integer.
//      fishtank   fishRows — the number of distinct rows the fish occupy over a full swim cycle.
//                 In an elevation a fish can only travel left-right, so it is pinned to one row.
//                 Seen from above it drifts in TWO axes. Also one integer, and it cannot be faked
//                 by shading.
//
//   node dev/propangle-live-proof.mjs
import { mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ⛔ PIN THE BASELINE TO A COMMIT. The "SHIPPED" side is read out of git at the commit this lane
// forked from, not from a scratch file on disk — so the A/B still runs, and still means the same
// thing, long after the lane merges and frontend/app/propsprites.js IS the new art.
const BASELINE = process.env.SKYNET_PROP_BASELINE || '176fac9c2';
import { launchChrome, connectCDP, evalJS, sleep, collectDiagnostics } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const PORT = process.env.SKYNET_SHOT_PORT || '8974';
const CDP_PORT = Number(process.env.SKYNET_CDP_PORT || 9374);
const URL = `http://127.0.0.1:${PORT}/`;

/* ---- A: place both props on open deck through the REAL mutation API, then rebake ---- */
const PLACE = `(() => {
  const B = (typeof Build !== 'undefined' && Build.__test__) ? Build.__test__ : null;
  const st = B && B.station();
  if (!st) return JSON.stringify({ error: 'no live station (Build.__test__ unavailable)' });
  const b = st.bounds(), out = {};
  const y1 = b.minTy, x0 = b.maxTx + 3;
  st.addRoom({ kind: 'hab', rects: [{ x1: x0, y1, x2: x0 + 11, y2: y1 + 7 }] });
  World.rebake(); World.refit();
  for (const [t, dx] of [['bookshelf', 2], ['fishtank', 7]]) {
    const res = st.addProp({ t, x: x0 + dx, y: y1 + 3, w: 2, h: 1, block: true });
    out[t] = { ok: !!(res && res.ok), reason: res && res.reason, tx: x0 + dx, ty: y1 + 3, w: 2, h: 1 };
  }
  World.rebake(); World.refit();
  return JSON.stringify(out);
})()`;

/* Does the stage really carry the prop? The CRT pass warps the composited frame, so we do NOT chase
   an exact column (dev/floorseam-live.mjs learned that lesson) — we count the prop's OWN signature
   colour inside a window around the predicted spot, and the same count on bare deck. The deck is
   blue-grey under a cool lightmap, so warm timber (bookshelf) and the tank's cold tube (fishtank)
   are both things that simply cannot come from an empty floor. */
const STRUCTURE = (tx, ty, w, kind) => `(() => {
  const st = Build.__test__.station();
  const geo = st.projectGeometry(), T = geo.TILE, cam = World.cameraDbg();
  const lx = ${tx} - geo.origin.tx, ly = ${ty} - geo.origin.ty;
  const cv = document.getElementById('stage'), g = cv.getContext('2d');
  const hit = ${kind === 'bookshelf'
    ? '(r, gg, b, L) => r - b > 30 && r > gg && L > 40'      // warm lit timber
    : '(r, gg, b, L) => b - r > 26 && L > 95'};              // the cold tube and its bloom
  const count = (ox, oy, tw, th) => {
    const x0 = Math.round((lx + ox) * T * cam.scale + cam.panX);
    const y0 = Math.round((ly + oy) * T * cam.scale + cam.panY);
    const pw = Math.round(tw * T * cam.scale), ph = Math.round(th * T * cam.scale);
    if (x0 < 0 || y0 < 0 || x0 + pw > cv.width || y0 + ph > cv.height) return null;
    const d = g.getImageData(x0, y0, pw, ph).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (hit(d[i], d[i+1], d[i+2], L)) n++;
    }
    return { n, of: pw * ph };
  };
  /* SEARCH, do not predict. The composited frame is warped and panned; a predicted box misses by a
     tile and reports an empty floor. Slide the box over the neighbourhood and take the peak, then
     compare it to the WEAKEST box in the same sweep — which is bare deck by construction. */
  const bw = ${w} + 0.6, bh = 3.2;
  let peak = null, floor_ = null;
  for (let dy = -1.5; dy <= 1.5; dy += 0.5) for (let dx = -4; dx <= 4; dx += 0.5) {
    const c = count(-0.3 + dx, -2.0 + dy, bw, bh);
    if (!c) continue;
    if (!peak || c.n > peak.n) peak = { ...c, dx, dy };
    if (!floor_ || c.n < floor_.n) floor_ = { ...c, dx, dy };
  }
  return JSON.stringify({ onProp: peak, bareDeck: floor_ });
})()`;

/* ---- B: measure the projection, both builds, in the live page ---- */
const MEASURE = `(async () => {
  const TILE = 12;
  /* load the SHIPPED build beside the live one — same shim shoot.html uses, because that file
     declares PropSprites with const at top level and a second script tag would redeclare it. */
  const src = await (await fetch('/__shipped_propsprites.js')).text();
  const shim = { exports: {} };
  new Function('module', 'U', src)(shim, U);
  const BUILDS = { shipped: shim.exports, live: PropSprites };

  const render = (PS, id, now) => {
    const cv = document.createElement('canvas'); cv.width = 6 * TILE; cv.height = 6 * TILE;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    PS.setCtx(g); PS.setNow(now);
    PS.draw({ t: id, x: 1, y: 4, w: 2, h: 1 }, true, null);   // floor line at row 4*12+11 = 59
    return g.getImageData(0, 0, cv.width, cv.height);
  };

  /* topPlaneRows: from the prop's first drawn row, how many consecutive rows are >=80% LIT TIMBER
     (opaque, warm, luma >= 55)? A crown line scores 1-2; a surface scores 4+. */
  const topPlaneRows = (im) => {
    const W = im.width, H = im.height, d = im.data;
    const rowStat = (r) => {
      let opaque = 0, timber = 0;
      for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        if (d[i + 3] < 128) continue;
        opaque++;
        const L = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
        if (d[i] > d[i + 2] && L >= 55) timber++;
      }
      return { opaque, timber };
    };
    /* start at the first LIT-TIMBER row, not the first opaque one — the prop opens with its dark
       contour, and counting from there scores every build zero. */
    let first = -1;
    for (let r = 0; r < H && first < 0; r++) {
      const s = rowStat(r);
      if (s.opaque >= 8 && s.timber >= s.opaque * 0.8) first = r;
    }
    if (first < 0) return { first, rows: 0 };
    let n = 0;
    for (let r = first; r < H; r++) {
      const s = rowStat(r);
      if (s.opaque >= 8 && s.timber >= s.opaque * 0.8) n++; else break;
    }
    return { first, rows: n };
  };

  /* fishRows: distinct rows carrying the yellow fish accent over a full swim cycle. */
  const fishRows = (PS, id) => {
    const seen = new Set();
    for (let k = 0; k < 24; k++) {
      const im = render(PS, id, 1000 + k * 320), W = im.width, d = im.data;
      for (let r = 0; r < im.height; r++) for (let c = 0; c < W; c++) {
        const i = (r * W + c) * 4;
        if (d[i + 3] > 128 && d[i] > 170 && d[i + 1] > 120 && d[i + 1] < 220 && d[i + 2] < 110) seen.add(r);
      }
    }
    return seen.size;
  };

  const out = {};
  for (const [name, PS] of Object.entries(BUILDS)) {
    out[name] = {
      bookshelfTopPlaneRows: topPlaneRows(render(PS, 'bookshelf', 3400)).rows,
      fishtankFishRows: fishRows(PS, 'fishtank'),
    };
  }
  return JSON.stringify(out);
})()`;

const scratch = mkdtempSync(join(tmpdir(), 'propangle-'));
materializeSeedWorkspace(scratch);
const child = bootSeededSidecar({ port: PORT, scratchDir: scratch });
let chrome = null, cdp = null, code = 1;
try {
  if (!await waitUp(URL)) throw new Error('sidecar never came up on ' + URL);
  const profileDir = mkdtempSync(join(tmpdir(), 'propangle-chrome-'));
  mkdirSync(profileDir, { recursive: true });
  chrome = launchChrome({ cdpPort: CDP_PORT, profileDir });
  await sleep(2500);
  cdp = await connectCDP(CDP_PORT);
  const diag = collectDiagnostics(cdp);
  // serve the shipped snapshot from the page's own origin (the sidecar does not route gal/)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*__shipped_propsprites.js*' }] });
  const shippedSrc = execFileSync('git', ['show', `${BASELINE}:frontend/app/propsprites.js`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  cdp.on('Fetch.requestPaused', (p) => {
    cdp.send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'text/javascript' }],
      body: Buffer.from(shippedSrc, 'utf8').toString('base64'),
    }).catch(() => {});
  });

  await evalJS(cdp, `location.href = ${JSON.stringify(URL + '?dev=1')}`);
  await sleep(4000);
  await waitDevReady(cdp, evalJS, { url: URL + '?dev=1' });

  const placed = JSON.parse(await evalJS(cdp, PLACE));
  console.log('PLACED', JSON.stringify(placed));
  if (placed.error) throw new Error(placed.error);
  await sleep(1800);                                   // let rAF redraw the rebaked world

  let drawn = true;
  for (const id of ['bookshelf', 'fishtank']) {
    const p = placed[id];
    if (!p || !p.ok) { console.log('STAGE', id, 'NOT PLACED', JSON.stringify(p)); drawn = false; continue; }
    const s = JSON.parse(await evalJS(cdp, STRUCTURE(p.tx, p.ty, p.w, id)));
    const ok = !!(s.onProp && s.bareDeck && s.onProp.n >= 40 && s.onProp.n > s.bareDeck.n * 8);
    console.log('STAGE', id, ok ? 'DRAWN ON THE REAL CANVAS' : 'NOT FOUND', JSON.stringify(s));
    if (!ok) drawn = false;
  }

  const m = JSON.parse(await evalJS(cdp, MEASURE));
  console.log('MEASURE', JSON.stringify(m));
  const bookOk = m.live.bookshelfTopPlaneRows >= 4 && m.live.bookshelfTopPlaneRows > m.shipped.bookshelfTopPlaneRows;
  const fishOk = m.live.fishtankFishRows >= m.shipped.fishtankFishRows + 2;
  console.log('bookshelf top plane: shipped', m.shipped.bookshelfTopPlaneRows, 'rows ->', m.live.bookshelfTopPlaneRows, 'rows', bookOk ? 'PASS' : 'FAIL');
  console.log('fishtank fish rows : shipped', m.shipped.fishtankFishRows, '->', m.live.fishtankFishRows, fishOk ? 'PASS' : 'FAIL');

  const errs = diag.consoleMsgs.filter(x => x.type === 'error').concat(diag.exceptions.map(e => ({ type: 'exception', text: e })));
  console.log('CONSOLE ERRORS', errs.length, JSON.stringify(errs.slice(0, 5)));
  const pass = drawn && bookOk && fishOk && errs.length === 0;
  console.log(pass ? 'PROP-ANGLE LIVE PROOF: PASS' : 'PROP-ANGLE LIVE PROOF: FAIL');
  code = pass ? 0 : 1;
} catch (e) {
  console.log('PROP-ANGLE LIVE PROOF: ERROR', e && e.stack ? e.stack : e);
} finally {
  try { chrome && chrome.kill(); } catch {}
  try { child && child.kill(); } catch {}
  await sleep(400);
  process.exit(code);
}
