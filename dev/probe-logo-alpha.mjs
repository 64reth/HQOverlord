// dev/probe-logo-alpha.mjs — what does the master brand art's alpha actually look like?
//
// KEEP THIS: dev/trace-logo.mjs cites it as the provenance of its whole approach. It answers the
// question that decides the algorithm — are the letters SOLID (alpha~255 across the body, dark
// digits painted IN colour) or a SPARSE MOSAIC of separate opaque glyphs? The answer is mosaic:
// only ~4.5% of pixels clear alpha 96, and a mid-height scanline is 2-8px strokes separated by
// 50-200px voids, because the letters are hollow outlines drawn out of scattered digits. That is
// why the tracer works on a perceived-density field and never thresholds raw alpha. Re-run it
// before trusting any claim about the master art's structure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodePNG } from '../scripts/lib/png.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const png = decodePNG(readFileSync(path.join(REPO, 'frontend/assets/brand/starnet-logo.png')));
const { width: w, height: h, channels, pixels } = png;
console.log(`master ${w}x${h} channels=${channels}`);

const A = (x, y) => channels === 4 ? pixels[(y * w + x) * 4 + 3] : 255;
const RGB = (x, y) => { const d = (y * w + x) * channels; return [pixels[d], pixels[d + 1], pixels[d + 2]]; };

// 1. alpha histogram in 16 buckets
const hist = new Array(16).fill(0);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hist[Math.min(15, A(x, y) >> 4)]++;
console.log('alpha histogram (16 buckets, 0..255):');
hist.forEach((n, i) => console.log(`  ${String(i * 16).padStart(3)}-${String(i * 16 + 15).padStart(3)}: ${String(n).padStart(8)}  ${(100 * n / (w * h)).toFixed(2)}%`));

// 2. luminance histogram of the OPAQUE pixels — if the digits are dark-on-orange this is bimodal
const lum = new Array(16).fill(0);
let opaque = 0;
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  if (A(x, y) < 200) continue;
  opaque++;
  const [r, g, b] = RGB(x, y);
  lum[Math.min(15, Math.round(0.299 * r + 0.587 * g + 0.114 * b) >> 4)]++;
}
console.log(`\nluminance of the ${opaque} pixels with alpha>=200:`);
lum.forEach((n, i) => console.log(`  ${String(i * 16).padStart(3)}-${String(i * 16 + 15).padStart(3)}: ${String(n).padStart(8)}  ${(100 * n / Math.max(1, opaque)).toFixed(2)}%`));

// 3. horizontal run-length of TRANSPARENT gaps strictly inside the mark's row extent —
//    this is the gap the morphological close has to bridge.
const gaps = [];
for (let y = 0; y < h; y++) {
  let first = -1, last = -1;
  for (let x = 0; x < w; x++) if (A(x, y) > 96) { if (first < 0) first = x; last = x; }
  if (first < 0) continue;
  let run = 0;
  for (let x = first; x <= last; x++) {
    if (A(x, y) <= 96) run++;
    else { if (run > 0) gaps.push(run); run = 0; }
  }
}
gaps.sort((a, b) => a - b);
const pct = p => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] || 0;
console.log(`\ninterior transparent horizontal runs: n=${gaps.length}  p50=${pct(0.5)} p75=${pct(0.75)} p90=${pct(0.9)} p95=${pct(0.95)} p99=${pct(0.99)} max=${gaps[gaps.length - 1]}`);

// 4. a middle scanline, run-length encoded, so the structure is visible as text
const mid = Math.round(h * 0.5);
let rle = '', cur = A(0, mid) > 96, n = 0;
for (let x = 0; x < w; x++) {
  const on = A(x, mid) > 96;
  if (on === cur) n++; else { rle += `${cur ? '#' : '.'}${n} `; cur = on; n = 1; }
}
rle += `${cur ? '#' : '.'}${n}`;
console.log(`\nscanline y=${mid} RLE (#=opaque .=transparent):\n${rle}`);
