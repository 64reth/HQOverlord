/* sidecar/spotify/pkce.js — pure OAuth 2.0 Authorization-Code-with-PKCE helpers for Spotify.

   PKCE is the correct flow for a desktop app: NO client secret is ever stored — the proof is a one-time
   random `code_verifier` whose SHA-256 `code_challenge` is sent up front, then the raw verifier at exchange.

   Everything here is PURE (string/crypto math, no network, no clock, no ambient randomness): the random
   verifier BYTES and the current time are INJECTED by the composition root (sidecar/index.js), so this stays
   reproducible and unit-testable (see test/spotify.pkce.test.js). node:crypto is used only for SHA-256/encoding
   (deterministic), never for randomness here. */
'use strict';
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('node:crypto'));
  else { root.SK = root.SK || {}; (root.SK.spotify = root.SK.spotify || {}).pkce = factory(null); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (nodeCrypto) {
  'use strict';

  const AUTH_BASE  = 'https://accounts.spotify.com/authorize';
  const TOKEN_URL  = 'https://accounts.spotify.com/api/token';
  // Sensible default scope set: read + control playback, read the user's playlists. (Playback control needs
  // Spotify Premium + an active device — the tools surface Spotify's own error if either is missing.)
  const DEFAULT_SCOPES = [
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'playlist-read-private',
    'playlist-read-collaborative'
  ];

  function base64url(buf) {
    return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // verifier := base64url(random bytes). Bytes are injected (crypto.randomBytes lives in the ambient root).
  // Spotify requires 43–128 chars; 48 random bytes -> 64 base64url chars.
  function makeVerifier(randomBytes) {
    if (!randomBytes || !randomBytes.length) throw new Error('makeVerifier needs random bytes');
    const v = base64url(randomBytes);
    if (v.length < 43) throw new Error('verifier too short — supply >= 32 random bytes');
    return v.slice(0, 128);
  }

  // challenge := base64url(SHA256(verifier))  (S256 method)
  function challengeOf(verifier) {
    if (!nodeCrypto) throw new Error('challengeOf requires node:crypto');
    return base64url(nodeCrypto.createHash('sha256').update(String(verifier)).digest());
  }

  function authorizeUrl(o) {
    o = o || {};
    if (!o.clientId) throw new Error('authorizeUrl needs clientId');
    if (!o.redirectUri) throw new Error('authorizeUrl needs redirectUri');
    const scope = Array.isArray(o.scope) ? o.scope.join(' ') : String(o.scope || DEFAULT_SCOPES.join(' '));
    const q = new URLSearchParams({
      client_id: o.clientId,
      response_type: 'code',
      redirect_uri: o.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: o.challenge,
      scope: scope,
      state: o.state || ''
    });
    return AUTH_BASE + '?' + q.toString();
  }

  // application/x-www-form-urlencoded body for the code->token exchange
  function tokenExchangeBody(o) {
    o = o || {};
    return new URLSearchParams({
      grant_type: 'authorization_code',
      code: o.code || '',
      redirect_uri: o.redirectUri || '',
      client_id: o.clientId || '',
      code_verifier: o.verifier || ''
    }).toString();
  }

  // body for refreshing an expired access token (PKCE refresh also needs client_id, never a secret)
  function refreshBody(o) {
    o = o || {};
    return new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: o.refreshToken || '',
      client_id: o.clientId || ''
    }).toString();
  }

  // expiresAt is absolute ms; refresh a bit early (skew) so a token never expires mid-request. `now` injected.
  function needsRefresh(expiresAt, now, skewMs) {
    if (!expiresAt) return true;
    return now >= (expiresAt - (skewMs == null ? 60000 : skewMs));
  }

  // turn Spotify's token response (+ the time it was fetched) into our persisted shape. Preserves the prior
  // refresh_token when Spotify omits it on a refresh (it often does — the old one stays valid).
  function tokensFromResponse(resp, fetchedAtMs, priorRefresh) {
    resp = resp || {};
    const expiresInMs = (Number(resp.expires_in) || 3600) * 1000;
    return {
      accessToken: resp.access_token || '',
      refreshToken: resp.refresh_token || priorRefresh || '',
      expiresAt: fetchedAtMs + expiresInMs,
      scope: resp.scope || ''
    };
  }

  return {
    AUTH_BASE, TOKEN_URL, DEFAULT_SCOPES,
    base64url, makeVerifier, challengeOf, authorizeUrl, tokenExchangeBody, refreshBody, needsRefresh, tokensFromResponse
  };
});
