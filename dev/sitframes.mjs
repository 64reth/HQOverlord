#!/usr/bin/env node
/* dev/sitframes.mjs — put a skin's WEST and EAST masters side by side, upscaled, so their FACING
 * is judgeable by eye. The recliner is the first thing in the game that renders a body seated in
 * profile, which is how two mis-authored sit frames (grimreaper, endoskeleton) surfaced after
 * shipping. test/sprite-sit-facing.test.js is the machine gate; this is what you look at when it
 * fires, or when a set's silhouette is too round for the metric to read.
 *
 *   node dev/sitframes.mjs grimreaper,skeleton out.png 9        # sit frames at 9x
 *   node dev/sitframes.mjs pikachu,bear out.png 6 rot           # any track
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG } from '../scripts/lib/png.mjs';
import { deflateSync } from 'node:zlib';

const SETS = process.argv[2].split(',');
const Z = Number(process.argv[4] || 6);
const TRK = process.argv[5] || 'sit';
const cells = [];
for (const s of SETS) for (const d of ['west', 'east']) {
  cells.push({ label: s + ':' + d, img: decodePNG(readFileSync(`frontend/assets/sprites/${s}/${TRK}_${d}.png`)) });
}
const CW = Math.max(...cells.map(c => c.img.width)), CH = Math.max(...cells.map(c => c.img.height));
const W = cells.length * CW * Z, H = CH * Z;
const px = Buffer.alloc(W * H * 4, 0);
cells.forEach((c, i) => {
  const ox = i * CW * Z, ch = c.img.channels, src = c.img.pixels;
  for (let y = 0; y < c.img.height * Z; y++) for (let x = 0; x < c.img.width * Z; x++) {
    const si = (((y / Z) | 0) * c.img.width + ((x / Z) | 0)) * ch;
    const di = (y * W + ox + x) * 4;
    px[di] = src[si]; px[di + 1] = src[si + (ch > 2 ? 1 : 0)]; px[di + 2] = src[si + (ch > 2 ? 2 : 0)];
    px[di + 3] = ch === 4 ? src[si + 3] : 255;
  }
});
for (let i = 0; i < W * H; i++) {                       // flatten onto mid grey so silhouettes read
  const a = px[i * 4 + 3] / 255;
  for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(px[i * 4 + k] * a + 96 * (1 - a));
  px[i * 4 + 3] = 255;
}
for (let i = 1; i < cells.length; i++) {                // a divider between cells
  const x = i * CW * Z;
  for (let y = 0; y < H; y++) { const d = (y * W + x) * 4; px[d] = 255; px[d + 1] = 40; px[d + 2] = 40; }
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4);
  let c = ~0; for (const b of td) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  crc.writeUInt32BE((~c) >>> 0); return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(process.argv[3], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(process.argv[3] + '  ' + W + 'x' + H + '  order: ' + cells.map(c => c.label).join(' | '));
