// dev/lib/logofield.mjs — the shared image plumbing for the brand-mark trace lane.
//
// The STARNET master (frontend/assets/brand/starnet-logo.png) is NOT a filled wordmark: only ~4.5%
// of its pixels clear alpha 96, and a mid-height scanline is a run of 2-8px strokes separated by
// 50-200px voids — the letters are HOLLOW outlines drawn out of scattered ASCII digits (probe:
// dev/probe-logo-alpha.mjs). So nothing here ever thresholds raw alpha. Everything works on the
// PERCEIVED DENSITY field: area-average the coverage down to roughly the size the eye sees it at,
// which is the same operation the browser performs when it minifies the art to the 30px topbar.
// Threshold THAT and you get the shape a person actually reads, not the mosaic that produced it.
import { deflateSync } from 'node:zlib';

const s2l = v => Math.pow(v / 255, 2.2);
const l2s = v => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255);

/** Normalize any decodePNG() result to straight RGBA. */
export function toRGBA(png) {
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

export function contentBBox(img, thr = 8) {
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

export function crop(img, { x0, y0, w, h }) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    img.data.copy(out, y * w * 4, ((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4);
  return { width: w, height: h, data: out };
}

/** Area-average downscale in premultiplied LINEAR light (sRGB-space averaging is what dims the
    thin strokes to gray speckle — the same reason bake-logo-small.mjs works in linear). */
export function downscaleRGBA(img, tw, th) {
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
          r += s2l(data[d]) * pa * wgt; g += s2l(data[d + 1]) * pa * wgt; b += s2l(data[d + 2]) * pa * wgt;
          a += pa * wgt; wsum += wgt;
        }
      }
      r /= wsum; g /= wsum; b /= wsum; a /= wsum;
      const d = (ty * tw + tx) * 4;
      if (a > 1e-6) { r /= a; g /= a; b /= a; }
      out[d] = l2s(r); out[d + 1] = l2s(g); out[d + 2] = l2s(b); out[d + 3] = Math.round(a * 255);
    }
  }
  return { width: tw, height: th, data: out };
}

/** The perceived-density field: alpha coverage area-averaged to (tw x th), as Float32 in 0..1.
    Coverage is averaged LINEARLY (not gamma-encoded) — this is geometric area, not light. */
export function densityField(img, tw, th) {
  const { width: sw, height: sh, data } = img;
  const out = new Float32Array(tw * th);
  const fx = sw / tw, fy = sh / th;
  for (let ty = 0; ty < th; ty++) {
    const sy0 = ty * fy, sy1 = (ty + 1) * fy;
    for (let tx = 0; tx < tw; tx++) {
      const sx0 = tx * fx, sx1 = (tx + 1) * fx;
      let a = 0, wsum = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          const wgt = wx * wy;
          a += (data[(sy * sw + sx) * 4 + 3] / 255) * wgt;
          wsum += wgt;
        }
      }
      out[ty * tw + tx] = a / wsum;
    }
  }
  return out;
}

/** Separable Gaussian blur over a Float32 field (clamped edges). sigma in field px; 0 = no-op. */
export function blurField(f, w, h, sigma) {
  if (!(sigma > 0)) return f;
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(rad * 2 + 1);
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k[i + rad] = v; sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -rad; i <= rad; i++) v += k[i + rad] * f[y * w + Math.max(0, Math.min(w - 1, x + i))];
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0;
    for (let i = -rad; i <= rad; i++) v += k[i + rad] * tmp[Math.max(0, Math.min(h - 1, y + i)) * w + x];
    out[y * w + x] = v;
  }
  return out;
}

/** Rescale a field so its given upper percentile maps to 1.0 — the raw coverage of a sparse mosaic
    peaks well below 1, so a fixed absolute threshold would be meaningless across crops. */
export function normalizeField(f, pct = 0.995) {
  const s = Float32Array.from(f).sort();
  const hi = s[Math.min(s.length - 1, Math.floor(pct * s.length))] || 1;
  const out = new Float32Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.min(1, f[i] / hi);
  return { field: out, scale: hi };
}

/** Zero-dep 8-bit RGBA PNG encoder (same one bake-logo-small.mjs carries). */
export function encodePNG({ width: w, height: h, data }) {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c; }
  const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
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
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Render a Float32 field as a viewable grayscale-on-black PNG, nearest-upscaled by `scale`. */
export function fieldToPNG(f, w, h, scale = 1, iso = null) {
  const W = w * scale, H = h * scale;
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = f[Math.floor(y / scale) * w + Math.floor(x / scale)];
    const d = (y * W + x) * 4;
    const on = iso != null && v >= iso;
    const g = Math.max(0, Math.min(255, Math.round(v * 255)));
    data[d] = on ? 255 : g; data[d + 1] = on ? 176 : g; data[d + 2] = on ? 48 : g; data[d + 3] = 255;
  }
  return encodePNG({ width: W, height: H, data });
}
