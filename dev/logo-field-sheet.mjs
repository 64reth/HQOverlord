// dev/logo-field-sheet.mjs — look at the perceived-density field before tracing anything.
//
// KEEP THIS: dev/trace-logo.mjs cites it as where its (sigma, iso) constants come from, and it is
// the fastest way to re-answer "what would a different threshold give?" without touching the tracer.
// Emits one stacked contact sheet: the raw field on top, then the same field thresholded at a
// sweep of (sigma, iso) so the letterform that will be traced is visible as a shape, not a guess.
// The sigma=0 rows are the raw ASCII-dash mosaic — that is the texture the shipped `mosaic` preset
// keeps, and seeing it here is what led to it.
//   node dev/logo-field-sheet.mjs [outPath]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodePNG } from '../scripts/lib/png.mjs';
import { toRGBA, contentBBox, crop, densityField, blurField, normalizeField, encodePNG } from './lib/logofield.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || path.join(REPO, 'logo-field-sheet.png');

const FH = 100;                                  // field height — ~3.3x the 30px CSS box
const SCALE = 2;                                 // nearest upscale so the shape is visible
const COMBOS = [
  { sigma: 0.0, iso: 0.30 }, { sigma: 0.0, iso: 0.45 }, { sigma: 0.0, iso: 0.60 },
  { sigma: 1.2, iso: 0.30 }, { sigma: 1.2, iso: 0.45 }, { sigma: 1.2, iso: 0.60 },
  { sigma: 2.5, iso: 0.30 }, { sigma: 2.5, iso: 0.45 }, { sigma: 2.5, iso: 0.60 },
];

const master = toRGBA(decodePNG(readFileSync(path.join(REPO, 'frontend/assets/brand/starnet-logo.png'))));
const art = crop(master, contentBBox(master));
const FW = Math.round(art.width * FH / art.height);
const raw = densityField(art, FW, FH);

const rows = [{ label: 'raw density', f: normalizeField(raw).field, iso: null }];
for (const { sigma, iso } of COMBOS) {
  const { field } = normalizeField(blurField(raw, FW, FH, sigma));
  rows.push({ label: `sigma=${sigma} iso=${iso}`, f: field, iso });
}

const W = FW * SCALE, RH = FH * SCALE, H = rows.length * RH;
const data = Buffer.alloc(W * H * 4);
rows.forEach((row, r) => {
  for (let y = 0; y < RH; y++) for (let x = 0; x < W; x++) {
    const v = row.f[Math.floor(y / SCALE) * FW + Math.floor(x / SCALE)];
    const d = ((r * RH + y) * W + x) * 4;
    if (row.iso == null) { const g = Math.round(Math.min(1, v) * 255); data[d] = g; data[d + 1] = g; data[d + 2] = g; }
    else if (v >= row.iso) { data[d] = 255; data[d + 1] = 178; data[d + 2] = 46; }
    else { data[d] = 10; data[d + 1] = 12; data[d + 2] = 14; }
    data[d + 3] = 255;
  }
});
writeFileSync(OUT, encodePNG({ width: W, height: H, data }));
console.log(`${OUT}  ${W}x${H}  field=${FW}x${FH}  rows: ${rows.map(r => r.label).join(' | ')}`);
