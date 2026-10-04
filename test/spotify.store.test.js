/* node test/spotify.store.test.js — durable token store + auto-refresh. Offline + deterministic (real temp
   dir; injected fetch + clock). Pairs with sidecar/spotify/store.js. */
'use strict';
const A = require('./_assert.js');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeSpotifyStore } = require('../sidecar/spotify/store.js');

// Per-process dir — a fixed name lets two concurrent gate runs rm -rf each other's fixtures.
const DIR = path.join(os.tmpdir(), 'starnet-spotify-store-test-' + process.pid);

function fetchOnce(resp) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init }); return resp(String(url), init); };
  fn.calls = calls; return fn;
}
function jsonResp(obj, status) { return { ok: (status || 200) < 300, status: status || 200, json: async () => obj }; }

(async () => {
  try { await fsp.rm(DIR, { recursive: true, force: true }); } catch (_) {}
  let T = 1000;
  const now = () => T;

  // ---- A. persist + reload across instances ----
  const noFetch = fetchOnce(() => jsonResp({}));
  const s1 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: noFetch, now });
  await s1.setClientId('CID');
  await s1.setTokens({ accessToken: 'AT1', refreshToken: 'RT1', expiresAt: T + 3600000, scope: 'sc' });
  let st = await s1.status();
  A.eq(st.connected, true, 'status connected after setTokens');
  A.eq(st.hasClientId, true, 'status reports clientId');

  const s2 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: noFetch, now });   // fresh instance
  const st2 = await s2.status();
  A.eq(st2.connected, true, 'a new store instance loads the persisted session from disk');
  A.eq(await s2.getClientId(), 'CID', 'clientId persisted to disk');

  // ---- B. getAccessToken returns the cached token while it is still valid (no network) ----
  const tok = await s2.getAccessToken();
  A.eq(tok, 'AT1', 'getAccessToken returns the valid cached token');
  A.eq(noFetch.calls.length, 0, 'no refresh network call while the token is valid');

  // ---- C. expired token -> auto refresh via fetch, persists the new token ----
  T = T + 4000000;   // now past expiresAt
  const refetch = fetchOnce((url) => {
    A.ok(url.indexOf('accounts.spotify.com/api/token') >= 0, 'refresh hits the Spotify token endpoint');
    return jsonResp({ access_token: 'AT2', expires_in: 3600, scope: 'sc' });
  });
  const s3 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: refetch, now });
  const tok2 = await s3.getAccessToken();
  A.eq(tok2, 'AT2', 'getAccessToken refreshes an expired token');
  A.eq(refetch.calls.length, 1, 'exactly one refresh call');
  A.ok((refetch.calls[0].init.body || '').indexOf('grant_type=refresh_token') >= 0, 'refresh sends the refresh grant');
  A.ok((refetch.calls[0].init.body || '').indexOf('refresh_token=RT1') >= 0, 'refresh sends the stored refresh token');
  // new token persisted
  const s4 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: noFetch, now });
  A.eq(await s4.getAccessToken(), 'AT2', 'the refreshed token is persisted to disk');

  // ---- C2. a transient write failure during refresh-token rotation retries before losing the only live token ----
  // The issuer has invalidated RT-old by the time it returns RT-new. If the one atomic rename gets EBUSY and the
  // store gives up, memory carries RT-new while restart reloads dead RT-old even though an immediate retry works.
  {
    const dir = DIR + '-c2';
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
    const seed = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    await seed.setClientId('CID');
    await seed.setTokens({ accessToken: 'AT-old', refreshToken: 'RT-old', expiresAt: 1, scope: 'sc' });
    let renameCalls = 0;
    const flakyFsp = Object.assign({}, fsp, {
      rename: async (...args) => {
        renameCalls++;
        if (renameCalls === 1) throw Object.assign(new Error('transient EBUSY'), { code: 'EBUSY' });
        return fsp.rename(...args);
      }
    });
    const rotated = fetchOnce(() => jsonResp({ access_token: 'AT-new', refresh_token: 'RT-new', expires_in: 3600 }));
    const live = makeSpotifyStore({ fsp: flakyFsp, pathMod: path, dir, fetchImpl: rotated, now });
    let refreshed = '', refreshError = '';
    try { refreshed = await live.getAccessToken(); } catch (e) { refreshError = e && e.message; }
    A.eq(refreshError, '', 'C2: one transient token-write failure is recovered instead of failing the refresh');
    A.eq(refreshed, 'AT-new', 'C2: the rotated access token is returned after the retry');
    A.eq(renameCalls, 2, 'C2: persistence retries exactly once after the transient rename failure');
    const restarted = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    A.eq(await restarted.getAccessToken(), 'AT-new', 'C2: restart loads the rotated token, never invalidated RT-old');
    A.eq(restarted._internals.raw().refreshToken, 'RT-new', 'C2: the rotated refresh token survived restart');
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // ---- D. invalid_grant (dead refresh token) clears the session ----
  T = T + 4000000;
  const deadFetch = fetchOnce(() => jsonResp({ error: 'invalid_grant' }, 400));
  const s5 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: deadFetch, now });
  let reconnect = false; try { await s5.getAccessToken(); } catch (e) { reconnect = /reconnect/i.test(e.message); }
  A.ok(reconnect, 'a dead refresh token surfaces a reconnect error');
  const s6 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: noFetch, now });
  A.eq((await s6.status()).connected, false, 'invalid_grant cleared the session on disk');
  A.eq(await s6.getClientId(), 'CID', 'clear() keeps the clientId for easy reconnect');

  // ---- D-hardening (F2): a live refresh token must NEVER be wiped by a transient / malformed / non-invalid_grant
  //      response. clear() may fire ONLY on an explicit, well-formed invalid_grant. Everything else throws a
  //      RETRYABLE error and LEAVES the refresh token intact so the next attempt can succeed. ----
  async function seedConnected(dir) {
    const seed = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    await seed.setClientId('CID');
    await seed.setTokens({ accessToken: 'ATx', refreshToken: 'RTlive', expiresAt: 1, scope: 'sc' });   // expiresAt in the past -> forces refresh
  }

  // D1: 400 WITHOUT invalid_grant (e.g. invalid_request / temporarily_unavailable) -> NO clear, refresh token survives.
  {
    const dir = DIR + '-d1';
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
    await seedConnected(dir);
    const f = fetchOnce(() => jsonResp({ error: 'invalid_request' }, 400));
    const s = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: f, now });
    let threw = false, wiped = false; try { await s.getAccessToken(); } catch (e) { threw = true; wiped = /reconnect/i.test(e.message); }
    A.ok(threw, 'D1: a 400 without invalid_grant still throws');
    A.eq(wiped, false, 'D1: a 400 without invalid_grant does NOT surface a reconnect (no clear)');
    const chk = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    A.eq((await chk.status()).connected, true, 'D1: a 400 without invalid_grant LEFT the live refresh token intact on disk');
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // D2: 500 (transient server error) -> NO clear, refresh token survives, retryable error.
  {
    const dir = DIR + '-d2';
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
    await seedConnected(dir);
    const f = fetchOnce(() => jsonResp({ error: 'server_error' }, 500));
    const s = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: f, now });
    let threw = false; try { await s.getAccessToken(); } catch (e) { threw = true; }
    A.ok(threw, 'D2: a 500 throws');
    const chk = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    A.eq((await chk.status()).connected, true, 'D2: a 500 LEFT the live refresh token intact on disk');
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // D3: unparseable body (json() rejects) on a 400 -> NO clear (we cannot prove invalid_grant), refresh token survives.
  {
    const dir = DIR + '-d3';
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
    await seedConnected(dir);
    const f = fetchOnce(() => ({ ok: false, status: 400, json: async () => { throw new Error('Unexpected token < in JSON'); } }));
    const s = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: f, now });
    let threw = false, wiped = false; try { await s.getAccessToken(); } catch (e) { threw = true; wiped = /reconnect/i.test(e.message); }
    A.ok(threw, 'D3: an unparseable 400 body still throws');
    A.eq(wiped, false, 'D3: an unparseable 400 body does NOT surface a reconnect (cannot prove invalid_grant)');
    const chk = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    A.eq((await chk.status()).connected, true, 'D3: an unparseable 400 body LEFT the live refresh token intact on disk');
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // D4: 400 WITH invalid_grant -> DOES clear (the one legitimate revocation path). Re-assert after the hardening.
  {
    const dir = DIR + '-d4';
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
    await seedConnected(dir);
    const f = fetchOnce(() => jsonResp({ error: 'invalid_grant', error_description: 'refresh token revoked' }, 400));
    const s = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: f, now });
    let reconn = false; try { await s.getAccessToken(); } catch (e) { reconn = /reconnect/i.test(e.message); }
    A.ok(reconn, 'D4: a well-formed invalid_grant surfaces a reconnect error');
    const chk = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    A.eq((await chk.status()).connected, false, 'D4: a well-formed invalid_grant DID clear the session on disk');
    A.eq(await chk.getClientId(), 'CID', 'D4: clear() keeps the clientId for reconnect');
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // D5: a disk failure while disconnecting must leave BOTH the live view and durable token connected. Before
  // this guard, clear() changed memory first, then a failed write left the UI saying disconnected while the
  // old refresh token remained on disk and came back after restart.
  {
    const dir = DIR + '-d5';
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
    const seed = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    await seed.setClientId('CID');
    await seed.setTokens({ accessToken: 'AT-live', refreshToken: 'RT-live', expiresAt: T + 3600000, scope: 'sc' });
    await fsp.mkdir(path.join(dir, 'spotify.json.tmp')); // persist() writeFile now fails with EISDIR
    let threw = false; try { await seed.clear(); } catch (_) { threw = true; }
    A.ok(threw, 'D5: a failed durable clear rejects');
    A.eq((await seed.status()).connected, true, 'D5: failed clear restores the live connected state');
    const restarted = makeSpotifyStore({ fsp, pathMod: path, dir, fetchImpl: noFetch, now });
    A.eq((await restarted.status()).connected, true, 'D5: failed clear leaves the durable refresh token intact');
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch (_) {}
  }

  // ---- E. not connected -> clean error ----
  try { await fsp.rm(DIR, { recursive: true, force: true }); } catch (_) {}
  const s7 = makeSpotifyStore({ fsp, pathMod: path, dir: DIR, fetchImpl: noFetch, now });
  let notConn = false; try { await s7.getAccessToken(); } catch (e) { notConn = /not connected/i.test(e.message); }
  A.ok(notConn, 'getAccessToken errors clearly when Spotify is not connected');

  try { await fsp.rm(DIR, { recursive: true, force: true }); } catch (_) {}
  A.report('spotify.store.test');
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
