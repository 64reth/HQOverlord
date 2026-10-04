// dev/skin-staff-repair.mjs — repair the voidwizard's staff, which the 8-direction rebuild
// (ec7bc352b) left in three different broken states depending on which way he faces.
//
// Measured before touching anything (dev/skin-orphan-audit.mjs + per-frame pixel dumps):
//
//   walk.north-west x6  a DETACHED POLE. A dead-straight 3px bar at x=33..35 spanning the whole
//                       frame (y=24..68) while the body starts at x=36 and the hand-grip sits at
//                       x~44. It only reads as "attached" to a connected-component check because
//                       the hat brim's outline overlaps its right column for four rows — which is
//                       why the orphan audit missed it and a human did not. THE FLOATING STICK.
//   walk.west x6        the shaft is in the RIGHT PLACE (a continuous diagonal from the hand down
//                       to the floor) but painted in the outline colour, so all that shows against
//                       a dark floor is the orange-red tip: a second floating stick. No gem.
//   rot.north           the staff is an 8px STUB (y=40..47) hanging off the robe's edge and
//                       stopping in mid-air, while walk.north carries a full shaft to the floor.
//
// Repairs, least invasive that works:
//   CUT     the detached pole, keeping any of its columns that the body genuinely needs as outline
//   PAINT   the unfilled hairline shaft in the staff's own brown, and cap it with the green gem,
//           both sampled from that skin's OWN clean art (rot.west) — never a literal
//   EXTEND   the stub down the robe's edge to the floor line, in its own measured colours
//
// Usage: node dev/skin-staff-repair.mjs [--dry]     (--dry writes nothing, prints the plan)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRGBA, writeRGBA, px, setPx, clearPx, isInk } from './lib/pixpng.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'assets', 'sprites');
const DRY = process.argv.includes('--dry');
const F = (set, name) => path.join(ROOT, set, name + '.png');

const isBlack = p => p.a > 16 && Math.max(p.r, p.g, p.b) < 48;
const isFill = p => p.a > 16 && Math.max(p.r, p.g, p.b) >= 48;
const isWarm = p => p.a > 16 && p.r > 60 && p.r > p.b * 1.25 && p.r >= p.g && (Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)) > 18;

function save(file, im, note) {
  if (!DRY) writeRGBA(file, im);
  console.log(`${DRY ? 'would fix' : 'fixed   '}  ${path.relative(ROOT, file).padEnd(42)} ${note}`);
}

// ---------------------------------------------------------------- 1. CUT the detached pole
// Find a dead-straight vertical bar at the frame margin that is clear of the body, and cut it.
// A column of the bar is kept only where the body's own ink sits immediately to its right —
// there the pixel is doing double duty as the hat brim's outline and must survive.
function cutPole(file, { maxW = 3, minRun = 24, footY = 68 } = {}) {
  const im = readRGBA(file);
  const colTop = [], colBot = [], colN = [];
  for (let x = 0; x < im.width; x++) {
    let top = -1, bot = -1, n = 0;
    for (let y = 0; y < im.height; y++) if (isInk(im, x, y)) { if (top < 0) top = y; bot = y; n++; }
    colTop[x] = top; colBot[x] = bot; colN[x] = n;
  }
  const first = colN.findIndex(n => n > 0);
  if (first < 0) return null;
  // the bar is the leading column group whose ink runs nearly the full frame height
  let barEnd = first;
  while (barEnd + 1 < im.width && colN[barEnd + 1] > 0 && (barEnd + 1 - first) < maxW) barEnd++;
  const barH = Math.max(...colN.slice(first, barEnd + 1));
  if (barH < minRun) return null;
  // and is separated from the body: the next column after the group must be mostly empty
  const bodyStart = barEnd + 1;
  if (colN[bodyStart] > barH * 0.5) return null;

  let cut = 0, kept = 0;
  for (let x = first; x <= barEnd; x++) {
    for (let y = 0; y < im.height; y++) {
      if (!isInk(im, x, y)) continue;
      // keep a pixel the body still needs as its own left outline
      if (isInk(im, x + 1, y) && x + 1 > barEnd) { kept++; continue; }
      clearPx(im, x, y); cut++;
    }
  }
  // RE-ANCHOR. The pole ran to the floor line in every frame, so it — not the feet — was what
  // assemble8's place() pinned to FOOT_Y. Cutting it exposed a 1px foot wobble the pole had been
  // masking (the live check caught frame bottoms landing 67/68), which renders as a body bobbing
  // off its own contact shadow. Drop each frame back onto the shared floor line.
  let bot = -1;
  for (let y = im.height - 1; y >= 0 && bot < 0; y--) {
    for (let x = 0; x < im.width; x++) if (isInk(im, x, y)) { bot = y; break; }
  }
  let shifted = 0;
  if (bot >= 0 && bot < footY) {
    const dy = footY - bot;
    const stride = im.width * 4;
    for (let y = im.height - 1; y >= 0; y--) {
      const src = y - dy;
      if (src >= 0) im.data.copy(im.data, y * stride, src * stride, (src + 1) * stride);
      else im.data.fill(0, y * stride, (y + 1) * stride);
    }
    shifted = dy;
  }
  return {
    im,
    note: `cut pole x=${first}..${barEnd} (${cut}px cut, ${kept}px kept as body outline` +
      (shifted ? `, body re-anchored +${shifted}px to the floor line` : '') + ')',
  };
}

// ------------------------------------------------- 2. PAINT the unfilled hairline shaft + gem
// An outline-coloured pixel that borders no fill at all is not an outline — it is a line the
// generator forgot to colour in. Collect those, keep the long thin runs (a shaft), and paint
// them in the staff brown this skin already uses in its clean art.
function hairlines(im) {
  const cand = [];
  const mark = new Uint8Array(im.width * im.height);
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) {
    if (!isBlack(px(im, x, y))) continue;
    let touchesFill = false;
    for (let dy = -1; dy <= 1 && !touchesFill; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= im.width || ny >= im.height) continue;
      if (isFill(px(im, nx, ny))) { touchesFill = true; break; }
    }
    if (!touchesFill) { mark[y * im.width + x] = 1; cand.push([x, y]); }
  }
  // group into 8-connected runs, keep the ones that are long and thin (a shaft, not a blob)
  const seen = new Uint8Array(im.width * im.height);
  const runs = [];
  for (const [sx, sy] of cand) {
    if (seen[sy * im.width + sx]) continue;
    const stack = [[sx, sy]], grp = [];
    seen[sy * im.width + sx] = 1;
    while (stack.length) {
      const [x, y] = stack.pop(); grp.push([x, y]);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= im.width || ny >= im.height) continue;
        const i = ny * im.width + nx;
        if (mark[i] && !seen[i]) { seen[i] = 1; stack.push([nx, ny]); }
      }
    }
    const ys = grp.map(p => p[1]), h = Math.max(...ys) - Math.min(...ys) + 1;
    const perRow = h ? grp.length / h : 99;
    if (h >= 6 && perRow <= 3.2) runs.push(grp);
  }
  return runs;
}

function paintShaft(file, { shaft, shaftDark, gem, gemLit }) {
  const im = readRGBA(file);
  const runs = hairlines(im);
  let painted = 0;
  const all = [];
  for (const grp of runs) for (const p of grp) all.push(p);
  if (!all.length) return null;
  for (const [x, y] of all) {
    // the shaft's own left edge stays dark so it still reads as a drawn object, not a smear
    const lit = isInk(im, x + 1, y) && !isInk(im, x - 1, y);
    setPx(im, x, y, lit ? shaftDark : shaft);
    painted++;
  }
  // The generator painted the whole top of the staff orange-red. Only the CAP is the gem —
  // the rest of that warm run is shaft. Painting all of it green produced a fluorescent tube,
  // so the gem is capped at three rows and everything under it goes back to wood.
  const warm = [];
  for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) if (isWarm(px(im, x, y))) warm.push([x, y]);
  if (!warm.length) return { im, note: `painted ${painted}px shaft (no warm tip to cap)` };
  const y0 = Math.min(...warm.map(w => w[1]));
  let gemN = 0;
  for (const [x, y] of warm) {
    if (y > y0 + 2) { setPx(im, x, y, shaft); continue; }
    setPx(im, x, y, y <= y0 ? gemLit : gem); gemN++;
    // one pixel of shoulder so the cap reads as a stone, not as a thicker line
    if (y === y0 + 1 && !isInk(im, x + 1, y)) { setPx(im, x + 1, y, gem); gemN++; }
  }
  return { im, note: `painted ${painted}px shaft + ${gemN}px gem cap at y=${y0}` };
}

// ------------------------------------------------------------------- 3. EXTEND the stub
// Run the staff down the robe's edge to the frame's floor line, in the stub's own colours,
// so the idle carries the same staff its own walk cycle does.
function extendStub(file, { x, fromY, toY, core, edge }) {
  const im = readRGBA(file);
  let n = 0;
  for (let y = fromY; y <= toY; y++) {
    if (isInk(im, x, y)) continue;
    setPx(im, x, y, core);
    if (!isInk(im, x + 1, y)) setPx(im, x + 1, y, edge);
    n++;
  }
  return { im, note: `extended stub at x=${x} through y=${fromY}..${toY} (${n}px)` };
}

// ---------------------------------------------------------------------------- run
// The staff's real colours — measured, not invented: these are the most-used staff and gem
// tones across voidwizard's own clean art (rot_west / rot_south / walk_east), so the repaired
// frames cannot disagree with the frames that were already right.
const SHAFT = { r: 102, g: 57, b: 50, a: 255 };        // shaft mid  (x15 in rot_south)
const SHAFT_DARK = { r: 77, g: 43, b: 45, a: 255 };    // shaft shadow side
const GEM = { r: 104, g: 210, b: 77, a: 255 };         // gem body
const GEM_LIT = { r: 125, g: 244, b: 113, a: 255 };    // gem highlight

for (let i = 0; i < 6; i++) {
  const f = F('voidwizard', `walk_north-west_${i}`);
  const r = cutPole(f);
  if (!r) { console.log(`SKIP  walk_north-west_${i} — no detached pole found`); continue; }
  save(f, r.im, r.note);
}
for (let i = 0; i < 6; i++) {
  const f = F('voidwizard', `walk_west_${i}`);
  const r = paintShaft(f, { shaft: SHAFT, shaftDark: SHAFT_DARK, gem: GEM, gemLit: GEM_LIT });
  if (!r) { console.log(`SKIP  walk_west_${i} — no unfilled hairline found`); continue; }
  save(f, r.im, r.note);
}
{
  const f = F('voidwizard', 'rot_north');
  const r = extendStub(f, { x: 54, fromY: 48, toY: 68, core: SHAFT, edge: SHAFT_DARK });
  save(f, r.im, r.note);
}
{
  // rot.north-west was the last facing with NO staff at all (7 of 8 carry one, including its own
  // north view). Run the same shaft down the robe's free edge so the ring is complete.
  const f = F('voidwizard', 'rot_north-west');
  const r = extendStub(f, { x: 53, fromY: 40, toY: 68, core: SHAFT, edge: SHAFT_DARK });
  save(f, r.im, r.note);
}

// ------------------------------------------------------- 4. MIRROR a prop from its mirror facing
// grimreaper.rot.north-west is the same defect class as voidwizard's rot.north: the scythe is a
// bare stump on top of the hood with no shaft and no blade, while all seven other facings carry
// the full weapon. Its mirror (north-east) has a clean one, and a body seen from behind-left is
// the mirror of the same body seen from behind-right — so the weapon is lifted from there,
// flipped, and laid in BEHIND the robe (transparent pixels only, so the body always wins).
function mirrorProp(donorFile, targetFile, { pick, dx = null, dy = 0, inFront = false }) {
  const donor = readRGBA(donorFile);
  const im = readRGBA(targetFile);
  // ALIGN BY THE BODY, not by the frame. The two facings are not pixel mirrors of each other —
  // the robe sits at a different offset — so mirroring about the frame centre drops the shaft
  // inside the body and only the blade survives, which reads as a floating blade: the very
  // defect being repaired. Matching the mirrored donor's body centroid to the target's puts the
  // weapon in the same relation to the body that the donor draws it in.
  const centroid = (img, skip) => {
    let sum = 0, n = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      if (!isInk(img, x, y)) continue;
      if (skip && skip(px(img, x, y))) continue;          // the prop itself must not drag the centre
      sum += x; n++;
    }
    return n ? sum / n : img.width / 2;
  };
  if (dx == null) {
    const donorBody = donor.width - 1 - centroid(donor, pick);   // mirrored
    dx = Math.round(centroid(im, pick) - donorBody);
  }
  // the prop's own colours, plus the outline pixels hugging them, so it arrives drawn not naked
  const core = [];
  for (let y = 0; y < donor.height; y++) for (let x = 0; x < donor.width; x++) {
    if (pick(px(donor, x, y))) core.push([x, y]);
  }
  const take = new Set(core.map(([x, y]) => y * donor.width + x));
  for (const [x, y] of core) {
    for (let ddy = -1; ddy <= 1; ddy++) for (let ddx = -1; ddx <= 1; ddx++) {
      const nx = x + ddx, ny = y + ddy;
      if (nx < 0 || ny < 0 || nx >= donor.width || ny >= donor.height) continue;
      if (isBlack(px(donor, nx, ny))) take.add(ny * donor.width + nx);
    }
  }
  let laid = 0, blocked = 0;
  for (const i of take) {
    const sx = i % donor.width, sy = (i / donor.width) | 0;
    const tx = (donor.width - 1 - sx) + dx, ty = sy + dy;
    if (tx < 0 || ty < 0 || tx >= im.width || ty >= im.height) continue;
    if (isInk(im, tx, ty) && !inFront) { blocked++; continue; }   // the body is in front
    setPx(im, tx, ty, px(donor, sx, sy));
    laid++;
  }
  return { im, note: `mirrored prop from ${path.basename(donorFile)} (${laid}px laid, ${blocked}px behind the body)` };
}
{
  // the blade is the only near-white on this skin and the shaft the only brown — both measured
  // absent from north-west by dev/skin-feature-dropout.mjs before this was written
  const isBlade = p => p.a > 200 && Math.min(p.r, p.g, p.b) > 150 &&
    (Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)) < 40;
  const isShaft = p => p.a > 200 && p.r > 70 && p.r > p.b * 1.35 && p.r >= p.g;
  const f = F('grimreaper', 'rot_north-west');
  const r = mirrorProp(F('grimreaper', 'rot_north-east'), f, { pick: p => isBlade(p) || isShaft(p) });
  save(f, r.im, r.note);
}
