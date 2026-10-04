/* node test/readbody.test.js — bounded text/binary request body readers. */
'use strict';
const A = require('./_assert.js');
const { EventEmitter } = require('events');
const { readBody, readBodyBuffer } = require('../sidecar/http-body.js');

// a mock req that emits the given Buffer chunks then 'end' (an EventEmitter is enough for readBody).
function mockReq(chunks) {
  const req = new EventEmitter();
  req.destroy = () => { req.destroyed = true; };
  process.nextTick(() => { for (const c of chunks) req.emit('data', c); req.emit('end'); });
  return req;
}

(async () => {
  // ---- 1. a 4-byte emoji SPLIT across two chunks round-trips intact ----
  {
    const full = Buffer.from('hi 😀 there', 'utf8');   // 😀 = F0 9F 98 80 (4 bytes)
    const at = full.indexOf(0xf0);                     // split in the MIDDLE of the emoji's bytes
    const a = full.slice(0, at + 2), b = full.slice(at + 2);   // 2 bytes of the emoji in each chunk
    A.ok(a[a.length - 1] >= 0x80, 'the split lands mid-multibyte-char (a real torn char)');
    const out = await readBody(mockReq([a, b]), 1 << 20);
    A.eq(out, 'hi 😀 there', 'a mid-char split still decodes to the intact emoji (no replacement chars)');
    A.eq(out.indexOf('�'), -1, 'no U+FFFD replacement character in the result');
  }

  // ---- 2. multiple multibyte chars (CJK) across many small chunks ----
  {
    const full = Buffer.from('日本語テスト', 'utf8');
    const chunks = [];
    for (let i = 0; i < full.length; i += 1) chunks.push(full.slice(i, i + 1));   // 1 byte per chunk (worst case)
    const out = await readBody(mockReq(chunks), 1 << 20);
    A.eq(out, '日本語テスト', 'CJK text split to single-byte chunks reassembles exactly');
  }

  // ---- 3. the byte cap still fires on an oversized body ----
  {
    let threw = null;
    try { await readBody(mockReq([Buffer.alloc(100), Buffer.alloc(100)]), 150); } catch (e) { threw = e; }
    A.ok(threw && /too large/.test(threw.message), 'the max-bytes cap still rejects an oversized body');
  }

  // ---- 4. a plain ASCII body is unaffected ----
  {
    const out = await readBody(mockReq([Buffer.from('{"a":1}')]), 1 << 20);
    A.eq(out, '{"a":1}', 'ASCII JSON body unchanged');
  }

  // ---- 5. binary bodies never take a lossy text round-trip ----
  {
    const binary = Buffer.from([0, 255, 1, 254, 2]);
    const out = await readBodyBuffer(mockReq([binary.subarray(0, 2), binary.subarray(2)]), binary.length);
    A.eq(Array.from(out), Array.from(binary), 'binary reader preserves non-UTF8 bytes exactly');
  }

  // ---- 6. overflow answers cleanly before destroying the request ----
  {
    const writes = [];
    const res = {
      headersSent: false,
      writeHead(code, headers) { this.headersSent = true; writes.push({ code, headers }); },
      end(body) { writes.push({ body }); }
    };
    const req = mockReq([Buffer.from('1234'), Buffer.from('5')]);
    let error = null;
    try { await readBodyBuffer(req, 4, res); } catch (caught) { error = caught; }
    A.ok(error && error.statusCode === 413 && error.tooLarge === true, 'overflow keeps the established 413 error shape');
    A.eq(writes[0].code, 413, 'overflow writes a clean 413 before closing the request');
    A.eq(JSON.parse(writes[1].body), { error: 'request body too large' }, 'overflow response is machine-readable JSON');
    A.ok(req.destroyed, 'overflow stops consuming the hostile request');
  }

  A.report('readbody');
})();
