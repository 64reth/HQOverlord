// dev/bake-logo-small.mjs — bake the topbar-size STARNET wordmark from the master art.
//
// WHY this exists: the brand master (frontend/assets/brand/starnet-logo.png, 2041×384) is an
// ASCII-digit mosaic — thin glowing strokes on transparency. The topbar shows it 30px tall, a
// ~6.6× minification, and the browser's sRGB-space filtering averages those thin strokes into
// dim gray speckle (the "placed PNG" look). A redrawn vector mark was tried and REVERTED
// (661ad745) — the brand IS this art. So instead we pre-bake a small variant OF the same art:
//
//   crop to content bbox → linear-light premultiplied area-average to 2× the CSS size
//   → alpha-gain curve (re-solidifies partial-coverage strokes) → slight value/sat lift
//   → unsharp on alpha (edge crispness lives in coverage; the colour is flat amber).
//
// Output: frontend/assets/brand/starnet-logo-small.png (@2× of the 30px topbar height).
// Deterministic — rerun after any change to the master.
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodePNG } from '../scripts/lib/png.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO, 'frontend/assets/brand/starnet-logo.png');
const OUT = path.join(REPO, 'frontend/assets/brand/starnet-logo-small.png');

const TARGET_H = 60;        // 2× the 30px CSS height (covers DPR up to 2)
const ALPHA_GAMMA = 0.45;   // <1 pulls partial coverage toward solid
const VALUE_GAIN = 1.2;
const SAT_GAIN = 1.12;
const UNSHARP = 0.9;

const s2l = v => Math.pow(v / 255, 2.2);
const l2s = v => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255);
const clamp8 = v => Math.max(0, Math.min(255, Math.round(v)));

function toRGBA(png) {
  const { width, height, channels, pixels } = png;
  if (channels === 4) return { width, height, data: pixels };
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; j < data.length; i += channels, j += 4) {
    data[j] = pixels[i];
    data[j + 1] = channels > 1 ? pixels[i + 1] : pixels[i];
    data[j + 2] = channels > 2 ? pixels[i + 2] : pixels[i];
    data[j + 3] = 255;
  }
  return { width, height, data };
}

function contentBBox(img, thr = 8) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > thr) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error('empty image');
  return { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(img, { x0, y0, w, h }) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    img.data.copy(out, y * w * 4, ((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4);
  return { width: w, height: h, data: out };
}

// area-average downscale in premultiplied linear light — thin bright strokes keep their energy
// (sRGB-space averaging is exactly what dims them to gray in the browser)
function downscale(img, tw, th) {
  const { width: sw, height: sh, data } = img;
  const out = Buffer.alloc(tw * th * 4);
  const fx = sw / tw, fy = sh / th;
  for (let ty = 0; ty < th; ty++) {
    const sy0 = ty * fy, sy1 = (ty + 1) * fy;
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = tx * fx, sx1 = (tx + 1) * fx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const wgt = wx * wy, d = (sy * sw + sx) * 4;
          const pa = data[d + 3] / 255;
          r += s2l(data[d]) * pa * wgt;
          g += s2l(data[d + 1]) * pa * wgt;
          b += s2l(data[d + 2]) * pa * wgt;
          a += pa * wgt;
          wsum += wgt;
        }
      }
      r /= wsum; g /= wsum; b /= wsum; a /= wsum;
      const d = (ty * tw + tx) * 4;
      if (a > 1e-6) { r /= a; g /= a; b /= a; }
      out[d] = l2s(r); out[d + 1] = l2s(g); out[d + 2] = l2s(b);
      out[d + 3] = Math.round(a * 255);
    }
  }
  return { width: tw, height: th, data: out };
}

function enhance(img) {
  const { width: w, height: h, data } = img;
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = Math.round(Math.pow(data[i + 3] / 255, ALPHA_GAMMA) * 255);
    let r = data[i] * VALUE_GAIN, g = data[i + 1] * VALUE_GAIN, b = data[i + 2] * VALUE_GAIN;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = clamp8(l + (r - l) * SAT_GAIN);
    data[i + 1] = clamp8(l + (g - l) * SAT_GAIN);
    data[i + 2] = clamp8(l + (b - l) * SAT_GAIN);
  }
  const src = Buffer.from(data);
  const A = (x, y) => src[(Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4 + 3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const blur = (A(x - 1, y) + A(x + 1, y) + A(x, y - 1) + A(x, y + 1) + A(x, y) * 4) / 8;
    data[(y * w + x) * 4 + 3] = clamp8(A(x, y) + (A(x, y) - blur) * UNSHARP);
  }
  return img;
}

function encodePNG(img) {
  const { width: w, height: h, data } = img;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  const crc32 = buf => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const master = toRGBA(decodePNG(readFileSync(SRC)));
const art = crop(master, contentBBox(master));
const tw = Math.round(art.width * TARGET_H / art.height);
const baked = enhance(downscale(art, tw, TARGET_H));
writeFileSync(OUT, encodePNG(baked));
console.log(`baked ${path.relative(REPO, OUT)} ${tw}x${TARGET_H} from ${art.width}x${art.height} content box`);
