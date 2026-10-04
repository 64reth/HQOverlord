/* node test/spotify.tools.test.js — the JUKEBOX tools against a stub Spotify Web API. Offline + deterministic.
   Pairs with sidecar/tools/builtin/spotify.js. */
'use strict';
const A = require('./_assert.js');
const { makeSpotifyTools } = require('../sidecar/tools/builtin/spotify.js');

function tool(set, name) { return set.tools.find(t => t.name === name); }

// a stub store whose getAccessToken returns a fixed token (or throws to simulate "not connected")
function fakeStore(token) { return { getAccessToken: async () => { if (token instanceof Error) throw token; return token; } }; }

// route Spotify Web API calls by (method, path-substring) -> { status, body }
function stubApi(routes) {
  const calls = [];
  const fn = async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ method, url: String(url), body: init && init.body ? JSON.parse(init.body) : null, init });
    for (const [m, needle, resp] of routes) {
      if (m === method && String(url).indexOf(needle) >= 0) {
        return { status: resp.status || 200, json: async () => resp.body || {} };
      }
    }
    return { status: 404, json: async () => ({ error: { status: 404, message: 'not stubbed' } }) };
  };
  fn.calls = calls; return fn;
}

(async () => {
  // ---- A. search parses + builds the right query ----
  const sFetch = stubApi([
    ['GET', '/search', { body: { tracks: { items: [
      { name: 'Song A', uri: 'spotify:track:aaa', artists: [{ name: 'Artist X' }], album: { name: 'Alb' } },
      { name: 'Song B', uri: 'spotify:track:bbb', artists: [{ name: 'Artist Y' }] }
    ] } } }]
  ]);
  const S1 = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: sFetch });
  const r = await tool(S1, 'spotify_search').run({ query: 'love' });
  A.ok(/Song A/.test(r.content) && /spotify:track:aaa/.test(r.content), 'search lists track names + URIs');
  A.ok(sFetch.calls[0].url.indexOf('type=track') >= 0 && sFetch.calls[0].url.indexOf('q=love') >= 0, 'search sends type + q');
  A.ok(sFetch.calls[0].init.headers.Authorization === 'Bearer tok', 'search sends the bearer token');

  // ---- B. now_playing: 200 with item, and the 204 idle case ----
  const npFetch = stubApi([['GET', '/me/player/currently-playing', { body: { is_playing: true, progress_ms: 50, item: { name: 'Now', duration_ms: 100, artists: [{ name: 'A' }] } } }]]);
  const S2 = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: npFetch });
  const np = await tool(S2, 'spotify_now_playing').run({});
  A.ok(/playing/.test(np.content) && /Now/.test(np.content) && /50%/.test(np.content), 'now_playing shows state + track + progress');

  const idleFetch = stubApi([['GET', '/me/player/currently-playing', { status: 204, body: {} }]]);
  const S2b = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: idleFetch });
  A.ok(/Nothing is playing/.test((await tool(S2b, 'spotify_now_playing').run({})).content), 'now_playing handles 204 idle');

  // ---- C. play with a track URI -> PUT /play with { uris:[…] } ----
  const playFetch = stubApi([['PUT', '/me/player/play', { status: 204, body: {} }]]);
  const S3 = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: playFetch });
  await tool(S3, 'spotify_play').run({ uri: 'spotify:track:aaa' });
  A.eq(playFetch.calls[0].method, 'PUT', 'play uses PUT');
  A.eq(playFetch.calls[0].body.uris, ['spotify:track:aaa'], 'a track URI goes in { uris:[…] }');

  // play with a playlist URI -> context_uri
  const playCtx = stubApi([['PUT', '/me/player/play', { status: 204, body: {} }]]);
  const S3b = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: playCtx });
  await tool(S3b, 'spotify_play').run({ uri: 'spotify:playlist:zzz' });
  A.eq(playCtx.calls[0].body.context_uri, 'spotify:playlist:zzz', 'a playlist URI goes in { context_uri }');

  // play with a QUERY -> search first, then play the top track
  const playQ = stubApi([
    ['GET', '/search', { body: { tracks: { items: [{ name: 'Top', uri: 'spotify:track:top', artists: [{ name: 'Z' }] }] } } }],
    ['PUT', '/me/player/play', { status: 204, body: {} }]
  ]);
  const S3c = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: playQ });
  const pr = await tool(S3c, 'spotify_play').run({ query: 'banger' });
  A.eq(playQ.calls.length, 2, 'play-by-query searches then plays');
  A.eq(playQ.calls[1].body.uris, ['spotify:track:top'], 'play-by-query plays the resolved top track');
  A.ok(/Top/.test(pr.content), 'play-by-query reports the track it played');

  // ---- D. pause / next / queue ----
  const ctlFetch = stubApi([
    ['PUT', '/me/player/pause', { status: 204, body: {} }],
    ['POST', '/me/player/next', { status: 204, body: {} }],
    ['POST', '/me/player/queue', { status: 204, body: {} }]
  ]);
  const S4 = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: ctlFetch });
  A.ok(/Paused/.test((await tool(S4, 'spotify_pause').run({})).content), 'pause works');
  A.ok(/next/.test((await tool(S4, 'spotify_next').run({})).content), 'next works');
  await tool(S4, 'spotify_queue').run({ uri: 'spotify:track:q' });
  A.ok(ctlFetch.calls.some(c => c.method === 'POST' && c.url.indexOf('/me/player/queue?uri=spotify%3Atrack%3Aq') >= 0), 'queue url-encodes the uri');
  let needArg = false; try { await tool(S4, 'spotify_queue').run({}); } catch (e) { needArg = /uri.*query|query/.test(e.message); }
  A.ok(needArg, 'queue requires a uri or query');

  // ---- E. consent + scope flags are correct (read = no consent; control = execute + consent) ----
  A.eq(tool(S1, 'spotify_search').requiresConsent, false, 'search is consent-free (read)');
  A.eq(tool(S1, 'spotify_search').scope, 'read', 'search scope=read');
  A.eq(tool(S1, 'spotify_play').requiresConsent, true, 'play requires consent');
  A.eq(tool(S1, 'spotify_play').scope, 'execute', 'play scope=execute');

  // ---- F. Spotify error translation: 403 (Premium) and 404 (no device) ----
  const premFetch = stubApi([['PUT', '/me/player/play', { status: 403, body: { error: { status: 403, reason: 'PREMIUM_REQUIRED', message: 'Player command failed: Premium required' } } }]]);
  const S5 = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: premFetch });
  let prem = false; try { await tool(S5, 'spotify_play').run({ uri: 'spotify:track:x' }); } catch (e) { prem = /Premium/i.test(e.message); }
  A.ok(prem, '403 surfaces a Premium-required message');

  const noDevFetch = stubApi([['PUT', '/me/player/pause', { status: 404, body: { error: { status: 404, message: 'Device not found' } } }]]);
  const S6 = makeSpotifyTools({ store: fakeStore('tok'), fetchImpl: noDevFetch });
  let noDev = false; try { await tool(S6, 'spotify_pause').run({}); } catch (e) { noDev = /active Spotify device/i.test(e.message); }
  A.ok(noDev, '404 on a player route surfaces a no-active-device hint');

  // ---- G. not connected -> the tool surfaces the store's clean error ----
  const S7 = makeSpotifyTools({ store: fakeStore(new Error('Spotify is not connected — connect it in TOOLSETS first.')), fetchImpl: stubApi([]) });
  let nc = false; try { await tool(S7, 'spotify_search').run({ query: 'x' }); } catch (e) { nc = /not connected/i.test(e.message); }
  A.ok(nc, 'a not-connected store makes tools fail with a clear message');

  A.report('spotify.tools.test');
})().catch(e => { console.log('FATAL', e && e.stack || e); process.exit(1); });
