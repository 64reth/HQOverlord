/* node test/spotify.pkce.test.js — pure OAuth PKCE helpers. Offline + deterministic. Anchors S256 against
   the canonical RFC 7636 Appendix-B test vector. Pairs with sidecar/spotify/pkce.js. */
'use strict';
const A = require('./_assert.js');
const pkce = require('../sidecar/spotify/pkce.js');

// ---- RFC 7636 Appendix B vector: verifier -> S256 challenge ----
const RFC_VERIFIER  = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
A.eq(pkce.challengeOf(RFC_VERIFIER), RFC_CHALLENGE, 'challengeOf matches the RFC 7636 S256 test vector');

// ---- base64url + makeVerifier ----
A.eq(pkce.base64url(Buffer.from([0xff, 0xff, 0xff])), '____', 'base64url encodes + strips padding (0xffffff -> ____)');
const v = pkce.makeVerifier(Buffer.alloc(48, 7));
A.ok(v.length >= 43 && v.length <= 128, 'verifier length is within Spotify/PKCE bounds (43-128)');
A.ok(/^[A-Za-z0-9_-]+$/.test(v), 'verifier is URL-safe (no +, /, or =)');
A.throws(() => pkce.makeVerifier(Buffer.alloc(0)), 'makeVerifier rejects empty randomness');

// ---- authorizeUrl ----
const url = pkce.authorizeUrl({ clientId: 'CID', redirectUri: 'http://127.0.0.1:8787/api/spotify/callback', challenge: RFC_CHALLENGE, state: 'st8', scope: ['user-read-playback-state', 'user-modify-playback-state'] });
A.ok(url.indexOf('https://accounts.spotify.com/authorize?') === 0, 'authorizeUrl points at Spotify authorize');
A.ok(url.indexOf('client_id=CID') >= 0, 'authorizeUrl carries client_id');
A.ok(url.indexOf('code_challenge_method=S256') >= 0, 'authorizeUrl uses S256');
A.ok(url.indexOf('code_challenge=' + RFC_CHALLENGE) >= 0, 'authorizeUrl carries the challenge');
A.ok(url.indexOf('redirect_uri=http%3A%2F%2F127.0.0.1%3A8787%2Fapi%2Fspotify%2Fcallback') >= 0, 'authorizeUrl url-encodes the redirect_uri');
A.ok(url.indexOf('state=st8') >= 0, 'authorizeUrl carries state');
A.ok(url.indexOf('user-read-playback-state') >= 0 && url.indexOf('user-modify-playback-state') >= 0, 'authorizeUrl carries the scopes');
A.throws(() => pkce.authorizeUrl({ redirectUri: 'x', challenge: 'y' }), 'authorizeUrl requires clientId');

// ---- token exchange + refresh bodies (PKCE: client_id, never a secret) ----
const ex = pkce.tokenExchangeBody({ code: 'CODE', redirectUri: 'RU', clientId: 'CID', verifier: RFC_VERIFIER });
A.ok(ex.indexOf('grant_type=authorization_code') >= 0, 'exchange uses authorization_code grant');
A.ok(ex.indexOf('code=CODE') >= 0 && ex.indexOf('code_verifier=' + RFC_VERIFIER) >= 0, 'exchange carries code + verifier');
A.ok(ex.indexOf('client_id=CID') >= 0 && ex.indexOf('client_secret') < 0, 'exchange carries client_id and NO secret');

const rf = pkce.refreshBody({ refreshToken: 'RT', clientId: 'CID' });
A.ok(rf.indexOf('grant_type=refresh_token') >= 0 && rf.indexOf('refresh_token=RT') >= 0 && rf.indexOf('client_id=CID') >= 0, 'refresh body carries grant + token + client_id');
A.ok(rf.indexOf('client_secret') < 0, 'refresh body has NO secret');

// ---- needsRefresh + tokensFromResponse ----
A.eq(pkce.needsRefresh(0, 1000), true, 'needsRefresh true with no expiry');
A.eq(pkce.needsRefresh(1000000, 100000, 60000), false, 'needsRefresh false when token is comfortably valid');
A.eq(pkce.needsRefresh(1000000, 950000, 60000), true, 'needsRefresh true inside the skew window');

const tok = pkce.tokensFromResponse({ access_token: 'AT', expires_in: 3600, scope: 's' }, 1000, 'OLD_RT');
A.eq(tok.accessToken, 'AT', 'tokensFromResponse reads access_token');
A.eq(tok.expiresAt, 1000 + 3600 * 1000, 'tokensFromResponse computes absolute expiresAt');
A.eq(tok.refreshToken, 'OLD_RT', 'tokensFromResponse keeps the prior refresh token when Spotify omits a new one');
A.eq(pkce.tokensFromResponse({ access_token: 'A', refresh_token: 'NEW' }, 0, 'OLD').refreshToken, 'NEW', 'a fresh refresh_token overrides the prior one');

A.report('spotify.pkce.test');
