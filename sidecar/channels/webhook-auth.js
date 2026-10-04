/* Signed, replay-protected relay ingress. Pure core: no server/global state.
   Replay protection is durable when a store is injected: accepted nonces are appended to the
   store BEFORE the request is admitted (fail closed — an accepted request whose nonce was never
   recorded would re-open the replay window across a restart), and unexpired rows are reloaded.
   This is durable at-most-once ADMISSION, not transactional exactly-once message delivery. */
'use strict';
const crypto = require('node:crypto');

function makeWebhookVerifier(opts) {
  opts = opts || {};
  const secret = String(opts.secret || '');
  const now = opts.now;
  if (typeof now !== 'function') throw new Error('makeWebhookVerifier: an injected now function is required');
  // optional durable nonce inbox: { load(): [{nonce, expiry}], append(row) } — injected, never fs here.
  const store = opts.store || null;
  if (store && (typeof store.load !== 'function' || typeof store.append !== 'function')) {
    throw new Error('makeWebhookVerifier: an injected store must provide load() and append()');
  }
  const maxSkewMs = Math.max(1000, Number(opts.maxSkewMs) || 300000);
  const maxNonces = Math.max(100, Number(opts.maxNonces) || 10000);
  const seen = new Map();
  let storeReady = !store;
  function hydrate(current) {
    if (!store) return true;
    let rows;
    try { rows = store.load() || []; }
    catch (_) { storeReady = false; return false; }
    const next = new Map();
    let overflow = false;
    for (const row of rows) {
      if (!row || typeof row.nonce !== 'string') continue;
      const expiry = Number(row.expiry);
      if (!Number.isFinite(expiry) || expiry <= current) continue;
      if (!next.has(row.nonce) && next.size >= maxNonces) { overflow = true; continue; }
      next.set(row.nonce, expiry);
    }
    if (overflow) { storeReady = false; return false; }
    seen.clear();
    for (const [nonce, expiry] of next) seen.set(nonce, expiry);
    storeReady = true;
    return true;
  }
  hydrate(Number(now()));
  function expected(timestamp, nonce, body) {
    return crypto.createHmac('sha256', secret).update(String(timestamp) + '.' + String(nonce) + '.' + String(body)).digest('hex');
  }
  function verify(input) {
    input = input || {};
    if (secret.length < 32) return { ok: false, code: 503, error: 'relay webhook secret is not configured' };
    const timestamp = String(input.timestamp || ''), nonce = String(input.nonce || ''), signature = String(input.signature || '').toLowerCase();
    if (!/^\d{10,16}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return { ok: false, code: 401, error: 'invalid webhook authentication' };
    const at = Number(timestamp), current = Number(now());
    if (!Number.isFinite(at) || Math.abs(current - at) > maxSkewMs) return { ok: false, code: 401, error: 'stale webhook' };
    const want = Buffer.from(expected(timestamp, nonce, input.body || ''), 'hex'), got = Buffer.from(signature, 'hex');
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, code: 401, error: 'invalid webhook signature' };
    if (store && !storeReady && !hydrate(current)) return { ok: false, code: 503, error: 'webhook nonce inbox is unavailable' };
    for (const [key, expiry] of seen) if (expiry < current) seen.delete(key);
    if (seen.has(nonce)) return { ok: false, code: 409, error: 'webhook replay refused' };
    if (seen.size >= maxNonces) return { ok: false, code: 503, error: 'webhook nonce inbox is at capacity' };
    // A request remains timestamp-valid until timestamp + maxSkewMs. Basing expiry on receipt
    // time lets a future-skewed request become replayable while its signature is still valid.
    const expiry = at + maxSkewMs;
    if (store) {
      // Fail closed: the nonce row must be ON DISK before the delivery is admitted. If the append
      // fails we also leave the in-memory cache untouched — the delivery was refused, so the
      // sender's retry of the SAME signed request must succeed once the store recovers.
      try { store.append({ nonce, expiry, at: current }); }
      catch (_) { return { ok: false, code: 503, error: 'webhook nonce could not be recorded' }; }
    }
    seen.set(nonce, expiry);
    return { ok: true, timestamp: at, nonce };
  }
  return { verify, sign: expected, _seen: seen };
}

module.exports = { makeWebhookVerifier };
