// dev/skin-orphan-audit.mjs — find DETACHED pixel islands in every shipped sprite frame.
//
// WHY: a sprite is one body. When a frame comes back from the generator with an accessory
// rendered as a free-floating island (voidwizard's staff drifted to the frame edge in
// walk.west / walk.north-west), nothing in the test suite notices: the frame is still
// 8-bit RGBA, still foot-anchored, still the right build. It only reads as broken to a
// human — "a stupid floating stick".
//
// The measure: 8-connected components over alpha>16. Everything that is not the largest
// component is an ORPHAN. Report its size and its Chebyshev gap to the body, because a
// 1px anti-alias speck touching the outline is noise while a 40px island 8px clear of the
// body is a defect.
//
// Usage:  node dev/skin-orphan-audit.mjs [skin ...]      (no args = whole roster)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'assets', 'sprites');

function decodePng(buf) {
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error('expected 8-bit RGBA');
  const idat = [];
  for (let off = 8; off + 8 <= buf.length;) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4, data = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = (x >= 4 && y > 0) ? data[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      data[y * stride + x] = v & 0xff;
    }
  }
  return { width, height, data };
}

// 8-connected components over alpha>16. Returns components sorted largest-first.
export function components(im, aMin = 16) {
  const { width: W, height: H, data } = im;
  const label = new Int32Array(W * H).fill(-1);
  const on = i => data[i * 4 + 3] > aMin;
  const comps = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!on(s) || label[s] >= 0) continue;
    const id = comps.length;
    const px = [];
    stack.push(s); label[s] = id;
    while (stack.length) {
      const i = stack.pop();
      px.push(i);
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (on(j) && label[j] < 0) { label[j] = id; stack.push(j); }
      }
    }
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const i of px) {
      const x = i % W, y = (i / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    comps.push({ id, px, n: px.length, x0, y0, x1, y1 });
  }
  comps.sort((a, b) => b.n - a.n);
  return comps;
}

// Chebyshev gap in pixels between two components (0 = diagonally adjacent but unlabelled,
// which cannot happen with 8-connectivity, so a real orphan always reports >= 1).
function gap(a, b, W) {
  let best = 1e9;
  for (const i of a.px) {
    const ax = i % W, ay = (i / W) | 0;
    for (const j of b.px) {
      const bx = j % W, by = (j / W) | 0;
      const d = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
      if (d < best) best = d;
      if (best <= 1) return best;
    }
  }
  return best;
}

export function orphansOf(file) {
  const im = decodePng(readFileSync(file));
  const comps = components(im);
  if (comps.length <= 1) return [];
  const body = comps[0];
  return comps.slice(1).map(c => ({
    n: c.n, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1,
    gap: gap(c, body, im.width),
  }));
}

if (process.argv[1] && process.argv[1].endsWith('skin-orphan-audit.mjs')) {
  const only = process.argv.slice(2);
  const sets = readdirSync(ROOT)
    .filter(d => !d.startsWith('_') && statSync(path.join(ROOT, d)).isDirectory())
    .filter(d => !only.length || only.includes(d));
  const rows = [];
  for (const set of sets) {
    const dir = path.join(ROOT, set);
    for (const f of readdirSync(dir).filter(f => f.endsWith('.png'))) {
      for (const o of orphansOf(path.join(dir, f))) {
        rows.push({ set, frame: f.replace(/\.png$/, ''), ...o });
      }
    }
  }
  // A defect is a sizable island that is clearly clear of the body. Everything else is listed
  // under "specks" so the signal is not buried.
  const bad = rows.filter(r => r.n >= 6 && r.gap >= 2);
  const specks = rows.filter(r => !(r.n >= 6 && r.gap >= 2));
  const bySet = new Map();
  for (const r of bad) {
    if (!bySet.has(r.set)) bySet.set(r.set, []);
    bySet.get(r.set).push(r);
  }
  console.log(`=== DETACHED ISLANDS (>=6px, >=2px clear of the body) — ${bad.length} in ${bySet.size} sets ===`);
  for (const [set, rs] of [...bySet].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${set}  (${rs.length} frames)`);
    for (const r of rs.sort((a, b) => a.frame.localeCompare(b.frame))) {
      console.log(`  ${r.frame.padEnd(22)} ${String(r.n).padStart(4)}px  gap ${String(r.gap).padStart(2)}  box ${r.x0},${r.y0}..${r.x1},${r.y1}`);
    }
  }
  console.log(`\n=== small/adjacent specks: ${specks.length} (not reported individually) ===`);
  const speckSets = [...new Set(specks.map(s => s.set))];
  console.log(speckSets.join(' ') || '(none)');
}
