#!/usr/bin/env node
// dev/trace-logo.mjs — trace the STARNET wordmark's OWN letterforms out of the master art into SVG.
//
// This is NOT a redraw. The redrawn `starnet-mark.svg` (00fca6e8) was REVERTED by Andrew (661ad745)
// because the brand IS this art — different letterforms are a different brand. Every coordinate this
// script emits is derived from frontend/assets/brand/starnet-logo.png and nothing else.
//
// WHY a trace at all: the master is a SPARSE ASCII-digit mosaic — only ~4.5% of its pixels clear
// alpha 96, and a mid-height scanline is 2-8px strokes separated by 50-200px voids (the letters are
// hollow outlines drawn out of scattered digits; see dev/probe-logo-alpha.mjs). Minified to the 30px
// topbar that mosaic averages to gray speckle, which is the "placed PNG" look. bake-logo-small.mjs
// fights it with a pre-baked bitmap, but a bitmap is still one fixed resolution and one fixed colour.
//
// The pipeline:
//   alpha coverage -> PERCEIVED-DENSITY field (area-average to ~the size the eye reads it at, which
//   is exactly what the browser's minification does) -> Gaussian fuse -> normalize -> marching-squares
//   isoline at `iso` -> corner-preserving smooth -> RDP simplify -> SVG path, evenodd, currentColor.
//
// The (sigma, iso) default comes from the sweep in dev/logo-field-sheet.mjs: at field height 100,
// sigma 1.2 / iso 0.30 closes every stroke while keeping the counters and the star in the A open.
// Both scale with field height, so FH only buys contour precision — never a different shape.
//
// smooth/eps come from a second sweep, after Andrew called the first cut "rough on the edges": the
// isoline of a mosaic-derived field ripples along every straight run. Raising SIGMA flattens the
// ripple but is the wrong lever — by 1.8 the four-pointed star in the A has collapsed to a diamond.
// Smoothing the CONTOUR (never the field) fixes the edges and leaves the star at 11 loops, the same
// topology the unsmoothed trace produced.
//
//   node dev/trace-logo.mjs [out.svg] [--preset=mosaic|solid] [--fh=] [--sigma=] [--iso=]
//                           [--eps=] [--smooth=] [--corner=] [--min-area=]
// The preset defaults ARE the shipped asset — a bare run reproduces
// frontend/assets/brand/starnet-wordmark.svg. Individual flags override the preset.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodePNG } from '../scripts/lib/png.mjs';
import { toRGBA, contentBBox, crop, densityField, blurField, normalizeField } from './lib/logofield.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const OUT = argv.find(a => !a.startsWith('--')) || path.join(REPO, 'frontend/assets/brand/starnet-wordmark.svg');

/* TWO RENDERING INTENTS, both traced from the same master, both legal (neither redraws anything).
   They are presets rather than loose flags because each is a tuned SET — mixing one's sigma with
   the other's min-area produces garbage, and this file has already been re-tuned twice.

   mosaic — KEEP the ASCII-dash texture. Barely any fuse, low threshold, no contour smoothing, and a
     min-area small enough to preserve individual dashes. The catch is SIZE: traced at the master's
     own dash scale the texture is gorgeous from ~56px up and turns to dim mush by 30px, which is
     the original placed-PNG problem. fh160 is the coarsening lever — averaging the field down to
     160 rows merges neighbouring dashes into fewer, fatter ones that still read as a mosaic at the
     topbar's 24-30px. Do NOT raise fh here expecting "more detail"; it buys finer dashes that the
     topbar cannot resolve, which is exactly backwards.
   solid — the smooth outline: fuse the mosaic into one stroke and smooth the contour. Kept because
     it is the legible floor if the mark ever has to go smaller than 24px. */
const PRESETS = {
  mosaic: { fh: 160, sigma: 0.40, iso: 0.22, eps: 0.25, minArea: 0.12, smooth: 0, corner: 32 },
  solid: { fh: 480, sigma: 1.2, iso: 0.30, eps: 1.6, minArea: 6, smooth: 24, corner: 32 },
};
const PRESET_NAME = (argv.find(a => a.startsWith('--preset=')) || '--preset=mosaic').split('=')[1];
const P = PRESETS[PRESET_NAME];
if (!P) throw new Error(`unknown --preset=${PRESET_NAME}; known: ${Object.keys(PRESETS).join(', ')}`);

const FH = flag('fh', P.fh);              // trace-field height — for `mosaic` this is the dash scale
const SIGMA100 = flag('sigma', P.sigma);  // fuse radius EXPRESSED AT field height 100
const ISO = flag('iso', P.iso);           // density threshold on the normalized field
const EPS100 = flag('eps', P.eps);        // RDP tolerance, also expressed at field height 100
const MIN_AREA100 = flag('min-area', P.minArea); // drop loops smaller than this (field-100 px^2)
const SMOOTH = flag('smooth', P.smooth);  // corner-preserving low-pass passes over each contour
const CORNER_DEG = flag('corner', P.corner); // a turn sharper than this is a CORNER — never smoothed

/* ---------- marching squares: isolines of a scalar field, linearly interpolated ----------
   Samples are pixel CENTRES, so the cell grid is (w-1) x (h-1). Saddle cases (5, 10) are resolved
   by the cell's centre average — the standard disambiguation, and the one that keeps a thin
   diagonal stroke connected instead of pinching it into two touching corners. */
const CASES = [
  [], [[3, 0]], [[0, 1]], [[3, 1]], [[1, 2]], null, [[0, 2]], [[3, 2]],
  [[2, 3]], [[2, 0]], null, [[2, 1]], [[1, 3]], [[1, 0]], [[0, 3]], [],
];

function isolines(f, w, h, iso) {
  const at = (x, y) => f[y * w + x];
  const segs = [];
  // edge id: 0=top 1=right 2=bottom 3=left, resolved to a point in field coords
  const point = (x, y, edge) => {
    const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
    const t = (a, b) => (Math.abs(b - a) < 1e-9 ? 0.5 : (iso - a) / (b - a));
    if (edge === 0) return [x + t(tl, tr), y];
    if (edge === 1) return [x + 1, y + t(tr, br)];
    if (edge === 2) return [x + t(bl, br), y + 1];
    return [x, y + t(tl, bl)];
  };
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
    const idx = (tl >= iso ? 1 : 0) | (tr >= iso ? 2 : 0) | (br >= iso ? 4 : 0) | (bl >= iso ? 8 : 0);
    let pairs = CASES[idx];
    if (pairs === null) {   // saddle — the centre decides which way the two strokes connect
      const centre = (tl + tr + br + bl) / 4 >= iso;
      pairs = idx === 5 ? (centre ? [[3, 0], [1, 2]] : [[3, 2], [1, 0]])
                        : (centre ? [[0, 1], [2, 3]] : [[0, 3], [2, 1]]);
    }
    for (const [a, b] of pairs) segs.push([point(x, y, a), point(x, y, b)]);
  }
  return segs;
}

/** Stitch unordered segments into closed loops by endpoint identity. */
function stitch(segs) {
  const K = p => `${Math.round(p[0] * 4096)},${Math.round(p[1] * 4096)}`;
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = K(p);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Array(segs.length).fill(false);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const loop = [segs[i][0], segs[i][1]];
    for (;;) {
      const tail = loop[loop.length - 1];
      const cand = (ends.get(K(tail)) || []).find(j => !used[j]);
      if (cand === undefined) break;
      used[cand] = true;
      const [a, b] = segs[cand];
      loop.push(K(a) === K(tail) ? b : a);
      if (K(loop[loop.length - 1]) === K(loop[0])) break;   // closed
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

/* Corner-preserving low-pass along the contour.
   The isoline of a mosaic-derived field WOBBLES: what the art draws as one straight edge comes out
   as a ripple of ±half a field pixel, and RDP faithfully preserves every bump of it. Blurring the
   FIELD harder would flatten the ripple, but it also destroys the four-pointed star in the A (it
   goes to a diamond by sigma 1.8) — the field blur is not the lever.
   So smooth the CURVE instead, and only where it is trying to be straight: at each vertex compare
   the incoming and outgoing directions, and apply a [1 2 1] average only if the turn is gentler
   than `cornerDeg`. Hard corners, chamfers and the star's points all exceed it and are left exactly
   where the trace put them. */
function smoothContour(pts, passes, cornerDeg) {
  if (!(passes > 0) || pts.length < 5) return pts;
  const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
  let ring = closed ? pts.slice(0, -1) : pts.slice();
  const n = ring.length;
  if (n < 5) return pts;
  const cosMin = Math.cos(cornerDeg * Math.PI / 180);
  const unit = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    return L < 1e-9 ? null : [dx / L, dy / L];
  };
  for (let p = 0; p < passes; p++) {
    const next = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], v = ring[i], b = ring[(i + 1) % n];
      const d1 = unit(a, v), d2 = unit(v, b);
      if (!d1 || !d2 || d1[0] * d2[0] + d1[1] * d2[1] < cosMin) { next[i] = v; continue; }
      next[i] = [(a[0] + 2 * v[0] + b[0]) / 4, (a[1] + 2 * v[1] + b[1]) / 4];
    }
    ring = next;
  }
  return closed ? ring.concat([ring[0]]) : ring;
}

/** Ramer-Douglas-Peucker. Straight edges and hard corners are the whole character of this
    wordmark, so simplification must PRESERVE corners — which is exactly what RDP does. */
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    if (L < 1e-12) return (p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L;
    t = Math.max(0, Math.min(1, t));
    return (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let best = -1, bd = eps * eps;
    for (let k = i + 1; k < j; k++) {
      const d = d2(pts[k], pts[i], pts[j]);
      if (d > bd) { bd = d; best = k; }
    }
    if (best > 0) { keep[best] = true; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = pts => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
};

// ---------- run ----------
const master = toRGBA(decodePNG(readFileSync(path.join(REPO, 'frontend/assets/brand/starnet-logo.png'))));
const box = contentBBox(master);
const art = crop(master, box);
const FW = Math.round(art.width * FH / art.height);
const k = FH / 100;                      // every tuned constant is expressed at field height 100
const { field } = normalizeField(blurField(densityField(art, FW, FH), FW, FH, SIGMA100 * k));

// Smooth BEFORE simplifying: RDP measures deviation from the polyline it is given, so wobble that
// is still present at that point gets preserved as vertices instead of averaged away.
const loops = stitch(isolines(field, FW, FH, ISO))
  .map(l => rdp(smoothContour(l, SMOOTH, CORNER_DEG), EPS100 * k))
  .filter(l => l.length > 3 && area(l) >= MIN_AREA100 * k * k);

const n = v => (Math.round(v * 100) / 100).toString();
const d = loops.map(l => 'M' + l.map(p => `${n(p[0])} ${n(p[1])}`).join('L') + 'Z').join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FW} ${FH}" role="img" aria-label="STARNET">
<title>STARNET</title>
<!-- Traced from frontend/assets/brand/starnet-logo.png by dev/trace-logo.mjs, preset ${PRESET_NAME}
     (field ${FW}x${FH}, sigma ${SIGMA100}@100, iso ${ISO}, rdp ${EPS100}@100, smooth ${SMOOTH}).
     These are the master art's OWN forms recovered from its perceived-density field, not a redraw.
     Regenerate, never hand-edit; rerun the script if the master ever changes.
     NB: no double hyphen anywhere in this comment. XML forbids it, an SVG that trips it fails to
     parse, and a CSS mask whose image fails to parse renders the masked element INVISIBLE. -->
<path fill="currentColor" fill-rule="evenodd" d="${d}"/>
</svg>
`;
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(JSON.stringify({
  out: path.relative(REPO, OUT), field: [FW, FH], contentBox: box,
  loops: loops.length, points: loops.reduce((s, l) => s + l.length, 0), bytes: Buffer.byteLength(svg),
}, null, 2));
