// scripts/lib/png.mjs — minimal ZERO-DEP PNG decode (built-in zlib) + a downscaled grayscale
// "signature" for animation-tolerant golden-frame change detection.
//
// WHY a signature, not a pixel diff: StarNet's floor animates every frame (the agent wanders, the
// reactor pulses), so two captures of the SAME state never match pixel-for-pixel. Heavily
// downscaling to a small grayscale grid averages out that local jitter while preserving gross
// structure (which panel is open, layout, large colour blocks) — so the mean-abs-diff between two
// signatures stays near zero for "same UI, different animation frame" but spikes on a real change.
//
// Handles 8-bit RGB / RGBA / grayscale — what headless Chrome's Page.captureScreenshot emits.
// Not a general PNG library (no interlace, no 16-bit, no palette).
import { inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;   // length(4) + type(4) + data + crc(4)
  }
  if (bitDepth !== 8) throw new Error('unsupported PNG bitDepth ' + bitDepth);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : -1;   // RGBA / RGB / gray
  if (channels < 0) throw new Error('unsupported PNG colorType ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const o = y * stride, po = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= bpp ? out[o + i - bpp] : 0;   // reconstructed left
      const b = y > 0 ? out[po + i] : 0;           // reconstructed up
      const c = (i >= bpp && y > 0) ? out[po + i - bpp] : 0;   // reconstructed up-left
      let v = x;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[o + i] = v & 0xff;
    }
  }
  return { width, height, channels, pixels: out };
}

// Downscale to w×h, grayscale (area-average each destination cell). Returns Uint8Array(w*h).
export function signature(png, w = 64, h = 40) {
  const { width, height, channels, pixels } = png;
  const sig = new Uint8Array(w * h);
  for (let gy = 0; gy < h; gy++) {
    const y0 = Math.floor(gy * height / h), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * height / h));
    for (let gx = 0; gx < w; gx++) {
      const x0 = Math.floor(gx * width / w), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * width / w));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * channels;
        const r = pixels[i], g = channels > 1 ? pixels[i + 1] : r, bl = channels > 2 ? pixels[i + 2] : r;
        sum += r * 0.299 + g * 0.587 + bl * 0.114; n++;
      }
      sig[gy * w + gx] = n ? (sum / n) | 0 : 0;
    }
  }
  return sig;
}

// Mean absolute difference between two equal-length signatures, on a 0..255 scale.
export function sigDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 255;
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

export function fileSignature(path, w, h) { return signature(decodePNG(readFileSync(path)), w, h); }
