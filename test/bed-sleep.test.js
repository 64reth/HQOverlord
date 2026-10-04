/* test/bed-sleep.test.js — AN AGENT SLEEPS IN THE BED (2026-08-10).

   Before this, a placed BED was somewhere a dormant body stood NEXT TO: planBedSleep walked it to an
   adjacent tile and powered it down on its feet, because the seat law (rightly) bans the chair-sit pose
   on a mattress. The Commander asked for the real thing — in the bed, under the red covers, head poking
   out — so the bed now paints in TWO passes with the body between them, and the nap has its own idle
   lane instead of riding the rarely-fired drift-mood power-down.

   The render half below is executable (the propsprites module runs bare in node); the behavior half is
   a source lock, because world.js is a browser module with no headless harness. Both halves guard the
   same failure: a quilt that paints over nothing, or a body posed on a bed it never claimed. */
'use strict';
const A = require('./_assert.js');
const path = require('node:path');
const fs = require('node:fs');

const utilSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'util.js'), 'utf8');
global.window = global.window || { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = global.document || { addEventListener() {}, documentElement: { style: { setProperty() {} } }, createElement: () => ({ getContext: () => null, style: {} }) };
global.U = new Function(utilSrc + '; return U;')();

const PS = require('../frontend/app/propsprites.js');
const TILE = PS.TILE;

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
    translate: noop, scale: noop, rotate: noop, fillText: noop, measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: noop, getImageData: () => ({ data: [] }), putImageData: noop,
  };
}

const TX = 3, TY = 3;
const bed = extra => Object.assign({ t: 'bunk', x: TX, y: TY, w: 2, h: 2, id: 'b1' }, extra);
const X = TX * TILE, Y = TY * TILE, H = 2 * TILE;
const QUILT_TOP = Y + 7, PLANE_BOTTOM = Y + H - 8;     // the quilt's own band on the bed's top plane
function paint(fn) { const ctx = recorder(); PS.setCtx(ctx); PS.setNow(2400); fn(); return ctx.rects; }
const inBand = (r, y0, y1) => r[1] >= y0 && r[1] + r[3] <= y1 + 1;

/* ---- the empty bed is unchanged: one call, quilt included ---- */
{
  const plain = paint(() => PS.draw(bed(), false));
  A.ok(plain.length > 40, 'the bed paints (' + plain.length + ' rects)');
  A.ok(plain.some(r => inBand(r, QUILT_TOP, PLANE_BOTTOM)), 'an empty bed has its quilt on');
  const noFlag = paint(() => PS.draw(bed({ sleeper: false }), false));
  A.eq(noFlag.length, plain.length, 'sleeper:false is byte-for-byte the old bed');
}

/* ---- OCCUPIED: the base pass holds the quilt back, and keeps the pillow ---- */
{
  const plain = paint(() => PS.draw(bed(), false));
  const base = paint(() => PS.draw(bed({ sleeper: true }), false));
  A.ok(base.length < plain.length, 'the occupied base pass paints less than a made bed (the quilt is held back)');
  // (the band stops one row short of the plane's bottom edge: that last row is the mattress edge's own
  // contact shadow, part of the frame's south face, and it belongs under the body like the pillow does)
  const quiltRows = base.filter(r => inBand(r, QUILT_TOP + 2, PLANE_BOTTOM - 2));
  A.eq(quiltRows.length, 0, 'nothing of the quilt band is painted UNDER the body');
  A.ok(base.some(r => inBand(r, Y, Y + 6)), 'the PILLOW is still painted under the body — the head lies on it');
  A.ok(base.some(r => r[1] >= PLANE_BOTTOM), 'the south face still paints (the bed keeps its body)');
}

/* ---- the overlay pass puts the covers back OVER the body ---- */
{
  A.eq(PS.hasOver('bunk'), true, 'the bed registers an overlay pass');
  A.eq(PS.hasOver('rug'), false, 'a prop with nothing to cover does not');
  const over = paint(() => PS.drawOver(bed({ sleeper: true })));
  A.ok(over.length >= 10, 'the covers actually paint (' + over.length + ' rects)');
  for (const r of over) {
    A.ok(r[0] >= X - 2 && r[0] + r[2] <= X + 2 * TILE + 2, 'the quilt stays on the bed (x)');
    A.ok(inBand(r, QUILT_TOP - 2, PLANE_BOTTOM), 'the quilt stays in its own band — it must never cover the pillow');
  }
  // the head end is exactly what is left uncovered: that IS "head poking out"
  const covers = over.reduce((n, r) => Math.min(n, r[1]), Infinity);
  A.ok(covers >= Y + 6, 'the covers start below the pillow (' + (covers - Y) + 'px in)');
}

/* ---- the sleeper's swell BREATHES: the same bed, two moments, is not the same picture ---- */
{
  const at = t => { const ctx = recorder(); PS.setCtx(ctx); PS.setNow(t); PS.drawOver(bed({ sleeper: true })); return JSON.stringify(ctx.rects); };
  A.ok(at(0) !== at(3200), 'the quilt over a sleeping body moves between breaths');
}

/* ---- drawOver is inert for anything with no overlay, and for a missing prop ---- */
{
  A.eq(paint(() => PS.drawOver({ t: 'rug', x: TX, y: TY, w: 4, h: 3 })).length, 0, 'no overlay registered => paints nothing');
  A.eq(paint(() => PS.drawOver({ t: 'nope', x: TX, y: TY, w: 1, h: 1 })).length, 0, 'an unknown type is a no-op, not a throw');
  A.eq(paint(() => PS.drawOver(null)).length, 0, 'and so is nothing at all');
}

/* ---- the BED stays solid: you sleep IN it, you do not walk THROUGH it ---- */
{
  const row = PS.CATALOG.find(c => c.id === 'bunk');
  A.ok(row, 'the bed is still in the catalog');
  A.eq(row.blocks, true, 'a bed is furniture, not floor paint');
  A.eq(row.use && row.use.kind, 'bed', 'and it still carries the use row planBedSleep looks for');
  A.eq(!!(row.use && row.use.sit), false, 'the bed never sets sit — the lying pose is not the chair pose');
}

/* ---- the world layer: the pose, the dwell, and every way out of it ---- */
{
  const world = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'world.js'), 'utf8');

  // getting IN: the plan claims a mattress and seeds the render anchor, but the POSE is earned by
  // arriving. Setting `lying` at plan time teleported the body into the bed the moment it decided to
  // nap and the walk never rendered — reproduced live 2026-08-10 (dev/bed-click-repro.mjs), which is
  // why these two assertions are split and why the planner is checked for the ABSENCE of the flag.
  A.ok(/self\.pendSeat = bedAnchor\(bed, self\);/.test(world), 'planBedSleep seeds the render anchor');
  const planner = world.slice(world.indexOf('function planBedSleep'), world.indexOf('function sleep(now)'));
  A.ok(planner.length > 200, 'found the planner body');
  A.eq(/self\.lying\s*=\s*true/.test(planner), false, 'the PLAN never sets the pose — a body walking to bed is drawn walking');
  A.ok(/takeSeat\(\);\s*\n\s*self\.lying = !!\(self\.seated && self\.seatKey\);/.test(world), 'ARRIVING sets it, off the seat takeSeat() actually granted');
  A.ok(/function bedAnchor\(bed, who\)/.test(world), 'the head anchor is derived, not hardcoded per skin');
  A.ok(/who\.seatPy - who\.visTopPy/.test(world), 'it measures the body as actually drawn (skins differ in height)');

  // the DWELL: 3-10 minutes in a bed, and the old ~1 minute standing power-down otherwise
  A.ok(/self\.lying \? U\.irnd\(180000, 600000\) : U\.irnd\(26000, 62000\)/.test(world), 'a bed sleep lasts 3-10 minutes; a standing power-down does not');

  // getting OUT: both claim-drop paths must clear the pose, or a woken body keeps drawing in the bed
  // matched by CLAIM-DROP + the flag, never by the whole line: every seat lane adds fields to these two
  // (seatLift arrived with the stool perch and broke both of these on the very next trunk sync), and the
  // invariant is "dropping the claim drops the pose", not the field order it drops them in.
  A.ok(/function releaseSeat\(\)[\s\S]{0,400}?self\.lying = false;/.test(world), 'releaseSeat clears the lying pose');
  A.ok(/function seizeFromIdle\(b\)[\s\S]{0,400}?b\.lying = false;/.test(world), 'a summon-seize clears it too');
  A.ok(/if \(now >= self\.studyUntil\) \{ releaseSeat\(\);/.test(world), 'the nap ends through releaseSeat (no leaked mattress claim)');

  // WAKING is the summon path's job — the two seizes that cover a typed prompt, a schedule and a channel
  A.ok(/if \(working\) \{ b\.target = null; b\.pathPts = null; seizeFromIdle\(b\); \}/.test(world), 'a crew body is seized out of bed when its run starts');
  A.ok(/activity === 'task' && agent\.goal !== 'work'[\s\S]{0,200}releaseSeat\(\)/.test(world), 'the hero is seized out of bed when it is summoned');

  // the NAP lane itself
  A.ok(/idleAge > 120000 && now >= \(self\.napCd \|\| 0\) && U\.chance\(0\.5\) && planBedSleep\(now\)/.test(world), 'a long-idle body periodically goes to bed');
  A.ok(/self\.napCd = now \+ U\.irnd\(420000, 900000\)/.test(world), 'and then leaves it alone for a while');

  // the two-pass render, in the right order
  A.ok(/if \(sleeper\) dp = Object\.assign\(.*\{ sleeper: true \}\)/.test(world), 'the bed is told it is occupied');
  A.ok(/items\.push\(\{ y: sy \+ 0\.75, draw: \(\) => PropSprites\.drawOver\(dp\) \}\)/.test(world), 'the covers sort AFTER the body (sy+0.75 > the sleeper at sy+0.5)');
  A.ok(/y: \(bed\.y \+ \(bed\.h \|\| 1\)\) \* T \+ 0\.5, draw: \(\) => drawSleeper\(now, b, bed\)/.test(world), 'the sleeper sorts INSIDE its bed');
  A.ok(/function lyingBed\(b\)/.test(world) && /b\.goal !== 'sleep' \|\| !b\.usingProp/.test(world), 'the pose is re-derived from live state every frame, never trusted from a flag');
  A.ok(/ctx\.clip\(\);\s*\n\s*drawAgent\(now, who\);/.test(world), 'the sleeper is clipped to the mattress so no body hangs off the foot of the bed');
}

A.report('bed-sleep');
