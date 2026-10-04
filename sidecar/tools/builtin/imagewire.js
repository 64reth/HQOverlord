/* sidecar/tools/builtin/imagewire.js — the SHARED image-on-the-wire sniffer.

   A tool result is a string on every wire we speak, so pixels ride ALONGSIDE it on the
   `images` channel (tools/registry.js okResult -> loop.js, which appends them as a following
   user turn). Until now `browser.js` was the ONLY producer of that array, which made the
   channel a special case rather than a channel: fs.read of a PNG returned binary noise and
   computer.use returned `capture_after=<json>` — the model clicked at coordinates it had
   never seen, and could not look at image_generate's own output.

   This module is the one place that answers "are these bytes an image the driving model can
   actually be shown, and how big is it" so every producer answers it identically.

   makeImageWire({ maxBytes? }) -> { sniff(nameOrPath, buf) -> info|null, toWire(buf, info) -> {mime,data}, MAX_BYTES }

   sniff() returns { mime, ext, width, height, wireSafe } or null when the bytes are not an
   image. It reads MAGIC BYTES, never the extension — same law docextract.js earned: a
   mislabelled file must fall THROUGH to the plain read rather than fail it, and a .txt that
   is really a PNG must still be seen. The name is used only to break the JPEG/JPG tie in the
   reported `ext`.

   wireSafe is FALSE for formats no major provider accepts (BMP, TIFF, ICO). Those still sniff
   — so the caller can say "this is a 900x600 BMP, convert it" instead of printing binary — but
   they never go on the wire, because an unsupported mime is a 400 on the next model call, not
   a graceful degrade.
*/
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.tools = root.SK.tools || {}; (root.SK.tools.builtin = root.SK.tools.builtin || {}).imagewire = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Raw-byte ceiling. Base64 inflates 4/3, and the providers' per-image limit is ~5MB of
     ENCODED payload, so the raw cap is 5MB * 3/4. This bounds the WIRE, not the token cost —
     tokens are bounded separately by the loop's TOOL_IMAGE_MAX (2 images per turn). */
  const DEFAULT_MAX_BYTES = 3750000;

  // Providers that accept vision input converge on exactly these four. Anything else is a 400.
  const WIRE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

  function u32be(b, o) { return b.length >= o + 4 ? (b[o] * 0x1000000) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3] : 0; }
  function u16be(b, o) { return b.length >= o + 2 ? (b[o] << 8) + b[o + 1] : 0; }
  function u16le(b, o) { return b.length >= o + 2 ? (b[o + 1] << 8) + b[o] : 0; }
  function i32le(b, o) { return b.length >= o + 4 ? ((b[o + 3] << 24) | (b[o + 2] << 16) | (b[o + 1] << 8) | b[o]) : 0; }
  function ascii(b, o, n) { let s = ''; for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i]); return s; }

  // JPEG carries its dimensions in a start-of-frame marker that can sit arbitrarily deep behind
  // APPn/comment segments, so the segment chain must be walked. Every SOF except the four
  // non-frame markers (DHT/JPG/DAC and the RSTn block) has the same {len,prec,h,w} head.
  function jpegSize(b) {
    let o = 2;
    while (o + 3 < b.length) {
      if (b[o] !== 0xFF) { o++; continue; }             // resync on a padded/corrupt stream
      const marker = b[o + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { o += 2; continue; }
      const len = u16be(b, o + 2);
      if (len < 2) break;
      const isSOF = (marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSOF) return { height: u16be(b, o + 5), width: u16be(b, o + 7) };
      if (marker === 0xDA) break;                        // start of scan: no header past here
      o += 2 + len;
    }
    return { width: 0, height: 0 };
  }

  // WEBP has three sub-formats under one RIFF container and they store size three different ways.
  function webpSize(b) {
    const tag = ascii(b, 12, 4);
    if (tag === 'VP8 ') return { width: u16le(b, 26) & 0x3FFF, height: u16le(b, 28) & 0x3FFF };
    if (tag === 'VP8L') {
      const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
      return { width: (bits & 0x3FFF) + 1, height: ((bits >>> 14) & 0x3FFF) + 1 };
    }
    if (tag === 'VP8X') {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h };
    }
    return { width: 0, height: 0 };
  }

  function sniff(nameOrPath, buf) {
    if (!buf || typeof buf.length !== 'number' || buf.length < 12) return null;
    const b = buf;
    let mime = '', ext = '', dim = { width: 0, height: 0 };

    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) {
      // IHDR is REQUIRED to be the first chunk, so width/height sit at a fixed offset.
      mime = 'image/png'; ext = 'png'; dim = { width: u32be(b, 16), height: u32be(b, 20) };
    } else if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
      mime = 'image/jpeg'; ext = /\.jpeg$/i.test(String(nameOrPath || '')) ? 'jpeg' : 'jpg'; dim = jpegSize(b);
    } else if (ascii(b, 0, 3) === 'GIF') {
      mime = 'image/gif'; ext = 'gif'; dim = { width: u16le(b, 6), height: u16le(b, 8) };
    } else if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
      mime = 'image/webp'; ext = 'webp'; dim = webpSize(b);
    } else if (b[0] === 0x42 && b[1] === 0x4D) {
      // Height is SIGNED: a negative value means a top-down row order, not a negative image.
      mime = 'image/bmp'; ext = 'bmp'; dim = { width: i32le(b, 18), height: Math.abs(i32le(b, 22)) };
    } else if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A) || (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00)) {
      mime = 'image/tiff'; ext = 'tiff';                 // dimensions live behind an IFD walk; not worth it for a format we can't send
    } else if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) {
      mime = 'image/x-icon'; ext = 'ico'; dim = { width: b[6] || 256, height: b[7] || 256 };
    } else {
      return null;
    }

    return {
      mime, ext,
      width: dim.width > 0 ? dim.width : 0,
      height: dim.height > 0 ? dim.height : 0,
      bytes: b.length,
      wireSafe: WIRE_SAFE.has(mime)
    };
  }

  function makeImageWire(deps) {
    deps = deps || {};
    const MAX_BYTES = (deps.maxBytes != null) ? Number(deps.maxBytes) : DEFAULT_MAX_BYTES;

    function describe(info, label) {
      const dims = (info.width && info.height) ? (info.width + '×' + info.height) : 'unknown size';
      return (label || 'image') + ': ' + info.ext.toUpperCase() + ' ' + dims + ', ' + Math.round(info.bytes / 1024) + ' KB';
    }

    /* The single decision point: may these bytes be shown to the driving model, and if not, WHY.
       Returns { images, note } — `images` is null whenever the answer is no, and `note` is the
       sentence the caller appends to its text content. Never throws: an unsendable image must
       still produce a readable tool result. */
    function toWire(buf, info) {
      if (!info) return { images: null, note: '' };
      if (!info.wireSafe) {
        return { images: null, note: 'This format cannot be shown to me directly — convert it to PNG, JPEG, GIF or WEBP first.' };
      }
      if (info.bytes > MAX_BYTES) {
        return { images: null, note: 'Too large to show directly (' + Math.round(info.bytes / 1024) + ' KB, limit ' + Math.round(MAX_BYTES / 1024) + ' KB) — use image_analyze on it, or resize it first.' };
      }
      return { images: [{ mime: info.mime, data: buf.toString('base64') }], note: '' };
    }

    return { sniff, toWire, describe, MAX_BYTES, _internals: { jpegSize, webpSize, WIRE_SAFE } };
  }

  return { makeImageWire, sniff, _internals: { jpegSize, webpSize, WIRE_SAFE, DEFAULT_MAX_BYTES } };
});
