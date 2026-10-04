/* node test/imagewire.test.js — THE IMAGES CHANNEL HAS MORE THAN ONE PRODUCER.

   The 07-27 "screenshots as pixels" work wired the `images` channel at exactly one call site
   (browser.js). A channel with a single caller is not a channel, it is a special case — and the
   proof is what stayed broken: fs.read of a PNG returned binary noise, so an agent could not look
   at a screenshot on disk or at its OWN image_generate output, and computer.use returned
   `capture_after=<json>` so it clicked coordinates it had never seen.

   These assertions pin the generalized seam: ONE sniffer (imagewire.js) decides what may go on the
   wire, it decides by MAGIC BYTES so a mislabelled file falls through to the plain read rather than
   failing it, unsendable formats degrade to a readable sentence instead of a 400, and both new
   producers hand back the same {mime,data} shape loop.js already knows how to deliver. */
'use strict';
const A = require('./_assert.js');
const zlib = require('node:zlib');
const path = require('node:path');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { makeImageWire } = require('../sidecar/tools/builtin/imagewire.js');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');
const { makeComputerTools } = require('../sidecar/tools/builtin/computer.js');

// A REAL png, built with the zlib Node already ships — a hand-faked header would not prove the
// sniffer reads a true IHDR, and a base64 literal hides which bytes actually matter.
function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let r = 0xFFFFFFFF; for (const b of buf) r = t[(r ^ b) & 0xFF] ^ (r >>> 8); return (r ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { rows.push(Buffer.from([0])); rows.push(Buffer.alloc(w * 3, 0x7F)); }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))
  ]);
}
const PNG = makePng(3, 2);

const iw = makeImageWire({});

// ---- 1. the sniffer reads bytes, and reports real dimensions ----
const p = iw.sniff('shot.png', PNG);
A.eq(p && p.mime, 'image/png', 'png sniffs as png');
A.eq([p.width, p.height], [3, 2], 'png dimensions come from the IHDR chunk');
A.ok(p.wireSafe, 'png is wire-safe');

const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x40, 0x01, 0xF0, 0x00]), Buffer.alloc(8)]);
const g = iw.sniff('x.gif', gif);
A.eq([g.mime, g.width, g.height], ['image/gif', 320, 240], 'gif dimensions are little-endian');

// JPEG hides its size behind a segment chain — a fixed-offset reader gets this wrong.
const jpg = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from([0x00, 0x10]), Buffer.alloc(14),   // APP0 to skip
  Buffer.from([0xFF, 0xC0, 0x00, 0x11, 0x08]), Buffer.from([0x01, 0x2C]), Buffer.from([0x01, 0xF4]), Buffer.alloc(8)
]);
const j = iw.sniff('x.jpg', jpg);
A.eq([j.mime, j.width, j.height], ['image/jpeg', 500, 300], 'jpeg size is found by walking segments to the SOF');

// ---- 2. a format no provider accepts must NOT reach the wire ----
const bmpHdr = Buffer.alloc(8); bmpHdr.writeInt32LE(120, 0); bmpHdr.writeInt32LE(-90, 4);  // negative height = top-down
const bmp = Buffer.concat([Buffer.from('BM', 'ascii'), Buffer.alloc(16), bmpHdr]);
const b = iw.sniff('x.bmp', bmp);
A.eq([b.mime, b.width, b.height], ['image/bmp', 120, 90], 'bmp height is signed — top-down is not a negative image');
A.ok(!b.wireSafe, 'bmp is NOT wire-safe (an unsupported mime is a 400, not a graceful degrade)');
const bw = iw.toWire(bmp, b);
A.eq(bw.images, null, 'an unsendable format yields no images');
A.ok(/convert it/i.test(bw.note), 'and says what to do about it instead of failing the read');

// ---- 3. oversize is parked as advice, not silently truncated ----
const small = makeImageWire({ maxBytes: 10 });
const ow = small.toWire(PNG, small.sniff('shot.png', PNG));
A.eq(ow.images, null, 'an oversized image does not go on the wire');
A.ok(/image_analyze/.test(ow.note), 'it points at the tool that CAN handle it');

// ---- 4. non-images sniff to null so the plain read still owns them ----
A.eq(iw.sniff('a.txt', Buffer.from('hello world, ordinary prose here', 'utf8')), null, 'text is not an image');
A.eq(iw.sniff('tiny', Buffer.from([1, 2, 3])), null, 'a buffer too short to hold a header is not an image');

// ---- 5. + 6. the two new PRODUCERS, on the real modules ----
(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'imagewire-'));
  await fsp.mkdir(path.join(root, 'agent'), { recursive: true });
  await fsp.writeFile(path.join(root, 'agent', 'shot.png'), PNG);
  await fsp.writeFile(path.join(root, 'agent', 'notes.txt'), 'plain text still reads');
  await fsp.writeFile(path.join(root, 'agent', 'liar.png'), Buffer.from('actually text, wearing a .png name', 'utf8'));

  const reg = { tools: {}, register(t) { this.tools[t.name] = t; return this; } };
  makeFsTools({ fsp, pathMod: path, root, imageWire: iw }).register(reg);
  const ctx = { agentId: 'agent' };

  const r1 = await reg.tools['fs.read'].run({ path: 'shot.png' }, ctx);
  A.ok(Array.isArray(r1.images) && r1.images.length === 1, 'fs.read of a png produces an images array');
  A.eq(r1.images[0].mime, 'image/png', 'fs.read reports the sniffed mime, not the extension');
  A.ok(Buffer.from(r1.images[0].data, 'base64').equals(PNG), 'the base64 round-trips to the exact bytes on disk');
  A.ok(/3×2/.test(r1.content), 'the text half still describes the image for the run log');

  const r2 = await reg.tools['fs.read'].run({ path: 'notes.txt' }, ctx);
  A.eq(r2.content, 'plain text still reads', 'a text file is untouched by the image branch');
  A.ok(!r2.images, 'and carries no images');

  // The docextract law, restated for pixels: a mislabelled file must fall THROUGH, not fail.
  const r3 = await reg.tools['fs.read'].run({ path: 'liar.png' }, ctx);
  A.eq(r3.content, 'actually text, wearing a .png name', 'a mislabelled .png falls through to the plain read');
  A.ok(!r3.images, 'and produces no images');

  // computer.use: an injected driver is the ONLY way this tool runs — production is fail-closed.
  const driver = {
    perform: async () => '', capture: async () => PNG.toString('base64'),
    foreground: async () => ({ title: 'Notepad', process: 'notepad.exe' })
  };
  const lease = { ownerTrusted: true, remoteDesktopAuthorized: true, surface: 'interactive', isTask: false, inputMode: 'remote-owner' };
  const c = makeComputerTools({ allowPhysicalInput: true, driver, imageWire: iw });
  const cr = await c.useTool.run({ action: 'screenshot' }, lease);
  A.ok(Array.isArray(cr.images) && cr.images.length === 1, 'computer.use returns the capture as pixels');
  A.eq(cr.images[0].mime, 'image/png', 'with the sniffed mime');
  A.ok(/capture_after=screen: PNG 3×2/.test(cr.content), 'the text proof survives for the run log');

  // No sniffer injected -> byte-identical to the old behavior. The channel is additive.
  const c2 = makeComputerTools({ allowPhysicalInput: true, driver });
  const cr2 = await c2.useTool.run({ action: 'screenshot' }, lease);
  A.ok(!cr2.images, 'without an injected sniffer computer.use emits no images');
  A.ok(cr2.content.indexOf('capture_after=' + PNG.toString('base64')) >= 0, 'and falls back to the raw text proof');

  A.report('imagewire');
})().catch(e => { console.log('FAIL: threw — ' + (e && e.stack || e)); process.exit(1); });
