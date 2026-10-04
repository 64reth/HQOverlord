#!/usr/bin/env node
/* dev/worldcmp.mjs — crop the same region out of two worldshot frames, upscale by an INTEGER
 * (nearest) and lay them side by side, plus the numbers a look change has to move:
 * mean luma, luma sd (a lit room has SPREAD — a wash has none), mean chroma, % of pixels in
 * the crushed band (<12) and the lit band (>90).
 *
 *   node dev/worldcmp.mjs A.png B.png x y w h out.png [scale]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePNG } from '../scripts/lib/png.mjs';

const [A, B, X, Y, W, H, OUT, S = '2'] = process.argv.slice(2);
const x0 = +X, y0 = +Y, w = +W, h = +H, s = +S;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function px(p, x, y) { const i = (y * p.width + x) * p.channels; return [p.pixels[i], p.pixels[i + 1] ?? p.pixels[i], p.pixels[i + 2] ?? p.pixels[i]]; }
function stats(p) {
  let n = 0, sum = 0, sum2 = 0, csum = 0, dark = 0, lit = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const [r, g, b] = px(p, x, y);
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    n++; sum += L; sum2 += L * L; csum += Math.max(r, g, b) - Math.min(r, g, b);
    if (L < 12) dark++; if (L > 90) lit++;
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  return { mean: +mean.toFixed(1), sd: +sd.toFixed(1), chroma: +(csum / n).toFixed(1), crushed: +(100 * dark / n).toFixed(1) + '%', lit: +(100 * lit / n).toFixed(1) + '%' };
}
const pa = decodePNG(readFileSync(A)), pb = decodePNG(readFileSync(B));
const OW = w * s * 2 + 4, OH = h * s;
const out = Buffer.alloc(OW * OH * 3);
for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
  let c = [255, 0, 255];
  if (x < w * s) c = px(pa, x0 + Math.floor(x / s), y0 + Math.floor(y / s));
  else if (x >= w * s + 4) c = px(pb, x0 + Math.floor((x - w * s - 4) / s), y0 + Math.floor(y / s));
  const o = (y * OW + x) * 3; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
}
writeFileSync(OUT, encodePNG(out, OW, OH));
console.log(JSON.stringify({ A: stats(pa), B: stats(pb) }, null, 0));
