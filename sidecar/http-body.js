/* sidecar/http-body.js — bounded HTTP request-body readers.

   The host has both JSON/text routes and binary audio routes. They share the same byte cap and clean 413
   behavior, but text must decode only after every Buffer is joined so a UTF-8 code point split across TCP
   chunks is not replaced. Kept dependency-free so routes can reuse it without importing the sidecar host. */
'use strict';

function payloadTooLarge(res) {
  try {
    if (res && !res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'request body too large' }));
    }
  } catch (_) {}
  const error = new Error('body too large');
  error.statusCode = 413;
  error.tooLarge = true;
  return error;
}

function readBodyBuffer(req, max, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let over = false;
    req.on('data', chunk => {
      if (over) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > max) {
        over = true;
        reject(payloadTooLarge(res));
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(buffer);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', error => { if (!over) reject(error); });
  });
}

async function readBody(req, max, res) {
  return (await readBodyBuffer(req, max, res)).toString('utf8');
}

module.exports = { readBody, readBodyBuffer };
