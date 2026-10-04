/* test/prop-render-smoke.test.js — EVERY catalog prop must actually paint, inside its own footprint.

   Why this exists (2026-07-29): three freshly authored props shipped drawing NOTHING. The draw
   signature hands a prop `w`/`h` already in PIXELS — draw() multiplies the tile footprint by TILE
   before calling — and code written as `w * TILE` put the whole body hundreds of pixels off-canvas.
   Every other gate was green: the catalog row existed, `PropSprites.has(id)` was true, the module
   parsed, test:fast passed. Nothing anywhere asserted that a prop puts down pixels.

   So this walks the ENTIRE catalog through a recording 2D-context stub and checks two things per prop:
   it painted a believable amount, and what it painted lands on its own footprint rather than in
   the void. It is a whole-catalog regression detector, not a test of these twelve props. */
'use strict';
const A = require('./_assert.js');
const path = require('node:path');
const fs = require('node:fs');

/* propsprites is bare-require safe but its DRAW functions use the global U (shade/hash/pick).
   util.js is a browser script defining `const U = {...}`, so evaluate it and lift U out. */
const utilSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'util.js'), 'utf8');
global.window = global.window || { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = global.document || { addEventListener() {}, documentElement: { style: { setProperty() {} } }, createElement: () => ({ getContext: () => null, style: {} }) };
global.U = new Function(utilSrc + '; return U;')();
A.ok(typeof U.shade === 'function' && typeof U.hash === 'function', 'U.shade/U.hash are available to the draw functions');

const PS = require('../frontend/app/propsprites.js');
const TILE = PS.TILE;

/* a recording 2D context: fillRect is what the `px` primitive uses and is where essentially all
   prop pixels come from. Path/text APIs are accepted and ignored — a prop drawn ONLY out of
   ellipses would read as empty here, so the minimums below are deliberately forgiving. */
function recorder() {
  const rects = [];
  const noop = () => {};
  return {
    rects,
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '',
    fillRect(x, y, w, h) { if (w > 0 && h > 0 && isFinite(x) && isFinite(y)) rects.push([x, y, w, h]); },
    strokeRect: noop, clearRect: noop,
    save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    arc: noop, ellipse: noop, rect: noop, fill: noop, stroke: noop, clip: noop,
    translate: noop, scale: noop, rotate: noop, transform: noop, fillText: noop, measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: noop, getImageData: () => ({ data: [] }), putImageData: noop,
  };
}

/* Props legitimately paint OUTSIDE their footprint: a tall 3/4 body (arcade, vending, pinball
   backglass) rises well above its tiles by design, and contact shadows bleed a pixel or two each
   side. These bounds are loose enough to allow all of that and tight enough that a prop drawn a
   whole tile-grid away — the actual bug — cannot pass. */
const PAD_X = 10, PAD_UP = 44, PAD_DOWN = 8;
const MIN_RECTS = 6;

const ORIGIN_TX = 3, ORIGIN_TY = 3;   // draw at a non-zero origin so a prop that ignores x/y is caught too
let checked = 0;
const empty = [], escaped = [], threw = [];

for (const spec of PS.CATALOG) {
  const ctx = recorder();
  PS.setCtx(ctx);
  PS.setNow(2400);
  const X = ORIGIN_TX * TILE, Y = ORIGIN_TY * TILE, W = spec.w * TILE, H = spec.h * TILE;
  try {
    // `work: true` so screen-lit branches run; both mount states are exercised below.
    PS.draw({ t: spec.id, x: ORIGIN_TX, y: ORIGIN_TY, w: spec.w, h: spec.h, id: 'p1' }, true);
  } catch (e) {
    threw.push(spec.id + ': ' + (e && e.message));
    continue;
  }
  checked++;
  if (ctx.rects.length < MIN_RECTS) { empty.push(spec.id + ' (' + ctx.rects.length + ' rects)'); continue; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [rx, ry, rw, rh] of ctx.rects) {
    x0 = Math.min(x0, rx); y0 = Math.min(y0, ry);
    x1 = Math.max(x1, rx + rw); y1 = Math.max(y1, ry + rh);
  }
  const bad = (x0 < X - PAD_X) || (x1 > X + W + PAD_X) || (y0 < Y - PAD_UP) || (y1 > Y + H + PAD_DOWN);
  if (bad) escaped.push(spec.id + ' bbox=[' + Math.round(x0) + ',' + Math.round(y0) + '..' + Math.round(x1) + ',' + Math.round(y1) + '] footprint=[' + X + ',' + Y + '..' + (X + W) + ',' + (Y + H) + ']');
}

A.eq(threw, [], 'no catalog prop throws while drawing');
A.eq(empty, [], 'every catalog prop actually paints (this is what "drew nothing" looks like)');
A.eq(escaped, [], 'every catalog prop paints ON its own footprint (w/h are PIXELS in a draw fn, never tiles)');
A.ok(checked >= 118, 'walked the whole catalog (' + checked + ' props)');

/* Andrew's v0.9 restart escape: a workstation west of world zero threw only during the first seconds of
   process uptime. `scr()` used a negative JS remainder as an array index, produced undefined, and desk's
   U.shade(sc) killed REFIT's only animation callback. Positive-origin / warm-uptime smoke never saw it. */
{
  const ctx = recorder(); PS.setCtx(ctx); PS.setNow(0);
  let error = null;
  try { PS.draw({ t: 'desk', x: -17, y: 0, w: 2, h: 1, id: 'west-desk' }, true); }
  catch (e) { error = e; }
  A.eq(error, null, 'a lit desk at negative world x paints on the first frame after restart');
  A.ok(ctx.rects.length >= MIN_RECTS, 'the negative-phase desk paints real pixels instead of blanking REFIT');
}

/* A mounted prop must draw exactly SURFACE_RISE higher and nowhere else — the lift is applied once,
   at the draw() origin, and no prop function may bake its own mount height. */
{
  const mountable = PS.CATALOG.filter(c => c.mount === 'surface' || c.stack);
  A.ok(mountable.length >= 10, 'there are mountable props to check (' + mountable.length + ')');
  const bboxOf = (spec, mount) => {
    const ctx = recorder(); PS.setCtx(ctx); PS.setNow(2400);
    const f = { t: spec.id, x: ORIGIN_TX, y: ORIGIN_TY, w: spec.w, h: spec.h };
    if (mount) f.mount = 'surface';
    PS.draw(f, true);
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const [rx, ry, rw, rh] of ctx.rects) { y0 = Math.min(y0, ry); y1 = Math.max(y1, ry + rh); x0 = Math.min(x0, rx); x1 = Math.max(x1, rx + rw); }
    return { x0, x1, y0, y1 };
  };
  const offenders = [];
  for (const spec of mountable) {
    const a = bboxOf(spec, false), b = bboxOf(spec, true);
    if (!(a.y0 - b.y0 === 8 && a.y1 - b.y1 === 8)) offenders.push(spec.id + ' dy=' + (a.y0 - b.y0) + '/' + (a.y1 - b.y1));
    if (a.x0 !== b.x0 || a.x1 !== b.x1) offenders.push(spec.id + ' shifted sideways when mounted');
  }
  A.eq(offenders, [], 'mounting lifts a prop by exactly SURFACE_RISE=8px and does not move it sideways');
}

/* Exercise the browser silhouette path too: repeated instances share geometry,
   mounted/flat props do not cast a second deck shadow, and drawing resumes on
   the caller's context after rendering a mask offscreen. */
{
  const previousCreate = document.createElement;
  let allocations = 0;
  document.createElement = () => {
    allocations++;
    const g = recorder();
    return { width: 0, height: 0, getContext: () => g };
  };
  try {
    const ctx = recorder(), images = [];
    ctx.transform = () => {};
    ctx.drawImage = (mask) => images.push(mask);
    PS.setCtx(ctx);
    const f = { t: 'desk', x: 3, y: 4, w: 2, h: 1 };
    PS.drawShadow(f);
    const firstAllocations = allocations;
    PS.drawShadow({ ...f, x: 8, id: 'another-desk' });
    A.ok(images.length === 2 && images.every(mask => mask === images[0]), 'instances reuse one raster containing both projected shadow layers');
    A.eq(allocations, firstAllocations, 'cached shadow does not allocate another canvas per frame or instance');
    const count = images.length;
    PS.drawShadow(f, 'surface');
    const flat = PS.CATALOG.find(c => c.flat);
    PS.drawShadow({ t: flat.id, x: 0, y: 0, w: flat.w, h: flat.h });
    A.eq(images.length, count, 'mounted items and flat decals do not project deck shadows');
    PS.draw(f, false);
    A.ok(ctx.rects.length >= MIN_RECTS || images.length > count, 'mask rendering restores the caller context for subsequent painted or cached sprites');
  } finally { document.createElement = previousCreate; }
}

A.report('prop-render-smoke');
