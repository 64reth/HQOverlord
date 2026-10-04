#!/usr/bin/env node
// dev/wallcorner-diff.mjs — pixel diff of two station bakes, reported in TILE coordinates so a
// change can be attributed to a corner instead of a pixel blob.
//   node dev/wallcorner-diff.mjs before.png after.png [tileSize]
import { readFileSync } from 'node:fs';
import { decodePNG } from '../scripts/lib/png.mjs';

const [a, b, tsArg] = process.argv.slice(2);
const T = Number(tsArg || 12);
const A = decodePNG(readFileSync(a)), B = decodePNG(readFileSync(b));
if (A.width !== B.width || A.height !== B.height) {
  console.error(`size mismatch ${A.width}x${A.height} vs ${B.width}x${B.height}`);
  process.exit(2);
}
const byTile = new Map();
const ca = A.channels, cb = B.channels;
let n = 0;
for (let y = 0; y < A.height; y++) {
  for (let x = 0; x < A.width; x++) {
    const ia = (y * A.width + x) * ca, ib = (y * B.width + x) * cb;
    let same = true;
    for (let k = 0; k < Math.min(ca, cb); k++) if (A.pixels[ia + k] !== B.pixels[ib + k]) { same = false; break; }
    if (same) continue;
    n++;
    const k = Math.floor(x / T) + ',' + Math.floor(y / T);
    byTile.set(k, (byTile.get(k) || 0) + 1);
  }
}
const tiles = [...byTile.entries()].sort((p, q) => q[1] - p[1]);
console.log(`changed px ${n} of ${A.width * A.height}  over ${tiles.length} tiles`);
for (const [k, c] of tiles) console.log('  tile ' + k + '  ' + c + 'px');
